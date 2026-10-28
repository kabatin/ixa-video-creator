import { AiPurpose, AiToolId } from '@ixa/domain'
import { z } from 'zod'
import { seg } from '../api-client.js'
import { activeDubsOf } from '../lib/job-checks.js'
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
    '(aiSettings.checks: whether Claude checks drawn images / Takes; both off by default, change with set_ai), ' +
    'the video models you can pass to generate_takes, the projects in the workspace, and (with projectId) the video ' +
    'generations currently queued/running. Write everything the user sees in Japanese unless told otherwise. ' +
    'Workflow: create_project → music → set_master_track → plan_shots → cast → edit_shots → draw_start_frames → ' +
    'view → generate_takes → wait → adopt_take → telops/narration/sfx → export. ' +
    'Dialogue (talking characters): give each speaker speechName + voiceDescription (create_character, or edit_character ' +
    'update with character: {...}), write lines with plan_shots dialogues or edit_shots dialogue, generate with an ' +
    'audioGeneration model; dialogue subtitles are made automatically (add English with the line translation). ' +
    'To give each character a consistent voice, set character.dialogueVoiceProfileId (edit_character) and dub_takes the shots.',
  input: z.object({ projectId: Id.optional() }),
  handler: async ({ projectId }, { api, workspaceId }) => {
    const [health, tools, settings, models, projects] = await Promise.all([
      api.get('/health', WireHealth),
      api.get('/ai/tools', WireAiTools),
      api.get('/ai/settings', WireAiSettings),
      api.get('/models', z.array(WireModel)),
      api.get('/projects', z.array(WireProject), { workspaceId }),
    ])
    const [active, dubs] =
      projectId === undefined
        ? [undefined, undefined]
        : await Promise.all([
            api.get(`/projects/${seg(projectId)}/generations/active`, z.array(WireActiveGeneration)),
            activeDubsOf(api, projectId),
          ])
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
      // 声の差し替え（ADR-0062）。待つときは wait の kind:"dub"。
      ...(dubs === undefined
        ? {}
        : { activeDubs: dubs.map((d) => ({ jobId: d.id, shotId: d.shotId, status: d.status, sourceTakeId: d.sourceTakeId })) }),
    })
  },
})

export const setAiTool = defineTool({
  name: 'set_ai',
  risk: 'settings',
  description:
    'Choose which AI tool ixa uses for one purpose (text = storyboard/assist, image = start frames, video = takes, ' +
    'voice, transcribe, music, sfx = sound effects), and/or switch the Claude checks on or off. Check ixa_status first: ' +
    'only tools listed as usableFor that purpose are accepted. ' +
    'Local image tools (klein-api): klein = FLUX.2 [klein] 9B (best quality, non-commercial license), ' +
    'klein_4b = FLUX.2 [klein] 4B (faster, Apache-2.0), z_image = Z Image Turbo (Apache-2.0, ignores reference images such as characters). ' +
    'imageCheck = Claude looks at every drawn image (start frame, character sheet, key art) and redraws obvious failures; ' +
    'videoCheck = Claude looks at Take frames during review. Both are off by default because each image / Take uses the ' +
    "user's Claude allowance; they only work while the text tool is claude_cli. Turn them on only when the user asks. " +
    'This changes the setting for the whole app (the human user sees it too).',
  input: z.object({
    purpose: AiPurpose.optional(),
    tool: AiToolId.optional(),
    imageCheck: z.boolean().optional(),
    videoCheck: z.boolean().optional(),
  }),
  refine: (args, ctx) => {
    if ((args.purpose === undefined) !== (args.tool === undefined))
      ctx.addIssue({ code: 'custom', message: 'purpose と tool は一緒に指定してください' })
    if (args.purpose === undefined && args.imageCheck === undefined && args.videoCheck === undefined)
      ctx.addIssue({ code: 'custom', message: 'purpose と tool、imageCheck、videoCheck のどれかを指定してください' })
  },
  handler: async ({ purpose, tool, imageCheck, videoCheck }, { api }) => {
    const current = await api.get('/ai/settings', WireAiSettings)
    const checks =
      imageCheck === undefined && videoCheck === undefined
        ? {}
        : {
            checks: {
              image: imageCheck ?? current.settings.checks?.image ?? false,
              video: videoCheck ?? current.settings.checks?.video ?? false,
            },
          }
    const saved = await api.request('PUT', '/ai/settings', WireAiSettings, {
      body: { ...current.settings, ...(purpose === undefined ? {} : { [purpose]: tool }), ...checks },
    })
    return jsonResult({ aiSettings: saved.settings })
  },
})
