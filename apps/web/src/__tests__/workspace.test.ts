import { describe, expect, it } from 'vitest'
import { resolveWorkspaceId } from '@/lib/workspace'

describe('resolveWorkspaceId', () => {
  it('ULID を受け付ける', () => {
    const result = resolveWorkspaceId('01ARZ3NDEKTSV4RRFFQ69G5FAV')
    expect(result.ok).toBe(true)
  })

  it('未設定なら理由を返す', () => {
    const result = resolveWorkspaceId('')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('NEXT_PUBLIC_WORKSPACE_ID')
  })

  it('ULID でなければ理由を返す', () => {
    const result = resolveWorkspaceId('not-a-ulid')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('ULID')
  })
})
