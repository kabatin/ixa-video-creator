import type { Env } from './schema.js'

/**
 * 置き場の設定の食い違いを起動時に止める（ADR-0041）。
 *
 * **形は正しくても組み合わせが成り立たない設定を、使う瞬間まで持ち越さない。**
 * 持ち越すと、素材を読もうとした画面が「読み込めません」と言うだけになり、
 * 原因（鍵が無い・接続先が無い）が分からない。
 *
 * `localVideoGeneratorProblem` と同じ作法で、**値そのものは文に入れない。**
 */

/** `s3` のときに揃っていないといけない名前。 */
const S3_ENV_NAMES = ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const

export const storageProblem = (env: Env): string | null => {
  if (env.STORAGE_DRIVER === 'fs') {
    if (env.STORAGE_SIGNING_SECRET === undefined) {
      return (
        'STORAGE_DRIVER=fs ですが STORAGE_SIGNING_SECRET がありません。' +
        '署名付き URL を作れないため素材を 1 つも返せません。' +
        '`openssl rand -hex 32` などで作った値を .env に設定して再起動してください。'
      )
    }
    return null
  }

  const missing = S3_ENV_NAMES.filter((name) => env[name] === undefined)
  if (missing.length > 0) {
    return (
      `STORAGE_DRIVER=s3 ですが ${missing.join(' / ')} がありません。` +
      '置き場につながらないため素材の読み書きができません。' +
      '.env に設定するか、この機械のファイルに置くなら STORAGE_DRIVER=fs にして再起動してください。'
    )
  }
  return null
}
