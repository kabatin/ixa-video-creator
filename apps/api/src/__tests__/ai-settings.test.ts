import { AiToolId, type AiSettings, type AiToolStatus } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import type { AiRoutesDeps } from '../routes/ai.js'
import { baseAppDeps, createTestApp } from './app-deps.js'

/**
 * 使う AI（ADR-0032）。見つかった AI の一覧と、用途ごとの選択の読み書き。
 * **選べるかの規則は domain の `aiChoiceProblem` 1 か所**（一覧の灰色と 422 が同じ理由を言う）。
 */

const OFF = { image: false, video: false }
const DEFAULTS: AiSettings = { text: 'stub', image: 'stub', video: 'stub', voice: 'stub', transcribe: 'stub', music: 'stub', sfx: 'stub', checks: OFF }

const statuses = (ready: readonly AiToolId[]): Record<AiToolId, AiToolStatus> =>
  Object.fromEntries(
    AiToolId.options.map((id) => [
      id,
      ready.includes(id)
        ? { state: 'ready', version: '1.0.0' }
        : { state: 'missing', reason: '入っていません' },
    ]),
  ) as Record<AiToolId, AiToolStatus>

const setup = (
  ready: readonly AiToolId[] = ['stub', 'local', 'claude_cli', 'codex_cli', 'gemini_cli'],
) => {
  const store: { value: AiSettings | null } = { value: null }
  const deps: AiRoutesDeps = {
    settings: {
      get: () => Promise.resolve(store.value),
      save: (settings) => {
        store.value = settings
        return Promise.resolve(settings)
      },
    },
    detect: () => Promise.resolve(statuses(ready)),
    defaults: DEFAULTS,
  }
  return { app: createTestApp({ ...baseAppDeps(), ai: deps }), store }
}

const put = (app: ReturnType<typeof setup>['app'], body: unknown) =>
  app.request('/ai/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

type ToolsBody = {
  data: {
    tools: {
      id: string
      label: string
      status: AiToolStatus
      problems: Record<string, string | null>
      notice: string | null
    }[]
    recommended: AiSettings
  }
}

describe('GET /ai/tools', () => {
  it('見つかった AI と、用途ごとに選べない理由を返す', async () => {
    const { app } = setup()

    const response = await app.request('/ai/tools')
    const body = (await response.json()) as ToolsBody

    expect(response.status).toBe(200)
    const claude = body.data.tools.find((tool) => tool.id === 'claude_cli')
    expect(claude?.status).toEqual({ state: 'ready', version: '1.0.0' })
    expect(claude?.problems.text).toBeNull()
    expect(claude?.problems.image).toMatch(/画像にはまだ使えません/)
    // 入っているが口の無い AI も見せる（選べない理由つき）。
    expect(body.data.tools.find((tool) => tool.id === 'gemini_cli')?.problems.text).toMatch(
      /まだ使えません/,
    )
    // 使える用途でも、見つからなければその理由。
    expect(body.data.tools.find((tool) => tool.id === 'vpipe')?.problems.video).toMatch(
      /入っていません/,
    )
  })

  it('初めて選ぶときの組み合わせを添える', async () => {
    const { app } = setup()

    const body = (await (await app.request('/ai/tools')).json()) as ToolsBody

    expect(body.data.recommended).toEqual({
      text: 'claude_cli',
      image: 'codex_cli',
      video: 'local',
      voice: 'stub',
      transcribe: 'stub',
      music: 'stub',
      sfx: 'stub',
      // チェックは勧めない（Claude の利用枠を使う。ADR-0066）。
      checks: OFF,
    })
  })

  it('声と文字起こしの理由と、使う前に知っておくことも返す（ADR-0038）', async () => {
    const { app } = setup(['stub', 'gemini_api'])

    const body = (await (await app.request('/ai/tools')).json()) as ToolsBody
    const gemini = body.data.tools.find((tool) => tool.id === 'gemini_api')

    expect(gemini?.problems.voice).toBeNull()
    expect(gemini?.problems.transcribe).toBeNull()
    expect(gemini?.problems.video).toMatch(/動画にはまだ使えません/)
    expect(gemini?.notice).toMatch(/製品の改善に使われ/)
    expect(body.data.tools.find((tool) => tool.id === 'claude_cli')?.notice).toBeNull()
  })
})

describe('/ai/settings', () => {
  it('まだ選んでいなければ初期値（環境変数）を、そう名乗って返す', async () => {
    const { app } = setup()

    const body = (await (await app.request('/ai/settings')).json()) as { data: unknown }

    expect(body.data).toEqual({ settings: DEFAULTS, source: 'default' })
  })

  it('選んで保存すると、以後はそれを返す', async () => {
    const { app, store } = setup()
    const chosen = { text: 'claude_cli', image: 'codex_cli', video: 'local', voice: 'stub', transcribe: 'stub', music: 'stub', sfx: 'stub' }

    const saved = await put(app, chosen)
    const body = (await (await app.request('/ai/settings')).json()) as { data: unknown }

    expect(saved.status).toBe(200)
    // チェックを送らなければ切る（チェックを知らない前の画面・MCP から保存しても、勝手に入れない。ADR-0066）。
    expect(store.value).toEqual({ ...chosen, checks: OFF })
    expect(body.data).toEqual({ settings: { ...chosen, checks: OFF }, source: 'saved' })
  })

  it('AI のチェック（絵・Take）を入れて保存すると、以後はそれを返す（ADR-0066）', async () => {
    const { app, store } = setup()
    const chosen = { ...DEFAULTS, text: 'claude_cli', checks: { image: true, video: false } }

    const saved = await put(app, chosen)
    const body = (await (await app.request('/ai/settings')).json()) as { data: unknown }

    expect(saved.status).toBe(200)
    expect(store.value?.checks).toEqual({ image: true, video: false })
    expect(body.data).toEqual({ settings: chosen, source: 'saved' })
  })

  it('まだ選んでいなければ、AI のチェックはどちらも切って返す', async () => {
    const { app } = setup()

    const body = (await (await app.request('/ai/settings')).json()) as { data: { settings: AiSettings } }

    expect(body.data.settings.checks).toEqual(OFF)
  })

  it('AI のチェックが真偽でなければ 422（保存しない）', async () => {
    const { app, store } = setup()

    expect((await put(app, { ...DEFAULTS, checks: { image: 'yes', video: false } })).status).toBe(422)
    expect((await put(app, { ...DEFAULTS, checks: { image: true } })).status).toBe(422)
    expect(store.value).toBeNull()
  })

  it('その用途に使えない AI・見つからない AI は 422 で、用途ごとに理由を返す（保存しない）', async () => {
    const { app, store } = setup()

    const response = await put(app, { text: 'grok_cli', image: 'claude_cli', video: 'stub', voice: 'whisper_cpp', transcribe: 'stub', music: 'klein', sfx: 'ace_step' })
    const body = (await response.json()) as { fields: Record<string, string[]> }

    expect(response.status).toBe(422)
    expect(body.fields.text?.[0]).toMatch(/Grok/)
    expect(body.fields.image?.[0]).toMatch(/画像にはまだ使えません/)
    expect(body.fields.video).toBeUndefined()
    expect(body.fields.voice?.[0]).toMatch(/声にはまだ使えません/)
    expect(body.fields.music?.[0]).toMatch(/曲にはまだ使えません/)
    expect(body.fields.sfx?.[0]).toMatch(/効果音にはまだ使えません/)
    expect(store.value).toBeNull()
  })

  it('知らない AI の名前は 422', async () => {
    const { app } = setup()

    expect(
      (await put(app, { text: 'chatgpt', image: 'stub', video: 'stub', voice: 'stub', transcribe: 'stub', music: 'stub', sfx: 'stub' })).status,
    ).toBe(422)
  })
})
