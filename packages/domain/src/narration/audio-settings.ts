import { z } from 'zod'
import { DuckingSettings } from '../audio/mix.js'
import { ProjectId } from '../common/ids.js'
import { DEFAULT_HIGHLIGHT_COLOR } from './narration-telop-clips.js'
import { ReadingDictionary, readingDictionaryProblem } from './reading.js'

/**
 * 作品ごとの音の設定（ADR-0038・0039）。読み辞書と、ナレーションの間に BGM を下げる設定（ダッキング）、
 * ナレーションのテロップで話している字を強調するか。
 * 作品の形（Project）とは分けて持つ（声を使わない作品には要らない。まだ設定していなければ既定を使う）。
 */
export const TelopHighlightSettings = z.object({
  enabled: z.boolean(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, '色は #RRGGBB の形で指定してください'),
})
export type TelopHighlightSettings = z.infer<typeof TelopHighlightSettings>

export const ProjectAudioSettings = z
  .object({
    projectId: ProjectId,
    readingDictionary: ReadingDictionary,
    ducking: DuckingSettings,
    /** ナレーションのテロップで、話している字を強調するか（字の時刻がある声だけ）。 */
    telopHighlight: TelopHighlightSettings,
  })
  .superRefine((settings, ctx) => {
    const problem = readingDictionaryProblem(settings.readingDictionary)
    if (problem !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ['readingDictionary'] })
  })
export type ProjectAudioSettings = z.infer<typeof ProjectAudioSettings>

/** まだ設定していない作品の設定（辞書は空・ダッキングはオンで中）。 */
export const defaultAudioSettings = (projectId: ProjectId): ProjectAudioSettings => ({
  projectId,
  readingDictionary: [],
  ducking: DuckingSettings.parse({}),
  telopHighlight: { enabled: false, color: DEFAULT_HIGHLIGHT_COLOR },
})
