import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { editAudioTool } from '../tools/audio-mix.js'
import { setLyricsTool } from '../tools/lyrics.js'
import { setNarrationTool } from '../tools/narration.js'
import { speakNarrationTool, voiceJobCheck } from '../tools/narration-speak.js'
import { uploadSfxTool } from '../tools/sfx.js'
import { createApiClient } from '../api-client.js'
import { BASE, createFakeApi, depsFor, jsonOf, textOf, TOKEN, ulid, type Route } from './fake-api.js'

/** ナレーション・歌詞・音の仕上げ・手元の効果音。 */

const PROJECT = ulid('PJ1')
const VOICE = ulid('VC1')
const LINE = ulid('NN1')
const TRACK = ulid('TR1')
const MEDIA = ulid('MD1')
const JOB = ulid('JB1')

const line = {
  id: LINE, order: 0, text: '戦子が走る', reading: 'せんこがはしる', readingIsManual: false, voiceProfileId: VOICE,
  direction: '', startSec: null, telop: true, estimatedSec: 1.5, durationSec: null, stale: false, selectedTakeId: null, job: null,
}
const voice = { id: VOICE, name: 'ナレーター', tool: 'gemini_api', model: null, voiceName: 'Kore', styleNote: '', speed: 1, volume: 1, language: 'ja' }
const settings = {
  readingDictionary: [{ written: '戦子', reading: 'せんこ' }, { written: '古い', reading: 'ふるい' }],
  ducking: { enabled: true, depthDb: 10, attackSec: 0.15, releaseSec: 0.4 },
  telopHighlight: { enabled: false, color: '#FFD400' },
}
const narrationRoutes: Route[] = [
  { method: 'GET', path: `/projects/${PROJECT}/voices`, data: [voice] },
  { method: 'GET', path: `/projects/${PROJECT}/narration`, data: { lines: [line], totalEstimatedSec: 1.5, endSec: 0 } },
  { method: 'GET', path: `/projects/${PROJECT}/audio-settings`, data: settings },
  { method: 'PUT', path: `/projects/${PROJECT}/audio-settings`, data: settings },
]

describe('set_narration', () => {
  it('add_script は声を名前から ID にして原稿を足す', async () => {
    const fake = createFakeApi([...narrationRoutes, { method: 'POST', path: `/projects/${PROJECT}/narration/script`, status: 201, data: {} }])
    const result = jsonOf(
      await setNarrationTool.run({ projectId: PROJECT, action: 'add_script', script: '一行目\n二行目', voice: 'ナレーター' }, depsFor(fake)),
    ) as { lines: { voice: string }[] }
    expect(fake.callsTo('POST', `/projects/${PROJECT}/narration/script`)[0]?.body).toEqual({ text: '一行目\n二行目', voiceProfileId: VOICE })
    expect(result.lines[0]?.voice).toBe('ナレーター')
  })

  it('無い声は名前を添えて断り、何も書かない', async () => {
    const fake = createFakeApi(narrationRoutes)
    const result = await setNarrationTool.run({ projectId: PROJECT, action: 'add_script', script: 'x', voice: '誰か' }, depsFor(fake))
    expect(textOf(result)).toContain('あるもの: ナレーター')
    expect(fake.callsTo('POST', /narration/)).toHaveLength(0)
  })

  it('edit_lines は声を ID にし、位置を丸めて 1 行ずつ直す', async () => {
    const fake = createFakeApi([...narrationRoutes, { method: 'PATCH', path: `/narration-lines/${LINE}`, data: {} }])
    jsonOf(
      await setNarrationTool.run(
        { projectId: PROJECT, action: 'edit_lines', lines: [{ lineId: LINE, reading: null, voice: VOICE, startSec: 1.23456 }] },
        depsFor(fake),
      ),
    )
    expect(fake.callsTo('PATCH', `/narration-lines/${LINE}`)[0]?.body).toEqual({ reading: null, startSec: 1.235, voiceProfileId: VOICE })
  })

  it('readings は同じ語を差し替え、指定した語を外し、ほかの設定は残して丸ごと置く', async () => {
    const fake = createFakeApi(narrationRoutes)
    jsonOf(
      await setNarrationTool.run(
        { projectId: PROJECT, action: 'readings', readings: { set: [{ written: '戦子', reading: 'いくさこ' }], remove: ['古い'] } },
        depsFor(fake),
      ),
    )
    expect(fake.callsTo('PUT', `/projects/${PROJECT}/audio-settings`)[0]?.body).toEqual({
      ...settings,
      readingDictionary: [{ written: '戦子', reading: 'いくさこ' }],
    })
  })

  it('arrange は fromSec が無ければ断る', async () => {
    const fake = createFakeApi(narrationRoutes)
    const result = await setNarrationTool.run({ projectId: PROJECT, action: 'arrange' }, depsFor(fake))
    expect(textOf(result)).toContain('fromSec')
  })
})

describe('speak_narration', () => {
  it('speak は行を渡して頼み、声のジョブを待つ先を返す', async () => {
    const fake = createFakeApi([
      {
        method: 'POST', path: `/projects/${PROJECT}/narration/speak`, status: 202,
        data: { jobIds: [JOB], reusedTakeIds: [], skipped: { noVoice: 1, active: 0, upToDate: 0 } },
      },
    ])
    const result = jsonOf(await speakNarrationTool.run({ projectId: PROJECT, lineIds: [LINE] }, depsFor(fake))) as {
      next: { jobs: unknown[] }
      hint: string
    }
    expect(fake.callsTo('POST', `/projects/${PROJECT}/narration/speak`)[0]?.body).toEqual({ lineIds: [LINE] })
    expect(result.next.jobs).toEqual([{ kind: 'voice', id: JOB }])
    expect(result.hint).toMatch(/no usable voice/)
  })

  it('import_recording は上げた素材の長さを待ってから取り込む（ノイズ除去の旗も渡す）', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/media/${MEDIA}`, sequence: [{ data: { probe: null } }, { data: { probe: { durationSec: 12.5 } } }] },
      { method: 'POST', path: `/projects/${PROJECT}/narration/recordings`, status: 202, data: { jobId: JOB } },
    ])
    const result = jsonOf(
      await speakNarrationTool.run({ projectId: PROJECT, action: 'import_recording', mediaAssetId: MEDIA, placeAtSec: 3, denoise: false }, depsFor(fake)),
    ) as { jobIds: string[] }
    expect(fake.callsTo('GET', `/media/${MEDIA}`)).toHaveLength(2)
    expect(fake.callsTo('POST', `/projects/${PROJECT}/narration/recordings`)[0]?.body).toEqual({
      mediaAssetId: MEDIA, voiceProfileId: null, placeAtSec: 3, denoise: false,
    })
    expect(result.jobIds).toEqual([JOB])
  })

  it('import_recording は filePath と mediaAssetId のどちらも無ければ断る', async () => {
    const result = await speakNarrationTool.run({ projectId: PROJECT, action: 'import_recording' }, depsFor(createFakeApi([])))
    expect(textOf(result)).toContain('どちらか 1 つ')
  })

  it('声のジョブの状態を wait の形にする', async () => {
    const fake = createFakeApi([{ method: 'GET', path: `/voice-jobs/${JOB}`, data: { status: 'failed', lineId: LINE, error: '予算' } }])
    const api = createApiClient({ baseUrl: BASE, token: TOKEN, fetch: fake.fetch })
    expect(await voiceJobCheck(api, JOB)).toEqual({ state: 'failed', detail: { lineId: LINE, error: '予算' } })
  })
})

describe('set_lyrics', () => {
  it('歌詞と時刻を送り、置いたテロップの数を返す', async () => {
    const fake = createFakeApi([
      { method: 'PATCH', path: `/projects/${PROJECT}`, data: { lyrics: 'あ\nい', lyricCues: [1, 2.5], instrumental: false } },
      { method: 'POST', path: `/projects/${PROJECT}/clips/lyrics`, data: { clips: [{ id: ulid('C1') }, { id: ulid('C2') }], replacedCount: 1, timedCount: 2, lineCount: 2 } },
    ])
    const result = jsonOf(
      await setLyricsTool.run({ projectId: PROJECT, lyrics: 'あ\nい', lyricCues: [1, 2.5], placeTelops: true }, depsFor(fake)),
    ) as { lines: unknown[]; telops: { placed: number; replaced: number } }
    expect(fake.callsTo('PATCH', `/projects/${PROJECT}`)[0]?.body).toEqual({ lyrics: 'あ\nい', lyricCues: [1, 2.5] })
    expect(result.lines).toEqual([{ index: 0, text: 'あ', startSec: 1 }, { index: 1, text: 'い', startSec: 2.5 }])
    expect(result.telops).toMatchObject({ placed: 2, replaced: 1 })
  })

  it('後ろへ進まない時刻と、何も無い呼び出しは送る前に断る', async () => {
    const fake = createFakeApi([])
    const backwards = await setLyricsTool.run({ projectId: PROJECT, lyricCues: [2, 1] }, depsFor(fake))
    const empty = await setLyricsTool.run({ projectId: PROJECT }, depsFor(fake))
    expect(textOf(backwards)).toContain('後ろへ進む')
    expect(empty.isError).toBe(true)
    expect(fake.calls).toHaveLength(0)
  })
})

describe('edit_audio', () => {
  const routes: Route[] = [
    ...narrationRoutes,
    { method: 'GET', path: `/projects/${PROJECT}/music-tracks`, data: [{ id: TRACK, mediaAssetId: MEDIA, title: '曲', isMaster: true }] },
    { method: 'PATCH', path: `/music-tracks/${TRACK}`, data: { id: TRACK, title: '曲' } },
  ]

  it('曲は主役に送り、ダッキングは今の値に重ねて読み辞書ごと置く', async () => {
    const fake = createFakeApi(routes)
    jsonOf(await editAudioTool.run({ projectId: PROJECT, music: { volume: 0.7, fadeOutSec: 2 }, ducking: { depthDb: 16 } }, depsFor(fake)))
    expect(fake.callsTo('PATCH', `/music-tracks/${TRACK}`)[0]?.body).toEqual({ volume: 0.7, fadeOutSec: 2 })
    expect(fake.callsTo('PUT', `/projects/${PROJECT}/audio-settings`)[0]?.body).toEqual({
      ...settings,
      ducking: { ...settings.ducking, depthDb: 16 },
    })
  })

  it('何も変えなければ読むだけ。範囲外（depthDb 30・音量 3）は断る', async () => {
    const fake = createFakeApi(routes)
    jsonOf(await editAudioTool.run({ projectId: PROJECT }, depsFor(fake)))
    expect(fake.callsTo('PUT', /audio-settings/)).toHaveLength(0)
    expect((await editAudioTool.run({ projectId: PROJECT, ducking: { depthDb: 30 } }, depsFor(fake))).isError).toBe(true)
    expect((await editAudioTool.run({ projectId: PROJECT, music: { volume: 3 } }, depsFor(fake))).isError).toBe(true)
    expect(fake.callsTo('PATCH', /music-tracks/)).toHaveLength(0)
  })
})

describe('upload_sfx', () => {
  const dir = { path: '' }
  beforeAll(async () => {
    dir.path = await mkdtemp(join(tmpdir(), 'ixa-mcp-sfx-'))
    await writeFile(join(dir.path, 'door slam.wav'), Buffer.from('RIFF fake'))
  })
  afterAll(async () => rm(dir.path, { recursive: true, force: true }))

  it('上げて効果音として記し、長さを測ってから SFX 段にそのまま置く', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: '/uploads/sign', data: { mediaAssetId: MEDIA, storageKey: 'k', uploadUrl: 'http://storage.test/files/k?sig=S' } },
      { method: 'PUT', path: '/files/k', data: {} },
      { method: 'POST', path: '/uploads/complete', data: { id: MEDIA } },
      { method: 'POST', path: `/projects/${PROJECT}/uploaded-sfx`, status: 201, data: { id: ulid('US1') } },
      { method: 'GET', path: `/media/${MEDIA}`, data: { probe: { durationSec: 1.2345 } } },
      { method: 'POST', path: `/projects/${PROJECT}/clips`, status: 201, data: { id: ulid('CP1') } },
    ])
    const result = jsonOf(
      await uploadSfxTool.run({ projectId: PROJECT, filePath: join(dir.path, 'door slam.wav'), placeAtSec: 4 }, depsFor(fake)),
    ) as { placed: boolean }
    expect(fake.callsTo('POST', `/projects/${PROJECT}/uploaded-sfx`)[0]?.body).toEqual({ mediaAssetId: MEDIA, title: 'door slam' })
    expect(fake.callsTo('POST', `/projects/${PROJECT}/clips`)[0]?.body).toEqual({
      track: 'SFX',
      startSec: 4,
      durationSec: 1.235,
      content: { type: 'media', mediaAssetId: MEDIA, inSec: 0, outSec: 1.235, volume: 0.8 },
    })
    expect(result.placed).toBe(true)
    expect(JSON.stringify(result)).not.toContain('sig=S')
  })

  it('音ではないファイルは上げる前に断る', async () => {
    const fake = createFakeApi([])
    const result = await uploadSfxTool.run({ projectId: PROJECT, filePath: '/tmp/logo.png' }, depsFor(fake))
    expect(textOf(result)).toContain('audio ではありません')
    expect(fake.calls).toHaveLength(0)
  })
})
