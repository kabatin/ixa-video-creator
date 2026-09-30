import { describe, expect, it } from 'vitest'
import {
  assetMenuEntries,
  placeContextMenu,
  shotMenuEntries,
  type AssetMenuAction,
  type ContextMenuEntry,
  type ShotMenuAction,
} from '@/lib/context-menus'
import { DELETE_SHORTCUT, NO_ADOPTED_TAKE, SPLIT_SHORTCUT } from '@/lib/menu-model'
import { aWorkbenchShot } from './workbench-fixture'

/**
 * 右クリックのメニューの中身（制作者 2026-09-30「タイムラインで右クリックして Take を作れたら最高」）。
 * **押せない理由とショートカットの表示はメニューバーと同じ文**（書き写さない）。
 */

type Item = Extract<ContextMenuEntry<ShotMenuAction>, { kind: 'item' }>
const items = (entries: readonly ContextMenuEntry<ShotMenuAction>[]): Item[] =>
  entries.filter((entry): entry is Item => entry.kind === 'item')
const byAction = (entries: readonly ContextMenuEntry<ShotMenuAction>[], action: ShotMenuAction) =>
  items(entries).find((entry) => entry.action === action)

describe('shotMenuEntries', () => {
  it('Take を作る を先頭に、できることを並べる', () => {
    const entries = shotMenuEntries({ shot: aWorkbenchShot(1), splitBlocker: null })

    expect(items(entries).map((entry) => entry.label)).toEqual([
      'Take を作る…',
      'Take 比較で見る',
      '絵コンテの画像を AI で作る',
      '再生位置で分割',
      '採用を外す',
      '削除…',
    ])
  })

  it('採用している Take が無ければ「採用を外す」は押せず、メニューバーと同じ理由を言う', () => {
    const none = shotMenuEntries({
      shot: aWorkbenchShot(1, { selectedTakeId: null }),
      splitBlocker: null,
    })
    const adopted = shotMenuEntries({
      shot: aWorkbenchShot(1, { selectedTakeId: '01ARZ3NDEKTSV4RRFFQ69G5FT1' }),
      splitBlocker: null,
    })

    expect(byAction(none, 'unselect-take')?.disabledReason).toBe(NO_ADOPTED_TAKE)
    expect(byAction(adopted, 'unselect-take')?.disabledReason).toBeNull()
  })

  it('再生位置で分割できない理由をそのまま出し、ショートカットはメニューバーと同じ', () => {
    const entries = shotMenuEntries({
      shot: aWorkbenchShot(1),
      splitBlocker: '再生位置がこの Shot の中にありません',
    })

    expect(byAction(entries, 'split')).toMatchObject({
      disabledReason: '再生位置がこの Shot の中にありません',
      shortcut: SPLIT_SHORTCUT,
    })
    expect(byAction(entries, 'delete')?.shortcut).toBe(DELETE_SHORTCUT)
  })

  it('Shot 一覧ではチェックの付け外しも並べる（付いていれば「外す」）', () => {
    const off = shotMenuEntries({ shot: aWorkbenchShot(1), splitBlocker: null, checked: false })
    const on = shotMenuEntries({ shot: aWorkbenchShot(1), splitBlocker: null, checked: true })
    const elsewhere = shotMenuEntries({ shot: aWorkbenchShot(1), splitBlocker: null })

    expect(byAction(off, 'toggle-check')?.label).toBe('チェックを付ける')
    expect(byAction(on, 'toggle-check')?.label).toBe('チェックを外す')
    expect(byAction(elsewhere, 'toggle-check')).toBeUndefined()
  })

  it('区切り線は項目の間にだけ置く（先頭・末尾・連続に置かない）', () => {
    const kinds = shotMenuEntries({ shot: aWorkbenchShot(1), splitBlocker: null }).map(
      (entry) => entry.kind,
    )

    expect(kinds[0]).toBe('item')
    expect(kinds.at(-1)).toBe('item')
    expect(kinds.join(',')).not.toContain('separator,separator')
  })
})

describe('placeContextMenu', () => {
  const viewport = { width: 1000, height: 800 }
  const size = { width: 200, height: 300 }

  it('押した所の右下に開く', () => {
    expect(placeContextMenu({ x: 100, y: 100 }, size, viewport)).toEqual({ left: 100, top: 100 })
  })

  it('右が足りなければ左へ、下が足りなければ上へ返す', () => {
    expect(placeContextMenu({ x: 950, y: 700 }, size, viewport)).toEqual({ left: 750, top: 400 })
  })

  it('どちらに返しても入らなければ、画面の縁から離して収める', () => {
    expect(placeContextMenu({ x: 50, y: 50 }, { width: 200, height: 900 }, viewport)).toEqual({
      left: 50,
      top: 8,
    })
  })
})

describe('assetMenuEntries', () => {
  type AssetItem = Extract<ContextMenuEntry<AssetMenuAction>, { kind: 'item' }>
  const labels = (entries: readonly ContextMenuEntry<AssetMenuAction>[]) =>
    entries.filter((entry): entry is AssetItem => entry.kind === 'item').map((entry) => entry.label)
  const find = (entries: readonly ContextMenuEntry<AssetMenuAction>[], action: AssetMenuAction) =>
    entries.find((entry): entry is AssetItem => entry.kind === 'item' && entry.action === action)

  it('素材ツリーでは、見る・直す・削除', () => {
    expect(labels(assetMenuEntries({ kind: 'character', name: 'ミナ', where: 'tree' }))).toEqual([
      '素材ビューアで見る',
      'インスペクターで直す',
      'キャラクターを削除',
    ])
  })

  it('インスペクターの「…」では、直す（いま開いている）は出さない', () => {
    expect(labels(assetMenuEntries({ kind: 'location', name: '体育館', where: 'inspector' }))).toEqual([
      '素材ビューアで見る',
      'ロケーションを削除',
    ])
  })

  it('削除は確認を挟み、何が起きるかを言う（インスペクターと同じ文）', () => {
    expect(find(assetMenuEntries({ kind: 'character', name: 'ミナ', where: 'tree' }), 'delete')?.confirm).toBe(
      'ミナ を削除します。この人が出ている Shot からも外れます。',
    )
    expect(
      find(assetMenuEntries({ kind: 'track', name: 'ぼくははると', where: 'tree', isMaster: true }), 'delete')?.confirm,
    ).toMatch(/マスターの「ぼくははると」を削除します/)
  })

  it('Look は既定にでき、すでに既定なら押せない理由を言う', () => {
    const plain = assetMenuEntries({ kind: 'look', name: '仕事帰り', where: 'tree', isDefaultLook: false })
    const already = assetMenuEntries({ kind: 'look', name: 'バリスタ', where: 'tree', isDefaultLook: true })

    expect(find(plain, 'set-default-look')?.disabledReason).toBeNull()
    expect(find(already, 'set-default-look')?.disabledReason).toBe('もう既定の Look です')
  })

  it('楽曲はマスターにでき、再解析もできる', () => {
    const entries = assetMenuEntries({ kind: 'track', name: '曲', where: 'tree', isMaster: true })

    expect(find(entries, 'set-master')?.disabledReason).toBe('もうマスターの楽曲です')
    expect(find(entries, 'reanalyze')).toBeDefined()
  })

  it('作品の方針は直すだけ（消せない・素材ビューアには出ない）', () => {
    expect(labels(assetMenuEntries({ kind: 'project', name: '作品の方針', where: 'tree' }))).toEqual([
      'インスペクターで直す',
    ])
  })
})

