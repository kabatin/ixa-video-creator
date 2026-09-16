import { probeMedia, runFfmpeg } from '@ixa/media'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * レンダリング結果を**絵として**確かめるための道具。
 *
 * 「テストが通る」と「画に出ている」は別の主張（tasks/lessons.md L-011）。
 * 計画（`TimelinePlan`）が正しいことと、MP4 のピクセルがそうなっていることは
 * 別々に確かめる必要があるため、出力から実際のフレームを取り出して色を見る。
 */
export type Rgb = { readonly r: number; readonly g: number; readonly b: number }

export type Rect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type Frame = {
  readonly width: number
  readonly height: number
  readonly pixel: (x: number, y: number) => Rgb
}

const BYTES_PER_PIXEL = 3

/**
 * 指定時刻のフレームを RGB24 の生データとして取り出す。
 *
 * `-ss` は `-i` の**後ろ**に置く。前に置くと入力シークになり、
 * キーフレーム位置によってはリクエストした時刻と違うフレームが返る。
 * ここでは時刻の正確さが判定の前提なので、遅くても出力シークを使う。
 *
 * 一時ファイルは呼び出しごとに必ず消す。
 */
export const extractFrame = async (
  videoPath: string,
  timeSec: number,
  workDir: string,
): Promise<Frame> => {
  const probe = await probeMedia(videoPath)
  const width = probe.width
  const height = probe.height
  if (width === null || height === null) {
    throw new Error(`映像ストリームの解像度を取得できませんでした: ${videoPath}`)
  }

  const rawPath = join(workDir, `frame-${timeSec.toFixed(6)}.raw`)
  try {
    await runFfmpeg([
      '-y',
      '-i', videoPath,
      '-ss', timeSec.toFixed(6),
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      rawPath,
    ])

    const buffer = await readFile(rawPath)
    const expected = width * height * BYTES_PER_PIXEL
    if (buffer.length < expected) {
      throw new Error(
        `フレームの生データが足りません (${buffer.length} < ${expected}): ${videoPath} @ ${timeSec}s`,
      )
    }

    return {
      width,
      height,
      pixel: (x, y) => {
        if (x < 0 || y < 0 || x >= width || y >= height) {
          throw new Error(`範囲外のピクセルを読もうとしました: (${x}, ${y})`)
        }
        const offset = (y * width + x) * BYTES_PER_PIXEL
        return { r: buffer[offset] ?? 0, g: buffer[offset + 1] ?? 0, b: buffer[offset + 2] ?? 0 }
      },
    }
  } finally {
    await rm(rawPath, { force: true })
  }
}

/** 矩形の中で条件を満たすピクセル数。テキストのような疎な描画を拾うために使う。 */
export const countPixels = (
  frame: Frame,
  rect: Rect,
  predicate: (pixel: Rgb) => boolean,
): number => {
  let count = 0
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      if (predicate(frame.pixel(x, y))) count += 1
    }
  }
  return count
}

/** 矩形の平均色。ベタ塗りの Shot がどの色で出ているかを見るために使う。 */
export const meanColor = (frame: Frame, rect: Rect): Rgb => {
  let r = 0
  let g = 0
  let b = 0
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const pixel = frame.pixel(x, y)
      r += pixel.r
      g += pixel.g
      b += pixel.b
    }
  }
  const total = rect.width * rect.height
  return { r: r / total, g: g / total, b: b / total }
}
