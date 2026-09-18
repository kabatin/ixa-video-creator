import { ProjectId, type MusicTrack, type Sequence } from '@ixa/domain'
import { ProjectNav } from '@/components/project-nav'
import { AnalysisStarter } from '@/components/analysis-starter'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { CutEditor } from '@/components/cut-editor'
import { StoryboardPanel } from '@/components/storyboard-panel'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import type { WireMusicAnalysis } from '@/lib/music-api'

export const dynamic = 'force-dynamic'

type StoryboardPageProps = {
  readonly params: Promise<{ readonly id: string }>
}

type Loaded = {
  readonly track: MusicTrack | null
  readonly analysis: WireMusicAnalysis | null
  readonly sequences: readonly Sequence[]
}

type LoadResult =
  | { readonly ok: true; readonly loaded: Loaded }
  | { readonly ok: false; readonly message: string }

/**
 * 割り当てに使う楽曲を選ぶ。
 * マスター音源があればそれ、無ければ先頭。ミュージックビデオでは
 * **尺を決めるのはマスター音源**なので、そこを既定にする。
 */
const pickTrack = (tracks: readonly MusicTrack[]): MusicTrack | null =>
  tracks.find((track) => track.isMaster) ?? tracks[0] ?? null

/** API 障害でページを落とさない。失敗は必ず表示可能な値へ畳む。 */
const load = async (projectId: ProjectId): Promise<LoadResult> => {
  try {
    const api = createApiClient()
    const [tracks, sequences] = await Promise.all([
      api.listMusicTracks(projectId),
      api.listSequences(projectId),
    ])

    const track = pickTrack(tracks)
    if (track === null) return { ok: true, loaded: { track: null, analysis: null, sequences } }

    return { ok: true, loaded: { track, analysis: await api.getAnalysis(track.id), sequences } }
  } catch (error) {
    return { ok: false, message: describeError(error) }
  }
}

const StoryboardPage = async ({ params }: StoryboardPageProps) => {
  const { id } = await params
  const projectId = ProjectId.safeParse(id)

  if (!projectId.success) {
    return (
      <main>
        <PageHeader title="ストーリーボード" />
        <ErrorPanel
          title="プロジェクト ID が不正です"
          message={`URL の ID が ULID ではありません: ${id}`}
          hint="プロジェクト一覧から辿り直してください。"
        />
      </main>
    )
  }

  const result = await load(projectId.data)

  return (
    <main>
      <PageHeader
        title="ストーリーボード"
        description="音を鳴らしながら波形の上で区切りを置き、Shot にします。"
        action={<ProjectNav projectId={projectId.data} current="storyboard" />}
      />

      {!result.ok ? (
        <ErrorPanel
          title="読み込めませんでした"
          message={result.message}
          hint={`API (${resolveApiBaseUrl()}) が起動しているか確認してください。`}
        />
      ) : result.loaded.track === null ? (
        <ErrorPanel
          title="楽曲が登録されていません"
          message="この Project には楽曲が 1 つも登録されていません。"
          hint="先に音源をアップロードして楽曲として登録してください。"
        />
      ) : result.loaded.analysis === null ? (
        <AnalysisStarter track={result.loaded.track} />
      ) : (
        <div className="space-y-6">
          <CutEditor
            projectId={projectId.data}
            track={result.loaded.track}
            analysis={result.loaded.analysis}
            sequences={result.loaded.sequences}
          />

          {/**
           * セクションから一括で割る形も残す。**精度は低い**（実データは 15 個すべて
           * `verse` 判定）が、下拵えとして粗く割ってから波形の上で直す使い方はできる。
           * 主でなくなったので、開かないと出ないところへ下げてある。
           */}
          <details className="rounded-lg border border-line bg-surface p-5">
            <summary className="cursor-pointer text-base font-semibold text-text">
              セクションから一括で割る（自動・精度は低い）
            </summary>
            <p className="mt-2 text-sm text-muted">
              解析が付けたセクションの境目で機械的に割ります。ラベルの判定は当てになりません。
              粗く割ってから、上の波形で区切りを直す使い方を想定しています。
            </p>
            <div className="mt-4">
              <StoryboardPanel
                projectId={projectId.data}
                track={result.loaded.track}
                analysis={result.loaded.analysis}
                sequences={result.loaded.sequences}
              />
            </div>
          </details>
        </div>
      )}
    </main>
  )
}

export default StoryboardPage
