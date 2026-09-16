import { Shot } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { shotJson } from '@/__tests__/fixtures'
import { ApiError, TRANSPORT_ERROR_STATUS } from '@/lib/api-error'
import { NONE_VALUE } from '@/lib/camera-options'
import {
  SAVE_FAILED_PREFIX,
  initialShotEditValues,
  isShotEditDirty,
  shotEditErrorsFromApi,
  toCameraFieldValues,
  validateShotEditForm,
  type EditableShot,
  type ShotEditFormValues,
} from '@/lib/shot-edit-form'

/** ワイヤ表現からドメインの Shot へ。日時だけ Date に直せば残りはそのまま通る。 */
const savedShot = (overrides: Partial<EditableShot> = {}): EditableShot => {
  const parsed = Shot.parse({
    ...shotJson,
    lockedAt: null,
    createdAt: new Date(shotJson.createdAt),
    updatedAt: new Date(shotJson.updatedAt),
  })
  return { ...parsed, ...overrides }
}

const values = (overrides: Partial<ShotEditFormValues> = {}): ShotEditFormValues => ({
  ...initialShotEditValues(savedShot()),
  ...overrides,
})

describe('initialShotEditValues', () => {
  it('保存済みの Shot をフォームの文字列へ戻す', () => {
    expect(initialShotEditValues(savedShot())).toEqual({
      code: 'S01-010',
      startSec: '0',
      durationSec: '4',
      description: '夜のスタジアム',
      mood: 'tense',
      size: 'medium',
      angleH: 'front',
      angle: 'eye',
      lensMm: '35',
      movement: 'push_in',
      movementIntensity: 'subtle',
    })
  })

  it('null のカメラ列は「未指定」になる', () => {
    const shot = savedShot({
      camera: {
        size: 'wide',
        angleH: null,
        angle: null,
        lensMm: null,
        movement: null,
        movementIntensity: null,
      },
    })

    const result = initialShotEditValues(shot)

    expect(result.angleH).toBe(NONE_VALUE)
    expect(result.lensMm).toBe(NONE_VALUE)
    expect(result.movementIntensity).toBe(NONE_VALUE)
  })

  it('mood が null なら空欄になる', () => {
    expect(initialShotEditValues(savedShot({ mood: null })).mood).toBe('')
  })

  it('小数の秒を丸めない', () => {
    const result = initialShotEditValues(savedShot({ startSec: 12.75, durationSec: 3.5 }))

    expect(result.startSec).toBe('12.75')
    expect(result.durationSec).toBe('3.5')
  })
})

describe('validateShotEditForm', () => {
  it('正しい入力を PATCH の本文へ変換する', () => {
    const result = validateShotEditForm(
      values({
        code: '  S01-020  ',
        startSec: '1.5',
        durationSec: '4.25',
        description: '  夜の路地  ',
        mood: '  calm  ',
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.code).toBe('S01-020')
    expect(result.patch.startSec).toBe(1.5)
    expect(result.patch.durationSec).toBe(4.25)
    expect(result.patch.description).toBe('夜の路地')
    expect(result.patch.mood).toBe('calm')
  })

  it('変化が無くても 6 列すべてを載せる（空の本文を作らない）', () => {
    const result = validateShotEditForm(values())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.patch).sort()).toEqual([
      'camera',
      'code',
      'description',
      'durationSec',
      'mood',
      'startSec',
    ])
  })

  it('mood を空にすると null を送る（未設定と空文字を混ぜない）', () => {
    const result = validateShotEditForm(values({ mood: '   ' }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.mood).toBeNull()
  })

  it.each(['', '   '])('コード %s はコードのエラーになる', (code) => {
    const result = validateShotEditForm(values({ code }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.code).toBeDefined()
    expect(result.errors.startSec).toBeUndefined()
  })

  it('カメラの選択値をそのまま載せる', () => {
    const result = validateShotEditForm(
      values({ size: 'closeup', angleH: 'side_left', angle: 'low', lensMm: '85' }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.camera).toEqual({
      size: 'closeup',
      angleH: 'side_left',
      angle: 'low',
      lensMm: 85,
      movement: 'push_in',
      movementIntensity: 'subtle',
    })
  })

  it('「未指定」のカメラ列は null になる', () => {
    const result = validateShotEditForm(
      values({
        angleH: NONE_VALUE,
        angle: NONE_VALUE,
        lensMm: NONE_VALUE,
        movement: NONE_VALUE,
        movementIntensity: NONE_VALUE,
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.camera).toEqual({
      size: 'medium',
      angleH: null,
      angle: null,
      lensMm: null,
      movement: null,
      movementIntensity: null,
    })
  })

  it('説明を空にできる（消した意図を 0 文字として送る）', () => {
    const result = validateShotEditForm(values({ description: '   ' }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.description).toBe('')
  })

  it.each(['', '   ', 'abc', '-1'])('開始秒 %s は開始秒のエラーになる', (startSec) => {
    const result = validateShotEditForm(values({ startSec }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.startSec).toBeDefined()
    expect(result.errors.durationSec).toBeUndefined()
  })

  it.each(['', '0', '-2', 'abc'])('尺 %s は尺のエラーになる', (durationSec) => {
    const result = validateShotEditForm(values({ durationSec }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.durationSec).toBeDefined()
  })

  it.each(['0', '-35', 'abc'])('レンズ %s はレンズのエラーになる', (lensMm) => {
    const result = validateShotEditForm(values({ lensMm }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.lensMm).toBeDefined()
  })

  it('未知の景別はカメラの欄のエラーになる', () => {
    const result = validateShotEditForm(values({ size: 'gigantic' }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.size).toBeDefined()
    expect(result.errors.form).toBeUndefined()
  })
})

describe('isShotEditDirty', () => {
  it('保存済みの値と同じなら偽', () => {
    const shot = savedShot()

    expect(isShotEditDirty(initialShotEditValues(shot), shot)).toBe(false)
  })

  it.each<keyof ShotEditFormValues>([
    'code',
    'startSec',
    'durationSec',
    'description',
    'mood',
    'size',
    'angleH',
    'angle',
    'lensMm',
    'movement',
    'movementIntensity',
  ])('%s を変えると真になる', (field) => {
    const shot = savedShot()
    const changed = { ...initialShotEditValues(shot), [field]: 'wide' }

    expect(isShotEditDirty(changed, shot)).toBe(true)
  })

  it('カメラ列を「未指定」に戻した場合も差分として扱う', () => {
    const shot = savedShot()
    const changed = values({ movement: NONE_VALUE })

    expect(isShotEditDirty(changed, shot)).toBe(true)
  })
})

describe('toCameraFieldValues', () => {
  it('編集中のカメラ列をそのまま渡す', () => {
    const result = toCameraFieldValues(values({ size: 'insert', lensMm: '24' }))

    expect(result.size).toBe('insert')
    expect(result.lensMm).toBe('24')
    expect(result.angleH).toBe('front')
  })

  it('編集で扱わない列も埋めて、入力欄の型を満たす', () => {
    const result = toCameraFieldValues(values())

    expect(result.locationId).toBeDefined()
  })
})

const DUPLICATE = 'このコードは同じ Project の別の Shot が使っています'

/** サーバのエラー封筒（`apps/api/src/response.ts` の `ErrorResponse`）を模す。 */
const apiError = (status: number, body: unknown): ApiError =>
  new ApiError('API が失敗しました', status, JSON.stringify(body))

describe('shotEditErrorsFromApi', () => {
  it('コードの重複をコードの欄に出す', () => {
    const errors = shotEditErrorsFromApi(
      apiError(422, { success: false, error: '入力の検証に失敗しました', fields: { code: [DUPLICATE] } }),
    )

    expect(errors.code).toBe(DUPLICATE)
    expect(errors.form).toBeUndefined()
  })

  it('カメラの入れ子のキーを対応する欄へ割り当てる', () => {
    const errors = shotEditErrorsFromApi(
      apiError(422, {
        success: false,
        error: '入力の検証に失敗しました',
        fields: { 'camera.lensMm': ['0 より大きいこと'], 'camera.size': ['不正な値'] },
      }),
    )

    expect(errors.lensMm).toBe('0 より大きいこと')
    expect(errors.size).toBe('不正な値')
  })

  it('同じ欄に複数の指摘が来たらまとめて出す', () => {
    const errors = shotEditErrorsFromApi(
      apiError(422, { success: false, error: 'x', fields: { code: ['短すぎます', DUPLICATE] } }),
    )

    expect(errors.code).toBe(`短すぎます / ${DUPLICATE}`)
  })

  it('画面に欄が無い列の指摘も欄名を添えて form に残す', () => {
    const errors = shotEditErrorsFromApi(
      apiError(422, { success: false, error: 'x', fields: { locationId: ['ULID ではありません'] } }),
    )

    expect(errors.form).toBe('locationId: ULID ではありません')
  })

  it('対応表に無いキーだけでも空を返さない（拒否を黙らせない）', () => {
    const errors = shotEditErrorsFromApi(
      apiError(422, { success: false, error: 'x', fields: { '(root)': ['本文が不正です'] } }),
    )

    expect(Object.keys(errors).length).toBeGreaterThan(0)
    expect(errors.form).toContain('本文が不正です')
  })

  it('fields が無い応答は既定の文言になる', () => {
    const errors = shotEditErrorsFromApi(apiError(500, { success: false, error: 'サーバ内部エラー' }))

    expect(errors.form).toContain(SAVE_FAILED_PREFIX)
  })

  it('本文が JSON でなくても落ちない', () => {
    const errors = shotEditErrorsFromApi(new ApiError('502 が返りました', 502, '<html>bad gateway'))

    expect(errors.form).toContain(SAVE_FAILED_PREFIX)
  })

  it('接続できなかった場合も理由を残す', () => {
    const errors = shotEditErrorsFromApi(
      new ApiError('API に接続できませんでした', TRANSPORT_ERROR_STATUS, ''),
    )

    expect(errors.form).toContain('API に接続できませんでした')
  })

  it('ApiError でない例外も握り潰さない', () => {
    const errors = shotEditErrorsFromApi(new Error('想定外'))

    expect(errors.form).toBe(`${SAVE_FAILED_PREFIX}: 想定外`)
  })
})
