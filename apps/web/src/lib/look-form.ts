import { CreateLookBody } from '@/lib/character-schemas'

/**
 * Look 作成フォームの値と送信前検証。
 * key は Shot から Look を指す識別子で後から変更できないため、形をここで先に弾く。
 */

export type LookFormValues = {
  readonly key: string
  readonly name: string
  readonly era: string
  readonly description: string
  readonly wardrobeTokens: readonly string[]
  readonly isDefault: boolean
}

export type LookFormField = keyof LookFormValues | 'form'

export type LookFormErrors = Readonly<Partial<Record<LookFormField, string>>>

export type LookFormValidation =
  | { readonly ok: true; readonly input: CreateLookBody }
  | { readonly ok: false; readonly errors: LookFormErrors }

export const initialLookFormValues = (): LookFormValues => ({
  key: '',
  name: '',
  era: '',
  description: '',
  wardrobeTokens: [],
  isDefault: false,
})

const FIELD_BY_PATH: Readonly<Record<string, LookFormField>> = {
  key: 'key',
  name: 'name',
  era: 'era',
  description: 'description',
  wardrobeTokens: 'wardrobeTokens',
  isDefault: 'isDefault',
}

const fieldForPath = (path: readonly (string | number)[]): LookFormField => {
  const head = path[0]
  if (typeof head !== 'string') return 'form'
  return FIELD_BY_PATH[head] ?? 'form'
}

const collectErrors = (
  issues: readonly { path: (string | number)[]; message: string }[],
): LookFormErrors =>
  issues.reduce<LookFormErrors>((acc, issue) => {
    const field = fieldForPath(issue.path)
    return field in acc ? acc : { ...acc, [field]: issue.message }
  }, {})

export const validateLookForm = (values: LookFormValues): LookFormValidation => {
  const key = values.key.trim()
  if (key === '') {
    return { ok: false, errors: { key: 'key を入力してください。' } }
  }

  const name = values.name.trim()
  if (name === '') {
    return { ok: false, errors: { name: 'Look 名を入力してください。' } }
  }

  const era = values.era.trim()

  const parsed = CreateLookBody.safeParse({
    key,
    name,
    era: era === '' ? null : era,
    description: values.description.trim(),
    wardrobeTokens: [...values.wardrobeTokens],
    styleTokens: [],
    colorPalette: [],
    isDefault: values.isDefault,
    canonicalFrameAssetId: null,
  })

  if (!parsed.success) return { ok: false, errors: collectErrors(parsed.error.issues) }

  return { ok: true, input: parsed.data }
}
