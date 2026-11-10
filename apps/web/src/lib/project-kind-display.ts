import type { ProjectKind } from '@ixa/domain'

/**
 * 作品の種類の名前と一言（新しい作品の画面・一覧で使う）。
 * 始め方と既定の形の規則はドメインの `projectKindRule` が持つ。ここは言葉だけ。
 */
export type ProjectKindDisplay = {
  readonly label: string
  readonly hint: string
}

const PROJECT_KIND_DISPLAY: Readonly<Record<ProjectKind, ProjectKindDisplay>> = Object.freeze({
  mv: Object.freeze({ label: 'ミュージックビデオ', hint: '曲に合わせて切ります。横長' }),
  short: Object.freeze({ label: 'ショート動画', hint: '曲に合わせて切ります。縦長' }),
  kamishibai: Object.freeze({ label: '紙芝居', hint: 'ナレーションと絵で進めます' }),
  cm: Object.freeze({ label: 'CM・予告', hint: 'ナレーションと文字で短く伝えます' }),
  library: Object.freeze({ label: '素材置き場', hint: 'キャラクターや曲をためておき、他の作品へ取り込みます' }),
})

export const projectKindDisplay = (kind: ProjectKind): ProjectKindDisplay => PROJECT_KIND_DISPLAY[kind]

export const projectKindLabel = (kind: ProjectKind): string => PROJECT_KIND_DISPLAY[kind].label

export const projectKindHint = (kind: ProjectKind): string => PROJECT_KIND_DISPLAY[kind].hint
