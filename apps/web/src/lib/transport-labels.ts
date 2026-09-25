import type { TransportOwner } from '@/components/workbench/workbench-context'

/**
 * 鳴らしている場所の呼び名。**パネルのタブと同じ言葉にする。**
 *
 * 以前はステータスバーの中に直接書いてあり、プレビュー側が「誰が鳴らしているか」を
 * 出そうとしたときに 2 つ目が生まれかけた。書き写すと必ずズレるので 1 箇所に置く。
 */
export const TRANSPORT_OWNER_LABELS: Readonly<Record<TransportOwner, string>> = Object.freeze({
  cutter: '聴きながら切る',
  monitor: 'プレビュー',
  compare: 'Take 比較',
})
