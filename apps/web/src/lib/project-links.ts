import type { ProjectId } from '@ixa/domain'
import { LEGACY_SECTIONS, legacySectionHref, type LegacySection } from '@/lib/workbench-url'

/**
 * Project の中の行き先（プロジェクト一覧のカードなど、ワークベンチの外から入る口）。
 *
 * **画面を足したらここに追記すること。** 以前ストーリーボードとタイムラインが
 * どこからもリンクされておらず、URL を直接打つしか到達手段が無い状態になっていた。
 *
 * PHASE 7.1 から Project は 1 画面のワークベンチになった（ADR-0021）。行き先はすべて
 * ワークベンチの該当タブ・ダイアログで、旧 URL を経由しない（`workbench-url.ts` の表が正）。
 */
export type ProjectSection = LegacySection

const LABELS: Readonly<Record<ProjectSection, string>> = Object.freeze({
  music: '楽曲',
  storyboard: 'ストーリーボード',
  shots: 'Shot 一覧',
  timeline: 'タイムライン',
  render: '書き出し',
  settings: '設定',
})

/** 並び順は制作の流れ（曲 → ストーリーボード → Shot → タイムライン）に合わせる。 */
const ORDER: readonly ProjectSection[] = [
  'music',
  'storyboard',
  'shots',
  'timeline',
  'render',
  'settings',
]

export const PROJECT_SECTIONS: readonly { readonly key: ProjectSection; readonly label: string }[] =
  Object.freeze(
    ORDER.filter((key) => (LEGACY_SECTIONS as readonly string[]).includes(key)).map((key) => ({
      key,
      label: LABELS[key],
    })),
  )

export const projectSectionHref = (projectId: ProjectId, section: ProjectSection): string =>
  legacySectionHref(projectId, section)
