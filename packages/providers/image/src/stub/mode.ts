import type { ImagePlaceholderMode } from './render-image.js'

/**
 * 四面図を要求しているかをプロンプトから判定する。
 *
 * `ImageGenerationRequest` に「四面図かどうか」のフィールドは無い。
 * 実の画像モデル（Gemini / Seedream）に四面図を出させる方法もプロンプトで指示することであり、
 * **スタブも同じ入口で切り替える**のが実モデルに忠実である。
 * 判定を隠さず、ここに明示的なキーワード表として置く。
 */
export const FOUR_VIEW_KEYWORDS: readonly string[] = [
  'four_view',
  'four view',
  'four-view',
  'turnaround',
  'turn-around',
  'character sheet',
  '四面図',
  'ターンアラウンド',
]

export const isFourViewPrompt = (prompt: string): boolean => {
  const normalized = prompt.toLowerCase()
  return FOUR_VIEW_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

export const placeholderModeFor = (prompt: string): ImagePlaceholderMode =>
  isFourViewPrompt(prompt) ? 'four_view' : 'plain'
