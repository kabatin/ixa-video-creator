import { randomUUID } from 'node:crypto'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProviderJobStatus } from '@ixa/provider-core'
import { z } from 'zod'

/**
 * スタブのジョブ状態を `outputDir` の下に 1 件 1 ファイルで置く。
 *
 * 実 Provider は状態を自分の側（サーバ）に持つので、問い合わせる側が再起動しても
 * 2 つ動いていても、投入済みの生成を追いかけられる。
 * スタブの状態がプロセスのメモリにしか無いと、その形を再現できない。
 * 実際に worker が 2 プロセス動いていたとき、8 件のうち 7 件が
 * 「記録が見つからない」で終端失敗した。スタブも実 Provider に倣って外に持つ。
 */

const StoredProviderOutput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('remote'), url: z.string().min(1) }),
  z.object({ type: z.literal('local'), path: z.string().min(1) }),
])

/** `ProviderJobStatus` をそのまま JSON にした形。緩めない（読んだ値は必ずここを通す）。 */
const StoredStatus = z.discriminatedUnion('state', [
  z.object({ state: z.literal('pending'), progress: z.number().nullable() }),
  z.object({ state: z.literal('running'), progress: z.number().nullable() }),
  z.object({
    state: z.literal('succeeded'),
    output: StoredProviderOutput,
    seedUsed: z.number().nullable(),
    costUsd: z.number().min(0),
    raw: z.record(z.unknown()),
  }),
  z.object({
    state: z.literal('failed'),
    error: z.object({
      code: z.string().min(1),
      message: z.string(),
      retryable: z.boolean(),
    }),
  }),
])

/**
 * ディスクに置く 1 件分。
 *
 * **`AbortController` は入れない。** プロセスを跨げないものを書いても、
 * 読んだ側が「止められる」と誤解するだけになる。
 */
export const StoredStubJob = z.object({
  ref: z.string().min(1),
  status: StoredStatus,
  cancelled: z.boolean(),
})
export type StoredStubJob = {
  readonly ref: string
  readonly status: ProviderJobStatus
  readonly cancelled: boolean
}

/**
 * 読みに行った結果。**「無い」と「読めなかった」を分ける。**
 * 呼び出し側の扱いは同じでも、理由を捨てるとなぜ失敗したのか誰にも分からなくなる。
 */
export type StubJobLookup =
  | { readonly kind: 'found'; readonly job: StoredStubJob }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable'; readonly cause: unknown }

/** ジョブ参照は `randomUUID` が作る。この形でないものはファイル名に使わない。 */
const JOB_REF_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 参照からファイルの場所を決める。形が違えば `null`。
 * 参照は DB を経由して戻ってくる値なので、そのまま `join` すると
 * `../` でディレクトリの外を指せてしまう。
 */
const jobFilePath = (outputDir: string, ref: string): string | null =>
  JOB_REF_PATTERN.test(ref) ? join(outputDir, `${ref}.json`) : null

const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'

/** ディスクに残っているジョブを読む。壊れていれば `unreadable`（理由つき）。 */
export const readStubJob = async (outputDir: string, ref: string): Promise<StubJobLookup> => {
  const path = jobFilePath(outputDir, ref)
  if (path === null) return { kind: 'missing' }

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    // 無いこと自体は異常ではない（未知の参照）。それ以外は読めなかったこととして扱う。
    return isNotFound(error) ? { kind: 'missing' } : { kind: 'unreadable', cause: error }
  }

  try {
    return { kind: 'found', job: StoredStubJob.parse(JSON.parse(text)) }
  } catch (error) {
    // 途中まで書かれた JSON・別物の JSON はここで止める。中身を推測して先へ進めない。
    return { kind: 'unreadable', cause: error }
  }
}

/**
 * ジョブの状態を書き直す。**不可分に置き換える。**
 *
 * 同じディレクトリへ一時ファイルを書いてから `rename` する。
 * `rename` は同一ファイルシステム内では不可分なので、
 * 2 プロセスが同時に書いても、読み手が途中の JSON を読むことはない。
 */
export const writeStubJob = async (outputDir: string, job: StoredStubJob): Promise<void> => {
  const path = jobFilePath(outputDir, job.ref)
  if (path === null) throw new Error(`ジョブ参照の形が想定と違います: ${job.ref}`)

  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(job), 'utf8')
    await rename(temporary, path)
  } catch (error) {
    // 置き換えに失敗した一時ファイルを残さない。消せなくても、元の失敗の方を伝える。
    await unlink(temporary).catch(() => undefined)
    throw new Error(`ジョブの状態を保存できませんでした: ${path}`, { cause: error })
  }
}
