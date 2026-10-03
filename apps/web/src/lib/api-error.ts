/** ネットワーク到達失敗を表す擬似ステータス。HTTP ステータスとは衝突しない値を使う。 */
export const TRANSPORT_ERROR_STATUS = 0

/**
 * API 呼び出しの失敗。原因を握り潰さず、ステータスと本文を必ず保持する。
 *
 * **`message` は人が読む前提ではない。** 画面へ出すときは必ず `describeError`
 * （＝人向けの整形）を通すこと。生の本文は `body` に持たせ、`message` には入れない。
 */
export class ApiError extends Error {
  readonly status: number
  readonly body: string

  constructor(message: string, status: number, body: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }

  get isTransportError(): boolean {
    return this.status === TRANSPORT_ERROR_STATUS
  }
}

/**
 * 技術的な文。**画面に出さない。** 例外の連鎖やデバッグのために残す。
 *
 * これを画面に出していたのが元の問題で、`ApiError.message` に入っている
 * メソッド・完全な URL・ステータス・レスポンス本文がそのまま利用者に見えていた。
 */
export const describeErrorForLog = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 到達できないときの文。次の一手まで書く。 */
const UNREACHABLE =
  'サーバに繋がりません。ネットワークを確認して、少し待ってからやり直してください。'

/**
 * 理由を読み取れなかったときの文。**「失敗した」ことは必ず伝える。** HTTP の番号は出さない（画面に出さないもの）。
 * 番号はログの文（`describeErrorForLog`）に残っている。
 */
const GENERIC_FAILURE =
  'サーバでエラーが起きました。少し待ってからやり直してください。' +
  '直らないときは、この画面を開いた時刻を控えて知らせてください。'

/**
 * 項目の名前（サーバの列名）の言い換え。**知らない名前は出さない**（理由の文だけ出す）。
 * 英字の列名は利用者に読めない（制作者 2026-10-03 の UI 指摘の続き。画面に実装の言葉を出さない）。
 */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  name: '名前',
  displayName: '表示名',
  title: '題名',
  code: 'コード',
  description: '説明',
  mood: '雰囲気',
  startSec: '開始',
  durationSec: '尺',
  offsetSec: '開始位置',
  volume: '音量',
  fps: 'fps',
  resolution: '大きさ',
  aspectRatio: '画面の形',
  budgetUsd: '予算',
  status: '状態',
  lyrics: '歌詞',
  lyricCues: '歌詞の時刻',
  styleGuide: 'ルック',
  avoid: '避けたいもの',
  boundariesSec: '区切り',
  category: '種類',
  value: '値',
  text: '文字',
  preset: '画質',
  scope: '範囲',
  renderJobId: '書き出し',
  referenceIdentityImageId: '手本の画像',
  content: '内容',
}

/** `{ error, fields }` の本文から人向けの 1 文を組む。読めなければ null。 */
const fromBody = (error: ApiError): string | null => {
  let body: unknown
  try {
    body = JSON.parse(error.body)
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null

  const record = body as { error?: unknown; fields?: unknown }
  const head = typeof record.error === 'string' && record.error !== '' ? record.error : null
  if (head === null) return null

  const fields =
    typeof record.fields === 'object' && record.fields !== null
      ? Object.entries(record.fields as Record<string, unknown>)
          .flatMap(([name, messages]) =>
            Array.isArray(messages)
              ? messages
                  .filter((m): m is string => typeof m === 'string')
                  .map((m) => (FIELD_LABELS[name] === undefined ? m : `${FIELD_LABELS[name]}: ${m}`))
              : [],
          )
          .join(' / ')
      : ''

  return fields === '' ? head : `${head}（${fields}）`
}

/**
 * 人に見せる言い方。**URL も JSON もそのまま出さない。**
 *
 * API の本文が `{ error, fields }` なら「検証に失敗しました（value が必須です）」の形にする。
 * 読めなければ、状態に応じた一般的な文へ倒す。**理由が無いときも「失敗した」ことは落とさない。**
 */
export const describeForPerson = (error: unknown): string => {
  if (!(error instanceof ApiError)) return describeErrorForLog(error)
  if (error.isTransportError) return UNREACHABLE
  return fromBody(error) ?? GENERIC_FAILURE
}

/**
 * 画面に出す文。**`describeForPerson` と同じ経路に通す。**
 *
 * 以前はここが `error.message` をそのまま返していて、46 ファイルの呼び出し元すべてで
 * メソッド・完全な URL・レスポンス本文 500 文字が利用者に見えていた。
 * 呼び出し元を 46 箇所直すのではなく、出口を 1 つにする。
 * 技術的な文が要る場所（ログ・例外の連鎖）は `describeErrorForLog` を使うこと。
 */
export const describeError = (error: unknown): string => describeForPerson(error)
