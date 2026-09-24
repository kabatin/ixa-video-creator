import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatusBar } from '@/components/workbench/status-bar'
import { aProject } from './workbench-fixture'

/** ステータスバー（UI-WORKBENCH §10）。読み込みエラーは 1 件でもあれば必ず出す。 */

const live = { state: 'live' as const, lastEventAt: null, attempt: 0, invalidCount: 0, newTakeCount: 0 }

/** 止まっている状態。鳴っているところの表示はここを差し替えて確かめる。 */
const stopped = { currentSec: 0, playing: false, seek: null, owner: null } as const

beforeEach(() => {
  // 費用は取りに行かせない（失敗してもバーは出る）。
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('StatusBar', () => {
  /**
   * 裏のタブでも鳴り続けるので、パネルを見てもどこが鳴っているか分からない。
   * 音を止める場所を探す羽目になっていた。
   */
  describe('鳴っているところ', () => {
    const playing = (owner: 'cutter' | 'monitor', sec: number) =>
      ({ currentSec: sec, playing: true, seek: null, owner }) as const

    it('止まっているときは出さない', () => {
      render(<StatusBar project={aProject} shotCount={3} live={live} transport={stopped} loadErrors={[]} />)
      expect(screen.queryByText(/▶/)).toBeNull()
    })

    it('カッターが鳴っていればその名前と位置を出す', () => {
      render(
        <StatusBar
          project={aProject}
          shotCount={3}
          live={live}
          transport={playing('cutter', 30)}
          loadErrors={[]}
        />,
      )
      expect(screen.getByText(/聴きながら切る/)).toBeTruthy()
    })

    it('プレビューが鳴っていればそちらを出す', () => {
      render(
        <StatusBar
          project={aProject}
          shotCount={3}
          live={live}
          transport={playing('monitor', 5)}
          loadErrors={[]}
        />,
      )
      expect(screen.getByText(/プレビュー/)).toBeTruthy()
      expect(screen.queryByText(/聴きながら切る/)).toBeNull()
    })
  })

  it('読み込みエラーが 1 件でもあれば必ず出す', () => {
    render(
      <StatusBar
        project={aProject}
        shotCount={3}
        live={live}
        transport={stopped}
        loadErrors={['シーケンスを読み込めませんでした: 500']}
      />,
    )
    const alert = screen.getByText(/読み込めなかった部分 1 件/)
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent('シーケンスを読み込めませんでした')
  })

  it('複数あれば件数を出し、全文は title に渡す', () => {
    render(<StatusBar project={aProject} shotCount={3} live={live} transport={stopped} loadErrors={['A が読めない', 'B が読めない']} />)
    const alert = screen.getByText(/読み込めなかった部分 2 件/)
    expect(alert).toHaveAttribute('title', 'A が読めない\nB が読めない')
  })

  it('エラーが無ければ出さない', () => {
    render(<StatusBar project={aProject} shotCount={3} live={live} transport={stopped} loadErrors={[]} />)
    expect(screen.queryByText(/読み込めなかった部分/)).toBeNull()
  })

  it('件数・解像度・fps を出す', () => {
    render(<StatusBar project={aProject} shotCount={27} live={live} transport={stopped} loadErrors={[]} />)
    expect(screen.getByText('27 Shots')).toBeInTheDocument()
    expect(screen.getByText('1920×1080・30fps')).toBeInTheDocument()
  })

  it('Shot を読めていないときは 0 件と言わない', () => {
    render(<StatusBar project={aProject} shotCount={null} live={live} transport={stopped} loadErrors={[]} />)
    expect(screen.getByText('Shot を読めていません')).toBeInTheDocument()
    expect(screen.queryByText('0 Shots')).toBeNull()
  })
})
