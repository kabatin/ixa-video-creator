import { quantizeDuration } from '@ixa/domain'
import type { VideoProvider } from '@ixa/provider-core'
import {
  createLocalServerVideoProvider,
  type LocalServerBinding,
  type LocalServerProviderOptions,
} from '../local-server/provider.js'
import type { LocalServerFetch } from '../local-server/http.js'
import {
  framesForDuration,
  VPIPE_DEFAULT_BASE_URL,
  VPIPE_IDENTITY,
  VPIPE_MODEL_QUALITIES,
  VPIPE_POLL_POLICY,
  vpipeVideoModels,
  type VpipeQuality,
} from './descriptor.js'
import { H3_DIALOGUE_PROMPT_FORMAT, H3_PROMPT_FORMAT, h3PromptFormatFor } from './h3-prompt.js'
import { buildVpipeBody, VPIPE_STEPS } from './request.js'

/**
 * 手元の生成サーバ vpipe-api の MiniMax H3 Turbo（ADR-0031）。
 *
 * 中身は **vpipe-api v1 契約の共通アダプタ**（`local-server/provider.ts`）で、ここが足すのは
 * 「どのモデルを宣言するか」「投入の本文をどう組むか」だけ。wan-api の Wan も同じ共通アダプタを使う。
 */

/** 以前の名前（`VpipeFetch`）で参照している配線のための別名。 */
export type VpipeFetch = LocalServerFetch

export type VpipeVideoProviderOptions = Omit<LocalServerProviderOptions, 'baseUrl'> & {
  baseUrl?: string
}

const binding: LocalServerBinding<VpipeQuality> = {
  models: vpipeVideoModels,
  qualities: VPIPE_MODEL_QUALITIES,
  pollPolicy: VPIPE_POLL_POLICY,
  /**
   * H3 が作れるのは 17n+5 コマだけなので、**尺を切り上げてからコマ数へ戻して送る**（ADR-0031 §2）。
   * 戻せなければ投げる（近いコマ数へ黙って丸めない）。
   */
  buildBody: ({ spec, model, quality, hasStartImage, hasEndImage }) =>
    buildVpipeBody({
      spec,
      quality,
      frames: framesForDuration(quantizeDuration(spec.durationSec, model.capabilities.durations)),
      // 画像は共通の層があとから足す。文面だけは「足すかどうか」で組む。
      startImage: null,
      hasStartImage,
      hasEndImage,
    }),
  /** 版は投入の時点で仕様から決めて控える（セリフがあれば v4。ADR-0059）。 */
  promptFormatOf: h3PromptFormatFor,
  /**
   * 送ったステップ数と、**本文の組み立ての版**を記録に残す。
   * 文面そのものは持たない（`poll` はジョブ ID しか受け取らない）。
   * 版を残しておけば、仕様（`Take.spec`）と合わせて**いつでも同じ文面を組み直せる**。
   *
   * 版は控えから読む。控えが無ければ **null（分からない）**。v3 と決めつけると、セリフの Take を
   * v3 で組み直してしまう。版を持たない前の控えは、音付きかどうかから引く（v4 と音付きは同じ条件）。
   */
  extraRecord: ({ note }) => ({
    steps: VPIPE_STEPS,
    promptFormat:
      note === null
        ? null
        : (note.promptFormat ?? (note.audio ? H3_DIALOGUE_PROMPT_FORMAT : H3_PROMPT_FORMAT)),
  }),
}

export const createVpipeVideoProvider = (options: VpipeVideoProviderOptions): VideoProvider =>
  createLocalServerVideoProvider(VPIPE_IDENTITY, binding, {
    ...options,
    baseUrl: options.baseUrl ?? VPIPE_DEFAULT_BASE_URL,
  })
