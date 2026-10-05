import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CliInvocation, CliRunResult } from '@ixa/provider-core'
import { VoiceProviderError } from '@ixa/provider-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MACOS_SAY_BASE_RATE, createMacosSayVoice, parseSayVoices } from '../macos-say.js'

/**
 * Mac の声（ADR-0038）。`say` を execFile で呼ぶ（シェルを通さない）。**原稿は引数に入れず、ファイルで渡す**
 * （「-」で始まる行をオプションと読ませない・長さの上限を気にしない）。実際の `say` は叩かない。
 */

/** `say -v ?` の実物（2026-10-05、macOS 15）の形。名前に空白や括弧が入る。 */
const SAY_LIST = [
  'Eddy (日本語（日本）)    ja_JP    # こんにちは! 私の名前はEddyです。',
  'Kyoko               ja_JP    # こんにちは! 私の名前はKyokoです。',
  'Samantha            en_US    # Hello! My name is Samantha.',
].join('\n')

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'voice-say-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const completed = (exitCode = 0, stdout = ''): CliRunResult => ({ kind: 'completed', exitCode, stdout, stderr: '' })

const request = (patch = {}) => ({
  text: '-すすめ',
  model: null,
  voiceName: 'Eddy (日本語（日本）)',
  styleNote: '低めの声',
  direction: '',
  speed: 1.2,
  tuning: {},
  language: 'ja',
  outputBasePath: join(dir, 'line'),
  ...patch,
})

describe('parseSayVoices', () => {
  it('言語で絞り、名前（空白・括弧ごと）と見本の文を取る', () => {
    expect(parseSayVoices(SAY_LIST, 'ja')).toEqual([
      { id: 'Eddy (日本語（日本）)', label: 'Eddy (日本語（日本）)', note: 'こんにちは! 私の名前はEddyです。' },
      { id: 'Kyoko', label: 'Kyoko', note: 'こんにちは! 私の名前はKyokoです。' },
    ])
  })
})

describe('createMacosSayVoice', () => {
  it('原稿はファイルで渡し、AIFF に書く（声・速さを指定。原稿は引数に入れない）', async () => {
    const calls: CliInvocation[] = []
    const voice = createMacosSayVoice({
      runCli: (invocation) => {
        calls.push(invocation)
        return Promise.resolve(completed())
      },
    })

    const result = await voice.speak(request())

    expect(result).toMatchObject({ audioPath: join(dir, 'line.aiff'), charTimes: null, costUsd: 0 })
    const call = calls[0]
    expect(call?.command).toBe('say')
    expect(call?.args).toEqual([
      '-v',
      'Eddy (日本語（日本）)',
      '-r',
      String(Math.round(MACOS_SAY_BASE_RATE * 1.2)),
      '-o',
      join(dir, 'line.aiff'),
      '-f',
      join(dir, 'line.txt'),
    ])
    expect(call?.args.join(' ')).not.toContain('すすめ')
    expect(await readFile(join(dir, 'line.txt'), 'utf8')).toBe('-すすめ')
  })

  it('入っていない・失敗したら、理由のある失敗にする', async () => {
    const missing = createMacosSayVoice({ runCli: () => Promise.resolve({ kind: 'not_found', reason: 'ENOENT' }) })
    await expect(missing.speak(request())).rejects.toBeInstanceOf(VoiceProviderError)

    const failed = createMacosSayVoice({ runCli: () => Promise.resolve(completed(1)) })
    await expect(failed.speak(request())).rejects.toThrow(/Mac の声/)
  })

  it('声の一覧は `say -v ?` から', async () => {
    const voice = createMacosSayVoice({ runCli: () => Promise.resolve(completed(0, SAY_LIST)) })
    expect((await voice.listVoices('ja')).map((v) => v.id)).toEqual(['Eddy (日本語（日本）)', 'Kyoko'])
  })
})
