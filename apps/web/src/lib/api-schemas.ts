import {
  Corrections,
  CreateShotInput,
  GenerationJobId,
  ModelId,
  Project,
  Shot,
  ShotId,
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
  // ストーリーボードの一括作成は機械的なコードと空の mood を付ける。後から直せる必要がある。
  code: true,
  mood: true,
  continuityMode: true,
  description: true,
  camera: true,
  sourceType: true,
  startSec: true,
  durationSec: true,
  sourceInSec: true,
  // Take を尺に合わせて速度を変えるか（ADR-0026）。
  timing: true,
  // 場所は後から決められる。null を送れば外す（ADR-0015）。
  locationId: true,
})
export type UpdateShotBody = z.input<typeof UpdateShotBody>

/** `POST /shots/{id}/generate` の本文。上限はサーバ側と同じ値で先に弾く。 */
export const MAX_TAKES_PER_REQUEST = 4

export const GenerateTakesBody = z.object({
  model: z.union([ModelId, z.literal('AUTO')]),
  count: z.number().int().min(1).max(MAX_TAKES_PER_REQUEST).default(1),
  /**
   * レビューの指摘から人が選んだ直し（PHASE 6.1）。
   * 上限は domain の `Corrections` が持つ。**この画面で書き写さない**（サーバと必ずズレる）。
   *
   * **`optional` にして、直しが無いときはキーごと送らない。** 空配列を常に送ると
   * 直しを使わない既存の呼び出しのリクエストまで形が変わる。サーバ側は
   * `Corrections.default([])` で受けるので、送らないことが「直し無し」を意味する。
   */
  corrections: Corrections.optional(),
  /**
   * 作り直しの元になる Take と、その理由（ADR-0042 の「本番で作り直す」）。
   * **Take は作る瞬間にしか親を持てない**ので、依頼の時点で渡す。
   */
  parentTakeId: TakeId.optional(),
  regenerationReason: z.string().trim().min(1).optional(),
  /** 使うシード。**省略は Provider に任せる**（0 は正当なシードなので 0 と省略を混ぜない）。 */
  seed: z.number().int().nonnegative().optional(),
})
export type GenerateTakesBody = z.input<typeof GenerateTakesBody>

export const WireGenerateResult = z.object({
  jobIds: z.array(GenerationJobId),
  specHash: z.string().length(64),
  resolvedModel: ModelId,
  duplicateOfTakeId: TakeId.nullable(),
  /** モデルの最長より長い Shot を最長で作り、Shot を「Take を尺に合わせる」にした。 */
  stretchedToFit: z.boolean(),
})
export type WireGenerateResult = z.infer<typeof WireGenerateResult>

/** `GET /media/{id}/url`。署名付き URL は保持せず、必要になるたびに発行させる。 */
export const WireSignedUrl = z.object({
  url: z.string().min(1),
  expiresInSec: z.number().int().positive(),
})
export type WireSignedUrl = z.infer<typeof WireSignedUrl>

/**
 * `GET /media/{id}` のうち、画面に出す分だけ。
 *
 * **狭く取る。** zod は知らない鍵を落とすので、`storageKey` のような内部の値が
 * ブラウザ側の型に入らない（CLAUDE.md の画面の言葉「内部 ID は出さない」）。
 * `probe` は取り込みキューが後から埋めるため、出来たばかりの素材では null。
 */
export const WireMediaInfo = z.object({
  bytes: z.number().int().nonnegative(),
  probe: z
    .object({
      width: z.number().int().positive().nullable(),
      height: z.number().int().positive().nullable(),
      fps: z.number().positive().nullable(),
    })
    .nullable(),
})
export type WireMediaInfo = z.infer<typeof WireMediaInfo>

/** 解像度を上げる仕事（ADR-0044）。投入するまで見込みは分からないので null。 */
export const WireUpscaleJob = z.object({
  id: z.string().min(1),
  shotId: ShotId,
  sourceTakeId: TakeId,
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  estimateSeconds: z.number().nonnegative().nullable(),
})
export type WireUpscaleJob = z.infer<typeof WireUpscaleJob>

export const WireUpscaleSupport = z.object({ supported: z.boolean() })
export type WireUpscaleSupport = z.infer<typeof WireUpscaleSupport>

/** docs/ARCHITECTURE.md §18: レスポンスは `{ success, data?, error?, meta? }` に統一されている。 */
export const ApiEnvelope = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
})
export type ApiEnvelope = z.infer<typeof ApiEnvelope>
