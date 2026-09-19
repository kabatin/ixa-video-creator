import type { Character, CharacterLook, ShotCharacter } from '@ixa/domain'
import type { SelectOption } from '@/components/form/select-field'
import { ShotCastEntry } from '@/lib/shot-cast-api'

/**
 * Shot の登場人物を編集するための値と、送信前の検証。
 * 画面（React）から切り離した純粋関数にして、ブラウザ無しでテストできるようにする。
 *
 * `lookId` は必須（docs/DOMAIN.md §5）。既定 Look の解決は**保存時ではなくここで**行い、
 * 解決済みの値を送る。実行時解決に頼ると、既定を付け替えた日に過去の Shot の絵が変わる。
 */

/** select の未選択を表す値。`null` ではなく空文字で持つ（DOM の値がそれしか無いため）。 */
export const UNSELECTED = ''

export type Prominence = ShotCastEntry['prominence']

export type CastRow = {
  /** React の key。characterId を選び直しても行の同一性が保たれるよう、別に持つ。 */
  readonly key: string
  readonly characterId: string
  readonly lookId: string
  readonly prominence: string
  /** 入力欄の生値。数値へ落とすのは検証のときだけ。 */
  readonly order: string
}

export type CastField = 'characterId' | 'lookId' | 'prominence' | 'order'
export type CastRowErrors = Readonly<Partial<Record<CastField, string>>>

export type CastValidation =
  | { readonly ok: true; readonly entries: readonly ShotCastEntry[] }
  /** 行の key ごとのエラー。行が消えても対応が崩れないよう index では持たない。 */
  | { readonly ok: false; readonly errors: Readonly<Record<string, CastRowErrors>> }

export const PROMINENCE_LABEL: Readonly<Record<Prominence, string>> = Object.freeze({
  primary: '主役（画面の中心）',
  secondary: '脇（はっきり映る）',
  background: '背景（人影として映る）',
})

export const PROMINENCE_OPTIONS: readonly SelectOption[] = Object.freeze(
  ShotCastEntry.shape.prominence.options.map((value) => ({
    value,
    label: PROMINENCE_LABEL[value],
  })),
)

export const NO_CHARACTER_OPTION_LABEL = 'キャラクターを選ぶ'
export const NO_LOOK_OPTION_LABEL = 'Look（衣装）を選ぶ'

export const CHARACTER_REQUIRED_MESSAGE = 'キャラクターを選んでください。'
export const LOOK_REQUIRED_MESSAGE =
  'Look（衣装）を選んでください。Shot ごとに 1 つ必ず決める必要があります。'
export const LOOK_MISSING_MESSAGE =
  'このキャラクターには Look がありません。キャラクター詳細で Look を作ってください。'
export const FOREIGN_LOOK_MESSAGE = 'その Look は選んだキャラクターのものではありません。'
export const DUPLICATE_CHARACTER_MESSAGE = 'このキャラクターは既にこの Shot に出ています。'
export const PROMINENCE_REQUIRED_MESSAGE = '映り方を選んでください。'
export const ORDER_INVALID_MESSAGE = '表示順は 0 以上の整数で入力してください。'

/** 誰も出ていない状態。**読み込み失敗と混同させない**（tasks/lessons.md L-015）。 */
export const CAST_EMPTY_NOTICE =
  'この Shot にはまだ誰も出ていません。登場人物を追加すると、その人の四面図と Look が生成の参照に載ります。'

/** キャラクターが 1 人も登録されていない状態。次にやることを必ず書く。 */
export const NO_CHARACTERS_NOTICE =
  'キャラクターが 1 人も登録されていません。先にキャラクターを登録すると、この Shot に割り当てられます。'

export const CAST_LOAD_FAILED_TITLE = '登場人物を読み込めませんでした'

/** **解除は削除ではない。** 何が起きて何が起きないかを両方書く。 */
export const unlinkConfirmMessage = (name: string): string =>
  `${name}をこの Shot から解除します。キャラクター自体は削除されません。`

export const UNSAVED_ROW_CONFIRM_MESSAGE = 'まだ保存していない行を取り消します。'

/**
 * 表示用のキャラクター名。
 *
 * 一覧を読み込めなかったときや、選択中のキャラクターが削除済みのときは名前を引けない。
 * そこで空文字に潰すと「誰も付いていない」と誤解されるため、ID をそのまま出す。
 */
export const describeCharacter = (characterId: string, characters: readonly Character[]): string =>
  characters.find((c) => c.id === characterId)?.displayName ?? characterId

export const describeLook = (lookId: string, looks: readonly CharacterLook[]): string =>
  looks.find((look) => look.id === lookId)?.name ?? lookId

/** その Character の Look だけに絞る。API と同じ「他人の Look は指せない」規則の表側。 */
export const looksOf = (
  characterId: string,
  looks: readonly CharacterLook[],
): readonly CharacterLook[] => looks.filter((look) => look.characterId === characterId)

/** 既定の Look（無ければ先頭）。どちらも無ければ未選択のまま返す。 */
export const defaultLookId = (looks: readonly CharacterLook[]): string =>
  (looks.find((look) => look.isDefault) ?? looks[0])?.id ?? UNSELECTED

export const toCharacterOptions = (characters: readonly Character[]): readonly SelectOption[] => [
  { value: UNSELECTED, label: NO_CHARACTER_OPTION_LABEL },
  ...characters.map((character) => ({ value: character.id, label: character.displayName })),
]

export const toLookOptions = (looks: readonly CharacterLook[]): readonly SelectOption[] => [
  { value: UNSELECTED, label: NO_LOOK_OPTION_LABEL },
  ...looks.map((look) => ({
    value: look.id,
    label: look.isDefault ? `${look.name}（既定）` : look.name,
  })),
]

/** 保存済みの登場人物を編集用の行へ。key は characterId（API が重複を許さない）。 */
export const toCastRows = (cast: readonly ShotCharacter[]): readonly CastRow[] =>
  [...cast]
    .sort((a, b) => a.order - b.order)
    .map((entry) => ({
      key: entry.characterId,
      characterId: entry.characterId,
      lookId: entry.lookId,
      prominence: entry.prominence,
      order: String(entry.order),
    }))

/** 既存の最大 order の次。行が無ければ 0。 */
export const nextOrder = (rows: readonly CastRow[]): number => {
  const orders = rows
    .map((row) => Number.parseInt(row.order, 10))
    .filter((value) => Number.isInteger(value) && value >= 0)
  return orders.length === 0 ? 0 : Math.max(...orders) + 1
}

export const emptyCastRow = (key: string, order: number): CastRow => ({
  key,
  characterId: UNSELECTED,
  lookId: UNSELECTED,
  prominence: 'secondary',
  order: String(order),
})

/** 行を差し替える。**元の配列は変えない。** */
export const replaceRow = (
  rows: readonly CastRow[],
  key: string,
  patch: Partial<Omit<CastRow, 'key'>>,
): readonly CastRow[] => rows.map((row) => (row.key === key ? { ...row, ...patch } : row))

export const removeRow = (rows: readonly CastRow[], key: string): readonly CastRow[] =>
  rows.filter((row) => row.key !== key)

/**
 * キャラクターを選び直したら Look も付け替える。
 * 前のキャラクターの Look を残すと、API の「他人の Look」検証で 422 になる。
 * 既定 Look が分かっているならその場で埋め、利用者に選び直しを強いない。
 */
export const applyCharacterChange = (
  rows: readonly CastRow[],
  key: string,
  characterId: string,
  looks: readonly CharacterLook[],
): readonly CastRow[] =>
  replaceRow(rows, key, {
    characterId,
    lookId: characterId === UNSELECTED ? UNSELECTED : defaultLookId(looksOf(characterId, looks)),
  })

const toOrder = (raw: string): number | null => {
  const trimmed = raw.trim()
  if (!/^\d+$/u.test(trimmed)) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isSafeInteger(parsed) ? parsed : null
}

const lookErrorFor = (row: CastRow, looks: readonly CharacterLook[]): string | undefined => {
  if (row.lookId === UNSELECTED) {
    return looksOf(row.characterId, looks).length === 0 && row.characterId !== UNSELECTED
      ? LOOK_MISSING_MESSAGE
      : LOOK_REQUIRED_MESSAGE
  }

  const found = looks.find((look) => look.id === row.lookId)
  // 読み込めていない Look は「他人のもの」と決めつけない。判定は API に委ねる。
  if (found === undefined) return undefined
  return found.characterId === row.characterId ? undefined : FOREIGN_LOOK_MESSAGE
}

const errorsForRow = (
  row: CastRow,
  looks: readonly CharacterLook[],
  duplicated: boolean,
): CastRowErrors => {
  const characterId =
    row.characterId === UNSELECTED
      ? CHARACTER_REQUIRED_MESSAGE
      : duplicated
        ? DUPLICATE_CHARACTER_MESSAGE
        : undefined
  const lookId = lookErrorFor(row, looks)
  const prominence = ShotCastEntry.shape.prominence.safeParse(row.prominence).success
    ? undefined
    : PROMINENCE_REQUIRED_MESSAGE
  const order = toOrder(row.order) === null ? ORDER_INVALID_MESSAGE : undefined

  return Object.fromEntries(
    Object.entries({ characterId, lookId, prominence, order }).filter(
      ([, message]) => message !== undefined,
    ),
  )
}

const duplicatedIds = (rows: readonly CastRow[]): ReadonlySet<string> => {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const row of rows) {
    if (row.characterId === UNSELECTED) continue
    if (seen.has(row.characterId)) duplicates.add(row.characterId)
    seen.add(row.characterId)
  }
  return duplicates
}

/**
 * 送信前の検証。
 * ULID かどうかの形の判定は zod（ドメイン）に委ね、画面側で形を持たない。
 */
export const validateCast = (
  rows: readonly CastRow[],
  looks: readonly CharacterLook[],
): CastValidation => {
  const duplicates = duplicatedIds(rows)

  const perRow = rows.map(
    (row) => [row.key, errorsForRow(row, looks, duplicates.has(row.characterId))] as const,
  )
  const failed = perRow.filter(([, errors]) => Object.keys(errors).length > 0)
  if (failed.length > 0) return { ok: false, errors: Object.fromEntries(failed) }

  const parsed = rows.map((row) => ({
    row,
    result: ShotCastEntry.safeParse({
      characterId: row.characterId,
      lookId: row.lookId,
      prominence: row.prominence,
      order: toOrder(row.order),
    }),
  }))

  const rejected = parsed.filter((item) => !item.result.success)
  if (rejected.length > 0) {
    // ここへ来るのは ULID の形が壊れている場合。行のどこが悪いかは zod の path から引く。
    return {
      ok: false,
      errors: Object.fromEntries(
        rejected.map((item) => [
          item.row.key,
          item.result.success
            ? {}
            : Object.fromEntries(
                item.result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
              ),
        ]),
      ),
    }
  }

  return {
    ok: true,
    entries: parsed.flatMap((item) => (item.result.success ? [item.result.data] : [])),
  }
}
