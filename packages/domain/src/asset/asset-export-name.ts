import { safeNameForFinder } from '../render/render-export-name.js'

/**
 * 作った素材を手元のフォルダから開けるようにするときの名前（ADR-0041。制作者 2026-10-07
 * 「作った素材は個別に何かに使いたいこともあると思うので、普通にフォルダ開いて見れるといいな」）。
 *
 * 保管庫の中は `media/<ULID>/<ULID>/original.mp4` で、開けても**どれが何か分からない**。
 * そこで作品ごとのフォルダに、Shot の順に並ぶ読める名前を付ける。
 *
 * **フォルダの外を指せない名前にする。** 危ない文字を落とすのは `safeNameForFinder`（ADR-0036 と共有）。
 */

/** 作品フォルダの下に作る、素材のフォルダ名。画面の言葉と同じ（CLAUDE.md「画面の言葉」）。 */
export const ASSET_FOLDER_NAME = '素材'

/** 拡張子として使える形（英数字だけ）。分からなければ `bin`。 */
const EXTENSION_PATTERN = /^[A-Za-z0-9]+$/
const FALLBACK_EXTENSION = 'bin'

const safeExtension = (extension: string): string => {
  const lower = extension.trim().toLowerCase()
  return EXTENSION_PATTERN.test(lower) ? lower : FALLBACK_EXTENSION
}

/** Shot のコード（`CUT-01`）。空や危ない文字のときは `Shot`。 */
const shotPart = (shotCode: string): string => safeNameForFinder(shotCode, 'Shot')

export type TakeExportFileNameInput = {
  readonly shotCode: string
  /** Shot の中での番号（1 から。画面の `Take 2` と同じ数）。 */
  readonly takeIndex: number
  /** その Shot で採用されている Take か。**本編に入っている方が Finder で分かるようにする。** */
  readonly selected: boolean
  /** 拡張子（`mp4` など。`.` は付けない）。 */
  readonly extension: string
}

/**
 * 例: `CUT-01 Take 2 採用.mp4`
 *
 * 日時は入れない。`Shot のコード × Take 番号`は作品の中で 1 つに決まるので、
 * 日時を足しても見分けには効かず、名前が長くなるだけ（書き出しは同じ秒に何本も作れるので入れている）。
 */
export const takeExportFileName = (input: TakeExportFileNameInput): string =>
  `${shotPart(input.shotCode)} Take ${String(Math.trunc(input.takeIndex))}` +
  `${input.selected ? ' 採用' : ''}.${safeExtension(input.extension)}`

/** 例: `CUT-01 最初のフレーム.png`（ADR-0025 の絵。画面と同じ言葉にする）。 */
export const startFrameExportFileName = (shotCode: string, extension: string): string =>
  `${shotPart(shotCode)} 最初のフレーム.${safeExtension(extension)}`
