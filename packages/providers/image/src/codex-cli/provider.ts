import type {
  ImageGenerationRequest,
  ImageJobStatus,
  ImageProvider,
  ProviderJobHandle,
} from '@ixa/provider-core'
import { z } from 'zod'
import { CODEX_CLI_PROVIDER_ID, codexCliImageModels } from './descriptor.js'

/**
 * Codex CLI の画像アダプタ（ADR-0012）。**Phase 2 では型と構造だけで、実行は未実装。**
 *
 * 理由: `codex exec` で `image_gen` を非対話に駆動し、出力パスを確実に取得できるかの
 * 検証が済んでいない（ADR-0012 の Follow-up）。
 * 中途半端に動くものを置くと、失敗が「生成品質の問題」に見えて原因追及が遅れる。
 * **動かないことが型と例外で明確なほうが良い。**
 *
 * 実装するときは ADR-0012 の「実装上の規約」に従うこと。
 * - サブプロセス実行は `packages/providers/core/cli-runner.ts` に集約する
 * - 必ずタイムアウトを設定する（既定 10 分）
 * - 作業ディレクトリを生成ごとに隔離する
 * - stdout / stderr を捕捉し、exit code を先に見てから出力を解釈する
 * - 生成画像は即座に MediaAsset へ取り込む（`$CODEX_HOME` に置いたままにしない）
 */

export const CodexCliImageProviderOptions = z.object({
  /** `codex` 実行ファイル。PATH 上の名前でも絶対パスでもよい。 */
  binary: z.string().min(1).default('codex'),
  /** 生成ごとに隔離する作業ディレクトリを作る親ディレクトリ。 */
  workingDirRoot: z.string().min(1),
  /** ハングした CLI がキューを詰まらせるため必ず設定する。既定 10 分。 */
  timeoutMs: z
    .number()
    .int()
    .positive()
    .default(10 * 60 * 1000),
})
export type CodexCliImageProviderOptions = {
  binary?: string
  workingDirRoot: string
  timeoutMs?: number
}

/**
 * 未実装であることを示す唯一のメッセージ。
 * テストがこの文字列を固定しているため、実装したらテストごと書き換えること。
 */
export const CODEX_CLI_NOT_IMPLEMENTED_MESSAGE =
  'Codex CLI アダプタは未実装です（ADR-0012 の Follow-up）'

/**
 * interface が Promise を返す以上、同期 throw ではなく reject で返す
 * （スタブ Provider の未知ハンドル処理と同じ扱い）。
 */
const notImplemented = <T>(): Promise<T> =>
  Promise.reject(new Error(CODEX_CLI_NOT_IMPLEMENTED_MESSAGE))

export const createCodexCliImageProvider = (
  options: CodexCliImageProviderOptions,
): ImageProvider => {
  // 実行しないが、設定の形だけは今のうちに固定しておく（不正な設定はここで弾く）。
  CodexCliImageProviderOptions.parse(options)

  return {
    id: CODEX_CLI_PROVIDER_ID,
    models: codexCliImageModels,
    // 引数は受け取るだけで使わない。`void` は「意図的に捨てている」ことを型と lint の両方へ示す。
    submit: (request: ImageGenerationRequest): Promise<ProviderJobHandle> => {
      void request
      return notImplemented()
    },
    poll: (handle: ProviderJobHandle): Promise<ImageJobStatus> => {
      void handle
      return notImplemented()
    },
    cancel: (handle: ProviderJobHandle): Promise<void> => {
      void handle
      return notImplemented()
    },
  }
}
