import {
  CLIP_FADE_MAX_SEC,
  MAX_TEXT_CLIP_LENGTH,
  TextStyle,
  TextStyleKey,
  TextTemplateKey,
  mergeTextStyle,
  narrationLineOf,
} from '@ixa/domain'
import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { defineTool, Id, jsonResult, mapLimited, round, ToolInputError } from '../tool-def.js'
import { failureReason, findTextStyle, listClips, listTextStyles, WireClip, type WireTextStylePreset } from './telops.js'

/**
 * タイムラインのクリップ（テロップ・効果音・エフェクト）を直す。`PATCH /clips/{id}` を 1 件ずつ。
 *
 * API の `content` は丸ごと差し替わるので、今の中身に変えた欄だけを重ねて送る（見た目・印を落とさない）。
 * 音のクリップの中身を変えるときは尺も一緒に送り、トリムの長さ（outSec − inSec）を尺に揃える。
 * 消すのは `remove_telops`・`remove_effects`・`remove_sfx`（確認が要る操作を分ける）。
 */

const ClipEdit = z.object({
  clipId: Id,
  startSec: z.number().min(0).optional(),
  durationSec: z.number().positive().max(600).optional(),
  layer: z.number().int().min(0).max(20).optional(),
  text: z.string().trim().min(1).max(MAX_TEXT_CLIP_LENGTH).optional().describe('Telops only.'),
  template: TextTemplateKey.optional().describe('Telops only.'),
  styleName: z.string().min(1).optional().describe('Telops only: replace the look with this saved style.'),
  style: TextStyle.optional().describe('Telops only: change just these look fields (e.g. {anchor:"top-center"}).'),
  unsetStyle: z.array(TextStyleKey).optional().describe('Telops only: reset these look fields to the template default.'),
  volume: z.number().min(0).max(2).optional().describe('Sound clips only.'),
  fadeInSec: z.number().min(0).max(CLIP_FADE_MAX_SEC).optional().describe('Sound clips only.'),
  fadeOutSec: z.number().min(0).max(CLIP_FADE_MAX_SEC).optional().describe('Sound clips only.'),
})
type ClipEdit = z.infer<typeof ClipEdit>

export const EditClipsInput = z.object({ projectId: Id, edits: z.array(ClipEdit).min(1).max(200) })

type Patch = Readonly<Record<string, unknown>>

const TEXT_FIELDS = ['text', 'template', 'styleName', 'style', 'unsetStyle'] as const
const SOUND_FIELDS = ['volume', 'fadeInSec', 'fadeOutSec'] as const

const given = (edit: ClipEdit, keys: readonly (keyof ClipEdit)[]): readonly string[] =>
  keys.filter((key) => edit[key] !== undefined)

const textContent = (
  clip: WireClip & { content: { type: 'text' } },
  edit: ClipEdit,
  presets: readonly WireTextStylePreset[],
  where: string,
) => {
  if (edit.text !== undefined && narrationLineOf(clip.content.params) !== null) {
    throw new ToolInputError(`${where}: ナレーションのテロップの文字は行で直してください（set_narration の edit_lines）`)
  }
  const params = clip.content.params
  const preset = edit.styleName === undefined ? null : findTextStyle(presets, edit.styleName, where)
  const touchesStyle = preset !== null || edit.style !== undefined || edit.unsetStyle !== undefined
  const style = mergeTextStyle(preset === null ? params.style : preset.style, edit.style ?? {}, edit.unsetStyle ?? [])
  return {
    type: 'text',
    templateKey: edit.template ?? clip.content.templateKey,
    params: {
      ...params,
      ...(edit.text === undefined ? {} : { text: edit.text }),
      ...(touchesStyle ? { style } : {}),
      ...(preset === null ? {} : { styleId: preset.id }),
    },
  }
}

/** 1 件の差分。変えるものが無ければ断る（何もしない PATCH を送らない）。 */
const planEdit = (clip: WireClip, edit: ClipEdit, presets: readonly WireTextStylePreset[], where: string): Patch => {
  const base: Patch = {
    ...(edit.startSec === undefined ? {} : { startSec: round(edit.startSec) }),
    ...(edit.durationSec === undefined ? {} : { durationSec: round(edit.durationSec) }),
    ...(edit.layer === undefined ? {} : { layer: edit.layer }),
  }
  const { content } = clip
  const textAsked = given(edit, TEXT_FIELDS)
  const soundAsked = given(edit, SOUND_FIELDS)
  if (content.type !== 'text' && textAsked.length > 0) {
    throw new ToolInputError(`${where}: ${textAsked.join('・')} はテロップにだけ使えます`)
  }
  if (content.type !== 'media' && soundAsked.length > 0) {
    throw new ToolInputError(`${where}: ${soundAsked.join('・')} は音のクリップにだけ使えます`)
  }
  if (content.type === 'text' && textAsked.length > 0) {
    return { ...base, content: textContent({ ...clip, content }, edit, presets, where) }
  }
  if (content.type === 'media' && (soundAsked.length > 0 || edit.durationSec !== undefined)) {
    // 中身を送るなら尺も送る（API の決まり）。尺を変えたら終点も動かす（描く側は inSec から尺だけ鳴らす）。
    const durationSec = round(edit.durationSec ?? clip.durationSec)
    return {
      ...base,
      durationSec,
      content: {
        ...content,
        outSec: round(content.inSec + durationSec),
        ...(edit.volume === undefined ? {} : { volume: edit.volume }),
        ...(edit.fadeInSec === undefined ? {} : { fadeInSec: edit.fadeInSec }),
        ...(edit.fadeOutSec === undefined ? {} : { fadeOutSec: edit.fadeOutSec }),
      },
    }
  }
  if (Object.keys(base).length === 0) throw new ToolInputError(`${where}: 変える欄がありません`)
  return base
}

const applyEdit = async (api: ApiClient, clipId: string, patch: Patch) => {
  try {
    const updated = await api.request('PATCH', `/clips/${seg(clipId)}`, WireClip, { body: patch })
    return { ok: true as const, id: updated.id, startSec: round(updated.startSec), durationSec: round(updated.durationSec) }
  } catch (error) {
    return { ok: false as const, id: clipId, reason: failureReason(error) }
  }
}

export const editClipsTool = defineTool({
  name: 'edit_clips',
  risk: 'write',
  description:
    'Change timeline clips by id: telops (text, template, saved style, look fields such as position anchor/offset, ' +
    'time, length), sound clips (time, length, volume 0–2, fades) and effect clips (time, length). Ids come from ' +
    'list_telops / list_sfx / list_effects. Narration captions follow their line: edit the line with set_narration.',
  input: EditClipsInput,
  handler: async ({ projectId, edits }, { api }) => {
    const needsStyles = edits.some((e) => e.styleName !== undefined)
    const [clips, presets] = await Promise.all([
      listClips(api, projectId),
      needsStyles ? listTextStyles(api, projectId) : Promise.resolve([]),
    ])
    const byId = new Map(clips.map((clip) => [clip.id, clip]))
    // 全部を確かめてから送る。1 件でも読めなければ何も変えない。
    const planned = edits.map((edit, i) => {
      const where = `edits[${String(i)}]`
      const clip = byId.get(edit.clipId)
      if (clip === undefined) throw new ToolInputError(`${where}: この作品にクリップ ${edit.clipId} はありません`)
      return { clipId: edit.clipId, patch: planEdit(clip, edit, presets, where) }
    })
    const results = await mapLimited(planned, 4, ({ clipId, patch }) => applyEdit(api, clipId, patch))
    const failures = results.flatMap((r) => (r.ok ? [] : [{ id: r.id, reason: r.reason }]))
    return jsonResult({
      updated: results.flatMap((r) => (r.ok ? [{ id: r.id, startSec: r.startSec, durationSec: r.durationSec }] : [])),
      ...(failures.length > 0 ? { failures } : {}),
    })
  },
})
