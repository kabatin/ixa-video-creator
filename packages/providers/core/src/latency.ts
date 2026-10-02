import type { ModelEconomics } from './capabilities.js'

/**
 * この 1 本を作るのにかかる時間の目安（秒）（制作者 2026-10-02「5秒ぐらいの動画で7分だからそれから計算する必要がありそう」）。
 *
 * 尺 1 秒あたりの時間を持つモデル（手元の GPU で作る vpipe など）は、作る尺から見積もる。
 * 持たないモデル・尺が分からないときは、モデルの一律の目安（`typicalLatencySec`）を返す。
 * ルーターの順位付けは今も一律の目安を使う（モデル同士を比べる 1 つの数）。
 */
export const estimateLatencySec = (economics: ModelEconomics, outputSec: number | null): number =>
  economics.latencySecPerOutputSec === undefined || outputSec === null
    ? economics.typicalLatencySec
    : economics.latencySecPerOutputSec * outputSec
