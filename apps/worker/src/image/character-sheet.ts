import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compileCharacterSheetPrompt, type ImageGenerationJob } from '@ixa/domain'
import { publishImageJobStatus } from './events.js'
import { requestShapeFor } from './shape.js'
import { ImageJobFailure, ingest, localPathOf, localReferenceResolver, waitForResult, type JobDeps } from './steps.js'

/**
 * 手本の画像 1 枚からキャラクターシート（四面図）を作る（ADR-0035。制作者 2026-10-03「動画生成に役立つ形式の
 * キャラクターシートを 1 枚の画像から作れるといい。正面などの画像を用意したら、それを基に Codex CLI で作る」）。
 *
 * 手本（頼んだときに決めた 1 枚）を `subject` にし、四面図の指示で**横長**に作る → 素材として取り込む →
 * 識別画像の四面図に足す（四面図の主が無ければ主にする）→ 知らせる。
 * **プロジェクトの比には切り抜かない。** 4 つの全身の端が欠けると、参照として使えない。
 */

/** 横長で頼む（4 つの全身を横一列に並べる）。Codex なら 1536×1024。 */
const SHEET_ASPECT = '16:9'

export const generateCharacterSheet = async (deps: JobDeps, job: ImageGenerationJob, dir: string): Promise<void> => {
  const character = job.characterId === null ? null : await deps.characters.findById(job.characterId)
  const project = character === null ? null : await deps.projects.findById(character.projectId)
  if (character === null || project === null) {
    throw new ImageJobFailure({ code: 'character_missing', message: 'このキャラクターは消されました。', retryable: false })
  }
  const [reference] = job.referenceAssetIds
  if (reference === undefined) {
    throw new ImageJobFailure({ code: 'reference_missing', message: '手本の画像が記録されていません。もう一度作ってください。', retryable: false })
  }

  const running = await deps.imageJobs.markRunning(job.id, job.referenceAssetIds)
  await publishImageJobStatus(deps, running)

  const shape = requestShapeFor(deps.model, SHEET_ASPECT)
  const handle = await deps.provider.submit({
    model: deps.model,
    prompt: compileCharacterSheetPrompt(character),
    negativePrompt: null,
    resolution: shape.resolution,
    aspectRatio: shape.aspectRatio,
    seed: null,
    references: [{ mediaAssetId: reference, role: 'subject' }],
    resolveReference: localReferenceResolver(deps, dir),
    count: 1,
    // 1 枚の中に並べる絵。Codex に「中央に寄せる」「候補を並べない」と言わせない（並べる指示とぶつかる）。
    composition: 'sheet',
  })
  const sheetPath = join(dir, 'character-sheet.png')
  const raw = await (async () => {
    try {
      const result = await waitForResult(deps, handle)
      const output = result.outputs[0]
      if (output === undefined) {
        throw new ImageJobFailure({ code: 'no_image', message: '絵が返ってきませんでした。', retryable: true }, result.raw)
      }
      // 切り抜かずに写す。Provider の作業場所は片付けるので、その前に手元へ移す。
      await copyFile(localPathOf(output), sheetPath)
      return result.raw
    } finally {
      await deps.provider.release?.(handle)
    }
  })()
  const mediaAssetId = await ingest(deps, project, job, sheetPath)
  const images = await deps.characters.listIdentityImages(character.id)
  await deps.characters.addIdentityImage({
    characterId: character.id,
    mediaAssetId,
    role: 'four_view',
    // 四面図の主が無ければ主にする（生成の参照で優先される）。あれば足すだけ（気に入らなければ人が選び直す）。
    isPrimary: !images.some((image) => image.role === 'four_view' && image.isPrimary),
    order: images.length,
  })
  const succeeded = await deps.imageJobs.markSucceeded(job.id, mediaAssetId, raw)
  await deps.mediaQueue.enqueue(mediaAssetId)
  await publishImageJobStatus(deps, succeeded)
}
