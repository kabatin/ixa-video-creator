import { aiCheckGate, type AiSettings } from '@ixa/domain'

/**
 * Take の画像を見る判定（Stage 2）をするか（ADR-0066）。「使う AI」で決める（ADR-0032）。
 *
 * Take のチェックを入れていて、テキストの AI が Claude のときだけ Claude で判定する。それ以外は**判定しない**
 * （お試しの判定で代えない。入力から決まる結果が fail になると、作り直し推奨の印や自動の作り直しが本物でない
 * 判定で起きるため）。判定していないことは指摘として残す（合格に化けさせない）。
 */

/** 画面に出る文。実装の言葉を入れない。 */
export const VISION_OFF_MESSAGE = '「使う AI」で Take のチェックを切っているため、画像を見る判定はしていません'
export const VISION_NOT_CLAUDE_MESSAGE = '「使う AI」のテキストが Claude ではないため、画像を見る判定はしていません'

/** 飛ばす理由。Claude で判定するなら null。 */
export const visionSkipReasonOf = (settings: Pick<AiSettings, 'text' | 'checks'>): string | null => {
  switch (aiCheckGate(settings, 'video')) {
    case 'claude':
      return null
    case 'off':
      return VISION_OFF_MESSAGE
    case 'not_claude':
      return VISION_NOT_CLAUDE_MESSAGE
  }
}
