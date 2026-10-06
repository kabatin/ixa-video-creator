import { AI_TOOLS, AiToolId, type AiToolSpec, type AiToolStatus } from '@ixa/domain'
import type { CliRunner, CliRunResult } from '@ixa/provider-core'
import type { LocalServerHealthCheck } from '@ixa/provider-video'

/** 一覧を開くたびに叩くので短く。入っている CLI は 1 秒もかからない（実測）。 */
const VERSION_TIMEOUT_MS = 5000

/** 鍵で見つける AI の鍵の名前。 */
export type ApiKeyName = Extract<AiToolSpec['detect'], { readonly kind: 'api_key' }>['key']

/** whisper.cpp のモデルのファイル。 */
export type WhisperModelState = 'not_configured' | 'file_missing' | 'ready'

/** 手元の生成サーバの名前（vpipe-api / wan-api）。`AI_TOOLS` の `local_server` が名乗る。 */
export type LocalServerName = Extract<
  AiToolSpec['detect'],
  { readonly kind: 'local_server' }
>['server']

export type LocalServerProbe = {
  /** `.env` の `LOCAL_VIDEO_GENERATOR` に書かれているか。**書いていなければ叩かない。** */
  readonly enabled: boolean
  readonly check: () => Promise<LocalServerHealthCheck>
}

export type AiToolProbe = {
  readonly runCli: CliRunner
  /**
   * 鍵で見つける AI。**お金が掛かる・原稿が外に出るので、鍵があるだけでは使わない**（`.env` で明示）。
   * この API は無認証で網に出ることがあるため、画面の選択だけで外部の口を開けられないようにする。
   */
  readonly apiKeys: Readonly<Record<ApiKeyName, { readonly keyConfigured: boolean; readonly enabled: boolean }>>
  /** whisper.cpp のモデルのファイルがあるか（`WHISPER_CPP_MODEL`）。 */
  readonly whisperModel: () => Promise<WhisperModelState>
  /**
   * 手元の生成サーバ（vpipe-api・wan-api）。`.env` の `LOCAL_VIDEO_GENERATOR` に書いたものだけ
   * モデルが登録される（ADR-0031 / 0040）。**サーバごとに持つ**（片方の起動で両方が「使える」に
   * ならないように）。有効でなければ叩かない。
   */
  readonly localServers: Readonly<Record<LocalServerName, LocalServerProbe>>
}

/** 鍵はあるが `.env` で有効にしていないときの、有効にし方。 */
const ENABLE_HINTS: Readonly<Record<ApiKeyName, string>> = {
  FAL_API_KEY: 'お金が掛かるため、.env の VIDEO_PROVIDER=fal で有効にしてから選べます',
  GEMINI_API_KEY: '原稿が外に出るため、.env の AUDIO_API_PROVIDERS に gemini_api と書いてから選べます',
  ELEVENLABS_API_KEY: 'お金が掛かり原稿が外に出るため、.env の AUDIO_API_PROVIDERS に elevenlabs と書いてから選べます',
}

const versionOf = (stdout: string): string | null => /\d+\.\d+\.\d+/.exec(stdout)?.[0] ?? null

const fromCli = (result: CliRunResult): AiToolStatus => {
  switch (result.kind) {
    case 'completed':
      return result.exitCode === 0
        ? { state: 'ready', version: versionOf(result.stdout) }
        : { state: 'missing', reason: `起動できません（終了コード ${String(result.exitCode)}）` }
    case 'timeout':
      return {
        state: 'missing',
        reason: `応答がありません（${String(result.timeoutMs / 1000)} 秒）`,
      }
    case 'not_found':
      return { state: 'missing', reason: '入っていません' }
    case 'spawn_failed':
      return { state: 'missing', reason: `起動できません（${result.reason}）` }
  }
}

const statusOf = async (spec: AiToolSpec, probe: AiToolProbe): Promise<AiToolStatus> => {
  switch (spec.detect.kind) {
    case 'builtin':
      return { state: 'ready', version: null }
    case 'cli':
      return fromCli(
        await probe.runCli({
          command: spec.detect.command,
          args: [...(spec.detect.args ?? ['--version'])],
          timeoutMs: VERSION_TIMEOUT_MS,
        }),
      )
    case 'api_key': {
      const key = probe.apiKeys[spec.detect.key]
      if (!key.keyConfigured) return { state: 'missing', reason: `${spec.detect.key} が設定されていません` }
      return key.enabled
        ? { state: 'ready', version: null }
        : { state: 'missing', reason: ENABLE_HINTS[spec.detect.key] }
    }
    case 'whisper_cpp': {
      const model = await probe.whisperModel()
      if (model === 'not_configured') {
        return { state: 'missing', reason: '.env の WHISPER_CPP_MODEL にモデルのファイル（絶対パス）を書いてから選べます' }
      }
      if (model === 'file_missing') return { state: 'missing', reason: 'WHISPER_CPP_MODEL のファイルが見つかりません' }
      // 版を出す口が無いので、使い方の表示（-h）が出るかで見る。
      const result = await probe.runCli({ command: 'whisper-cli', args: ['-h'], timeoutMs: VERSION_TIMEOUT_MS })
      const status = fromCli(result)
      return status.state === 'ready' ? { state: 'ready', version: null } : status
    }
    case 'local_server': {
      const server = probe.localServers[spec.detect.server]
      if (!server.enabled) {
        return {
          state: 'missing',
          reason: `.env の LOCAL_VIDEO_GENERATOR=${spec.detect.server} で有効にしてから選べます`,
        }
      }
      const health = await server.check()
      return health.state === 'up'
        ? { state: 'ready', version: health.version }
        : { state: 'missing', reason: health.reason }
    }
  }
}

/** この環境で使える AI を全部調べる（並べて叩く）。 */
export const detectAiTools = async (
  probe: AiToolProbe,
): Promise<Record<AiToolId, AiToolStatus>> => {
  const ids = AiToolId.options
  const statuses = await Promise.all(ids.map((id) => statusOf(AI_TOOLS[id], probe)))
  return Object.fromEntries(ids.map((id, index) => [id, statuses[index]])) as Record<
    AiToolId,
    AiToolStatus
  >
}
