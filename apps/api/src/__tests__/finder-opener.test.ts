import { describe, expect, it, vi } from 'vitest'

/**
 * Finder で開く口（ADR-0036）。Mac の `open` だけを、シェルを通さず（execFile）に呼ぶ。
 * ファイルなら `-R`（そのファイルを選んだ状態で開く）。
 */

const calls = vi.hoisted(() => [] as { file: string; args: readonly string[] }[])
const failNext = vi.hoisted(() => ({ value: false }))
vi.mock('node:child_process', () => ({
  execFile: (file: string, args: readonly string[], callback: (error: Error | null, out: string, err: string) => void) => {
    calls.push({ file, args })
    callback(failNext.value ? new Error('open が失敗') : null, '', '')
  },
}))

const { createFinderOpener } = await import('../render-folder/finder-opener.js')

describe('createFinderOpener', () => {
  it('Mac だけ開ける', () => {
    expect(createFinderOpener('darwin').canOpen).toBe(true)
    expect(createFinderOpener('linux').canOpen).toBe(false)
  })

  it('フォルダはそのまま、ファイルは -R で選んで開く。名前は 1 つの引数のまま渡す', async () => {
    const opener = createFinderOpener('darwin')
    await opener.open({ folder: '/Users/me/Movies/ixa-video-creator/a; rm -rf ~' })
    await opener.open({ file: '/Users/me/Movies/x/$(whoami).mp4' })

    expect(calls).toEqual([
      { file: 'open', args: ['/Users/me/Movies/ixa-video-creator/a; rm -rf ~'] },
      { file: 'open', args: ['-R', '/Users/me/Movies/x/$(whoami).mp4'] },
    ])
  })

  it('開けなければ、何が起きたか分かる言葉で投げる', async () => {
    failNext.value = true
    await expect(createFinderOpener('darwin').open({ folder: '/tmp' })).rejects.toThrow('Finder を開けませんでした')
  })
})
