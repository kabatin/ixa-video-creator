import type { ProjectEvent } from '@ixa/domain'

type ImageJobEvent = Extract<ProjectEvent, { type: 'image_job.status' }>

/**
 * 絵のジョブが失敗したときの知らせ。**何を作れなかったかを言い分ける。**
 * 出来事は種類を運ばないので、持ち主で見分ける（domain の `imageJobViolation` が種類と持ち主を縛っている）:
 * Shot を持てば絵コンテの画像、キャラクターを持てばキャラクターシート（ADR-0035）、
 * どちらも無ければサムネイルの背景（キーアート。ADR-0051）。失敗でなければ null。
 */
export const imageJobFailureNotice = (event: ImageJobEvent): string | null => {
  if (event.status !== 'failed') return null
  const what =
    event.characterId !== null
      ? 'キャラクターシート'
      : event.shotId !== null
        ? '絵コンテの画像'
        : 'サムネイルの背景の絵'
  return `${what}を作れませんでした: ${event.error ?? '理由が届きませんでした。'}`
}
