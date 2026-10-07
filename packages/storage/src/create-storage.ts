import { createFsStorage } from './fs-storage.js'
import type { ObjectStorage } from './port.js'
import type { S3StorageConfig } from './s3-storage.js'
import { createS3Storage } from './s3-storage.js'

/**
 * 設定から保管庫を 1 つ作る（ADR-0041）。
 *
 * **API と worker はこの関数だけを呼ぶ。** 配線を 2 箇所に書き写すと、片方だけ `fs` になって
 * 「API は読めるのに worker が書けない」のような気付きにくい食い違いができる。
 *
 * この形は `@ixa/config` の `AppConfig['storage']` とそのまま同じにしてある。
 * import せず（config → storage の向きを作らず）、**型が合うことを呼び出し側で確かめさせる**。
 */
export type StorageSettings = {
  readonly driver: 'fs' | 's3'
  /** `fs` の根（絶対パス）。 */
  readonly root: string
  /** 署名付き URL の宛先。 */
  readonly publicBaseUrl: string
  /** `fs` の署名の鍵。 */
  readonly signingSecret: string | null
  /** `s3` の接続先。 */
  readonly s3: S3StorageConfig | null
}

export const createStorage = (settings: StorageSettings): ObjectStorage => {
  if (settings.driver === 'fs') {
    if (settings.signingSecret === null) {
      // 設定の検証（@ixa/config の storageProblem）が先に止めるので、ここへは来ない。
      // それでも黙って署名なしで動かさないために残す。
      throw new Error('STORAGE_DRIVER=fs ですが署名の鍵がありません（STORAGE_SIGNING_SECRET）')
    }
    return createFsStorage({
      root: settings.root,
      publicBaseUrl: settings.publicBaseUrl,
      signingSecret: settings.signingSecret,
    })
  }

  if (settings.s3 === null) {
    throw new Error('STORAGE_DRIVER=s3 ですが接続先がありません（S3_ENDPOINT ほか）')
  }
  return createS3Storage(settings.s3)
}
