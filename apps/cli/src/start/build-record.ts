import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { EnvValues } from '../lib/env-file.js'

/**
 * `pnpm ixa start` の画面の組み立ての記録（ADR-0068。純粋）。
 *
 * 組み立てた画面には、そのときのコードと `NEXT_PUBLIC_*` の値が焼き込まれる。
 * どちらかが変わったのに古い画面のまま起こすと、更新したのに画面だけ前の版・別の API を指す、になる。
 * そこで組み立てに成功したら `apps/web/.next-start/ixa-build.json` に版と値の指紋を書き、次の起動で比べる。
 * **値そのものは書かない**（指紋だけ。`NEXT_PUBLIC_*` は秘密ではないが、ファイルに写す理由も無い）。
 */

export const BuildRecord = z.object({
  /** 組み立てたときの git の版（`git rev-parse HEAD`）。 */
  commit: z.string().regex(/^[0-9a-f]{40,64}$/),
  /** `NEXT_PUBLIC_*` の指紋（sha256）。 */
  publicEnv: z.string().regex(/^[0-9a-f]{64}$/),
})
export type BuildRecord = z.infer<typeof BuildRecord>

const PUBLIC_PREFIX = 'NEXT_PUBLIC_'

/**
 * `next build` が `NEXT_PUBLIC_*` を読む先。**上ほど強い**（先に値を決めたものが勝ち、後ろは上書きしない）。
 *
 * 1. 組み立てを起こしたプロセスの環境（`NEXT_PUBLIC_API_URL=… pnpm ixa start`）
 * 2〜5. `apps/web` の `.env.production.local` → `.env.local` → `.env.production` → `.env`
 *    （`@next/env` の `loadEnvConfig`。15.5 で確かめた順。環境にある名前は上書きしない）
 * 6. 直下の `.env`（`next.config.mjs` の `process.loadEnvFile`）。Next は env を読んでから設定ファイルを読み込み、
 *    `process.loadEnvFile` も**既にある名前は上書きしない**（Node 22 で確かめた）ので、いちばん弱い
 *
 * **空の値も「決めた」に数える**（`@next/env` は `undefined` のときだけ、`loadEnvFile` も同じ）。
 * `$VAR` の展開（`@next/env` だけがする）はここではしない。展開を使う人は `--build` で組み立て直す。
 */
export type PublicEnvSources = {
  readonly processEnv: Readonly<Record<string, string | undefined>>
  readonly webEnvProductionLocal: EnvValues
  readonly webEnvLocal: EnvValues
  readonly webEnvProduction: EnvValues
  readonly webEnv: EnvValues
  readonly rootEnv: EnvValues
}

const publicEntries = (values: Readonly<Record<string, string | undefined>>): readonly (readonly [string, string])[] =>
  Object.entries(values).flatMap(([key, value]) => (key.startsWith(PUBLIC_PREFIX) && value !== undefined ? [[key, value] as const] : []))

/** 画面に焼き込まれる `NEXT_PUBLIC_*`（上の順で先に決めたものが勝つ）。 */
export const effectivePublicEnv = (sources: PublicEnvSources): Readonly<Record<string, string>> => {
  const ordered = [
    sources.processEnv,
    sources.webEnvProductionLocal,
    sources.webEnvLocal,
    sources.webEnvProduction,
    sources.webEnv,
    sources.rootEnv,
  ]
  return ordered.reduce<Readonly<Record<string, string>>>(
    (acc, values) => ({ ...Object.fromEntries(publicEntries(values)), ...acc }),
    {},
  )
}

/** 指紋。名前の順に並べてから計るので、書いた順番では変わらない。 */
export const publicEnvHashOf = (sources: PublicEnvSources): string => {
  const effective = effectivePublicEnv(sources)
  const entries = Object.keys(effective)
    .sort()
    .map((key) => [key, effective[key] ?? ''])
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex')
}

export type RecordRead =
  | { readonly kind: 'found'; readonly record: BuildRecord }
  | { readonly kind: 'missing' }
  /** 読めない記録は組み立て直す側に倒す。理由は `staleReasonText('unreadable')` で人に見せる（黙って捨てない）。 */
  | { readonly kind: 'unreadable' }

export const parseBuildRecord = (content: string | null): RecordRead => {
  if (content === null) return { kind: 'missing' }
  const json = ((): unknown => {
    try {
      return JSON.parse(content)
    } catch {
      return undefined
    }
  })()
  const parsed = BuildRecord.safeParse(json)
  return parsed.success ? { kind: 'found', record: parsed.data } : { kind: 'unreadable' }
}

export type StaleReason = 'forced' | 'missing' | 'unreadable' | 'unknown-commit' | 'commit' | 'public-env'
export type BuildDecision = { readonly kind: 'fresh' } | { readonly kind: 'stale'; readonly reason: StaleReason }

export type BuildInputs = {
  readonly record: RecordRead
  readonly current: { readonly commit: string | null; readonly publicEnv: string }
  /** `--build`。 */
  readonly force: boolean
}

/** 組み立て直すか。迷ったら組み立てる（古い画面を起こすより、数十秒待つ方がまし）。 */
export const buildDecision = ({ record, current, force }: BuildInputs): BuildDecision => {
  if (force) return { kind: 'stale', reason: 'forced' }
  if (record.kind !== 'found') return { kind: 'stale', reason: record.kind }
  if (current.commit === null) return { kind: 'stale', reason: 'unknown-commit' }
  if (record.record.commit !== current.commit) return { kind: 'stale', reason: 'commit' }
  if (record.record.publicEnv !== current.publicEnv) return { kind: 'stale', reason: 'public-env' }
  return { kind: 'fresh' }
}

const REASON_TEXT: Readonly<Record<StaleReason, string>> = {
  forced: '--build が付いています',
  missing: 'まだ組み立てていません',
  unreadable: '前の組み立ての記録（apps/web/.next-start/ixa-build.json）が読めません（壊れているか形が違います）',
  'unknown-commit': 'git の版が分かりません',
  commit: 'コードが前に組み立てたときから変わっています',
  'public-env': '画面の設定（NEXT_PUBLIC_*）が前に組み立てたときから変わっています',
}

export const staleReasonText = (reason: StaleReason): string => REASON_TEXT[reason]
