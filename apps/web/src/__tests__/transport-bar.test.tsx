import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TransportBar } from '@/components/workbench/transport-bar'
import { WorkbenchContext, type WorkbenchContextValue } from '@/components/workbench/workbench-context'
import { PreferencesWrapper } from './preferences-wrapper'
import { workbenchValue } from './workbench-fixture'

/**
 * 再生の操作は**画面にひとつだけ、見えているプレイヤーの直下**（UI-WORKBENCH §7.2）。
 *
 * 経緯:
 * 1. はじめはパネルごとに再生ボタンがあり、プレビューと「聴きながら切る」を同時に開くと
 *    同じ見た目のボタンが縦に 2 つ並んだ。どちらが何を鳴らすのか区別が無い
 * 2. ステータスバーにまとめたが、**映像の道具で再生ボタンが画面の最下段にあるのは
 *    探す場所として素直ではない**（制作者の指摘）
 * 3. いまはプレイヤーの直下。出す場所は `host` が決め、**出した場所が鳴らす相手**になる
 */

const renderBar = (
  owner: 'cutter' | 'monitor',
  patch: Partial<WorkbenchContextValue> = {},
): WorkbenchContextValue => {
  const value = { ...workbenchValue(), ...patch }
  render(
    <PreferencesWrapper>
      <WorkbenchContext.Provider value={value}>
        <TransportBar owner={owner} durationSec={120} />
      </WorkbenchContext.Provider>
    </PreferencesWrapper>,
  )
  return value
}

const withHost = (host: 'cutter' | 'monitor' | null): Partial<WorkbenchContextValue> => {
  const base = workbenchValue()
  return { transportControls: { ...base.transportControls, host } }
}

describe('TransportBar', () => {
  it('操作列を持つパネルだけが出す', () => {
    renderBar('monitor', withHost('monitor'))
    expect(screen.getByRole('button', { name: '再生' })).toBeTruthy()
  })

  /** ここが二重化の歯止め。持っていないパネルは**何も**出さない。 */
  it('持っていないパネルは出さない', () => {
    renderBar('cutter', withHost('monitor'))
    expect(screen.queryByRole('button', { name: '再生' })).toBeNull()
  })

  it('鳴らせるパネルが無ければ出さない', () => {
    renderBar('monitor', withHost(null))
    expect(screen.queryByRole('button', { name: '再生' })).toBeNull()
  })

  it('押すと、出している場所が鳴る（押したものと鳴るものを食い違わせない）', () => {
    const value = renderBar('monitor', withHost('monitor'))
    screen.getByRole('button', { name: '再生' }).click()
    expect(value.transportControls.play).toHaveBeenCalledWith('monitor')
  })

  /**
   * 別のパネル（Take 比較など）が鳴っているときは ⏸ を出し、押すと止まる。
   * 以前は波形側のボタンが**自分の音**しか見ておらず、比較が鳴っていても「再生」と出ていた。
   */
  it('別のパネルが鳴っていても ⏸ を出し、押すと止まる', () => {
    const base = workbenchValue()
    const value = renderBar('cutter', {
      transportControls: { ...base.transportControls, host: 'cutter' },
      transport: { currentSec: 1, playing: true, seek: null, owner: 'compare' },
    })
    screen.getByRole('button', { name: '一時停止' }).click()
    expect(value.transportControls.pause).toHaveBeenCalled()
    expect(value.transportControls.play).not.toHaveBeenCalled()
  })

  it('別のパネルが鳴らしているときは、どこが鳴っているかを言う', () => {
    const base = workbenchValue()
    renderBar('monitor', {
      transportControls: { ...base.transportControls, host: 'monitor' },
      transport: { currentSec: 3, playing: true, seek: null, owner: 'cutter' },
    })
    expect(screen.getByText(/聴きながら切る が再生中/)).toBeTruthy()
  })

  it('位置と尺を出す', () => {
    const base = workbenchValue()
    renderBar('monitor', {
      transportControls: { ...base.transportControls, host: 'monitor' },
      transport: { currentSec: 65.5, playing: false, seek: null, owner: null },
    })
    expect(screen.getByText(/1:05\.50/)).toBeTruthy()
    expect(screen.getByText(/2:00\.00/)).toBeTruthy()
  })
})
