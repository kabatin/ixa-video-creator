import type { RenderPreset, RenderResult, TimelineDocument, TimelineRenderer } from '@ixa/domain'
import { probeMedia, runFfmpeg } from '@ixa/media'
import { randomUUID } from 'node:crypto'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { buildFfmpegArgs } from './ffmpeg-filters.js'

export type FfmpegRendererOptions = {
  /** MP4 の出力先ディレクトリ。無ければ作る。 */
  readonly outputDir: string
  /** ffmpeg プロセスのタイムアウト。既定 30 分。 */
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * 退避用のレンダラ（ADR-0010 の Alternatives）。**FFmpeg だけで MP4 を作る。**
 *
 * Remotion が使えない状況（ライセンス条件の変化、Chrome を置けない実行環境、
 * バンドルが壊れたときの切り分け）でも、最低限の連結 + 音声ミックスは出せるようにしておく。
 *
 * ### 縮退する内容
 * - `clips` は **content の種別によらず 1 つも描かない**。内訳は次のとおり。
 *   - `media`（VIDEO2 等）: 無視する。重ね合わせ自体は FFmpeg でも書けるが、
 *     クリップ単位の不透明度・レイヤ順を filter_complex で組むと式が破綻しやすい。
 *     退避実装の目的は「Remotion 無しでも最低限の尺と音が出ること」なので、あえて持たない。
 *   - `text` / `motion_graphics`: 無視する。テキスト描画は Remotion（React）の担当であり、
 *     FFmpeg の drawtext でテンプレートを再実装しない（二重実装を作らないため）。
 *   - `unresolved`: **無視する。Remotion 版のような赤いプレースホルダは出ない。**
 *     素材が解決できていないことは、このレンダラの出力からは分からない。
 * - `transitions` は `cut` のみ。dissolve / dip / wipe / whip_pan / glitch はすべて cut になる
 * - モーショングラフィックス・テキストアニメーション・クリップ単位のエフェクトは出せない
 *
 * これらは `render()` の戻り値では表現できない（`RenderResult` に警告の場がない）ため、
 * **`capabilities` で事前に表明する**設計にしている。呼び出し側は capabilities を見て
 * 「このレンダラで足りるか」を判断すること。
 * とくに `unresolved` が黙って消える点は、退避実装を素材の欠落検知に使えないことを意味する。
 */
export const createFfmpegRenderer = (options: FfmpegRendererOptions): TimelineRenderer => ({
  id: 'ffmpeg',
  capabilities: {
    motionGraphics: false,
    textAnimation: false,
    perClipEffects: false,
  },

  async render(
    doc: TimelineDocument,
    preset: RenderPreset,
    onProgress: (progress: number) => void,
  ): Promise<RenderResult> {
    const outputPath = join(options.outputDir, `ffmpeg-${preset}-${randomUUID()}.mp4`)
    const args = buildFfmpegArgs(doc, preset, outputPath)

    // `@ixa/media` の runner は出力をバッファするため、途中経過を取り出せない。
    // 嘘の進捗を刻むより、開始と完了だけを正直に通知する。
    onProgress(0)

    try {
      await mkdir(options.outputDir, { recursive: true })
      await runFfmpeg(args, { timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS })

      const [probe, stats] = await Promise.all([probeMedia(outputPath), stat(outputPath)])
      onProgress(1)

      return {
        storageKey: outputPath,
        durationSec: probe.durationSec ?? doc.durationSec,
        bytes: stats.size,
      }
    } catch (error) {
      throw new Error(
        `FFmpeg のレンダリングに失敗しました (preset=${preset}, output=${outputPath}): ${describe(error)}`,
        { cause: error },
      )
    }
  },
})
