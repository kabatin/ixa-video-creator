import type { Shot } from '@ixa/domain'
import { ShotRow } from '@/components/shot-row'

export type ShotTableProps = {
  readonly shots: readonly Shot[]
}

/**
 * 見出しと中身を合わせる。2 列目は開始時刻と尺の両方を出すので「尺」では嘘になる。
 * 以前は「尺」の下に開始時刻が並んでいて、読み手は開始秒を尺だと読んだ。
 */
const HEADERS: readonly string[] = ['コード', '時間', '説明', 'カメラ', '状態', '']

export const ShotTable = ({ shots }: ShotTableProps) => (
  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
    <table className="min-w-full border-collapse text-left">
      <caption className="sr-only">Shot 一覧</caption>
      <thead className="bg-slate-50">
        <tr>
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
          <ShotRow key={shot.id} shot={shot} />
        ))}
      </tbody>
    </table>
  </div>
)
