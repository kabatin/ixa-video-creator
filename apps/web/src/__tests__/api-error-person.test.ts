import { describe, expect, it } from 'vitest'
import { ApiError, TRANSPORT_ERROR_STATUS, describeForPerson } from '@/lib/api-error'

describe('describeForPerson', () => {
  it('検証の失敗は項目ごとの理由にする（URL も JSON も出さない）', () => {
    const error = new ApiError(
      'POST http://192.168.0.42:3001/brand-assets: API が 422 を返しました',
      422,
      JSON.stringify({ success: false, error: '入力の検証に失敗しました', fields: { value: ['category=color では value が必須です'] } }),
    )
    const text = describeForPerson(error)
    expect(text).toBe('入力の検証に失敗しました（value: category=color では value が必須です）')
    expect(text).not.toContain('http')
  })

  it('接続できないときはそう言う', () => {
    expect(describeForPerson(new ApiError('x', TRANSPORT_ERROR_STATUS, ''))).toContain('接続できません')
  })

  it('本文が JSON でなければ元の文に倒す（理由を消さない）', () => {
    expect(describeForPerson(new ApiError('元の文', 500, '<html>'))).toBe('元の文')
  })

  it('API 以外の失敗はそのまま', () => {
    expect(describeForPerson(new Error('なにか'))).toBe('なにか')
  })
})
