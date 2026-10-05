import { z } from '@hono/zod-openapi'
import { NarrationLine, NarrationTake, VoiceJob } from '@ixa/domain'
import type { NarrationOverview } from './overview.js'

/** ナレーションの一覧の応答（日時は ISO 文字列）。 */

const iso = z.string().datetime()

const TakeResponse = NarrationTake.innerType()
  .omit({ createdAt: true })
  .extend({ createdAt: iso, durationSec: z.number() })
  .openapi('NarrationTake')

const JobResponse = VoiceJob.pick({ id: true, kind: true, status: true, error: true, tool: true, costUsd: true })
  .extend({ queuedAt: iso })
  .openapi('NarrationVoiceJob')

const LineResponse = NarrationLine.omit({ createdAt: true, updatedAt: true })
  .extend({
    createdAt: iso,
    updatedAt: iso,
    reading: z.string(),
    readingIsManual: z.boolean(),
    estimatedSec: z.number(),
    durationSec: z.number().nullable(),
    stale: z.boolean(),
    takes: z.array(TakeResponse),
    job: JobResponse.nullable(),
  })
  .openapi('NarrationLineView')

export const NarrationOverviewResponse = z
  .object({ lines: z.array(LineResponse), totalEstimatedSec: z.number(), endSec: z.number() })
  .openapi('NarrationOverview')
export type NarrationOverviewResponse = z.infer<typeof NarrationOverviewResponse>

export const toOverviewResponse = (overview: NarrationOverview): NarrationOverviewResponse => ({
  totalEstimatedSec: overview.totalEstimatedSec,
  endSec: overview.endSec,
  lines: overview.lines.map((line) => ({
    ...line,
    createdAt: line.createdAt.toISOString(),
    updatedAt: line.updatedAt.toISOString(),
    takes: line.takes.map((take) => ({
      ...take,
      charTimes: take.charTimes === null ? null : [...take.charTimes],
      peaks: take.peaks === null ? null : [...take.peaks],
      createdAt: take.createdAt.toISOString(),
      durationSec: take.outSec - take.inSec,
    })),
    job:
      line.job === null
        ? null
        : {
            id: line.job.id,
            kind: line.job.kind,
            status: line.job.status,
            error: line.job.error,
            tool: line.job.tool,
            costUsd: line.job.costUsd,
            queuedAt: line.job.queuedAt.toISOString(),
          },
  })),
})
