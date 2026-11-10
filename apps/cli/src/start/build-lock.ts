import { z } from 'zod'
import type { RepoPaths } from '../lib/repo.js'
import type { System } from '../system.js'

/**
 * 画面を組み立てている間の印（ADR-0068）。置き場は `apps/web/.ixa-start-build.json`（.gitignore 済み）。
 *
 * 組み立ての間はどのポートも開いていないので、印が無いと doctor は「動いていない」と言い、
 * 2 つ目の `start` が同じ `.next-start` に組み立て始め、update が組み立ての下で git を動かす。
 * **`.next-start` の外に置く**（`next build` は出力先を消してから書く）。
 * 組み立ての間だけ持ち、終われば（失敗でも）消す。持ち主のプロセスが死んでいれば、残っていても無いものとして扱う。
 */

export const BuildLock = z.object({
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
})
export type BuildLock = z.infer<typeof BuildLock>

export type LockState =
  | { readonly kind: 'none' }
  | { readonly kind: 'held'; readonly lock: BuildLock }
  /** 持ち主が死んでいる・読めない。`why` は人に見せる理由（黙って消さない）。 */
  | { readonly kind: 'stale'; readonly why: string }

/** 印の中身から状態を決める（純粋。生きているかは呼ぶ側が渡す）。 */
export const lockStateOf = (content: string | null, alive: (pid: number) => boolean): LockState => {
  if (content === null) return { kind: 'none' }
  const json = ((): unknown => {
    try {
      return JSON.parse(content)
    } catch {
      return undefined
    }
  })()
  const parsed = BuildLock.safeParse(json)
  if (!parsed.success) return { kind: 'stale', why: '組み立ての印が読めません（壊れているか形が違います）' }
  return alive(parsed.data.pid)
    ? { kind: 'held', lock: parsed.data }
    : { kind: 'stale', why: `組み立ての印を残したプロセス（pid ${String(parsed.data.pid)}）はもう動いていません` }
}

export const readBuildLock = async (system: System, repo: RepoPaths): Promise<LockState> =>
  lockStateOf(await system.readText(repo.webBuildLock), system.pidAlive)

/** `held` の `lock` は、間に入った相手の印が読めなかったときだけ null。 */
export type Acquired =
  | { readonly kind: 'acquired'; readonly cleared: string | null }
  | { readonly kind: 'held'; readonly lock: BuildLock | null }

/**
 * 印を取る。生きた持ち主がいれば取らない。死んだ持ち主の印は消して取り直す（消した理由を `cleared` で返す）。
 * 作るのは「無いときだけ作る」口なので、2 つの start が同時に来ても片方しか取れない。
 */
export const acquireBuildLock = async (system: System, repo: RepoPaths, now: Date): Promise<Acquired> => {
  const state = await readBuildLock(system, repo)
  if (state.kind === 'held') return state
  if (state.kind === 'stale') await system.remove(repo.webBuildLock)
  const lock: BuildLock = { pid: system.pid, startedAt: now.toISOString() }
  if (await system.createText(repo.webBuildLock, `${JSON.stringify(lock, null, 2)}\n`)) {
    return { kind: 'acquired', cleared: state.kind === 'stale' ? state.why : null }
  }
  const raced = await readBuildLock(system, repo)
  // 間に入ったもう 1 つの start が取った。読めなくても、取れなかったことに変わりはない。
  return { kind: 'held', lock: raced.kind === 'held' ? raced.lock : null }
}

export const releaseBuildLock = (system: System, repo: RepoPaths): Promise<void> => system.remove(repo.webBuildLock)
