import type { RenderPreset, Resolution } from '@ixa/domain'

/**
 * プリセットごとのエンコード設定（docs/ARCHITECTURE.md §16）。
 * 解像度・CRF はドキュメントの表が唯一の正。ここを変えるときは表も変えること。
 */
export type PresetSettings = {
  readonly width: number
  readonly height: number
  readonly crf: number
  readonly codec: 'h264' | 'h265'
  readonly pixelFormat: 'yuv420p'
  readonly audioBitrate: string
}

export const PRESET_SETTINGS: Readonly<Record<RenderPreset, PresetSettings>> = {
  preview_720p: {
    width: 1280,
    height: 720,
    crf: 26,
    codec: 'h264',
    pixelFormat: 'yuv420p',
    audioBitrate: '128k',
  },
  master_1080p: {
    width: 1920,
    height: 1080,
    crf: 18,
    codec: 'h264',
    pixelFormat: 'yuv420p',
    audioBitrate: '320k',
  },
  master_4k: {
    width: 3840,
    height: 2160,
    crf: 18,
    codec: 'h265',
    pixelFormat: 'yuv420p',
    audioBitrate: '320k',
  },
  social_vertical: {
    width: 1080,
    height: 1920,
    crf: 20,
    codec: 'h264',
    pixelFormat: 'yuv420p',
    audioBitrate: '192k',
  },
}

/** 映像を配置する矩形。キャンバス中央に置かれる。 */
export type FitRect = {
  readonly width: number
  readonly height: number
  readonly left: number
  readonly top: number
}

/**
 * **プリセット解像度と `TimelineDocument.resolution` が食い違う場合の扱い（設計判断）**
 *
 * 出力キャンバスは **常にプリセットを優先する**。納品仕様（1080p / 4K / 縦）は
 * プロジェクト設定より後から決まることが多く、プリセットを無視すると
 * 「4K で書き出したのに 1080p のファイルが出る」という事故になるため。
 *
 * そのうえで映像は **アスペクト比を保ったままキャンバスに収める（レターボックス）**。
 * 引き伸ばして歪ませない・切り落とさないことを優先する。
 * 余白は黒帯になる。`social_vertical` の再フレーミング規則（顔を中央に寄せる等）は
 * Phase 1 では実装しない。単純なレターボックスに縮退する。
 *
 * 幅は偶数に丸める。yuv420p は奇数サイズを許さないため。
 */
export const letterboxFit = (source: Resolution, canvas: PresetSettings | Resolution): FitRect => {
  const scale = Math.min(canvas.width / source.width, canvas.height / source.height)
  const width = Math.max(2, Math.round((source.width * scale) / 2) * 2)
  const height = Math.max(2, Math.round((source.height * scale) / 2) * 2)
  return {
    width,
    height,
    left: Math.round((canvas.width - width) / 2),
    top: Math.round((canvas.height - height) / 2),
  }
}

/** プリセットのキャンバス解像度。 */
export const presetResolution = (preset: RenderPreset): Resolution => {
  const settings = PRESET_SETTINGS[preset]
  return { width: settings.width, height: settings.height }
}
