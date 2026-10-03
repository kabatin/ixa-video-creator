import type { RenderPreset, RenderScope } from './render.js'

/**
 * 書き出した動画を手元のフォルダに置くときの名前（ADR-0036。制作者 2026-10-03「書き出し画面で生成された動画が
 * あるフォルダを開く導線が欲しい」）。
 *
 * Finder で見て中身が分かる名前にする（プロジェクト・日時・画質・範囲）。
 * **フォルダの外を指せない名前にする。** `/` を残すと別のフォルダへ、`..` だけの名前は上のフォルダへ抜ける。
 */

/** 画質の名前。**画面とファイル名で同じものを使う**（2 箇所に持つとズレる。L-016）。 */
export const RENDER_PRESET_LABELS: Readonly<Record<RenderPreset, string>> = {
  preview_720p: 'プレビュー（720p）',
  master_1080p: 'マスター（1080p）',
  master_4k: 'マスター（4K）',
  social_vertical: 'SNS 縦型',
}

const MAX_NAME_LENGTH = 80
const FALLBACK_NAME = 'プロジェクト'
/** Finder・ファイルの仕組みで使えない文字（`:` は Finder で `/` に見える）と制御文字。 */
// eslint-disable-next-line no-control-regex -- 制御文字を名前から除くための正規表現
const UNSAFE_CHARACTERS = /[/\\:\u0000-\u001f\u007f]/g
const EDGE_SPACES_AND_DOTS = /^[\s.]+|[\s.]+$/g
/** `v2.app` のような終わり。Finder はフォルダをアプリや書類の束と見なし、`open` はそれを起動しようとする。 */
const EXTENSION_LIKE_END = /\.([A-Za-z0-9]+)$/

/** プロジェクト名を、フォルダ・ファイルの名前に使える形にする。 */
export const renderExportFolderName = (projectName: string): string => {
  const cleaned = projectName.replace(UNSAFE_CHARACTERS, '_').replace(EDGE_SPACES_AND_DOTS, '')
  const shortened = [...cleaned]
    .slice(0, MAX_NAME_LENGTH)
    .join('')
    .replace(EDGE_SPACES_AND_DOTS, '')
    .replace(EXTENSION_LIKE_END, '_$1')
  return shortened === '' ? FALLBACK_NAME : shortened
}

/** `2026-10-02 22.52.31`（macOS のスクリーンショットと同じ形。`:` は使えない）。 */
const formatStamp = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '00'
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}.${part('minute')}.${part('second')}`
}

/** `1分05秒`。秒の端数は切り捨てる（ファイル名で見分けられれば足りる）。 */
const formatMinuteSecond = (sec: number): string => {
  const whole = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(whole / 60))}分${String(whole % 60).padStart(2, '0')}秒`
}

const scopeSuffix = (scope: RenderScope): string => {
  switch (scope.type) {
    case 'full':
      return ''
    case 'range':
      return ` ${formatMinuteSecond(scope.start)}〜${formatMinuteSecond(scope.end)}`
    case 'shot':
      return ' Shot 1 本'
  }
}

export type RenderExportFileNameInput = {
  readonly projectName: string
  /** 書き出しを頼んだ日時。 */
  readonly createdAt: Date
  readonly preset: RenderPreset
  readonly scope: RenderScope
  /** 日時をどの地域の時刻で書くか（IANA の名前。例: `Asia/Tokyo`）。 */
  readonly timeZone: string
}

/** 例: `ぼくははると 2026-10-02 22.52.31 プレビュー（720p） 0分00秒〜0分51秒.mp4` */
export const renderExportFileName = (input: RenderExportFileNameInput): string =>
  `${renderExportFolderName(input.projectName)} ${formatStamp(input.createdAt, input.timeZone)} ` +
  `${RENDER_PRESET_LABELS[input.preset]}${scopeSuffix(input.scope)}.mp4`
