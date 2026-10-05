import { z } from 'zod'
import { MediaAssetId, NarrationLineId, NarrationTakeId, VoiceJobId } from '../common/ids.js'
import { Seconds } from '../common/time.js'
import { VoiceToolId } from './voice-profile.js'

/**
 * 声の Take（ADR-0038）。1 行を声にした 1 回分。**追記のみ**（上書きしない。行が「選んだ Take」を指す）。
 *
 * - AI で作った声は、音のファイル全体（`inSec` 0 〜 長さ）
 * - 録音は 1 つのファイルを文字起こしして行に分け、各行の Take が同じファイルの区間を指す
 */

export const MAX_TAKE_PEAKS = 400

export const CharTimeSchema = z.object({
  char: z.string(),
  startSec: z.number(),
  endSec: z.number(),
})

export const NarrationTakeSource = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('generated'),
    voiceJobId: VoiceJobId,
    tool: VoiceToolId,
    model: z.string().nullable(),
    voiceName: z.string(),
  }),
  z.object({
    type: z.literal('recording'),
    /** 文字起こしのジョブ。 */
    voiceJobId: VoiceJobId,
  }),
  /**
   * 作品の複製で写した Take（ADR-0037 / 0038）。**作ったのは元の作品**なので、こちらにはジョブが無い。
   * 元のジョブを指すと、別の作品の記録を指したままになる。
   */
  z.object({
    type: z.literal('copied'),
    fromTakeId: NarrationTakeId,
  }),
])
export type NarrationTakeSource = z.infer<typeof NarrationTakeSource>

export const NarrationTake = z
  .object({
    id: NarrationTakeId,
    lineId: NarrationLineId,
    /** 行の中の連番（1 から。表示用）。 */
    index: z.number().int().positive(),
    source: NarrationTakeSource,
    mediaAssetId: MediaAssetId,
    /** 音のファイルの中の区間（秒）。 */
    inSec: Seconds,
    outSec: Seconds,
    /** 実際に読ませた字（AI）／聞き取った字（録音）。 */
    spokenText: z.string(),
    /** 作ったときの表示。原稿を直したかを見るのに使う。 */
    displayText: z.string(),
    /** 同じ生成かのハッシュ（AI の声だけ）。 */
    specHash: z.string().nullable(),
    /** 表示の字ごとの時刻（区間の頭からの秒）。取れていなければ null。 */
    charTimes: z.array(CharTimeSchema).nullable(),
    /** 取り込んだときに測った音の大きさ（LUFS）。 */
    loudnessLufs: z.number().nullable(),
    /** 波形の点（0〜1）。 */
    peaks: z.array(z.number().min(0).max(1)).max(MAX_TAKE_PEAKS).nullable(),
    costUsd: z.number().nonnegative(),
    createdAt: z.date(),
  })
  .refine((take) => take.outSec > take.inSec, { message: '区間の終わりは始まりより後にしてください', path: ['outSec'] })
export type NarrationTake = z.infer<typeof NarrationTake>

/** 声の長さ（秒）。 */
export const takeDurationSec = (take: Pick<NarrationTake, 'inSec' | 'outSec'>): number => take.outSec - take.inSec
