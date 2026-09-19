'use client'

import type { Location, MusicTrack, Project, ProjectId, Sequence, Shot, ShotId } from '@ixa/domain'
import { createContext, useContext } from 'react'
import type { UpdateShotBody } from '@/lib/api-schemas'
import type { WireMusicAnalysis } from '@/lib/music-api'
import type { WorkbenchDialog } from '@/lib/menu-model'
import type { LiveState } from '@/lib/project-events'
import type { SeekCommand } from '@/lib/program-monitor'
import type { ShotSelection } from '@/lib/shot-bulk'
import type { ShotPosterMap } from '@/lib/shot-posters'
import type { PanelId } from '@/lib/workbench-layout'
import type { Inspected } from '@/lib/workbench-selection'

/**
 * ワークベンチの共有状態（UI-WORKBENCH §7.2 / ADR-0021 D5）。
 *
 * **共有するのは「Shot 一覧・選択中の Shot・再生位置」だけ。** それ以外（Take・比較・
 * タイムライン文書・履歴の中身・下書き）は各パネルが自分で取る。
 * 共有を増やすほど一体化が難しくなる。
 *
 * Shot の更新は**必ずここの関数経由**。パネルが勝手に一覧を書き換えない。
 */

/** 再生位置（7.2）。聴きながら切る / プレビュー / タイムラインが同じ値を見る。 */
export type WorkbenchTransport = {
  readonly currentSec: number
  readonly playing: boolean
  /** 目盛りなどで明示的に飛んだ指示。`serial` が変わったときだけ再生器が飛ぶ（`program-monitor.ts`）。 */
  readonly seek: SeekCommand | null
  /** 最後に再生を始めた場所。**同時に鳴るのは 1 つだけ**にするため、他は自分を止める。 */
  readonly owner: TransportOwner | null
}

export type TransportOwner = 'cutter' | 'monitor'

export type WorkbenchLive = {
  readonly state: LiveState
  readonly lastEventAt: string | null
  readonly attempt: number
  readonly invalidCount: number
  /** 開いてから出来事で知った、新しい Take の数。 */
  readonly newTakeCount: number
}

export type WorkbenchContextValue = {
  // --- 読むだけの材料（サーバが一度に読んだもの） ---
  readonly project: Project
  readonly projectId: ProjectId
  readonly track: MusicTrack | null
  readonly analysis: WireMusicAnalysis | null
  /** 楽曲の読み込み自体に成功したか。false なら「楽曲なし」と言わない（L-015）。 */
  readonly musicLoaded: boolean
  readonly sequences: readonly Sequence[]
  /** null は「読めていない」。空配列は「未登録」。 */
  readonly locations: readonly Location[] | null
  readonly loadErrors: readonly string[]

  // --- 共有状態 ---
  /** null は「読めていない」。0 件の Project とは別物（L-015）。 */
  readonly shots: readonly Shot[] | null
  readonly posters: ShotPosterMap
  readonly posterError: string | null
  /** サムネイルを引き直すたびに進む。Take ができたら絵が変わる。 */
  readonly posterEpoch: number
  /**
   * サーバから材料を読み直すたびに進む（`router.refresh()` のあと）。
   * タイムライン文書など、パネルが自分で取る材料の取り直しの合図にする。
   */
  readonly serverEpoch: number
  readonly selectedShotId: ShotId | null
  /** Shot を選ぶ。インスペクターもその Shot を見る。 */
  readonly selectShot: (shotId: ShotId) => void
  /**
   * インスペクターが見ている物（PHASE 8.2）。Shot を選べば Shot、素材を選べば素材。
   * **Shot の選択（selectedShotId）は素材を選んでも外さない**（ストーリーボードの強調は残る）。
   */
  readonly inspected: Inspected | null
  readonly inspect: (selection: Inspected | null) => void
  /** 一覧でチェックした Shot（一括操作の対象）。メニューの有効判定にも使う。 */
  readonly checked: ShotSelection
  readonly setChecked: (next: ShotSelection) => void
  readonly transport: WorkbenchTransport
  readonly transportControls: TransportControls
  readonly live: WorkbenchLive

  // --- Shot を変える口（ここ以外で一覧を書き換えない） ---
  readonly saveShot: (shotId: ShotId, patch: ShotPatch) => Promise<Shot>
  readonly replaceShots: (updated: readonly Shot[]) => void
  readonly applyAdoptedShots: (
    adopted: readonly Pick<Shot, 'id' | 'description' | 'mood'>[],
  ) => void
  /** サーバの材料を読み直す（`router.refresh()`）。一覧の正はサーバ。 */
  readonly refresh: () => void

  // --- 画面の操作 ---
  readonly dialog: WorkbenchDialog | null
  readonly openDialog: (dialog: WorkbenchDialog) => void
  readonly closeDialog: () => void
  readonly focusPanel: (panel: PanelId) => void
  /** インスペクターのどのタブを前に出すか。メニュー「生成」から生成タブを開くのに使う。 */
  readonly inspectorTab: InspectorTab
  readonly openInspector: (tab: InspectorTab) => void
  /** 画面上端の知らせ（1 行）。操作の結果や、取り込めなかった理由を出す。 */
  readonly notice: string | null
  readonly notify: (message: string | null) => void
  /** 中央上の素材ビューアを前に出す（PHASE 8.2）。 */
  readonly openViewer: () => void
}

export type ShotPatch = UpdateShotBody

export const INSPECTOR_TABS = ['settings', 'generate', 'review'] as const
export type InspectorTab = (typeof INSPECTOR_TABS)[number]

export type TransportControls = {
  readonly setCurrentSec: (sec: number) => void
  /** 明示的に飛ぶ。再生器はこれを見て位置を合わせる。 */
  readonly seekTo: (sec: number) => void
  readonly play: (owner: TransportOwner) => void
  readonly pause: () => void
  readonly toggle: (owner: TransportOwner) => void
}

export const WorkbenchContext = createContext<WorkbenchContextValue | null>(null)

export const useWorkbench = (): WorkbenchContextValue => {
  const value = useContext(WorkbenchContext)
  if (value === null) throw new Error('ワークベンチのパネルが WorkbenchProvider の外にあります')
  return value
}

/** 選択中の Shot。一覧が読めていない・未選択なら null。 */
export const useSelectedShot = (): Shot | null => {
  const { shots, selectedShotId } = useWorkbench()
  if (shots === null || selectedShotId === null) return null
  return shots.find((shot) => shot.id === selectedShotId) ?? null
}
