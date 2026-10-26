/**
 * インスペクターの区切りを開いているか（UI-WORKBENCH-2 §5.1、2026-10-26）。**React を含まない。**
 *
 * 制作データではないので DB に入れない。この端末のこのブラウザだけで覚える。
 * **覚えられなくても動く。** プライベートウィンドウや拒否された保存域では読み書きが例外を投げるので、
 * 読めなければ「覚えていない」（既定で開け閉め）、書けなければ黙って諦める（画面の開け閉めは効いたまま）。
 */

const PREFIX = 'ixa:inspector-section:v1'

/** 覚えた開け閉め。`null` は「覚えていない」（既定に従う）。 */
export type RememberedOpen = boolean | null

/** どの種類のインスペクター（`shot` / `character`）の、どの区切りか。 */
export const sectionStorageKey = (scope: string, id: string): string => `${PREFIX}:${scope}:${id}`

/** 保存域を取る。**取ること自体が例外を投げる**ブラウザがあるので、ここで受ける。 */
const storage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export const readSectionOpen = (scope: string, id: string): RememberedOpen => {
  try {
    const raw = storage()?.getItem(sectionStorageKey(scope, id)) ?? null
    if (raw === 'open') return true
    if (raw === 'closed') return false
    return null
  } catch {
    // 読めない端末では覚えていないのと同じ。既定で出す。
    return null
  }
}

/** 書けたか。書けなくても画面の開け閉めは効いているので、呼ぶ側は知らせない。 */
export const writeSectionOpen = (scope: string, id: string, open: boolean): boolean => {
  try {
    const target = storage()
    if (target === null) return false
    target.setItem(sectionStorageKey(scope, id), open ? 'open' : 'closed')
    return true
  } catch {
    return false
  }
}
