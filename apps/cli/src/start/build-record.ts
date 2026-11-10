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
 * 画面に焼き込まれる値の指紋。`apps/web/.env.local` が直下の `.env` に勝つ（Next.js が先に読む。next.config.mjs）。
 * 名前の順に並べてから計るので、書いた順番では変わらない。
 */
export const publicEnvHashOf = (rootEnv: EnvValues, webLocal: EnvValues): string => {
  const merged = { ...rootEnv, ...webLocal }
  const entries = Object.keys(merged)
    .filter((key) => key.startsWith(PUBLIC_PREFIX))
    .sort()
    .map((key) => [key, merged[key] ?? ''])
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex')
}

/** 記録を読む。無い・JSON でない・形が違うときは null（組み立て直す側に倒す）。 */
export const parseBuildRecord = (content: string | null): BuildRecord | null => {
  if (content === null) return null
  try {
    const parsed = BuildRecord.safeParse(JSON.parse(content))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export type StaleReason = 'forced' | 'missing' | 'unknown-commit' | 'commit' | 'public-env'
export type BuildDecision = { readonly kind: 'fresh' } | { readonly kind: 'stale'; readonly reason: StaleReason }

export type BuildInputs = {
  readonly record: BuildRecord | null
  readonly current: { readonly commit: string | null; readonly publicEnv: string }
  /** `--build`。 */
  readonly force: boolean
}

/** 組み立て直すか。迷ったら組み立てる（古い画面を起こすより、数十秒待つ方がまし）。 */
export const buildDecision = ({ record, current, force }: BuildInputs): BuildDecision => {
  if (force) return { kind: 'stale', reason: 'forced' }
  if (record === null) return { kind: 'stale', reason: 'missing' }
  if (current.commit === null) return { kind: 'stale', reason: 'unknown-commit' }
  if (record.commit !== current.commit) return { kind: 'stale', reason: 'commit' }
  if (record.publicEnv !== current.publicEnv) return { kind: 'stale', reason: 'public-env' }
  return { kind: 'fresh' }
}

const REASON_TEXT: Readonly<Record<StaleReason, string>> = {
  forced: '--build が付いています',
  missing: 'まだ組み立てていません',
  'unknown-commit': 'git の版が分かりません',
  commit: 'コードが前に組み立てたときから変わっています',
  'public-env': '画面の設定（NEXT_PUBLIC_*）が前に組み立てたときから変わっています',
}

export const staleReasonText = (reason: StaleReason): string => REASON_TEXT[reason]
