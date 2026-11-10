/**
 * 見本を入れられなかった理由（ADR-0067）。画面に出す文は理由ごとに 1 つ（`demoFailureMessage`）。
 * **URL・ID・番号を画面の文に入れない。** 文脈（どのファイルか・応答の番号）はログに残す。
 */

export type DemoFailureReason =
  /** 取りに行けなかった（つながらない・時間切れ・相手が断った）。 */
  | 'network'
  /** 取ってきたものが目録と合わない（大きさ・sha256）。 */
  | 'broken'
  /** この機械のフォルダ（`DEMO_DIR`）にファイルが無い。 */
  | 'missing'
  /** 目録の中身がこの版の ixa の形に合わない。 */
  | 'invalid'

/** 見本のファイルを取る・確かめるところでの失敗。`file` は目録のファイル名（URL ではない）。 */
export class DemoFileError extends Error {
  constructor(
    readonly reason: Exclude<DemoFailureReason, 'invalid'>,
    readonly file: string,
    detail: string,
    options?: { cause?: unknown },
  ) {
    super(`見本のファイル ${file} を使えませんでした（${detail}）`, options)
    this.name = 'DemoFileError'
  }
}

/** 目録が無い（まだ見本を用意していない）。 */
export class DemoUnavailableError extends Error {
  constructor() {
    super('見本の目録がありません')
    this.name = 'DemoUnavailableError'
  }
}

/** 目録が読めない・中身が合わない。 */
export class DemoManifestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DemoManifestError'
  }
}

export const DEMO_UNAVAILABLE_MESSAGE = '見本はまだ用意されていません'

const MESSAGES: Readonly<Record<DemoFailureReason | 'other', string>> = Object.freeze({
  network: '見本のファイルを取りに行けませんでした。インターネットにつながっているか確かめて、もう一度試してください。',
  broken: '見本のファイルが途中で壊れていました。もう一度試してください。',
  missing: '見本のファイルが足りません。見本のフォルダの中身を確かめてから、もう一度試してください。',
  invalid: '見本の中身を読めませんでした。ixa を新しい版に上げてから、もう一度試してください。',
  other: '見本を入れられませんでした。少し待ってから、もう一度試してください。',
})

/** 例外の連鎖をたどり、見本の失敗の理由を探す（書く途中の失敗は包まれて届く）。 */
export const demoFailureReason = (error: unknown): DemoFailureReason | 'other' => {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current)
    if (current instanceof DemoFileError) return current.reason
    if (current instanceof DemoManifestError) return 'invalid'
    current = current.cause
  }
  return 'other'
}

/** 画面に出す文。何が起きて、次に何をすればよいか。 */
export const demoFailureMessage = (error: unknown): string => MESSAGES[demoFailureReason(error)]
