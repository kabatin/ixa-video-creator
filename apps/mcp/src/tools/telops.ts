import {
  dialogueTelopOf,
  lyricLineOf,
  MAX_TEXT_CLIP_LENGTH,
  MAX_TEXT_CLIP_TRANSLATION_LENGTH,
  mergeTextStyle,
  MIN_TEXT_CLIP_DURATION_SEC,
  narrationLineOf,
  Seconds,
  TextStyle,
  TextTemplateKey,
} from '@ixa/domain'
import { z } from 'zod'
import { IxaApiError, seg, type ApiClient } from '../api-client.js'
import { assertListed, assertNarrationLinesInProject } from '../lib/project-scope.js'
import { WireShot } from '../wire.js'
import { defineTool, Id, jsonResult, mapLimited, round, ToolInputError } from '../tool-def.js'

/**
 * テロップ（TEXT 段の text クリップ。ADR-0028）を置く・見る・消す。直すのは `edit_clips`。
 *
 *   POST   /projects/{projectId}/clips   { track:'TEXT', startSec, durationSec, layer, content:{ type:'text', templateKey, params } }
 *   GET    /projects/{projectId}/text-styles → 保存したスタイル（名前で選ぶ）
 *   DELETE /clips/{id}・/narration-lines/{id}
 *
 * 見た目の形と範囲は domain の `TextStyle` を読む（写さない）。
 */

/** テロップの尺の上限（秒）。これより長いものは置き間違い。 */
const MAX_TELOP_SEC = 60
const DEFAULT_TELOP_SEC = 2

export const WireClip = z.object({
  id: z.string(),
  track: z.string(),
  startSec: z.number(),
  durationSec: z.number(),
  layer: z.number().optional(),
  opacity: z.number().optional(),
  content: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('media'),
      mediaAssetId: z.string(),
      inSec: z.number(),
      outSec: z.number(),
      volume: z.number().optional(),
      fadeInSec: z.number().optional(),
      fadeOutSec: z.number().optional(),
    }),
    z.object({ type: z.literal('text'), templateKey: z.string(), params: z.record(z.unknown()) }),
    z.object({ type: z.literal('motion_graphics'), templateKey: z.string(), params: z.record(z.unknown()) }),
  ]),
})
export type WireClip = z.infer<typeof WireClip>

export const WireTextStylePreset = z.object({ id: z.string(), name: z.string(), style: z.unknown() })
export type WireTextStylePreset = z.infer<typeof WireTextStylePreset>

export const listClips = (api: ApiClient, projectId: string) =>
  api.get(`/projects/${seg(projectId)}/clips`, z.array(WireClip))

export const listTextStyles = (api: ApiClient, projectId: string) =>
  api.get(`/projects/${seg(projectId)}/text-styles`, z.array(WireTextStylePreset))

/** 名前（大小・前後の空白は無視）か ID で保存したスタイルを引く。無ければ使える名前を添えて断る。 */
export const findTextStyle = (
  presets: readonly WireTextStylePreset[],
  nameOrId: string,
  where: string,
): WireTextStylePreset => {
  const key = nameOrId.trim().toLowerCase()
  const found = presets.find((p) => p.id === nameOrId || p.name.trim().toLowerCase() === key)
  if (found === undefined) {
    const names = presets.map((p) => p.name).join('、')
    throw new ToolInputError(`${where}: スタイル「${nameOrId}」がありません（あるもの: ${names === '' ? 'なし' : names}）`)
  }
  return found
}

export const failureReason = (error: unknown): string => {
  if (error instanceof IxaApiError) {
    const fields = error.fields === null ? '' : ` ${JSON.stringify(error.fields)}`
    return `${String(error.status)}: ${error.apiMessage}${fields}`
  }
  throw error
}

const Telop = z.object({
  text: z.string().trim().min(1).max(MAX_TEXT_CLIP_LENGTH).describe('Shown text (Japanese is fine).'),
  translation: z
    .string()
    .trim()
    .min(1)
    .max(MAX_TEXT_CLIP_TRANSLATION_LENGTH)
    .optional()
    .describe('Optional smaller second line under the text (e.g. the English subtitle). Size: style.translationScale.'),
  atSec: Seconds.optional().describe('Timeline seconds where it appears. Give this OR shotCode.'),
  shotCode: z.string().min(1).optional().describe('Appear at the head of this shot (e.g. "CUT3"), plus offsetSec.'),
  offsetSec: Seconds.optional().describe('Seconds from the shot head (with shotCode). Default 0.'),
  durationSec: z.number().min(MIN_TEXT_CLIP_DURATION_SEC).max(MAX_TELOP_SEC).default(DEFAULT_TELOP_SEC),
  template: TextTemplateKey.default('plain').describe('plain = centered text; lower_third = bottom band.'),
  styleName: z.string().min(1).optional().describe('A saved text style by name (see list_telops styles).'),
  style: TextStyle.optional().describe(
    'Look overrides (applied on top of styleName): font gothic|mincho|rounded, size 0.02–0.2 of the shorter screen side ' +
      '(null = auto), weight, color #RRGGBB, stroke {color,width}, shadow, background {color,opacity}, align, ' +
      'anchor (9 positions like "top-center"), offset {x,y} −0.5–0.5, fadeInSec/fadeOutSec 0–2, ' +
      'translationScale 0.3–1 (second line size vs the first, default 0.6).',
  ),
  layer: z.number().int().min(0).max(20).default(0).describe('Higher layers draw on top. Lyrics use 1, narration 2.'),
})
type Telop = z.infer<typeof Telop>

export const AddTelopsInput = z.object({ projectId: Id, telops: z.array(Telop).min(1).max(100) })

type PlannedTelop = {
  readonly startSec: number
  readonly durationSec: number
  readonly layer: number
  readonly content: { readonly type: 'text'; readonly templateKey: string; readonly params: Record<string, unknown> }
}

const startOf = (telop: Telop, shots: readonly WireShot[] | null, where: string): number => {
  if ((telop.atSec === undefined) === (telop.shotCode === undefined)) {
    throw new ToolInputError(`${where}: atSec か shotCode のどちらか 1 つを指定してください`)
  }
  if (telop.atSec !== undefined && telop.offsetSec !== undefined) {
    throw new ToolInputError(`${where}: offsetSec は shotCode と一緒に使います（atSec には足しません）`)
  }
  if (telop.atSec !== undefined) return telop.atSec
  const shot = (shots ?? []).find((s) => s.code === telop.shotCode)
  if (shot === undefined) throw new ToolInputError(`${where}: Shot ${telop.shotCode ?? ''} がありません`)
  const startSec = shot.startSec + (telop.offsetSec ?? 0)
  if (startSec < 0) throw new ToolInputError(`${where}: 置く時刻が 0 秒より前です`)
  return startSec
}

/** 送る前に全部を確かめる。1 つでも読めなければ何も置かない。 */
const planTelops = (
  telops: readonly Telop[],
  shots: readonly WireShot[] | null,
  presets: readonly WireTextStylePreset[],
): readonly PlannedTelop[] =>
  telops.map((telop, i) => {
    const where = `telops[${String(i)}]`
    const preset = telop.styleName === undefined ? null : findTextStyle(presets, telop.styleName, where)
    const style = preset === null ? telop.style : mergeTextStyle(preset.style, telop.style ?? {}, [])
    return {
      startSec: round(startOf(telop, shots, where)),
      durationSec: round(telop.durationSec),
      layer: telop.layer,
      content: {
        type: 'text',
        templateKey: telop.template,
        params: {
          text: telop.text,
          ...(telop.translation === undefined ? {} : { translation: telop.translation }),
          ...(style === undefined ? {} : { style }),
          ...(preset === null ? {} : { styleId: preset.id }),
        },
      },
    }
  })

export const addTelopsTool = defineTool({
  name: 'add_telops',
  risk: 'write',
  description:
    'Place on-screen text (telops/captions/titles) on the timeline TEXT track. Place by atSec or shotCode+offsetSec; ' +
    'pick a template, an optional saved style (styleName) and look overrides (position via style.anchor/offset). ' +
    'Add translation for a smaller second line (two-line Japanese + English subtitles). ' +
    'For song lyrics use set_lyrics; for narration captions use set_narration; dialogue captions come from the shot ' +
    'dialogue (edit_shots) — they make their own telops.',
  input: AddTelopsInput,
  handler: async ({ projectId, telops }, { api }) => {
    const needsShots = telops.some((t) => t.shotCode !== undefined)
    const needsStyles = telops.some((t) => t.styleName !== undefined)
    const [shots, presets] = await Promise.all([
      needsShots ? api.get(`/projects/${seg(projectId)}/shots`, z.array(WireShot)) : Promise.resolve(null),
      needsStyles ? listTextStyles(api, projectId) : Promise.resolve([]),
    ])
    const planned = planTelops(telops, shots, presets)
    const results = await mapLimited(planned, 4, async (p) => {
      try {
        const created = await api.post(`/projects/${seg(projectId)}/clips`, { track: 'TEXT', ...p }, WireClip)
        return { ok: true as const, id: created.id, startSec: p.startSec, durationSec: p.durationSec }
      } catch (error) {
        return { ok: false as const, startSec: p.startSec, reason: failureReason(error) }
      }
    })
    const failures = results.flatMap((r) => (r.ok ? [] : [{ startSec: r.startSec, reason: r.reason }]))
    return jsonResult({
      created: results.flatMap((r) => (r.ok ? [{ id: r.id, startSec: r.startSec, durationSec: r.durationSec }] : [])),
      ...(failures.length > 0 ? { failures } : {}),
    })
  },
})

/** どこから来たテロップか。歌詞・ナレーション・セリフのものは元を直すと作り直される。 */
const originOf = (params: Record<string, unknown>): 'lyrics' | 'narration' | 'dialogue' | 'manual' => {
  if (narrationLineOf(params) !== null) return 'narration'
  if (dialogueTelopOf(params) !== null) return 'dialogue'
  return lyricLineOf(params) !== null ? 'lyrics' : 'manual'
}

/** セリフの字幕は消さない（消しても Shot のセリフから作り直される。ADR-0061）。 */
export const DIALOGUE_TELOP_REMOVE_REASON =
  'セリフの字幕は Shot のセリフから作られます（消しても作り直されます）。消すときは edit_shots でその行を消してください'

export const listTelopsTool = defineTool({
  name: 'list_telops',
  risk: 'read',
  description:
    'List the telops on the TEXT track (id, time, text, translation, template, style name, layer, ' +
    'origin manual|lyrics|narration|dialogue) ' +
    'ordered by time, and the saved text styles. Use ids with edit_clips / remove_telops.',
  input: z.object({ projectId: Id }),
  handler: async ({ projectId }, { api }) => {
    const [clips, presets] = await Promise.all([listClips(api, projectId), listTextStyles(api, projectId)])
    const styleName = new Map(presets.map((p) => [p.id, p.name]))
    const telops = clips
      .flatMap((c) => (c.content.type === 'text' ? [{ clip: c, content: c.content }] : []))
      .map(({ clip, content }) => {
        const styleId = typeof content.params.styleId === 'string' ? content.params.styleId : null
        return {
          id: clip.id,
          startSec: round(clip.startSec),
          durationSec: round(clip.durationSec),
          text: typeof content.params.text === 'string' ? content.params.text : '',
          ...(typeof content.params.translation === 'string' ? { translation: content.params.translation } : {}),
          template: content.templateKey,
          styleName: styleId === null ? null : (styleName.get(styleId) ?? null),
          ...(content.params.style === undefined ? {} : { style: content.params.style }),
          layer: clip.layer ?? 0,
          origin: originOf(content.params),
        }
      })
      .sort((a, b) => a.startSec - b.startSec)
    return jsonResult({ telops, styles: presets.map((p) => ({ name: p.name, style: p.style })) })
  },
})

export const RemoveTelopsInput = z
  .object({
    projectId: Id,
    clipIds: z.array(Id).max(200).optional().describe('Telop clip ids (TEXT track) from list_telops.'),
    narrationLineIds: z
      .array(Id)
      .max(200)
      .optional()
      .describe('Narration lines to delete (their voice and caption go with them). Ids from set_narration show.'),
  })

const deleteOne = async (api: ApiClient, path: string, id: string) => {
  try {
    await api.request('DELETE', path, z.unknown())
    return { ok: true as const, id }
  } catch (error) {
    return { ok: false as const, id, reason: failureReason(error) }
  }
}

export const removeTelopsTool = defineTool({
  name: 'remove_telops',
  risk: 'destructive',
  description:
    'Remove telops (TEXT track clips) and/or narration lines by id. Other clips (effects, sounds) are refused — use ' +
    'remove_effects / remove_sfx. Removing a narration caption keeps the line but stops captioning it. Deleting ' +
    'narration lines is not undoable.',
  input: RemoveTelopsInput,
  refine: ({ clipIds = [], narrationLineIds = [] }, ctx) => {
    if (clipIds.length + narrationLineIds.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clipIds'], message: 'clipIds か narrationLineIds を 1 つ以上指定してください' })
    }
  },
  handler: async ({ projectId, clipIds = [], narrationLineIds = [] }, { api }) => {
    // 作品の外の ID が 1 つでもあれば、何も消さずに断る。
    const [clips] = await Promise.all([
      clipIds.length > 0 ? assertListed(api, `/projects/${seg(projectId)}/clips`, clipIds, 'クリップ', WireClip) : Promise.resolve([]),
      narrationLineIds.length > 0 ? assertNarrationLinesInProject(api, projectId, narrationLineIds) : Promise.resolve(),
    ])
    const byId = new Map(clips.map((clip) => [clip.id, clip]))
    const clipResults = await mapLimited(clipIds, 4, async (id) => {
      const clip = byId.get(id)
      if (clip?.content.type !== 'text') return { ok: false as const, id, reason: 'テロップではないクリップは消しません（エフェクト・効果音など）' }
      if (dialogueTelopOf(clip.content.params) !== null) return { ok: false as const, id, reason: DIALOGUE_TELOP_REMOVE_REASON }
      return deleteOne(api, `/clips/${seg(id)}`, id)
    })
    // 行は順に消す（消すたびにテロップを作り直すので、並べて投げない）。
    const lineResults = await mapLimited(narrationLineIds, 1, (id) => deleteOne(api, `/narration-lines/${seg(id)}`, id))
    const failures = [...clipResults, ...lineResults].flatMap((r) => (r.ok ? [] : [{ id: r.id, reason: r.reason }]))
    return jsonResult({
      removedClips: clipResults.flatMap((r) => (r.ok ? [r.id] : [])),
      removedLines: lineResults.flatMap((r) => (r.ok ? [r.id] : [])),
      ...(failures.length > 0 ? { failures } : {}),
    })
  },
})
