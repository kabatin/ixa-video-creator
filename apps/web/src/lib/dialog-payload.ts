import type { PromptReuse } from '@/lib/prompt-view'

/**
 * `openDialog` で窓へ渡す一般の荷物。窓は自分宛ての種類だけを読み、ほかは無視する。
 * いまはプロンプトビューアの「これを元に作る」（楽曲・効果音の作成画面の初期値）だけ。
 */
export type DialogPayload = PromptReuse
