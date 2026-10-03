'use client'

import { useEffect } from 'react'
import { CutEditor } from '@/components/cut-editor'
import { usePreferences } from '@/components/preferences-root'
import { useTransport, useWorkbench, type CutterMode } from '@/components/workbench/workbench-context'
import { MusicGate } from '@/components/workbench/panels/music-gate'
import { PanelFrame } from '@/components/workbench/panels/panel-frame'
import { TransportButtons } from '@/components/workbench/transport-buttons'
import { LyricSyncSection } from '@/components/workbench/panels/lyric-sync-section'

/** 区切る か、歌詞を合わせる（ADR-0033）。どちらも同じ波形と再生を使う。モードはワークベンチが持つ（作品の方針から開くため）。 */
const MODES: readonly { readonly mode: CutterMode; readonly label: string }[] = [
  { mode: 'cut', label: '区切る' },
  { mode: 'lyrics', label: '歌詞を合わせる' },
]

/**
 * 聴きながら切る（中央下）。中身は既存の `cut-editor`。
 *
 * - 打鍵を受けるのは**見えている間だけ**（`visible`）。裏のタブが Space を横取りしない（L-018）
 * - 再生位置はワークベンチと共有する。鳴らし始めたらプレビューは止まる（UI-WORKBENCH §7.2）
 */
export const CutterPanel = ({ visible }: { readonly visible: boolean }) => {
  const workbench = useWorkbench()
  const { preferences } = usePreferences()
  const { transportControls } = workbench
  const transport = useTransport()
  const mode = workbench.cutterMode
  /** 打鍵を受けるのは見えていて、ダイアログが無い間だけ。どちらが受けるかは選んでいる方。 */
  const keys = visible && workbench.dialog === null

  // 操作列に名乗る。**依存は registerPlayer だけ**（preview-panel に理由を書いた）。
  const { registerPlayer } = transportControls
  useEffect(() => (visible ? registerPlayer('cutter') : undefined), [registerPlayer, visible])

  return (
    <PanelFrame
      toolbar={
        // 押している側を塗る（タイムラインのズームと同じ見た目）。小さな文字だけだとタブに見えなかった（制作者 2026-10-02）。
        <div role="group" aria-label="聴きながら何をするか" className="flex gap-1">
          {MODES.map((entry) => (
            <button
              key={entry.mode}
              type="button"
              aria-pressed={mode === entry.mode}
              onClick={() => {
                workbench.openCutter(entry.mode)
              }}
              className={`h-6 rounded-md px-2.5 text-xs ring-1 ${
                mode === entry.mode
                  ? 'bg-accent font-semibold text-accent-fg ring-accent'
                  : 'bg-surface text-text ring-line-strong hover:bg-surface-2'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      }
    >
      <MusicGate>
        {({ track, analysis }) => {
          const editor = (purpose: CutterMode, lyricCues: readonly number[] = []) => (
            <CutEditor
              projectId={workbench.projectId}
              track={track}
              analysis={analysis}
              initialSnapEnabled={preferences.playback.snapToBeat}
              // 歌詞を合わせている間は Enter・Backspace を歌詞が受ける（区切りを置かない）。
              keyboardShortcuts={keys && purpose === 'cut'}
              // 区切るモードが見えている間は、波形の外を押していても Enter で区切りを置く（制作者 2026-10-03）。
              placeKeyAnywhere={keys && purpose === 'cut'}
              onNeedLyrics={() => {
                workbench.openCutter('lyrics')
              }}
              purpose={purpose}
              lyricCues={lyricCues}
              // プレビューの下と同じ操作列。波形の直下に置くので、押せばこのパネルが鳴るのは場所で分かる
              // （2026-09-28、制作者の提案で両方に置く）。見た目も「いま何か鳴っているか」の読み方も揃える。
              playButton={<TransportButtons owner="cutter" durationSec={analysis.durationSec} />}
              sync={{
                othersPlaying: transport.playing && transport.owner !== 'cutter',
                seek: transport.seek,
                onPosition: transportControls.setCurrentSec,
                // 波形・スライダーで飛んだら、鳴っているのがプレビューでもそこへ飛ぶ。
                onSeek: transportControls.seekTo,
                onPlayingChange: (playing) => {
                  if (playing) transportControls.play('cutter')
                  else if (transport.owner === 'cutter') transportControls.pause()
                },
                // 操作列のボタンで鳴らせるようにする。自分が持ち主のときだけ従う。
                commandPlaying: transport.owner === 'cutter' ? transport.playing : null,
                /**
                 * 自分が鳴らしていない間も、波形の再生位置は共有の位置へ付いていく。
                 * 付いていかないと、プレビューが鳴っている間だけ波形の線が止まり、
                 * 絵と波形で別の場所を指すことになる（モニター側で直したのと同じ食い違い）。
                 */
                followSec: transport.owner === 'cutter' ? null : transport.currentSec,
              }}
            />
          )
          // 歌詞は 案内とボタン → 再生と波形（打った所に印）→ フレーズの一覧 の順。区切りの道具は出さない。
          // **どちらのモードでも同じ入れ物に包む。** 包み方が替わると波形の部品が作り直され、
          // まだ Shot にしていない区切りと再生の状態が消える。
          return (
            <LyricSyncSection track={track} analysis={analysis} keyboard={keys} active={mode === 'lyrics'}>
              {(cues) => editor(mode, cues)}
            </LyricSyncSection>
          )
        }}
      </MusicGate>
    </PanelFrame>
  )
}
