'use client'

import type { ProjectId } from '@ixa/domain'
import { useRouter } from 'next/navigation'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { ProjectDuplicateForm } from '@/components/project-duplicate-form'
import { ContextMenuHost, useContextMenuHost } from '@/components/workbench/ui/context-menu'
import { useContextMenuTrigger } from '@/components/workbench/use-context-menu'
import { WorkbenchDialog } from '@/components/workbench/workbench-dialog'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { createLibraryClient } from '@/lib/library-api'
import { projectDeleteConfirmMessage } from '@/lib/project-delete-wording'
import { createProjectDuplicateApi, type ProjectDuplicateApi } from '@/lib/project-duplicate-api'
import { createRequester } from '@/lib/requester'
import { workbenchHref } from '@/lib/workbench-url'

/**
 * 作品一覧から複製・削除する（制作者 2026-10-04「プロジェクト一覧でプロジェクト削除出来るようにしてほしい。複製もプロジェクト一覧からも
 * 出来るといい」）。カードの「…」と右クリックで同じメニューを出す。**カードを押したときの行き先（ワークベンチ）は 1 つのまま。**
 *
 * メニュー・確認はワークベンチの右クリックと同じ部品（`ContextMenuHost`）。複製の画面はワークベンチと同じ `ProjectDuplicateForm`。
 */

export type ProjectListActionsApi = {
  readonly deleteProject: (projectId: ProjectId) => Promise<void>
} & ProjectDuplicateApi

/** カードが知っていればよいこと。 */
export type ProjectCardTarget = { readonly id: ProjectId; readonly name: string }

type Actions = {
  readonly openMenu: (project: ProjectCardTarget, at: { readonly x: number; readonly y: number }, origin: HTMLElement) => void
}

const ActionsContext = createContext<Actions | null>(null)

const defaultApi = (): ProjectListActionsApi => {
  const base = resolveApiBaseUrl()
  return {
    deleteProject: (projectId) => createLibraryClient(base).deleteProject(projectId),
    ...createProjectDuplicateApi(createRequester(base)),
  }
}

const Inner = ({ api, children }: { readonly api: ProjectListActionsApi; readonly children: ReactNode }) => {
  const host = useContextMenuHost()
  const router = useRouter()
  const [duplicating, setDuplicating] = useState<ProjectCardTarget | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const actions = useMemo<Actions>(
    () => ({
      openMenu: (project, at, origin) => {
        host.open({
          label: `${project.name} の操作`,
          at,
          origin,
          items: [
            {
              kind: 'item',
              id: 'duplicate',
              label: '複製…',
              disabledReason: null,
              run: () => {
                setNotice(null)
                setDuplicating(project)
              },
            },
            { kind: 'separator' },
            {
              kind: 'item',
              id: 'delete',
              label: '削除…',
              disabledReason: null,
              confirm: projectDeleteConfirmMessage(project.name),
              confirmLabel: '削除する',
              run: async () => {
                await api.deleteProject(project.id)
                setNotice(`「${project.name}」を削除しました`)
                router.refresh()
              },
            },
          ],
        })
      },
    }),
    [api, host, router],
  )

  return (
    <ActionsContext.Provider value={actions}>
      {notice !== null && (
        <p role="status" className="mb-3 rounded border border-line bg-surface px-3 py-2 text-sm text-text">
          {notice}
        </p>
      )}
      {children}
      <WorkbenchDialog
        open={duplicating !== null}
        title="プロジェクトを複製"
        size="medium"
        onClose={() => setDuplicating(null)}
      >
        {duplicating !== null && (
          <ProjectDuplicateForm
            source={duplicating}
            api={api}
            onOpen={(projectId) => {
              setDuplicating(null)
              router.push(workbenchHref(projectId))
            }}
            onCancel={() => setDuplicating(null)}
          />
        )}
      </WorkbenchDialog>
    </ActionsContext.Provider>
  )
}

/** 一覧を包む。メニュー・確認・複製の画面・知らせを持つ。 */
export const ProjectListActions = ({ api, children }: { readonly api?: ProjectListActionsApi; readonly children: ReactNode }) => {
  const client = useMemo(() => api ?? defaultApi(), [api])
  return (
    <ContextMenuHost>
      <Inner api={client}>{children}</Inner>
    </ContextMenuHost>
  )
}

/**
 * カードの枠。右クリック（長押し・Shift+F10）と右下の「…」（右上は表紙の絵に重なる）でメニューを出す。
 * 中身（ワークベンチへのリンク）はそのまま受け取る。「…」はリンクの外に置く（リンクの中にボタンを入れない）。
 */
export const ProjectCardFrame = ({ project, children }: { readonly project: ProjectCardTarget; readonly children: ReactNode }) => {
  const actions = useContext(ActionsContext)
  const trigger = useContextMenuTrigger<ProjectCardTarget>((target, at, origin) => actions?.openMenu(target, at, origin))
  return (
    <li
      {...(actions === null ? {} : trigger(project))}
      className="relative rounded-lg border border-line bg-surface shadow-sm transition hover:border-accent/60 hover:shadow-md"
    >
      {children}
      {actions !== null && (
        <button
          type="button"
          aria-label={`${project.name} の操作`}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            actions.openMenu(project, { x: rect.left, y: rect.bottom }, event.currentTarget)
          }}
          className="absolute bottom-3 right-3 z-10 rounded-md border border-line bg-surface/90 px-2 py-0.5 text-sm text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          …
        </button>
      )}
    </li>
  )
}
