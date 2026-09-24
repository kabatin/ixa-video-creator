import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * この環境の接続先と、お金に効く設定の呼び出し口。
 *
 * ```
 * GET /environment   鍵が設定されているかと、実行の設定
 * ```
 *
 * **鍵の値は来ない。設定する口も無い。** API は無認証で全インターフェースに
 * 待ち受けているため、値を運べば同じ網にいる誰でも課金される鍵を読める。
 * 鍵は `.env` に置いたままにし、画面には「設定されているか」までを出す（規約 6）。
 */

export const WireSecretStatus = z.object({
  label: z.string(),
  envName: z.string(),
  configured: z.boolean(),
  /** 文字数だけ。貼り漏れを確かめるためで、値そのものは来ない。 */
  length: z.number().int().positive().nullable(),
  purpose: z.string(),
})
export type WireSecretStatus = z.infer<typeof WireSecretStatus>

export const WireEnvironmentSetting = z.object({
  label: z.string(),
  envName: z.string(),
  value: z.string(),
  /** 既定から外れていて、意図しないと危ないもの。 */
  notable: z.boolean(),
  note: z.string(),
})
export type WireEnvironmentSetting = z.infer<typeof WireEnvironmentSetting>

export const WireEnvironment = z.object({
  secrets: z.array(WireSecretStatus),
  settings: z.array(WireEnvironmentSetting),
})
export type WireEnvironment = z.infer<typeof WireEnvironment>

export type EnvironmentApi = {
  readonly getEnvironment: () => Promise<WireEnvironment>
}

export const createEnvironmentApi = (requester: Requester): EnvironmentApi => ({
  getEnvironment: () => requester.get('/environment', WireEnvironment),
})
