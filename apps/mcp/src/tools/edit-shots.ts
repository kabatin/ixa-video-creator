import { MAX_PLAYBACK_RATE, MIN_PLAYBACK_RATE, ShotCamera, ShotContinuityMode, ShotTiming, TransitionType } from '@ixa/domain'
import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { bulkResult, WireLook, WireShot, WireShotCharacter, WireTransition } from '../wire.js'
import { defineTool, describeError, Id, jsonResult, mapLimited, ToolInputError } from '../tool-def.js'

/** Shot の中身をまとめて直す（説明・空気・カメラ・場所・登場人物・次へのつなぎ）。 */

const CastEntry = z.object({
  characterId: Id,
  lookId: Id.optional().describe("Defaults to the character's default look."),
  prominence: z.enum(['primary', 'secondary', 'background']).optional().describe('Default: first primary, rest secondary.'),
})

/** cut 以外のつなぎで長さを省いたときの長さ（0 秒だと API が cut に畳んでしまう）。 */
export const DEFAULT_TRANSITION_SEC = 0.5

const TransitionToNext = z.object({
  type: TransitionType,
  durationSec: z
    .number()
    .min(0)
    .max(5)
    .optional()
    .describe(`Seconds of overlap. Default ${String(DEFAULT_TRANSITION_SEC)} for non-cut types; must be > 0 for them.`),
})

/** 長さを決める。cut は 0、それ以外は既定 0.5 秒。cut 以外の 0 秒は断る（黙って cut にしない）。 */
export const transitionDurationSec = (t: z.infer<typeof TransitionToNext>): number => {
  if (t.type === 'cut') return 0
  if (t.durationSec === 0) throw new ToolInputError(`transitionToNext.durationSec: ${t.type} は 0 秒にできません（cut を使う）`)
  return t.durationSec ?? DEFAULT_TRANSITION_SEC
}

const Edit = z.object({
  shotIds: z.array(Id).min(1).max(200).describe('Shots that receive the same change. Use one id for per-shot descriptions.'),
  description: z
    .string()
    .max(4000)
    .optional()
    .describe(
      'What happens in the shot (Japanese; shown to the user and used in the prompt). Describe only what should ' +
        'be seen, not what must not happen: negations name the unwanted thing. For people without dialogue, keep ' +
        'faces calm (e.g. 「無表情で前を見据え、表情は最後まで変わらない」); strong-expression words (frowning, ' +
        'clenched jaw, shouting) make the video model open and move the mouth.',
    ),
  mood: z.string().max(500).nullable().optional(),
  camera: ShotCamera.partial().optional().describe('Only the given camera fields change.'),
  locationId: Id.nullable().optional(),
  cast: z.array(CastEntry).max(8).optional().describe('Replaces the whole cast of each shot. [] clears it.'),
  speed: z
    .number()
    .min(MIN_PLAYBACK_RATE)
    .max(MAX_PLAYBACK_RATE)
    .optional()
    .describe(
      'Playback speed of the take (1 = as generated). For fast trailer-style action use 1.25–2 with short cuts; ' +
        'new takes are requested at durationSec × speed so the shot still has enough footage.',
    ),
  sourceInSec: z
    .number()
    .min(0)
    .optional()
    .describe('Where in the take the shot starts (seconds into the take). Use it to skip a weak start.'),
  transitionToNext: TransitionToNext.optional()
    .describe('Transition from this shot into the next shot in order. type "cut" removes any transition.'),
  continuityMode: ShotContinuityMode.optional().describe(
    'previous_shot: the take starts from the last frame of the previous shot\'s selected take. Adopt that take before generating.',
  ),
  timing: ShotTiming.optional().describe('trim: cut the take to the shot length; fit: speed the take up/down to fill it.'),
  startSec: z.number().min(0).optional().describe('Position on the timeline. Only with a single shotId.'),
  durationSec: z.number().positive().optional().describe('Length on the timeline. Only with a single shotId.'),
})

export const EditShotsInput = z.object({
  projectId: Id,
  edits: z.array(Edit).min(1).max(100),
})

type EditInput = z.infer<typeof Edit>

const BulkPatchResult = z.object({ results: z.array(bulkResult({ shot: WireShot })) })

const patchOf = (edit: EditInput) => ({
  ...(edit.description === undefined ? {} : { description: edit.description }),
  ...(edit.mood === undefined ? {} : { mood: edit.mood }),
  ...(edit.camera === undefined ? {} : { camera: edit.camera }),
  ...(edit.locationId === undefined ? {} : { locationId: edit.locationId }),
  ...(edit.speed === undefined ? {} : { speed: edit.speed }),
  ...(edit.sourceInSec === undefined ? {} : { sourceInSec: edit.sourceInSec }),
})

/** 一括の口が受けない列（ADR-0050 の時間・つなぎ方）。Shot ごとの PATCH /shots/{id} で直す。 */
const singlePatchOf = (edit: EditInput) => ({
  ...(edit.continuityMode === undefined ? {} : { continuityMode: edit.continuityMode }),
  ...(edit.timing === undefined ? {} : { timing: edit.timing }),
  ...(edit.startSec === undefined ? {} : { startSec: edit.startSec }),
  ...(edit.durationSec === undefined ? {} : { durationSec: edit.durationSec }),
})

/** 同じ位置・尺を何本にも入れると重なりだらけになる（一括の口が時間を受けないのと同じ理由）。 */
const timeEditProblem = (edit: EditInput): string | null =>
  (edit.startSec !== undefined || edit.durationSec !== undefined) && edit.shotIds.length !== 1
    ? 'startSec・durationSec は shotIds が 1 つのときだけ直せます'
    : null

const patchEach = async (api: ApiClient, shotIds: readonly string[], patch: Readonly<Record<string, unknown>>) =>
  mapLimited(shotIds, 4, (shotId) =>
    api.request('PATCH', `/shots/${seg(shotId)}`, WireShot, { body: patch }).then(
      () => ({ shotId, ok: true as const }),
      (error: unknown) => ({ shotId, ok: false as const, reason: describeError(error) }),
    ),
  )

const defaultLookId = async (api: ApiClient, characterId: string): Promise<string> => {
  const looks = await api.get(`/characters/${seg(characterId)}/looks`, z.array(WireLook))
  const look = looks.find((l) => l.isDefault === true) ?? looks[0]
  if (look === undefined) throw new ToolInputError(`キャラクター ${characterId} に Look がありません`)
  return look.id
}

const castEntries = async (api: ApiClient, cast: NonNullable<EditInput['cast']>) =>
  mapLimited(cast, 4, async (entry, i) => ({
    characterId: entry.characterId,
    lookId: entry.lookId ?? (await defaultLookId(api, entry.characterId)),
    prominence: entry.prominence ?? (i === 0 ? 'primary' : 'secondary'),
    order: i,
  }))

/** 次の Shot へのつなぎを差し替える。古い出入りは消してから作る（API は 1 つの Shot に出入り 1 本ずつ）。 */
const replaceTransition = async (
  api: ApiClient,
  projectId: string,
  fromShotId: string,
  ordered: readonly z.infer<typeof WireShot>[],
  transition: NonNullable<EditInput['transitionToNext']>,
): Promise<string> => {
  const index = ordered.findIndex((s) => s.id === fromShotId)
  const next = index === -1 ? undefined : ordered[index + 1]
  if (next === undefined) return 'skipped: no next shot'
  const existing = await api.get(`/projects/${seg(projectId)}/transitions`, z.array(WireTransition))
  const stale = existing.filter((t) => t.fromShotId === fromShotId || t.toShotId === next.id)
  await Promise.all(stale.map((t) => api.request('DELETE', `/transitions/${seg(t.id)}`, z.unknown())))
  if (transition.type === 'cut') return 'cut'
  await api.post(
    `/projects/${seg(projectId)}/transitions`,
    {
      fromShotId,
      toShotId: next.id,
      type: transition.type,
      durationSec: transitionDurationSec(transition),
    },
    WireTransition,
  )
  return transition.type
}

const applyEdit = async (api: ApiClient, projectId: string, edit: EditInput, ordered: readonly z.infer<typeof WireShot>[]) => {
  const patch = patchOf(edit)
  const patched =
    Object.keys(patch).length === 0
      ? null
      : await api.request('PATCH', `/projects/${seg(projectId)}/shots/bulk`, BulkPatchResult, {
          body: { shotIds: edit.shotIds, patch },
        })
  const single = singlePatchOf(edit)
  const updated = Object.keys(single).length === 0 ? null : await patchEach(api, edit.shotIds, single)
  const failures = [...(patched?.results ?? []), ...(updated ?? [])].flatMap((r) =>
    r.ok ? [] : [{ shotId: r.shotId, reason: r.reason }],
  )

  const entries = edit.cast === undefined ? null : await castEntries(api, edit.cast)
  if (entries !== null) {
    await mapLimited(edit.shotIds, 4, (shotId) =>
      api.request('PUT', `/shots/${seg(shotId)}/characters`, z.array(WireShotCharacter), { body: { entries } }),
    )
  }

  const transition = edit.transitionToNext
  // 出入りの表を読み直しながら 1 本ずつ（並べると同じ行を 2 回消しに行く）。
  const transitions =
    transition === undefined
      ? null
      : await edit.shotIds.reduce<Promise<readonly string[]>>(
          async (done, shotId) => [...(await done), await replaceTransition(api, projectId, shotId, ordered, transition)],
          Promise.resolve([]),
        )

  return {
    shotIds: edit.shotIds,
    ...(patched === null ? {} : { patched: patched.results.filter((r) => r.ok).length }),
    ...(updated === null ? {} : { updated: updated.filter((r) => r.ok).length }),
    ...(failures.length > 0 ? { failures } : {}),
    ...(entries === null ? {} : { castSet: entries.length }),
    ...(transitions === null ? {} : { transitions }),
  }
}

export const editShotsTool = defineTool({
  name: 'edit_shots',
  risk: 'write',
  description:
    'Edit shots in bulk. Each edit applies the same change to its shotIds: description (Japanese, what happens on ' +
    'screen), mood, camera {size, angleH, angle, lensMm, movement, movementIntensity} (only given fields change), ' +
    'locationId, cast (replaces the cast; characters from create_character), transitionToNext ' +
    '(cut|dissolve|dip_to_black|dip_to_white|wipe|whip_pan|glitch), continuityMode, timing, startSec/durationSec. ' +
    'A previous_shot shot starts from the last frame of the previous shot\'s selected take: adopt that take first, then generate. ' +
    'Edits run in order.',
  input: EditShotsInput,
  handler: async ({ projectId, edits }, { api }) => {
    // つなぎの長さは何かを直す前に全部確かめる（途中まで直してから断らない）。
    edits.forEach((edit) => edit.transitionToNext !== undefined && transitionDurationSec(edit.transitionToNext))
    const timeProblem = edits.map(timeEditProblem).find((p) => p !== null)
    if (timeProblem !== undefined) throw new ToolInputError(timeProblem)
    const shots = await api.get(`/projects/${seg(projectId)}/shots`, z.array(WireShot))
    const ordered = [...shots].sort((a, b) => a.order - b.order)
    const results = await edits.reduce<Promise<readonly unknown[]>>(
      async (done, edit) => [...(await done), await applyEdit(api, projectId, edit, ordered)],
      Promise.resolve([]),
    )
    return jsonResult({ results })
  },
})
