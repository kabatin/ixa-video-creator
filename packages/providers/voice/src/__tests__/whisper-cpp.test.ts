import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CliInvocation, CliRunResult } from '@ixa/provider-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWhisperCppTranscriber } from '../whisper-cpp.js'

/**
 * whisper.cpp（ADR-0038。無料・この Mac の中だけ）。16kHz の WAV にしてから `whisper-cli` に聞かせ、JSON の区間を読む。
 * 実際の whisper-cli と ffmpeg は叩かない。
 */

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'voice-whisper-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** whisper-cli -oj の出力（2026-10 の whisper.cpp の形）。 */
const OUTPUT = {
  result: { language: 'ja' },
  transcription: [
    { timestamps: { from: '00:00:00,000', to: '00:00:01,500' }, offsets: { from: 0, to: 1500 }, text: ' はじめまして。' },
    { timestamps: { from: '00:00:01,500', to: '00:00:01,600' }, offsets: { from: 1500, to: 1600 }, text: ' ' },
    { timestamps: { from: '00:00:02,000', to: '00:00:03,250' }, offsets: { from: 2000, to: 3250 }, text: ' 戦子です' },
  ],
}

const setup = (result: CliRunResult = { kind: 'completed', exitCode: 0, stdout: '', stderr: '' }) => {
  const calls: CliInvocation[] = []
  const convert = vi.fn<(input: string, output: string) => Promise<void>>(() => Promise.resolve())
  const transcriber = createWhisperCppTranscriber({
    modelPath: '/models/ggml-large-v3-turbo.bin',
    convert,
    runCli: async (invocation) => {
      calls.push(invocation)
      const base = invocation.args[invocation.args.indexOf('-of') + 1]
      if (result.kind === 'completed' && result.exitCode === 0) await writeFile(`${String(base)}.json`, JSON.stringify(OUTPUT))
      return result
    },
  })
  return { transcriber, calls, convert }
}

const request = { audioPath: join('/in', 'rec.m4a'), language: 'ja', keyterms: ['戦子'], workDir: '', durationSec: 4 }

describe('createWhisperCppTranscriber', () => {
  it('16kHz の WAV にしてから whisper-cli に聞かせる（言語・JSON の出力・寄せたい言葉）', async () => {
    const { transcriber, calls, convert } = setup()

    await transcriber.transcribe({ ...request, workDir: dir })

    expect(convert).toHaveBeenCalledWith('/in/rec.m4a', join(dir, 'whisper-input.wav'))
    expect(calls[0]?.command).toBe('whisper-cli')
    expect(calls[0]?.args).toEqual([
      '-m',
      '/models/ggml-large-v3-turbo.bin',
      '-f',
      join(dir, 'whisper-input.wav'),
      '-l',
      'ja',
      '-oj',
      '-of',
      join(dir, 'whisper-output'),
      '-np',
      '--prompt',
      '戦子',
    ])
  })

  it('区間（前後の空白を落とし、空の区間は捨てる）を返す。字の時刻は返さない（費用 0）', async () => {
    const { transcriber } = setup()

    const result = await transcriber.transcribe({ ...request, workDir: dir, keyterms: [] })

    expect(result.segments).toEqual([
      { text: 'はじめまして。', startSec: 0, endSec: 1.5 },
      { text: '戦子です', startSec: 2, endSec: 3.25 },
    ])
    expect(result.text).toBe('はじめまして。戦子です')
    expect(result.chars).toBeNull()
    expect(result.costUsd).toBe(0)
  })

  it('whisper-cli が失敗したら理由のある失敗にする', async () => {
    const { transcriber } = setup({ kind: 'completed', exitCode: 2, stdout: '', stderr: 'error: failed to open model' })
    await expect(transcriber.transcribe({ ...request, workDir: dir })).rejects.toThrow(/whisper.cpp/)
  })
})
