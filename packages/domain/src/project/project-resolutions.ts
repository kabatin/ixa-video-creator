import type { AspectRatio, Fps, Resolution } from '../common/time.js'

/**
 * 作品の設定で選べる大きさと fps。**ここが唯一の正。**
 *
 * 画面の選択肢（`apps/web/src/lib/resolution-presets.ts`）はここから作り、無料で Take まで行ける
 * 「静止画を動かす」（`packages/providers/video/src/local/descriptor.ts`）はここにある値をすべて受ける。
 * 以前は 3 箇所に別々の表があり、画面で選べる HD 縦 720×1280 を Take が断っていた（2026-11-11）。
 *
 * 各形の先頭が既定（「迷ったらこれ」）。
 */
export const PROJECT_RESOLUTIONS: Readonly<Record<AspectRatio, readonly Resolution[]>> = {
  '16:9': [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
    { width: 3840, height: 2160 },
  ],
  '9:16': [
    { width: 1080, height: 1920 },
    { width: 720, height: 1280 },
  ],
  '1:1': [
    { width: 1080, height: 1080 },
    { width: 720, height: 720 },
  ],
  '4:5': [
    { width: 1080, height: 1350 },
    { width: 864, height: 1080 },
  ],
  '21:9': [
    { width: 2560, height: 1080 },
    { width: 3440, height: 1440 },
  ],
}

export const PROJECT_FPS_OPTIONS: readonly Fps[] = [24, 25, 30, 60]
