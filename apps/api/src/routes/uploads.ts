import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { MediaAssetRepository } from '@ixa/db'
import {
  MediaAssetId as MediaAssetIdSchema,
  MediaKind as MediaKindSchema,
  ProjectId as ProjectIdSchema,
  WorkspaceId as WorkspaceIdSchema,
  newId,
  type MediaAssetId,
  type MediaKind,
} from '@ixa/domain'
import { mediaKey, type ObjectStorage } from '@ixa/storage'
import { VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import type { Logger } from '../logger.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { MediaAssetResponse, toMediaAssetResponse } from './media.js'

/**
 * アップロードの取り込み口（docs/ARCHITECTURE.md §7）。
 * 本体は API を通さず、署名付き PUT URL でクライアントから直接ストレージへ送る。
 * 署名付き URL は DB に保存しない（CLAUDE.md 規約 7）。
 */

/** BullMQ のキュー名（docs/ARCHITECTURE.md §20）。apps 同士を import しないため定数で持つ。 */
export const MEDIA_QUEUE_NAME = 'media'

/**
 * 取り込みジョブ（ffprobe / プロキシ / サムネ / ポスター）をキューへ投入する Port。
 * Redis への依存を main.ts に閉じ込める。
 */
export type MediaQueue = {
  /** ジョブデータは ID のみ。実データは DB から読む（ADR-0008）。 */
  enqueue(mediaAssetId: MediaAssetId): Promise<void>
}

/**
 * media キューへの投入口。
 * キューとロガーを 1 つのオブジェクトにまとめてあるのは、キューだけ配線して
 * 投入失敗を握り潰す配線を型の上で作れなくするため（CLAUDE.md 規約 5）。
 */
export type MediaIngestDeps = {
  readonly queue: MediaQueue
  readonly logger: Logger
}

/** 1 ファイルあたりのアップロード上限（バイト）。既定 5GB。 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024

/** 署名付き PUT URL の有効期限（秒）。 */
export const UPLOAD_URL_EXPIRES_SEC = 900

/**
 * kind ごとに許可する contentType の接頭辞。
 * `other` は用途を限定しないため任意の型を許す。
 */
const CONTENT_TYPE_PREFIXES: Readonly<Record<MediaKind, readonly string[]>> = {
  image: ['image/'],
  video: ['video/'],
  audio: ['audio/'],
  font: ['font/', 'application/font-', 'application/x-font-'],
  lut: ['text/', 'application/octet-stream'],
  other: [],
}

/** contentType が kind と整合するか。申告された kind を検証なしに信用しないための関門。 */
export const isContentTypeAllowed = (kind: MediaKind, contentType: string): boolean => {
  const prefixes = CONTENT_TYPE_PREFIXES[kind]
  if (prefixes.length === 0) {
    return true
  }
  const normalized = contentType.trim().toLowerCase()
  return prefixes.some((prefix) => normalized.startsWith(prefix))
}

/** storageKey のセグメントに使える文字（packages/storage の規約に合わせる）。 */
const EXTENSION_PATTERN = /^[A-Za-z0-9_-]+$/

/**
 * ファイル名から拡張子を取り出す。
 * 拡張子が無い / ドット始まり / 使えない文字を含む場合は null を返す。
 */
export const fileExtension = (fileName: string): string | null => {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0 || dot === fileName.length - 1) {
    return null
  }
  const ext = fileName.slice(dot + 1).toLowerCase()
  return EXTENSION_PATTERN.test(ext) ? ext : null
}

const SignUploadBody = z
  .object({
    workspaceId: WorkspaceIdSchema,
    projectId: ProjectIdSchema.nullable().default(null),
    kind: MediaKindSchema,
    fileName: z.string().min(1).max(255),
    contentType: z.string().min(1).max(255),
    bytes: z.number().int().positive(),
  })
  .openapi('SignUploadInput')

const SignUploadData = z
  .object({
    mediaAssetId: MediaAssetIdSchema,
    storageKey: z.string().min(1),
    uploadUrl: z.string().min(1).openapi({ description: '署名付き PUT URL。保存せず都度発行する' }),
    expiresInSec: z.number().int().positive(),
  })
  .openapi('SignUploadResult')

const CompleteUploadBody = z
  .object({
    mediaAssetId: MediaAssetIdSchema,
    workspaceId: WorkspaceIdSchema,
    projectId: ProjectIdSchema.nullable().default(null),
    kind: MediaKindSchema,
    storageKey: z.string().min(1),
    mimeType: z.string().min(1).max(255),
    bytes: z.number().int().nonnegative(),
    checksumSha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 は 64 桁の小文字 16 進数です'),
    uploadedBy: z.string().min(1),
  })
  .openapi('CompleteUploadInput')

/**
 * complete の応答。MediaAsset に取り込みジョブの投入可否を添える。
 * 投入に失敗しても素材の登録自体は成功しているので 201 を返すが、
 * 呼び出し側が再投入を判断できるよう queued を必ず返す。
 */
const CompleteUploadData = MediaAssetResponse.extend({
  queued: z
    .boolean()
    .openapi({ description: 'media キューへ取り込みジョブを投入できたか' }),
}).openapi('CompleteUploadResult')

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const signUploadRoute = createRoute({
  method: 'post',
  path: '/uploads/sign',
  tags: ['uploads'],
  summary: '署名付き PUT URL を発行する',
  request: {
    body: { required: true, content: { 'application/json': { schema: SignUploadBody } } },
  },
  responses: {
    200: jsonContent('発行された署名付き PUT URL', successResponse(SignUploadData)),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

const completeUploadRoute = createRoute({
  method: 'post',
  path: '/uploads/complete',
  tags: ['uploads'],
  summary: 'アップロード完了を通知し MediaAsset を登録する',
  request: {
    body: { required: true, content: { 'application/json': { schema: CompleteUploadBody } } },
  },
  responses: {
    200: jsonContent('同じ checksum の既存 MediaAsset', successResponse(CompleteUploadData)),
    201: jsonContent('登録された MediaAsset', successResponse(CompleteUploadData)),
    404: errorContent('storageKey のオブジェクトが存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

export type UploadRoutesDeps = {
  mediaAssets: MediaAssetRepository
  storage: ObjectStorage
  /**
   * media キューへの投入口。未配線のときは登録だけ行い queued=false を返す。
   * 配線は main.ts 側で行う（ライブラリ側で Redis に触らない）。
   */
  mediaIngest?: MediaIngestDeps
}

/**
 * 取り込みジョブをキューへ投入する。
 * 投入に失敗しても素材の登録自体は成功しているため throw しないが、
 * 握り潰さずにログへ残し、queued=false として呼び出し側にも伝える（CLAUDE.md 規約 5）。
 */
const enqueueIngest = async (
  ingest: MediaIngestDeps | undefined,
  mediaAssetId: MediaAssetId,
): Promise<boolean> => {
  if (ingest === undefined) {
    return false
  }
  try {
    await ingest.queue.enqueue(mediaAssetId)
    return true
  } catch (error) {
    ingest.logger.error(
      { mediaAssetId, queue: MEDIA_QUEUE_NAME, err: error },
      'media キューへの取り込みジョブ投入に失敗しました',
    )
    return false
  }
}

export const uploadRoutes = ({ mediaAssets, storage, mediaIngest }: UploadRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(signUploadRoute, async (c) => {
      const { workspaceId, kind, fileName, contentType, bytes } = c.req.valid('json')

      if (bytes > MAX_UPLOAD_BYTES) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, {
            bytes: [`アップロードできるのは ${String(MAX_UPLOAD_BYTES)} バイトまでです`],
          }),
          422,
        )
      }

      if (!isContentTypeAllowed(kind, contentType)) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, {
            contentType: [`contentType が kind=${kind} と整合しません: ${contentType}`],
          }),
          422,
        )
      }

      const ext = fileExtension(fileName)
      if (ext === null) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, {
            fileName: ['ファイル名から拡張子を判別できません'],
          }),
          422,
        )
      }

      // MediaAsset の登録は complete 時に行う。ここでは key を決めるためだけに ID を採番する。
      const mediaAssetId = newId(MediaAssetIdSchema)
      const storageKey = mediaKey(workspaceId, mediaAssetId, ext)
      // 発行した URL は返すだけで保存しない（CLAUDE.md 規約 7）。
      const uploadUrl = await storage.signedPutUrl(storageKey, contentType, UPLOAD_URL_EXPIRES_SEC)

      return c.json(
        ok({ mediaAssetId, storageKey, uploadUrl, expiresInSec: UPLOAD_URL_EXPIRES_SEC }),
        200,
      )
    })
    .openapi(completeUploadRoute, async (c) => {
      const body = c.req.valid('json')

      // 別ワークスペース / 別アセットの key を申告されても取り込まないよう、
      // sign が発行した key の形（media/{workspaceId}/{mediaAssetId}/...）と一致するか確かめる。
      const expectedPrefix = `media/${body.workspaceId}/${body.mediaAssetId}/`
      if (!body.storageKey.startsWith(expectedPrefix)) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, {
            storageKey: ['storageKey が workspaceId / mediaAssetId と一致しません'],
          }),
          422,
        )
      }

      // 実体があることをストレージ側で確認する。クライアントの完了通知だけでは信用しない。
      const head = await storage.head(body.storageKey)
      if (head === null) {
        return c.json(fail('アップロードされたオブジェクトが見つかりません'), 404)
      }

      if (head.bytes !== body.bytes) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, {
            bytes: [
              `申告されたサイズが実際と異なります: 申告 ${String(body.bytes)} / 実際 ${String(head.bytes)}`,
            ],
          }),
          422,
        )
      }

      // 重複排除。同じ内容のファイルを二重に登録しない。
      const duplicate = await mediaAssets.findByChecksum(body.checksumSha256)
      if (duplicate !== null) {
        // 既存の素材は取り込み済み（または取り込み中）なので、キューへ入れ直さない。
        return c.json(ok({ ...toMediaAssetResponse(duplicate), queued: false }), 200)
      }

      const created = await mediaAssets.create({
        // 署名時に採番した ID をそのまま使う。
        // storageKey にこの ULID が埋まっているため、別 ID を振るとパスと行がずれる。
        id: body.mediaAssetId,
        workspaceId: body.workspaceId,
        projectId: body.projectId,
        kind: body.kind,
        storageKey: body.storageKey,
        mimeType: body.mimeType,
        bytes: head.bytes,
        checksumSha256: body.checksumSha256,
        origin: { type: 'upload', uploadedBy: body.uploadedBy },
        tags: [],
      })

      // media キューへ取り込みジョブ（ffprobe / プロキシ / サムネ / ポスター）を投入する。
      // 投入に失敗しても登録は成功しているので 201 を返す（docs/ARCHITECTURE.md §7）。
      const queued = await enqueueIngest(mediaIngest, created.id)

      return c.json(ok({ ...toMediaAssetResponse(created), queued }), 201)
    })
