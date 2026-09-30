import { AI_TOOLS, AiToolId, type AiToolSpec, type AiToolStatus } from '@ixa/domain'
import type { CliRunner, CliRunResult } from '@ixa/provider-core'
import type { VpipeHealthCheck } from '@ixa/provider-video'

/** 一覧を開くたびに叩くので短く。入っている CLI は 1 秒もかからない（実測）。 */
const VERSION_TIMEOUT_MS = 5000

export type AiToolProbe = {
  readonly runCli: CliRunner
  /**
   * fal が使える形か。**お金が掛かるので、キーがあるだけでは使わない**（`.env` の `VIDEO_PROVIDER=fal` で明示）。
   * この API は無認証で網に出ることがあるため、画面の選択だけで有料の口を開けられないようにする。
   */
  readonly fal: { readonly keyConfigured: boolean; readonly enabled: boolean }
  /**
   * 手元の生成サーバ（vpipe-api）。`.env` の `LOCAL_VIDEO_GENERATOR=vpipe` のときだけモデルが登録される
   * （ADR-0031）。有効でなければ叩かない。
   */
  readonly localServer: {
    readonly enabled: boolean
    readonly check: () => Promise<VpipeHealthCheck>
  }
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
          args: ['--version'],
          timeoutMs: VERSION_TIMEOUT_MS,
        }),
      )
    case 'api_key':
      if (!probe.fal.keyConfigured)
        return { state: 'missing', reason: 'FAL_API_KEY が設定されていません' }
      return probe.fal.enabled
        ? { state: 'ready', version: null }
        : {
            state: 'missing',
            reason: 'お金が掛かるため、.env の VIDEO_PROVIDER=fal で有効にしてから選べます',
          }
    case 'local_server': {
      if (!probe.localServer.enabled) {
        return {
          state: 'missing',
          reason: '.env の LOCAL_VIDEO_GENERATOR=vpipe で有効にしてから選べます',
        }
      }
      const health = await probe.localServer.check()
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
