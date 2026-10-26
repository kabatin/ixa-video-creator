/**
 * 点検と手順の結果の形（ADR-0063）。表示（printer.ts）と `--json` はこの形だけを見る。
 *
 * **鍵・署名付き URL の値は、どの文にも入れない。** 「入っている／いない」と変数の名前だけ。
 */

/** ✓ 済み / ! 気にしてほしい / ✗ 直さないと動かない / - 見なかった（理由は message）。 */
export type Level = 'ok' | 'warn' | 'fail' | 'skip'

export type Fix = {
  /** 何をするか（日本語 1 行）。 */
  readonly hint: string
  /** そのまま打てる 1 行。無いときは省く（人が画面で押す・考えて直す）。 */
  readonly command?: string
  /** 人の操作か同意が要るか（Homebrew で入れる・Docker Desktop を入れる・課金の鍵・アクセス用の鍵の発行）。 */
  readonly needsHuman: boolean
}

export type CheckGroup = 'tools' | 'env' | 'db' | 'runtime' | 'local-ai' | 'optional'

export type CheckResult = {
  /** 機械が見分ける名前（`tools.ffmpeg` など）。変えない。 */
  readonly id: string
  readonly group: CheckGroup
  readonly level: Level
  readonly message: string
  readonly fix?: Fix
  /** 説明の場所（リポジトリの中の相対パスと見出し）。 */
  readonly docs?: string
}

/** setup・update の 1 手順の結果。`notice` は止めずに知らせるだけ（新しく増えた .env の項目など）。 */
export type StepStatus = 'done' | 'already' | 'skipped' | 'notice' | 'needs_human' | 'failed'

export type StepResult = {
  readonly id: string
  readonly status: StepStatus
  readonly message: string
  readonly fix?: Fix
  readonly docs?: string
}

/** 1 つでも ✗ があれば失敗。 */
export const hasFailure = (results: readonly CheckResult[]): boolean => results.some((r) => r.level === 'fail')

/** 手順が止まったか（以降を進めない）。 */
export const isStopping = (step: StepResult): boolean => step.status === 'failed' || step.status === 'needs_human'
