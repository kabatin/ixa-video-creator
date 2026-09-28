import type {
  BrandAssetId,
  CharacterId,
  CharacterLookId,
  LocationId,
  MusicTrackId,
  ShotId,
  TimelineClipId,
} from '@ixa/domain'

/**
 * インスペクターが見ている物（UI-WORKBENCH-2 §2 P1 / §5）。**React を含まない。**
 * Shot 専用ではなく、選んだ物の種類で右の中身が変わる。
 */
export type Inspected =
  | { readonly kind: 'shot'; readonly id: ShotId }
  | { readonly kind: 'character'; readonly id: CharacterId }
  | { readonly kind: 'look'; readonly id: CharacterLookId; readonly characterId: CharacterId }
  | { readonly kind: 'location'; readonly id: LocationId }
  | { readonly kind: 'brand-asset'; readonly id: BrandAssetId }
  | { readonly kind: 'track'; readonly id: MusicTrackId }
  /** テロップ（ADR-0028）。見た目・位置・フェードとスタイルを直す。 */
  | { readonly kind: 'text-clip'; readonly id: TimelineClipId }

export type InspectedKind = Inspected['kind']

/** 素材（Shot・テロップ以外）か。素材ビューアに出せるのはこちら。 */
export const isAssetSelection = (
  selection: Inspected | null,
): selection is Exclude<Inspected, { kind: 'shot' | 'text-clip' }> =>
  selection !== null && selection.kind !== 'shot' && selection.kind !== 'text-clip'

export const sameSelection = (a: Inspected | null, b: Inspected | null): boolean =>
  a !== null && b !== null && a.kind === b.kind && a.id === b.id

export const INSPECTED_LABELS: Readonly<Record<InspectedKind, string>> = Object.freeze({
  shot: 'Shot',
  character: 'キャラクター',
  look: 'Look',
  location: 'ロケーション',
  'brand-asset': 'ブランド資産',
  track: '楽曲',
  'text-clip': 'テロップ',
})
