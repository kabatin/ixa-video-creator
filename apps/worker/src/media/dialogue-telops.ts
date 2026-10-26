import type { MediaAsset } from '@ixa/domain'
import { syncDialogueTelops, type DialogueTelopSyncDeps } from '@ixa/generation'
import type { Logger } from 'pino'

/**
 * 取り込みが済んだら、その作品のセリフの字幕を作り直す（ADR-0061）。取り込みで Take の音の有無と話している区間が
 * 分かるので、採用したあとに取り込みが終わった Take でも、区間に合わせた時刻になる。
 *
 * - 動画で、作品に属する素材だけ（曲・声・画像では Take の音は変わらない）。
 * - **セリフの無い作品は読むだけ**（規則は `@ixa/generation` の `syncDialogueTelops`。api と同じもの）。
 * - **投げない。** 失敗はログに残す（取り込みは済んでいる。次に Shot を直したときに揃う）。
 */
export const syncDialogueTelopsAfterIngest =
  (deps: DialogueTelopSyncDeps & { readonly logger: Logger }) =>
  async (asset: MediaAsset): Promise<void> => {
    if (asset.kind !== 'video' || asset.projectId === null) return
    try {
      await syncDialogueTelops(deps, asset.projectId)
    } catch (error) {
      deps.logger.error({ err: error, mediaAssetId: asset.id, projectId: asset.projectId }, 'セリフの字幕を作り直せませんでした')
    }
  }

/** 取り込みの後の知らせを順に呼ぶ。 */
export const allAfterIngested =
  (...hooks: readonly ((asset: MediaAsset) => Promise<void>)[]) =>
  async (asset: MediaAsset): Promise<void> => {
    for (const hook of hooks) await hook(asset)
  }
