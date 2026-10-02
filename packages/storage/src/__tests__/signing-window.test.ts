import { afterEach, describe, expect, it, vi } from 'vitest'
import { createS3Storage } from '../s3-storage.js'
import { signingWindow } from '../signing-window.js'

/**
 * 同じ物には、しばらく同じ署名付き URL を返す（制作者 2026-10-02「VIDEO1 の調整をしばらく続けていると、
 * この Shot の素材を読み込めませんとエラーが出たり、サムネが表示されなくなったり、ジッターが起きたり」）。
 *
 * 署名を毎回いまの時刻で作ると、編集するたびにタイムラインの 39 本の URL がすべて変わり、
 * プレビューが絵と動画を全部読み直していた。署名の時刻を窓の頭に揃えれば、窓の中では同じ URL になる。
 */

const T0 = Date.UTC(2026, 9, 2, 9, 0, 0)

describe('signingWindow', () => {
  it('同じ窓の中なら、署名の時刻と期限が同じ（= 同じ URL になる）', () => {
    const a = signingWindow(T0 + 1_000, 3600)
    const b = signingWindow(T0 + 899_000, 3600)

    expect(b).toEqual(a)
  })

  it('窓を越えたら署名の時刻が進む', () => {
    expect(signingWindow(T0 + 900_000, 3600).signingDate.getTime()).toBeGreaterThan(
      signingWindow(T0 + 899_000, 3600).signingDate.getTime(),
    )
  })

  it('いつ頼んでも、頼んだ秒数より早くは切れない。延びるのは窓の分（期限の 1/4）まで', () => {
    for (const expiresInSec of [300, 3600]) {
      for (let offsetMs = 0; offsetMs < expiresInSec * 1000; offsetMs += 7_777) {
        const now = T0 + offsetMs
        const { signingDate, expiresInSec: granted } = signingWindow(now, expiresInSec)
        const expiresAt = signingDate.getTime() + granted * 1000

        expect(signingDate.getTime()).toBeLessThanOrEqual(now)
        expect(expiresAt).toBeGreaterThanOrEqual(now + expiresInSec * 1000)
        expect(expiresAt).toBeLessThanOrEqual(now + expiresInSec * 1250 + 1000)
      }
    }
  })
})

describe('createS3Storage の signedGetUrl', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const storage = () =>
    createS3Storage({
      endpoint: 'http://storage.invalid:9000',
      region: 'us-east-1',
      bucket: 'media',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      forcePathStyle: true,
    })

  it('同じ窓の中で同じ物を頼めば、同じ URL を返す。別の物・窓の外なら別の URL', async () => {
    const s3 = storage()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0 + 10_000)
    const first = await s3.signedGetUrl('takes/a.mp4', 3600)
    vi.setSystemTime(T0 + 600_000)
    const again = await s3.signedGetUrl('takes/a.mp4', 3600)
    const other = await s3.signedGetUrl('takes/b.mp4', 3600)
    vi.setSystemTime(T0 + 1_000_000)
    const later = await s3.signedGetUrl('takes/a.mp4', 3600)

    expect(again).toBe(first)
    expect(other).not.toBe(first)
    expect(later).not.toBe(first)
  })
})
