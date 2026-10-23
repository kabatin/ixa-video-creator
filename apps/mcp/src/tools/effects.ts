import { EFFECT_TEMPLATES, EffectTemplateKey, effectFieldsOf, parseEffectParams, type EffectField } from '@ixa/domain'
import { z } from 'zod'
import { IxaApiError, seg, type ApiClient } from '../api-client.js'
import { WireShot } from '../wire.js'
import { defineTool, Id, jsonResult, mapLimited, round, ToolInputError } from '../tool-def.js'

/**
 * エフェクト（ADR-0050）を置く・見る・外す。タイムラインの VFX トラックに motion_graphics のクリップとして載る。
 * 型と値の正は domain（`effect-template.ts`）。ここでは送る前に同じスキーマで確かめ、途中まで置いてから断らない。
 */

/** エフェクトの尺の上限（秒）。長いものはタイトルカード程度で、それ以上は置き間違い。 */
const MAX_EFFECT_SEC = 30

/** これより短く切れるなら置かない（web の `planEffectInsert` と同じ）。 */
const MIN_EFFECT_SEC = 0.1

/** タイムラインの尺だけを読む（素材の URL は捨てる。応答にもログにも出さない）。 */
const WireTimelineLength = z.object({ durationSec: z.number() })

const WireEffectClip = z.object({
  id: z.string(),
  track: z.string(),
  startSec: z.number(),
  durationSec: z.number(),
  content: z.object({ type: z.string(), templateKey: z.string().optional(), params: z.record(z.unknown()).optional() }),
})

const fieldSummary = (field: EffectField): string => {
  switch (field.kind) {
    case 'number':
      return `${field.key} ${String(field.min)}–${String(field.max)}`
    case 'color':
      return `${field.key} #RRGGBB`
    case 'text':
      return `${field.key} ≤${String(field.maxLength)} chars`
    case 'choice':
      return `${field.key} ${field.options.map((o) => o.value).join('|')}`
  }
}

/** 型の一覧（エージェント向けの説明）。範囲はスキーマから読むので、ここに数を書かない。 */
export const effectCatalog = (): string =>
  EFFECT_TEMPLATES.map(
    (t) =>
      `${t.key} (${t.label}, ${t.kind === 'frame' ? 'moves the picture' : 'overlay'}, default ${String(t.defaultDurationSec)}s; ` +
      `${effectFieldsOf(t.key).map(fieldSummary).join(', ')}): ${t.hint}`,
  ).join('\n')

const Placement = z.object({
  template: EffectTemplateKey,
  atSec: z.number().min(0).optional().describe('Timeline seconds where the effect starts. Give this OR shotCode.'),
  shotCode: z.string().min(1).optional().describe('Start at the head of this shot (e.g. "CUT3"), plus offsetSec.'),
  offsetSec: z.number().optional().describe('Seconds from the shot head (with shotCode). Default 0.'),
  durationSec: z.number().positive().max(MAX_EFFECT_SEC).optional().describe('Default: the template default.'),
  params: z.record(z.unknown()).optional().describe('Template params; omitted ones take defaults. Out-of-range values are rejected.'),
})
type Placement = z.infer<typeof Placement>

export const AddEffectsInput = z.object({
  projectId: Id,
  effects: z.array(Placement).min(1).max(100),
})

type Planned = {
  readonly template: EffectTemplateKey
  readonly startSec: number
  readonly durationSec: number
  readonly params: Readonly<Record<string, unknown>>
}

/** 置く場所と値を全部確かめてから返す。1 つでも読めなければ何も置かない。 */
const planPlacements = (
  effects: readonly Placement[],
  shots: readonly WireShot[] | null,
  timelineEndSec: number,
): readonly Planned[] =>
  effects.map((effect, i) => {
    const where = `effects[${String(i)}]`
    if ((effect.atSec === undefined) === (effect.shotCode === undefined)) {
      throw new ToolInputError(`${where}: atSec か shotCode のどちらか 1 つを指定してください`)
    }
    // offsetSec は shotCode と組むものだけ。atSec と一緒なら黙って捨てず断る。
    if (effect.atSec !== undefined && effect.offsetSec !== undefined) {
      throw new ToolInputError(`${where}: offsetSec は shotCode と一緒に使います（atSec には足しません）`)
    }
    const shot = effect.shotCode === undefined ? null : (shots ?? []).find((s) => s.code === effect.shotCode)
    if (effect.shotCode !== undefined && (shot === null || shot === undefined)) {
      throw new ToolInputError(`${where}: Shot ${effect.shotCode} がありません`)
    }
    const startSec = effect.atSec ?? (shot?.startSec ?? 0) + (effect.offsetSec ?? 0)
    if (startSec < 0) throw new ToolInputError(`${where}: 置く時刻が 0 秒より前です`)
    const parsed = parseEffectParams(effect.template, effect.params ?? {})
    if (!parsed.ok) throw new ToolInputError(`${where}.params${parsed.field === null ? '' : `.${parsed.field}`}: ${parsed.message}`)
    const template = EFFECT_TEMPLATES.find((t) => t.key === effect.template)
    const room = timelineEndSec - startSec
    if (room < MIN_EFFECT_SEC) {
      throw new ToolInputError(`${where}: タイムラインの終わり（${String(round(timelineEndSec))} 秒）より後ろには置けません`)
    }
    return {
      template: effect.template,
      startSec: round(startSec),
      // 終わりで切る（web と同じ）。はみ出た分は絵に出ない。
      durationSec: round(Math.min(effect.durationSec ?? template?.defaultDurationSec ?? 1, room)),
      params: parsed.value.params,
    }
  })

const failureReason = (error: unknown): string => {
  if (error instanceof IxaApiError) {
    const fields = error.fields === null ? '' : ` ${JSON.stringify(error.fields)}`
    return `${String(error.status)}: ${error.apiMessage}${fields}`
  }
  throw error
}

const placeOne = async (api: ApiClient, projectId: string, planned: Planned) => {
  try {
    const created = await api.post(
      `/projects/${seg(projectId)}/clips`,
      {
        track: 'VFX',
        startSec: planned.startSec,
        durationSec: planned.durationSec,
        content: { type: 'motion_graphics', templateKey: planned.template, params: planned.params },
      },
      WireEffectClip,
    )
    return { ok: true as const, id: created.id, template: planned.template, startSec: planned.startSec, durationSec: planned.durationSec }
  } catch (error) {
    return { ok: false as const, template: planned.template, startSec: planned.startSec, reason: failureReason(error) }
  }
}

export const addEffectsTool = defineTool({
  name: 'add_effects',
  risk: 'write',
  description:
    'Layer visual effect templates on the timeline (VFX track) to add speed and punch. Pick a template and its ' +
    'strength; do not describe effects in prose. Place by atSec (timeline seconds) or shotCode+offsetSec. Good spots: ' +
    'cut heads (flash, zoom_punch, glitch), strong beats and the music drop (zoom_punch, shake, flash), action shots ' +
    '(speed_lines: radial for forward/POV shots, horizontal for side tracking), scene changes (film_burn, light_leak), the opening and section starts (title_card). Keep frame ' +
    'effects short (0.3–0.8s). Templates:\n' +
    effectCatalog(),
  input: AddEffectsInput,
  handler: async ({ projectId, effects }, { api }) => {
    const needsShots = effects.some((e) => e.shotCode !== undefined)
    const [shots, timeline] = await Promise.all([
      needsShots ? api.get(`/projects/${seg(projectId)}/shots`, z.array(WireShot)) : Promise.resolve(null),
      api.get(`/projects/${seg(projectId)}/timeline`, WireTimelineLength),
    ])
    const planned = planPlacements(effects, shots, timeline.durationSec)
    const results = await mapLimited(planned, 4, (p) => placeOne(api, projectId, p))
    const failures = results.flatMap((r) => (r.ok ? [] : [r]))
    return jsonResult({
      created: results.flatMap((r) => (r.ok ? [{ id: r.id, template: r.template, startSec: r.startSec, durationSec: r.durationSec }] : [])),
      ...(failures.length > 0 ? { failures } : {}),
    })
  },
})

export const ListEffectsInput = z.object({ projectId: Id })

export const listEffectsTool = defineTool({
  name: 'list_effects',
  risk: 'read',
  description:
    'List the effect clips on the timeline (VFX track): id, template, startSec, durationSec and params, ordered by ' +
    'time. Use the ids with remove_effects.',
  input: ListEffectsInput,
  handler: async ({ projectId }, { api }) => {
    const clips = await api.get(`/projects/${seg(projectId)}/clips`, z.array(WireEffectClip))
    const effects = clips
      .filter((c) => c.track === 'VFX' && c.content.type === 'motion_graphics')
      .map((c) => ({
        id: c.id,
        template: c.content.templateKey ?? '',
        startSec: round(c.startSec),
        durationSec: round(c.durationSec),
        params: c.content.params ?? {},
      }))
      .sort((a, b) => a.startSec - b.startSec)
    return jsonResult({ effects })
  },
})

export const RemoveEffectsInput = z.object({ projectId: Id, effectIds: z.array(Id).min(1).max(200) })

/** エフェクト（VFX の motion_graphics）か。テロップ・効果音・重ね素材はこのツールでは消さない。 */
const isEffectClip = (clip: z.infer<typeof WireEffectClip>): boolean =>
  clip.track === 'VFX' && clip.content.type === 'motion_graphics'

export const removeEffectsTool = defineTool({
  name: 'remove_effects',
  risk: 'destructive',
  description:
    'Remove effect clips of a project by id (ids from list_effects or add_effects). Only effect clips (VFX track) are ' +
    'removed; other ids are refused with a reason. Returns removed ids and failures.',
  input: RemoveEffectsInput,
  handler: async ({ projectId, effectIds }, { api }) => {
    const clips = await api.get(`/projects/${seg(projectId)}/clips`, z.array(WireEffectClip))
    const byId = new Map(clips.map((clip) => [clip.id, clip]))
    const results = await mapLimited(effectIds, 4, async (id) => {
      const clip = byId.get(id)
      if (clip === undefined) return { ok: false as const, id, reason: 'この作品にそのクリップはありません' }
      if (!isEffectClip(clip)) return { ok: false as const, id, reason: 'エフェクトではないクリップは消しません（テロップ・効果音など）' }
      try {
        await api.request('DELETE', `/clips/${seg(id)}`, z.unknown())
        return { ok: true as const, id }
      } catch (error) {
        return { ok: false as const, id, reason: failureReason(error) }
      }
    })
    const failures = results.flatMap((r) => (r.ok ? [] : [{ id: r.id, reason: r.reason }]))
    return jsonResult({ removed: results.flatMap((r) => (r.ok ? [r.id] : [])), ...(failures.length > 0 ? { failures } : {}) })
  },
})
