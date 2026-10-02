import type { Shot } from '@ixa/domain'

/**
 * 組み立て結果（TimelineDocument）に効く Shot の値を 1 本の文字列にする。プレビューとタイムラインはこれが変わったら読み直す
 * （制作者 2026-10-02「CUT1の尺をCUT2に繋がるように伸ばしたんだけど、動画が伸ばされていないように見受けられる」）。
 *
 * 読み直す合図が「生成の完了」と「画面の読み直し」しか無く、インスペクターで尺を変えても前の組み立て結果を映し続けていた。
 * 説明・雰囲気のような組み立てに効かない欄では変えない（打つたびに読み直さない）。読めていなければ空。
 */
export const timelineShotsKey = (shots: readonly Shot[] | null): string =>
  shots === null
    ? ''
    : shots
        .map((shot) =>
          [shot.id, shot.startSec, shot.durationSec, shot.timing, shot.sourceInSec, shot.selectedTakeId ?? '-'].join(':'),
        )
        .join('|')
