'use client'

import type { ProjectId } from '@ixa/domain'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { cutBoundaries, type CutMark } from '@/lib/cut-marks'

export type CutSaveOutcome = {
  readonly createdCount: number
  readonly warnings: readonly string[]
}

/**
 * 区切りを Shot にする（`cut-editor.tsx` から分けた）。
 *
 * **作れたら区切りを空にさせる**（`onSaved`）。区切りを残したままだと、もう一度押せて同じ区間に Shot が重なり、
 * 書き出しが止まった（制作者 2026-10-03「Shot 重なりが指摘される」の一因）。区切りは下書きで、Shot が保存先。
 * Sequence には入れない（作る画面が無く、選択欄は中身が空だった。制作者「Sequence 項目の意味が分からない」）。
 */
export const useCutSave = (projectId: ProjectId, onSaved: () => void) => {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<CutSaveOutcome | null>(null)

  const save = async (marks: readonly CutMark[], durationSec: number): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const result = await createApiClient().createCuts(projectId, {
        boundariesSec: [...cutBoundaries(marks, durationSec)],
        sequenceId: null,
      })
      setOutcome({ createdCount: result.createdCount, warnings: result.warnings })
      onSaved()
      // 他の画面の先読み内容を捨てる。作ったのに「ありません」と出るのを防ぐ。
      router.refresh()
    } catch (caught) {
      setError(describeError(caught))
      setOutcome(null)
    } finally {
      setSaving(false)
    }
  }

  /** 区切りを触ったら、前の結果の知らせは消す。 */
  const clearOutcome = (): void => {
    setOutcome(null)
  }

  return { saving, error, outcome, save, clearOutcome }
}
