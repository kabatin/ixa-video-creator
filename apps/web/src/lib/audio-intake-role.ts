/**
 * 落とした音を楽曲にするか効果音にするか（制作者 2026-10-19）。**React を含まない。**
 *
 * 取り込む前に 1 回だけ聞く。その初めの選びをここで決める。何本かまとめて落としたら 1 回で選ぶ。
 */

export type AudioRole = 'music' | 'sfx'

/** これ以下の長さ（秒）なら、初めから効果音を選んでおく。 */
export const SFX_DEFAULT_MAX_SEC = 10

/**
 * 全部が短い音なら効果音、そうでなければ楽曲。長さを読めなかった音（null）は長い音とみなす
 * （いままで音は全部楽曲にしていたので、分からないときはそちらに倒す）。
 */
export const defaultAudioRole = (durationsSec: readonly (number | null)[]): AudioRole =>
  durationsSec.length > 0 && durationsSec.every((sec) => sec !== null && sec <= SFX_DEFAULT_MAX_SEC)
    ? 'sfx'
    : 'music'
