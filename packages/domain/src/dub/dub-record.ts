import { z } from 'zod'
import { TakeId } from '../common/ids.js'
import { MAX_DUB_TIME_SEC } from './dialogue-dub.js'

/**
 * 声を差し替えた Take の記録（ADR-0062。`ProviderParams` の `dub`）。作ったときに 1 度だけ書く。
 * 字幕は `placedStartSec`/`placedEndSec` をそのまま行の時刻に使う（無音の検出より正確）。
 */

/** 行の扱い。`lip` は口に合わせた行、`keep_original` は元の声のまま。 */
export const DubLineMode = z.enum(['lip', 'place_at', 'fit', 'cut', 'keep_original'])
export type DubLineMode = z.infer<typeof DubLineMode>

/** 使った読み方（`readingVariants` の種類）。元の声のままの行は null。 */
export const DubReading = z.enum(['plain', 'pause', 'no_comma'])
export type DubReading = z.infer<typeof DubReading>

export const DubWarningCode = z.enum(['fast_tempo', 'slow_tempo_clamped', 'cut_by_next', 'chunk_count_mismatch', 'line_span_ambiguous'])
export type DubWarningCode = z.infer<typeof DubWarningCode>

export const DubWarning = z.object({ code: DubWarningCode, message: z.string().min(1).max(200) }).strict()
export type DubWarning = z.infer<typeof DubWarning>

const Sec = z.number().finite().min(0).max(MAX_DUB_TIME_SEC)
const Tempo = z.number().finite().min(0.25).max(4)

export const DubLineRecord = z
  .object({
    lineIndex: z.number().int().min(0).max(19),
    mode: DubLineMode,
    added: z.boolean(),
    /** 元の声の区間（足す行は null）。 */
    sourceStartSec: Sec.nullable(),
    sourceEndSec: Sec.nullable(),
    /** 置いた声の区間（Shot の頭からの秒）。字幕の時刻の正。 */
    placedStartSec: Sec,
    placedEndSec: Sec,
    /** 口との一致率（0〜1）。口に合わせていない行は null。 */
    agreement: z.number().min(0).max(1).nullable(),
    /** 伸縮の幅（倍率の最小・最大）。伸縮していなければ 1。 */
    tempoMin: Tempo,
    tempoMax: Tempo,
    reading: DubReading.nullable(),
    warnings: z.array(DubWarning).max(8),
  })
  .strict()
  .superRefine((line, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message })
    if (line.placedEndSec < line.placedStartSec) issue('placedEndSec', '置いた声の終わりが始まりより前です')
    if (line.tempoMin > line.tempoMax) issue('tempoMin', '伸縮の幅の最小が最大より大きいです')
    if ((line.sourceStartSec === null) !== (line.sourceEndSec === null)) issue('sourceEndSec', '元の区間は始まりと終わりを両方持ちます')
    if (line.added !== (line.sourceStartSec === null)) issue('sourceStartSec', '足す行だけが元の区間を持ちません')
  })
export type DubLineRecord = z.infer<typeof DubLineRecord>

export const DubParams = z
  .object({
    kind: z.literal('dub'),
    /** 差し替えの元の Take（系譜の `parentTakeId` と同じ値）。 */
    sourceTakeId: TakeId,
    voiceTool: z.literal('gemini_api'),
    model: z.string().min(1).max(80),
    /** 仕上げの大きさ（LUFS）。 */
    integratedLufs: z.number().finite().nullable(),
    lines: z.array(DubLineRecord).max(20),
  })
  .strict()
export type DubParams = z.infer<typeof DubParams>
