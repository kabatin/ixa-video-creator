/**
 * テスト専用の偽物リポジトリ。`@ixa/generation/testing` から api / worker の
 * 両方が使う。本番コードから import しないこと（`index.ts` では公開しない）。
 */
import {
  DbNotFoundError,
  type CharacterLookRepository,
  type CharacterRepository,
  type ShotCharacterRepository,
  type ShotReferenceRepository,
} from '@ixa/db'
import {
  CreateShotReferenceInput as CreateShotReferenceInputSchema,
  ShotCharacter as ShotCharacterSchema,
  ShotReference as ShotReferenceSchema,
  ShotReferenceId as ShotReferenceIdSchema,
  newId,
  type CharacterId,
  type CharacterLookId,
  type ShotCharacter,
  type ShotId,
  type ShotReference,
} from '@ixa/domain'

/**
 * テスト用のインメモリ ShotCharacter / ShotReference リポジトリ。実 DB には接続しない。
 * Domain 型のみを返し、保持する値は毎回作り直す（破壊的変更をしない）。
 */

export type InMemoryShotCharacterRepository = ShotCharacterRepository & {
  readonly snapshot: () => readonly ShotCharacter[]
}

const byOrderThenCharacterId = (a: ShotCharacter, b: ShotCharacter): number =>
  a.order - b.order || (a.characterId < b.characterId ? -1 : 1)

export const createInMemoryShotCharacterRepository = (
  seed: readonly ShotCharacter[] = [],
): InMemoryShotCharacterRepository => {
  let store: readonly ShotCharacter[] = seed.map((entry) => ShotCharacterSchema.parse(entry))

  return {
    snapshot: () => store,

    findByShot: (shotId) =>
      Promise.resolve(store.filter((e) => e.shotId === shotId).sort(byOrderThenCharacterId)),

    add: (input) => {
      const created = ShotCharacterSchema.parse(input)
      store = [...store, created]
      return Promise.resolve(created)
    },

    remove: (shotId, characterId) => {
      const target = store.find((e) => e.shotId === shotId && e.characterId === characterId)
      if (target === undefined) {
        return Promise.reject(new DbNotFoundError('ShotCharacter', characterId))
      }
      store = store.filter((e) => !(e.shotId === shotId && e.characterId === characterId))
      return Promise.resolve()
    },

    replaceAll: (shotId, entries) => {
      const created = entries.map((entry) => ShotCharacterSchema.parse({ ...entry, shotId }))
      store = [...store.filter((e) => e.shotId !== shotId), ...created]
      return Promise.resolve([...created].sort(byOrderThenCharacterId))
    },
  }
}

export type InMemoryShotReferenceRepository = ShotReferenceRepository & {
  readonly snapshot: () => readonly ShotReference[]
}

export const createInMemoryShotReferenceRepository = (): InMemoryShotReferenceRepository => {
  let store: readonly ShotReference[] = []

  return {
    snapshot: () => store,

    findByShot: (shotId) =>
      Promise.resolve(store.filter((r) => r.shotId === shotId).sort((a, b) => a.order - b.order)),

    create: (input) => {
      const created = ShotReferenceSchema.parse({
        ...CreateShotReferenceInputSchema.parse(input),
        id: newId(ShotReferenceIdSchema),
      })
      store = [...store, created]
      return Promise.resolve(created)
    },

    delete: (id) => {
      if (store.find((r) => r.id === id) === undefined) {
        return Promise.reject(new DbNotFoundError('ShotReference', id))
      }
      store = store.filter((r) => r.id !== id)
      return Promise.resolve()
    },
  }
}

// ---------------------------------------------------------------------------
// N+1 検出用のカウンタ
// ---------------------------------------------------------------------------

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
