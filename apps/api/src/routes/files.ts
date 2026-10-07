import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import {
  InvalidStorageKeyError,
  ObjectTooLargeError,
  verifyStorageAccess,
  type FsStorage,
  type StorageAccessMethod,
} from '@ixa/storage'
import {
  contentRangeHeader,
  parseByteRange,
  rangeLength,
  unsatisfiedRangeHeader,
  type ByteRange,
} from '../files/byte-range.js'
import type { Logger } from '../logger.js'
import { fail, ok } from '../response.js'
import { MAX_UPLOAD_BYTES } from './uploads.js'

/**
 * 手元に置いた素材を返す口（ADR-0041）。**置き場が `fs` のときだけ登録する。**
 * `s3` では署名を置き場自身が出し、ブラウザも置き場へ直接つなぐのでこの口は要らない。
 *
 * - 署名は `@ixa/storage` の `verifyStorageAccess`（読む署名と書く署名は別物）
 * - `Range` に対応する（動画のシークとプレビューがこれに乗る）
 * - 流し読みで返す。1 本を丸ごとメモリに載せない
 */

export type FileRoutesDeps = {
  readonly storage: FsStorage
  /** 署名の鍵（`STORAGE_SIGNING_SECRET`）。 */
  readonly signingSecret: string
  /**
   * 1 ファイルで受け取れる上限（バイト）。
   * 既定は署名を出すときと同じ `MAX_UPLOAD_BYTES`（上限を 2 つ持たない）。テストから小さくする。
   */
  readonly maxUploadBytes?: number
  /** いまの時刻。テストから差し替える。 */
  readonly nowMs?: () => number
  readonly logger: Logger
}

/**
 * **何が違うかは言わない。** 鍵違い・改竄・期限切れを区別して返すと、
 * 署名を当てる側に手がかりを渡すことになる。
 */
const FORBIDDEN_MESSAGE = 'この URL では素材を取り出せません（期限が切れたか、URL が壊れています）'
const NOT_FOUND_MESSAGE = '素材が見つかりません'

/**
 * 同じ URL を短いあいだ使い回せるようにする。署名は窓の頭に揃っているので
 * （`signingWindow`）、ここで少し持たせると編集のたびの読み直しが減る。
 * 作り直される物（proxy・thumb）もあるので長くはしない。
 */
const CACHE_CONTROL = 'private, max-age=60'

const requestedContentType = (raw: string | undefined): string =>
  (raw ?? '').split(';')[0]?.trim().toLowerCase() ?? ''

export const fileRoutes = (deps: FileRoutesDeps) => {
  const now = deps.nowMs ?? ((): number => Date.now())
  const maxUploadBytes = deps.maxUploadBytes ?? MAX_UPLOAD_BYTES

  /** 署名を確かめる。通らない理由はログに残すが、**URL も署名も残さない**（規約 7）。 */
  const allowed = (
    method: StorageAccessMethod,
    key: string,
    query: { readonly exp: string | undefined; readonly sig: string | undefined },
    contentType?: string,
  ): boolean => {
    const expiresAtSec = Number(query.exp)
    if (query.exp === undefined || !Number.isInteger(expiresAtSec)) {
      deps.logger.warn({ reason: 'no_expiry' }, '素材の URL に期限がありません')
      return false
    }
    const check = verifyStorageAccess(
      {
        method,
        key,
        expiresAtSec,
        contentType,
        signature: query.sig ?? '',
        nowMs: now(),
      },
      deps.signingSecret,
    )
    if (!check.ok) {
      deps.logger.warn({ reason: check.reason }, '素材の URL を受け取れませんでした')
      return false
    }
    return true
  }

  const bodyOf = (filePath: string, range: ByteRange | null): ReadableStream<Uint8Array> => {
    const stream =
      range === null
        ? createReadStream(filePath)
        : createReadStream(filePath, { start: range.start, end: range.end })
    return Readable.toWeb(stream)
  }

  return new Hono()
    /**
     * `HEAD` も同じ経路で受ける。ブラウザや QuickTime は再生の前に大きさだけ聞くことがあり、
     * 404 を返すと「読み込めない」で止まる。
     */
    .on(['GET', 'HEAD'], '/:key{.+}', async (c) => {
      const key = c.req.param('key')
      if (!allowed('GET', key, { exp: c.req.query('exp'), sig: c.req.query('sig') })) {
        return c.json(fail(FORBIDDEN_MESSAGE), 403)
      }

      /**
       * 署名が通った key でも、形が受け取れないなら触らない（**2 重の柵**）。
       * 鍵が漏れた・鍵を知る側が作り間違えた場合に、根の外へ出る経路を残さない。
       */
      let head
      try {
        head = await deps.storage.head(key)
      } catch (error) {
        if (!(error instanceof InvalidStorageKeyError)) throw error
        deps.logger.warn({ reason: 'invalid_key' }, '素材の場所として受け取れない URL です')
        return c.json(fail(FORBIDDEN_MESSAGE), 403)
      }
      if (head === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const requested = parseByteRange(c.req.header('range'), head.bytes)
      if (requested.kind === 'unsatisfiable') {
        return c.body(null, 416, {
          'content-range': unsatisfiedRangeHeader(head.bytes),
          'accept-ranges': 'bytes',
        })
      }

      const range = requested.kind === 'partial' ? requested.range : null
      const length = range === null ? head.bytes : rangeLength(range)
      const headers: Record<string, string> = {
        'content-type': head.contentType,
        'content-length': String(length),
        'accept-ranges': 'bytes',
        'cache-control': CACHE_CONTROL,
        'last-modified': head.lastModified.toUTCString(),
        ...(range === null ? {} : { 'content-range': contentRangeHeader(range, head.bytes) }),
      }

      // 大きさだけ聞かれているので、中身は読まない（開く前に返す）。
      if (c.req.method === 'HEAD') return c.body(null, 200, headers)

      const filePath = await deps.storage.localPath(key)
      return c.body(bodyOf(filePath, range), range === null ? 200 : 206, headers)
    })
    /** 取り込み（`signedPutUrl` の宛先）。流し読みのまま書き、上限を超えたら受け取らない。 */
    .put('/:key{.+}', async (c) => {
      const key = c.req.param('key')
      const signedContentType = c.req.query('ct') ?? ''
      if (
        !allowed(
          'PUT',
          key,
          { exp: c.req.query('exp'), sig: c.req.query('sig') },
          signedContentType,
        )
      ) {
        return c.json(fail(FORBIDDEN_MESSAGE), 403)
      }

      // 署名したときの型と、実際に送ってきた型が違うなら受けない（S3 と同じ約束）。
      if (requestedContentType(c.req.header('content-type')) !== requestedContentType(signedContentType)) {
        deps.logger.warn({ reason: 'content_type_mismatch' }, '素材の型が署名と違います')
        return c.json(fail(FORBIDDEN_MESSAGE), 403)
      }

      const body = c.req.raw.body
      if (body === null) return c.json(fail('中身がありません'), 400)

      try {
        const bytes = await deps.storage.putStream(key, body, maxUploadBytes)
        return c.json(ok({ bytes }), 200)
      } catch (error) {
        if (error instanceof ObjectTooLargeError) {
          return c.json(fail(`受け取れる大きさを超えました（上限 ${String(maxUploadBytes)} バイト）`), 413)
        }
        if (error instanceof InvalidStorageKeyError) return c.json(fail(FORBIDDEN_MESSAGE), 403)
        throw error
      }
    })
}
