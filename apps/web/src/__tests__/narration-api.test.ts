import { NarrationLineId, ProjectId, VoiceProfileId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from '@/lib/api-client'
import { PROJECT_ID } from '@/__tests__/fixtures'

/**
 * ナレーションと声の呼び出し口（ADR-0038）。API が返す形（日時は ISO 文字列）をそのまま読めること、
 * 経路と本文が API と合っていることを確かめる。
 */

const BASE_URL = 'http://127.0.0.1:3001'
const projectId = ProjectId.parse(PROJECT_ID)
const LINE_ID = '01J9ZK3V8Q4W6N2T5R7Y1X3C9B'
const VOICE_ID = '01J9ZK3V8Q4W6N2T5R7Y1X3C9C'
const TAKE_ID = '01J9ZK3V8Q4W6N2T5R7Y1X3C9D'
const JOB_ID = '01J9ZK3V8Q4W6N2T5R7Y1X3C9E'
const MEDIA_ID = '01J9ZK3V8Q4W6N2T5R7Y1X3C9F'

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const callOf = (index = 0) => {
  const [url, init] = fetchMock.mock.calls[index] ?? []
  return { url, method: init?.method, body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined }
}

/** API の `toOverviewResponse` が返す形。 */
const overviewJson = {
  totalEstimatedSec: 2.4,
  endSec: 12.3,
  lines: [
    {
      id: LINE_ID,
      projectId: PROJECT_ID,
      order: 0,
      text: '進め、戦子',
      reading: '進め、せんこ',
      readingIsManual: false,
      voiceProfileId: VOICE_ID,
      direction: '',
      startSec: 10,
      telop: true,
      selectedTakeId: TAKE_ID,
      createdAt: '2026-10-05T00:00:00.000Z',
      updatedAt: '2026-10-05T00:00:00.000Z',
      estimatedSec: 2.4,
      durationSec: 2.3,
      stale: false,
      takes: [
        {
          id: TAKE_ID,
          lineId: LINE_ID,
          index: 1,
          source: { type: 'generated', voiceJobId: JOB_ID, tool: 'macos_say', model: null, voiceName: 'Kyoko' },
          mediaAssetId: MEDIA_ID,
          inSec: 0,
          outSec: 2.3,
          spokenText: '進め、せんこ',
          displayText: '進め、戦子',
          specHash: 'abc',
          charTimes: null,
          loudnessLufs: -16,
          peaks: [0.1, 0.8],
          costUsd: 0,
          createdAt: '2026-10-05T00:00:00.000Z',
          durationSec: 2.3,
        },
      ],
      job: { id: JOB_ID, kind: 'speak', status: 'succeeded', error: null, tool: 'macos_say', costUsd: 0, queuedAt: '2026-10-05T00:00:00.000Z' },
    },
  ],
}

describe('narration API', () => {
  it('一覧を読む（行・Take・ジョブの日時を Date にする）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: overviewJson }))

    const overview = await createApiClient(BASE_URL).getNarration(projectId)

    expect(callOf().url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/narration`)
    expect(overview.lines[0]?.takes[0]?.peaks).toEqual([0.1, 0.8])
    expect(overview.lines[0]?.takes[0]?.createdAt).toBeInstanceOf(Date)
    expect(overview.lines[0]?.job?.queuedAt).toBeInstanceOf(Date)
  })

  it('まとめて声にする: 行を渡さなければ空の本文（全部）、渡せばその行', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ success: true, data: { jobIds: [], reusedTakeIds: [], skipped: { noVoice: 0, active: 0, upToDate: 0 } } }, 202)),
    )
    const api = createApiClient(BASE_URL)

    await api.speakLines(projectId)
    await api.speakLines(projectId, [NarrationLineId.parse(LINE_ID)])

    expect(callOf(0)).toMatchObject({ url: `${BASE_URL}/projects/${PROJECT_ID}/narration/speak`, method: 'POST', body: {} })
    expect(callOf(1).body).toEqual({ lineIds: [LINE_ID] })
  })

  it('声の種類の一覧は AI と言語を問い合わせに載せる', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { models: [], voices: [{ id: 'Kyoko', label: 'Kyoko', note: null }] } }))

    const options = await createApiClient(BASE_URL).voiceOptions('macos_say', 'ja')

    expect(callOf().url).toBe(`${BASE_URL}/voices/options?tool=macos_say&language=ja`)
    expect(options.voices[0]?.id).toBe('Kyoko')
  })

  it('声を作る本文に作品を載せない（経路が持つ）', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          success: true,
          data: {
            id: VOICE_ID,
            projectId: PROJECT_ID,
            name: 'ナレーター',
            tool: 'macos_say',
            model: null,
            voiceName: 'Kyoko',
            styleNote: '',
            speed: 1,
            volume: 1,
            language: 'ja',
            tuning: {},
            textStyleId: null,
            characterId: null,
            createdAt: '2026-10-05T00:00:00.000Z',
            updatedAt: '2026-10-05T00:00:00.000Z',
          },
        },
        201,
      ),
    )

    const voice = await createApiClient(BASE_URL).createVoice(projectId, { name: 'ナレーター', tool: 'macos_say', voiceName: 'Kyoko' })

    expect(callOf().body).not.toHaveProperty('projectId')
    expect(voice.id).toBe(VoiceProfileId.parse(VOICE_ID))
  })
})
