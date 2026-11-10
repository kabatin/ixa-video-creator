import type { WorkbenchContextValue } from '@/components/workbench/workbench-context'

/**
 * 作業の場所へ行く口。メニューと流れの帯（制作者 2026-10-01）が同じ動きをする（書き写さない）。
 */

type Navigable = Pick<
  WorkbenchContextValue,
  'track' | 'inspect' | 'openViewer' | 'focusPanel' | 'projectId' | 'openCutter'
>

/**
 * 楽曲（マスター）を見る。まだ無ければ聴きながら切るを開く。そこに「楽曲を登録」と「曲を作る…」がある
 * （`MusicGate`）。以前は素材ツリーへ行かせ、登録のしかたを文で言うだけだった。
 */
export const goToMasterTrack = (workbench: Navigable): void => {
  if (workbench.track === null) {
    workbench.openCutter('cut')
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
