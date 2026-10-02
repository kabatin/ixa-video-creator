import type { TimelineDocument } from '@ixa/domain'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProgramMonitorPlayer } from '@/components/program-monitor-player'
import { PreferencesWrapper } from './preferences-wrapper'

/**
 * 最後まで再生したとき（制作者 2026-10-02「最後まで再生させたらラストと先頭で進捗バーがジッターおこした」）。
 *
 * `@remotion/player` は既定で、終わると先頭のコマへ戻り、その位置（0 秒）を配る。聴きながら切るは最後の位置へ付いていき、
 * その報告が遅れて届くので、共有の位置が 最後 ⇄ 0 を行き来し続けた（実機で 10 秒に 40 回）。
 * 終わったら最後のコマに留まる。もう一度鳴らせば Player が自分で先頭から鳴らす（`play()` が最後のコマなら頭へ飛ぶ）。
 */

const seen = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }))

vi.mock('@remotion/player', () => ({
  Player: (props: Record<string, unknown>) => {
    seen.props = props
    return null
  },
}))
vi.mock('@ixa/render/composition', () => ({
  TimelineComposition: () => null,
  totalFrames: (durationSec: number, fps: number) => Math.max(1, Math.round(durationSec * fps)),
}))

const document: TimelineDocument = {
  version: 1,
  fps: 24,
  resolution: { width: 1920, height: 1080 },
  durationSec: 10,
  video1: [],
  transitions: [],
  clips: [],
  audio: [],
}

describe('ProgramMonitorPlayer の終わり', () => {
  it('終わっても先頭へ戻らない（最後のコマに留まる）', () => {
    render(
      <ProgramMonitorPlayer
        document={document}
        initialSec={0}
        seek={null}
        playing={false}
        onFrame={vi.fn()}
        onPlayingChange={vi.fn()}
        onFatalError={vi.fn()}
        onMediaError={vi.fn()}
      />,
      { wrapper: PreferencesWrapper },
    )

    expect(seen.props?.moveToBeginningWhenEnded).toBe(false)
  })
})
