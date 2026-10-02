'use client'

import { useAssist } from '@/components/workbench/use-assist'
import { lyricsSummary } from '@/lib/lyric-sync'
import { MAX_STYLE_REFERENCES, lyricLines, type MediaAssetId, type Project, type ProjectId, type UpdateProjectPatch } from '@ixa/domain'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ImageUploader } from '@/components/image-uploader'
import { MediaImage } from '@/components/media-image'
import { Button } from '@/components/ui/button'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { ObjectHeader } from '@/components/workbench/ui/object-header'
import { Section } from '@/components/workbench/ui/section'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { goToLyricSync } from '@/components/workbench/workbench-navigation'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import type { ProjectConceptApi } from '@/lib/project-concept-api'

export type ProjectConceptInspectorApi = ProjectConceptApi & {
  readonly updateProject: (id: ProjectId, patch: UpdateProjectPatch) => Promise<Project>
}

type Concept =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly content: string }
  | { readonly kind: 'error'; readonly message: string }

/** 欄がどこに効くか。**効かない所も言う**（黙っていると、書いたのに効かないと思われる）。 */
const Hint = ({ children }: { readonly children: ReactNode }) => <p className="text-xs text-muted">{children}</p>

/**
 * 作品の方針（ADR-0030）。動画全体のコンセプト・ルック・手本画像・避けたいものを 1 か所で決め、
 * 全 Shot の生成に自動で入れる。欄は確定ごとに保存する。
 *
 * - コンセプト＝脚本（版を積む）。AI の Shot 説明の下書きが読む
 * - ルック＝`styleGuide`。全 Shot の映像と Shot の絵の生成指示の最後に入る
 * - 手本画像＝`styleReferenceAssetIds`。全 Shot の生成に見た目の手本として添える
 * - 避けたいもの＝`avoid`。Shot の絵と AI の下書きに入る（映像のモデルは受けない）
 */
export const ProjectConceptInspector = ({ api }: { readonly api?: ProjectConceptInspectorApi }) => {
  const workbench = useWorkbench()
  const assistFor = useAssist()
  const client = useMemo<ProjectConceptInspectorApi>(() => api ?? createApiClient(), [api])
  const [project, setProject] = useState<Project>(workbench.project)
  const [concept, setConcept] = useState<Concept>({ kind: 'loading' })
  const [error, setError] = useState<string | null>(null)

  // サーバから読み直した作品が届いたら追いつく（別の画面で直したときなど）。
  useEffect(() => {
    setProject(workbench.project)
  }, [workbench.project])

  useEffect(() => {
    let alive = true
    client
      .getConcept(workbench.projectId)
      .then((content) => {
        if (alive) setConcept({ kind: 'ready', content })
      })
      .catch((cause: unknown) => {
        if (alive) setConcept({ kind: 'error', message: describeForPerson(cause) })
      })
    return () => {
      alive = false
    }
  }, [client, workbench.projectId])

  const save = async (patch: UpdateProjectPatch): Promise<void> => {
    setError(null)
    setProject(await client.updateProject(project.id, patch))
    // 生成の画面・設定が同じ作品を読んでいるので、サーバから読み直させる。
    workbench.refresh()
  }

  /** 画像の足し外しは欄を持たないので、失敗はこの画面の下に出す。 */
  const saveReferences = async (ids: readonly MediaAssetId[]): Promise<void> => {
    try {
      await save({ styleReferenceAssetIds: [...ids] })
    } catch (cause) {
      setError(`手本画像を保存できませんでした: ${describeForPerson(cause)}`)
    }
  }

  const references = project.styleReferenceAssetIds
  const full = references.length >= MAX_STYLE_REFERENCES

  return (
    <div className="flex h-full flex-col">
      <ObjectHeader kind="作品の方針" title={project.name} />
      <div className="workbench-panel-body relative min-h-0 flex-1 space-y-1 overflow-auto">
        <Hint>ここで決めた方針は、全 Shot の生成に自動で入ります。あとから直しても、次に作る分から効きます。</Hint>

        <Section title="コンセプト・あらすじ">
          {concept.kind === 'loading' && <Hint>読み込んでいます…</Hint>}
          {concept.kind === 'error' && (
            <p role="alert" className="text-xs text-danger">
              {`コンセプトを読めませんでした: ${concept.message}`}
            </p>
          )}
          {concept.kind === 'ready' && (
            <AutoSaveField
              label="コンセプト・あらすじ"
              hideLabel
              multiline
              value={concept.content}
              placeholder="例: 雨の夜、街の小さなコーヒースタンドで働くバリスタと、配達員の青年の話。夜明けに二人で屋上へ。"
              assist={assistFor('concept')}
              onSave={async (next) => {
                await client.saveConcept(project.id, next)
                setConcept({ kind: 'ready', content: next })
                // 流れの帯（② 作品の方針）へ、読み直しを待たずに映す。
                workbench.conceptSaved(next)
              }}
            />
          )}
          <Hint>
            AI が各 Shot の説明を書くとき（絵コンテの案）の材料になります。長い文章なので、映像や絵の生成指示には直接は入りません。
          </Hint>
        </Section>

        <Section title="歌詞">
          <AutoSaveField
            label="歌詞"
            hideLabel
            multiline
            value={project.lyrics}
            placeholder={'1 行に 1 フレーズ。空行は歌の区切り（数えません）。\n例:\n夜明けの屋上で\n君を待ってた'}
            onSave={(next) => save({ lyrics: next })}
          />
          <Hint>{lyricsSummary(project.lyrics, project.lyricCues)}</Hint>
          {/* 入口を歌詞を入れる場所にも置く（制作者 2026-10-02「歌詞の自動テロップってどこからやるんだっけ」）。 */}
          <div className="flex justify-start">
            <Button
              size="sm"
              disabled={lyricLines(project.lyrics).length === 0}
              title={lyricLines(project.lyrics).length === 0 ? '先に歌詞を入れてください' : undefined}
              onClick={() => {
                goToLyricSync(workbench)
              }}
            >
              聴きながら時刻を付ける
            </Button>
          </div>
          <Hint>
            曲を流してフレーズの歌い出しに Enter を押すと時刻が付きます。時刻が付いたフレーズはテロップにでき、AI の説明の下書き（絵コンテの案）にも、その Shot で歌われる歌詞として入ります。
          </Hint>
        </Section>

        <Section title="ルック（画風・光・質感）">
          <AutoSaveField
            label="ルック（画風・光・質感）"
            hideLabel
            multiline
            value={project.styleGuide}
            placeholder="例: 35mm フィルム、夜の雨、琥珀色の街灯、浅い被写界深度"
            onSave={(next) => save({ styleGuide: next })}
            assist={assistFor('look')}
          />
          <Hint>全 Shot の映像と、Shot の絵（最初のフレーム）の生成指示の最後に入ります。</Hint>
        </Section>

        <Section title="手本画像">
          {references.length > 0 && (
            <ul className="grid grid-cols-3 gap-2">
              {references.map((id, index) => (
                <li key={id} className="space-y-1">
                  <MediaImage
                    mediaAssetId={id}
                    alt={`手本画像 ${String(index + 1)}`}
                    className="aspect-video w-full rounded object-cover ring-1 ring-line"
                  />
                  <Button
                    size="sm"
                    aria-label={`手本画像 ${String(index + 1)} を外す`}
                    onClick={() => void saveReferences(references.filter((candidate) => candidate !== id))}
                  >
                    外す
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {full ? (
            <Hint>{`手本画像は ${String(MAX_STYLE_REFERENCES)} 枚までです。入れ替えるときは外してから足してください。`}</Hint>
          ) : (
            <ImageUploader
              id="project-style-reference"
              workspaceId={project.workspaceId}
              submitLabel="手本画像を追加"
              onUploaded={(id) => saveReferences([...references, id])}
            />
          )}
          <Hint>
            {`全 Shot の生成に「見た目の手本」として添えます（${String(MAX_STYLE_REFERENCES)} 枚まで）。1 枚目がいちばん優先されます。`}
          </Hint>
        </Section>

        <Section title="避けたいもの">
          <AutoSaveField
            label="避けたいもの"
            hideLabel
            multiline
            value={project.avoid}
            placeholder="例: 文字・透かし・アニメ調"
            onSave={(next) => save({ avoid: next })}
            assist={assistFor('avoid')}
          />
          <Hint>
            Shot の絵の生成と、AI の説明の下書きに入ります。映像の生成モデルは今どれも「避ける」指定に対応していないので、映像には入りません。
          </Hint>
        </Section>

        {error !== null && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
