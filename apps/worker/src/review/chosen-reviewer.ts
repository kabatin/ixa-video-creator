import { LLM_REVIEWERS, aiCheckGate, type AiSettings } from '@ixa/domain'
import type { VisionReviewer } from '@ixa/provider-llm'

/**
 * 「使う AI」で選んだテキストの AI で判定する vision レビュア（ADR-0032。制作者 2026-10-01「自動レビューの繋ぎ」）。
 *
 * **判定するたびに選択を読む**（生成と同じ。画面で選び直したら次の 1 回から効く）。
 * 動画のチェックを入れていて（ADR-0066。既定は切る）、Claude を選んでいれば画像を見る Claude のレビュー
 * （契約の利用枠を使う）。それ以外はお試し（入力から決まった結果を返すスタブ。費用 0）。
 * Codex・Gemini・Grok はまだ判定に使えない。決まった規則のレビュアはここを通らない。
 */
export const createChosenVisionReviewer = (deps: {
  readonly checkSettings: () => Promise<Pick<AiSettings, 'text' | 'checks'>>
  readonly claude: VisionReviewer
  readonly stub: VisionReviewer
}): VisionReviewer => ({
  name: 'chosen-vision-reviewer',
  supports: LLM_REVIEWERS,
  review: async (request) =>
    (aiCheckGate(await deps.checkSettings(), 'video') === 'claude' ? deps.claude : deps.stub).review(request),
})
