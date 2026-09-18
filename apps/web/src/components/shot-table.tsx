'use client'

import type { Shot } from '@ixa/domain'
import { useEffect, useRef } from 'react'
import { ShotRow } from '@/components/shot-row'
import type { HeaderCheckboxState } from '@/lib/shot-bulk'

/**
 * 見出しと中身を合わせる。2 列目は開始時刻と尺の両方を出すので「尺」では嘘になる。
 * 以前は「尺」の下に開始時刻が並んでいて、読み手は開始秒を尺だと読んだ。
 */
const HEADERS: readonly string[] = ['コード', '時間', '説明 / mood', 'カメラ', '状態', '']

export type ShotTableProps = {
  readonly shots: readonly Shot[]
  readonly isSelected: (shot: Shot) => boolean
  readonly headerState: HeaderCheckboxState
  readonly busy: boolean
  readonly onToggle: (shot: Shot) => void
  /** 見出しのチェックボックス。全選択と全解除を切り替える。 */
  readonly onToggleAll: () => void
  readonly onSaveDescription: (shot: Shot, next: string) => Promise<void>
  readonly onSaveMood: (shot: Shot, next: string) => Promise<void>
}

export const ShotTable = ({
  shots,
  isSelected,
  headerState,
  busy,
  onToggle,
  onToggleAll,
  onSaveDescription,
  onSaveMood,
}: ShotTableProps) => {
  const headerRef = useRef<HTMLInputElement>(null)

  /** 一部だけ選ばれている状態は属性では書けない。DOM のプロパティで出す。 */
  useEffect(() => {
    if (headerRef.current) headerRef.current.indeterminate = headerState === 'partial'
  }, [headerState])

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full border-collapse text-left">
        <caption className="sr-only">Shot 一覧</caption>
        <thead className="bg-slate-50">
          <tr>
            <th scope="col" className="px-3 py-3">
              <input
                ref={headerRef}
                type="checkbox"
                checked={headerState === 'all'}
                disabled={busy || shots.length === 0}
                aria-label={
                  headerState === 'all' ? 'すべての選択を解除' : '表示中の Shot をすべて選択'
                }
                onChange={onToggleAll}
                className="h-4 w-4 rounded border-slate-400"
              />
            </th>
            {HEADERS.map((header, index) => (
              <th
                key={header === '' ? `actions-${String(index)}` : header}
                scope="col"
                className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shots.map((shot) => (
            <ShotRow
              key={shot.id}
              shot={shot}
              selected={isSelected(shot)}
              busy={busy}
              onToggle={onToggle}
              onSaveDescription={onSaveDescription}
              onSaveMood={onSaveMood}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
