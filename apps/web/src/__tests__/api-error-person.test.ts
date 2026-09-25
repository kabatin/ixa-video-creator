import { describe, expect, it } from 'vitest'
import {
  ApiError,
  TRANSPORT_ERROR_STATUS,
  describeError,
  describeErrorForLog,
  describeForPerson,
} from '@/lib/api-error'

/**
 * 画面に出る文の出口はここ 1 つ。
 *
 * **`ApiError.message` を画面に出さない。** メソッド・完全な URL・ステータス・
 * レスポンス本文が入っており、利用者には読めないうえ、本文には署名付き URL のような
 * 出してはいけないものが混じりうる。
 */

/** 画面に出てはいけないものが混ざった、いかにもな失敗。 */
const leaky = (status: number, body: string) =>
  new ApiError(
    `POST http://10.0.0.5:3001/projects/01ABC/renders: API が ${String(status)} を返しました`,
    status,
    body,
  )

describe('describeForPerson', () => {
  it('検証の失敗は項目ごとの理由にする（URL も JSON も出さない）', () => {
    const error = new ApiError(
      'POST http://10.0.0.5:3001/brand-assets: API が 422 を返しました',
      422,
      JSON.stringify({
        success: false,
        error: '入力の検証に失敗しました',
        fields: { value: ['category=color では value が必須です'] },
      }),
    )
    const text = describeForPerson(error)
    expect(text).toBe('入力の検証に失敗しました（value: category=color では value が必須です）')
    expect(text).not.toContain('http')
  })

  it('接続できないときは次の一手まで書く', () => {
    const text = describeForPerson(new ApiError('x', TRANSPORT_ERROR_STATUS, ''))
    expect(text).toContain('繋がりません')
    // 「API を起動してください」は利用者に実行できない指示。
    expect(text).not.toContain('起動')
  })

  /**
   * 以前はここで `error.message` へ倒しており、それが漏れの本体だった。
   * 理由が読めないときは、**理由を消さずに一般的な文へ倒す**。
   */
  it('本文が読めなくても、元の技術的な文には倒さない', () => {
    const text = describeForPerson(leaky(500, '<html>失敗</html>'))
    expect(text).not.toContain('http')
    expect(text).not.toContain('POST')
    expect(text).not.toContain('html')
    // 「失敗した」ことは落とさない。
    expect(text).toContain('500')
  })

  it('本文が JSON でも error が無ければ中身を出さない', () => {
    const text = describeForPerson(leaky(500, JSON.stringify({ mediaUrl: 'https://s3/x?sig=SECRET' })))
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('https')
  })

  it('API 以外の失敗はそのまま', () => {
    expect(describeForPerson(new Error('なにか'))).toBe('なにか')
  })
})

describe('describeError', () => {
  /**
   * 呼び出し元が 46 ファイルある。ここが `message` を返していたため、
   * どこか 1 つでも使えば URL と本文が画面に出ていた。出口を 1 つにする。
   */
  it('describeForPerson と同じ結果を返す（画面に出る文は 1 経路）', () => {
    const error = leaky(500, '<html>')
    expect(describeError(error)).toBe(describeForPerson(error))
  })

  it('URL もレスポンス本文も画面に出さない', () => {
    const text = describeError(leaky(500, JSON.stringify({ token: 'SECRET' })))
    expect(text).not.toContain('10.0.0.5')
    expect(text).not.toContain('SECRET')
  })
})

describe('describeErrorForLog', () => {
  it('技術的な文はログ向けとして残る', () => {
    expect(describeErrorForLog(leaky(500, ''))).toContain('10.0.0.5')
  })
})
