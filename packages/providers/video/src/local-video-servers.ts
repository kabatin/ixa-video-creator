import { join } from 'node:path'
import type { VideoProvider } from '@ixa/provider-core'
import { VPIPE_IDENTITY } from './vpipe/descriptor.js'
import { createVpipeVideoProvider } from './vpipe/provider.js'
import { WAN_IDENTITY } from './wan/descriptor.js'
import { createWanVideoProvider } from './wan/provider.js'
import { checkLocalServerHealth, type LocalServerHealthCheck } from './local-server/health-check.js'
import type { LocalServerIdentity } from './local-server/identity.js'
import type { LocalServerWarn } from './local-server/output.js'

/**
 * 手元の生成サーバ（ADR-0031 / 0040）を**1 か所で束ねる**。
 *
 * ここだけが「この環境にどのサーバがあるか」を知る。`local-server/` は vpipe-api v1 契約を話す
 * 実装で、どのモデルが載っているかを知らない（だから一覧はそちらに置かない）。
 *
 * 以前は「`.env` の値がこれなら、この Provider を登録する」という規則が
 * API（`main.ts`）と worker（`generation-wiring.ts`）に別々に書かれていて、
 * 片方だけ直すと「API のモデル一覧には出るのに worker が未登録のモデルとして落とす」になる
 * （ADR-0031 のコメントが「API 側の登録と同じ条件にすること」と注意していた箇所）。
 * サーバが 2 台になると書き写しは必ずズレるので、表をここに置いて両方が取りに来る形にする。
 *
 * **ここは `@ixa/config` に依存しない**（providers は domain の型だけに依存する規約）。
 * 設定を読むのは `packages/config` で、呼ぶ側が値を渡す。
 */

/** `LOCAL_VIDEO_GENERATOR` に書ける値。`@ixa/config` の `LocalVideoGeneratorId` と揃っている必要がある。 */
export type LocalVideoServerId = 'vpipe' | 'wan'

export type LocalVideoServerSettings = {
  readonly baseUrl: string
  /** 未設定は null（空の Bearer を送らない）。 */
  readonly token: string | null
}

export type LocalVideoServersInput = {
  /** 有効にしたサーバ（`.env` の `LOCAL_VIDEO_GENERATOR`）。 */
  readonly enabled: readonly LocalVideoServerId[]
  readonly vpipe: LocalVideoServerSettings
  readonly wan: LocalVideoServerSettings
}

export type LocalVideoServerWiring = {
  readonly id: LocalVideoServerId
  readonly identity: LocalServerIdentity
  /** `.env` で有効にしてあるか。**有効でなければ登録もせず、health も叩かない。** */
  readonly enabled: boolean
  /**
   * Provider を作る。**作るだけでは通信しない**（API はモデル一覧・見積り・検証のために作る）。
   * 出力の置き場はサーバごとに分ける（ジョブ ID が衝突しない保証が無い）。
   */
  createProvider(options: {
    readonly outputRoot: string
    readonly warn?: LocalServerWarn
  }): VideoProvider
  /** 起動しているか（`GET /v1/health`）。何も積まない。 */
  checkHealth(): Promise<LocalServerHealthCheck>
}

const wiringFor = (
  id: LocalVideoServerId,
  identity: LocalServerIdentity,
  settings: LocalVideoServerSettings,
  enabled: boolean,
  create: (options: {
    baseUrl: string
    token?: string
    outputDir: string
    warn?: LocalServerWarn
  }) => VideoProvider,
): LocalVideoServerWiring => ({
  id,
  identity,
  enabled,
  createProvider: ({ outputRoot, warn }) =>
    create({
      baseUrl: settings.baseUrl,
      outputDir: join(outputRoot, id),
      ...(settings.token === null ? {} : { token: settings.token }),
      ...(warn === undefined ? {} : { warn }),
    }),
  checkHealth: () =>
    checkLocalServerHealth({ identity, baseUrl: settings.baseUrl, token: settings.token }),
})

/**
 * 手元の生成サーバの一覧。**有効かどうかに関わらず全台返す**（画面には「有効にしてから選べます」と
 * 出したいので、無効なサーバも名乗りだけは要る）。登録するときは `enabled` で絞る。
 */
export const localVideoServerWirings = (
  input: LocalVideoServersInput,
): readonly LocalVideoServerWiring[] => [
  wiringFor(
    'vpipe',
    VPIPE_IDENTITY,
    input.vpipe,
    input.enabled.includes('vpipe'),
    createVpipeVideoProvider,
  ),
  wiringFor('wan', WAN_IDENTITY, input.wan, input.enabled.includes('wan'), createWanVideoProvider),
]

/** 有効にしたサーバの Provider だけを作る。API と worker が同じ条件で登録するための口。 */
export const createLocalVideoProviders = (
  input: LocalVideoServersInput & { readonly outputRoot: string; readonly warn?: LocalServerWarn },
): readonly VideoProvider[] =>
  localVideoServerWirings(input)
    .filter((wiring) => wiring.enabled)
    .map((wiring) =>
      wiring.createProvider({
        outputRoot: input.outputRoot,
        ...(input.warn === undefined ? {} : { warn: input.warn }),
      }),
    )
