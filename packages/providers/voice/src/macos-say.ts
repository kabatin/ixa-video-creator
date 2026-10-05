import { writeFile } from 'node:fs/promises'
import {
  VoiceProviderError,
  type CliRunner,
  type CliRunResult,
  type SpeakRequest,
  type SpeakResult,
  type VoiceAdapter,
  type VoiceOption,
} from '@ixa/provider-core'

/**
 * Mac の声（ADR-0038）。`say` で読み、AIFF に書く。無料でこの Mac の中だけで動く（原稿は外に出ない）。
 *
 * - execFile で呼ぶ（シェルを通さない）。**原稿は引数に入れず、ファイルで渡す**（「-」で始まる行をオプションと読ませない）
 * - 声のイメージ・演出は使えない（機械的な声）。間や長さを決める仮のナレーション向き
 * - 字の時刻は返さない（要るときは文字起こしで取る）
 */

/** 速さ 1 のときの読む速さ（1 分あたりの語数。say の既定に近い値）。 */
export const MACOS_SAY_BASE_RATE = 180
const SPEAK_TIMEOUT_MS = 60_000
const LIST_TIMEOUT_MS = 5_000

const LINE = /^(.+?)\s+([a-z]{2,3}_[A-Z0-9]{2,3})\s+#\s?(.*)$/u

/** `say -v ?` の一覧から、その言語（ja など）の声を取る。 */
/**
 * ナレーションに向く声（人の声に近い標準の声）。一覧の先に並べる（名前だけで声を作ると、一覧の最初の声になる）。
 * 一覧の並びのままだと、Eddy などの合成音声風の声が先に来る。
 */
const PREFERRED_VOICES: readonly string[] = ['Kyoko', 'Otoya']

const preferredRank = (id: string): number => {
  const index = PREFERRED_VOICES.indexOf(id)
  return index === -1 ? PREFERRED_VOICES.length : index
}

export const parseSayVoices = (stdout: string, language: string): readonly VoiceOption[] =>
  stdout
    .split('\n')
    .flatMap((line) => {
      const match = LINE.exec(line.trim())
      if (match === null) return []
      const [, name, locale, sample] = match
      if (name === undefined || locale === undefined || !locale.startsWith(`${language.slice(0, 2)}_`)) return []
      return [{ id: name.trim(), label: name.trim(), note: sample?.trim() === '' ? null : (sample?.trim() ?? null) }]
    })
    // 並べ替えは安定（同じ順位の声は一覧の並びのまま）。
    .sort((a, b) => preferredRank(a.id) - preferredRank(b.id))

const failure = (result: CliRunResult): VoiceProviderError => {
  switch (result.kind) {
    case 'not_found':
      return new VoiceProviderError('unavailable', 'Mac の声（say）が見つかりません。この Mac では使えません', false)
    case 'timeout':
      return new VoiceProviderError('unavailable', 'Mac の声が時間内に読み終わりませんでした', true)
    case 'spawn_failed':
      return new VoiceProviderError('unavailable', `Mac の声を起動できませんでした（${result.reason}）`, true)
    case 'completed':
      return new VoiceProviderError('bad_request', `Mac の声で読めませんでした（終了コード ${String(result.exitCode)}）。声の種類を確かめてください`, false)
  }
}

export const createMacosSayVoice = (deps: { readonly runCli: CliRunner }): VoiceAdapter => ({
  tool: 'macos_say',
  models: [],
  listVoices: async (language) => {
    const result = await deps.runCli({ command: 'say', args: ['-v', '?'], timeoutMs: LIST_TIMEOUT_MS })
    if (result.kind !== 'completed' || result.exitCode !== 0) throw failure(result)
    return parseSayVoices(result.stdout, language)
  },
  speak: async (request: SpeakRequest): Promise<SpeakResult> => {
    const textPath = `${request.outputBasePath}.txt`
    const audioPath = `${request.outputBasePath}.aiff`
    await writeFile(textPath, request.text, 'utf8')
    const rate = Math.round(MACOS_SAY_BASE_RATE * request.speed)
    const result = await deps.runCli({
      command: 'say',
      args: ['-v', request.voiceName, '-r', String(rate), '-o', audioPath, '-f', textPath],
      timeoutMs: SPEAK_TIMEOUT_MS,
    })
    if (result.kind !== 'completed' || result.exitCode !== 0) throw failure(result)
    return { audioPath, charTimes: null, costUsd: 0, record: { tool: 'macos_say', voice: request.voiceName, rate } }
  },
})
