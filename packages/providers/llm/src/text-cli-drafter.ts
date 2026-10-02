import { extractJsonText } from './claude-cli-reviewer.js'
import { buildDraftPrompt } from './claude-cli-drafter.js'
import { excerpt } from './errors.js'
import {
  StoryboardDraftRequest,
  StoryboardDraftResponse,
  checkDraftedShotIds,
  type StoryboardDraftOutcome,
  type StoryboardDrafter,
} from './storyboard-port.js'
import type { TextCli } from './text-cli.js'

/**
 * 絵コンテの案を、Claude 以外のテキストの AI（Codex・Grok）でも作る（ADR-0032 の 2・4 段目）。
 *
 * プロンプト（`buildDraftPrompt`）と確かめ方（応答の形・頼んだ Shot との突き合わせ）は Claude と同じ。
 * CLI の呼び方の違いは `text-cli.ts` に閉じている。失敗は投げずに値で返す（run に理由を残すため）。
 */
export const createTextCliStoryboardDrafter = (cli: TextCli): StoryboardDrafter => ({
  name: `${cli.tool}-cli-storyboard-drafter`,
  draft: async (request): Promise<StoryboardDraftOutcome> => {
    const parsed = StoryboardDraftRequest.parse(request)
    const outcome = await cli.complete(buildDraftPrompt(parsed))
    if (!outcome.ok) {
      return { ok: false, costUsd: outcome.costUsd, error: { code: outcome.code, message: outcome.message } }
    }
    const fail = (code: 'response_not_json' | 'response_schema_violation', message: string): StoryboardDraftOutcome => ({
      ok: false,
      costUsd: outcome.costUsd,
      error: { code, message },
    })

    const raw = extractJsonText(outcome.text)
    const json = ((): unknown => {
      try {
        return JSON.parse(raw) as unknown
      } catch {
        return undefined
      }
    })()
    if (json === undefined) return fail('response_not_json', `AI の返事が JSON として読めません: ${excerpt(raw)}`)
    const response = StoryboardDraftResponse.safeParse(json)
    if (!response.success) return fail('response_schema_violation', 'AI の返事の形が絵コンテの案と違います')

    // 知らない shotId も、足りない shotId も落とす（黙って捨てると、頼んだ件数との違いが失敗と区別できない）。
    const mismatch = checkDraftedShotIds(
      parsed.shots.map((shot) => shot.id),
      response.data.items.map((item) => item.shotId),
    )
    if (mismatch !== null) {
      return { ok: false, costUsd: outcome.costUsd, error: { code: mismatch.code, message: mismatch.message } }
    }
    return { ok: true, items: response.data.items, costUsd: outcome.costUsd }
  },
})
