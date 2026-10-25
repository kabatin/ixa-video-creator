import { MAX_DIALOGUE_LINES, WorkspaceId as WorkspaceIdSchema, newId, type ProjectId } from '@ixa/domain'
import {
  aShot,
  createInMemoryCharacterRepository,
  createInMemoryShotRepository,
  type InMemoryCharacterRepository,
} from '@ixa/generation/testing'
import { createProviderRegistry } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import type { AppDeps } from '../app.js'
import type { CharacterResponse } from '../routes/characters.js'
import type { ShotResponse } from '../routes/shots.js'
import { baseAppDeps, createTestApp } from './app-deps.js'
import { aProject, createTestContextSource } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { postJson, type ErrorBody, type Ok } from './shot-test-support.js'
import { createTestVideoProvider, testModel } from './test-video-provider.js'

/**
 * Shot のセリフ（ADR-0059）。PATCH で行を丸ごと置き換え、応答に警告を載せる。
 * 話し手は同じプロジェクトのキャラクターだけ。話し手の呼び名か声の説明が無ければ、Take を作る前に止める。
 */

const VOICED_MODEL = testModel({ id: 'test/voiced', capabilities: { audioGeneration: true } })

const patchJson = (app: ReturnType<typeof createTestApp>, path: string, body: unknown) =>
  app.request(path, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const setup = async (characters: InMemoryCharacterRepository = createInMemoryCharacterRepository()) => {
  const project = aProject()
  const other = aProject()
  const shot = aShot(project.id)
  const shots = createInMemoryShotRepository([shot])
  const create = (projectId: ProjectId, name: string, voiced: boolean) =>
    characters.create({
      workspaceId: newId(WorkspaceIdSchema),
      projectId,
      name,
      displayName: name,
      ...(voiced ? { speechName: 'The cat', voiceDescription: "a soft, sly, teasing young woman's voice" } : {}),
    })
  const cat = await create(project.id, 'ネコ', true)
  const bare = await create(project.id, 'ネズミ', false)
  const foreign = await create(other.id, 'よその人', true)
  const deps: AppDeps = {
    ...baseAppDeps(),
    projects: createInMemoryProjectRepository([project, other]),
    shots,
    characters,
    registry: createProviderRegistry([createTestVideoProvider([VOICED_MODEL])]),
  }
  return { deps, app: createTestApp(deps), project, shot, shots, cat, bare, foreign }
}

const line = (speakerId: string, text = 'ねえ、ネズミくん。') => ({ speakerId, text })

describe('PATCH /shots/:id の dialogue', () => {
  it('行を丸ごと置き換えて保存し、応答に行と空の警告を返す', async () => {
    const f = await setup()
    const res = await patchJson(f.app, `/shots/${f.shot.id}`, { dialogue: [line(f.cat.id)] })

    expect(res.status).toBe(200)
    const { data } = (await res.json()) as Ok<ShotResponse>
    expect(data.dialogue).toEqual([{ speakerId: f.cat.id, text: 'ねえ、ネズミくん。', offscreen: false, translation: null }])
    expect(data.dialogueWarnings).toEqual([])
    expect(f.shots.snapshot()[0]?.dialogue).toHaveLength(1)
  })

  it('5 行以上は保存して、長すぎるという警告を返す', async () => {
    const f = await setup()
    const res = await patchJson(f.app, `/shots/${f.shot.id}`, {
      dialogue: Array.from({ length: 5 }, () => line(f.cat.id, 'あ')),
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as Ok<ShotResponse>).data.dialogueWarnings).toEqual([
      { code: 'too_many_lines', message: '長すぎます（10 秒に 3〜4 行まで）' },
    ])
  })

  it(`${String(MAX_DIALOGUE_LINES)} 行を超えたら 422`, async () => {
    const f = await setup()
    const res = await patchJson(f.app, `/shots/${f.shot.id}`, {
      dialogue: Array.from({ length: MAX_DIALOGUE_LINES + 1 }, () => line(f.cat.id, 'あ')),
    })
    expect(res.status).toBe(422)
  })

  it('ほかのプロジェクトのキャラクター・無いキャラクターを話し手にしたら 422', async () => {
    const f = await setup()
    const foreign = await patchJson(f.app, `/shots/${f.shot.id}`, { dialogue: [line(f.foreign.id)] })
    expect(foreign.status).toBe(422)
    expect(((await foreign.json()) as ErrorBody).fields?.dialogue?.[0]).toContain('この Project のキャラクターではありません')

    const missing = await patchJson(f.app, `/shots/${f.shot.id}`, { dialogue: [line('01ARZ3NDEKTSV4RRFFQ69G5FZZ')] })
    expect(missing.status).toBe(422)
    expect(f.shots.snapshot()[0]?.dialogue).toEqual([])
  })
})

describe('PATCH /characters/:id の呼び名と声の説明', () => {
  it('英語の呼び名と声の説明を保存し、話し手の番号を返す', async () => {
    const f = await setup()
    const res = await patchJson(f.app, `/characters/${f.bare.id}`, {
      speechName: 'The mouse',
      voiceDescription: "a small, nervous boy's voice",
    })
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as Ok<CharacterResponse>
    expect(data).toMatchObject({ speechName: 'The mouse', voiceDescription: "a small, nervous boy's voice", speakerNo: 2 })
  })
})

describe('セリフのある Shot の生成', () => {
  it('話し手に呼び名が無ければ、Take を作る前に理由を添えて 422', async () => {
    const f = await setup()
    await patchJson(f.app, `/shots/${f.shot.id}`, { dialogue: [line(f.bare.id)] })
    const app = createTestApp({ ...f.deps, generationContext: createTestContextSource({ speakers: [f.bare] }) })

    const res = await postJson(app, `/shots/${f.shot.id}/generate`, { model: 'test/voiced' })

    expect(res.status).toBe(422)
    expect(JSON.stringify(await res.json())).toContain('セリフの話し手「ネズミ」に英語の呼び名がありません')
  })

  it('話し手がそろっていれば受け付ける', async () => {
    const f = await setup()
    await patchJson(f.app, `/shots/${f.shot.id}`, { dialogue: [line(f.cat.id)] })
    const app = createTestApp({ ...f.deps, generationContext: createTestContextSource({ speakers: [f.cat] }) })

    const res = await postJson(app, `/shots/${f.shot.id}/generate`, { model: 'test/voiced' })

    expect(res.status).toBe(202)
  })
})

describe('POST /projects/:projectId/storyboard/cuts の dialogues', () => {
  it('カットごとにセリフを付けて作る。重なって飛ばしたカットがあっても、残ったカットに正しい行が付く', async () => {
    const f = await setup()
    // 既存の Shot（0〜3.75 秒）と重なる 1 つ目のカットは作らない
    const res = await postJson(f.app, `/projects/${f.project.id}/storyboard/cuts`, {
      boundariesSec: [0, 3.75, 6, 9],
      dialogues: [[line(f.cat.id, 'とばされる')], [], [line(f.cat.id, 'のこる')]],
    })
    expect(res.status).toBe(201)
    const { data } = (await res.json()) as Ok<{ shots: ShotResponse[] }>
    expect(data.shots.map((s) => s.dialogue.map((l) => l.text))).toEqual([[], ['のこる']])
  })

  it('カットの数と長さが合わなければ 422', async () => {
    const f = await setup()
    const res = await postJson(f.app, `/projects/${f.project.id}/storyboard/cuts`, {
      boundariesSec: [10, 12, 14],
      dialogues: [[line(f.cat.id)]],
    })
    expect(res.status).toBe(422)
  })

  it('ほかのプロジェクトのキャラクターが話し手なら 422 で何も作らない', async () => {
    const f = await setup()
    const res = await postJson(f.app, `/projects/${f.project.id}/storyboard/cuts`, {
      boundariesSec: [10, 12],
      dialogues: [[line(f.foreign.id)]],
    })
    expect(res.status).toBe(422)
    expect(f.shots.snapshot()).toHaveLength(1)
  })
})
