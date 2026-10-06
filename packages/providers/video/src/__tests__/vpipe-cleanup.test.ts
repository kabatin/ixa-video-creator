import { chmod, mkdir, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pruneLocalServerOutputs } from '../local-server/output.js'
import { createVpipeVideoProvider } from '../vpipe/provider.js'
import { createTempDir, makeSpec, removeTempDir } from './fixtures.js'
import {
  BASE_URL,
  createFetch,
  JOB_ID,
  jsonResponse,
  serverRoutes,
  SUBMIT_BODY,
  vpipeRequestFor,
} from './vpipe-fixtures.js'

/**
 * 後片付けの失敗を黙って捨てない（PR #4 レビュー #5、規約 5）。
 * 掃除や控えの失敗で生成は止めないが、権限の問題などで続くとディスクが増え続けても誰も気づけない。
 */

let outputDir = ''
beforeEach(async () => {
  outputDir = await createTempDir()
})
afterEach(async () => {
  await chmod(outputDir, 0o700).catch(() => undefined)
  await removeTempDir(outputDir)
})

const collect = () => {
  const messages: string[] = []
  return { messages, warn: (_detail: Readonly<Record<string, unknown>>, message: string) => messages.push(message) }
}

describe('後片付けの失敗', () => {
  it('古い出力を消せなければ記録する（掃除は投げない）', async () => {
    const old = join(outputDir, `${JOB_ID}.mp4`)
    await writeFile(old, 'x')
    await utimes(old, new Date(0), new Date(0))
    await chmod(outputDir, 0o500) // 消せない（書き込めない）置き場
    const { messages, warn } = collect()

    const removed = await pruneLocalServerOutputs(outputDir, Date.now(), 1_000, warn)

    expect(removed).toBe(0)
    expect(messages).toHaveLength(1)
  })

  it('まだ無い置き場は失敗ではない（記録しない）', async () => {
    const { messages, warn } = collect()

    await pruneLocalServerOutputs(join(outputDir, 'not-yet'), Date.now(), 1_000, warn)

    expect(messages).toEqual([])
  })

  it('投入の控えが書けなければ記録する（投入は通す）', async () => {
    // 控えの置き場（.jobs）をファイルにして、作れなくする
    await mkdir(outputDir, { recursive: true })
    await writeFile(join(outputDir, '.jobs'), 'not a directory')
    const { messages, warn } = collect()
    const { fetch } = createFetch(serverRoutes({ submit: () => jsonResponse(202, SUBMIT_BODY) }))
    const provider = createVpipeVideoProvider({ baseUrl: BASE_URL, outputDir, fetch, warn })

    const handle = await provider.submit(vpipeRequestFor(makeSpec({ resolution: { width: 1920, height: 1080 } })))

    expect(handle.ref).toBe(JOB_ID)
    expect(messages.some((message) => message.includes('控え'))).toBe(true)
  })
})
