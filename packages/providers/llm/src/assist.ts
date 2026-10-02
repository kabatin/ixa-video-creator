import { ASSIST_FIELDS, AssistField } from '@ixa/domain'
import { z } from 'zod'
import { extractJsonText } from './claude-cli-reviewer.js'
import { excerpt } from './errors.js'
import type { TextCli, TextCliErrorCode } from './text-cli.js'

/**
 * 入力を AI が手伝う（ADR-0032 の 3 段目）。欄の横の「✦ AI」で案を 1 つ出す。**使うかは人が決める。**
 *
 * - 空の欄は、材料（作品の方針・前後の Shot・歌詞など）から考える
 * - 書いてあれば、書いた人の意図と固有名詞を残して整える
 * - どの欄がどこに効くか・どう書くかは domain の `ASSIST_FIELDS` に 1 か所
 */

/** 材料 1 件。何の材料か（見出し）と中身。中身が空なら書かない。 */
export const AssistContextLine = z.object({
  label: z.string().min(1),
  text: z.string(),
})
export type AssistContextLine = z.infer<typeof AssistContextLine>

export const MAX_ASSIST_INSTRUCTION_LENGTH = 300

export const AssistRequest = z.object({
  field: AssistField,
  /** いま欄に入っている文。空文字は「まだ書いていない」。 */
  current: z.string().max(4000),
  /** 注文（任意。「もっと静かに」など）。 */
  instruction: z.string().trim().min(1).max(MAX_ASSIST_INSTRUCTION_LENGTH).nullable(),
  context: z.array(AssistContextLine).max(40),
})
export type AssistRequest = z.infer<typeof AssistRequest>

export type AssistErrorCode = TextCliErrorCode
export type AssistOutcome =
  | { readonly ok: true; readonly text: string; readonly costUsd: number }
  | {
      readonly ok: false
      readonly error: { readonly code: AssistErrorCode; readonly message: string }
      /** 失敗しても払った分は払っている（測れなければ 0）。 */
      readonly costUsd: number
    }

export type TextAssistant = {
  readonly name: string
  readonly suggest: (request: AssistRequest) => Promise<AssistOutcome>
}

const FORMAT_RULES: Readonly<Record<(typeof ASSIST_FIELDS)[AssistField]['format'], string>> = {
  prose: '文章で書いてください。',
  short: '短い語や句で書いてください（文章にしない）。',
  tags: '読点（、）で区切った短い語の並びで書いてください（欄が読点で分けて使います）。',
}

/** 依頼をプロンプトへ組み立てる。**自由文を返させない**ため出力形式を明示する。テストのために公開する。 */
export const buildAssistPrompt = (request: AssistRequest): string => {
  const spec = ASSIST_FIELDS[request.field]
  const current = request.current.trim()
  const materials = request.context.filter((line) => line.text.trim() !== '')
  return [
    'あなたは映像作品（ミュージックビデオ・CM）の制作を手伝う脚本と美術のアシスタントです。',
    `「${spec.label}」の欄に入れる文を${current === '' ? '考えて' : '整えて'}ください。`,
    `この欄の使われ方: ${spec.purpose}`,
    `${FORMAT_RULES[spec.format]}${String(spec.maxLength)} 文字以内。日本語で。`,
    '',
    '## 作品の材料',
    ...(materials.length === 0 ? ['(まだありません)'] : materials.map((line) => `- ${line.label}: ${line.text.trim()}`)),
    '',
    '## いまの文',
    current === '' ? '(空)' : current,
    ...(current === ''
      ? []
      : ['', '書いた人の意図と固有名詞は残し、足りない具体（被写体・光・色・動き・質感）を足して整えてください。']),
    '',
    '## 注文',
    request.instruction ?? '(なし)',
    '',
    '## 出力',
    '次の JSON だけを出力してください。前後に説明文を付けないでください。',
    '{"text": 欄に入れる文}',
  ].join('\n')
}

const AssistResponse = z.object({ text: z.string().trim().min(1) })

const failure = (code: AssistErrorCode, message: string, costUsd: number): AssistOutcome => ({
  ok: false,
  error: { code, message },
  costUsd,
})

/** テキストの AI（CLI）で案を出す。Claude・Codex・Grok のどれでも同じ。 */
export const createTextCliAssistant = (cli: TextCli): TextAssistant => ({
  name: `${cli.tool}-text-assistant`,
  suggest: async (request) => {
    const parsed = AssistRequest.parse(request)
    const outcome = await cli.complete(buildAssistPrompt(parsed))
    if (!outcome.ok) return failure(outcome.code, outcome.message, outcome.costUsd)
    const raw = extractJsonText(outcome.text)
    const json = ((): unknown => {
      try {
        return JSON.parse(raw) as unknown
      } catch {
        return undefined
      }
    })()
    if (json === undefined) {
      return failure('response_not_json', `AI の返事が JSON として読めません: ${excerpt(raw)}`, outcome.costUsd)
    }
    const response = AssistResponse.safeParse(json)
    if (!response.success) {
      return failure('response_schema_violation', 'AI の返事に、欄に入れる文がありませんでした', outcome.costUsd)
    }
    return { ok: true, text: response.data.text, costUsd: outcome.costUsd }
  },
})

/**
 * お試し（AI を使わない）。入力から決まった案を返す。**本物の案ではないと分かる文にする。**
 * 「使う AI」でテキストの AI を選んでいないときに使う。
 */
export const createStubAssistant = (): TextAssistant => ({
  name: 'stub-text-assistant',
  suggest: (request) => {
    const parsed = AssistRequest.parse(request)
    const spec = ASSIST_FIELDS[parsed.field]
    const current = parsed.current.trim()
    const text =
      current === ''
        ? `（お試しの案）${spec.label}の案です。「使う AI」でテキストの AI を選ぶと、作品の材料から本物の案が出ます。`
        : `${current}（お試しで整えた案）`
    return Promise.resolve({ ok: true, text, costUsd: 0 })
  },
})
