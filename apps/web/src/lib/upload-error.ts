import { describeError } from '@/lib/api-error'

/**
 * アップロードは「署名発行 → ストレージへ PUT → 完了通知」の 3 段階で進む。
 * どこで落ちたかで対処が変わる（設定不足 / ネットワーク / 取り込み失敗）ため、
 * 段階を型として保持し、握り潰さずに原因を `cause` へ残す。
 */
export const UPLOAD_STAGES = ['sign', 'upload', 'complete'] as const

export type UploadStage = (typeof UPLOAD_STAGES)[number]

/**
 * 段階の呼び名。**内部実装の名前を画面に出さない。**
 * 「署名付き URL の発行」「完了通知」は、利用者から見て何が起きたか分からない。
 */
const STAGE_LABELS: Readonly<Record<UploadStage, string>> = {
  sign: '送信の準備',
  upload: 'ファイルの送信',
  complete: '取り込み',
}

/** 段階ごとの次の一手。**原因だけ書いて終わらせない。** */
const STAGE_HINTS: Readonly<Record<UploadStage, string>> = {
  sign: 'もう一度試してください。続くようなら、時刻を控えて知らせてください。',
  upload: 'ネットワークを確認して、もう一度試してください。',
  complete: 'ファイルは届いています。画面を開き直すと取り込めていることがあります。',
}

export const uploadStageLabel = (stage: UploadStage): string => STAGE_LABELS[stage]

export class UploadError extends Error {
  readonly stage: UploadStage

  constructor(stage: UploadStage, detail: string, options?: { cause?: unknown }) {
    super(`${STAGE_LABELS[stage]}に失敗しました: ${detail}。${STAGE_HINTS[stage]}`, options)
    this.name = 'UploadError'
    this.stage = stage
  }
}

/** 段階ごとに実行し、失敗を必ず `UploadError` へ包み直す。 */
export const runUploadStage = async <T>(stage: UploadStage, task: () => Promise<T>): Promise<T> => {
  try {
    return await task()
  } catch (cause) {
    if (cause instanceof UploadError) throw cause
    throw new UploadError(stage, describeError(cause), { cause })
  }
}
