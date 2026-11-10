'use client'

import type { WorkspaceId } from '@ixa/domain'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ErrorPanel } from '@/components/error-panel'
import { Button } from '@/components/ui/button'
import { describeError } from '@/lib/api-error'
import { createDemoApi } from '@/lib/demo-api'
import { formatBytes } from '@/lib/format-bytes'
import { workbenchHref } from '@/lib/workbench-url'

/**
 * 見本を開く（ADR-0067）。開いたら状態を見て、見本があれば入れ、入れ終えたらその作品のワークベンチへ移る
 * （戻るボタンでこの画面に戻らないよう、履歴は置き換える）。
 *
 * - 見本が無い → 「まだ用意されていません」と一覧へ戻る道
 * - 入れている間 → 何をしているかと、初めてのときに取りに行く大きさ
 * - 失敗 → 理由と「もう一度」
 *
 * **開発の strict mode は効果を 2 回走らせる。** 始めるのは 1 回だけにする（2 度目の効果は何もしない）。
 * 2 度押し・別の画面と重なっても、API が同じ作品を返す（作品は 1 つ）。
 */

type DemoState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'installing'; readonly totalBytes: number | null }
  | { readonly kind: 'failed'; readonly message: string }

export type DemoInstallProps = { readonly workspaceId: WorkspaceId }

const BackLink = () => (
  <Link href="/" className="text-sm text-muted underline hover:text-text">
    一覧へ戻る
  </Link>
)

export const DemoInstall = ({ workspaceId }: DemoInstallProps) => {
  const router = useRouter()
  const api = useMemo(() => createDemoApi(), [])
  const [state, setState] = useState<DemoState>({ kind: 'checking' })
  const started = useRef(false)

  const run = useCallback(async (): Promise<void> => {
    setState({ kind: 'checking' })
    try {
      const status = await api.getStatus(workspaceId)
      if (!status.available) {
        setState({ kind: 'unavailable' })
        return
      }
      // もう入っていれば、取りに行かずにそこへ移る。
      if (status.project !== null) {
        router.replace(workbenchHref(status.project.id))
        return
      }
      setState({ kind: 'installing', totalBytes: status.totalBytes })
      const { project } = await api.install(workspaceId)
      router.replace(workbenchHref(project.id))
    } catch (error) {
      setState({ kind: 'failed', message: describeError(error) })
    }
  }, [api, router, workspaceId])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void run()
  }, [run])

  switch (state.kind) {
    case 'unavailable':
      return (
        <div className="rounded-lg border border-line bg-surface p-6">
          <p className="text-sm text-text">見本はまだ用意されていません</p>
          <p className="mt-3">
            <BackLink />
          </p>
        </div>
      )
    case 'failed':
      return (
        <ErrorPanel title="見本を入れられませんでした" message={state.message} actions={[{ href: '/', label: '一覧へ戻る' }]}>
          <Button tone="primary" onClick={() => void run()}>
            もう一度
          </Button>
        </ErrorPanel>
      )
    case 'checking':
    case 'installing':
      return (
        <div role="status" className="rounded-lg border border-line bg-surface p-6">
          <p className="text-sm text-text">{state.kind === 'checking' ? '見本を確かめています…' : '見本を入れています…'}</p>
          {state.kind === 'installing' && state.totalBytes !== null && state.totalBytes > 0 && (
            <p className="mt-2 text-sm text-muted">
              初めてのときは、およそ {formatBytes(state.totalBytes)} を取りに行きます。終わると見本の作品が開きます。
            </p>
          )}
        </div>
      )
  }
}
