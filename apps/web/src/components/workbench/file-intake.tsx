'use client'

import type { ConsoleLevel } from '@/lib/console-log'
import type { ShotId } from '@ixa/domain'
import { useEffect, useRef, useState } from 'react'
import { useAssets } from '@/components/workbench/asset-store'
import { AudioRoleDialog } from '@/components/workbench/audio-role-dialog'
import { useSfxFileImport } from '@/components/workbench/use-sfx-file-import'
import { FootageImportForm } from '@/components/workbench/inspector/footage-import-form'
import {
  imageChoicesFor,
  useImageAttach,
  type ImageTarget,
} from '@/components/workbench/use-image-attach'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { GUIDE_TO_CONCEPT_NOTICES, useGuideToConcept } from '@/components/workbench/workflow-context'
import { WorkbenchDialog } from '@/components/workbench/workbench-dialog'
import { Button } from '@/components/ui/button'
import { describeForPerson } from '@/lib/api-error'
import { ASSET_DRAG_TYPE, groupDroppedFiles } from '@/lib/asset-actions'
import { audioFileDurationSec } from '@/lib/audio-file-duration'
import { defaultAudioRole, type AudioRole } from '@/lib/audio-intake-role'

/**
 * ファイルを落とせば入る（UI-WORKBENCH-2 §4.5 / P8）。
 *
 * - 音声 → 楽曲か効果音かを 1 回だけ聞く（短い音は効果音を選んでおく。制作者 2026-10-19）。
 *   楽曲なら登録して解析を始め、効果音なら素材の効果音に入れる
 * - 画像 → 行き先を 1 回だけ聞く（選んでいる素材 / 新しいロケーション / 新しいブランド資産）
 * - 動画 → 選んでいる Shot の Take にする（ADR-0026）。Shot を選んでいなければ、そう伝える
 * - 素材ビューアの区画に落とした場合は、そちらが受けて伝わりを止める（ここへ来ない）
 *
 * 「ファイルを取り込む…」（メニュー）はここのファイル選択を開く。
 */
export const FileIntake = ({
  onNotice,
  registerOpener,
}: {
  readonly onNotice: (message: string, level?: ConsoleLevel) => void
  readonly registerOpener: (open: () => void) => void
}) => {
  const workbench = useWorkbench()
  const guideToConcept = useGuideToConcept()
  const { actions } = useAssets()
  const attach = useImageAttach()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const importSfxFile = useSfxFileImport()
  const [pendingImages, setPendingImages] = useState<readonly File[]>([])
  const [pendingAudio, setPendingAudio] = useState<{
    readonly files: readonly File[]
    readonly role: AudioRole
  } | null>(null)
  /** 落とした時点で選んでいた Shot に入れる（確かめている間に選び直しても行き先を変えない）。 */
  const [pendingVideos, setPendingVideos] = useState<{
    readonly shotId: ShotId
    readonly files: readonly File[]
  } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    registerOpener(() => {
      input.current?.click()
    })
  }, [registerOpener])

  const intake = async (files: readonly File[]): Promise<void> => {
    const { audio, image: images, video: videos, otherCount } = groupDroppedFiles(files)
    if (otherCount > 0)
      onNotice(`${String(otherCount)} 件は取り込めない種類のファイルでした（音声・画像・動画だけ受けます）。`, 'warn')
    if (images.length > 0) setPendingImages(images)
    if (videos.length > 0) {
      const inspected = workbench.inspected
      if (inspected?.kind === 'shot') setPendingVideos({ shotId: inspected.id, files: videos })
      else onNotice('動画は、Shot を選んでから落とすとその Shot の Take になります。')
    }
    if (audio.length > 0) {
      // 長さを読めなかった音は長い音とみなす（楽曲を選んでおく）。読めない理由は取り込むときに出る。
      const durations = await Promise.all(audio.map((file) => audioFileDurationSec(file).catch(() => null)))
      setPendingAudio({ files: audio, role: defaultAudioRole(durations) })
    }
  }

  const addTracks = async (files: readonly File[]): Promise<void> => {
    for (const file of files) {
      try {
        const track = await actions.addTrackFromFile(file)
        // 作品の方針がまだなら方針を開く（次にやること）。済んでいれば登録した楽曲を見せる。
        if (!guideToConcept(GUIDE_TO_CONCEPT_NOTICES.registered(track.title))) {
          workbench.inspect({ kind: 'track', id: track.id })
          onNotice(`「${track.title}」を楽曲として登録し、解析を始めました。`)
        }
      } catch (cause) {
        onNotice(`${file.name} を登録できませんでした: ${describeForPerson(cause)}`, 'error')
      }
    }
  }

  const addSfx = async (files: readonly File[]): Promise<void> => {
    for (const file of files) {
      try {
        const sound = await importSfxFile(file)
        onNotice(`「${sound.title}」を効果音として取り込みました。素材の効果音からタイムラインの効果音の段へドラッグして置けます。`)
      } catch (cause) {
        onNotice(`${file.name} を効果音として取り込めませんでした: ${describeForPerson(cause)}`, 'error')
      }
    }
    workbench.bumpSfx()
  }

  const importAudio = async (role: AudioRole): Promise<void> => {
    if (pendingAudio === null) return
    setBusy(true)
    try {
      await (role === 'sfx' ? addSfx(pendingAudio.files) : addTracks(pendingAudio.files))
    } finally {
      setBusy(false)
      setPendingAudio(null)
    }
  }

  useEffect(() => {
    const hasFiles = (event: DragEvent): boolean =>
      event.dataTransfer !== null &&
      [...event.dataTransfer.types].includes('Files') &&
      ![...event.dataTransfer.types].includes(ASSET_DRAG_TYPE)
    const onOver = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setDragging(true)
    }
    const onLeave = (event: DragEvent): void => {
      // 画面の外へ出たときだけ消す（子要素の出入りでは消さない）。
      if (event.relatedTarget === null) setDragging(false)
    }
    const onDrop = (event: DragEvent): void => {
      setDragging(false)
      // 受けたかどうかを `defaultPrevented` で見ない。パネルの配置の仕組み（dockview）がパネルの上のドロップに
      // 印を付けるので、パネルの上に落とすと何も起きなかった（制作者 2026-10-03「登録先を選ぶ画面が出てこない」）。
      // 自分で受ける区画（素材ビューア）は stopPropagation して、ここへ流さない。
      if (!hasFiles(event)) return
      event.preventDefault()
      void intake([...(event.dataTransfer?.files ?? [])])
    }
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  })

  const place = async (target: ImageTarget): Promise<void> => {
    setBusy(true)
    try {
      const placed = await attach(target, pendingImages)
      workbench.inspect(placed)
      workbench.openViewer()
      onNotice(
        target.kind === 'new-character-sheet'
          ? 'キャラクターを作り、キャラクターシートを作り始めました（1 枚 1 分ほど）。名前はあとで直せます。'
          : target.kind === 'new-character'
            ? `キャラクターを作り、画像 ${String(pendingImages.length)} 枚を入れました。名前はあとで直せます。`
            : `画像 ${String(pendingImages.length)} 枚を取り込みました。`,
      )
      setPendingImages([])
    } catch (cause) {
      onNotice(`画像を取り込めませんでした: ${describeForPerson(cause)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const current = workbench.inspected
  const choices = imageChoicesFor(current)
  const videoShot =
    pendingVideos === null
      ? null
      : (workbench.shots?.find((shot) => shot.id === pendingVideos.shotId) ?? null)

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept="audio/*,image/*,video/*"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          void intake(files)
        }}
      />
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg/60 backdrop-blur-sm">
          <p className="rounded-lg border-2 border-dashed border-accent bg-surface px-6 py-4 text-base text-text">
            落とすと取り込みます（音声 → 楽曲か効果音かを選ぶ、画像 → 行き先を選ぶ、動画 → 選んでいる Shot の Take）
          </p>
        </div>
      )}
      {pendingAudio !== null && (
        <AudioRoleDialog
          files={pendingAudio.files}
          initialRole={pendingAudio.role}
          busy={busy}
          onChoose={(role) => {
            void importAudio(role)
          }}
          onClose={() => {
            setPendingAudio(null)
          }}
        />
      )}
      <WorkbenchDialog
        open={pendingImages.length > 0}
        title={`画像 ${String(pendingImages.length)} 枚をどこに入れますか`}
        size="medium"
        onClose={() => {
          setPendingImages([])
        }}
      >
        <ul className="space-y-2">
          {choices.map((choice) => (
            <li key={choice.label}>
              <Button
                disabled={busy}
                onClick={() => {
                  void place(choice.target)
                }}
              >
                {choice.label}
              </Button>
            </li>
          ))}
        </ul>
        {pendingImages.length > 1 && (
          <p className="mt-3 text-xs text-muted">
            ブランド資産は画像 1 枚です。2 枚以上なら先頭の 1 枚を使います。
          </p>
        )}
      </WorkbenchDialog>
      <WorkbenchDialog
        open={pendingVideos !== null}
        title={`動画 ${String(pendingVideos?.files.length ?? 0)} 本を Take にしますか`}
        size="medium"
        onClose={() => {
          setPendingVideos(null)
        }}
      >
        {pendingVideos !== null && videoShot === null && (
          <p role="alert" className="text-sm text-danger">
            落としたときに選んでいた Shot が見つかりません。
          </p>
        )}
        {pendingVideos !== null && videoShot !== null && (
          <FootageImportForm
            shot={videoShot}
            workspaceId={workbench.project.workspaceId}
            projectId={workbench.projectId}
            files={pendingVideos.files}
            onImported={(takes) => {
              setPendingVideos(null)
              onNotice(`動画 ${String(takes.length)} 本を Shot ${videoShot.code} の Take にしました。`)
              workbench.refresh()
            }}
          />
        )}
      </WorkbenchDialog>
    </>
  )
}
