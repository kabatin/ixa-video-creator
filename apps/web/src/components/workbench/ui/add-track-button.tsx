'use client'

import { useRef, useState } from 'react'
import { useAssets } from '@/components/workbench/asset-store'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { GUIDE_TO_CONCEPT_NOTICES, useGuideToConcept } from '@/components/workbench/workflow-context'
import { Button } from '@/components/ui/button'
import { describeForPerson } from '@/lib/api-error'

/**
 * 「楽曲を登録」（UI-WORKBENCH-2 §4.4）。**ダイアログを開かない。** ファイルを選べば登録して解析が始まり、
 * 登録した楽曲をインスペクターで開く。画面へ音声ファイルを落としても同じことが起きる。
 */
export const AddTrackButton = ({ label = '楽曲を登録' }: { readonly label?: string }) => {
  const { actions } = useAssets()
  const workbench = useWorkbench()
  const guideToConcept = useGuideToConcept()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-col items-center gap-1">
      <Button tone="primary" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'アップロード中…' : label}
      </Button>
      <p className="text-xs text-muted">音声ファイルを画面に落としても登録できます。</p>
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept="audio/*"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file === undefined) return
          setBusy(true)
          setError(null)
          actions
            .addTrackFromFile(file)
            .then((track) => {
              // 作品の方針がまだなら方針を開く（次にやること）。済んでいれば登録した楽曲を見せる。
              if (!guideToConcept(GUIDE_TO_CONCEPT_NOTICES.registered(track.title))) {
                workbench.inspect({ kind: 'track', id: track.id })
              }
            })
            .catch((cause: unknown) => {
              setError(`登録できませんでした: ${describeForPerson(cause)}`)
            })
            .finally(() => {
              setBusy(false)
            })
        }}
      />
    </div>
  )
}
