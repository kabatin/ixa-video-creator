import {
  CreateShotInput,
  GenerationJobId,
  ModelId,
  Project,
  Shot,
  Take,
  TakeId,
  UpdateShotPatch,
} from '@ixa/domain'
import { z } from 'zod'

/**
 * ワイヤ表現。JSON には Date が無く日時は文字列で届くため、
 * ドメインのスキーマの日時列だけを coerce に差し替える。
 * それ以外の制約（ULID / fps / 解像度 / ステータス）はドメイン定義をそのまま使う。
 */
export const WireProject = Project.extend({
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type WireProject = z.infer<typeof WireProject>

export const WireProjectList = z.array(WireProject)

export const WireShot = Shot.extend({
  lockedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type WireShot = z.infer<typeof WireShot>

export const WireShotList = z.array(WireShot)

export const WireTake = Take.extend({ createdAt: z.coerce.date() })
export type WireTake = z.infer<typeof WireTake>

export const WireTakeList = z.array(WireTake)

/** `POST /projects/{projectId}/shots` の本文。projectId はパスで渡すため除く。 */
export const CreateShotBody = CreateShotInput.omit({ projectId: true })
export type CreateShotBody = z.input<typeof CreateShotBody>

/** `PATCH /shots/{id}` が受け付ける列だけに絞る。 */
export const UpdateShotBody = UpdateShotPatch.pick({
  description: true,
  camera: true,
  sourceType: true,
  startSec: true,
  durationSec: true,
  sourceInSec: true,
  // 場所は後から決められる。null を送れば外す（ADR-0015）。
  locationId: true,
})
export type UpdateShotBody = z.input<typeof UpdateShotBody>

/** `POST /shots/{id}/generate` の本文。上限はサーバ側と同じ値で先に弾く。 */
export const MAX_TAKES_PER_REQUEST = 4

export const GenerateTakesBody = z.object({
  model: z.union([ModelId, z.literal('AUTO')]),
  count: z.number().int().min(1).max(MAX_TAKES_PER_REQUEST).default(1),
})
export type GenerateTakesBody = z.input<typeof GenerateTakesBody>

export const WireGenerateResult = z.object({
  jobIds: z.array(GenerationJobId),
  specHash: z.string().length(64),
  resolvedModel: ModelId,
  duplicateOfTakeId: TakeId.nullable(),
})
export type WireGenerateResult = z.infer<typeof WireGenerateResult>

/** `GET /media/{id}/url`。署名付き URL は保持せず、必要になるたびに発行させる。 */
export const WireSignedUrl = z.object({
  url: z.string().min(1),
  expiresInSec: z.number().int().positive(),
})
export type WireSignedUrl = z.infer<typeof WireSignedUrl>

/** docs/ARCHITECTURE.md §18: レスポンスは `{ success, data?, error?, meta? }` に統一されている。 */
export const ApiEnvelope = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
})
export type ApiEnvelope = z.infer<typeof ApiEnvelope>
