import type { WorkbenchContextValue } from '@/components/workbench/workbench-context'

/**
 * 作業の場所へ行く口。メニューと流れの帯（制作者 2026-10-01）が同じ動きをする（書き写さない）。
 */

export const NO_TRACK_NOTICE =
  '楽曲がまだありません。音声ファイルを画面に落とすか、素材ツリーの「＋」から登録します。'

type Navigable = Pick<
  WorkbenchContextValue,
  'track' | 'inspect' | 'openViewer' | 'focusPanel' | 'projectId'
>

/** 楽曲（マスター）を見る。まだ無ければ、登録のしかたを言って素材ツリーへ。 */
export const goToMasterTrack = (workbench: Navigable, notify: (message: string) => void): void => {
  if (workbench.track === null) {
    notify(NO_TRACK_NOTICE)
    workbench.focusPanel('assets')
    return
  }
  workbench.inspect({ kind: 'track', id: workbench.track.id })
  workbench.openViewer()
}

/** 作品の方針（コンセプト・ルック・避けたいもの・手本画像・歌詞）を開く。 */
export const goToProjectConcept = (workbench: Navigable): void => {
  workbench.inspect({ kind: 'project', id: workbench.projectId })
  workbench.focusPanel('inspector')
}

/**
 * 歌詞に時刻を付ける（聴きながら切るの「歌詞を合わせる」）。時刻が付いたらそこでテロップにする
 * （制作者 2026-10-02「歌詞の自動テロップってどこからやるんだっけ」）。
 */
export const goToLyricSync = (workbench: Pick<WorkbenchContextValue, 'openCutter'>): void => {
  workbench.openCutter('lyrics')
}
