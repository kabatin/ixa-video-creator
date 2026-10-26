import type { DbClient } from '@ixa/db'

/**
 * 外の世界の口（ADR-0063）。コマンドの実行・HTTP・ファイル・DB はすべてここを通す。
 * 判定（checks/*・setup/*・update/* の純粋な関数）はこの口を知らない。テストは偽物を渡す。
 */

export type RunResult =
  | { readonly kind: 'completed'; readonly exitCode: number; readonly stdout: string; readonly stderr: string }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'spawn_failed'; readonly reason: string }

export type RunOptions = {
  readonly cwd?: string
  readonly timeoutMs?: number
  /**
   * 子の出力をそのまま流す。結果の stdout / stderr は空になる。
   * `all` は stdout も流す（次の版の CLI。その `--json` が答えになる）。
   * `to-stderr` は全部を stderr へ（pnpm install など。`--json` の stdout を汚さない）。
   */
  readonly inherit?: 'all' | 'to-stderr'
}

export type HttpResult =
  | { readonly ok: true; readonly status: number; readonly body: string }
  | { readonly ok: false; readonly reason: string }

/** ポートで待ち受けているプロセス。 */
export type Listener = {
  readonly pid: number
  /** プロセスの作業ディレクトリ。分からなければ null。 */
  readonly cwd: string | null
}

export type System = {
  readonly run: (command: string, args: readonly string[], options?: RunOptions) => Promise<RunResult>
  /** 秘密は `headers` で渡す（URL に入れない）。 */
  readonly httpGet: (url: string, timeoutMs: number, headers?: Readonly<Record<string, string>>) => Promise<HttpResult>
  /** 無ければ null。 */
  readonly readText: (path: string) => Promise<string | null>
  readonly writeText: (path: string, content: string) => Promise<void>
  readonly exists: (path: string) => Promise<boolean>
  /** そこ（無ければいちばん近い親）に書けるか。**書いて確かめない**（doctor は読むだけ）。 */
  readonly canWrite: (path: string) => Promise<boolean>
  /** 空き容量（バイト）。分からなければ null。 */
  readonly freeBytes: (path: string) => Promise<number | null>
  readonly listener: (port: number) => Promise<Listener | null>
  /** Redis に PING して PONG が返るか。返らなければ理由。 */
  readonly redisPing: (url: string, timeoutMs: number) => Promise<true | string>
  /** DB につないで何かして閉じる。 */
  readonly withDb: <T>(url: string, body: (db: DbClient) => Promise<T>) => Promise<T>
  readonly randomHex: (bytes: number) => string
  /** はい／いいえを聞く。端末でなければ聞かずに false。 */
  readonly confirm: (question: string) => Promise<boolean>
  readonly sleep: (ms: number) => Promise<void>
  readonly nodeVersion: string
  readonly homedir: string
  readonly isTty: boolean
  /** 進み具合を人に見せる（stderr）。`--json` でも stdout を汚さない。 */
  readonly progress: (line: string) => void
}
