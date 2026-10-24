import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from '@/lib/copy-text'

/**
 * http（LAN）で開くと `navigator.clipboard` は無い。以前は `navigator.clipboard.writeText` を直に呼び、
 * 鍵の「写す」を押すとエラーになった（制作者 2026-10-24）。
 */
describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('クリップボードの口があれば、それで書く', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await copyText('abc')
    expect(writeText).toHaveBeenCalledWith('abc')
  })

  it('口が無い（http）ときは、選んでコピーする古い手で書く', async () => {
    vi.stubGlobal('navigator', {})
    const exec = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    await copyText('abc')
    expect(exec).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('口が断ったときも、古い手で書く', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    const exec = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    await copyText('abc')
    expect(exec).toHaveBeenCalledWith('copy')
  })

  it('どちらでも書けなければ失敗を返す', async () => {
    vi.stubGlobal('navigator', {})
    Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(false), configurable: true })
    await expect(copyText('abc')).rejects.toThrow('コピーできませんでした')
  })
})
