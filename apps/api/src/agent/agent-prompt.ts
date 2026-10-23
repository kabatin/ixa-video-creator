/**
 * 毎回の依頼の頭に付ける文脈（ADR-0058）。開いている作品・選んでいる Shot・再生位置を、毎回自動で添える。
 * 「この Shot の効果音を派手に」が通じるように。ツールに渡す ID はここで教え、返事には書かせない。
 */

export type AgentTurnContext = {
  readonly projectId: string
  readonly projectName: string
  readonly shot: { readonly id: string; readonly label: string } | null
  readonly playheadSec: number | null
}

/** 再生位置の書き方（画面の `format-time.ts` の位置の書式と同じ形 `0:03.75`）。 */
export const formatPosition = (sec: number): string => {
  const centis = Math.round(sec * 100)
  const minutes = Math.floor(centis / 6000)
  const rest = (centis - minutes * 6000) / 100
  return `${String(minutes)}:${rest.toFixed(2).padStart(5, '0')}`
}

export const buildAgentPrompt = (context: AgentTurnContext, text: string): string =>
  [
    '[ixa の画面からの依頼]',
    `作品: ${context.projectName}（projectId: ${context.projectId}）`,
    `選んでいる Shot: ${context.shot === null ? 'なし' : `${context.shot.label}（shotId: ${context.shot.id}）`}`,
    `再生位置: ${context.playheadSec === null ? '不明' : formatPosition(context.playheadSec)}`,
    '決まり:',
    '- ixa の MCP のツールで作品を直す。返事は ixa の画面の言葉で、短く日本語で書く。',
    '- 返事に内部 ID（projectId・shotId・clipId など）や URL を書かない。Shot は CUT-07 のような名前で呼ぶ。',
    '- 生成・削除・書き出し・設定の変更は、制作者に確認が出る。「やめる」と言われたら、別のやり方を提案するか、指示を待つ。',
    '- 制作者が「確認なしでいい」とはっきり言ったときだけ waive_confirmations を呼ぶ。',
    '',
    '[依頼]',
    text,
  ].join('\n')
