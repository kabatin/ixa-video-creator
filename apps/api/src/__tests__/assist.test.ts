import type { Project } from '@ixa/domain'
import { aShot, createInMemoryShotRepository } from '@ixa/generation/testing'
import type { AssistRequest, TextAssistant } from '@ixa/provider-llm'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { baseAppDeps } from './app-deps.js'
import { aCharacterBundle, aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { createInMemoryCharacterRepository } from '@ixa/generation/testing'
import { postJson, type ErrorBody, type Ok } from './shot-test-support.js'

/**
 * 入力を AI が手伝う（ADR-0032 の 3 段目）。欄の「✦ AI」から呼ぶ。案を 1 つ返すだけで、欄は書き換えない。
 * どの AI で出すかは「使う AI」のテキスト（使うたびに読む）。
 */

const recordingAssistant = (reply: Awaited<ReturnType<TextAssistant['suggest']>>) => {
  const seen: AssistRequest[] = []
  const assistant: TextAssistant = {
    name: 'recording',
    suggest: (request) => {
      seen.push(request)
      return Promise.resolve(reply)
    },
  }
  return { seen, assistant }
}

const build = (reply: Awaited<ReturnType<TextAssistant['suggest']>> = { ok: true, text: '青い外光の屋上', costUsd: 0 }) => {
  const project: Project = { ...aProject(), lyrics: '夜明けの屋上で', lyricCues: [1] }
  const shot = aShot(project.id, { code: 'CUT-01', startSec: 0, durationSec: 4 })
  const bundle = aCharacterBundle()
  const recording = recordingAssistant(reply)
  const app = createApp({
    ...baseAppDeps(),
    projects: createInMemoryProjectRepository([project]),
    shots: createInMemoryShotRepository([shot]),
    characters: createInMemoryCharacterRepository([bundle.character]),
    textAssistant: () => Promise.resolve(recording.assistant),
  })
  const assist = (body: Record<string, unknown>) => postJson(app, `/projects/${project.id}/assist`, body)
  return { app, project, shot, bundle, seen: recording.seen, assist }
}

describe('POST /projects/:id/assist', () => {
  it('Shot の説明の案を返し、その Shot の材料（歌われる歌詞など）を渡す', async () => {
    const f = build()

    const res = await f.assist({ field: 'shot_description', current: '', instruction: 'もっと静かに', shotId: f.shot.id })

    expect(res.status).toBe(200)
    expect(((await res.json()) as Ok<{ text: string }>).data.text).toBe('青い外光の屋上')
    const request = f.seen[0]
    expect(request?.instruction).toBe('もっと静かに')
    expect(request?.context.find((line) => line.label === 'この Shot で歌われる歌詞')?.text).toBe('「夜明けの屋上で」')
  })

  it('人物の欄は人物を材料にする', async () => {
    const f = build()

    await f.assist({ field: 'identity_anchors', current: '', instruction: null, characterId: f.bundle.character.id })

    expect(f.seen[0]?.context.find((line) => line.label === '人物')?.text).toBe(f.bundle.character.displayName)
  })

  it('Shot の欄なのに Shot を言わなければ 422', async () => {
    const f = build()

    const res = await f.assist({ field: 'shot_mood', current: '', instruction: null })

    expect(res.status).toBe(422)
    expect(f.seen).toHaveLength(0)
  })

  it('AI が案を出せなければ、理由を付けて 502（サインインしていない など）', async () => {
    const f = build({
      ok: false,
      error: { code: 'cli_not_signed_in', message: 'Grok にサインインしていません' },
      costUsd: 0,
    })

    const res = await f.assist({ field: 'concept', current: '', instruction: null })

    expect(res.status).toBe(502)
    expect(((await res.json()) as ErrorBody).error).toContain('Grok にサインインしていません')
  })
})
