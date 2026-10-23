import {
  CreateVoiceProfileInput,
  NARRATION_DIRECTION_MAX,
  NARRATION_READING_MAX,
  NARRATION_TEXT_MAX,
  ReadingEntry,
  UpdateVoiceProfilePatch,
  VoiceToolId,
} from '@ixa/domain'
import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { defineTool, Id, jsonResult, mapLimited, round, ToolInputError } from '../tool-def.js'
import { getAudioSettings, putAudioSettings } from './audio-mix.js'

/**
 * ナレーション（ADR-0038）の原稿・行・声・読み方。声にする（課金）のは `speak_narration`。
 *
 *   GET   /projects/{id}/narration          行の一覧（読み・見積もりの長さ・声の Take・作り直しが要るか）
 *   POST  /projects/{id}/narration/script   { text, voiceProfileId }  1 行 = 1 フレーズ。後ろに足す
 *   PATCH /narration-lines/{id}             表示・読み・声・演出・位置・テロップ
 *   POST  /projects/{id}/narration/order・arrange
 *   GET/POST /projects/{id}/voices・PATCH /voices/{id}・GET /voices/options
 *   読み辞書は作品の音の設定（/audio-settings）
 */

const WireLine = z.object({
  id: z.string(),
  order: z.number(),
  text: z.string(),
  reading: z.string(),
  readingIsManual: z.boolean(),
  voiceProfileId: z.string().nullable(),
  direction: z.string(),
  startSec: z.number().nullable(),
  telop: z.boolean(),
  estimatedSec: z.number(),
  durationSec: z.number().nullable(),
  stale: z.boolean(),
  selectedTakeId: z.string().nullable(),
  job: z.object({ id: z.string(), status: z.string(), error: z.unknown() }).nullable(),
})
export const WireNarration = z.object({ lines: z.array(WireLine), totalEstimatedSec: z.number(), endSec: z.number() })
type WireNarration = z.infer<typeof WireNarration>

export const WireVoice = z.object({
  id: z.string(),
  name: z.string(),
  tool: z.string(),
  model: z.string().nullable(),
  voiceName: z.string(),
  styleNote: z.string(),
  speed: z.number(),
  volume: z.number(),
  language: z.string(),
})
export type WireVoice = z.infer<typeof WireVoice>

export const listVoices = (api: ApiClient, projectId: string) =>
  api.get(`/projects/${seg(projectId)}/voices`, z.array(WireVoice))

/** 声を名前か ID で引く。無ければ作品の声の名前を添えて断る。 */
export const findVoice = (voices: readonly WireVoice[], nameOrId: string, where: string): WireVoice => {
  const found = voices.find((v) => v.id === nameOrId || v.name === nameOrId.trim())
  if (found === undefined) {
    const names = voices.map((v) => v.name).join('、')
    throw new ToolInputError(`${where}: 声「${nameOrId}」がありません（あるもの: ${names === '' ? 'なし。add_voice で作る' : names}）`)
  }
  return found
}

const VoiceRef = z.string().min(1).describe('Voice name or id (see voices in the result).')

const LineEdit = z.object({
  lineId: Id,
  text: z.string().trim().min(1).max(NARRATION_TEXT_MAX).optional().describe('Shown caption text.'),
  reading: z.string().trim().min(1).max(NARRATION_READING_MAX).nullable().optional().describe('How to read it (kana); null = from the reading dictionary.'),
  direction: z.string().max(NARRATION_DIRECTION_MAX).optional().describe('Delivery note for this line, e.g. 囁くように.'),
  voice: VoiceRef.nullable().optional(),
  startSec: z.number().min(0).nullable().optional().describe('Timeline seconds; null = not placed.'),
  telop: z.boolean().optional().describe('Show a caption for this line.'),
})

const NewVoice = CreateVoiceProfileInput.omit({ projectId: true, textStyleId: true, tuning: true })
const VoiceChange = UpdateVoiceProfilePatch.omit({ textStyleId: true, tuning: true })

export const SetNarrationInput = z.object({
  projectId: Id,
  action: z.enum(['show', 'add_script', 'edit_lines', 'reorder', 'arrange', 'add_voice', 'edit_voice', 'readings']),
  script: z.string().max(20_000).optional().describe('add_script: one phrase per line, appended after the existing lines.'),
  voice: VoiceRef.optional().describe('add_script: voice for the new lines. edit_voice: the voice to change.'),
  lines: z.array(LineEdit).min(1).max(200).optional().describe('edit_lines.'),
  lineIds: z.array(Id).max(1000).optional().describe('reorder: every line once, in the new order. arrange: lines to place (default all).'),
  fromSec: z.number().min(0).optional().describe('arrange: where the first line starts.'),
  gapSec: z.number().min(0).max(10).optional().describe('arrange: silence between lines (default 0.3).'),
  newVoice: NewVoice.optional().describe('add_voice: name, tool (gemini_api|elevenlabs|macos_say), voiceName (e.g. Kore for Gemini), model, styleNote, speed 0.5–2, volume, language, characterId.'),
  voiceChange: VoiceChange.optional().describe('edit_voice: fields to change.'),
  readings: z
    .object({ set: z.array(ReadingEntry).max(500).optional(), remove: z.array(z.string().min(1)).max(500).optional() })
    .optional()
    .describe('readings: add/replace dictionary entries {written, reading} (e.g. 戦子 → せんこ), or remove by written.'),
  voiceOptionsFor: VoiceToolId.optional().describe('show: also list the models and voice names of this voice AI.'),
})
type SetNarrationArgs = z.infer<typeof SetNarrationInput>

const DEFAULT_GAP_SEC = 0.3

const need = <T>(value: T | undefined, field: string, action: string): T => {
  if (value === undefined) throw new ToolInputError(`${action} には ${field} が要ります`)
  return value
}

/** 結果は短く。行の中身と、声にできているかだけ。 */
const summarize = (narration: WireNarration, voices: readonly WireVoice[]) => {
  const voiceName = new Map(voices.map((v) => [v.id, v.name]))
  return {
    lines: narration.lines.map((l) => ({
      id: l.id,
      text: l.text,
      reading: l.reading,
      ...(l.direction === '' ? {} : { direction: l.direction }),
      voice: l.voiceProfileId === null ? null : (voiceName.get(l.voiceProfileId) ?? l.voiceProfileId),
      startSec: l.startSec === null ? null : round(l.startSec),
      lengthSec: round(l.durationSec ?? l.estimatedSec),
      spoken: l.selectedTakeId !== null && !l.stale,
      telop: l.telop,
      ...(l.job === null ? {} : { job: { id: l.job.id, status: l.job.status } }),
    })),
    endSec: round(narration.endSec),
    voices: voices.map((v) => ({ id: v.id, name: v.name, tool: v.tool, voiceName: v.voiceName, speed: v.speed })),
  }
}

const narrationPath = (projectId: string, rest = '') => `/projects/${seg(projectId)}/narration${rest}`

const runAction = async (api: ApiClient, args: SetNarrationArgs, voices: readonly WireVoice[]): Promise<void> => {
  const { projectId, action } = args
  switch (action) {
    case 'show':
      return
    case 'add_script': {
      const voice = args.voice === undefined ? null : findVoice(voices, args.voice, 'voice')
      await api.post(narrationPath(projectId, '/script'), { text: need(args.script, 'script', action), voiceProfileId: voice?.id ?? null }, z.unknown())
      return
    }
    case 'edit_lines': {
      const edits = need(args.lines, 'lines', action).map(({ lineId, voice, ...rest }, i) => ({
        lineId,
        patch: {
          ...rest,
          ...(rest.startSec === undefined || rest.startSec === null ? {} : { startSec: round(rest.startSec) }),
          ...(voice === undefined ? {} : { voiceProfileId: voice === null ? null : findVoice(voices, voice, `lines[${String(i)}].voice`).id }),
        },
      }))
      // 1 行ずつ順に（行を直すたびにテロップを作り直す）。
      await mapLimited(edits, 1, ({ lineId, patch }) => api.request('PATCH', `/narration-lines/${seg(lineId)}`, z.unknown(), { body: patch }))
      return
    }
    case 'reorder':
      await api.post(narrationPath(projectId, '/order'), { lineIds: need(args.lineIds, 'lineIds', action) }, z.unknown())
      return
    case 'arrange':
      await api.post(
        narrationPath(projectId, '/arrange'),
        { fromSec: round(need(args.fromSec, 'fromSec', action)), gapSec: args.gapSec ?? DEFAULT_GAP_SEC, ...(args.lineIds === undefined ? {} : { lineIds: args.lineIds }) },
        z.unknown(),
      )
      return
    case 'add_voice':
      await api.post(`/projects/${seg(projectId)}/voices`, need(args.newVoice, 'newVoice', action), z.unknown())
      return
    case 'edit_voice': {
      const voice = findVoice(voices, need(args.voice, 'voice', action), 'voice')
      await api.request('PATCH', `/voices/${seg(voice.id)}`, z.unknown(), { body: need(args.voiceChange, 'voiceChange', action) })
      return
    }
    case 'readings': {
      const change = need(args.readings, 'readings', action)
      const current = await getAudioSettings(api, projectId)
      const replaced = new Set([...(change.set ?? []).map((e) => e.written), ...(change.remove ?? [])])
      await putAudioSettings(api, projectId, {
        ...current,
        readingDictionary: [...current.readingDictionary.filter((e) => !replaced.has(e.written)), ...(change.set ?? [])],
      })
      return
    }
  }
}

const WireVoiceOptions = z.object({
  models: z.array(z.object({ id: z.string(), label: z.string() })),
  voices: z.array(z.object({ id: z.string(), label: z.string(), note: z.string().nullable() })),
})

export const setNarrationTool = defineTool({
  name: 'set_narration',
  risk: 'write',
  description:
    'Narration script and voices. Actions: show; add_script (paste lines); edit_lines (text, reading, direction, ' +
    'voice, startSec, telop); reorder; arrange (place lines one after another from fromSec — do it after ' +
    'speak_narration so real lengths are used); add_voice / edit_voice; readings (dictionary for words the voice ' +
    'misreads). Captions follow the lines automatically. Delete lines with remove_telops.',
  input: SetNarrationInput,
  handler: async (args, { api }) => {
    const voicesBefore = await listVoices(api, args.projectId)
    await runAction(api, args, voicesBefore)
    const voiceChanged = args.action === 'add_voice' || args.action === 'edit_voice'
    const [narration, voices, settings, options] = await Promise.all([
      api.get(narrationPath(args.projectId), WireNarration),
      voiceChanged ? listVoices(api, args.projectId) : Promise.resolve(voicesBefore),
      args.action === 'readings' || args.action === 'show' ? getAudioSettings(api, args.projectId) : Promise.resolve(null),
      args.voiceOptionsFor === undefined
        ? Promise.resolve(null)
        : api.get('/voices/options', WireVoiceOptions, { tool: args.voiceOptionsFor }),
    ])
    return jsonResult({
      ...summarize(narration, voices),
      ...(settings === null ? {} : { readingDictionary: settings.readingDictionary }),
      ...(options === null ? {} : { voiceOptions: options }),
    })
  },
})
