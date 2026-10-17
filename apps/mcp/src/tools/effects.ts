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
const planPlacements = (effects: readonly Placement[], shots: readonly WireShot[] | null): readonly Planned[] =>
  effects.map((effect, i) => {
    const where = `effects[${String(i)}]`
    if ((effect.atSec === undefined) === (effect.shotCode === undefined)) {
      throw new ToolInputError(`${where}: atSec か shotCode のどちらか 1 つを指定してください`)
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
    return {
      template: effect.template,
      startSec: round(startSec),
      durationSec: effect.durationSec ?? template?.defaultDurationSec ?? 1,
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
  description:
    'Layer visual effect templates on the timeline (VFX track) to add speed and punch. Pick a template and its ' +
    'strength; do not describe effects in prose. Place by atSec (timeline seconds) or shotCode+offsetSec. Good spots: ' +
    'cut heads (flash, zoom_punch, glitch), strong beats and the music drop (zoom_punch, shake, flash), action shots ' +
    '(speed_lines), scene changes (film_burn, light_leak), the opening and section starts (title_card). Keep frame ' +
    'effects short (0.3–0.8s). Templates:\n' +
    effectCatalog(),
  input: AddEffectsInput,
  handler: async ({ projectId, effects }, { api }) => {
    const needsShots = effects.some((e) => e.shotCode !== undefined)
    const shots = needsShots ? await api.get(`/projects/${seg(projectId)}/shots`, z.array(WireShot)) : null
    const planned = planPlacements(effects, shots)
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

export const RemoveEffectsInput = z.object({ effectIds: z.array(Id).min(1).max(200) })

export const removeEffectsTool = defineTool({
  name: 'remove_effects',
  description: 'Remove effect clips by id (ids from list_effects or add_effects). Returns removed ids and failures.',
  input: RemoveEffectsInput,
  handler: async ({ effectIds }, { api }) => {
    const results = await mapLimited(effectIds, 4, async (id) => {
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
