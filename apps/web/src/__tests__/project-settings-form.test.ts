import { Project } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { PROJECT_ID, WORKSPACE_ID } from '@/__tests__/fixtures'
import {
  initialProjectSettingsValues,
  isProjectSettingsUnchanged,
  resolveResolution,
  validateProjectSettings,
  withSettingsAspectRatio,
  type ProjectSettingsValues,
} from '@/lib/project-settings-form'

const project = Project.parse({
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  name: 'iXA CUP MUSIC VIDEO',
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  durationSec: 116,
  budgetUsd: 250,
  styleGuide: 'シネマティック',
  status: 'production',
  createdAt: new Date('2026-09-16T01:02:03.000Z'),
  updatedAt: new Date('2026-09-16T01:02:03.000Z'),
})

const values = (patch: Partial<ProjectSettingsValues> = {}): ProjectSettingsValues => ({
  ...initialProjectSettingsValues(project),
  ...patch,
})

describe('initialProjectSettingsValues', () => {
  it('保存済みの値をそのまま文字列にする', () => {
    expect(initialProjectSettingsValues(project)).toEqual({
      name: 'iXA CUP MUSIC VIDEO',
      aspectRatio: '16:9',
      resolutionKey: '1920x1080',
      fps: '30',
      durationSec: '116',
      budgetUsd: '250',
      styleGuide: 'シネマティック',
      status: 'production',
    })
  })

  it('未設定の尺と予算は空文字にする（"null" と表示しない）', () => {
    const blank = Project.parse({ ...project, durationSec: null, budgetUsd: null })

    const initial = initialProjectSettingsValues(blank)

    expect(initial.durationSec).toBe('')
    expect(initial.budgetUsd).toBe('')
  })
})

describe('withSettingsAspectRatio', () => {
  it('比率を変えると解像度を新しい比率の既定へ戻す', () => {
    const next = withSettingsAspectRatio(values(), '9:16')

    expect(next.aspectRatio).toBe('9:16')
    expect(next.resolutionKey).toBe('1080x1920')
  })

  it('元の値を書き換えない', () => {
    const before = values()

    withSettingsAspectRatio(before, '1:1')

    expect(before.aspectRatio).toBe('16:9')
    expect(before.resolutionKey).toBe('1920x1080')
  })
})

describe('isProjectSettingsUnchanged', () => {
  it('保存済みと同じなら true', () => {
    expect(isProjectSettingsUnchanged(project, values())).toBe(true)
  })

  it('1 つでも違えば false', () => {
    expect(isProjectSettingsUnchanged(project, values({ budgetUsd: '300' }))).toBe(false)
  })
})

describe('resolveResolution', () => {
  it('プリセットに無い既存の解像度も捨てずに解ける', () => {
    expect(resolveResolution('16:9', '2048x1152')).toEqual({ width: 2048, height: 1152 })
  })

  it('解像度として読めない値は undefined', () => {
    expect(resolveResolution('16:9', 'とても大きい')).toBeUndefined()
  })
})

describe('validateProjectSettings', () => {
  it('更新可能な 8 列すべてを patch にする', () => {
    const result = validateProjectSettings(values())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch).toEqual({
      name: 'iXA CUP MUSIC VIDEO',
      aspectRatio: '16:9',
      resolution: { width: 1920, height: 1080 },
      fps: 30,
      durationSec: 116,
      budgetUsd: 250,
      styleGuide: 'シネマティック',
      status: 'production',
    })
  })

  it('尺と予算の空欄は null（未設定）として送る', () => {
    const result = validateProjectSettings(values({ durationSec: '  ', budgetUsd: '' }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.durationSec).toBeNull()
    expect(result.patch.budgetUsd).toBeNull()
  })

  it('尺 0 は未設定に畳まない', () => {
    const result = validateProjectSettings(values({ durationSec: '0' }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.durationSec).toBe(0)
  })

  it('名前が空なら name のエラーにする', () => {
    const result = validateProjectSettings(values({ name: '   ' }))

    expect(result).toEqual({ ok: false, errors: { name: 'プロジェクト名を入力してください。' } })
  })

  it('名前は 200 文字まで', () => {
    const result = validateProjectSettings(values({ name: 'あ'.repeat(201) }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.name).toContain('200')
  })

  it('尺が数値でなければ durationSec のエラーにする', () => {
    const result = validateProjectSettings(values({ durationSec: '1分56秒' }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.durationSec).toBe('尺（秒）は数値で入力してください。')
  })

  it('予算が負なら budgetUsd のエラーにする', () => {
    const result = validateProjectSettings(values({ budgetUsd: '-1' }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.budgetUsd).toBe('予算（USD）は 0 以上で入力してください。')
  })

  it('fps が候補外なら fps のエラーにする', () => {
    const result = validateProjectSettings(values({ fps: '29.97' }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.fps).toContain('24 / 25 / 30 / 60')
  })

  it('状態が候補外なら status のエラーにする', () => {
    const result = validateProjectSettings(values({ status: 'archived' }))

    expect(result).toEqual({ ok: false, errors: { status: '状態を選択してください。' } })
  })

  it('比率が候補外なら aspectRatio のエラーにする', () => {
    const result = validateProjectSettings(values({ aspectRatio: '3:2' }))

    expect(result).toEqual({
      ok: false,
      errors: { aspectRatio: 'アスペクト比を選択してください。' },
    })
  })

  it('解像度が読めなければ resolutionKey のエラーにする', () => {
    const result = validateProjectSettings(values({ resolutionKey: '' }))

    expect(result).toEqual({ ok: false, errors: { resolutionKey: '解像度を選択してください。' } })
  })
})
