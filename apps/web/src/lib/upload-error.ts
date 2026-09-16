import { describeError } from '@/lib/api-error'

/**
 * アップロードは「署名発行 → ストレージへ PUT → 完了通知」の 3 段階で進む。
 * どこで落ちたかで対処が変わる（設定不足 / ネットワーク / 取り込み失敗）ため、
 * 段階を型として保持し、握り潰さずに原因を `cause` へ残す。
 */
export const UPLOAD_STAGES = ['sign', 'upload', 'complete'] as const

export type UploadStage = (typeof UPLOAD_STAGES)[number]

const STAGE_LABELS: Readonly<Record<UploadStage, string>> = {
  sign: '署名付き URL の発行',
  upload: 'ストレージへの送信',
  complete: '完了通知',
}

export const uploadStageLabel = (stage: UploadStage): string => STAGE_LABELS[stage]

export class UploadError extends Error {
  readonly stage: UploadStage

  constructor(stage: UploadStage, detail: string, options?: { cause?: unknown }) {
    super(`アップロードの${STAGE_LABELS[stage]}に失敗しました: ${detail}`, options)
    this.name = 'UploadError'
    this.stage = stage
  }
}

/** 段階ごとに実行し、失敗を必ず `UploadError` へ包み直す。 */
export const runUploadStage = async <T>(
  stage: UploadStage,
  task: () => Promise<T>,
): Promise<T> => {
  try {
    return await task()
  } catch (cause) {
    if (cause instanceof UploadError) throw cause
    throw new UploadError(stage, describeError(cause), { cause })
  }
}
