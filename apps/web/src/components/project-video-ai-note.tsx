'use client'

import { AI_TOOLS, AiToolId } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { createAiSettingsApi } from '@/lib/ai-settings-api'
import { createModelsApi } from '@/lib/models-api'
import { videoFpsFor } from '@/lib/project-spec-choices'
import { createRequester } from '@/lib/requester'

/**
 * 「使う AI」で選んでいる動画の AI と、その AI が作る fps（制作者 2026-10-03「使う生成 AI 欄や FPS 欄もよしなに合わせて
 * 欲しい」）。以前の「使う映像生成 AI」の選択は**保存されず**、fps を埋めるだけだった。いまは実際に使う AI を見せ、
 * fps が違えば合わせるボタンを出す（素材の fps と違うと、書き出しで引き伸ばされる）。
 *
 * 読めなければ何も出さない（fps は手で選べる。案内が無いだけ）。
 */

type Known = { readonly label: string; readonly fps: readonly number[] | null }

const useVideoAi = (): Known | null => {
  const requester = useMemo(() => createRequester(resolveApiBaseUrl()), [])
  const [known, setKnown] = useState<Known | null>(null)
  useEffect(() => {
    let alive = true
    Promise.all([createAiSettingsApi(requester).getAiSettings(), createModelsApi(requester).listModels()])
      .then(([state, models]) => {
        if (!alive) return
        const tool = AiToolId.safeParse(state.settings.video)
        if (!tool.success) return
        setKnown({ label: AI_TOOLS[tool.data].label, fps: videoFpsFor(models, tool.data) })
      })
      .catch(() => {
        // 案内が出ないだけ。作成は止めない（fps は手で選べる）。
      })
    return () => {
      alive = false
    }
  }, [requester])
  return known
}

export const VideoAiFpsNote = ({
  fps,
  onUseFps,
}: {
  readonly fps: string
  readonly onUseFps: (fps: string) => void
}) => {
  const known = useVideoAi()
  if (known === null) return null
  const suggested = known.fps?.[0] ?? null
  const matches = known.fps === null || known.fps.includes(Number(fps))
  return (
    <div className="mt-2 rounded-md border border-line bg-surface-2 p-2 text-xs text-text">
      <p>{`動画を作る AI: ${known.label}`}</p>
      {known.fps !== null && (
        <p className="text-muted">{`この AI の動画は ${known.fps.join(' / ')} fps です。合わせると、書き出しで引き伸ばさずに済みます。`}</p>
      )}
      {!matches && suggested !== null && (
        <div className="mt-1.5">
          <Button size="sm" onClick={() => onUseFps(String(suggested))}>
            {`${String(suggested)} fps に合わせる`}
          </Button>
        </div>
      )}
      <p className="mt-1 text-muted">使う AI は、プロジェクトを開いてからメニューの「使う AI…」で変えられます。</p>
    </div>
  )
}
