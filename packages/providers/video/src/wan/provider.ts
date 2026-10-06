import { quantizeDuration } from '@ixa/domain'
import type { VideoProvider } from '@ixa/provider-core'
import {
  createLocalServerVideoProvider,
  type LocalServerBinding,
  type LocalServerProviderOptions,
} from '../local-server/provider.js'
import {
  WAN_DEFAULT_BASE_URL,
  WAN_IDENTITY,
  WAN_MODEL_QUALITIES,
  WAN_POLL_POLICY,
  wanVideoModels,
  type WanQuality,
} from './descriptor.js'
import { buildWanBody } from './request.js'

/**
 * 手元の生成サーバ wan-api の Wan 2.2 TI2V-5B（ADR-0040）。
 *
 * 中身は **vpipe-api v1 契約の共通アダプタ**（`local-server/provider.ts`）。
 * ここが足すのは「どのモデルを宣言するか」「投入の本文をどう組むか」だけで、
 * 投入・問い合わせ・取消・満杯の扱い・冪等キー・出力の取り込みは MiniMax H3 と同じ実装を通る。
 */

export type WanVideoProviderOptions = Omit<LocalServerProviderOptions, 'baseUrl'> & {
  baseUrl?: string
}

const binding: LocalServerBinding<WanQuality> = {
  models: wanVideoModels,
  qualities: WAN_MODEL_QUALITIES,
  pollPolicy: WAN_POLL_POLICY,
  /**
   * 尺は秒のまま渡す。**コマ数へ合わせるのはサーバ**（ADR-0040）。
   * `quantizeDuration` は宣言した範囲へ収めるだけ（最長より長い Shot を最長で作る判断を含む）。
   */
  buildBody: ({ spec, model, quality }) =>
    buildWanBody({
      spec,
      quality,
      durationSec: quantizeDuration(spec.durationSec, model.capabilities.durations),
      startImage: null,
    }),
}

export const createWanVideoProvider = (options: WanVideoProviderOptions): VideoProvider =>
  createLocalServerVideoProvider(WAN_IDENTITY, binding, {
    ...options,
    baseUrl: options.baseUrl ?? WAN_DEFAULT_BASE_URL,
  })
