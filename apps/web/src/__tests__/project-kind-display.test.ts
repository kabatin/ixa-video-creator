import { ProjectKind } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { projectKindDisplay, projectKindHint, projectKindLabel } from '@/lib/project-kind-display'
import { PROJECT_KIND_CHOICES } from '@/lib/project-spec-choices'

describe('作品の種類の表示', () => {
  it('どの種類にも名前と一言がある（種類を足したらここも足す）', () => {
    for (const kind of ProjectKind.options) {
      expect(projectKindLabel(kind).length).toBeGreaterThan(0)
      expect(projectKindHint(kind).length).toBeGreaterThan(0)
    }
  })

  it('新規作成の選択肢は全部の種類を 1 回ずつ並べる', () => {
    expect(PROJECT_KIND_CHOICES.map((choice) => choice.value)).toEqual(['mv', 'short', 'kamishibai', 'cm', 'library'])
    expect([...PROJECT_KIND_CHOICES.map((choice) => choice.value)].sort()).toEqual([...ProjectKind.options].sort())
  })

  it('名前は重ならない', () => {
    const labels = ProjectKind.options.map(projectKindLabel)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('名前と一言', () => {
    expect(projectKindDisplay('mv')).toEqual({ label: 'ミュージックビデオ', hint: '曲に合わせて切ります。横長' })
    expect(projectKindDisplay('short')).toEqual({ label: 'ショート動画', hint: '曲に合わせて切ります。縦長' })
    expect(projectKindDisplay('kamishibai')).toEqual({ label: '紙芝居', hint: 'ナレーションと絵で進めます' })
    expect(projectKindDisplay('cm')).toEqual({ label: 'CM・予告', hint: 'ナレーションと文字で短く伝えます' })
    expect(projectKindDisplay('library')).toEqual({
      label: '素材置き場',
      hint: 'キャラクターや曲をためておき、他の作品へ取り込みます',
    })
  })
})
