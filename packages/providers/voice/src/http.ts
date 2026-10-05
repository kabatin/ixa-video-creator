import { VoiceProviderError, voiceFailureFromStatus } from '@ixa/provider-core'
import type { z } from 'zod'

/**
 * 声・文字起こしの API を呼ぶ共通の口。失敗は画面にそのまま出せる文にする（鍵・原稿・URL は入れない）。
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/** 応答の形が違う。黙って空の結果にせず、大きく失敗する。 */
export const badResponse = (who: string): VoiceProviderError =>
  new VoiceProviderError('bad_response', `${who} の応答の形が想定と違います。AI の仕様が変わった可能性があります`, false)

const send = async (fetchImpl: FetchLike, who: string, url: string, init: RequestInit): Promise<Response> => {
  try {
    return await fetchImpl(url, init)
  } catch (cause) {
    if (init.signal?.aborted === true) throw new VoiceProviderError('cancelled', `${who} への依頼を止めました`, false)
    const reason = cause instanceof Error ? cause.name : 'unknown'
    throw new VoiceProviderError('unavailable', `${who} に繋がりませんでした（${reason}）。ネットワークを確かめてください`, true)
  }
}

/** JSON を送り（または form を送り）、JSON を受け取って形を確かめる。 */
export const requestJson = async <T>(
  fetchImpl: FetchLike,
  who: string,
  url: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<T> => {
  const response = await send(fetchImpl, who, url, init)
  if (!response.ok) throw voiceFailureFromStatus(who, response.status)
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw badResponse(who)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw badResponse(who)
  return parsed.data
}
