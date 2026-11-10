'use client'

import type { WorkspaceId } from '@ixa/domain'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ErrorPanel } from '@/components/error-panel'
import { Button } from '@/components/ui/button'
import { describeError } from '@/lib/api-error'
import { createDemoApi } from '@/lib/demo-api'
import { formatBytes } from '@/lib/format-bytes'
import { workbenchHref } from '@/lib/workbench-url'

/**
 * 見本を開く（ADR-0067）。**開いたときは状態を読むだけ**（どのページからでもこの画面へ移らせられるので、
 * 開いただけで何十 MB も取りに行かせない）。入れるのは「見本を入れて開く」を押したときだけ。
 *
 * - 見本が無い → 「まだ用意されていません」と一覧へ戻る道
 * - もう入っている → そのままワークベンチへ移る（読むだけ）
 * - 入れられる → 題と、初めてのときに取りに行く大きさ、「見本を入れて開く」
 * - 入れている間 → 何をしているか。終わったら作品のワークベンチへ置き換えて移る（戻るボタンでこの画面に戻らない）
 * - 失敗 → 理由と「もう一度」
 *
 * 開発の strict mode は効果を 2 回走らせる。状態を読むのは 1 回だけにする（読むだけなので 2 回でも害は無い）。
 */

type DemoState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ready'; readonly title: string | null; readonly totalBytes: number | null }
  | { readonly kind: 'installing' }
  /** `retry` は「もう一度」でやり直すこと（状態を読み直すか、入れ直すか）。 */
  | { readonly kind: 'failed'; readonly message: string; readonly retry: 'check' | 'install' }

export type DemoInstallProps = { readonly workspaceId: WorkspaceId }

const BackLink = () => (
  <Link href="/" className="text-sm text-muted underline hover:text-text">
    一覧へ戻る
  </Link>
)

const Panel = ({ children }: { readonly children: ReactNode }) => (
  <div className="rounded-lg border border-line bg-surface p-6">{children}</div>
)

export const DemoInstall = ({ workspaceId }: DemoInstallProps) => {
  const router = useRouter()
  const api = useMemo(() => createDemoApi(), [])
  const [state, setState] = useState<DemoState>({ kind: 'checking' })
  const checked = useRef(false)

  const check = useCallback(async (): Promise<void> => {
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
      setState({ kind: 'ready', title: status.title, totalBytes: status.totalBytes })
    } catch (error) {
      setState({ kind: 'failed', message: describeError(error), retry: 'check' })
    }
  }, [api, router, workspaceId])

  const install = useCallback(async (): Promise<void> => {
    setState({ kind: 'installing' })
    try {
      const { project } = await api.install(workspaceId)
      router.replace(workbenchHref(project.id))
    } catch (error) {
      setState({ kind: 'failed', message: describeError(error), retry: 'install' })
    }
  }, [api, router, workspaceId])

  useEffect(() => {
    if (checked.current) return
    checked.current = true
    void check()
  }, [check])

  switch (state.kind) {
    case 'unavailable':
      return (
        <Panel>
          <p className="text-sm text-text">見本はまだ用意されていません</p>
          <p className="mt-3">
            <BackLink />
          </p>
        </Panel>
      )
    case 'ready':
      return (
        <Panel>
          {state.title !== null && <p className="text-base font-semibold text-text">{state.title}</p>}
          {state.totalBytes !== null && state.totalBytes > 0 && (
            <p className="mt-2 text-sm text-muted">
              初めてのときは、およそ {formatBytes(state.totalBytes)} を取りに行きます。終わると見本の作品が開きます。
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Button tone="primary" onClick={() => void install()}>
              見本を入れて開く
            </Button>
            <BackLink />
          </div>
        </Panel>
      )
    case 'failed':
      return (
        <ErrorPanel title="見本を入れられませんでした" message={state.message} actions={[{ href: '/', label: '一覧へ戻る' }]}>
          <Button tone="primary" onClick={() => void (state.retry === 'install' ? install() : check())}>
            もう一度
          </Button>
        </ErrorPanel>
      )
    case 'checking':
    case 'installing':
      return (
        <div role="status" className="rounded-lg border border-line bg-surface p-6">
          <p className="text-sm text-text">{state.kind === 'checking' ? '見本を確かめています…' : '見本を入れています…'}</p>
        </div>
      )
  }
}
