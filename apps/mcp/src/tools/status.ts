import { AiPurpose, AiToolId } from '@ixa/domain'
import { z } from 'zod'
import { seg } from '../api-client.js'
import { WireActiveGeneration, WireAiSettings, WireAiTools, WireModel, WireProject } from '../wire.js'
import { defineTool, Id, jsonResult } from '../tool-def.js'

/** 状態の確認と、使う AI の切り替え。 */

const WireHealth = z.object({ status: z.string(), uptimeSec: z.number() })

const durationsText = (d: z.infer<typeof WireModel>['durations']): string =>
  d.mode === 'enum'
    ? `${String(Math.min(...d.values))}–${String(Math.max(...d.values))}s (${String(d.values.length)} fixed lengths)`
    : `${String(d.min)}–${String(d.max)}s`

export const statusTool = defineTool({
  name: 'ixa_status',
  risk: 'read',
  description:
    'Start here. Shows whether the ixa API is up, which AI tools are available per purpose and which are selected, ' +
    'the video models you can pass to generate_takes, the projects in the workspace, and (with projectId) the video ' +
    'generations currently queued/running. Write everything the user sees in Japanese unless told otherwise. ' +
    'Workflow: create_project → music → set_master_track → plan_shots → cast → edit_shots → draw_start_frames → ' +
    'view → generate_takes → wait → adopt_take → telops/narration/sfx → export. ' +
    'Dialogue (talking characters): give each speaker speechName + voiceDescription (create_character, or edit_character ' +
    'update with character: {...}), write lines with plan_shots dialogues or edit_shots dialogue, generate with an ' +
    'audioGeneration model; dialogue subtitles are made automatically (add English with the line translation).',
  input: z.object({ projectId: Id.optional() }),
  handler: async ({ projectId }, { api, workspaceId }) => {
    const [health, tools, settings, models, projects] = await Promise.all([
      api.get('/health', WireHealth),
      api.get('/ai/tools', WireAiTools),
      api.get('/ai/settings', WireAiSettings),
      api.get('/models', z.array(WireModel)),
      api.get('/projects', z.array(WireProject), { workspaceId }),
    ])
    const active =
      projectId === undefined
        ? undefined
        : await api.get(`/projects/${seg(projectId)}/generations/active`, z.array(WireActiveGeneration))
    return jsonResult({
      api: health.status,
      aiSettings: settings.settings,
      aiSettingsSource: settings.source,
      aiTools: tools.tools.map((t) => ({
        id: t.id,
        label: t.label,
        ready: t.status.state === 'ready',
        ...(t.status.state === 'missing' ? { reason: t.status.reason } : {}),
        usableFor: Object.entries(t.problems).flatMap(([purpose, problem]) => (problem === null ? [purpose] : [])),
      })),
      videoModels: models.map((m) => ({
        id: m.id,
        label: m.label,
        durations: durationsText(m.durations),
        requiresStartFrame: m.requiresStartFrame,
        // セリフのある Shot は、声を作れるモデルでしか作れない（ADR-0059）。
        audioGeneration: m.audioGeneration ?? false,
        costPerSecondUsd: m.costPerSecondUsd,
        ...(m.qualityTier === undefined || m.qualityTier === null ? {} : { qualityTier: m.qualityTier }),
      })),
      projects: projects.map((p) => ({ id: p.id, name: p.name, status: p.status })),
      ...(active === undefined
        ? {}
        : {
            activeGenerations: active.map((g) => ({
              jobId: g.jobId,
              shotId: g.shotId,
              status: g.status,
              model: g.modelId,
              estimatedSec: g.estimatedLatencySec,
              queuedAt: g.queuedAt,
              providerStartedAt: g.providerStartedAt,
            })),
          }),
    })
  },
})

export const setAiTool = defineTool({
  name: 'set_ai',
  risk: 'settings',
  description:
    'Choose which AI tool ixa uses for one purpose (text = storyboard/assist, image = start frames, video = takes, ' +
    'voice, transcribe, music, sfx = sound effects). Check ixa_status first: only tools listed as usableFor that purpose are accepted. ' +
    'This changes the setting for the whole app (the human user sees it too).',
  input: z.object({ purpose: AiPurpose, tool: AiToolId }),
  handler: async ({ purpose, tool }, { api }) => {
    const current = await api.get('/ai/settings', WireAiSettings)
    const saved = await api.request('PUT', '/ai/settings', WireAiSettings, {
      body: { ...current.settings, [purpose]: tool },
    })
    return jsonResult({ aiSettings: saved.settings })
  },
})
