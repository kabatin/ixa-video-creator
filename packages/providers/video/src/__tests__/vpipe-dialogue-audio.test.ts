import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ShotGenerationSpec } from '@ixa/domain'
import type { ProviderJobStatus } from '@ixa/provider-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildVpipeBody } from '../vpipe/request.js'
import { createTempDir, makeSpec, removeTempDir } from './fixtures.js'
import {
  bytesResponse,
  createFetch,
  jsonResponse,
  makeVpipeProvider,
  MP4_BYTES,
  OUTPUT_URL,
  serverRoutes,
  SUBMIT_BODY,
  SUCCEEDED_JOB,
  vpipeRequestFor,
  type Handler,
} from './vpipe-fixtures.js'

/**
 * セリフのある Shot だけ音付きで頼む（ADR-0059）。**無い Shot の本文は 1 バイトも変えない**
 * （`vpipe-request.test.ts` と `vpipe-provider.test.ts` のゴールデンがそのまま通ること）。
 */

const spoken = (): ShotGenerationSpec => {
  const base = makeSpec({ resolution: { width: 1920, height: 1080 } })
  return {
    ...base,
    promptParts: {
      ...base.promptParts,
      dialogue: {
        lines: [{
          speakerTag: 'S2', speechName: 'The cat', voiceDescription: "a soft, sly, teasing young woman's voice",
          text: 'ねえ、ネズミくん。', offscreen: false,
        }],
        onScreen: [{ speakerTag: 'S2', speechName: 'The cat' }],
      },
    },
  }
}

const body = (spec: ShotGenerationSpec) =>
  buildVpipeBody({ spec, quality: 'standard', frames: 107, startImage: null, hasStartImage: false, hasEndImage: false })

describe('本文の audio', () => {
  it('セリフのある Shot だけ audio: true を付ける', () => {
    expect(body(spoken()).audio).toBe(true)
    expect(body(spoken()).prompt).toContain('<d>[Japanese] ねえ、ネズミくん。</d>')
  })

  it('セリフの無い Shot はキーごと付けない', () => {
    expect('audio' in body(makeSpec())).toBe(false)
  })
})

describe('記録の audio と版', () => {
  let outputDir = ''
  beforeEach(async () => {
    outputDir = await createTempDir()
  })
  afterEach(async () => {
    await removeTempDir(outputDir)
  })

  const handler: Handler = serverRoutes({
    submit: (url, init) =>
      init.method === 'POST'
        ? jsonResponse(202, SUBMIT_BODY)
        : url === OUTPUT_URL
          ? bytesResponse(MP4_BYTES, 'video/mp4')
          : jsonResponse(200, SUCCEEDED_JOB),
  })

  const run = async (spec: ShotGenerationSpec, options: { loseNote?: boolean } = {}) => {
    const { calls, fetch } = createFetch(handler)
    const provider = makeVpipeProvider(fetch, outputDir)
    const handle = await provider.submit(vpipeRequestFor(spec))
    // 控えが消えた（書けなかった・掃除された）場合
    if (options.loseNote === true) await rm(join(outputDir, '.jobs'), { recursive: true, force: true })
    const status: ProviderJobStatus = await provider.poll(handle)
    if (status.state !== 'succeeded') throw new Error('成功していない')
    const posted = JSON.parse(calls.find((call) => call.method === 'POST')?.body ?? '{}') as Record<string, unknown>
    return { raw: status.raw, posted }
  }

  it('セリフのある Shot は、頼んだ audio: true と v4 の版を残す', async () => {
    const { raw, posted } = await run(spoken())
    expect(posted.audio).toBe(true)
    expect(raw).toMatchObject({ audio: true, promptFormat: 'h3-official-v4-dialogue' })
  })

  it('セリフの無い Shot は今まで通り audio: false と v3', async () => {
    const { raw, posted } = await run(makeSpec({ resolution: { width: 1920, height: 1080 } }))
    expect('audio' in posted).toBe(false)
    expect(raw).toMatchObject({ audio: false, promptFormat: 'h3-official-v3' })
  })

  /** 控えが無ければ版は分からない。v3 と書くと、セリフの Take を v3 で組み直してしまう（推測で埋めない）。 */
  it('控えが無ければ、版を推測せず null にする', async () => {
    const { raw } = await run(spoken(), { loseNote: true })
    expect(raw).toMatchObject({ promptFormat: null })
  })
})
