import { LLM_REVIEWERS, type AiToolId } from '@ixa/domain'
import type { VisionReviewer } from '@ixa/provider-llm'

/**
 * 「使う AI」で選んだテキストの AI で判定する vision レビュア（ADR-0032。制作者 2026-10-01「自動レビューの繋ぎ」）。
 *
 * **判定するたびに選択を読む**（生成と同じ。画面で選び直したら次の 1 回から効く）。
 * Claude を選んでいれば画像を見る Claude のレビュー（契約の利用枠を使う）、それ以外はお試し
 * （入力から決まった結果を返すスタブ）。Codex・Gemini・Grok はまだ判定に使えない。
 */
export const createChosenVisionReviewer = (deps: {
  readonly textTool: () => Promise<AiToolId>
  readonly claude: VisionReviewer
  readonly stub: VisionReviewer
}): VisionReviewer => ({
  name: 'chosen-vision-reviewer',
  supports: LLM_REVIEWERS,
  review: async (request) =>
    ((await deps.textTool()) === 'claude_cli' ? deps.claude : deps.stub).review(request),
})
