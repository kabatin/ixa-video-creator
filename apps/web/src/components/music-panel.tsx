'use client'

import type { MusicTrack, MusicTrackId, ProjectId, WorkspaceId } from '@ixa/domain'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AudioUploader, type UploadedAudio } from '@/components/audio-uploader'
import { TextField } from '@/components/form/text-field'
import { FIELD_HINT_CLASS, FIELD_LABEL_CLASS } from '@/components/form/field-styles'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { formatClock } from '@/lib/format-time'
import type { WireMusicAnalysis } from '@/lib/music-api'
import {
  analysisNotice,
  analysisStats,
  decideAnalysisFreshness,
  describeAnalysisSection,
  formatBytes,
  summarizeAnalysis,
  validateTrackTitle,
  type AnalysisFreshness,
  type AnalysisPhase,
} from '@/lib/music-upload'
import { POLL_INTERVAL_MS, startAsyncPolling } from '@/lib/poller'
import { projectSectionHref } from '@/lib/project-links'
import { WORDING } from '@/lib/wording'

/**
 * 音源をアップロードして楽曲として登録し、解析まで進める画面の中身。
 *
 * 解析は worker が数十秒かけて行う。**投入しただけで終わりにしない。**
 * 終わったかどうかをこの画面が追いかけ、終わったら自動で結果へ差し替える。
 *
 * 状態の意味づけ（何を「完了」と呼ぶか）は `lib/music-upload.ts` にある。
 * ここは受け取った状態を並べるだけにする。
 */

const POLL_STEP_SEC = POLL_INTERVAL_MS / 1000

const INFO_CLASS = 'whitespace-pre-wrap break-words text-sm text-text'
const ALERT_CLASS = 'whitespace-pre-wrap break-words text-sm text-danger'

export type MusicPanelProps = {
  readonly projectId: ProjectId
  readonly workspaceId: WorkspaceId
  readonly initialTracks: readonly MusicTrack[]
}

const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="rounded-lg border border-line bg-surface p-6 shadow-sm">
    <h2 className="text-base font-semibold text-text">{title}</h2>
    <div className="mt-4">{children}</div>
  </section>
)

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
    <dd className="text-sm text-text">{value}</dd>
  </div>
)

export const MusicPanel = ({ projectId, workspaceId, initialTracks }: MusicPanelProps) => {
  const router = useRouter()
  const [tracks, setTracks] = useState<readonly MusicTrack[]>(initialTracks)
  const [uploaded, setUploaded] = useState<UploadedAudio | null>(null)
  const [title, setTitle] = useState('')
  const [isMaster, setIsMaster] = useState(!initialTracks.some((track) => track.isMaster))
  const [registering, setRegistering] = useState(false)
  const [registerError, setRegisterError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<MusicTrackId | null>(
    (initialTracks.find((track) => track.isMaster) ?? initialTracks[0])?.id ?? null,
  )
  const [phase, setPhase] = useState<AnalysisPhase>({ kind: 'idle' })
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  /** 待ち合わせの基準になる解析時刻。再解析で古い結果を完了と誤認しないため。 */
  const baselineRef = useRef<string | null>(null)

  const selected = tracks.find((track) => track.id === selectedId) ?? null
  const masterCount = tracks.filter((track) => track.isMaster).length

  useEffect(() => {
    if (selectedId === null) {
      setPhase({ kind: 'idle' })
      return undefined
    }
    let cancelled = false
    setPhase({ kind: 'loading' })
    void (async () => {
      try {
        const latest = await createApiClient().getAnalysis(selectedId)
        if (cancelled) return
        baselineRef.current = latest?.createdAt ?? null
        setPhase(latest === null ? { kind: 'none' } : { kind: 'ready', analysis: latest })
      } catch (caught) {
        if (cancelled) return
        setPhase({ kind: 'error', message: describeError(caught) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  useEffect(() => {
    if (phase.kind !== 'waiting' || selectedId === null) return undefined

    const handle = startAsyncPolling<AnalysisFreshness>({
      probe: async () => {
        const latest = await createApiClient().getAnalysis(selectedId)
        const decision = decideAnalysisFreshness({ previousCreatedAt: baselineRef.current, latest })
        return { running: decision.kind === 'waiting', value: decision }
      },
      onProbe: () => {
        setPhase((current) =>
          current.kind === 'waiting'
            ? { ...current, waitedSec: current.waitedSec + POLL_STEP_SEC }
            : current,
        )
      },
      onSettled: (decision) => {
        if (decision.kind !== 'fresh') return
        baselineRef.current = decision.analysis.createdAt
        setPhase({ kind: 'ready', analysis: decision.analysis })
      },
      onTimeout: () => {
        setPhase({ kind: 'timeout' })
      },
      onFailed: (caught) => {
        setPhase({ kind: 'error', message: describeError(caught) })
      },
    })

    return () => {
      handle.stop()
    }
  }, [phase.kind, selectedId])

  const register = async (): Promise<void> => {
    if (uploaded === null) return
    const validated = validateTrackTitle(title)
    if (!validated.ok) {
      setRegisterError(validated.reason)
      return
    }

    setRegistering(true)
    setRegisterError(null)
    try {
      const track = await createApiClient().createMusicTrack(projectId, {
        mediaAssetId: uploaded.mediaAssetId,
        title: validated.title,
        isMaster,
      })
      setTracks((current) => [...current, track])
      setUploaded(null)
      setTitle('')
      setSelectedId(track.id)

      /**
       * **他の画面が持っている古い内容を捨てる。**
       *
       * Next.js は `<Link>` が画面に入った時点で遷移先を先読みする。
       * この画面を開いた瞬間にストーリーボードも先読みされるので、
       * そこには「楽曲が登録されていません」が入っている。
       * 登録後にそのリンクを押すと、先読みした古い内容がそのまま出る。
       * 実際に「登録したのに未登録と言われ、再読み込みしたら直る」が起きた。
       */
      router.refresh()
    } catch (caught) {
      setRegisterError(`楽曲として登録できませんでした: ${describeError(caught)}`)
    } finally {
      setRegistering(false)
    }
  }

  const startAnalysis = async (): Promise<void> => {
    if (selectedId === null) return
    // 失敗したら元の表示へ戻す。押す前に見えていたものを消してしまわないため。
    const previous = phase
    baselineRef.current = phase.kind === 'ready' ? phase.analysis.createdAt : null
    setAnalysisError(null)
    setPhase({ kind: 'waiting', waitedSec: 0 })
    try {
      await createApiClient().requestAnalysis(selectedId)
    } catch (caught) {
      setAnalysisError(`解析を依頼できませんでした: ${describeError(caught)}`)
      setPhase(previous)
    }
  }

  return (
    <div className="space-y-6">
      <Card title="音源を登録する">
        <div className="space-y-4">
          <AudioUploader
            id="music-audio"
            workspaceId={workspaceId}
            projectId={projectId}
            disabled={registering}
            onUploaded={(next) => {
              setUploaded(next)
              setTitle(next.suggestedTitle)
              setRegisterError(null)
            }}
          />

          {uploaded !== null && (
            <div className="space-y-3 rounded-md border border-line bg-surface-2 p-4">
              <p role="status" className={INFO_CLASS}>
                {uploaded.fileName}（{formatBytes(uploaded.bytes)}）を取り込みました。
                曲名を確認して登録してください。
              </p>

              <TextField
                id="music-title"
                label="曲名"
                value={title}
                disabled={registering}
                onChange={setTitle}
              />

              <label className={`flex items-start gap-2 ${FIELD_LABEL_CLASS}`}>
                <input
                  type="checkbox"
                  checked={isMaster}
                  disabled={registering}
                  onChange={(event) => {
                    setIsMaster(event.target.checked)
                  }}
                  className="mt-1"
                />
                <span>
                  マスター音源にする
                  <span className={`block font-normal ${FIELD_HINT_CLASS}`}>
                    ミュージックビデオの尺を決めるのはマスター音源です。
                    ストーリーボードもこの曲を既定で使います。
                  </span>
                </span>
              </label>

              <Button
                tone="primary"
                disabled={registering}
                onClick={() => {
                  void register()
                }}
              >
                {registering ? '登録中…' : '楽曲として登録'}
              </Button>

              {registerError !== null && (
                <p role="alert" className={ALERT_CLASS}>
                  {registerError}
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title={`登録済みの楽曲（${String(tracks.length)}）`}>
        {tracks.length === 0 ? (
          <p className={INFO_CLASS}>
            まだ 1 曲も登録されていません。音源をアップロードして登録してください。
          </p>
        ) : (
          <div className="space-y-3">
            {masterCount > 1 && (
              <p role="alert" className={ALERT_CLASS}>
                マスター音源が {String(masterCount)} 曲あります。
                ストーリーボードはそのうち 1 曲を勝手に選ぶため、尺の基準が定まりません。
              </p>
            )}
            <ul className="flex flex-wrap gap-2">
              {tracks.map((track) => (
                <li key={track.id}>
                  <Button
                    tone={track.id === selectedId ? 'primary' : 'secondary'}
                    size="sm"
                    aria-pressed={track.id === selectedId}
                    onClick={() => {
                      setSelectedId(track.id)
                    }}
                  >
                    {track.title}
                    {track.isMaster ? '（マスター）' : ''}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {selected !== null && (
        <Card title={`音楽解析 — ${selected.title}`}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                tone="primary"
                disabled={phase.kind === 'waiting' || phase.kind === 'loading'}
                onClick={() => {
                  void startAnalysis()
                }}
              >
                {phase.kind === 'ready' ? `再解析を${WORDING.start}` : `解析を${WORDING.start}`}
              </Button>
              {phase.kind === 'ready' && (
                <Link
                  href={projectSectionHref(projectId, 'storyboard')}
                  className="text-sm font-medium text-text underline hover:text-muted"
                >
                  ストーリーボードへ進む
                </Link>
              )}
            </div>

            {analysisError !== null && (
              <p role="alert" className={ALERT_CLASS}>
                {analysisError}
              </p>
            )}

            <AnalysisView phase={phase} />
          </div>
        </Card>
      )}
    </div>
  )
}

const AnalysisView = ({ phase }: { readonly phase: AnalysisPhase }) => {
  const notice = analysisNotice(phase)
  return (
    <>
      {notice !== null && (
        <p
          role={notice.tone === 'alert' ? 'alert' : 'status'}
          className={notice.tone === 'alert' ? ALERT_CLASS : INFO_CLASS}
        >
          {notice.text}
        </p>
      )}
      {phase.kind === 'ready' && <AnalysisResult analysis={phase.analysis} />}
    </>
  )
}

const AnalysisResult = ({ analysis }: { readonly analysis: WireMusicAnalysis }) => {
  const summary = summarizeAnalysis(analysis)

  return (
    <div className="space-y-4">
      <p role="status" className={INFO_CLASS}>
        解析が完了しました（{analysis.analyzerVersion}）。
      </p>

      {summary.missing.length > 0 && (
        <p role="alert" className={ALERT_CLASS}>
          解析は終わりましたが {summary.missing.join(' / ')} が 1 件も取れていません。
          このままでは Shot を割れません。音源を確認してください。
        </p>
      )}

      {summary.lowConfidence && (
        <p role="alert" className={ALERT_CLASS}>
          BPM の信頼度が低い値です（{summary.bpmConfidence.toFixed(2)}）。
          尺の基準に使う前に、ビートの位置を確かめてください。
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {analysisStats(summary).map((stat) => (
          <Stat key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </dl>

      {summary.sectionCount > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-text">セクション</h3>
          <ul className="mt-2 space-y-1">
            {analysis.sections.map((section, index) => (
              <li key={`${String(index)}-${section.label}`} className="text-sm text-text">
                <span className="font-medium">{section.label}</span>{' '}
                {describeAnalysisSection(section)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.dropCount > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-text">ドロップ</h3>
          <p className="mt-2 text-sm text-text">
            {analysis.drops.map((drop) => formatClock(drop)).join(' / ')}
          </p>
        </div>
      )}
    </div>
  )
}
