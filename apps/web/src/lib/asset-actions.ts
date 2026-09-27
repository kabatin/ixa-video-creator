import { z } from 'zod'
import type { CharacterId, CharacterLookId, ShotCharacter } from '@ixa/domain'

/**
 * 素材の操作で使う純粋な規則（PHASE 8.2 / 8.5）。**React も fetch も含まない。**
 */

// --- Look の key ---

/**
 * Look の名前から key を作る（key は `^[A-Z0-9_]+$`、Shot から Look を指す識別子）。
 * 英数字が取れなければ `LOOK`。既にある key と重なれば `_2`, `_3` … を付ける。
 */
export const lookKeyFromName = (name: string, existing: readonly string[]): string => {
  const base =
    name
      .normalize('NFKC')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'LOOK'
  const taken = new Set(existing)
  if (!taken.has(base)) return base
  let index = 2
  while (taken.has(`${base}_${String(index)}`)) index += 1
  return `${base}_${String(index)}`
}

// --- ドラッグで運ぶもの ---

/** `DataTransfer` に載せる型。ブラウザの外から来たものと混ざらないよう専用の型にする。 */
export const ASSET_DRAG_TYPE = 'application/x-ixa-asset'

const AssetDragPayload = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('character'), id: z.string().min(1) }),
  z.object({ kind: z.literal('location'), id: z.string().min(1) }),
])
export type AssetDragPayload = z.infer<typeof AssetDragPayload>

export const encodeAssetDrag = (payload: AssetDragPayload): string => JSON.stringify(payload)

/** 読めないもの（他のアプリから落とされた文字など）は null。例外を投げない。 */
export const parseAssetDrag = (raw: string): AssetDragPayload | null => {
  try {
    const parsed = AssetDragPayload.safeParse(JSON.parse(raw) as unknown)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

// --- 登場人物に足す ---

export type CastEntry = Omit<ShotCharacter, 'shotId'>

/**
 * 登場人物に 1 人足した並びを返す。**既に出ていれば何も変えない**（null）。
 * 最初の 1 人は主役（primary）、それ以降は secondary。order は末尾。
 * Look は必須（`ShotCharacter.lookId`）。呼び出し側が既定の Look を渡す。
 */
export const castWithCharacter = (
  current: readonly CastEntry[],
  characterId: CharacterId,
  lookId: CharacterLookId,
): readonly CastEntry[] | null => {
  if (current.some((entry) => entry.characterId === characterId)) return null
  const order = current.reduce((max, entry) => Math.max(max, entry.order + 1), 0)
  return [
    ...current,
    { characterId, lookId, prominence: current.length === 0 ? 'primary' : 'secondary', order },
  ]
}

/**
 * 登場人物に足すときの Look。**既定の Look、無ければ先頭。どちらも無ければ null**（足せない）。
 * ツリーからのドラッグとインスペクターの「＋」が同じ規則を使う（L-012: 規則を書き写さない）。
 */
export const defaultLook = <T extends { readonly isDefault: boolean }>(
  looks: readonly T[],
): T | null => looks.find((look) => look.isDefault) ?? looks[0] ?? null

// --- 落とされたファイル ---

export type DroppedFileKind = 'audio' | 'image' | 'video' | 'other'

/** 種類で行き先を分ける（§4.5）。拡張子より MIME を優先し、無ければ拡張子で見る。 */
export const droppedFileKind = (file: {
  readonly type: string
  readonly name: string
}): DroppedFileKind => {
  if (file.type.startsWith('audio/')) return 'audio'
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  const ext = file.name.toLowerCase().split('.').at(-1) ?? ''
  if (['wav', 'mp3', 'aac', 'm4a', 'flac', 'ogg', 'aiff', 'aif'].includes(ext)) return 'audio'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image'
  if (['mp4', 'mov', 'm4v', 'webm'].includes(ext)) return 'video'
  return 'other'
}

export type GroupedFiles<F> = {
  readonly audio: readonly F[]
  readonly image: readonly F[]
  /** 手持ちの動画。選んでいる Shot の Take にする（ADR-0026）。 */
  readonly video: readonly F[]
  readonly otherCount: number
}

/** 落とされたファイルを種類で分ける。受けられない種類は数だけ返す（黙って捨てず、呼び出し側が伝える）。 */
export const groupDroppedFiles = <F extends { readonly type: string; readonly name: string }>(
  files: readonly F[],
): GroupedFiles<F> => ({
  audio: files.filter((file) => droppedFileKind(file) === 'audio'),
  image: files.filter((file) => droppedFileKind(file) === 'image'),
  video: files.filter((file) => droppedFileKind(file) === 'video'),
  otherCount: files.filter((file) => droppedFileKind(file) === 'other').length,
})

/** ファイル名から拡張子を外した名前（新しい素材の仮の名前）。空なら元の名前。 */
export const fileBaseName = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName).trim()
  return base === '' ? fileName.trim() : base
}
