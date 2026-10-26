'use client'

import { dubRecordOf, type DubParams, type Shot, type Take } from '@ixa/domain'
import { Button } from '@/components/ui/button'
import type { ShotDub } from '@/components/workbench/use-shot-dub'
import { dubProgressLabel, dubResultRows, isDubActive } from '@/lib/dub-view'

/**
 * 声を差し替える（ADR-0062）。採用中の Take の声を、キャラクターの「セリフの声」で読み直した**新しい Take** を作る。
 * 押せないときは理由を出す（理由はサーバが domain の `dubBlocker` で決めたもの）。
 * 結果の表は、採用中の Take が差し替えた Take ならその記録、そうでなければ最後に成功した差し替えの記録。
 */
export const ShotDubSection = ({
  shot,
  dub,
  takes,
}: {
  readonly shot: Pick<Shot, 'selectedTakeId' | 'dialogue'>
  readonly dub: ShotDub
  readonly takes: readonly Take[] | null
}) => {
  const job = dub.state?.latestJob ?? null
  const active = isDubActive(job)
  const blocker = active ? null : (dub.state?.blocker ?? null)
  const adopted = takes?.find((take) => take.id === shot.selectedTakeId) ?? null
  const record: DubParams | null = (adopted === null ? null : dubRecordOf(adopted)) ?? (job?.status === 'succeeded' ? job.record : null)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={dub.state === null || blocker !== null || active || dub.busy} onClick={dub.start}>
          声を差し替える
        </Button>
        {active && job !== null && (
          <>
            <span role="status" className="text-xs text-muted">
              {dubProgressLabel(job)}
            </span>
            <Button size="sm" disabled={dub.busy} onClick={dub.cancel}>
              取り消し
            </Button>
          </>
        )}
      </div>
      {blocker !== null && <p className="text-xs text-muted">{blocker}</p>}
      {!active && job?.status === 'failed' && job.error !== null && (
        <p role="alert" className="text-xs text-danger">
          差し替えられませんでした: {job.error.message}
        </p>
      )}
      {dub.error !== null && (
        <p role="alert" className="text-xs text-danger">
          {dub.error}
        </p>
      )}
      {record !== null && <DubResultTable record={record} dialogue={shot.dialogue} />}
      <p className="text-xs text-muted">
        元の Take は残ります。差し替えた Take を自動で採用するので、戻すときは Take を選び直します。
      </p>
    </div>
  )
}

const DubResultTable = ({ record, dialogue }: { readonly record: DubParams; readonly dialogue: Shot['dialogue'] }) => {
  const rows = dubResultRows(record, dialogue)
  return (
    <table className="w-full text-xs" aria-label="差し替えの結果">
      <thead>
        <tr className="text-left text-muted">
          <th className="font-normal">行</th>
          <th className="font-normal">一致率</th>
          <th className="font-normal">伸縮の幅</th>
          <th className="font-normal">警告</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.lineNo} className="align-top">
            <td className="pr-1">
              <span className="text-text">{row.lineNo}</span>
              <span className="ml-1 text-muted">{row.mode}</span>
            </td>
            <td className="pr-1 text-text">{row.agreement}</td>
            <td className={`pr-1 ${row.fast ? 'text-warn' : 'text-text'}`}>{row.tempo}</td>
            <td className={row.fast ? 'text-warn' : 'text-muted'}>
              {row.warnings.length === 0 ? '—' : row.warnings.map((message) => <p key={message}>{message}</p>)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
