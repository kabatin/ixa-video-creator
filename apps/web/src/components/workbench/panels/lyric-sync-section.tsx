'use client'

import type { MusicTrack } from '@ixa/domain'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LyricCueList, LyricSync } from '@/components/lyric-sync'
import { usePreferences } from '@/components/preferences-root'
import { useContextMenuHost } from '@/components/workbench/ui/context-menu'
import { useTransport, useWorkbench } from '@/components/workbench/workbench-context'
import { goToProjectConcept } from '@/components/workbench/workbench-navigation'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { describePlacedLyrics } from '@/lib/lyric-clips-api'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { DEFAULT_PX_PER_SEC } from '@/lib/timeline-display'
import { beatSourceOf, buildSnapCandidates, snapPoint, snapToleranceSec } from '@/lib/timeline-snap'

const PLACE_TELOPS_CONFIRM =
  '時刻の付いたフレーズを、TEXT 帯の歌詞の段にテロップとして置きます。前に歌詞から置いたテロップは置き直します（手で置いたテロップは残ります）。'

const sameCues = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((cue, index) => cue === b[index])

/**
 * 「聴きながら切る」の「歌詞を合わせる」（ADR-0033）。部品（`LyricSync`）をワークベンチへ繋ぐ。
 *
 * - 押した時刻は拍へ寄せる（区切りと同じ候補・環境設定の入切。規則は `timeline-snap`）
 * - 打つたびに作品へ保存する（前の保存を待ってから次を送る。順が入れ替わらない）
 * - 離れるときにサーバを読み直す（作品の方針の「時刻は n フレーズまで」と帯が追いつく）
 * - 並びは 案内とボタン → 再生と波形（`children`。打った時刻を印に出す）→ フレーズの一覧
 * - **区切っている間も外さない**（`active` が false なら波形だけ描く）。波形の部品が同じ場所に居続けるので、
 *   モードを替えても、まだ Shot にしていない区切りと再生の状態が消えない
 */
export const LyricSyncSection = ({
  track,
  analysis,
  keyboard,
  active,
  children,
}: {
  readonly track: MusicTrack
  readonly analysis: WireMusicAnalysis
  readonly keyboard: boolean
  /** 歌詞を合わせているか。false なら案内・ボタン・一覧を出さず、打鍵も受けない。 */
  readonly active: boolean
  /** 再生と波形。いまの時刻（保存を待たない手元の値）を受けて印を出す。 */
  readonly children: (cues: readonly number[]) => ReactNode
}) => {
  const workbench = useWorkbench()
  const transport = useTransport()
  const host = useContextMenuHost()
  const { preferences } = usePreferences()
  const client = useMemo(() => createApiClient(), [])
  const { project, transportControls } = workbench

  // サーバの値が変わったら（読み直し）追いつく。描画中に比べる（effect で写すと 1 コマ古い値が出る）。
  const [cues, setCues] = useState<readonly number[]>(project.lyricCues)
  const [shown, setShown] = useState<readonly number[]>(project.lyricCues)
  if (!sameCues(shown, project.lyricCues)) {
    setShown(project.lyricCues)
    setCues(project.lyricCues)
  }
  const [error, setError] = useState<string | null>(null)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const dirty = useRef(false)

  // 離れるとき（区切るへ替えた・パネルを閉じた）に読み直す（保存は済んでいる。手元に古い作品が残らないように）。
  const { refresh } = workbench
  useEffect(() => {
    if (active || !dirty.current) return
    dirty.current = false
    refresh()
  }, [active, refresh])
  useEffect(
    () => () => {
      if (dirty.current) refresh()
    },
    [refresh],
  )

  const candidates = useMemo(
    () =>
      buildSnapCandidates(
        { shots: [], clips: [], beatSource: beatSourceOf(track, analysis), timelineEndSec: analysis.durationSec },
        {},
      ),
    [track, analysis],
  )
  const toleranceSec = snapToleranceSec(DEFAULT_PX_PER_SEC)

  const change = (next: readonly number[]): void => {
    setCues(next)
    setError(null)
    dirty.current = true
    saving.current = saving.current
      .then(async () => {
        await client.updateProject(project.id, { lyricCues: [...next] })
      })
      .catch((cause: unknown) => {
        setError(`歌詞の時刻を保存できませんでした: ${describeForPerson(cause)}`)
      })
  }

  const placeTelops = (): void => {
    host.perform({
      kind: 'item',
      id: 'place-lyric-telops',
      label: '歌詞をテロップにする',
      disabledReason: null,
      confirm: PLACE_TELOPS_CONFIRM,
      run: async () => {
        await saving.current
        const placed = await client.placeLyricClips(project.id)
        workbench.notify(describePlacedLyrics(placed))
        workbench.refresh()
      },
    })
  }

  // 波形（children）は常に同じ場所に描く。前後の案内と一覧だけを出し入れする。
  return (
    <>
      {active && (
        <>
          <LyricSync
            lyrics={project.lyrics}
            cues={cues}
            onCuesChange={change}
            currentSec={transport.currentSec}
            onTogglePlay={() => {
              if (transport.playing && transport.owner === 'cutter') transportControls.pause()
              else transportControls.play('cutter')
            }}
            snapAt={(sec) =>
              snapPoint('歌い出し', sec, candidates, toleranceSec, preferences.playback.snapToBeat).atSec
            }
            onPlaceTelops={placeTelops}
        {...((workbench.shots ?? []).length > 0
          ? {
              onAlignShots: () => {
                workbench.openDialog('align-lyrics')
              },
            }
          : {})}
            onOpenConcept={() => {
              goToProjectConcept(workbench)
            }}
            keyboard={keyboard}
          />
          {error !== null && (
            <p role="alert" className="px-3 py-1 text-xs text-danger">
              {error}
            </p>
          )}
        </>
      )}
      {children(cues)}
      {active && (
        <LyricCueList
          lyrics={project.lyrics}
          cues={cues}
          currentSec={transport.currentSec}
          onSeek={transportControls.seekTo}
        />
      )}
    </>
  )
}
