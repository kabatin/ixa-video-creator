import { AI_TOOLS, type AiPurpose, type AiSettings, type AiToolId } from '@ixa/domain'
import type { WireAiSettingsState, WireAiTool } from '@/lib/ai-settings-api'

/**
 * 使う AI を選ぶ画面（ADR-0032）の中身。**React を含まない。**
 * 選べるかは API の理由（`problems`）をそのまま使い、ここで規則を書き写さない。
 */

export type AiOption = {
  readonly id: AiToolId
  readonly label: string
  readonly version: string | null
  /** 名前の横の短い札（この Mac・無料・従量課金など）。 */
  readonly tags: readonly string[]
  /** 選べない理由。選べるなら null。行の名前は繰り返さない（見つからなければその理由だけ）。 */
  readonly problem: string | null
  /** 使う前に知っておくこと（無料枠の扱い・料金・商用の可否）。 */
  readonly notice: string | null
}

/**
 * その用途の選択肢。選べるものを先に、選べないもの（入っていない・起動していない）は理由つきで後ろに。
 * **その用途に使えない AI はどこにも出さない。**
 */
export const aiOptionsFor = (purpose: AiPurpose, tools: readonly WireAiTool[]): readonly AiOption[] => {
  const options = tools
    .filter((tool) => AI_TOOLS[tool.id].purposes.includes(purpose))
    .map((tool) => ({
      id: tool.id,
      label: tool.label,
      version: tool.status.state === 'ready' ? tool.status.version : null,
      tags: AI_TOOLS[tool.id].tags,
      problem:
        tool.problems[purpose] === null
          ? null
          : tool.status.state === 'missing'
            ? tool.status.reason
            : tool.problems[purpose],
      notice: tool.notice,
    }))
  return [
    ...options.filter((option) => option.problem === null),
    ...options.filter((option) => option.problem !== null),
  ]
}

/** 画面を開いたときの選択。選んであればそれ、まだなら勧める組み合わせ。 */
export const initialAiChoice = (state: WireAiSettingsState, recommended: AiSettings): AiSettings =>
  state.source === 'saved' ? state.settings : recommended

/** 初めて開いたときに勧めるか。**一度勧めたら、選ばずに閉じても次からは出さない**（メニューから開ける）。 */
export const shouldOfferAiSetup = (
  source: WireAiSettingsState['source'],
  alreadyOffered: boolean,
): boolean => source === 'default' && !alreadyOffered
