import type { z } from 'zod'

/**
 * Provider が返した文を「理由」として外へ運ぶ前の下ごしらえ。fal と vpipe が共有する。
 *
 * 理由は Take の記録・ログ・画面の通知まで流れる。**秘密（署名付き URL）と、
 * 手元の事情（ファイルの置き場所）を運ばない。** 長すぎるものは切る。
 */

/**
 * URL らしき部分を落とす。
 *
 * 参照の署名付き URL も出力 URL も期限付きの秘密で、**DB だけでなく例外にもログにも
 * 出してはいけない**（CLAUDE.md 規約 7 と同じ理由）。
 */
const URL_PATTERNS: readonly RegExp[] = [
  // scheme://host/... の形
  /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]]*/gi,
  // data: / blob: のように // を持たない形
  /\b(?:data|blob):[^\s"'<>)\]]*/gi,
  // scheme を省いた host/path の形（fal.media/files/... など）
  /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\/[^\s"'<>)\]]*/gi,
]

export const redactUrls = (text: string): string =>
  URL_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, '[url]'), text)

/**
 * 絶対パス（`/Users/<名前>/…`・`/home/…`・`/private/…` など）を落とす。
 * 手元のサーバの例外文には置き場所が混ざりやすく、利用者の名前やディレクトリ構成が画面に出る。
 * ディレクトリを 1 段以上含む `/a/b` の形だけを対象にする（`16:9` や `a/b` は触らない）。
 */
const ABSOLUTE_PATH = /(?<![\w.:/[\]-])\/(?:[^\s/"'<>)\]]+\/)+[^\s"'<>)\]]*/g

export const redactPaths = (text: string): string => text.replace(ABSOLUTE_PATH, '[path]')

/** 理由の長さの上限。画面の通知に収まる程度にする。 */
export const MAX_REASON_LENGTH = 300

/** 前後の空白を落とし、空なら `fallback`、長すぎれば切る。 */
export const clipReason = (text: string, fallback: string): string => {
  const trimmed = text.trim()
  const reason = trimmed === '' ? fallback : trimmed
  return reason.length > MAX_REASON_LENGTH ? `${reason.slice(0, MAX_REASON_LENGTH)}…` : reason
}

/** 値を含めずに zod の不一致を要約する。**受け取った値を書かない**のは URL 混入を防ぐため。 */
export const formatIssues = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join(', ')
