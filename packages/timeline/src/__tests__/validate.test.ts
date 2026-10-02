import { describe, expect, it } from 'vitest'
import { TIMELINE_ISSUE_CODES, validateTimeline, type TimelineIssue } from '../validate.js'
import type { TimelineClip, Transition } from '@ixa/domain'
import type { TimelineMusicTrack } from '../build.js'
import { makeClip, makeShot, makeSource, makeTransition, shotId, snapshot } from './fixtures.js'

const codes = (issues: readonly TimelineIssue[]): string[] => issues.map((issue) => issue.code)

const find = (issues: readonly TimelineIssue[], code: string): TimelineIssue[] =>
  issues.filter((issue) => issue.code === code)

describe('validateTimeline / error', () => {
  it('Shot の時間が重なっていれば error', () => {
    const shots = [makeShot(1, 0, 5), makeShot(2, 4, 5)]
    const issues = validateTimeline(makeSource({ shots }))
    const overlaps = find(issues, TIMELINE_ISSUE_CODES.shotOverlap)

    expect(overlaps).toHaveLength(1)
    expect(overlaps[0]?.severity).toBe('error')
    expect(overlaps[0]?.shotId).toBe(shotId(1))
  })

  it('境界が一致するだけなら重なりではない', () => {
    const shots = [makeShot(1, 0, 5), makeShot(2, 5, 5)]
    expect(codes(validateTimeline(makeSource({ shots })))).toEqual([])
  })

  /**
   * 1 コマに満たない差は「接している」（制作者 2026-10-02「書き出ししようとするとレンダリング不可表示になって、Shot 重なりが指摘される」）。
   * ぼくははると: CUT-02 の頭を 0:13.33（画面の 2 桁）にしたら、終わりが CUT-03 の頭へ 0.0017 秒はみ出して書き出せなかった。
   * 端のドラッグ・歌い出しに揃える・結合はこの差を「接している」と扱うので、検査も同じ幅にする。
   */
  it('1 コマに満たない重なり・隙間は接しているとみなす（指摘しない）', () => {
    const overlap = [makeShot(1, 0, 13.33), makeShot(2, 13.33, 7.801904761904762), makeShot(3, 21.13015873015873, 7.8)]
    const gap = [makeShot(1, 0, 10.89), makeShot(2, 10.89015873, 4)]

    expect(codes(validateTimeline(makeSource({ shots: overlap })))).toEqual([])
    expect(codes(validateTimeline(makeSource({ shots: gap })))).toEqual([])
  })

  it('1 コマを越える重なりは error・隙間は warning のまま', () => {
    const overlap = [makeShot(1, 0, 5.02), makeShot(2, 5, 5)]
    const gap = [makeShot(1, 0, 5), makeShot(2, 5.02, 5)]

    expect(find(validateTimeline(makeSource({ shots: overlap })), TIMELINE_ISSUE_CODES.shotOverlap)).toHaveLength(1)
    expect(find(validateTimeline(makeSource({ shots: gap })), TIMELINE_ISSUE_CODES.shotGap)).toHaveLength(1)
  })

  it('1 つの Shot が複数の Shot をまたぐ重なりもすべて挙げる', () => {
    const shots = [makeShot(1, 0, 10), makeShot(2, 1, 1), makeShot(3, 3, 1)]
    const overlaps = find(validateTimeline(makeSource({ shots })), TIMELINE_ISSUE_CODES.shotOverlap)

    expect(overlaps).toHaveLength(2)
    expect(overlaps.every((issue) => issue.shotId === shotId(1))).toBe(true)
  })

  it('尺が 0 以下の Shot は error', () => {
    const shots = [makeShot(1, 0, 0), makeShot(2, 0, -1)]
    const issues = find(
      validateTimeline(makeSource({ shots })),
      TIMELINE_ISSUE_CODES.shotNonPositiveDuration,
    )

    expect(issues).toHaveLength(2)
    expect(issues.every((issue) => issue.severity === 'error')).toBe(true)
  })

  it('Transition が隣接していない Shot を繋いでいれば error', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4), makeShot(3, 8, 4)]
    const transitions = [makeTransition(31, shotId(1), shotId(3), 0.5)]
    const issues = find(
      validateTimeline(makeSource({ shots, transitions })),
      TIMELINE_ISSUE_CODES.transitionNotAdjacent,
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('error')
  })

  it('Transition が知らない Shot を参照していれば error', () => {
    const shots = [makeShot(1, 0, 4)]
    const transitions = [makeTransition(31, shotId(1), shotId(9), 0.5)]
    const issues = find(
      validateTimeline(makeSource({ shots, transitions })),
      TIMELINE_ISSUE_CODES.transitionNotAdjacent,
    )

    expect(issues).toHaveLength(1)
  })

  it('隣接している Shot を繋ぐ Transition は問題にしない', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4)]
    const transitions = [makeTransition(31, shotId(1), shotId(2), 0.5)]
    expect(codes(validateTimeline(makeSource({ shots, transitions })))).toEqual([])
  })

  it('Transition の尺が接する Shot の尺を超えていれば error', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 1)]
    const transitions = [makeTransition(31, shotId(1), shotId(2), 2)]
    const issues = find(
      validateTimeline(makeSource({ shots, transitions })),
      TIMELINE_ISSUE_CODES.transitionTooLong,
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('error')
  })

  it('Transition の尺が両方の Shot 以下なら問題にしない', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 1)]
    const transitions = [makeTransition(31, shotId(1), shotId(2), 1)]
    expect(codes(validateTimeline(makeSource({ shots, transitions })))).toEqual([])
  })
})

/**
 * 曲の頭と尻の黒（warning）。
 *
 * 以前は Shot と Shot の**間**しか見ていなかった。セクションから割ると最初の区切りが
 * 最初の拍（1.02s）に来るので、曲の頭から最初の Shot まで、最後の Shot から曲の終わりまでが
 * 黒画面のまま書き出され、検査は「隙間・重なりともに指摘はありません」と言っていた（実測）。
 * 本制作も CUT-01 が 2.67s から始まり、頭に 2.7s・尻に 2.5s の黒が入る状態だった。
 *
 * **埋めはしない。** 歌い出しまで黒にしたい、という意図もありうる。言うだけにする。
 */
describe('validateTimeline / 頭と尻の黒', () => {
  const music = (durationSec: number): readonly TimelineMusicTrack[] => [
    { mediaUrl: 'https://media.test/m.mp3', startSec: 0, durationSec, volume: 1 },
  ]

  it('曲の頭から最初の Shot までは warning（秒数つき）', () => {
    const shots = [makeShot(1, 1.02, 4), makeShot(2, 5.02, 4)]
    const issues = find(validateTimeline(makeSource({ shots })), TIMELINE_ISSUE_CODES.shotGapHead)

    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('warning')
    expect(issues[0]?.shotId).toBe(shotId(1))
    expect(issues[0]?.message).toContain('1.020s')
  })

  it('最後の Shot から曲の終わりまでは warning（秒数つき）', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4)]
    const issues = find(
      validateTimeline(makeSource({ shots, musicTracks: music(10) })),
      TIMELINE_ISSUE_CODES.shotGapTail,
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('warning')
    expect(issues[0]?.shotId).toBe(shotId(2))
    expect(issues[0]?.message).toContain('2.000s')
  })

  it('0 秒から曲の終わりまで埋まっていれば何も言わない', () => {
    const shots = [makeShot(1, 0, 5), makeShot(2, 5, 5)]
    const issues = validateTimeline(makeSource({ shots, musicTracks: music(10) }))

    expect(find(issues, TIMELINE_ISSUE_CODES.shotGapHead)).toEqual([])
    expect(find(issues, TIMELINE_ISSUE_CODES.shotGapTail)).toEqual([])
  })

  it('浮動小数の端数では言わない', () => {
    const shots = [makeShot(1, 0.0000001, 5)]
    const issues = validateTimeline(makeSource({ shots, musicTracks: music(5.0000001) }))

    expect(find(issues, TIMELINE_ISSUE_CODES.shotGapHead)).toEqual([])
    expect(find(issues, TIMELINE_ISSUE_CODES.shotGapTail)).toEqual([])
  })

  it('Shot が 1 つも無ければ言わない（別の検査の領分）', () => {
    const issues = validateTimeline(makeSource({ shots: [], musicTracks: music(10) }))

    expect(find(issues, TIMELINE_ISSUE_CODES.shotGapHead)).toEqual([])
    expect(find(issues, TIMELINE_ISSUE_CODES.shotGapTail)).toEqual([])
  })
})

describe('validateTimeline / warning', () => {
  it('Shot の間の隙間は warning', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 6, 4)]
    const issues = find(validateTimeline(makeSource({ shots })), TIMELINE_ISSUE_CODES.shotGap)

    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('warning')
    expect(issues[0]?.shotId).toBe(shotId(1))
  })

  it('採用 Take が無い Shot は warning', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4)]
    const issues = find(
      validateTimeline(
        makeSource({
          shots,
          resolveShotMedia: (shot) => (shot.id === shotId(1) ? 'https://media.test/S1.mp4' : undefined),
        }),
      ),
      TIMELINE_ISSUE_CODES.shotMissingTake,
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('warning')
    expect(issues[0]?.shotId).toBe(shotId(2))
  })

  it('採用 Take が無くても絵があれば、warning のまま「絵を映す」と言う（黒になるとは言わない）', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4)]
    const issues = find(
      validateTimeline(
        makeSource({
          shots,
          resolveShotMedia: () => undefined,
          resolveShotStill: (shot) => (shot.id === shotId(1) ? 'https://media.test/S1.png' : undefined),
        }),
      ),
      TIMELINE_ISSUE_CODES.shotMissingTake,
    )

    expect(issues.map((issue) => [issue.shotId, issue.severity])).toEqual([
      [shotId(1), 'warning'],
      [shotId(2), 'warning'],
    ])
    expect(issues[0]?.message).toMatch(/絵コンテの画像を映す/)
    expect(issues[1]?.message).toMatch(/VIDEO1 に出ない/)
  })

  it('タイムラインの尺をはみ出したクリップは warning', () => {
    const shots = [makeShot(1, 0, 4)]
    const clips = [makeClip(21, 'TEXT', 0, 2), makeClip(22, 'VFX', 3, 5)]
    const issues = find(
      validateTimeline(makeSource({ shots, clips })),
      TIMELINE_ISSUE_CODES.clipOutOfRange,
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('warning')
  })

  it('浮動小数の誤差を隙間やはみ出しとして扱わない', () => {
    const shots = [makeShot(1, 0, 0.1 + 0.2), makeShot(2, 0.3, 1)]
    const clips = [makeClip(21, 'TEXT', 0, 1.3)]
    expect(codes(validateTimeline(makeSource({ shots, clips })))).toEqual([])
  })
})

/**
 * 読めないテロップは**書き出すまで分からない**（レンダラは赤で描くだけ）。
 * 押す前の検査に出す。「知らない種類」と「文言が無い」は直し方が違うので分ける。
 */
/** Take が尺に足りない（ADR-0026）。最後のコマで止まるので、速度で埋めるかを選ばせる。 */
describe('Take が足りない', () => {
  it('trim で足りない Shot は warning（何秒足りないかを言う）', () => {
    const shots = [makeShot(1, 0, 5)]
    const issues = find(
      validateTimeline(makeSource({ shots, resolveShotMediaDurationSec: () => 4 })),
      TIMELINE_ISSUE_CODES.shotTakeShort,
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('warning')
    expect(issues[0]?.message).toContain('1.00')
  })

  it('fit で埋まれば出さない', () => {
    const shots = [makeShot(1, 0, 5, { timing: 'fit' })]
    const issues = find(
      validateTimeline(makeSource({ shots, resolveShotMediaDurationSec: () => 4 })),
      TIMELINE_ISSUE_CODES.shotTakeShort,
    )

    expect(issues).toHaveLength(0)
  })

  it('わずかな差（0.05 秒以内）と、長さが分からない Shot では出さない', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4)]
    const issues = find(
      validateTimeline(
        makeSource({ shots, resolveShotMediaDurationSec: (shot) => (shot.id === shotId(1) ? 3.97 : null) }),
      ),
      TIMELINE_ISSUE_CODES.shotTakeShort,
    )

    expect(issues).toHaveLength(0)
  })
})

describe('読めないテロップ', () => {
  const textClip = (n: number, content: TimelineClip['content']): TimelineClip => ({
    ...makeClip(n, 'TEXT', 0, 2),
    content,
  })

  /** 見た目（ADR-0028）が読めなくても文字は既定の見た目で出る。赤枠にはならないが、黙って捨てない。 */
  it('見た目が読めなければ、文言とは別の種類で warning', () => {
    const clips = [
      textClip(22, { type: 'text', templateKey: 'plain', params: { text: '歌詞', style: { color: 'red' } } }),
    ]
    const issues = validateTimeline(makeSource({ shots: [makeShot(1, 0, 10)], clips }))

    expect(find(issues, TIMELINE_ISSUE_CODES.textStyleUnreadable)).toHaveLength(1)
    expect(find(issues, TIMELINE_ISSUE_CODES.textStyleUnreadable)[0]?.message).toContain('既定の見た目')
    expect(find(issues, TIMELINE_ISSUE_CODES.textClipUnreadable)).toHaveLength(0)
  })

  it('読める見た目なら何も言わない', () => {
    const clips = [
      textClip(23, { type: 'text', templateKey: 'plain', params: { text: '歌詞', style: { color: '#FFD100' } } }),
    ]
    const issues = validateTimeline(makeSource({ shots: [makeShot(1, 0, 10)], clips }))

    expect(find(issues, TIMELINE_ISSUE_CODES.textStyleUnreadable)).toHaveLength(0)
  })

  it('文言が入っていなければ warning', () => {
    const clips = [textClip(21, { type: 'text', templateKey: 'lower_third', params: {} })]
    const issues = find(
      validateTimeline(makeSource({ shots: [makeShot(1, 0, 10)], clips })),
      TIMELINE_ISSUE_CODES.textClipUnreadable,
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('warning')
    expect(issues[0]?.message).toContain('文言が入っておらず')
  })

  it('知らない種類は「文言が無い」と別の文で出す', () => {
    const clips = [
      textClip(21, { type: 'text', templateKey: 'lower-third', params: { text: 'あり' } }),
    ]
    const issues = find(
      validateTimeline(makeSource({ shots: [makeShot(1, 0, 10)], clips })),
      TIMELINE_ISSUE_CODES.textClipUnreadable,
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('知らない種類')
    expect(issues[0]?.message).not.toContain('文言が入っておらず')
  })

  it('読めるテロップは何も言わない', () => {
    const clips = [makeClip(21, 'TEXT', 0, 2)]
    const issues = find(
      validateTimeline(makeSource({ shots: [makeShot(1, 0, 10)], clips })),
      TIMELINE_ISSUE_CODES.textClipUnreadable,
    )

    expect(issues).toEqual([])
  })

  /** テロップ以外の帯は見ない。素材クリップに文言は要らない。 */
  it('テキスト以外のクリップは対象外', () => {
    const clips = [
      textClip(21, {
        type: 'motion_graphics',
        templateKey: 'unknown_thing',
        params: {},
      }),
    ]
    const issues = find(
      validateTimeline(makeSource({ shots: [makeShot(1, 0, 10)], clips })),
      TIMELINE_ISSUE_CODES.textClipUnreadable,
    )

    expect(issues).toEqual([])
  })
})

describe('validateTimeline / 列挙', () => {
  it('複数の問題を 1 回の呼び出しですべて挙げる', () => {
    const shots = [
      makeShot(1, 0, 5), // S2 と重なる
      makeShot(2, 4, 0), // 尺 0
      makeShot(3, 10, 4), // S2 との間に隙間
    ]
    const transitions = [makeTransition(31, shotId(1), shotId(3), 99)]
    const clips = [makeClip(21, 'TEXT', 0, 100)]
    const issues = validateTimeline(
      makeSource({
        shots,
        transitions,
        clips,
        resolveShotMedia: (shot) =>
          shot.id === shotId(3) ? undefined : `https://media.test/${shot.code}.mp4`,
      }),
    )

    expect(new Set(codes(issues))).toEqual(
      new Set([
        TIMELINE_ISSUE_CODES.shotOverlap,
        TIMELINE_ISSUE_CODES.shotNonPositiveDuration,
        TIMELINE_ISSUE_CODES.transitionNotAdjacent,
        TIMELINE_ISSUE_CODES.shotGap,
        // テキストが 100s まであるので、最後の Shot（14s で終わる）の後ろは 86s 黒になる。
        TIMELINE_ISSUE_CODES.shotGapTail,
        TIMELINE_ISSUE_CODES.shotMissingTake,
        TIMELINE_ISSUE_CODES.clipOutOfRange,
      ]),
    )
    expect(issues.filter((issue) => issue.severity === 'error').length).toBeGreaterThanOrEqual(3)
    expect(issues.filter((issue) => issue.severity === 'warning').length).toBeGreaterThanOrEqual(3)
  })

  it('問題が無ければ空配列', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4)]
    const clips = [makeClip(21, 'TEXT', 0, 8)]
    const transitions = [makeTransition(31, shotId(1), shotId(2), 0.5)]
    expect(validateTimeline(makeSource({ shots, clips, transitions }))).toEqual([])
  })

  it('入力を変更しない', () => {
    const shots = [makeShot(3, 8, 2), makeShot(1, 0, 5), makeShot(2, 4, 5)]
    const clips = [makeClip(21, 'TEXT', 0, 100)]
    const before = snapshot([shots, clips])

    validateTimeline(makeSource({ shots, clips }))

    expect(snapshot([shots, clips])).toBe(before)
    expect(shots.map((shot) => shot.code)).toEqual(['S3', 'S1', 'S2'])
  })
})

describe('絵に出ない Transition（Architect 追加）', () => {
  /**
   * wipe / whip_pan / glitch はレンダリング時に cut へ落ちる。
   * 置いた本人は選んだ効果が出ると思っているので、黙って落とさない。
   */
  const sourceWith = (type: Transition['type']) => {
    const shots = [makeShot(1, 0, 2), makeShot(2, 2, 2)]
    return makeSource({
      shots,
      transitions: [{ ...makeTransition(1, shotId(1), shotId(2), 0.5), type }],
    })
  }

  const degraded = (type: Transition['type']): TimelineIssue[] =>
    find(validateTimeline(sourceWith(type)), TIMELINE_ISSUE_CODES.transitionDegraded)

  it.each(['wipe', 'whip_pan', 'glitch'] as const)('%s は warning を出す', (type) => {
    const issues = degraded(type)

    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('warning')
    expect(issues[0]?.message).toContain('カット')
  })

  it.each(['cut', 'dissolve', 'dip_to_black', 'dip_to_white'] as const)(
    '%s は warning を出さない',
    (type) => {
      expect(degraded(type)).toEqual([])
    },
  )

  it('error にはしない。出力は作れるので、止めるより伝えるほうが役に立つ', () => {
    const errors = validateTimeline(sourceWith('wipe')).filter((i) => i.severity === 'error')

    expect(errors).toEqual([])
  })
})
