'use client'

import type { ProjectId } from '@ixa/domain'
import { useRouter } from 'next/navigation'
import { useContext, useMemo, useState } from 'react'
import { AssetStoreContext } from '@/components/workbench/asset-store'
import { Button } from '@/components/ui/button'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { createMusicTrimApi, type MusicTrimApi } from '@/lib/music-trim-api'
import { createRequester } from '@/lib/requester'

/**
 * 「曲を最後の Shot で切る」（制作者 2026-10-19「カットの合計尺より音楽が長いと最後に黒画面が出来てしまう。
 * カットより長い部分は楽曲をカットするとか？」）。尻の黒画面の警告に添える。
 *
 * 押すと曲の終わりが最後の Shot の終わりになり、フェードアウトが無ければ 0.5 秒入る（サーバが決める）。
 * 変える前は記録されるので「元に戻す」で戻せる。押したあとはタイムラインと楽曲の一覧を読み直す。
 */
export type TrimMusicButtonProps = {
  readonly projectId: ProjectId
  /** 切ったあと。検査結果を自分で持っている画面（書き出しの窓）が読み直す。 */
  readonly onTrimmed?: () => void
  readonly api?: MusicTrimApi
}

export const TrimMusicButton = ({ projectId, onTrimmed, api }: TrimMusicButtonProps) => {
  const router = useRouter()
  // ワークベンチの外（書き出しの単独ページ）では楽曲の一覧を持っていない。
  const assets = useContext(AssetStoreContext)
  const client = useMemo(() => api ?? createMusicTrimApi(createRequester(resolveApiBaseUrl())), [api])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const trim = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await client.trimMusicToShots(projectId)
      setMessage(
        result.editBatchId === null
          ? 'もう最後の Shot の終わりで切ってあります。'
          : '曲を最後の Shot の終わりで切りました。「元に戻す」で戻せます。',
      )
      await assets?.actions.reloadTracks()
      router.refresh()
      onTrimmed?.()
    } catch (cause) {
      setMessage(`切れませんでした: ${describeForPerson(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={busy} onClick={() => void trim()}>
        {busy ? '切っています…' : '曲を最後の Shot で切る'}
      </Button>
      {message !== null && (
        <span role="status" className="text-xs text-muted">
          {message}
        </span>
      )}
    </div>
  )
}
