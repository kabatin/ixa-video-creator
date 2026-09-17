import { describe, expect, it } from 'vitest'
import {
  AUDIO_URL_EXPIRES_IN_SEC,
  FINE_SEC,
  JUMP_SEC,
  KEY_HINTS,
  MEDIA_ERROR_ABORTED,
  MEDIA_ERROR_DECODE,
  MEDIA_ERROR_NETWORK,
  MEDIA_ERROR_SRC_NOT_SUPPORTED,
  MIN_POSITION_DELTA_SEC,
  MIN_REFRESH_DELAY_MS,
  NUDGE_SEC,
  REFRESH_MARGIN_SEC,
  URL_EXPIRED_NOTICE,
  URL_REFRESHING_NOTICE,
  clampSec,
  isRecoverableMediaError,
  isTextEntryTarget,
  keyToPlaybackCommand,
  mediaErrorMessage,
  refreshDelayMs,
  resolveSeekTarget,
  shouldCommitPosition,
  type KeyEventLike,
} from '@/lib/playback-state'

/** 打鍵 1 つを組み立てる。既定は修飾キー無し。 */
const press = (key: string, modifiers: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...modifiers,
})

describe('clampSec', () => {
  it('負の位置は先頭に収める', () => {
    expect(clampSec(-3.5, 116)).toBe(0)
  })

  it('尺を超える位置は末尾に収める', () => {
    expect(clampSec(200, 116)).toBe(116)
  })

  it('範囲内はそのまま。秒は float のまま落とさない', () => {
    expect(clampSec(42.375, 116)).toBe(42.375)
  })

  it('NaN は 0 にする。`currentTime = NaN` は例外になる', () => {
    expect(clampSec(Number.NaN, 116)).toBe(0)
    expect(clampSec(Number.POSITIVE_INFINITY, 116)).toBe(0)
  })

  it('尺が未確定（0）なら上限で切らない', () => {
    // メタデータが読めるまで尺は 0。ここで切ると先頭へ吸い寄せられ、
    // 「シークが効かない」ように見える。
    expect(clampSec(42, 0)).toBe(42)
    expect(clampSec(42, Number.NaN)).toBe(42)
  })
})

describe('shouldCommitPosition', () => {
  it('目に見えない差では更新しない', () => {
    expect(shouldCommitPosition(10, 10.004)).toBe(false)
  })

  it('しきい値を超える差は更新する', () => {
    // `10 + 0.01` は浮動小数で 10.009999999999998 になり、差はしきい値をわずかに下回る。
    // 「ちょうど」を境目として当てにしない。60fps で鳴らせば 1 フレームで 16ms 進むため、
    // この差で取りこぼすことは実際には起きない。
    expect(shouldCommitPosition(10, 10 + MIN_POSITION_DELTA_SEC * 2)).toBe(true)
    expect(shouldCommitPosition(10, 10.02)).toBe(true)
  })

  it('戻る向きの差も見る', () => {
    expect(shouldCommitPosition(10, 5)).toBe(true)
  })
})

describe('resolveSeekTarget', () => {
  it('進む', () => {
    expect(resolveSeekTarget(10, JUMP_SEC, 116)).toBe(15)
  })

  it('戻る', () => {
    expect(resolveSeekTarget(10, -NUDGE_SEC, 116)).toBe(9)
  })

  it('先頭より手前へは出ない', () => {
    expect(resolveSeekTarget(0.5, -JUMP_SEC, 116)).toBe(0)
  })

  it('末尾より先へは出ない', () => {
    expect(resolveSeekTarget(115, JUMP_SEC, 116)).toBe(116)
  })

  it('壊れた差分では動かさない', () => {
    expect(resolveSeekTarget(10, Number.NaN, 116)).toBe(10)
  })
})

describe('isTextEntryTarget', () => {
  it.each(['INPUT', 'TEXTAREA', 'SELECT', 'input', 'textarea'])('%s は入力欄とみなす', (tagName) => {
    expect(isTextEntryTarget({ tagName })).toBe(true)
  })

  it('contenteditable も入力欄とみなす', () => {
    expect(isTextEntryTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('ふつうの要素は入力欄ではない', () => {
    expect(isTextEntryTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false)
    expect(isTextEntryTarget({ tagName: 'BUTTON' })).toBe(false)
  })

  it('飛び先が無いときは入力欄ではない', () => {
    expect(isTextEntryTarget(null)).toBe(false)
    expect(isTextEntryTarget(undefined)).toBe(false)
  })
})

describe('keyToPlaybackCommand', () => {
  it('スペースで再生と一時停止を切り替える', () => {
    expect(keyToPlaybackCommand(press(' '))).toEqual({ kind: 'toggle' })
    expect(keyToPlaybackCommand(press('Spacebar'))).toEqual({ kind: 'toggle' })
  })

  it('左右で 1 秒動く', () => {
    expect(keyToPlaybackCommand(press('ArrowLeft'))).toEqual({ kind: 'nudge', deltaSec: -NUDGE_SEC })
    expect(keyToPlaybackCommand(press('ArrowRight'))).toEqual({ kind: 'nudge', deltaSec: NUDGE_SEC })
  })

  it('Shift を足すと 5 秒動く', () => {
    expect(keyToPlaybackCommand(press('ArrowLeft', { shiftKey: true }))).toEqual({
      kind: 'nudge',
      deltaSec: -JUMP_SEC,
    })
    expect(keyToPlaybackCommand(press('ArrowRight', { shiftKey: true }))).toEqual({
      kind: 'nudge',
      deltaSec: JUMP_SEC,
    })
  })

  it('コンマとピリオドで 0.1 秒動く', () => {
    expect(keyToPlaybackCommand(press(','))).toEqual({ kind: 'nudge', deltaSec: -FINE_SEC })
    expect(keyToPlaybackCommand(press('.'))).toEqual({ kind: 'nudge', deltaSec: FINE_SEC })
  })

  it('Home と End で端へ飛ぶ', () => {
    expect(keyToPlaybackCommand(press('Home'))).toEqual({ kind: 'jump', edge: 'start' })
    expect(keyToPlaybackCommand(press('End'))).toEqual({ kind: 'jump', edge: 'end' })
  })

  it.each([
    ['ctrlKey' as const],
    ['metaKey' as const],
    ['altKey' as const],
  ])('%s を伴う打鍵は横取りしない', (modifier) => {
    // Cmd+← は「戻る」、Ctrl+Space は入力メソッドの切り替えなど、
    // ブラウザや OS の操作と衝突する。
    expect(keyToPlaybackCommand(press('ArrowLeft', { [modifier]: true }))).toBeNull()
    expect(keyToPlaybackCommand(press(' ', { [modifier]: true }))).toBeNull()
  })

  it('割り当ての無いキーは何も起こさない', () => {
    expect(keyToPlaybackCommand(press('a'))).toBeNull()
    expect(keyToPlaybackCommand(press('Enter'))).toBeNull()
    expect(keyToPlaybackCommand(press('Tab'))).toBeNull()
  })
})

describe('KEY_HINTS', () => {
  it('画面に出している割り当てが、すべて実際に効く', () => {
    // 一覧と実装がずれると、書いてあるのに効かないキーが生まれる。
    const documented = [' ', 'ArrowLeft', 'ArrowRight', ',', '.', 'Home', 'End']
    for (const key of documented) {
      expect(keyToPlaybackCommand(press(key))).not.toBeNull()
    }
    expect(KEY_HINTS).toHaveLength(5)
  })

  it('どの行にもキーと動作の両方が書いてある', () => {
    for (const hint of KEY_HINTS) {
      expect(hint.keys.length).toBeGreaterThan(0)
      expect(hint.action.length).toBeGreaterThan(0)
    }
  })
})

describe('refreshDelayMs', () => {
  it('期限より前に取り直す', () => {
    const delay = refreshDelayMs(3_600)
    expect(delay).toBe((3_600 - REFRESH_MARGIN_SEC) * 1_000)
    expect(delay).toBeLessThan(3_600 * 1_000)
  })

  it('期限が余白より短くても叩き続けない', () => {
    expect(refreshDelayMs(30)).toBe(MIN_REFRESH_DELAY_MS)
    expect(refreshDelayMs(0)).toBe(MIN_REFRESH_DELAY_MS)
    expect(refreshDelayMs(Number.NaN)).toBe(MIN_REFRESH_DELAY_MS)
  })

  it('余白は呼び出し側で変えられる', () => {
    expect(refreshDelayMs(600, 100)).toBe(500 * 1_000)
  })
})

describe('要求する期限', () => {
  it('API の既定（300 秒）より長く要求する', () => {
    // 聴きながら切る作業で画面に 5 分しか居ないということはまず無い。
    // 既定のままだと 5 分を過ぎたあとのシークで期限切れの URL を叩く。
    expect(AUDIO_URL_EXPIRES_IN_SEC).toBeGreaterThan(300)
  })

  it('要求した期限より前に取り直す', () => {
    expect(refreshDelayMs(AUDIO_URL_EXPIRES_IN_SEC)).toBeLessThan(AUDIO_URL_EXPIRES_IN_SEC * 1_000)
  })

  it('API が短い期限を返したら、その値に従う', () => {
    // 期限の正は API の応答であって、こちらが要求した値ではない。
    expect(refreshDelayMs(300)).toBe((300 - REFRESH_MARGIN_SEC) * 1_000)
  })
})

describe('取り直しの断り', () => {
  it('期限が原因だと分かる文面を出す', () => {
    expect(URL_REFRESHING_NOTICE).toContain('期限')
    expect(URL_EXPIRED_NOTICE).toContain('期限')
  })

  it('切れる前と切れた後を書き分ける', () => {
    // 「読み込めません」で済ませると、利用者は何が起きたか分からない。
    expect(URL_REFRESHING_NOTICE).not.toBe(URL_EXPIRED_NOTICE)
  })
})

describe('メディアの失敗', () => {
  it('期限切れに見える失敗だけ取り直しで復帰させる', () => {
    expect(isRecoverableMediaError(MEDIA_ERROR_NETWORK)).toBe(true)
    expect(isRecoverableMediaError(MEDIA_ERROR_SRC_NOT_SUPPORTED)).toBe(true)
  })

  it('取り直しても直らない失敗では繰り返さない', () => {
    expect(isRecoverableMediaError(MEDIA_ERROR_DECODE)).toBe(false)
    expect(isRecoverableMediaError(MEDIA_ERROR_ABORTED)).toBe(false)
    expect(isRecoverableMediaError(null)).toBe(false)
    expect(isRecoverableMediaError(undefined)).toBe(false)
  })

  it('理由ごとに違う文面を出す。数字は出さない', () => {
    const messages = [
      MEDIA_ERROR_ABORTED,
      MEDIA_ERROR_NETWORK,
      MEDIA_ERROR_DECODE,
      MEDIA_ERROR_SRC_NOT_SUPPORTED,
    ].map((code) => mediaErrorMessage(code))

    expect(new Set(messages).size).toBe(messages.length)
    for (const message of messages) {
      expect(message).not.toMatch(/\d/)
    }
  })

  it('知らない理由でも黙らない', () => {
    expect(mediaErrorMessage(99).length).toBeGreaterThan(0)
    expect(mediaErrorMessage(null).length).toBeGreaterThan(0)
  })
})
