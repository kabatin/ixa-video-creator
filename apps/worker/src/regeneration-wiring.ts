import {
  createGenerationJobRepository,
  createProjectRepository,
  createShotRepository,
  type DbClient,
} from '@ixa/db'
import { buildGeneration, type BuildGenerationDeps } from '@ixa/generation'
import type { GenerationContextSource } from '@ixa/domain'
import {
  selectModel,
  validateAgainstCapabilities,
  type ProviderRegistry,
  type VideoModelDescriptor,
} from '@ixa/provider-core'
import type { Queue } from 'bullmq'
import type { Logger } from 'pino'
import type { RegenerationQueue } from './regeneration/index.js'

/**
 * 再生成の要求を、実際の生成ジョブへ落とす配線（ARCHITECTURE.md §13）。
 *
 * **可否の判定はここにない。** 上限と予算は `canRegenerate` が既に見ており、
 * ここへ来る要求はすべて「回してよい」と判断済みのもの。
 * ここがするのは、仕様をコンパイルして GenerationJob 行を作り、
 * 系譜つきで生成キューへ積むことだけ。
 */

/**
 * 再生成は 1 回につき 1 本だけ作る。GenerationJob 1 行が 1 本に対応するので、
 * ここでは 1 行だけ作る。複数本を自動で焼くと予算の消え方が読めない。
 */

const generationPorts = (
  context: GenerationContextSource,
  registry: ProviderRegistry,
): BuildGenerationDeps<VideoModelDescriptor> => ({
  context,
  catalog: registry,
  router: { selectModel, validateAgainstCapabilities },
})

export type RegenerationEnqueueDeps = {
  readonly db: DbClient
  readonly context: GenerationContextSource
  readonly registry: ProviderRegistry
  readonly queue: Queue
  readonly logger: Logger
}

/**
 * 生成キューへ積む口を作る。
 *
 * モデルは AUTO で選び直す。**前回と同じモデルに固定しない。**
 * identity が落ちたときに別のモデルへ逃がせることが、再生成を回す意味の半分を占める
 * （ARCHITECTURE.md §13 の対処方針）。
 */
export const createRegenerationEnqueue = (deps: RegenerationEnqueueDeps): RegenerationQueue => {
  const shots = createShotRepository(deps.db)
  const projects = createProjectRepository(deps.db)
  const generationJobs = createGenerationJobRepository(deps.db)

  return {
    enqueue: async (request) => {
      const shot = await shots.findById(request.shotId)
      if (shot === null) throw new Error(`Shot が見つかりません: ${request.shotId}`)

      const project = await projects.findById(request.projectId)
      if (project === null) throw new Error(`Project が見つかりません: ${request.projectId}`)

      const compiled = await buildGeneration(
        generationPorts(deps.context, deps.registry),
        shot,
        project,
        'AUTO',
      )

      const job = await generationJobs.create({
        shotId: shot.id,
        specHash: compiled.specHash,
        requestedModel: 'AUTO',
        resolvedModel: compiled.model.id,
        routerDecision: compiled.routerDecision,
      })

      /**
       * 系譜はこのペイロードにしか無い（`generation_jobs` に列が無い）。
       * 積み忘れると親も理由も持たない Take が確定するため、ここで必ず入れる。
       */
      await deps.queue.add('generate', {
        generationJobId: job.id,
        lineage: {
          parentTakeId: request.parentTakeId,
          regenerationReason: request.reason,
        },
      })

      deps.logger.info(
        {
          shotId: shot.id,
          generationJobId: job.id,
          parentTakeId: request.parentTakeId,
          modelId: compiled.model.id,
        },
        '再生成の生成ジョブを積みました',
      )
    },
  }
}
