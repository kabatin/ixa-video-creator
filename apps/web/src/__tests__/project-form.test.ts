import { WorkspaceId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  initialProjectFormValues,
  validateProjectForm,
  withAspectRatio,
} from '@/lib/project-form'
import { defaultResolutionKeyFor, findResolution } from '@/lib/resolution-presets'

const workspaceId = WorkspaceId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV')

describe('validateProjectForm', () => {
  it('正しい入力を CreateProjectInput へ変換する', () => {
    const result = validateProjectForm(
      { ...initialProjectFormValues(), name: '  iXA CUP MUSIC VIDEO  ' },
      workspaceId,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.name).toBe('iXA CUP MUSIC VIDEO')
    expect(result.input.fps).toBe(30)
    expect(result.input.aspectRatio).toBe('16:9')
    expect(result.input.resolution).toEqual({ width: 1920, height: 1080 })
  })

  it('名前が空ならフィールド単位のエラーを返す', () => {
    const result = validateProjectForm(initialProjectFormValues(), workspaceId)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.name).toBeDefined()
    expect(result.errors.fps).toBeUndefined()
  })

  it('未知の fps は fps のエラーになる', () => {
    const result = validateProjectForm(
      { ...initialProjectFormValues(), name: 'A', fps: '12' },
      workspaceId,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.fps).toBeDefined()
  })

  it('アスペクト比に無い解像度は解像度のエラーになる', () => {
    const result = validateProjectForm(
      { ...initialProjectFormValues(), name: 'A', resolutionKey: '9999x1' },
      workspaceId,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.resolutionKey).toBeDefined()
  })
})

describe('withAspectRatio', () => {
  it('アスペクト比を変えると解像度が既定値へ戻る', () => {
    const next = withAspectRatio(initialProjectFormValues(), '9:16')

    expect(next.aspectRatio).toBe('9:16')
    expect(next.resolutionKey).toBe(defaultResolutionKeyFor('9:16'))
    expect(findResolution('9:16', next.resolutionKey)).toEqual({ width: 1080, height: 1920 })
  })

  it('元の値を破壊しない', () => {
    const values = initialProjectFormValues()
    withAspectRatio(values, '1:1')

    expect(values.aspectRatio).toBe('16:9')
  })
})
