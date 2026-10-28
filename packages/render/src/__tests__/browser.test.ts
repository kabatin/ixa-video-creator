import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Remotion の headless Chrome の点検（ADR-0065）。**実物は取ってこない**（`ensureBrowser` を偽物にする）。 */

type Options = { readonly onBrowserDownload?: (o: { chromeMode: string }) => { onProgress: (p: { percent: number }) => void } }

const state = vi.hoisted(() => ({ installed: true, downloads: 0 }))

vi.mock('@remotion/renderer', () => ({
  ensureBrowser: (options: Options) => {
    if (state.installed) return Promise.resolve({ type: 'local-puppeteer-browser', path: '/x' })
    // 本物と同じく、無いときだけ取ってくる前に onBrowserDownload を呼ぶ。
    const hooks = options.onBrowserDownload?.({ chromeMode: 'headless-shell' })
    state.downloads += 1
    hooks?.onProgress({ percent: 0.5 })
    hooks?.onProgress({ percent: 1 })
    state.installed = true
    return Promise.resolve({ type: 'local-puppeteer-browser', path: '/x' })
  },
}))

const { fetchRemotionBrowser, remotionBrowserState } = await import('../browser.js')

beforeEach(() => {
  state.installed = true
  state.downloads = 0
})

describe('remotionBrowserState', () => {
  it('あれば ready', async () => {
    expect(await remotionBrowserState()).toBe('ready')
  })

  it('無ければ missing で、取ってこない', async () => {
    state.installed = false
    expect(await remotionBrowserState()).toBe('missing')
    expect(state.downloads).toBe(0)
  })
})

describe('fetchRemotionBrowser', () => {
  it('無ければ取ってきて、進み具合を 0〜100 で渡す', async () => {
    state.installed = false
    const seen: number[] = []
    await fetchRemotionBrowser((percent) => seen.push(percent))
    expect(state.downloads).toBe(1)
    expect(seen).toEqual([50, 100])
    expect(await remotionBrowserState()).toBe('ready')
  })
})
