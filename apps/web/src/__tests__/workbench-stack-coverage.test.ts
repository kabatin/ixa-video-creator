import { describe, expect, it } from 'vitest'
import { STACK_PANEL_IDS, stackSectionId } from '@/components/workbench/workbench-stack'
import { PANEL_IDS, PANEL_SPECS, retitlePanels } from '@/lib/workbench-layout'

/**
 * 狭い画面（1024px 未満）ではドックを使わず縦一列にし、パネルへの移動は
 * `stackSectionId` の要素へスクロールして行う。
 *
 * **一覧から漏れたパネルは、そこに存在しない要素を指すことになる。**
 * メニューもボタンも押して何も起きず、機能そのものに到達できなくなる。
 * `draft` が実際に漏れていて、絵コンテ下書きへの入口 3 つが全部無反応だった。
 */
describe('狭い画面の縦一列', () => {
  it('PANEL_IDS の全部が並んでいる', () => {
    expect([...STACK_PANEL_IDS].sort()).toEqual([...PANEL_IDS].sort())
  })

  it('同じパネルを 2 回置かない', () => {
    expect(new Set(STACK_PANEL_IDS).size).toBe(STACK_PANEL_IDS.length)
  })

  it('区画の id はパネルごとに違う', () => {
    const ids = PANEL_IDS.map(stackSectionId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

/**
 * 保存した配置は `toJSON()` がタブ名も一緒に持つ。
 * パネルを改名しても、既に配置を保存している人の画面は古い名前のままになる
 * （実際に「素材ビューア」「絵コンテの案」へ改名したのに、実機のタブは
 * 「素材」「絵コンテ下書き」のままだった）。戻したあとに名前を当て直す。
 */
describe('保存した配置のタブ名', () => {
  it('いまの PANEL_SPECS の名前に当て直す', () => {
    const applied = new Map<string, string>()
    const api = {
      getPanel: (id: string) => ({ api: { setTitle: (title: string) => applied.set(id, title) } }),
    }

    retitlePanels(api)

    PANEL_IDS.forEach((id) => {
      expect(applied.get(id)).toBe(PANEL_SPECS[id].title)
    })
  })

  it('置かれていないパネルがあっても落ちない', () => {
    expect(() => {
      retitlePanels({ getPanel: () => undefined })
    }).not.toThrow()
  })
})
