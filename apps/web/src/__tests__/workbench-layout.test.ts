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
    expect(byId.get('cutter')?.position).toEqual({ referencePanel: 'storyboard', direction: 'below' })
    expect(byId.get('shots')?.position).toEqual({ direction: 'right' })
    expect(byId.get('assets')?.position).toEqual({ direction: 'left' })
  })

  it('右は 320px、左は 240px', () => {
    expect(byId.get('shots')?.initialWidth).toBe(SIDE_WIDTH_PX)
    expect(byId.get('assets')?.initialWidth).toBe(LEFT_WIDTH_PX)
    expect(SIDE_WIDTH_PX).toBe(320)
    expect(LEFT_WIDTH_PX).toBe(240)
  })

  it('同じ区画のほかのパネルは先頭のタブに並び、裏に回る', () => {
    expect(byId.get('preview')?.position).toEqual({ referencePanel: 'storyboard', direction: 'within' })
    expect(byId.get('compare')?.inactive).toBe(true)
    expect(byId.get('timeline')?.position).toEqual({ referencePanel: 'cutter', direction: 'within' })
    expect(byId.get('inspector')?.position).toEqual({ referencePanel: 'shots', direction: 'within' })
    expect(byId.get('inspector')?.inactive).toBe(true)
  })

  it('区画の先頭は表に出る（構成モードの 3 枚）', () => {
    expect(byId.get('storyboard')?.inactive).toBeUndefined()
    expect(byId.get('cutter')?.inactive).toBeUndefined()
    expect(byId.get('shots')?.inactive).toBeUndefined()
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

  it('鍵は ixa:workbench-layout:v2:<projectId>（PHASE 8.2 で版を上げた）', () => {
    expect(workbenchLayoutKey(projectId)).toBe(`ixa:workbench-layout:v2:${PROJECT_ID}`)
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
  it('左 240 / 右 320 に揃える', () => {
    const sizes = new Map<string, number | undefined>()
    const dock = {
      getPanel: (id: string) => ({
        group: {
          api: {
            setSize: (size: { width?: number }) => {
              sizes.set(id, size.width)
            },
          },
        },
      }),
    }
    sizeDefaultAreas(dock)
    expect(sizes).toEqual(new Map([['assets', 240], ['shots', 320]]))
  })
})
