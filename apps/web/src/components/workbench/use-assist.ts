'use client'

import type { AssistField } from '@ixa/domain'
import { useMemo } from 'react'
import type { AssistRequest } from '@/components/workbench/ui/assist-panel'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import type { AssistTarget } from '@/lib/assist-api'

/**
 * 欄の「✦ AI」の口を作る（ADR-0032 の 3 段目）。欄の種類と対象（Shot・人物・Look・ロケーション）を渡す。
 * どの AI で出すかはサーバが「使う AI」のテキストで決める。
 */
export const useAssist = (): ((field: AssistField, target?: AssistTarget) => AssistRequest) => {
  const { projectId } = useWorkbench()
  const client = useMemo(() => createApiClient(), [])
  return (field, target = {}) =>
    (current, instruction) =>
      client.assist(projectId, { field, current, instruction, ...target })
}
