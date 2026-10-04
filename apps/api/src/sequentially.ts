/** 順に 1 件ずつ待つ（並べて投げない）。結果は入力と同じ順。 */
export const sequentially = <T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> =>
  items.reduce<Promise<R[]>>(async (done, item) => [...(await done), await run(item)], Promise.resolve([]))
