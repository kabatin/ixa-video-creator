/**
 * N+1 検出用のカウンタ。`charactersForShot` がリポジトリを何段に分けて
 * 呼んでいるかを測るためだけに使う。実 DB には接続しない。
 */
import type {
  CharacterLookRepository,
  CharacterRepository,
  ShotCharacterRepository,
} from '@ixa/db'
import type { CharacterId, CharacterLookId, ShotId } from '@ixa/domain'

/**
 * リポジトリ呼び出しを数える計測器。
 *
 * **段数（rounds）が本質。** 呼び出し回数そのものではなく、
 * 「前の結果を待ってから次を投げる」往復が何段積み上がったかを数える。
 * 同じティックで同時に飛んだ呼び出しはまとめて 1 段とする。
 * 登場人物を増やしても段数が変わらなければ、直列な N+1 は無い。
 */
export type CallRecorder = {
  readonly counts: () => Readonly<Record<string, number>>
  readonly rounds: () => number
  readonly track: <A extends readonly unknown[], R>(
    name: string,
    fn: (...args: A) => Promise<R>,
  ) => (...args: A) => Promise<R>
}

export const createCallRecorder = (): CallRecorder => {
  let counts: Readonly<Record<string, number>> = {}
  let inFlight = 0
  let rounds = 0

  return {
    counts: () => counts,
    rounds: () => rounds,
    track:
      (name, fn) =>
      (...args) => {
        counts = { ...counts, [name]: (counts[name] ?? 0) + 1 }
        // 同時に飛んでいる呼び出しが 0 から 1 になった瞬間が、新しい段の始まり。
        if (inFlight === 0) rounds += 1
        inFlight += 1
        return fn(...args).finally(() => {
          inFlight -= 1
        })
      },
  }
}

/**
 * CharacterBundle の解決で使うメソッドだけを計測対象にする。
 * 呼び出しはアロー関数で包む。メソッドをそのまま取り出すと `this` が外れるため。
 */
export const countingCharacterRepository = (
  inner: CharacterRepository,
  recorder: CallRecorder,
): CharacterRepository => ({
  ...inner,
  findById: recorder.track('characters.findById', (id: CharacterId) => inner.findById(id)),
  listIdentityImages: recorder.track(
    'characters.listIdentityImages',
    (id: CharacterId) => inner.listIdentityImages(id),
  ),
})

export const countingLookRepository = (
  inner: CharacterLookRepository,
  recorder: CallRecorder,
): CharacterLookRepository => ({
  ...inner,
  findById: recorder.track('looks.findById', (id: CharacterLookId) => inner.findById(id)),
  listLookImages: recorder.track(
    'looks.listLookImages',
    (id: CharacterLookId) => inner.listLookImages(id),
  ),
})

export const countingShotCharacterRepository = (
  inner: ShotCharacterRepository,
  recorder: CallRecorder,
): ShotCharacterRepository => ({
  ...inner,
  findByShot: recorder.track('shotCharacters.findByShot', (id: ShotId) => inner.findByShot(id)),
})
