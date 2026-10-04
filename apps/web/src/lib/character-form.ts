import { CreateCharacterBody } from '@/lib/character-schemas'

/**
 * Character 作成フォームの値と送信前検証。
 * 画面（React）から切り離した純粋関数にして、ブラウザ無しでテストできるようにする。
 */

export type CharacterFormValues = {
  readonly name: string
  readonly displayName: string
  readonly description: string
  readonly identityAnchors: readonly string[]
  readonly styleTokens: readonly string[]
  readonly colorPalette: readonly string[]
}

export type CharacterFormField = keyof CharacterFormValues | 'form'

export type CharacterFormErrors = Readonly<Partial<Record<CharacterFormField, string>>>

export type CharacterFormValidation =
  | { readonly ok: true; readonly input: CreateCharacterBody }
  | { readonly ok: false; readonly errors: CharacterFormErrors }

export const initialCharacterFormValues = (): CharacterFormValues => ({
  name: '',
  displayName: '',
  description: '',
  identityAnchors: [],
  styleTokens: [],
  colorPalette: [],
})

const FIELD_BY_PATH: Readonly<Record<string, CharacterFormField>> = {
  name: 'name',
  displayName: 'displayName',
  description: 'description',
  identityAnchors: 'identityAnchors',
  styleTokens: 'styleTokens',
  colorPalette: 'colorPalette',
}

const fieldForPath = (path: readonly (string | number)[]): CharacterFormField => {
  const head = path[0]
  if (typeof head !== 'string') return 'form'
  return FIELD_BY_PATH[head] ?? 'form'
}

const collectErrors = (
  issues: readonly { path: (string | number)[]; message: string }[],
): CharacterFormErrors =>
  issues.reduce<CharacterFormErrors>((acc, issue) => {
    const field = fieldForPath(issue.path)
    return field in acc ? acc : { ...acc, [field]: issue.message }
  }, {})

/**
 * フォームの値をドメインの `CreateCharacterInput` へ変換する。
 * 空白だけの入力は空として扱い、残りの制約は zod に委ねる。
 */
export const validateCharacterForm = (values: CharacterFormValues): CharacterFormValidation => {
  const name = values.name.trim()
  if (name === '') {
    return { ok: false, errors: { name: 'キャラクター名を入力してください。' } }
  }

  const displayName = values.displayName.trim()
  if (displayName === '') {
    return { ok: false, errors: { displayName: '表示名を入力してください。' } }
  }

  const parsed = CreateCharacterBody.safeParse({
    name,
    displayName,
    description: values.description.trim(),
    identityAnchors: [...values.identityAnchors],
    styleTokens: [...values.styleTokens],
    colorPalette: [...values.colorPalette],
  })

  if (!parsed.success) return { ok: false, errors: collectErrors(parsed.error.issues) }

  return { ok: true, input: parsed.data }
}
