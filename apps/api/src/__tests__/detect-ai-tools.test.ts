import type { CliInvocation, CliRunResult } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import { detectAiTools, type AiToolProbe } from '../ai/detect-ai-tools.js'

/**
 * この環境で使える AI を見つける（ADR-0032）。**実 CLI は叩かない**（偽の runner で）。
 * 叩くのは表にある名前の `--version` だけ。見つからない理由を分けて返す。
 */

/** 実測（2026-09-30）の `--version` の出力。 */
const VERSIONS: Readonly<Record<string, string>> = {
  claude: '2.1.283 (Claude Code)\n',
  codex: 'codex-cli 0.154.0\n',
  gemini: '0.25.1\n',
  grok: 'grok 0.2.102 (ab5ebf69acec) [stable]\n',
}

const runnerWith =
  (results: Readonly<Record<string, CliRunResult>>, calls: CliInvocation[] = []) =>
  (invocation: CliInvocation): Promise<CliRunResult> => {
    calls.push(invocation)
    return Promise.resolve(results[invocation.command] ?? { kind: 'not_found', reason: 'ENOENT' })
  }

const completed = (stdout: string, exitCode = 0): CliRunResult => ({
  kind: 'completed',
  exitCode,
  stdout,
  stderr: '',
})

const probe = (patch: Partial<AiToolProbe> = {}): AiToolProbe => ({
  runCli: runnerWith(
    Object.fromEntries(Object.entries(VERSIONS).map(([name, out]) => [name, completed(out)])),
  ),
  apiKeys: {
    FAL_API_KEY: { keyConfigured: false, enabled: false },
    GEMINI_API_KEY: { keyConfigured: false, enabled: false },
    ELEVENLABS_API_KEY: { keyConfigured: false, enabled: false },
  },
  whisperModel: () => Promise.resolve('not_configured'),
  localServer: {
    enabled: true,
    check: () =>
      Promise.resolve({
        state: 'down',
        reason: '起動していません（vpipe-api serve で起動します）',
      }),
  },
  ...patch,
})

describe('detectAiTools', () => {
  it('入っている CLI を版つきで見つける', async () => {
    const found = await detectAiTools(probe())

    expect(found.claude_cli).toEqual({ state: 'ready', version: '2.1.283' })
    expect(found.codex_cli).toEqual({ state: 'ready', version: '0.154.0' })
    expect(found.gemini_cli).toEqual({ state: 'ready', version: '0.25.1' })
    expect(found.grok_cli).toEqual({ state: 'ready', version: '0.2.102' })
  })

  it('叩くのは表にある名前だけ（版は --version、Mac の声は声の一覧。短い時間切れで）', async () => {
    const calls: CliInvocation[] = []
    await detectAiTools(probe({ runCli: runnerWith({}, calls) }))

    expect(calls.map((call) => call.command).sort()).toEqual(['claude', 'codex', 'gemini', 'grok', 'say'])
    for (const call of calls) {
      // `say -v ?` は声の一覧を出すだけで、読み上げない。
      expect(call.args).toEqual(call.command === 'say' ? ['-v', '?'] : ['--version'])
      expect(call.timeoutMs).toBeLessThanOrEqual(5000)
    }
  })

  it('入っていない・時間切れ・起動に失敗を分けて言う', async () => {
    const found = await detectAiTools(
      probe({
        runCli: runnerWith({
          claude: { kind: 'timeout', timeoutMs: 5000 },
          codex: completed('', 1),
          gemini: { kind: 'spawn_failed', reason: 'EACCES' },
        }),
      }),
    )

    expect(found.claude_cli).toEqual({
      state: 'missing',
      reason: expect.stringMatching(/応答がありません/) as unknown,
    })
    expect(found.codex_cli).toEqual({
      state: 'missing',
      reason: expect.stringMatching(/終了コード 1/) as unknown,
    })
    expect(found.gemini_cli).toEqual({
      state: 'missing',
      reason: expect.stringMatching(/起動できません/) as unknown,
    })
    expect(found.grok_cli).toEqual({
      state: 'missing',
      reason: expect.stringMatching(/入っていません/) as unknown,
    })
  })

  it('アプリに入っているもの（お試し・静止画を動かす）はいつでも使える', async () => {
    const found = await detectAiTools(probe({ runCli: runnerWith({}) }))

    expect(found.stub.state).toBe('ready')
    expect(found.local.state).toBe('ready')
  })

  it('手元の生成サーバは health の結果をそのまま使う', async () => {
    const up = await detectAiTools(
      probe({
        localServer: {
          enabled: true,
          check: () => Promise.resolve({ state: 'up', version: '0.1.0' }),
        },
      }),
    )
    const down = await detectAiTools(probe())

    expect(up.vpipe).toEqual({ state: 'ready', version: '0.1.0' })
    expect(down.vpipe).toEqual({
      state: 'missing',
      reason: expect.stringMatching(/vpipe-api serve/) as unknown,
    })
  })

  /** 手元の生成サーバは .env で有効にしたときだけ一覧のモデルに出る（PR #4 / ADR-0031 のまま）。 */
  it('手元の生成サーバは、.env で有効にしていなければ叩かずに有効にし方を言う', async () => {
    let checked = false
    const found = await detectAiTools(
      probe({
        localServer: {
          enabled: false,
          check: () => {
            checked = true
            return Promise.resolve({ state: 'up', version: '0.1.0' })
          },
        },
      }),
    )

    expect(checked).toBe(false)
    expect(found.vpipe).toEqual({
      state: 'missing',
      reason: expect.stringMatching(/LOCAL_VIDEO_GENERATOR=vpipe/) as unknown,
    })
  })

  /** お金が掛かるので、キーがあるだけでは使わない（`.env` の VIDEO_PROVIDER=fal で明示する。無認証の API のため）。 */
  it('fal はキーがあっても、.env で有効にしていなければ使えない（理由に有効にし方を言う）', async () => {
    const keys = probe().apiKeys
    const keyOnly = await detectAiTools(probe({ apiKeys: { ...keys, FAL_API_KEY: { keyConfigured: true, enabled: false } } }))
    const enabled = await detectAiTools(probe({ apiKeys: { ...keys, FAL_API_KEY: { keyConfigured: true, enabled: true } } }))
    const none = await detectAiTools(probe())

    expect(keyOnly.fal).toEqual({
      state: 'missing',
      reason: expect.stringMatching(/VIDEO_PROVIDER=fal/) as unknown,
    })
    expect(enabled.fal).toEqual({ state: 'ready', version: null })
    expect(none.fal).toEqual({
      state: 'missing',
      reason: expect.stringMatching(/FAL_API_KEY/) as unknown,
    })
  })

  /** 声と文字起こし（ADR-0038）。原稿が外に出るので、キーがあるだけでは使わない（`.env` の AUDIO_API_PROVIDERS で明示する）。 */
  it('Gemini・ElevenLabs はキーがあっても、AUDIO_API_PROVIDERS に書いていなければ使えない', async () => {
    const keys = probe().apiKeys
    const keyOnly = await detectAiTools(
      probe({ apiKeys: { ...keys, GEMINI_API_KEY: { keyConfigured: true, enabled: false }, ELEVENLABS_API_KEY: { keyConfigured: true, enabled: false } } }),
    )
    const enabled = await detectAiTools(probe({ apiKeys: { ...keys, GEMINI_API_KEY: { keyConfigured: true, enabled: true } } }))

    expect(keyOnly.gemini_api).toEqual({ state: 'missing', reason: expect.stringMatching(/AUDIO_API_PROVIDERS に gemini_api/) as unknown })
    expect(keyOnly.elevenlabs).toEqual({ state: 'missing', reason: expect.stringMatching(/AUDIO_API_PROVIDERS に elevenlabs/) as unknown })
    expect(enabled.gemini_api).toEqual({ state: 'ready', version: null })
    expect((await detectAiTools(probe())).gemini_api).toEqual({
      state: 'missing',
      reason: expect.stringMatching(/GEMINI_API_KEY/) as unknown,
    })
  })

  it('Mac の声は、声の一覧が出れば使える（Mac 以外では入っていない）', async () => {
    const found = await detectAiTools(probe({ runCli: runnerWith({ say: completed('Kyoko ja_JP # こんにちは\n') }) }))
    expect(found.macos_say).toEqual({ state: 'ready', version: null })
    expect((await detectAiTools(probe({ runCli: runnerWith({}) }))).macos_say).toEqual({ state: 'missing', reason: '入っていません' })
  })

  it('whisper.cpp は、モデルのファイルがあって whisper-cli が起動できれば使える', async () => {
    const calls: CliInvocation[] = []
    const ready = await detectAiTools(
      probe({ whisperModel: () => Promise.resolve('ready'), runCli: runnerWith({ 'whisper-cli': completed('usage: whisper-cli') }, calls) }),
    )
    expect(ready.whisper_cpp).toEqual({ state: 'ready', version: null })
    expect(calls.find((call) => call.command === 'whisper-cli')?.args).toEqual(['-h'])

    expect((await detectAiTools(probe())).whisper_cpp).toEqual({
      state: 'missing',
      reason: expect.stringMatching(/WHISPER_CPP_MODEL/) as unknown,
    })
    expect((await detectAiTools(probe({ whisperModel: () => Promise.resolve('file_missing') }))).whisper_cpp).toEqual({
      state: 'missing',
      reason: expect.stringMatching(/見つかりません/) as unknown,
    })
    expect(
      (await detectAiTools(probe({ whisperModel: () => Promise.resolve('ready'), runCli: runnerWith({}) }))).whisper_cpp,
    ).toEqual({ state: 'missing', reason: '入っていません' })
  })
})
