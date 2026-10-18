import { describeForPerson } from '@/lib/api-error'

/** 一覧の読み込みの状態（`asset-store.tsx` の `Loaded` と同じ形）。 */
export type SettledLoad<T> =
  | { readonly state: 'ready'; readonly value: T }
  | { readonly state: 'error'; readonly message: string }

/**
 * まとめて読み直した一覧の 1 つぶん（`Promise.allSettled` の結果）を、画面の状態にする（2026-10-19）。
 * **1 つ読めなくても他は反映し、読めなかった一覧は理由を出す**（黙って古いまま残さない・L-015）。
 * 言い方は最初に読むとき（`useLoadedList`）と同じ。
 */
export const loadedFromSettled = <T>(label: string, result: PromiseSettledResult<T>): SettledLoad<T> =>
  result.status === 'fulfilled'
    ? { state: 'ready', value: result.value }
    : { state: 'error', message: `${label}を読み込めませんでした: ${describeForPerson(result.reason)}` }
