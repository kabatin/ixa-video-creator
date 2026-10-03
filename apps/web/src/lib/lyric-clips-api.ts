import type { ProjectId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 歌詞をテロップにする（ADR-0033）。`POST /projects/{projectId}/clips/lyrics`。
 * 前に歌詞から置いたテロップは置き直す（手で置いたものは残る）。置いた件数などを返す。
 */
const WirePlacedLyricClips = z
  .object({
    clips: z.array(z.unknown()),
    replacedCount: z.number().int().nonnegative(),
    timedCount: z.number().int().nonnegative(),
    lineCount: z.number().int().nonnegative(),
  })
  .transform((data) => ({
    placedCount: data.clips.length,
    replacedCount: data.replacedCount,
    timedCount: data.timedCount,
    lineCount: data.lineCount,
  }))
export type PlacedLyricClips = z.output<typeof WirePlacedLyricClips>

export type LyricClipsApi = {
  placeLyricClips: (projectId: ProjectId) => Promise<PlacedLyricClips>
}

export const createLyricClipsApi = (requester: Requester): LyricClipsApi => ({
  placeLyricClips: (projectId) =>
    requester.post(`/projects/${encodeURIComponent(projectId)}/clips/lyrics`, {}, WirePlacedLyricClips),
})

/** 置いた結果を 1 文で言う。時刻の無いフレーズ・置けなかったフレーズがあれば、それも言う。 */
/** 置いたら、次はプレビューで確かめる（制作者 2026-10-03「テロップだけ確認は必須かも」）。 */
const CHECK_IN_PREVIEW = 'プレビューで音と合っているか確かめられます（絵が無くても黒い画面で流れます）。'

export const describePlacedLyrics = (placed: PlacedLyricClips): string => {
  const head = `歌詞を ${String(placed.placedCount)} 件のテロップにしました`
  const replaced = placed.replacedCount > 0 ? `（前に置いた ${String(placed.replacedCount)} 件を置き直し）` : ''
  const untimed = placed.lineCount - placed.timedCount
  const skipped = placed.timedCount - placed.placedCount
  const notes = [
    untimed > 0 ? `${String(untimed)} フレーズはまだ時刻がありません` : null,
    skipped > 0 ? `${String(skipped)} フレーズは短すぎるか曲の終わりより後なので置いていません` : null,
  ].filter((note): note is string => note !== null)
  return `${head}${replaced}。${notes.length === 0 ? '' : `${notes.join('。')}。`}${CHECK_IN_PREVIEW}`
}
