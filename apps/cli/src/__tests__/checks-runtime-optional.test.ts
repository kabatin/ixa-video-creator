import { describe, expect, it } from 'vitest'
import { judgeLocalAi } from '../checks/local-ai.js'
import { judgeOptional, LOW_FREE_BYTES, type OptionalFacts } from '../checks/optional.js'
import { devIsRunning, judgeRuntime, type RuntimeFacts } from '../checks/runtime.js'

const byId = <T extends { readonly id: string }>(results: readonly T[], id: string) => results.find((r) => r.id === id)

const idle: RuntimeFacts = {
  ports: [
    { name: 'web', port: 3000, owner: { kind: 'free' } },
    { name: 'api', port: 3001, owner: { kind: 'free' } },
    { name: 'audio', port: 8100, owner: { kind: 'free' } },
  ],
  apiHealthy: null,
  audioHealthy: null,
}

describe('judgeRuntime（ポートと /health）', () => {
  it('空いていれば ✓、dev が動いていなければ /health は見ない', () => {
    const results = judgeRuntime(idle)
    expect(results.filter((r) => r.id.startsWith('runtime.port-')).every((r) => r.level === 'ok')).toBe(true)
    expect(byId(results, 'runtime.api-health')?.level).toBe('skip')
    expect(devIsRunning(idle)).toBe(false)
  })

  it('別の場所の ixa なら !、ixa 以外なら ✗（止めてよいかは人）', () => {
    const facts: RuntimeFacts = {
      ...idle,
      ports: [
        { name: 'web', port: 3000, owner: { kind: 'other-ixa', root: '/elsewhere/ixa' } },
        { name: 'api', port: 3001, owner: { kind: 'other', pid: 42 } },
        { name: 'audio', port: 8100, owner: { kind: 'free' } },
      ],
    }
    const results = judgeRuntime(facts)
    expect(byId(results, 'runtime.port-web')?.level).toBe('warn')
    expect(byId(results, 'runtime.port-api')).toMatchObject({ level: 'fail', fix: { needsHuman: true } })
    expect(devIsRunning(facts)).toBe(false)
  })

  it('この clone の dev が答えなければ ✗', () => {
    const facts: RuntimeFacts = {
      ports: idle.ports.map((p) => ({ ...p, owner: { kind: 'this-repo' } })),
      apiHealthy: false,
      audioHealthy: true,
    }
    expect(byId(judgeRuntime(facts), 'runtime.api-health')?.level).toBe('fail')
    expect(byId(judgeRuntime(facts), 'runtime.audio-health')?.level).toBe('ok')
    expect(devIsRunning(facts)).toBe(true)
  })
})

describe('judgeLocalAi（手元の AI サーバー）', () => {
  it('有効にしたものだけを並べ、届かなければ !（起動は人）', () => {
    const results = judgeLocalAi({
      configValid: true,
      servers: [
        { id: 'vpipe', enabledBy: 'LOCAL_VIDEO_GENERATOR', urlEnvName: 'VPIPE_API_URL', reachable: true },
        { id: 'klein', enabledBy: 'LOCAL_IMAGE_GENERATOR', urlEnvName: 'KLEIN_API_URL', reachable: 'つながりません' },
      ],
    })
    expect(results.map((r) => [r.id, r.level])).toEqual([
      ['local-ai.vpipe', 'ok'],
      ['local-ai.klein', 'warn'],
    ])
  })

  it('何も有効にしていなければ 1 行の ✓', () => {
    expect(judgeLocalAi({ configValid: true, servers: [] })).toHaveLength(1)
  })
})

const optional: OptionalFacts = {
  claude: { kind: 'completed', exitCode: 0, stdout: '2.1.0', stderr: '' },
  codex: { kind: 'not_found' },
  whisperModelCached: false,
  audioVenv: true,
  storageRoot: '/Users/me/ixa-video-creator/storage',
  storageWritable: true,
  storageFreeBytes: LOW_FREE_BYTES * 3,
  paidKeys: { FAL_API_KEY: false, GEMINI_API_KEY: true, ELEVENLABS_API_KEY: false },
}

describe('judgeOptional（任意のもの）', () => {
  it('Codex が無ければ !（入れるかは人）。whisper のモデルが無いのは失敗ではない', () => {
    const results = judgeOptional(optional)
    expect(byId(results, 'optional.codex')).toMatchObject({ level: 'warn', fix: { needsHuman: true } })
    expect(byId(results, 'optional.whisper-model')?.level).toBe('skip')
  })

  it('課金の鍵は「入っている／いない」だけ', () => {
    expect(byId(judgeOptional(optional), 'optional.paid-keys')?.message).toContain('GEMINI_API_KEY 入っている')
  })

  it('置き場に書けなければ ✗、空きが少なければ !', () => {
    expect(byId(judgeOptional({ ...optional, storageWritable: false }), 'optional.storage')?.level).toBe('fail')
    expect(byId(judgeOptional({ ...optional, storageFreeBytes: LOW_FREE_BYTES - 1 }), 'optional.storage')?.level).toBe('warn')
  })

  it('音の解析の依存が無ければ ✗ で uv sync', () => {
    const deps = byId(judgeOptional({ ...optional, audioVenv: false }), 'tools.audio-deps')
    expect(deps).toMatchObject({ level: 'fail', fix: { command: 'uv sync --directory apps/audio' } })
  })
})
