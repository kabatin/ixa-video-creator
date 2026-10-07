/**
 * ストレージキー。バケット内のオブジェクトパス（例: `media/{workspaceId}/{mediaAssetId}/original.mp4`）。
 * 署名付き URL は都度発行し、DB には保存しない（docs/ARCHITECTURE.md）。
 */
export type StorageKey = string

export type PutOptions = {
  contentType: string
  cacheControl?: string
  metadata?: Record<string, string>
}

export type ObjectHead = {
  key: StorageKey
  bytes: number
  contentType: string
  lastModified: Date
}

/**
 * S3 互換オブジェクトストレージの抽象。
 * 実装（MinIO / クラウド S3 互換サービス / インメモリ）はこの Port にのみ依存させる。
 */
export interface ObjectStorage {
  /** バイト列を直接保存する（Worker が生成物を取り込むときに使う） */
  put(key: StorageKey, body: Uint8Array | Buffer, options: PutOptions): Promise<void>
  /** 取得する。存在しない場合は ObjectNotFoundError を throw する */
  get(key: StorageKey): Promise<Uint8Array>
  /** メタデータのみ取得する。存在しない場合は null を返す（throw しない） */
  head(key: StorageKey): Promise<ObjectHead | null>
  delete(key: StorageKey): Promise<void>
  exists(key: StorageKey): Promise<boolean>
  /** クライアントが直接アップロードするための署名付き PUT URL。呼び出し側が有効期限を秒で指定する */
  signedPutUrl(key: StorageKey, contentType: string, expiresInSec: number): Promise<string>
  /** 読み取り用の署名付き GET URL。呼び出し側が有効期限を秒で指定する */
  signedGetUrl(key: StorageKey, expiresInSec: number): Promise<string>
}

/**
 * ストレージ操作に失敗したときの基底エラー。
 * 元のエラーを cause として保持し、握り潰さずに再throwするために使う。
 */
export class StorageError extends Error {
  constructor(message: string, readonly operation: string, readonly key: StorageKey, options?: { cause?: unknown }) {
    super(`ストレージ操作に失敗しました [${operation}] key=${key}: ${message}`, options)
    this.name = 'StorageError'
  }
}

/**
 * 受け取れる大きさを超えたときに throw される（流し読みで書くときだけ起きる）。
 * 途中まで書いたものは消してから投げる。
 */
export class ObjectTooLargeError extends StorageError {
  constructor(key: StorageKey, readonly maxBytes: number, options?: { cause?: unknown }) {
    super(`大きさの上限（${String(maxBytes)} バイト）を超えました`, 'put', key, options)
    this.name = 'ObjectTooLargeError'
  }
}

/** 指定された key のオブジェクトが存在しないときに throw される */
export class ObjectNotFoundError extends StorageError {
  constructor(key: StorageKey, options?: { cause?: unknown }) {
    super('オブジェクトが見つかりません', 'get', key, options)
    this.name = 'ObjectNotFoundError'
  }
}
