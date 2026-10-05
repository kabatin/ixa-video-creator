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
  /** 選べない理由。選べるなら null。行の名前は繰り返さない（見つからなければその理由だけ）。 */
  readonly problem: string | null
  /** 使う前に知っておくこと（無料枠の扱い・料金・商用の可否）。 */
  readonly notice: string | null
}

export type AiPurposeOptions = {
  /** その用途に使える AI。選べるものを先に、選べないもの（入っていない・起動していない）は理由つきで後ろに。 */
  readonly options: readonly AiOption[]
  /** 入っているが、その用途にはまだ使えない AI（1 行で名前だけ言う。行を埋めない）。 */
  readonly installedButUnsupported: readonly AiToolId[]
}

/**
 * この Mac に入れた AI の CLI か。「入っているが、この用途には使えない」はこれだけを言う。
 * アプリに入っているもの（お試し・静止画を動かす）、Mac の声（OS の道具）、whisper.cpp、鍵で使う API は
 * 「入れた AI」ではないので挙げない（ほかの用途の欄が名前で埋まる）。
 */
const isInstalledAiCli = (id: AiToolId): boolean => {
  const detect = AI_TOOLS[id].detect
  return detect.kind === 'cli' && detect.command !== 'say'
}

/** その用途の選択肢。**入っておらず、その用途にも使えない AI はどこにも出さない。** */
export const aiOptionsFor = (
  purpose: AiPurpose,
  tools: readonly WireAiTool[],
): AiPurposeOptions => {
  const supports = (tool: WireAiTool): boolean => AI_TOOLS[tool.id].purposes.includes(purpose)
  const options = tools.filter(supports).map((tool) => ({
    id: tool.id,
    label: tool.label,
    version: tool.status.state === 'ready' ? tool.status.version : null,
    problem:
      tool.problems[purpose] === null
        ? null
        : tool.status.state === 'missing'
          ? tool.status.reason
          : tool.problems[purpose],
    notice: tool.notice,
  }))
  return {
    options: [
      ...options.filter((option) => option.problem === null),
      ...options.filter((option) => option.problem !== null),
    ],
    installedButUnsupported: tools
      .filter((tool) => !supports(tool) && tool.status.state === 'ready' && isInstalledAiCli(tool.id))
      .map((tool) => tool.id),
  }
}

/** 画面を開いたときの選択。選んであればそれ、まだなら勧める組み合わせ。 */
export const initialAiChoice = (state: WireAiSettingsState, recommended: AiSettings): AiSettings =>
  state.source === 'saved' ? state.settings : recommended

/** 初めて開いたときに勧めるか。**一度勧めたら、選ばずに閉じても次からは出さない**（メニューから開ける）。 */
export const shouldOfferAiSetup = (
  source: WireAiSettingsState['source'],
  alreadyOffered: boolean,
): boolean => source === 'default' && !alreadyOffered
