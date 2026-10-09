import { runFfmpeg, type RunOptions } from './ffmpeg-runner.js'

/**
 * 書き出しの直前の拡大（ADR-0045）。
 *
 * 書き出しは Remotion（headless Chrome）で、映像は `objectFit: contain` で枠へ収める。
 * 素材が枠より小さいと **Chrome が拡大し、それは bilinear 相当**（輪郭 −13%。実機で測定）。
 * だから小さい素材だけ、先に ffmpeg の Lanczos で枠の大きさへ拡大しておく。
 */

export type FrameSize = { readonly width: number; readonly height: number }

/**
 * 中間ファイルの品質。**CRF 16**。
 *
 * 可逆（-qp 0）との差は書き出し（CRF 18）を通すと最終出力に届かなかった（ADR-0045 §5 の実測）。
 * 元の素材も vpipe 側で CRF 16 なので、新しい粗い量子化を足さずに済む。
 * 一時ディスクは本制作 116 秒ぶんで約 270 MB（可逆なら約 2.5 GB）。
 */
export const RENDER_UPSCALE_CRF = 16

/**
 * 枠に contain で収めたときの倍率。**1 を超えるときだけ拡大が要る。**
 *
 * - 1344x756 → 1920x1080: 1.4286（拡大する）
 * - 1920x1080 → 1920x1080: 1（触らない。いまの素材はすべてこれ）
 * - 3840x2160 → 1920x1080: 0.5（縮小は Chrome に任せる。眠くなるのは拡大のときだけ）
 */
export const containScale = (source: FrameSize, frame: FrameSize): number =>
  Math.min(frame.width / source.width, frame.height / source.height)

export const needsRenderUpscale = (source: FrameSize, frame: FrameSize): boolean =>
  containScale(source, frame) > 1

/**
 * ffmpeg の引数。**比を保って枠の内側へ収める**（`force_original_aspect_ratio=decrease`）。
 * 枠ちょうどへ引き伸ばすと、比の違う素材（持ち込んだ 4:3 など）が歪む。
 * 4:2:0 のため縦横を偶数へ切り下げる。
 *
 * 音はそのまま写す（重ねた素材は音を鳴らすことがある）。
 */
export const renderUpscaleArgs = (input: string, output: string, frame: FrameSize): readonly string[] => [
  '-y',
  '-i',
  input,
  '-vf',
  `scale=${String(frame.width)}:${String(frame.height)}:force_original_aspect_ratio=decrease:flags=lanczos,` +
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
  '-c:v',
  'libx264',
  '-crf',
  String(RENDER_UPSCALE_CRF),
  '-preset',
  'medium',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'copy',
  '-movflags',
  '+faststart',
  output,
]

export const upscaleForRender = async (
  input: string,
  output: string,
  frame: FrameSize,
  runOptions?: RunOptions,
): Promise<void> => {
  await runFfmpeg(renderUpscaleArgs(input, output, frame), runOptions)
}
