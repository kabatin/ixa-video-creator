import { appendEnvLine, parseEnvFile } from '../lib/env-file.js'
import { defaultUrlOf, TOKEN_ENV_NAMES, urlEnvOfToken } from './servers.js'

/**
 * `pnpm ixa ai install | connect` が `.env` に書く（純粋。ADR-0064）。
 *
 * - `LOCAL_*_GENERATOR` は今の一覧に足す（`none` を外す・重ねない・今の順を残す）
 * - 値の入った `*_API_URL` を別の値に替えるのは、`overwrite` のときだけ（既定の値は空とみなす）
 * - 合言葉は対の URL を書けたときだけ書く。**値はどの文にも入れない**（返すのは名前だけ）
 */

export type EnvChanges = Readonly<Record<string, string>>

export type EnvApplied = {
  readonly content: string
  /** 書き換えた名前。 */
  readonly changed: readonly string[]
  /** 値が入っていて替えなかった名前（`overwrite` が要る）。 */
  readonly conflicts: readonly string[]
}

const isGeneratorKey = (key: string): boolean => /^LOCAL_[A-Z]+_GENERATOR$/.test(key)

/** 一覧を足し合わせる。`none` と空は外し、重ねず、今の順のまま後ろに足す。何も無ければ `none`。 */
export const mergeGeneratorList = (current: string, additions: string): string => {
  const items = [...current.split(','), ...additions.split(',')]
    .map((item) => item.trim())
    .filter((item) => item !== '' && item !== 'none')
  const merged = [...new Set(items)]
  return merged.length === 0 ? 'none' : merged.join(',')
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 1 行の値を替える（無ければ末尾に足す）。最初の 1 行だけを替える。 */
export const setEnvValue = (content: string, key: string, value: string): string => {
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm')
  return pattern.test(content) ? content.replace(pattern, () => `${key}=${value}`) : appendEnvLine(content, key, value)
}

type Decision = 'set' | 'same' | 'conflict'

const decide = (key: string, current: string, next: string, overwrite: boolean): Decision => {
  if (current === next) return 'same'
  if (current.trim() === '' || current === defaultUrlOf(key)) return 'set'
  return overwrite ? 'set' : 'conflict'
}

/** 合言葉は最後に回す（対の URL を替えられなかったら、合言葉も替えない）。 */
const orderedKeys = (changes: EnvChanges): readonly string[] => [
  ...Object.keys(changes).filter((key) => !TOKEN_ENV_NAMES.includes(key)),
  ...Object.keys(changes).filter((key) => TOKEN_ENV_NAMES.includes(key)),
]

export const applyEnvChanges = (content: string, changes: EnvChanges, overwrite: boolean): EnvApplied =>
  orderedKeys(changes).reduce<EnvApplied>(
    (acc, key) => {
      const current = parseEnvFile(acc.content)[key] ?? ''
      const wanted = changes[key] ?? ''
      if (isGeneratorKey(key)) {
        const merged = mergeGeneratorList(current, wanted)
        return merged === current ? acc : { ...acc, content: setEnvValue(acc.content, key, merged), changed: [...acc.changed, key] }
      }
      const pairedUrl = urlEnvOfToken(key)
      if (pairedUrl !== undefined && acc.conflicts.includes(pairedUrl)) return { ...acc, conflicts: [...acc.conflicts, key] }
      const decision = TOKEN_ENV_NAMES.includes(key) ? (current === wanted ? 'same' : 'set') : decide(key, current, wanted, overwrite)
      if (decision === 'same') return acc
      if (decision === 'conflict') return { ...acc, conflicts: [...acc.conflicts, key] }
      return { ...acc, content: setEnvValue(acc.content, key, wanted), changed: [...acc.changed, key] }
    },
    { content, changed: [], conflicts: [] },
  )
