import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import type { Clock } from '../tool-def.js'
import { WireKeyArtJob } from '../wire.js'
import { waitForChecks, type CheckResult } from './wait-loop.js'

/**
 * サムネイルの背景を AI に描かせる（キーアート。ADR-0051）。候補を何枚か頼み、終わるまで待つ。
 * 状態は `GET /projects/{id}/key-art`（新しい順の一覧）から、頼んだジョブだけを拾って見る。
 */

/** 1 回に頼む候補の数。1 枚目が気に入らなければ、エージェントは 2 枚目で描き直せる。 */
export const KEY_ART_CANDIDATES = 2

const WireKeyArtStarted = z.object({ jobIds: z.array(z.string()) })

export type KeyArtCandidate = {
  readonly jobId: string
  readonly status: WireKeyArtJob['status']
  readonly mediaAssetId: string | null
  readonly error: string | null
}

export type KeyArtOutcome = {
  readonly timedOut: boolean
  readonly candidates: readonly KeyArtCandidate[]
}

export const startKeyArt = async (api: ApiClient, projectId: string, instruction: string | undefined): Promise<readonly string[]> => {
  const started = await api.post(
    `/projects/${seg(projectId)}/key-art/generate`,
    { count: KEY_ART_CANDIDATES, ...(instruction === undefined ? {} : { instruction }) },
    WireKeyArtStarted,
  )
  return started.jobIds
}

const listKeyArt = (api: ApiClient, projectId: string): Promise<readonly WireKeyArtJob[]> =>
  api.get(`/projects/${seg(projectId)}/key-art`, z.array(WireKeyArtJob))

const toCheckResult = (job: WireKeyArtJob | undefined): CheckResult => {
  if (job === undefined) return { state: 'pending', detail: { status: 'missing' } }
  if (job.status === 'queued' || job.status === 'running') return { state: 'pending', detail: { status: job.status } }
  return { state: job.status, detail: {} }
}

const toCandidate = (jobId: string, jobs: readonly WireKeyArtJob[]): KeyArtCandidate => {
  const job = jobs.find((candidate) => candidate.id === jobId)
  return {
    jobId,
    status: job?.status ?? 'queued',
    mediaAssetId: job?.mediaAssetId ?? null,
    error: job?.error ?? null,
  }
}

/**
 * この作品のキーアートに無いジョブ ID は、待っても現れない（頼んだ時点で行はできている）。
 * 待つ前に理由つきで投げる。黙って「まだ」と数えると、時間切れまで待ってから分からないまま終わる。
 */
const assertKnown = (jobIds: readonly string[], jobs: readonly WireKeyArtJob[]): void => {
  const unknown = jobIds.filter((jobId) => !jobs.some((job) => job.id === jobId))
  if (unknown.length > 0) {
    throw new Error(`この作品のキーアートに無いジョブです: ${unknown.join(', ')}（jobIds を確かめてください）`)
  }
}

/** 頼んだジョブがすべて終わるか、`maxWaitSec` まで待つ。1 回の問い合わせで全部の状態を読む。 */
export const waitForKeyArt = async (
  api: ApiClient,
  projectId: string,
  jobIds: readonly string[],
  clock: Clock,
  maxWaitSec: number,
): Promise<KeyArtOutcome> => {
  assertKnown(jobIds, await listKeyArt(api, projectId))
  const check = {
    label: { kind: 'key_art' },
    poll: async (): Promise<CheckResult> => {
      const jobs = await listKeyArt(api, projectId)
      const results = jobIds.map((jobId) => toCheckResult(jobs.find((job) => job.id === jobId)))
      return results.every((result) => result.state !== 'pending')
        ? { state: 'succeeded', detail: {} }
        : { state: 'pending', detail: {} }
    },
  }
  if (maxWaitSec > 0) await waitForChecks([check], clock, { maxWaitSec })
  const jobs = await listKeyArt(api, projectId)
  const candidates = jobIds.map((jobId) => toCandidate(jobId, jobs))
  const settled = candidates.every((candidate) => candidate.status !== 'queued' && candidate.status !== 'running')
  return { timedOut: !settled, candidates }
}

/** できた候補（頼んだ順）の中から `index` 番目を選ぶ。選べなければ理由つきで投げる。 */
export const pickCandidate = (candidates: readonly KeyArtCandidate[], index: number): string => {
  const succeeded = candidates.flatMap((candidate) =>
    candidate.status === 'succeeded' && candidate.mediaAssetId !== null ? [candidate.mediaAssetId] : [],
  )
  const chosen = succeeded[index]
  if (chosen !== undefined) return chosen
  const failures = candidates
    .filter((candidate) => candidate.status !== 'succeeded')
    .map((candidate) => `${candidate.jobId}: ${candidate.status}${candidate.error === null ? '' : `（${candidate.error}）`}`)
  throw new Error(
    `背景の候補 ${String(index + 1)} 枚目がありません（できたのは ${String(succeeded.length)} 枚）` +
      (failures.length === 0 ? '' : ` — ${failures.join(' / ')}`),
  )
}
