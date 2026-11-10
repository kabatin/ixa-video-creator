import { describe, expect, it } from 'vitest'
import {
  DemoManifest,
  DemoStorageKey,
  demoTotalBytes,
  looksLikeSignedUrl,
  publicLeaks,
  remapExactValues,
  ulidValues,
  unlistedMediaReferences,
} from '../index.js'

/**
 * 同梱の見本の作品の目録（ADR-0067）。目録は git に置き、ファイルはリリースに置く。
 * 見たいのは 2 つ。**目録が指すファイルの名前・置き場が外へ抜けない**ことと、
 * **素材の ID の付け替えが値だけを丸ごと替え、漏れも誤爆もしない**こと。
 */

const MEDIA_A = '01JAAAAAAAAAAAAAAAAAAAAAAA'
const MEDIA_B = '01JBBBBBBBBBBBBBBBBBBBBBBB'
const REAL_A = '01JRRRRRRRRRRRRRRRRRRRRRRA'
const REAL_B = '01JRRRRRRRRRRRRRRRRRRRRRRB'
const OTHER = '01JCCCCCCCCCCCCCCCCCCCCCCC'
const SHA = 'a'.repeat(64)

const aMedia = (overrides: Record<string, unknown> = {}) => ({
  id: MEDIA_A,
  file: `${SHA}.mp4`,
  sha256: SHA,
  sizeBytes: 1000,
  contentType: 'video/mp4',
  kind: 'video',
  probe: null,
  ...overrides,
})

const aManifest = (overrides: Record<string, unknown> = {}) => ({
  formatVersion: 1,
  demoKey: 'ixa-demo-v1',
  title: '見本',
  baseUrl: 'https://github.com/kabatin/ixa-video-creator/releases/download/demo-v1/',
  media: [aMedia()],
  files: [{ key: 'music/01JP/01JT/peaks.json', file: 'peaks-01.json', sha256: 'b'.repeat(64), sizeBytes: 20 }],
  source: { project: { id: OTHER } },
  ...overrides,
})

describe('目録の形', () => {
  it('ふつうの目録は通る', () => {
    expect(DemoManifest.safeParse(aManifest()).success).toBe(true)
  })

  it.each(['../x.mp4', 'a/b.mp4', '/abs.mp4', '..', '.hidden', 'a b.mp4', ''])('素材のファイル名 %j は断る', (file) => {
    expect(DemoManifest.safeParse(aManifest({ media: [aMedia({ file })] })).success).toBe(false)
  })

  it.each(['../x.json', 'peaks/../x.json'])('ファイルの名前 %j は断る', (file) => {
    const files = [{ key: 'music/01JP/01JT/peaks.json', file, sha256: SHA, sizeBytes: 1 }]
    expect(DemoManifest.safeParse(aManifest({ files })).success).toBe(false)
  })

  it.each([
    '/music/a/b/peaks.json',
    'music/../media/x',
    'music/a/../../etc/passwd',
    'media/w/m/original.mp4',
    'renders/p/r/output.mp4',
    'music//peaks.json',
    'music/a/b/',
    'music',
  ])('置き場 %j は断る（知っている置き場の中だけ）', (key) => {
    expect(DemoStorageKey.safeParse(key).success).toBe(false)
  })

  it('波形の置き場は通る', () => {
    expect(DemoStorageKey.safeParse('music/01JP/01JT/peaks.json').success).toBe(true)
  })

  it.each([
    'http://example.com/x/',
    'https://example.com/x',
    'https://example.com/x/?sig=abc',
    'https://user:pw@example.com/x/',
    'not a url',
  ])('取りに行く先 %j は断る（https・末尾の / ・問い合わせ無しだけ）', (baseUrl) => {
    expect(DemoManifest.safeParse(aManifest({ baseUrl })).success).toBe(false)
  })

  it('知らない版の目録は断る', () => {
    expect(DemoManifest.safeParse(aManifest({ formatVersion: 2 })).success).toBe(false)
  })

  it('同じ素材の ID・同じファイル名が 2 つあれば断る', () => {
    const twice = aManifest({ media: [aMedia(), aMedia({ sha256: 'c'.repeat(64) })] })
    expect(DemoManifest.safeParse(twice).success).toBe(false)
    const sameFile = aManifest({ media: [aMedia(), aMedia({ id: MEDIA_B, sha256: 'c'.repeat(64) })] })
    expect(DemoManifest.safeParse(sameFile).success).toBe(false)
  })

  it('素材の元のファイル名は目録に持たない（作る人の機械の名前を出さない）', () => {
    const parsed = DemoManifest.parse(aManifest({ media: [aMedia({ originalFilename: '/Users/me/Desktop/秘密.mp4' })] }))
    expect(parsed.media[0]).not.toHaveProperty('originalFilename')
  })

  it('初めて入れるときに取りに行く大きさは素材とファイルの合計', () => {
    expect(demoTotalBytes(DemoManifest.parse(aManifest()))).toBe(1020)
  })
})

describe('素材の ID の付け替え', () => {
  const map = new Map([
    [MEDIA_A, REAL_A],
    [MEDIA_B, REAL_B],
  ])

  it('入れ子の配列・オブジェクトの中まで、値がちょうど ID の所だけ替える', () => {
    const source = {
      project: { id: OTHER, styleReferenceAssetIds: [MEDIA_A, MEDIA_B] },
      clips: [{ content: { type: 'media', mediaAssetId: MEDIA_B } }],
      shots: [{ takes: [{ mediaAssetId: MEDIA_A, spec: { references: [{ assetId: MEDIA_B }] } }] }],
      characterAssets: [{ looks: [{ look: { canonicalFrameAssetId: MEDIA_A }, images: [{ mediaAssetId: MEDIA_B }] }] }],
    }
    expect(remapExactValues(source, map)).toEqual({
      project: { id: OTHER, styleReferenceAssetIds: [REAL_A, REAL_B] },
      clips: [{ content: { type: 'media', mediaAssetId: REAL_B } }],
      shots: [{ takes: [{ mediaAssetId: REAL_A, spec: { references: [{ assetId: REAL_B }] } }] }],
      characterAssets: [{ looks: [{ look: { canonicalFrameAssetId: REAL_A }, images: [{ mediaAssetId: REAL_B }] }] }],
    })
  })

  it('キーは替えない・知らない ID と ID を含むだけの文字は替えない・元は変えない', () => {
    const source = { [MEDIA_A]: MEDIA_A, other: OTHER, key: `music/${MEDIA_A}/peaks.json`, n: 1, b: true, z: null }
    const frozen = structuredClone(source)
    expect(remapExactValues(source, map)).toEqual({
      [MEDIA_A]: REAL_A,
      other: OTHER,
      key: `music/${MEDIA_A}/peaks.json`,
      n: 1,
      b: true,
      z: null,
    })
    expect(source).toEqual(frozen)
  })

  it('値に出てくる ULID を集める（キーは数えない）', () => {
    expect([...ulidValues({ [OTHER]: [MEDIA_A, { x: MEDIA_B }], y: 'abc' })].sort()).toEqual([MEDIA_A, MEDIA_B].sort())
  })
})

describe('書き出す目録の点検', () => {
  it('素材なのに目録に無い ID を拾う', () => {
    const manifest = DemoManifest.parse(aManifest({ source: { shots: [{ mediaAssetId: MEDIA_A }, { mediaAssetId: MEDIA_B }] } }))
    expect(unlistedMediaReferences(manifest, new Set([MEDIA_A, MEDIA_B]))).toEqual([MEDIA_B])
    expect(unlistedMediaReferences(manifest, new Set([MEDIA_A]))).toEqual([])
  })

  it.each([
    'http://127.0.0.1:3001/files/media/x/original.mp4?exp=1&sig=abc',
    'https://bucket.s3.amazonaws.com/x?X-Amz-Signature=abc&X-Amz-Credential=y',
    'https://example.com/a?token=secret',
  ])('署名付きの URL %j を見分ける', (value) => {
    expect(looksLikeSignedUrl(value)).toBe(true)
  })

  it.each(['https://example.com/about', '見本の歌詞 sig=1', 'exp=3'])('ふつうの文 %j は署名付きと見ない', (value) => {
    expect(looksLikeSignedUrl(value)).toBe(false)
  })
})

describe('公開する目録の点検（機械と持ち主の情報）', () => {
  const rules = { secrets: ['s'.repeat(32)], homeDir: '/Users/creator', userName: 'creator' }
  const clean = {
    title: '見本',
    source: {
      project: { lyrics: '夜の街を走る', styleGuide: 'watercolor, soft light' },
      takes: [{ spec: { prompt: 'a girl runs through the city at night' }, providerParams: { kind: 'http', request: {} } }],
      note: 'https://example.com/about と /api/x は書いてよい。a/b/c も。',
    },
  }

  it('中身だけの目録は通る', () => {
    expect(publicLeaks(clean, rules)).toEqual([])
  })

  it.each([
    ['渡した秘密', 'key=ssssssssssssssssssssssssssssssss'],
    ['署名付きの URL', 'https://example.com/x?sig=abc&exp=1'],
    ['この機械のホーム', 'see /Users/creator/Movies/out.mp4'],
    ['この機械の利用者名', 'made by creator'],
    ['/Users/ の道', '/Users/someone/x.png'],
    ['/home/ の道', 'cwd /home/someone/ixa'],
    ['/private/ の道', '/private/tmp/claude/x'],
    ['/var/folders/ の道', '"/var/folders/ab/T/x"'],
    ['/tmp/ の道', '/tmp/ixa-audio/a.wav'],
    ['Windows のドライブ', 'C:\\Users\\x'],
    ['file:// の URL', 'file:///etc/hosts'],
    ['localhost の URL', 'http://localhost:3001/files/x'],
    ['127.0.0.1 の URL', 'http://127.0.0.1:8100/health'],
    ['私用の IPv4 の URL（10.x）', 'http://10.0.0.5:8787/x'],
    ['私用の IPv4 の URL（172.16-31.x）', 'http://172.20.1.2/x'],
    ['私用の IPv4 の URL（192.168.x）', 'https://192.168.1.10/x'],
    ['.local の URL', 'http://mac-studio.local:8080/x'],
  ])('%s を含めば拾い、場所（JSON の道）だけを返す', (_label, value) => {
    const found = publicLeaks({ ...clean, source: { ...clean.source, shots: [{ description: value }] } }, rules)
    expect(found).toEqual(['source.shots[0].description'])
  })

  it('キーに入っていても拾う', () => {
    expect(publicLeaks({ request: { '/Users/creator/x': 1 } }, rules)).toEqual(['request./Users/creator/x'])
  })

  it('短すぎる利用者名では拾わない（どの文にも当たってしまう）', () => {
    expect(publicLeaks({ a: 'made by ai' }, { secrets: [], homeDir: '', userName: 'ai' })).toEqual([])
  })
})
