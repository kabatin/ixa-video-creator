'use client'

import type { Project } from '@ixa/domain'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { FieldError } from '@/components/form/field-error'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { createLibraryClient } from '@/lib/library-api'
import { PROJECT_DELETE_LOSSES, PROJECT_DELETE_NOTE, projectDeleteHeadline } from '@/lib/project-delete-wording'
import { WORDING } from '@/lib/wording'

/**
 * プロジェクトの削除。**取り返しがつかないので、プロジェクト設定の一番下に置く**（設定の保存と混ぜない）。
 * 消したら一覧へ戻る。
 */
export const ProjectDeleteSection = ({ project }: { readonly project: Project }) => {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const remove = async (): Promise<void> => {
    setError(undefined)
    setBusy(true)
    try {
      await createLibraryClient(resolveApiBaseUrl()).deleteProject(project.id)
      router.push('/')
      router.refresh()
    } catch (cause) {
      setError(`削除できませんでした: ${describeError(cause)}`)
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border border-danger/40 bg-surface p-6 shadow-sm">
      <h2 className="text-base font-semibold text-danger">プロジェクトの削除</h2>
      <p className="mt-2 text-sm text-text">
        このプロジェクトに紐づくものが、すべて画面から辿れなくなります。
      </p>
      <div className="mt-4">
        <ConfirmButton
          label={`${WORDING.delete}（プロジェクト）`}
          message={projectDeleteHeadline(project.name)}
          confirmLabel="削除する"
          disabled={busy}
          onConfirm={() => {
            void remove()
          }}
        >
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-danger">
            {PROJECT_DELETE_LOSSES.map((loss) => (
              <li key={loss}>{loss}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-danger">{PROJECT_DELETE_NOTE}</p>
        </ConfirmButton>
      </div>
      <FieldError id="project-delete-error" message={error} />
    </section>
  )
}
