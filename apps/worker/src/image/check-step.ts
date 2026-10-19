import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { retryImageJobInput } from '@ixa/db'
import {
  chainToSettle,
  enforceImageCheckVerdict,
  pickImageToApply,
  shouldAutoRetry,
  type ImageCheck,
  type ImageGenerationJob,
  type ImageJobKind,
} from '@ixa/domain'
import { withTempDir } from '../media/temp-dir.js'
import { applyImage } from './apply.js'
import { characterSheetMaterials } from './character-sheet.js'
import { publishImageJobStatus } from './events.js'
import { keyArtMaterials } from './key-art.js'
import type { ImageProcessorDeps } from './processor.js'
import { startFrameMaterials } from './processor.js'
import { localReferenceResolver, type ImageAdapter, type ImageJobResult, type JobDeps } from './steps.js'

/**
 * 作った絵のチェックと、当てる・やり直すの判断（ADR-0055 §3）。image キューの `check` の手順。
 * **GPU の順番は持たない**（Claude を数十秒待つ間、動画を止めない）。
 *
 * 1. チェックを 1 行残す（あれば使い回す。投げ直しても二重に払わない）
 * 2. 手元の AI で「やり直す」なら、やり直しのジョブを積む（前の絵は差し替えない）
 * 3. そうでなければ、つながりから当てる絵を選んで当てる
 *
 * 失敗したやり直しのジョブも来る（前までの絵から選んで当てる。§7）。
 */

/** 画面に出る文。実装の言葉を入れない。 */
export const CHECK_SKIPPED_NOTE = '「使う AI」の文章が Claude ではないため、チェックしていません。'
export const CHECK_FAILED_NOTE = 'チェックの AI から答えが返らなかったため、チェックせずに使います。'
export const CHECK_NO_TOOL_NOTE = 'この環境ではこの絵の AI を使えないため、チェックしていません。'

const instructionFor = async (deps: JobDeps, job: ImageGenerationJob): Promise<string> => {
  const byKind: Readonly<Record<ImageJobKind, () => Promise<{ readonly prompt: string }>>> = {
    start_frame: () => startFrameMaterials(deps, job),
    character_sheet: () => characterSheetMaterials(deps, job),
    key_art: () => keyArtMaterials(deps, job),
  }
  return (await byKind[job.kind]()).prompt
}

/** Claude に見せる。落ちたら理由を残して「チェックせずに使う」へ（空の結果を合格に化けさせない）。 */
const askChecker = async (deps: JobDeps, job: ImageGenerationJob, subjectId: NonNullable<ImageGenerationJob['mediaAssetId']>) =>
  withTempDir(deps.workDir, 'image-check-', async (dir) => {
    const resolve = localReferenceResolver(deps, dir)
    const subjectPath = join(dir, 'subject.png')
    await writeFile(subjectPath, await deps.storage.get((await deps.mediaAssets.findById(subjectId))?.storageKey ?? ''))
    const references = await Promise.all(
      job.referenceAssetIds.map(async (id, index) => ({ label: `参照 ${String(index + 1)}`, path: await resolve(id) })),
    )
    return deps.checker.check({
      kind: job.kind,
      subject: { label: '判定する絵', path: subjectPath },
      references,
      instruction: await instructionFor(deps, job),
      imageDir: dir,
    })
  })

const runCheck = async (
  deps: ImageProcessorDeps,
  adapter: ImageAdapter | undefined,
  job: ImageGenerationJob,
): Promise<ImageCheck> => {
  const existing = await deps.imageChecks.findByJobId(job.id)
  if (existing !== null) return existing
  const skipped = (note: string) =>
    deps.imageChecks.create({
      imageJobId: job.id,
      outcome: 'skipped',
      verdict: null,
      score: null,
      issues: [],
      promptDelta: null,
      note,
      costUsd: 0,
    })
  if ((await deps.textTool()) !== 'claude_cli') return skipped(CHECK_SKIPPED_NOTE)
  if (adapter === undefined || job.mediaAssetId === null) return skipped(CHECK_NO_TOOL_NOTE)
  try {
    const { result, costUsd } = await askChecker({ ...deps, ...adapter }, job, job.mediaAssetId)
    // 文字と頭身だけの「やり直す」は要確認に下げる（AI の言葉だけに頼らない。domain の規則）。
    const enforced = enforceImageCheckVerdict(result)
    return await deps.imageChecks.create({ imageJobId: job.id, outcome: 'checked', ...enforced, note: null, costUsd })
  } catch (error) {
    deps.logger.warn({ imageJobId: job.id, kind: job.kind, err: error }, '絵をチェックできませんでした。チェックせずに使います')
    return deps.imageChecks.create({
      imageJobId: job.id,
      outcome: 'failed',
      verdict: null,
      score: null,
      issues: [],
      promptDelta: null,
      note: CHECK_FAILED_NOTE,
      costUsd: 0,
    })
  }
}

/**
 * やり直しを積む。積めなければ失敗にして false（呼ぶ側が前までの絵を当てる）。
 * やり直しの行が既にあれば行は増やさない。その行がまだ待っている（queued）なら、描く手順を積み直す
 * （行を作った後・積む前に落ちると、誰も拾わないまま残る。レビューの指摘 2026-10-19）。
 * 二重に積まれても、手元の生成サーバはジョブの ID を鍵に二重には作らない（`idempotencyKey`）。
 */
const enqueueRetry = async (deps: ImageProcessorDeps, job: ImageGenerationJob): Promise<boolean> => {
  const existing = await deps.imageJobs.findRetryOf(job.id)
  if (existing !== null && existing.status !== 'queued') return true
  const retry = existing ?? (await deps.imageJobs.create(retryImageJobInput(job)))
  try {
    await deps.queue.draw(retry.id)
    await publishImageJobStatus(deps, retry)
    return true
  } catch (error) {
    deps.logger.error({ imageJobId: job.id, retryJobId: retry.id, err: error }, 'やり直しを積めませんでした。前までの絵から当てます')
    const failed = await deps.imageJobs.markFailed(
      retry.id,
      { code: 'enqueue_failed', message: 'やり直しを順番に入れられませんでした。', retryable: true },
      null,
    )
    await publishImageJobStatus(deps, failed)
    return false
  }
}

/**
 * つながりから当てる絵を選んで当てる。止めたジョブには当てない。
 * 選ぶ範囲は `chainToSettle`: このつながりを当て終えていれば何もしない。人が押したやり直しは、前の当てより後だけから選ぶ。
 */
const settleChain = async (deps: ImageProcessorDeps, job: ImageGenerationJob): Promise<void> => {
  const segment = chainToSettle(await deps.imageJobs.findChainUpTo(job.id), job)
  if (segment === null) return
  const drawn = segment.filter(
    (candidate) => candidate.mediaAssetId !== null && (candidate.status === 'succeeded' || candidate.status === 'checking'),
  )
  const checks = await deps.imageChecks.findByJobIds(drawn.map((candidate) => candidate.id))
  const picked = pickImageToApply(
    drawn.map((candidate) => ({
      jobId: candidate.id,
      attempt: candidate.attempt,
      check: checks.find((check) => check.imageJobId === candidate.id) ?? null,
    })),
  )
  const target = picked === null ? undefined : drawn.find((candidate) => candidate.id === picked.jobId)
  if (target === undefined) return
  // 選んでいる間に止められたら当てない（止めたら絵が変わらない、の約束）。
  if ((await deps.imageJobs.findById(job.id))?.status === 'cancelled') return
  await applyImage(deps, target)
  const applied = await deps.imageJobs.markApplied(target.id)
  deps.logger.info(
    { imageJobId: job.id, appliedJobId: applied.id, attempt: applied.attempt, needsReview: picked?.needsReview ?? false },
    '作った絵を当てました',
  )
  if (applied.id !== job.id) await publishImageJobStatus(deps, applied)
}

const finish = async (deps: ImageProcessorDeps, job: ImageGenerationJob): Promise<void> => {
  await publishImageJobStatus(deps, await deps.imageJobs.finishChecking(job.id))
}

export const processImageCheck = async (
  deps: ImageProcessorDeps,
  adapter: ImageAdapter | undefined,
  job: ImageGenerationJob,
): Promise<ImageJobResult> => {
  // 失敗したやり直し: 前までの絵から選んで当てる。
  if (job.status === 'failed') {
    if (job.retryOfJobId !== null) await settleChain(deps, job)
    return { state: 'succeeded' }
  }
  // チェック中でないもの（止めた・もう終えた・まだ描いていない）には手を出さない。
  if (job.status !== 'checking') return { state: 'skipped' }

  const check = await runCheck(deps, adapter, job)
  const retry = shouldAutoRetry({
    check,
    attempt: job.attempt,
    maxRetries: deps.maxRetries,
    toolIsLocal: adapter?.provider.exclusiveResource === 'local-gpu',
  })
  if (!retry || !(await enqueueRetry(deps, job))) await settleChain(deps, job)
  await finish(deps, job)
  return { state: 'succeeded' }
}
