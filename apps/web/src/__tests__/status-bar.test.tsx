import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatusBar } from '@/components/workbench/status-bar'
import { WireRenderJob } from '@/lib/render-api'
import { aProject } from './workbench-fixture'
import { PreferencesWrapper } from './preferences-wrapper'

/** ステータスバー（UI-WORKBENCH §10）。読み込みエラーは 1 件でもあれば必ず出す。 */

const live = { state: 'live' as const, lastEventAt: null, attempt: 0, invalidCount: 0, newTakeCount: 0 }

/** 止まっている状態。鳴っているところの表示はここを差し替えて確かめる。 */
const stopped = { currentSec: 0, playing: false, seek: null, owner: null } as const

/** 書き出しが走っていない状態。走っている表示はここを差し替えて確かめる。 */
const idleRenders = {
  jobs: [],
  active: [],
  error: null,
  note: null,
  nowMs: null,
  timeoutMs: 0,
  refresh: () => Promise.resolve(undefined),
  watchedJobId: null,
  watchJob: () => undefined,
}

beforeEach(() => {
  // 費用は取りに行かせない（失敗してもバーは出る）。
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 音量の持ち主（PreferencesRoot）の中で描く。 */
const renderWithPrefs = (ui: Parameters<typeof render>[0]) =>
  render(ui, { wrapper: PreferencesWrapper })

describe('StatusBar', () => {
  /**
   * 書き出しはダイアログを閉じても走り続ける（上限 30 分）。
   * 閉じた瞬間に「いま書き出している」がどこにも出ないと、終わったことに気づけない。
   */
  describe('走っている書き出し', () => {
    /** 状態の正は `RenderJobStatus`（queued / rendering / encoding / …）。`running` は無い。 */
    const aJob = (status: 'queued' | 'rendering', progress: number): WireRenderJob =>
      WireRenderJob.parse({
        id: '01ARZ3NDEKTSV4RRFFQ69G5FC0',
        projectId: aProject.id,
        scope: { type: 'full' },
        preset: 'master_1080p',
        status,
        progress,
        outputAssetId: null,
        error: null,
        createdAt: '2026-09-24T00:00:00.000Z',
        finishedAt: null,
      })
    const withActive = (job: ReturnType<typeof aJob>) => ({
      ...idleRenders,
      active: [job],
      jobs: [job],
    })

    it('走っていなければ出さない', () => {
      renderWithPrefs(<StatusBar project={aProject} shotCount={3} live={live} transport={stopped} renderWatch={idleRenders} loadErrors={[]} />)
      expect(screen.queryByText(/書き出し中/)).toBeNull()
    })

    it('割合が取れていれば % を出す', () => {
      renderWithPrefs(
        <StatusBar
          project={aProject}
          shotCount={3}
          live={live}
          transport={stopped}
          renderWatch={withActive(aJob('rendering', 0.42))}
          loadErrors={[]}
        />,
      )
      expect(screen.getByText(/書き出し中 42%/)).toBeTruthy()
    })

    it('割合が取れていないときは % を作らない', () => {
      renderWithPrefs(
        <StatusBar
          project={aProject}
          shotCount={3}
          live={live}
          transport={stopped}
          renderWatch={withActive(aJob('queued', 0))}
          loadErrors={[]}
        />,
      )
      expect(screen.getByText(/書き出し中/)).toBeTruthy()
      expect(screen.queryByText(/%/)).toBeNull()
    })
  })

  /**
   * 裏のタブでも鳴り続けるので、パネルを見てもどこが鳴っているか分からない。
   * 音を止める場所を探す羽目になっていた。
   */
  describe('鳴っているところ', () => {
    const playing = (owner: 'cutter' | 'monitor', sec: number) =>
      ({ currentSec: sec, playing: true, seek: null, owner }) as const

    /**
     * 再生ボタンは**止まっていても消えない。** 画面にひとつしか無いので、
     * 消すと鳴らす手段が無くなる。消えるのは「どこが鳴っているか」の名前のほう。
     */
    it('止まっているときは、どこが鳴っているかを出さない', () => {
      renderWithPrefs(<StatusBar project={aProject} shotCount={3} live={live} transport={stopped} renderWatch={idleRenders} loadErrors={[]} />)
      expect(screen.queryByText(/聴きながら切る|プレビュー/)).toBeNull()
    })

    /**
     * 再生ボタンはここには無い。**見えているプレイヤーの直下**にある
     * （`transport-bar.tsx`）。画面の最下段は再生ボタンを探す場所ではない。
     */
    it('再生ボタンはここには無い', () => {
      renderWithPrefs(<StatusBar project={aProject} shotCount={3} live={live} transport={stopped} renderWatch={idleRenders} loadErrors={[]} />)
      expect(screen.queryByRole('button', { name: '再生' })).toBeNull()
    })

    it('音量はここにひとつだけある', () => {
      renderWithPrefs(<StatusBar project={aProject} shotCount={3} live={live} transport={stopped} renderWatch={idleRenders} loadErrors={[]} />)
      expect(screen.getAllByLabelText('音量')).toHaveLength(1)
    })

    it('カッターが鳴っていればその名前と位置を出す', () => {
      renderWithPrefs(
        <StatusBar
          project={aProject}
          shotCount={3}
          live={live}
          renderWatch={idleRenders}
          transport={playing('cutter', 30)}
          loadErrors={[]}
        />,
      )
      expect(screen.getByText(/聴きながら切る/)).toBeTruthy()
    })

    it('プレビューが鳴っていればそちらを出す', () => {
      renderWithPrefs(
        <StatusBar
          project={aProject}
          shotCount={3}
          live={live}
          renderWatch={idleRenders}
          transport={playing('monitor', 5)}
          loadErrors={[]}
        />,
      )
      expect(screen.getByText(/プレビュー/)).toBeTruthy()
      expect(screen.queryByText(/聴きながら切る/)).toBeNull()
    })
  })

  it('読み込みエラーが 1 件でもあれば必ず出す', () => {
    renderWithPrefs(
      <StatusBar
        project={aProject}
        shotCount={3}
        live={live}
        transport={stopped}
        renderWatch={idleRenders}
        loadErrors={['シーケンスを読み込めませんでした: 500']}
      />,
    )
    const alert = screen.getByText(/読み込めなかった部分 1 件/)
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent('シーケンスを読み込めませんでした')
  })

  it('複数あれば件数を出し、全文は title に渡す', () => {
    renderWithPrefs(<StatusBar project={aProject} shotCount={3} live={live} transport={stopped} renderWatch={idleRenders} loadErrors={['A が読めない', 'B が読めない']} />)
    const alert = screen.getByText(/読み込めなかった部分 2 件/)
    expect(alert).toHaveAttribute('title', 'A が読めない\nB が読めない')
  })

  it('エラーが無ければ出さない', () => {
    renderWithPrefs(<StatusBar project={aProject} shotCount={3} live={live} transport={stopped} renderWatch={idleRenders} loadErrors={[]} />)
    expect(screen.queryByText(/読み込めなかった部分/)).toBeNull()
  })

  it('件数・解像度・fps を出す', () => {
    renderWithPrefs(<StatusBar project={aProject} shotCount={27} live={live} transport={stopped} renderWatch={idleRenders} loadErrors={[]} />)
    expect(screen.getByText('27 Shots')).toBeInTheDocument()
    expect(screen.getByText('1920×1080・30fps')).toBeInTheDocument()
  })

  it('Shot を読めていないときは 0 件と言わない', () => {
    renderWithPrefs(<StatusBar project={aProject} shotCount={null} live={live} transport={stopped} renderWatch={idleRenders} loadErrors={[]} />)
    expect(screen.getByText('Shot を読めていません')).toBeInTheDocument()
    expect(screen.queryByText('0 Shots')).toBeNull()
  })
})
