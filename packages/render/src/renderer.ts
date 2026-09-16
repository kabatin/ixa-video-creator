import type { RenderPreset, RenderResult, TimelineDocument, TimelineRenderer } from '@ixa/domain'
import { probeMedia } from '@ixa/media'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { randomUUID } from 'node:crypto'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { bundleTimelineComposition } from './bundle-cache.js'
import { TIMELINE_COMPOSITION_ID } from './composition-id.js'
import type { TimelineCompositionProps } from './compositions/Timeline.js'
import { PRESET_SETTINGS, presetResolution } from './presets.js'

export type RemotionRendererOptions = {
  /** MP4 の出力先ディレクトリ。無ければ作る。 */
  readonly outputDir: string
  /** 並列レンダリング数。既定は null（Remotion に CPU 数から決めさせる）。 */
  readonly concurrency?: number
  /** 1 フレームあたりではなくレンダリング全体のタイムアウト。既定 30 分。 */
  readonly timeoutMs?: number
}

/** 長尺・高解像度でも打ち切られないよう既定を長めに取る。 */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

/**
 * Remotion の `audioBitrate` はテンプレートリテラル型で "192k" 形式しか受け付けない。
 * `PresetSettings.audioBitrate` は素の string なので、境界で検証して型を絞る（CLAUDE.md 規約 4）。
 */
const RemotionAudioBitrate = z.custom<`${number}k` | `${number}K` | `${number}M`>(
  (value) => typeof value === 'string' && /^\d+(?:k|K|M)$/.test(value),
  { message: 'audioBitrate は "192k" のような形式であること' },
)

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const outputPathFor = (outputDir: string, preset: RenderPreset): string =>
  join(outputDir, `render-${preset}-${randomUUID()}.mp4`)

/**
 * 実際に書き出したファイルを ffprobe で測る。
 * コンポジションのフレーム数から割り算しても「書き出した結果」の保証にはならないため。
 */
const measureOutput = async (
  outputPath: string,
  fallbackDurationSec: number,
): Promise<{ durationSec: number; bytes: number }> => {
  const [probe, stats] = await Promise.all([probeMedia(outputPath), stat(outputPath)])
  return {
    durationSec: probe.durationSec ?? fallbackDurationSec,
    bytes: stats.size,
  }
}

/**
 * Remotion による既定のレンダラ（ADR-0010）。
 *
 * `TimelineDocument` をそのまま `inputProps` に渡す。プレビュー（`@remotion/player`）と
 * 同じコンポジションを同じ props で描くので、書き出しとプレビューが構造的に一致する。
 *
 * 出力解像度は **プリセットを優先**し、映像はアスペクト比を保って収める
 * （`presets.ts` の `letterboxFit` のコメント参照）。
 *
 * `RenderResult.storageKey` には **ローカルの出力ファイルパス**を返す。
 * このパッケージはストレージに依存しない（アップロードと MediaAsset 登録は呼び出し側の責務）。
 */
export const createRemotionRenderer = (options: RemotionRendererOptions): TimelineRenderer => ({
  id: 'remotion',
  /**
   * **事実を書く。** ここは `RenderResult` に警告の置き場が無いぶんの唯一の申告口なので、
   * できないことを true にすると誰も気づけない（ADR-0010）。
   *
   * text / motion_graphics のクリップは、いまはテンプレート名を書いた
   * プレースホルダが出るだけでテンプレート機構が無い。だから false。
   * opacity と layer は実際に効くので perClipEffects だけ true。
   */
  capabilities: {
    motionGraphics: false,
    textAnimation: false,
    perClipEffects: true,
  },

  async render(
    doc: TimelineDocument,
    preset: RenderPreset,
    onProgress: (progress: number) => void,
  ): Promise<RenderResult> {
    const settings = PRESET_SETTINGS[preset]
    const outputPath = outputPathFor(options.outputDir, preset)
    const inputProps: TimelineCompositionProps = {
      doc,
      canvas: presetResolution(preset),
    }

    onProgress(0)

    try {
      await mkdir(options.outputDir, { recursive: true })
      const serveUrl = await bundleTimelineComposition()

      const composition = await selectComposition({
        serveUrl,
        id: TIMELINE_COMPOSITION_ID,
        inputProps,
      })

      await renderMedia({
        composition,
        serveUrl,
        codec: settings.codec,
        outputLocation: outputPath,
        inputProps,
        crf: settings.crf,
        pixelFormat: settings.pixelFormat,
        audioBitrate: RemotionAudioBitrate.parse(settings.audioBitrate),
        concurrency: options.concurrency ?? null,
        timeoutInMilliseconds: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        onProgress: ({ progress }) => {
          onProgress(progress)
        },
      })

      const measured = await measureOutput(outputPath, doc.durationSec)
      onProgress(1)

      return {
        storageKey: outputPath,
        durationSec: measured.durationSec,
        bytes: measured.bytes,
      }
    } catch (error) {
      throw new Error(
        `Remotion のレンダリングに失敗しました (preset=${preset}, output=${outputPath}): ${describe(error)}`,
        { cause: error },
      )
    }
  },
})
