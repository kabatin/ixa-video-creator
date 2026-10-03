import type { ProjectId, RenderJobId } from '@ixa/domain'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { createRenderFolderApi, type RenderFolderApi, type WireRenderFolderOpened } from '@/lib/render-folder-api'
import { createRequester } from '@/lib/requester'

/**
 * 書き出した動画のフォルダを Finder で開く（ADR-0036。制作者 2026-10-03「書き出し画面で生成された動画がある
 * フォルダを開く導線が欲しい」）。開く前に、まだ入っていない動画を API がフォルダへ入れる。
 *
 * 開くのは API が動いている Mac の Finder。Mac 以外で動かしているときはボタンを出さず、保存先だけ出す。
 */

export type RenderFolder = {
  /** 保存先（ホームは `~`）。読めていなければ null。 */
  readonly location: string | null
  readonly canOpen: boolean
  /** いま開いている最中か（二重に押させない）。 */
  readonly opening: boolean
  /** 開いた結果・失敗の知らせ。無ければ null。 */
  readonly notice: { readonly tone: 'info' | 'error'; readonly message: string } | null
  /** フォルダを開く。書き出しを渡すと、その動画を選んだ状態で開く。 */
  readonly open: (renderJobId?: RenderJobId) => void
}

const defaultApi = (): RenderFolderApi => createRenderFolderApi(createRequester(resolveApiBaseUrl()))

/** 開いたあとに言うこと。黙って開けたなら何も言わない（Finder が前に出れば分かる）。 */
const openedNotice = (opened: WireRenderFolderOpened): RenderFolder['notice'] => {
  if (opened.failed.length > 0) {
    return {
      tone: 'error',
      message: `${String(opened.failed.length)} 本はフォルダに入れられませんでした: ${opened.failed.map((f) => f.reason).join(' / ')}`,
    }
  }
  return opened.copied > 0
    ? { tone: 'info', message: `書き出した動画 ${String(opened.copied)} 本をフォルダに入れて開きました。` }
    : null
}

export const useRenderFolder = (projectId: ProjectId, api?: RenderFolderApi): RenderFolder => {
  const client = useMemo(() => api ?? defaultApi(), [api])
  const [place, setPlace] = useState<{ readonly location: string; readonly canOpen: boolean } | null>(null)
  const [opening, setOpening] = useState(false)
  const [notice, setNotice] = useState<RenderFolder['notice']>(null)

  useEffect(() => {
    let alive = true
    client
      .getRenderFolder(projectId)
      .then((folder) => {
        if (alive) setPlace(folder)
      })
      .catch((cause: unknown) => {
        if (alive) setNotice({ tone: 'error', message: `保存先を読めませんでした: ${describeForPerson(cause)}` })
      })
    return () => {
      alive = false
    }
  }, [client, projectId])

  const open = useCallback(
    (renderJobId?: RenderJobId) => {
      setOpening(true)
      setNotice(null)
      client
        .openRenderFolder(projectId, renderJobId)
        .then((opened) => {
          setPlace((current) => ({ location: opened.location, canOpen: current?.canOpen ?? true }))
          setNotice(openedNotice(opened))
        })
        .catch((cause: unknown) => {
          setNotice({ tone: 'error', message: `フォルダを開けませんでした: ${describeForPerson(cause)}` })
        })
        .finally(() => {
          setOpening(false)
        })
    },
    [client, projectId],
  )

  return { location: place?.location ?? null, canOpen: place?.canOpen ?? false, opening, notice, open }
}

/** 一覧の見出しの横に置く「フォルダを開く」。Finder を開けない環境では出さない。 */
export const RenderFolderButton = ({ folder }: { readonly folder: RenderFolder }) =>
  folder.canOpen ? (
    <Button size="sm" disabled={folder.opening} onClick={() => folder.open()}>
      フォルダを開く
    </Button>
  ) : null

/** 保存先（Finder を開けない環境でも出す）。 */
export const RenderFolderLocation = ({ folder }: { readonly folder: RenderFolder }) =>
  folder.location === null ? null : (
    <p className="truncate text-xs text-muted" title={folder.location}>
      {`保存先 ${folder.location}`}
    </p>
  )

export const RenderFolderNotice = ({ folder }: { readonly folder: RenderFolder }) =>
  folder.notice === null ? null : (
    <p
      role={folder.notice.tone === 'error' ? 'alert' : 'status'}
      className={`text-xs ${folder.notice.tone === 'error' ? 'text-danger' : 'text-muted'}`}
    >
      {folder.notice.message}
    </p>
  )
