import type { ProjectId } from '@ixa/domain'

/**
 * Project 配下の画面へのリンク。
 *
 * **画面を足したらここに追記すること。** 以前ストーリーボードとタイムラインが
 * どこからもリンクされておらず、URL を直接打つしか到達手段が無い状態になっていた。
 * 実装したのに使えない画面を作らないため、行き先を 1 箇所に集める。
 */
export type ProjectSection = 'shots' | 'storyboard' | 'timeline'

export const PROJECT_SECTIONS: readonly { readonly key: ProjectSection; readonly label: string }[] =
  Object.freeze([
    { key: 'shots', label: 'Shot 一覧' },
    { key: 'storyboard', label: 'ストーリーボード' },
    { key: 'timeline', label: 'タイムライン' },
  ])

export const projectSectionHref = (projectId: ProjectId, section: ProjectSection): string =>
  `/projects/${encodeURIComponent(projectId)}/${section}`
