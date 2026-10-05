import { VoiceProviderError, type VoiceAdapter } from '@ixa/provider-core'
import { createStubVoice } from '@ixa/provider-voice'
import { describe, expect, it } from 'vitest'
import { json, setupNarration, type Err, type Ok } from './narration-fixture.js'

/**
 * 声（ADR-0038）。作品ごとにナレーター・キャラクターの声を作る。声の種類は AI ごとの一覧から選ぶ。
 */

type Voice = { id: string; name: string; tool: string; voiceName: string; speed: number; styleNote: string }

const aVoiceBody = (patch: Record<string, unknown> = {}) => ({
  name: 'ナレーター',
  tool: 'stub',
  voiceName: 'stub',
  styleNote: '落ち着いた低めの声',
  ...patch,
})

describe('声', () => {
  it('作る（速さ・音量・言語は既定）。一覧に出る', async () => {
    const { send, project } = setupNarration()

    const created = await send('POST', `/projects/${project.id}/voices`, aVoiceBody())
    const list = await json<Ok<Voice[]>>(await send('GET', `/projects/${project.id}/voices`))

    expect(created.status).toBe(201)
    expect((await json<Ok<Voice>>(created)).data).toMatchObject({ name: 'ナレーター', tool: 'stub', speed: 1, styleNote: '落ち着いた低めの声' })
    expect(list.data.map((voice) => voice.name)).toEqual(['ナレーター'])
  })

  it('同じ名前は 409、声に使えない AI（廃止した gemini_cli など）は 422、無い作品は 404', async () => {
    const { send, project } = setupNarration()
    await send('POST', `/projects/${project.id}/voices`, aVoiceBody())

    expect((await send('POST', `/projects/${project.id}/voices`, aVoiceBody())).status).toBe(409)
    expect((await send('POST', `/projects/${project.id}/voices`, aVoiceBody({ name: '別', tool: 'gemini_cli' }))).status).toBe(422)
    expect((await send('POST', '/projects/01ARZ3NDEKTSV4RRFFQ69G5FAV/voices', aVoiceBody())).status).toBe(404)
  })

  it('直す。消すと、その声を使っていた行は「声が未定」に戻る', async () => {
    const { send, project, deps } = setupNarration()
    const voice = (await json<Ok<Voice>>(await send('POST', `/projects/${project.id}/voices`, aVoiceBody()))).data
    await send('POST', `/projects/${project.id}/narration/script`, { text: '進め。', voiceProfileId: voice.id })

    const patched = await send('PATCH', `/voices/${voice.id}`, { speed: 1.2 })
    const deleted = await send('DELETE', `/voices/${voice.id}`)

    expect((await json<Ok<Voice>>(patched)).data.speed).toBe(1.2)
    expect(deleted.status).toBe(204)
    expect(deps.lines.snapshot()[0]?.voiceProfileId).toBeNull()
  })

  it('選べるモデルと声の種類は、その AI の一覧から返す', async () => {
    const { send } = setupNarration()

    const response = await send('GET', '/voices/options?tool=stub&language=ja')

    expect(response.status).toBe(200)
    expect((await json<Ok<unknown>>(response)).data).toEqual({ models: [], voices: [{ id: 'stub', label: 'お試しの声', note: null }] })
  })

  it('一覧を取れなければ、AI の理由をそのまま言う（502）。口の無い AI は 409', async () => {
    const failing: VoiceAdapter = {
      ...createStubVoice(),
      listVoices: () => Promise.reject(new VoiceProviderError('auth', 'ElevenLabs に鍵を受け付けてもらえませんでした', false)),
    }
    const { send } = setupNarration({ adapters: { elevenlabs: failing } })

    const failed = await send('GET', '/voices/options?tool=elevenlabs&language=ja')
    const missing = await send('GET', '/voices/options?tool=macos_say&language=ja')

    expect(failed.status).toBe(502)
    expect((await json<Err>(failed)).error).toMatch(/鍵を受け付けてもらえませんでした/)
    expect(missing.status).toBe(409)
  })
})
