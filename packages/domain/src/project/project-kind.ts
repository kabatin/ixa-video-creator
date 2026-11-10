import { z } from 'zod'
import type { AspectRatio } from '../common/time.js'

/**
 * 作品の種類（何を作るか）。新しい作品の画面で選び、作業の始め方と既定の形を決める。
 * `library`（素材置き場）は作品として書き出さず、キャラクターや曲をためて他の作品へ取り込むためのもの。一覧では畳む。
 * **表示の言葉はここに持たない**（画面が持つ。web の `project-kind-display.ts`）。
 */
export const ProjectKind = z.enum(['mv', 'short', 'kamishibai', 'cm', 'library'])
export type ProjectKind = z.infer<typeof ProjectKind>

/** 種類を選んでいないとき（これまでの作品・種類を送らない呼び出し）。 */
export const DEFAULT_PROJECT_KIND: ProjectKind = 'mv'

/** 作業を何から始めるか。曲に合わせて切る・ナレーションで進める・どちらでもない（素材置き場）。 */
export type ProjectStart = 'music' | 'narration' | 'none'

export type ProjectKindRule = {
  readonly startsFrom: ProjectStart
  /** 新しく作るときの画面の形。`null` は決めない（素材置き場は書き出さない）。 */
  readonly defaultAspectRatio: AspectRatio | null
}

const PROJECT_KIND_RULES: Readonly<Record<ProjectKind, ProjectKindRule>> = Object.freeze({
  mv: Object.freeze({ startsFrom: 'music', defaultAspectRatio: '16:9' }),
  short: Object.freeze({ startsFrom: 'music', defaultAspectRatio: '9:16' }),
  kamishibai: Object.freeze({ startsFrom: 'narration', defaultAspectRatio: '16:9' }),
  cm: Object.freeze({ startsFrom: 'narration', defaultAspectRatio: '16:9' }),
  library: Object.freeze({ startsFrom: 'none', defaultAspectRatio: null }),
})

/** 種類ごとの規則（始め方と既定の形）。 */
export const projectKindRule = (kind: ProjectKind): ProjectKindRule => PROJECT_KIND_RULES[kind]
