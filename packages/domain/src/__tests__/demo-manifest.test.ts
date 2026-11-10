import { describe, expect, it } from 'vitest'
import {
  DemoManifest,
  DemoStorageKey,
  demoTotalBytes,
  looksLikeSignedUrl,
  publicLeaks,
  demoBindingProblems,
  remapExactValues,
  ulidValues,
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

  it('同じ素材の ID が 2 つあれば断る（中身もファイル名も別）', () => {
    const twice = aManifest({ media: [aMedia(), aMedia({ sha256: 'c'.repeat(64), file: `${'c'.repeat(64)}.mp4` })] })
    expect(DemoManifest.safeParse(twice).success).toBe(false)
  })

  it('同じ中身（sha256）が 2 つあれば断る（ID もファイル名も別）', () => {
    const sameSha = aManifest({ media: [aMedia(), aMedia({ id: MEDIA_B, file: 'other.mp4' })] })
    expect(DemoManifest.safeParse(sameSha).success).toBe(false)
  })

  it('同じファイル名が 2 つあれば断る（ID も中身も別）', () => {
    const sameFile = aManifest({ media: [aMedia(), aMedia({ id: MEDIA_B, sha256: 'c'.repeat(64) })] })
    expect(DemoManifest.safeParse(sameFile).success).toBe(false)
  })

  it('同じ置き場が 2 つあれば断る', () => {
    const entry = { key: 'music/01JP/01JT/peaks.json', file: 'peaks-01.json', sha256: 'b'.repeat(64), sizeBytes: 20 }
    expect(DemoManifest.safeParse(aManifest({ files: [entry, { ...entry, file: 'peaks-02.json', sha256: 'd'.repeat(64) }] })).success).toBe(false)
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

  it('キーに入っていても拾い、そのキーは場所の中でも伏せる（値もキーも返さない）', () => {
    const found = publicLeaks({ request: { '/Users/creator/x': { inner: 'ok' }, fine: '/tmp/a' } }, rules)
    expect(found).toEqual(['request.<key>', 'request.fine'])
    expect(found.join(' ')).not.toContain('creator')
  })

  it('短すぎる利用者名では拾わない（どの文にも当たってしまう）', () => {
    expect(publicLeaks({ a: 'made by ai' }, { secrets: [], homeDir: '', userName: 'ai' })).toEqual([])
  })
})

describe('目録の形の境目', () => {
  it.each([0, -1, 200 * 1024 * 1024 + 1, 1.5])('大きさ %s は断る（正の整数・上限 200 MB）', (sizeBytes) => {
    expect(DemoManifest.safeParse(aManifest({ media: [aMedia({ sizeBytes })] })).success).toBe(false)
  })

  it('上限ちょうどの大きさは通る', () => {
    expect(DemoManifest.safeParse(aManifest({ media: [aMedia({ sizeBytes: 200 * 1024 * 1024 })] })).success).toBe(true)
  })

  it.each(['', '   ', 'あ'.repeat(201)])('題 %j は断る（空・201 文字）', (title) => {
    expect(DemoManifest.safeParse(aManifest({ title })).success).toBe(false)
  })

  it('大文字の sha256 は断る', () => {
    expect(DemoManifest.safeParse(aManifest({ media: [aMedia({ sha256: 'A'.repeat(64) })] })).success).toBe(false)
  })

  it('ファイル名は 128 文字まで', () => {
    const name = (length: number) => `${'a'.repeat(length - 4)}.mp4`
    expect(DemoManifest.safeParse(aManifest({ media: [aMedia({ file: name(128) })] })).success).toBe(true)
    expect(DemoManifest.safeParse(aManifest({ media: [aMedia({ file: name(129) })] })).success).toBe(false)
  })

  it.each([
    'https://github.com/kabatin/ixa-video-creator/releases/download/demo-v1/#x',
    'https://example.com/releases/download/demo-v1/',
    'https://objects.githubusercontent.com/x/',
  ])('取りに行く先 %j は断る（# 付き・github.com 以外）', (baseUrl) => {
    expect(DemoManifest.safeParse(aManifest({ baseUrl })).success).toBe(false)
  })

  it('素材は 200 件、ファイルは 50 件まで', () => {
    const media = (n: number) =>
      Array.from({ length: n }, (_, i) => {
        const sha = i.toString(16).padStart(64, '0')
        return aMedia({ id: `01J${i.toString().padStart(23, '0')}`, sha256: sha, file: `${sha}.mp4`, sizeBytes: 1 })
      })
    expect(DemoManifest.safeParse(aManifest({ media: media(200) })).success).toBe(true)
    expect(DemoManifest.safeParse(aManifest({ media: media(201) })).success).toBe(false)
    const files = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ key: `music/p/t${String(i)}/peaks.json`, file: `w${String(i)}.json`, sha256: i.toString(16).padStart(64, 'f'), sizeBytes: 1 }))
    expect(DemoManifest.safeParse(aManifest({ files: files(50) })).success).toBe(true)
    expect(DemoManifest.safeParse(aManifest({ files: files(51) })).success).toBe(false)
  })

  it('合わせて 500 MB まで', () => {
    const big = (i: number, sizeBytes: number) => aMedia({ id: `01J${String(i).padStart(23, '0')}`, sha256: String(i).padStart(64, '0'), file: `m${String(i)}.mp4`, sizeBytes })
    const mb = 1024 * 1024
    expect(DemoManifest.safeParse(aManifest({ files: [], media: [big(1, 200 * mb), big(2, 200 * mb), big(3, 100 * mb)] })).success).toBe(true)
    expect(DemoManifest.safeParse(aManifest({ files: [], media: [big(1, 200 * mb), big(2, 200 * mb), big(3, 100 * mb + 1)] })).success).toBe(false)
  })

  it.each([
    ['other', 'application/octet-stream'],
    ['lut', 'text/plain'],
    ['image', 'text/html'],
    ['image', 'image/svg+xml'],
    ['video', 'image/png'],
    ['audio', 'video/mp4'],
  ])('素材の種類 %s・%s は断る（絵・動画・音の決まった型だけ）', (kind, contentType) => {
    expect(DemoManifest.safeParse(aManifest({ media: [aMedia({ kind, contentType })] })).success).toBe(false)
  })

  it.each([
    ['image', 'image/png'],
    ['image', 'image/jpeg'],
    ['video', 'video/mp4'],
    ['audio', 'audio/wav'],
    ['audio', 'audio/mpeg'],
  ])('素材の種類 %s・%s は通る', (kind, contentType) => {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'video/mp4': 'mp4', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' }[contentType]
    expect(DemoManifest.safeParse(aManifest({ media: [aMedia({ kind, contentType, file: `${SHA}.${String(ext)}` })] })).success).toBe(true)
  })
})

describe('目録の中の結び付き（demoBindingProblems）', () => {
  const LOCAL = '01JXXXXXXXXXXXXXXXXXXXXXXX'
  const SHOT = '01JSSSSSSSSSSSSSSSSSSSSSSS'
  const bound = (source: Record<string, unknown>) =>
    demoBindingProblems(DemoManifest.parse(aManifest({ source })))

  it('素材は目録の素材・ほかの ID は目録の中で定まったもの・作業場所などは決まった欄だけ', () => {
    expect(
      bound({
        project: { id: OTHER, workspaceId: '01JWWWWWWWWWWWWWWWWWWWWWWW', styleReferenceAssetIds: [MEDIA_A] },
        shots: [{ shot: { id: SHOT, projectId: OTHER }, takes: [{ shotId: SHOT, mediaAssetId: MEDIA_A, copiedFromTakeId: LOCAL }] }],
        tracks: [{ analyses: [{ waveformPeaksKey: 'music/01JP/01JT/peaks.json' }] }],
      }),
    ).toEqual([])
  })

  it('目録に無い ULID を指す欄は断る（この機械の素材に当たってはいけない）', () => {
    expect(bound({ project: { id: OTHER }, shots: [{ takes: [{ mediaAssetId: LOCAL }] }] })).toEqual(['source.shots[0].takes[0].mediaAssetId'])
  })

  it('目録の中の ID と素材の ID が重なれば断る', () => {
    expect(bound({ project: { id: MEDIA_A } })).toEqual(['source.project.id'])
  })

  it('波形の置き場は目録の files のどれか', () => {
    expect(bound({ project: { id: OTHER }, tracks: [{ analyses: [{ waveformPeaksKey: 'music/x/y/peaks.json' }] }] })).toEqual([
      'source.tracks[0].analyses[0].waveformPeaksKey',
    ])
  })
})

describe('公開する目録の点検（鍵と署名の形）', () => {
  const rules = { secrets: [], homeDir: '', userName: '' }
  it.each([
    'https://storage.googleapis.com/b/o?X-Goog-Signature=abc',
    'https://d111.cloudfront.net/x?Key-Pair-Id=K&Signature=s&Policy=p',
    'https://example.com/x?Policy=eyJ',
    'https://maps.example.com/api?key=AIzaSy123',
    'https://api.example.com/v1?api_key=abc',
    'https://user:pw@example.com/x',
    'https%3A%2F%2Fexample.com%2Fx%3Fsig%3Dabc',
    'mail me: creator@example.com',
  ])('%s を拾う', (value) => {
    expect(publicLeaks({ a: value }, rules)).toEqual(['a'])
  })
})

describe('公開する目録の点検（この機械と LAN）', () => {
  const rules = { secrets: [], homeDir: '/Users/creator', userName: 'creator', extraWords: ['Taro Yamada', 'mac-studio'] }
  it.each([
    ['平文の http の URL', 'see http://example.com/page'],
    ['ドットの無いホスト', 'https://intranet/wiki'],
    ['.lan', 'https://nas.lan/share'],
    ['.internal', 'https://build.internal/x'],
    ['.home.arpa', 'https://router.home.arpa/'],
    ['.ts.net', 'https://mac.tail1234.ts.net/x'],
    ['100.64.0.0/10', 'https://100.100.1.2/x'],
    ['IPv6 fc00::/7', 'https://[fd12:3456::1]/x'],
    ['IPv6 fe80::/10', 'https://[fe80::1]/x'],
    ['IPv6 ::1', 'https://[::1]:3001/x'],
    ['スキーム無しの私用 IPv4', 'server at 192.168.0.12'],
    ['スキーム無しの私用 IPv4 とポート', 'vpipe 10.1.2.3:8787 で作った'],
    ['小文字の /users/', '/users/someone/x.png'],
    ['~/ の道', 'saved to ~/Movies/out.mp4'],
    ['大文字小文字の違う利用者名', 'made by CREATOR'],
    ['作る人が渡した語（本名）', 'by taro yamada'],
    ['作る人が渡した語（機械の名前）', 'rendered on Mac-Studio'],
  ])('%s を拾う', (_label, value) => {
    expect(publicLeaks({ a: value }, rules)).toEqual(['a'])
  })

  it.each(['https://example.com/about', '1.2.3.4 は公開のアドレス', 'version 10.2 の機能', 'a/b/c'])('%s は拾わない', (value) => {
    expect(publicLeaks({ a: value }, rules)).toEqual([])
  })
})

describe('素材の拡張子と型', () => {
  it.each([
    ['a.json', 'image/png', 'image'],
    ['a.png', 'image/jpeg', 'image'],
    ['a.mp4', 'video/webm', 'video'],
    ['a.mp3', 'audio/wav', 'audio'],
    ['noext', 'image/png', 'image'],
  ])('%s を %s として宣言した素材は断る（取りに行く前）', (file, contentType, kind) => {
    expect(DemoManifest.safeParse(aManifest({ media: [aMedia({ file, contentType, kind })] })).success).toBe(false)
  })

  it.each([
    ['a.jpg', 'image/jpeg', 'image'],
    ['a.jpeg', 'image/jpeg', 'image'],
    ['a.mov', 'video/quicktime', 'video'],
    ['a.m4a', 'audio/mp4', 'audio'],
  ])('%s・%s は通る', (file, contentType, kind) => {
    expect(DemoManifest.safeParse(aManifest({ media: [aMedia({ file, contentType, kind })] })).success).toBe(true)
  })
})
