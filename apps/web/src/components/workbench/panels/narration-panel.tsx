'use client'

import { useRef, useState } from 'react'
import { readyOr, useAssets } from '@/components/workbench/asset-store'
import { NarrationLineRow } from '@/components/workbench/narration/narration-line-row'
import { NarrationScriptBox } from '@/components/workbench/narration/narration-script-box'
import { NarrationSettings } from '@/components/workbench/narration/narration-settings'
import { useNarration } from '@/components/workbench/narration/use-narration'
import { useSegmentPlayer } from '@/components/workbench/narration/use-segment-player'
import { PanelFrame } from '@/components/workbench/panels/panel-frame'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { Button } from '@/components/ui/button'
import { describeForPerson } from '@/lib/api-error'
import { formatClock } from '@/lib/format-time'
import { retryWhileMeasuring } from '@/lib/narration-import'
import { bulkSpeakSummary, narrationLengthNote } from '@/lib/narration-view'
import { usePlayheadSec } from '@/lib/playhead-sec'

/** 「並べる」の行の間（秒）。 */
const ARRANGE_GAP_SEC = 0.5
/** 録音を上げた後、音の長さを測り終わるまで待つ回数（1 秒ごと）。 */
const MEASURE_ATTEMPTS = 30

const TONE_CLASS = { muted: 'text-muted', warn: 'text-warn', danger: 'text-danger' } as const

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * ナレーション（ADR-0038）。原稿を行に分けて、行ごとに話す声・読み・演出を決め、声にする。
 * 置いた行はタイムラインのナレーションのレーンに出て、テロップが自動で付く。録音を取り込むと文字起こしして行にする。
 */
export const NarrationPanel = () => {
  const workbench = useWorkbench()
  const { voices } = useAssets()
  const { api, overview, apply, bumpNarration } = useNarration()
  const player = useSegmentPlayer()
  const [message, setMessage] = useState<{ readonly text: string; readonly danger: boolean } | null>(null)
  const projectId = workbench.projectId
  const voiceList = readyOr(voices)

  const run = (label: string, action: () => Promise<string | null>): void => {
    setMessage({ text: `${label}…`, danger: false })
    action()
      .then((done) => {
        setMessage(done === null ? null : { text: done, danger: false })
        bumpNarration()
      })
      .catch((cause: unknown) => {
        setMessage({ text: `${label}できませんでした: ${describeForPerson(cause)}`, danger: true })
      })
  }

  const importRecording = (file: File, at: number): void => {
    run('録音を取り込んでいます', async () => {
      const asset = await api.uploadMedia(file, { workspaceId: workbench.project.workspaceId, projectId, kind: 'audio' })
      // 上げた直後は音の長さをまだ測っている。測り終わるまで待って頼み直す。
      await retryWhileMeasuring(() => api.importRecording(projectId, { mediaAssetId: asset.id, voiceProfileId: null, placeAtSec: at }), {
        sleep,
        attempts: MEASURE_ATTEMPTS,
      })
      return `文字起こししています。終わると ${formatClock(at)} から行が並びます。`
    })
  }

  const lines = overview.state === 'ready' ? overview.value.lines : []
  const working = lines.some((line) => line.job?.status === 'queued' || line.job?.status === 'running')
  const length = overview.state === 'ready' ? narrationLengthNote(overview.value.totalEstimatedSec, workbench.project.durationSec) : null

  const toolbar = (
    <>
      {length !== null && <span className={`text-xs ${TONE_CLASS[length.tone]}`}>{length.text}</span>}
      <span className="flex-1" />
      <Button size="sm" disabled={lines.length === 0} onClick={() => run('声にしています', async () => bulkSpeakSummary(await api.speakLines(projectId)))}>
        まとめて声にする
      </Button>
      {working && (
        <Button size="sm" onClick={() => run('止めています', async () => `${String((await api.cancelVoiceJobs(projectId)).cancelledJobIds.length)} 行を止めました。`)}>
          止める
        </Button>
      )}
      <AtPlayhead
        label="再生位置から並べる"
        disabled={lines.length === 0}
        onPress={(at) => {
          run('並べています', async () => {
            apply(await api.arrangeNarrationLines(projectId, { fromSec: at, gapSec: ARRANGE_GAP_SEC }))
            return `${formatClock(at)} から行を順に置きました。`
          })
        }}
      />
      <RecordingButton onFile={(file, at) => importRecording(file, at)} />
    </>
  )

  return (
    <PanelFrame toolbar={toolbar}>
      <div className="space-y-3 p-2">
        {message !== null && (
          <p role={message.danger ? 'alert' : 'status'} className={`text-xs ${message.danger ? 'text-danger' : 'text-muted'}`}>
            {message.text}
          </p>
        )}
        {player.error !== null && (
          <p role="alert" className="text-xs text-danger">
            {player.error}
          </p>
        )}
        {overview.state === 'error' && (
          <p role="alert" className="text-sm text-danger">
            {overview.message}
          </p>
        )}
        {overview.state === 'loading' && <p className="text-sm text-muted">読み込んでいます…</p>}

        {overview.state === 'ready' && (
          <>
            {lines.length === 0 ? (
              <NarrationScriptBox projectId={projectId} voices={voiceList} api={api} apply={apply} />
            ) : (
              <ol className="space-y-2">
                {lines.map((line, index) => (
                  <NarrationLineRow
                    key={line.id}
                    line={line}
                    index={index}
                    voices={voiceList}
                    api={api}
                    apply={apply}
                    reload={bumpNarration}
                    player={player}
                  />
                ))}
              </ol>
            )}
            {lines.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs text-muted">原稿を足す</summary>
                <NarrationScriptBox projectId={projectId} voices={voiceList} api={api} apply={apply} />
              </details>
            )}
          </>
        )}

        <details>
          <summary className="cursor-pointer text-xs text-muted">読み辞書・BGM を下げる・話している字の強調</summary>
          <NarrationSettings projectId={projectId} api={api} onSaved={bumpNarration} />
        </details>
      </div>
    </PanelFrame>
  )
}

/**
 * 再生位置を使うボタン。**再生位置は毎コマ変わるので、読むのは末端のこの部品だけ**（`playhead-sec.ts`）。
 * パネル全体で読むと、再生中にパネルが毎コマ描き直される。
 */
const AtPlayhead = ({ label, disabled = false, onPress }: { readonly label: string; readonly disabled?: boolean; readonly onPress: (atSec: number) => void }) => {
  const playheadSec = usePlayheadSec()
  return (
    <Button
      size="sm"
      disabled={disabled}
      onClick={() => {
        onPress(playheadSec)
      }}
    >
      {label}
    </Button>
  )
}

/** 録音のファイルを選ぶ。選んだときの再生位置に置く。 */
const RecordingButton = ({ onFile }: { readonly onFile: (file: File, atSec: number) => void }) => {
  const playheadSec = usePlayheadSec()
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          input.current?.click()
        }}
      >
        録音を取り込む
      </Button>
      <input
        ref={input}
        type="file"
        accept="audio/*"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file !== undefined) onFile(file, playheadSec)
        }}
      />
    </>
  )
}
