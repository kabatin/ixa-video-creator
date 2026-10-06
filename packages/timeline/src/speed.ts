/**
 * 尺に合わせた速度（ADR-0026）。**正は domain**（`shot/timing.ts`）。
 *
 * ここは今までの import 先を保つための再輸出。プレビュー・書き出し・タイムラインの検査・
 * 自動レビューが同じ関数を読むようにするため、規則そのものは domain に置いてある。
 */
export {
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  shotPlaybackRate,
  TAKE_SHORT_TOLERANCE_SEC,
  takeShortfallSec,
  usableTakeSec,
} from '@ixa/domain'
