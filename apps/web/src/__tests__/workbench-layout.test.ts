import type { AddPanelOptions } from 'dockview-react'
import { ProjectId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  LEFT_WIDTH_PX,
  PANEL_IDS,
  SIDE_WIDTH_PX,
  addDefaultPanels,
  applyPreset,
  sizeDefaultAreas,
  shouldFrontCutter,
  migrateLegacyLayout,
  BOTTOM_HEIGHT_RATIO,
  clearWorkbenchLayout,
  focusPanel,
  readStoredWorkbenchLayout,
  workbenchLayoutKey,
  writeWorkbenchLayout,
  type DockLike,
} from '@/lib/workbench-layout'
import { PROJECT_ID } from './fixtures'

/**
 * ワークベンチの配置（UI-WORKBENCH §3 / §6 / §10）。
 * 入れ子が意図どおりに並ぶかは `addPanel` の順序と位置で決まる。それをここで固定する。
 */

/** `addPanel` と `setActive` の呼ばれ方を記録する偽物。 */
const fakeDock = (existing: readonly string[] = []) => {
  const added: AddPanelOptions[] = []
  const activated: string[] = []
  const present = new Set(existing)
  const api: DockLike = {
    addPanel: (options) => {
      added.push(options)
      present.add(options.id)
      return undefined
    },
    getPanel: (id) =>
      present.has(id)
        ? {
            api: {
              setActive: () => {
                activated.push(id)
              },
            },
          }
        : undefined,
  }
  return { api, added, activated }
}

describe('既定配置', () => {
  const { api, added } = fakeDock()
  addDefaultPanels(api)
  const byId = new Map(added.map((options) => [options.id, options]))

  it('全パネルが 1 回ずつある', () => {
    expect(added.map((options) => options.id).sort()).toEqual([...PANEL_IDS].sort())
    // §10: 設計書の 8 パネル（+ 素材ビューア・絵コンテ下書き。自動で割るは PHASE 8 で外した）
    expect(added.map((options) => options.id)).toEqual(
      expect.arrayContaining([
        'storyboard',
        'preview',
        'compare',
        'cutter',
        'timeline',
        'shots',
        'inspector',
        'assets',
      ]),
    )
  })

  it('中央上が起点、中央下はその下、右と左は全体の端', () => {
    expect(added[0]?.id).toBe('storyboard')
    expect(byId.get('storyboard')?.position).toBeUndefined()
    expect(byId.get('timeline')?.position).toEqual({ referencePanel: 'storyboard', direction: 'below' })
    expect(byId.get('shots')?.position).toEqual({ direction: 'right' })
    expect(byId.get('assets')?.position).toEqual({ direction: 'left' })
  })

  it('右は 360px、左は 240px', () => {
    expect(byId.get('shots')?.initialWidth).toBe(SIDE_WIDTH_PX)
    expect(byId.get('assets')?.initialWidth).toBe(LEFT_WIDTH_PX)
    expect(SIDE_WIDTH_PX).toBe(360)
    expect(LEFT_WIDTH_PX).toBe(240)
  })

  it('同じ区画のほかのパネルは先頭のタブに並び、裏に回る', () => {
    expect(byId.get('preview')?.position).toEqual({ referencePanel: 'storyboard', direction: 'within' })
    expect(byId.get('compare')?.inactive).toBe(true)
    expect(byId.get('cutter')?.position).toEqual({ referencePanel: 'timeline', direction: 'within' })
    expect(byId.get('cutter')?.inactive).toBe(true)
    expect(byId.get('inspector')?.position).toEqual({ referencePanel: 'shots', direction: 'within' })
    expect(byId.get('inspector')?.inactive).toBe(true)
  })

  it('区画の先頭は表に出る。下の区画はタイムラインが前（制作者 2026-10-19）', () => {
    expect(byId.get('storyboard')?.inactive).toBeUndefined()
    expect(byId.get('timeline')?.inactive).toBeUndefined()
    expect(byId.get('shots')?.inactive).toBeUndefined()
  })

  it('下の区画のタブは タイムライン・聴きながら切る・検査・変更履歴・コンソール の順', () => {
    const bottom = added
      .map((options) => options.id)
      .filter((id) => ['timeline', 'cutter', 'checks', 'history', 'console'].includes(id))
    expect(bottom).toEqual(['timeline', 'cutter', 'checks', 'history', 'console'])
    ;['checks', 'history', 'console'].forEach((id) => {
      expect(byId.get(id)?.position).toEqual({ referencePanel: 'timeline', direction: 'within' })
      expect(byId.get(id)?.inactive).toBe(true)
    })
  })

  it('参照先は必ず先に置かれている', () => {
    const seen = new Set<string>()
    added.forEach((options) => {
      const position = options.position
      if (position !== undefined && 'referencePanel' in position) {
        const reference = position.referencePanel
        expect(typeof reference === 'string' && seen.has(reference)).toBe(true)
      }
      seen.add(options.id)
    })
  })
})

describe('プリセット（§6）', () => {
  it('構成: ストーリーボード・聴きながら切る・Shot 一覧を前に出す', () => {
    const { api, activated, added } = fakeDock(PANEL_IDS)
    applyPreset(api, 'compose')
    expect(activated).toEqual(['storyboard', 'cutter', 'shots'])
    expect(added).toEqual([])
  })

  it('仕上げ: Take 比較・タイムライン・インスペクターを前に出す', () => {
    const { api, activated } = fakeDock(PANEL_IDS)
    applyPreset(api, 'finish')
    expect(activated).toEqual(['compare', 'timeline', 'inspector'])
  })
})

describe('focusPanel', () => {
  it('閉じられていたら住んでいた区画へ戻す', () => {
    const { api, added } = fakeDock(['storyboard', 'cutter', 'shots'])
    focusPanel(api, 'inspector')
    expect(added).toEqual([
      expect.objectContaining({
        id: 'inspector',
        position: { referencePanel: 'shots', direction: 'within' },
      }),
    ])
  })

  it('区画ごと無ければ区画を作る。中央上が無いときの中央下は全体の下', () => {
    const { api, added } = fakeDock([])
    focusPanel(api, 'timeline')
    expect(added[0]?.position).toEqual({ direction: 'below' })
  })
})

describe('保存', () => {
  const projectId = ProjectId.parse(PROJECT_ID)
  const memory = () => {
    const store = new Map<string, string>()
    return {
      store,
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    }
  }

  it('鍵は ixa:workbench-layout:v3:<projectId>（下の区画にタブを足して版を上げた）', () => {
    expect(workbenchLayoutKey(projectId)).toBe(`ixa:workbench-layout:v3:${PROJECT_ID}`)
  })

  it('v2 の保存は読まない（新しいタブの無い配置で開かない）', () => {
    const storage = memory()
    storage.setItem(`ixa:workbench-layout:v2:${PROJECT_ID}`, '{"grid":{},"panels":{}}')
    expect(readStoredWorkbenchLayout(storage, projectId)).toEqual({ state: 'missing' })
  })

  it('無ければ missing', () => {
    expect(readStoredWorkbenchLayout(memory(), projectId)).toEqual({ state: 'missing' })
  })

  it('壊れていれば invalid（理由付き）', () => {
    const storage = memory()
    storage.setItem(workbenchLayoutKey(projectId), '{"grid":')
    expect(readStoredWorkbenchLayout(storage, projectId).state).toBe('invalid')
    storage.setItem(workbenchLayoutKey(projectId), '{"panels":{}}')
    expect(readStoredWorkbenchLayout(storage, projectId).state).toBe('invalid')
  })

  it('書いて読み戻せ、消せる', () => {
    const storage = memory()
    const layout = { grid: { root: {}, width: 1, height: 1, orientation: 'HORIZONTAL' }, panels: {} }
    writeWorkbenchLayout(storage, projectId, layout as never)
    expect(readStoredWorkbenchLayout(storage, projectId)).toEqual({ state: 'ready', layout })
    clearWorkbenchLayout(storage, projectId)
    expect(readStoredWorkbenchLayout(storage, projectId)).toEqual({ state: 'missing' })
  })

  it('旧 ixa:storyboard-layout:v4 は読まない', () => {
    const storage = memory()
    storage.setItem(`ixa:storyboard-layout:v4:${PROJECT_ID}`, '{"grid":{},"panels":{}}')
    expect(readStoredWorkbenchLayout(storage, projectId)).toEqual({ state: 'missing' })
  })
})

describe('sizeDefaultAreas', () => {
  const recorder = () => {
    const sizes = new Map<string, { width?: number; height?: number }>()
    const dock = {
      getPanel: (id: string) => ({
        group: {
          api: {
            setSize: (size: { width?: number; height?: number }) => {
              sizes.set(id, size)
            },
          },
        },
      }),
    }
    return { sizes, dock }
  }

  it('左 240 / 右 360 に揃える', () => {
    const { sizes, dock } = recorder()
    sizeDefaultAreas(dock)
    expect(sizes.get('assets')).toEqual({ width: 240 })
    expect(sizes.get('shots')).toEqual({ width: 360 })
  })

  it('下の区画はドックの高さの約 45%（高さが分かるときだけ）', () => {
    expect(BOTTOM_HEIGHT_RATIO).toBe(0.45)
    const { sizes, dock } = recorder()
    sizeDefaultAreas(dock, 800)
    expect(sizes.get('timeline')).toEqual({ height: 360 })

    const unknown = recorder()
    sizeDefaultAreas(unknown.dock)
    expect(unknown.sizes.has('timeline')).toBe(false)
    const zero = recorder()
    sizeDefaultAreas(zero.dock, 0)
    expect(zero.sizes.has('timeline')).toBe(false)
  })
})

describe('聴きながら切るを前に出すか', () => {
  it('開いた時点で楽曲があって Shot が 0 件なら出す', () => {
    expect(shouldFrontCutter({ previousTrackId: undefined, trackId: 'T1', shotCount: 0 })).toBe(true)
  })

  it('開いた時点で Shot があれば出さない（タイムラインのまま）', () => {
    expect(shouldFrontCutter({ previousTrackId: undefined, trackId: 'T1', shotCount: 3 })).toBe(false)
  })

  it('開いた時点で楽曲が無い・Shot を読めていないなら出さない', () => {
    expect(shouldFrontCutter({ previousTrackId: undefined, trackId: null, shotCount: 0 })).toBe(false)
    expect(shouldFrontCutter({ previousTrackId: undefined, trackId: 'T1', shotCount: null })).toBe(false)
  })

  it('開いたあとでマスターの楽曲が決まった・替わったら、Shot があっても出す', () => {
    expect(shouldFrontCutter({ previousTrackId: null, trackId: 'T1', shotCount: 5 })).toBe(true)
    expect(shouldFrontCutter({ previousTrackId: 'T1', trackId: 'T2', shotCount: 5 })).toBe(true)
  })

  it('同じ楽曲のまま・楽曲が外れたときは出さない', () => {
    expect(shouldFrontCutter({ previousTrackId: 'T1', trackId: 'T1', shotCount: 0 })).toBe(false)
    expect(shouldFrontCutter({ previousTrackId: 'T1', trackId: null, shotCount: 0 })).toBe(false)
  })
})

describe('v2 の配置の移行', () => {
  const projectId = ProjectId.parse(PROJECT_ID)
  const legacyKey = `ixa:workbench-layout:v2:${PROJECT_ID}`
  const storageWith = (raw: string | null) => {
    const store = new Map<string, string>(raw === null ? [] : [[legacyKey, raw]])
    return {
      store,
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => {
        store.delete(key)
      },
    }
  }
  /** v2 にあった 11 枚を戻す偽物。`fromJSON` で置かれたことにする。 */
  const V2_PANELS = PANEL_IDS.filter((id) => !['checks', 'history', 'console'].includes(id))
  const migratableDock = (options: { readonly throws?: boolean } = {}) => {
    const base = fakeDock()
    const restored: unknown[] = []
    let cleared = 0
    const api = {
      ...base.api,
      fromJSON: (layout: unknown) => {
        if (options.throws === true) throw new Error('部品が足りません')
        restored.push(layout)
        V2_PANELS.forEach((id) => base.api.addPanel({ id, component: id }))
        base.added.length = 0
      },
      clear: () => {
        cleared += 1
      },
    }
    return { api, added: base.added, restored, cleared: () => cleared }
  }

  it('v2 が無ければ何もしない', () => {
    const dock = migratableDock()
    expect(migrateLegacyLayout(dock.api, storageWith(null), projectId)).toEqual({ state: 'none' })
    expect(dock.restored).toEqual([])
  })

  it('v2 を戻し、足りない 3 枚を下の区画の裏に足して、v2 を消す', () => {
    const dock = migratableDock()
    const storage = storageWith('{"grid":{},"panels":{}}')
    expect(migrateLegacyLayout(dock.api, storage, projectId)).toEqual({ state: 'migrated' })
    expect(dock.restored).toHaveLength(1)
    expect(dock.added.map((options) => options.id)).toEqual(['checks', 'history', 'console'])
    dock.added.forEach((options) => {
      expect(options.position).toEqual({ referencePanel: 'timeline', direction: 'within' })
      expect(options.inactive).toBe(true)
    })
    expect(storage.store.has(legacyKey)).toBe(false)
  })

  it('v2 が壊れていれば読めなかったと返し、v2 を消す（次からは知らせない）', () => {
    const dock = migratableDock()
    const storage = storageWith('{"grid":')
    expect(migrateLegacyLayout(dock.api, storage, projectId).state).toBe('unreadable')
    expect(storage.store.has(legacyKey)).toBe(false)
  })

  it('v2 を戻せなければ、ドックを空にして読めなかったと返す', () => {
    const dock = migratableDock({ throws: true })
    const storage = storageWith('{"grid":{},"panels":{}}')
    const result = migrateLegacyLayout(dock.api, storage, projectId)
    expect(result).toEqual({ state: 'unreadable', reason: '部品が足りません' })
    expect(dock.cleared()).toBe(1)
    expect(storage.store.has(legacyKey)).toBe(false)
  })
})
