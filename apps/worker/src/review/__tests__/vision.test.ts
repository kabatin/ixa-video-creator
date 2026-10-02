import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { VisionReviewer } from '@ixa/provider-llm'
import { createMemoryStorage, type ObjectStorage } from '@ixa/storage'
import { describe, expect, it } from 'vitest'
import { aggregateVerdict } from '@ixa/domain'
import {
  MAX_SUBJECT_FRAMES,
  NO_FRAMES_MESSAGE,
  VisionStageError,
  buildCriteria,
  runVisionStage,
} from '../vision.js'
import {
  aProject,
  aShot,
  aVideoAsset,
  fakeVisionReviewer,
  silentLogger,
} from './doubles.js'

const project = aProject()
const shot = aShot(project)

describe('buildCriteria', () => {
  it('Shot の演出指示を判定基準に落とす', () => {
    const criteria = buildCriteria(shot)
    expect(criteria).toContain('shot_001')
    expect(criteria).toContain('ステージ中央でボーカルが歌い出す')
    expect(criteria).toContain('medium')
  })

  it('description が空でも空文字にはならない', () => {
    expect(buildCriteria(aShot(project, { description: '' })).length).toBeGreaterThan(0)
  })
})

/** どの鍵でも同じ小さな画像を返す保管庫（判定用のフレームを手元に落とせることを見る）。 */
const FRAME_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
const framesStorage = (): ObjectStorage => ({
  ...createMemoryStorage(),
  get: () => Promise.resolve(FRAME_BYTES),
})

describe('runVisionStage', () => {
  const base = {
    shot,
    storage: framesStorage(),
    logger: silentLogger,
    workDir: join(tmpdir(), 'ixa-review-vision-test'),
  }

  /**
   * 画像は手元のファイルにして渡す（2026-10-02）。手元の保管庫（MinIO）は外の AI から読めず、
   * 署名付き URL を外へ出すことにもなるため、URL は渡さない。
   */
  it('ポスターフレームを手元のファイルにして渡し、終わったら片付ける', async () => {
    const seen: { readonly dir: string; readonly bytes: readonly number[] }[] = []
    const reviewer: VisionReviewer = {
      name: 'peek',
      supports: ['identity'],
      review: (request) => {
        const first = request.subjects[0]
        if (first === undefined) throw new Error('判定対象が無い')
        seen.push({ dir: request.imageDir, bytes: [...readFileSync(first.path)] })
        return fakeVisionReviewer().review(request)
      },
    }

    await runVisionStage({ ...base, asset: aVideoAsset(project), reviewers: [reviewer] })

    expect(seen).toHaveLength(1)
    expect(seen[0]?.bytes).toEqual([...FRAME_BYTES])
    expect(existsSync(seen[0]?.dir ?? '')).toBe(false)
  })

  it('判定対象はフレームの数とラベルを保つ', async () => {
    const reviewer = fakeVisionReviewer()

    await runVisionStage({ ...base, asset: aVideoAsset(project), reviewers: [reviewer] })

    const request = reviewer.calls()[0]
    expect(request?.subjects).toHaveLength(MAX_SUBJECT_FRAMES)
    expect(request?.subjects[0]?.label).toMatch(/^frame@/)
    expect(JSON.stringify(request)).not.toContain('op=get')
  })

  it('supports に挙げた種別ごとに 1 回ずつ呼ぶ', async () => {
    const reviewer = fakeVisionReviewer({ supports: ['identity', 'composition'] })
    const result = await runVisionStage({
      ...base,
      asset: aVideoAsset(project),
      reviewers: [reviewer],
    })

    expect(reviewer.calls().map((call) => call.reviewer)).toEqual(['identity', 'composition'])
    expect(result.findings.map((f) => f.reviewer)).toEqual(['identity', 'composition'])
    expect(result.costUsd).toBeCloseTo(0.04)
  })

  it('ポスターフレームが無ければサムネイルで代替する', async () => {
    const reviewer = fakeVisionReviewer()
    const asset = aVideoAsset(project, { posterKeys: [], thumbnailKey: 'media/thumb.jpg' })

    await runVisionStage({ ...base, asset, reviewers: [reviewer] })

    expect(reviewer.calls()[0]?.subjects).toHaveLength(1)
  })

  it('判定できるフレームが 1 枚も無ければ呼ばない（課金しない）', async () => {
    const reviewer = fakeVisionReviewer()
    const asset = aVideoAsset(project, { posterKeys: [], thumbnailKey: null })

    const result = await runVisionStage({ ...base, asset, reviewers: [reviewer] })

    expect(reviewer.calls()).toHaveLength(0)
    expect(result.costUsd).toBe(0)
    // 空で返すと verdict が pass になり「7 レビュア中 4 つが未実行なのに合格」に見える。
    // 判定していないことを残す（詳細は下の describe）。
    expect(result.findings).not.toHaveLength(0)
  })

  it('失敗したときは、そこまでのコストを持った例外を投げる', async () => {
    const ok = fakeVisionReviewer({ name: 'ok', supports: ['identity'], costUsd: 0.03 })
    const broken = fakeVisionReviewer({
      name: 'broken',
      supports: ['continuity'],
      fail: new Error('LLM が 500 を返しました'),
    })

    const failure = await runVisionStage({
      ...base,
      asset: aVideoAsset(project),
      reviewers: [ok, broken],
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(VisionStageError)
    expect((failure as VisionStageError).costUsd).toBeCloseTo(0.03)
    expect((failure as VisionStageError).cause).toBeInstanceOf(Error)
  })
})

describe('判定できるフレームが無いとき', () => {
  /** ポスターフレームもサムネイルも無い MediaAsset。実機で実際にこの状態が出た。 */
  const frameless = () => aVideoAsset(project, { posterKeys: [], thumbnailKey: null })

  it('黙って空を返さず、判定していないことを warn として残す', async () => {
    const reviewer = fakeVisionReviewer({ supports: ['identity', 'continuity'] })
    const result = await runVisionStage({
      shot,
      asset: frameless(),
      reviewers: [reviewer],
      storage: createMemoryStorage(),
      workDir: join(tmpdir(), 'ixa-review-vision-test'),
      logger: silentLogger,
    })

    expect(reviewer.calls()).toHaveLength(0)
    expect(result.costUsd).toBe(0)
    expect(result.findings).toHaveLength(2)
    expect(result.findings.every((finding) => finding.severity === 'warn')).toBe(true)
    expect(result.findings[0]?.message).toBe(NO_FRAMES_MESSAGE)
  })

  it('verdict が pass にならない（走らなかったものを合格に見せない）', async () => {
    const result = await runVisionStage({
      shot,
      asset: frameless(),
      reviewers: [fakeVisionReviewer()],
      storage: createMemoryStorage(),
      workDir: join(tmpdir(), 'ixa-review-vision-test'),
      logger: silentLogger,
    })

    expect(aggregateVerdict(result.findings)).toBe('warn')
  })

  it('飛ばした検査の種別が分かる（どれを判定していないかを隠さない）', async () => {
    const result = await runVisionStage({
      shot,
      asset: frameless(),
      reviewers: [
        fakeVisionReviewer({ supports: ['identity', 'composition'] }),
        fakeVisionReviewer({ supports: ['composition', 'prompt_adherence'] }),
      ],
      storage: createMemoryStorage(),
      workDir: join(tmpdir(), 'ixa-review-vision-test'),
      logger: silentLogger,
    })

    const reviewers = result.findings.map((finding) => finding.reviewer)
    // 重複したレビュア種別は 1 件にまとめる
    expect(reviewers).toHaveLength(3)
    expect(new Set(reviewers)).toEqual(new Set(['identity', 'composition', 'prompt_adherence']))
  })

  it('再生成ループへプロンプト差分を渡さない（直すのは取り込み経路）', async () => {
    const result = await runVisionStage({
      shot,
      asset: frameless(),
      reviewers: [fakeVisionReviewer()],
      storage: createMemoryStorage(),
      workDir: join(tmpdir(), 'ixa-review-vision-test'),
      logger: silentLogger,
    })

    expect(result.findings.every((finding) => finding.suggestedPromptDelta === null)).toBe(true)
  })
})
