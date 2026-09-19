'use client'

import { useEffect, useRef, useState } from 'react'
import { useAssets } from '@/components/workbench/asset-store'
import {
  acceptsImages,
  useImageAttach,
  type ImageTarget,
} from '@/components/workbench/use-image-attach'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { WorkbenchDialog } from '@/components/workbench/workbench-dialog'
import { Button } from '@/components/ui/button'
import { describeForPerson } from '@/lib/api-error'
import { ASSET_DRAG_TYPE, droppedFileKind } from '@/lib/asset-actions'
import { INSPECTED_LABELS } from '@/lib/workbench-selection'

/**
 * ファイルを落とせば入る（UI-WORKBENCH-2 §4.5 / P8）。
 *
 * - 音声 → 楽曲として登録し、解析を始める
 * - 画像 → 行き先を 1 回だけ聞く（選んでいる素材 / 新しいロケーション / 新しいブランド資産）
 * - 素材ビューアや Shot のカードの上に落とした場合は、そちらが先に受けて止める（ここへ来ない）
 *
 * 「ファイルを取り込む…」（メニュー）はここのファイル選択を開く。
 */
export const FileIntake = ({
  onNotice,
  registerOpener,
}: {
  readonly onNotice: (message: string) => void
  readonly registerOpener: (open: () => void) => void
}) => {
  const workbench = useWorkbench()
  const { actions } = useAssets()
  const attach = useImageAttach()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [pendingImages, setPendingImages] = useState<readonly File[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    registerOpener(() => {
      input.current?.click()
    })
  }, [registerOpener])

  const intake = async (files: readonly File[]): Promise<void> => {
    const audio = files.filter((file) => droppedFileKind(file) === 'audio')
    const images = files.filter((file) => droppedFileKind(file) === 'image')
    const others = files.length - audio.length - images.length
    if (others > 0)
      onNotice(`${String(others)} 件は取り込めない種類のファイルでした（音声と画像だけ受けます）。`)
    for (const file of audio) {
      try {
        const track = await actions.addTrackFromFile(file)
        workbench.inspect({ kind: 'track', id: track.id })
        onNotice(`「${track.title}」を楽曲として登録し、解析を始めました。`)
      } catch (cause) {
        onNotice(`${file.name} を登録できませんでした: ${describeForPerson(cause)}`)
      }
    }
    if (images.length > 0) setPendingImages(images)
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
      if (!hasFiles(event) || event.defaultPrevented) return
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
      onNotice(`画像 ${String(pendingImages.length)} 枚を取り込みました。`)
      setPendingImages([])
    } catch (cause) {
      onNotice(`画像を取り込めませんでした: ${describeForPerson(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  const current = workbench.inspected
  const choices: readonly { readonly label: string; readonly target: ImageTarget }[] = [
    ...(acceptsImages(current)
      ? [{ label: `いま選んでいる${INSPECTED_LABELS[current.kind]}に入れる`, target: current }]
      : []),
    { label: '新しいロケーションの参照画像にする', target: { kind: 'new-location' } },
    { label: '新しいブランド資産（ロゴ）にする', target: { kind: 'new-brand-asset' } },
  ]

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept="audio/*,image/*"
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
            落とすと取り込みます（音声 → 楽曲、画像 → 行き先を選ぶ）
          </p>
        </div>
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
    </>
  )
}
