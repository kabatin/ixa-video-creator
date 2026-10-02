'use client'

import type { ProjectId } from '@ixa/domain'
import { useEffect, useState } from 'react'
import type { ProjectConceptApi } from '@/lib/project-concept-api'

/**
 * 作品の方針のコンセプト・あらすじ（流れの帯 ② の材料。制作者 2026-10-01）。
 * サーバを読み直すたび（`epoch`）に取り直す。**読めなければ null**（帯は「分からない」と出す。空文字と混ぜない）。
 * 作品の方針で保存したら、読み直しを待たずに手元へ映す（`saved`）。
 */
export const useProjectConcept = (
  api: Pick<ProjectConceptApi, 'getConcept'>,
  projectId: ProjectId,
  epoch: number,
): { readonly concept: string | null; readonly saved: (content: string) => void } => {
  const [concept, setConcept] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .getConcept(projectId)
      .then((content) => {
        if (alive) setConcept(content)
      })
      .catch(() => {
        // 読めないことは帯が「分からない」として出す（作業は止めない）。
        if (alive) setConcept(null)
      })
    return () => {
      alive = false
    }
  }, [api, projectId, epoch])

  return { concept, saved: setConcept }
}
