import { WorkspaceId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  initialProjectFormValues,
  validateProjectForm,
  withAspectRatio,
  withChosenAspectRatio,
  withChosenResolution,
  withKind,
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

/**
 * 何を作るか（作品の種類）を選ぶと、形をその種類の既定に合わせる。**制作者が形・大きさを自分で選んだら、もう上書きしない。**
 * 素材置き場は形を決めないので、そのまま。
 */
describe('withKind', () => {
  it('既定はミュージックビデオ・横長で、形はまだ選んでいない', () => {
    expect(initialProjectFormValues()).toMatchObject({ kind: 'mv', aspectRatio: '16:9', shapeChosen: false })
  })

  it('形を触っていなければ、種類の既定の形に合わせる（大きさもその形の既定）', () => {
    const next = withKind(initialProjectFormValues(), 'short')
    expect(next).toMatchObject({ kind: 'short', aspectRatio: '9:16', resolutionKey: defaultResolutionKeyFor('9:16') })
  })

  it('ショート動画からミュージックビデオに戻すと、横長に戻る', () => {
    const next = withKind(withKind(initialProjectFormValues(), 'short'), 'mv')
    expect(next).toMatchObject({ kind: 'mv', aspectRatio: '16:9', resolutionKey: defaultResolutionKeyFor('16:9') })
  })

  it('形を自分で選んだら、種類を変えても形と大きさは変えない', () => {
    const chosen = withChosenAspectRatio(initialProjectFormValues(), '1:1')
    expect(chosen.shapeChosen).toBe(true)
    expect(withKind(chosen, 'short')).toMatchObject({ kind: 'short', aspectRatio: '1:1', resolutionKey: chosen.resolutionKey })
  })

  it('大きさだけ選んでも、形を選んだことになる', () => {
    const chosen = withChosenResolution(initialProjectFormValues(), '1280x720')
    expect(withKind(chosen, 'short')).toMatchObject({ aspectRatio: '16:9', resolutionKey: '1280x720', shapeChosen: true })
  })

  it('素材置き場は形を決めないので、いまの形のまま', () => {
    const short = withKind(initialProjectFormValues(), 'short')
    expect(withKind(short, 'library')).toMatchObject({ kind: 'library', aspectRatio: '9:16', shapeChosen: false })
  })

  it('元の値を破壊しない', () => {
    const values = initialProjectFormValues()
    withKind(values, 'short')
    expect(values).toMatchObject({ kind: 'mv', aspectRatio: '16:9' })
  })

  it('選んだ種類を作る入力に入れる', () => {
    const result = validateProjectForm({ ...withKind(initialProjectFormValues(), 'kamishibai'), name: 'A' }, workspaceId)
    expect(result.ok && result.input.kind).toBe('kamishibai')
  })
})
