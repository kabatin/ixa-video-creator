import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateMusicTool } from '../tools/music-generation.js'
import { musicOverviewTool, setMasterTrackTool, uploadMusicTool } from '../tools/music.js'
import { createProjectTool, getProjectTool } from '../tools/project.js'
import { setAiTool, statusTool } from '../tools/status.js'
import { BASE, createFakeApi, depsFor, jsonOf, textOf, TOKEN, ulid, WORKSPACE } from './fake-api.js'

const PROJECT = ulid('PJ1')
const SHOT_A = ulid('SA1')
const SHOT_B = ulid('SB1')
const TRACK = ulid('TR1')
const CHAR = ulid('CH1')
const LOC = ulid('LC1')

const projectRow = (overrides: Record<string, unknown> = {}) => ({
  id: PROJECT,
  workspaceId: WORKSPACE,
  name: 'テスト',
  fps: 24,
  resolution: { width: 1080, height: 1920 },
  aspectRatio: '9:16',
  durationSec: null,
  budgetUsd: null,
  status: 'planning',
  ...overrides,
})

const shotRow = (id: string, order: number, overrides: Record<string, unknown> = {}) => ({
  id,
  order,
  code: `CUT${String(order + 1)}`,
  startSec: order * 2.5,
  durationSec: 2.5,
  description: '',
  mood: null,
  camera: { size: 'wide', angleH: null, angle: 'low', lensMm: null, movement: null, movementIntensity: null },
  locationId: null,
  selectedTakeId: null,
  status: 'draft',
  ...overrides,
})

describe('create_project', () => {
  it('形から大きさを決め、avoid は作った後に直し、コンセプトを脚本の版として残す', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: '/projects', status: 201, data: projectRow() },
      { method: 'PATCH', path: `/projects/${PROJECT}`, data: projectRow({ avoid: '文字' }) },
      { method: 'POST', path: `/projects/${PROJECT}/script/versions`, status: 201, data: { version: { content: 'c' } } },
    ])
    const result = jsonOf(
      await createProjectTool.run({ name: 'テスト', aspectRatio: '9:16', concept: '夏の歌', avoid: '文字' }, depsFor(fake)),
    )
    expect(fake.callsTo('POST', '/projects')[0]?.body).toEqual({
      workspaceId: WORKSPACE,
      name: 'テスト',
      fps: 24,
      resolution: { width: 1080, height: 1920 },
      aspectRatio: '9:16',
    })
    expect(fake.callsTo('PATCH', `/projects/${PROJECT}`)[0]?.body).toEqual({ avoid: '文字' })
    expect(fake.callsTo('POST', `/projects/${PROJECT}/script/versions`)[0]?.body).toEqual({ content: '夏の歌', authoredBy: 'ai' })
    expect(result).toEqual({
      project: expect.objectContaining({ id: PROJECT, resolution: '1080x1920', avoid: '文字' }) as unknown,
    })
    fake.calls.forEach((c) => expect(c.headers.authorization).toBe(`Bearer ${TOKEN}`))
  })

  it('既定は 16:9・1920x1080・24fps。avoid もコンセプトも無ければ 1 回だけ呼ぶ', async () => {
    const fake = createFakeApi([{ method: 'POST', path: '/projects', status: 201, data: projectRow() }])
    await createProjectTool.run({ name: 'x' }, depsFor(fake))
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]?.body).toMatchObject({ aspectRatio: '16:9', fps: 24, resolution: { width: 1920, height: 1080 } })
  })

  it('API の 422 を状態コードと項目つきで返す', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: '/projects', status: 422, raw: { success: false, error: '入力の検証に失敗しました', fields: { name: ['長すぎます'] } } },
    ])
    const result = await createProjectTool.run({ name: 'x' }, depsFor(fake))
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('ixa API 422 (POST /projects): 入力の検証に失敗しました name: 長すぎます')
  })
})

describe('get_project', () => {
  it('Shot を順に並べ、場所・登場人物・最初のコマ・つなぎを名前つきで畳む', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/projects/${PROJECT}`, data: projectRow() },
      { method: 'GET', path: `/projects/${PROJECT}/script`, status: 404, data: 'なし' },
      {
        method: 'GET',
        path: `/projects/${PROJECT}/shots`,
        data: [shotRow(SHOT_B, 1), shotRow(SHOT_A, 0, { locationId: LOC, description: '走る', mood: '明るい' })],
      },
      { method: 'GET', path: `/projects/${PROJECT}/music-tracks`, data: [{ id: TRACK, mediaAssetId: ulid('MD1'), title: '曲', isMaster: true }] },
      { method: 'GET', path: `/projects/${PROJECT}/characters`, data: [{ id: CHAR, name: 'hero', displayName: '主人公' }] },
      { method: 'GET', path: `/projects/${PROJECT}/locations`, data: [{ id: LOC, name: '海' }] },
      {
        method: 'GET',
        path: `/projects/${PROJECT}/shot-posters`,
        data: [
          { shotId: SHOT_A, hasStartFrame: true, drawing: false },
          { shotId: SHOT_B, hasStartFrame: false, drawing: true },
        ],
      },
      { method: 'GET', path: `/projects/${PROJECT}/transitions`, data: [{ id: ulid('TN1'), fromShotId: SHOT_A, toShotId: SHOT_B, type: 'dissolve', durationSec: 0.5 }] },
      { method: 'GET', path: `/shots/${SHOT_A}/characters`, data: [{ characterId: CHAR, lookId: ulid('LK1'), prominence: 'primary', order: 0 }] },
      { method: 'GET', path: `/shots/${SHOT_B}/characters`, data: [] },
    ])
    const result = jsonOf(await getProjectTool.run({ projectId: PROJECT }, depsFor(fake))) as {
      concept: string
      shots: Record<string, unknown>[]
    }
    expect(result.concept).toBe('')
    expect(result.shots.map((s) => s.id)).toEqual([SHOT_A, SHOT_B])
    expect(result.shots[0]).toEqual({
      id: SHOT_A,
      code: 'CUT1',
      startSec: 0,
      durationSec: 2.5,
      description: '走る',
      mood: '明るい',
      camera: { size: 'wide', angle: 'low' },
      location: '海',
      cast: [{ name: '主人公', prominence: 'primary' }],
      startFrame: 'ready',
      selectedTakeId: null,
      status: 'draft',
      transitionToNext: { type: 'dissolve', durationSec: 0.5 },
    })
    expect(result.shots[1]).toMatchObject({ startFrame: 'drawing', cast: [] })
  })
})

describe('ixa_status / set_ai', () => {
  it('使う AI を 1 つだけ差し替え、他の用途は今の値のまま送る', async () => {
    const settings = { text: 'claude_cli', image: 'klein', video: 'vpipe', voice: 'macos_say', transcribe: 'local' }
    const fake = createFakeApi([
      { method: 'GET', path: '/ai/settings', data: { settings, source: 'saved' } },
      { method: 'PUT', path: '/ai/settings', data: { settings: { ...settings, image: 'fal' }, source: 'saved' } },
    ])
    await setAiTool.run({ purpose: 'image', tool: 'fal' }, depsFor(fake))
    expect(fake.callsTo('PUT', '/ai/settings')[0]?.body).toEqual({ ...settings, image: 'fal' })
  })

  it('状態をまとめて返す（ワークスペースの作品・使えるモデル・動いている生成）', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: '/health', data: { status: 'ok', uptimeSec: 3 } },
      {
        method: 'GET',
        path: '/ai/tools',
        data: {
          tools: [{ id: 'vpipe', label: 'vpipe', status: { state: 'ready', version: null }, problems: { text: 'x', video: null } }],
          recommended: {},
        },
      },
      { method: 'GET', path: '/ai/settings', data: { settings: { video: 'vpipe' }, source: 'default' } },
      {
        method: 'GET',
        path: '/models',
        data: [{ id: 'vpipe/minimax-h3-turbo', label: 'H3', durations: { mode: 'enum', values: [2.333, 10.125] }, costPerSecondUsd: 0, requiresStartFrame: true, routable: true }],
      },
      { method: 'GET', path: '/projects', data: [projectRow()] },
      { method: 'GET', path: `/projects/${PROJECT}/generations/active`, data: [] },
    ])
    const result = jsonOf(await statusTool.run({ projectId: PROJECT }, depsFor(fake))) as Record<string, unknown>
    expect(fake.callsTo('GET', '/projects')[0]?.url).toBe(`${BASE}/projects?workspaceId=${WORKSPACE}`)
    expect(result).toMatchObject({
      api: 'ok',
      aiTools: [{ id: 'vpipe', ready: true, usableFor: ['video'] }],
      videoModels: [{ id: 'vpipe/minimax-h3-turbo', durations: '2.333–10.125s (2 fixed lengths)' }],
      projects: [{ id: PROJECT, name: 'テスト' }],
      activeGenerations: [],
    })
  })
})

describe('曲', () => {
  it('generate_music は契約どおりの本文で投げ、待つための手がかりを返す', async () => {
    const JOB = ulid('JB1')
    const fake = createFakeApi([{ method: 'POST', path: `/projects/${PROJECT}/music/generate`, status: 202, data: { jobId: JOB } }])
    const result = jsonOf(
      await generateMusicTool.run({ projectId: PROJECT, prompt: 'city pop', durationSec: 60, count: 2, title: '夏' }, depsFor(fake)),
    )
    expect(fake.calls[0]?.body).toEqual({ prompt: 'city pop', lyrics: '', durationSec: 60, instrumental: false, count: 2, title: '夏' })
    expect(result).toEqual({ jobId: JOB, next: { tool: 'wait', jobs: [{ kind: 'music', id: JOB }] } })
  })

  /** ADR-0048 追記。どの曲の AI が歌なしだけかを、呼ぶ側が送る前に知れるように説明に書く。 */
  it('generate_music の説明は、既定の Stable Audio が歌なしだけ・190 秒までで、歌ありは ACE-Step に回ると言う', () => {
    expect(generateMusicTool.description).toMatch(/stable_audio_medium_music \(the default\) makes instrumental BGM only/)
    expect(generateMusicTool.description).toMatch(/10–190 s/)
    expect(generateMusicTool.description).toMatch(/routed to a singing AI \(ace_step, then minimax_music3\)/)
    expect(generateMusicTool.description).toMatch(/409/)
  })

  /** MiniMax-Music3 Community License は名前の表記を求める。遅さと、長さが上限であることも呼ぶ側に伝える。 */
  it('generate_music の説明は、MiniMax-Music3 の遅さ・長さが上限・歌詞が空なら歌なしを言う', () => {
    expect(generateMusicTool.description).toMatch(/minimax_music3 \(MiniMax-Music3\)/)
    expect(generateMusicTool.description).toMatch(/about 10 minutes per 60 s/)
    expect(generateMusicTool.description).toMatch(/upper bound/)
    expect(generateMusicTool.description).toMatch(/empty lyrics are made instrumental/)
  })

  it('upload_music は sign → PUT（鍵なし）→ complete（sha256）→ 曲 → 解析の順', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ixa-mcp-up-'))
    const file = join(dir, 'song.mp3')
    const bytes = Buffer.from('ID3 fake mp3')
    await writeFile(file, bytes)
    const MEDIA = ulid('MD1')
    const fake = createFakeApi([
      { method: 'POST', path: '/uploads/sign', data: { mediaAssetId: MEDIA, storageKey: 'k', uploadUrl: 'http://storage.test/files/k?sig=S', expiresInSec: 600 } },
      { method: 'PUT', path: '/files/k', data: {} },
      { method: 'POST', path: '/uploads/complete', data: { id: MEDIA, queued: true } },
      { method: 'POST', path: `/projects/${PROJECT}/music-tracks`, status: 201, data: { id: TRACK, mediaAssetId: MEDIA, title: 'song', isMaster: true } },
      { method: 'POST', path: `/music-tracks/${TRACK}/analysis`, status: 202, data: { musicTrackId: TRACK, queued: true } },
    ])
    try {
      const result = jsonOf(await uploadMusicTool.run({ projectId: PROJECT, filePath: file }, depsFor(fake)))
      expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
        'POST /uploads/sign',
        'PUT /files/k',
        'POST /uploads/complete',
        `POST /projects/${PROJECT}/music-tracks`,
        `POST /music-tracks/${TRACK}/analysis`,
      ])
      expect(fake.calls[0]?.body).toEqual({
        workspaceId: WORKSPACE,
        projectId: PROJECT,
        kind: 'audio',
        fileName: 'song.mp3',
        contentType: 'audio/mpeg',
        bytes: bytes.length,
      })
      expect(fake.calls[1]?.headers.authorization).toBeUndefined()
      expect(fake.calls[2]?.body).toMatchObject({
        checksumSha256: createHash('sha256').update(bytes).digest('hex'),
        uploadedBy: 'mcp',
        mimeType: 'audio/mpeg',
      })
      expect(fake.calls[3]?.body).toEqual({ mediaAssetId: MEDIA, title: 'song', isMaster: true })
      expect(result).toMatchObject({ musicTrackId: TRACK, analysisQueued: true })
      expect(JSON.stringify(result)).not.toContain('sig=S')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('upload_music は音ではないファイルを上げる前に断る', async () => {
    const fake = createFakeApi([])
    const result = await uploadMusicTool.run({ projectId: PROJECT, filePath: '/tmp/picture.png' }, depsFor(fake))
    expect(textOf(result)).toContain('audio ではありません')
    expect(fake.calls).toHaveLength(0)
  })

  it('set_master_track は主役にしてから解析を始める', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/music-tracks/${TRACK}/set-master`, data: [{ id: TRACK, mediaAssetId: ulid('MD1'), title: '曲', isMaster: true }] },
      { method: 'POST', path: `/music-tracks/${TRACK}/analysis`, status: 202, data: { musicTrackId: TRACK, queued: true } },
    ])
    const result = jsonOf(await setMasterTrackTool.run({ musicTrackId: TRACK }, depsFor(fake)))
    expect(result).toMatchObject({ analysisQueued: true, next: { jobs: [{ kind: 'analysis', id: TRACK }] } })
  })

  it('music_overview は master track を探し、解析がまだならそう言う', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/projects/${PROJECT}/music-tracks`, data: [{ id: TRACK, mediaAssetId: ulid('MD1'), title: '曲', isMaster: true }] },
      { method: 'GET', path: `/music-tracks/${TRACK}/analysis`, status: 404, data: 'まだ' },
      { method: 'GET', path: `/music-tracks/${TRACK}/analysis/failure`, data: null },
    ])
    const result = jsonOf(await musicOverviewTool.run({ projectId: PROJECT }, depsFor(fake)))
    expect(result).toMatchObject({ musicTrackId: TRACK, analysis: expect.stringContaining('not ready') as unknown })
  })

  it('music_overview は曲が無ければ作るよう促す', async () => {
    const fake = createFakeApi([{ method: 'GET', path: `/projects/${PROJECT}/music-tracks`, data: [] }])
    const result = await musicOverviewTool.run({ projectId: PROJECT }, depsFor(fake))
    expect(textOf(result)).toContain('generate_music')
  })
})
