import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { ObjectHead, ObjectStorage, PutOptions, StorageKey } from './port.js'
import { ObjectNotFoundError, StorageError } from './port.js'

export type S3StorageConfig = {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

/** HeadObject / GetObject が「存在しない」ことを示すエラーかどうかを判定する */
const isNotFoundError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  const name = 'name' in error ? String(error.name) : ''
  if (name === 'NotFound' || name === 'NoSuchKey') return true
  const statusCode =
    '$metadata' in error &&
    typeof (error as { $metadata?: { httpStatusCode?: number } }).$metadata === 'object'
      ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      : undefined
  return statusCode === 404
}

/**
 * S3 互換ストレージ（MinIO / クラウドの S3 互換サービス）向けの ObjectStorage 実装。
 * `forcePathStyle` を反映することで MinIO でも動作する。
 */
export const createS3Storage = (config: S3StorageConfig): ObjectStorage => {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })

  const put = async (key: StorageKey, body: Uint8Array | Buffer, options: PutOptions): Promise<void> => {
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: options.contentType,
          CacheControl: options.cacheControl,
          Metadata: options.metadata,
        }),
      )
    } catch (error) {
      throw new StorageError('put に失敗しました', 'put', key, { cause: error })
    }
  }

  const get = async (key: StorageKey): Promise<Uint8Array> => {
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))
      if (response.Body === undefined) {
        throw new StorageError('get のレスポンスに Body がありません', 'get', key)
      }
      return await response.Body.transformToByteArray()
    } catch (error) {
      if (isNotFoundError(error)) throw new ObjectNotFoundError(key, { cause: error })
      if (error instanceof StorageError) throw error
      throw new StorageError('get に失敗しました', 'get', key, { cause: error })
    }
  }

  const head = async (key: StorageKey): Promise<ObjectHead | null> => {
    try {
      const response = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }))
      return {
        key,
        bytes: response.ContentLength ?? 0,
        contentType: response.ContentType ?? 'application/octet-stream',
        lastModified: response.LastModified ?? new Date(0),
      }
    } catch (error) {
      if (isNotFoundError(error)) return null
      throw new StorageError('head に失敗しました', 'head', key, { cause: error })
    }
  }

  const del = async (key: StorageKey): Promise<void> => {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))
    } catch (error) {
      throw new StorageError('delete に失敗しました', 'delete', key, { cause: error })
    }
  }

  const exists = async (key: StorageKey): Promise<boolean> => {
    const found = await head(key)
    return found !== null
  }

  const signedPutUrl = async (key: StorageKey, contentType: string, expiresInSec: number): Promise<string> => {
    try {
      const command = new PutObjectCommand({ Bucket: config.bucket, Key: key, ContentType: contentType })
      return await getSignedUrl(client, command, { expiresIn: expiresInSec })
    } catch (error) {
      throw new StorageError('signedPutUrl に失敗しました', 'signedPutUrl', key, { cause: error })
    }
  }

  const signedGetUrl = async (key: StorageKey, expiresInSec: number): Promise<string> => {
    try {
      const command = new GetObjectCommand({ Bucket: config.bucket, Key: key })
      return await getSignedUrl(client, command, { expiresIn: expiresInSec })
    } catch (error) {
      throw new StorageError('signedGetUrl に失敗しました', 'signedGetUrl', key, { cause: error })
    }
  }

  return { put, get, head, delete: del, exists, signedPutUrl, signedGetUrl }
}
