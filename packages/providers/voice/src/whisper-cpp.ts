import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  VoiceProviderError,
  type CliRunner,
  type Transcriber,
  type TranscribeRequest,
  type TranscribeResult,
} from '@ixa/provider-core'
import { z } from 'zod'
import { badResponse } from './http.js'

/**
 * whisper.cpp（ADR-0038）。無料で、この Mac の中だけで聞き取る（音は外に出ない）。
 *
 * - whisper-cli は 16kHz・モノラルの WAV を受けるので、先に変換する（変換は呼び出し側が ffmpeg で渡す）
 * - `-oj` の JSON から区間（文くらいの長さ）を読む。字の時刻は返さない（区間の中は domain が拍で割り振る）
 *   日本語は 1 字が複数のトークンに割れることがあり、トークンの時刻は字の境目に合わないため使わない
 * - 寄せたい言葉（登場人物の名前など）は `--prompt` で渡す
 */

const WHO = 'whisper.cpp'
const TIMEOUT_MS = 15 * 60 * 1000

const Output = z.object({
  transcription: z.array(z.object({ offsets: z.object({ from: z.number(), to: z.number() }), text: z.string() })),
})

export type WhisperCppDeps = {
  readonly modelPath: string
  readonly runCli: CliRunner
  /** 音を 16kHz・モノラルの WAV にする。 */
  readonly convert: (inputPath: string, outputPath: string) => Promise<void>
}

export const createWhisperCppTranscriber = (deps: WhisperCppDeps): Transcriber => ({
  tool: 'whisper_cpp',
  transcribe: async (request: TranscribeRequest): Promise<TranscribeResult> => {
    const wavPath = join(request.workDir, 'whisper-input.wav')
    const outputBase = join(request.workDir, 'whisper-output')
    await deps.convert(request.audioPath, wavPath)
    const prompt = request.keyterms.filter((term) => term.trim() !== '').join('、')
    const result = await deps.runCli({
      command: 'whisper-cli',
      args: [
        '-m',
        deps.modelPath,
        '-f',
        wavPath,
        '-l',
        request.language.slice(0, 2),
        '-oj',
        '-of',
        outputBase,
        '-np',
        ...(prompt === '' ? [] : ['--prompt', prompt]),
      ],
      timeoutMs: TIMEOUT_MS,
    })
    if (result.kind !== 'completed' || result.exitCode !== 0) {
      const reason = result.kind === 'completed' ? `終了コード ${String(result.exitCode)}` : result.kind === 'not_found' ? '入っていません' : result.kind
      throw new VoiceProviderError('unavailable', `${WHO} で聞き取れませんでした（${reason}）。モデルのファイルと whisper-cli を確かめてください`, false)
    }
    let output: z.infer<typeof Output>
    try {
      output = Output.parse(JSON.parse(await readFile(`${outputBase}.json`, 'utf8')))
    } catch {
      throw badResponse(WHO)
    }
    const segments = output.transcription
      .map((segment) => ({ text: segment.text.trim(), startSec: segment.offsets.from / 1000, endSec: segment.offsets.to / 1000 }))
      .filter((segment) => segment.text !== '')
    return {
      text: segments.map((segment) => segment.text).join(''),
      chars: null,
      segments,
      costUsd: 0,
      record: { tool: 'whisper_cpp', segments: segments.length },
    }
  },
})
