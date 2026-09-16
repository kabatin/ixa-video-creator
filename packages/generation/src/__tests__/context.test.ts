import {
  CharacterId as CharacterIdSchema, LocationId as LocationIdSchema,
  MediaAssetId as MediaAssetIdSchema,
  ProjectId as ProjectIdSchema, TakeId as TakeIdSchema, WorkspaceId as WorkspaceIdSchema,
  newId, resolveReferences,
  type Character, type CharacterLook, type GenerationContextSource,
  type IdentityImageRole, type Location, type ReferenceRole, type Shot,
} from '@ixa/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createGenerationContextSource, GenerationContextError, type GenerationContextDeps,
} from '../context.js'
import {
  aShot, aTake,
  countingCharacterRepository, countingLookRepository, countingShotCharacterRepository,
  createCallRecorder,
  createInMemoryCharacterLookRepository, createInMemoryCharacterRepository,
  createInMemoryLocationRepository, createInMemoryMediaAssetRepository,
  createInMemoryShotCharacterRepository, createInMemoryShotReferenceRepository,
  createInMemoryShotRepository, createInMemoryTakeRepository,
  type InMemoryCharacterLookRepository, type InMemoryCharacterRepository,
  type InMemoryMediaAssetRepository, type InMemoryShotCharacterRepository,
  type InMemoryShotReferenceRepository,
} from '../testing.js'

/**
 * GenerationContextSource の実実装（ARCHITECTURE.md §8）。実 DB には接続しない。
 * 参照解決そのものは packages/domain のユニットテストが見る。ここが確かめるのは
 * **Port が resolveReferences に渡すデータの中身と順序**である。
 */

const workspaceId = newId(WorkspaceIdSchema)
const projectId = newId(ProjectIdSchema)

/** 参照枠 3 枚しか無いモデル（Veo / Runway）を想定した解決条件。 */
const TIGHT_ROLES: readonly ReferenceRole[] = [
  'subject', 'wardrobe', 'location', 'start_frame', 'previous_shot_last_frame',
]

let characters: InMemoryCharacterRepository
let looks: InMemoryCharacterLookRepository
let shotCharacters: InMemoryShotCharacterRepository
let shotReferences: InMemoryShotReferenceRepository
let mediaAssets: InMemoryMediaAssetRepository
let shot: Shot

const baseDeps = (): GenerationContextDeps => ({
  shotCharacters,
  characters,
  looks,
  locations: createInMemoryLocationRepository(),
  shotReferences,
  shots: createInMemoryShotRepository([shot]),
  takes: createInMemoryTakeRepository(),
  mediaAssets,
})

const buildContext = (overrides: Partial<GenerationContextDeps> = {}): GenerationContextSource =>
  createGenerationContextSource({ ...baseDeps(), ...overrides })

type RegisterOptions = {
  readonly identity?: readonly IdentityImageRole[]
  readonly wardrobe?: boolean
  readonly canonicalFrame?: boolean
}

/** Character と既定 Look を 1 組作る。画像は必要な分だけ足す。 */
const registerCharacter = async (
  name: string,
  options: RegisterOptions = {},
): Promise<{ character: Character; look: CharacterLook }> => {
  const character = await characters.create({ workspaceId, name, displayName: name })
  const look = await looks.create({
    characterId: character.id,
    key: 'STAGE_A',
    name: `${name} のステージ衣装`,
    canonicalFrameAssetId: options.canonicalFrame === true ? newId(MediaAssetIdSchema) : null,
  })
  for (const [index, role] of (options.identity ?? []).entries()) {
    await characters.addIdentityImage({
      characterId: character.id,
      mediaAssetId: newId(MediaAssetIdSchema),
      role,
      isPrimary: index === 0,
      order: index,
    })
  }
  if (options.wardrobe === true) {
    await looks.addLookImage({
      lookId: look.id,
      mediaAssetId: newId(MediaAssetIdSchema),
      role: 'wardrobe',
      isPrimary: true,
      order: 0,
    })
  }
  return { character, look }
}

const link = (
  character: Character,
  look: CharacterLook,
  prominence: 'primary' | 'secondary' | 'background',
  order: number,
) => shotCharacters.add({ shotId: shot.id, characterId: character.id, lookId: look.id, prominence, order })

beforeEach(() => {
  characters = createInMemoryCharacterRepository()
  looks = createInMemoryCharacterLookRepository()
  shotCharacters = createInMemoryShotCharacterRepository()
  shotReferences = createInMemoryShotReferenceRepository()
  mediaAssets = createInMemoryMediaAssetRepository()
  shot = aShot(projectId)
})

describe('charactersForShot', () => {
  it('識別画像と Look 画像を載せた CharacterBundle を返す', async () => {
    const { character, look } = await registerCharacter('takepi', {
      identity: ['four_view', 'face_front'],
      wardrobe: true,
    })
    await link(character, look, 'primary', 0)

    const bundles = await buildContext().charactersForShot(shot.id)

    expect(bundles).toHaveLength(1)
    expect(bundles[0]?.character.name).toBe('takepi')
    expect(bundles[0]?.look.id).toBe(look.id)
    expect(bundles[0]?.identityImages.map((image) => image.role)).toEqual([
      'four_view', 'face_front',
    ])
    expect(bundles[0]?.lookImages.map((image) => image.role)).toEqual(['wardrobe'])
  })

  it('prominence の強い順に並ぶ（切り詰めで主役が先に残るため）', async () => {
    const extra = await registerCharacter('mob')
    const lead = await registerCharacter('takepi')
    const support = await registerCharacter('kana')
    // わざと prominence と逆の order で登録する
    await link(extra.character, extra.look, 'background', 0)
    await link(support.character, support.look, 'secondary', 1)
    await link(lead.character, lead.look, 'primary', 2)

    const bundles = await buildContext().charactersForShot(shot.id)

    expect(bundles.map((bundle) => bundle.character.name)).toEqual(['takepi', 'kana', 'mob'])
  })

  it('同じ prominence 内では order 昇順に並ぶ', async () => {
    const second = await registerCharacter('kana')
    const first = await registerCharacter('takepi')
    await link(second.character, second.look, 'primary', 5)
    await link(first.character, first.look, 'primary', 1)

    const bundles = await buildContext().charactersForShot(shot.id)

    expect(bundles.map((bundle) => bundle.character.name)).toEqual(['takepi', 'kana'])
  })

  it('Character が存在しない紐づけは黙って落とさず例外にする', async () => {
    const { look } = await registerCharacter('takepi')
    await shotCharacters.add({
      shotId: shot.id,
      characterId: newId(CharacterIdSchema),
      lookId: look.id,
      prominence: 'primary',
      order: 0,
    })

    await expect(buildContext().charactersForShot(shot.id)).rejects.toBeInstanceOf(
      GenerationContextError,
    )
  })

  it('他 Character の Look を指した紐づけも例外にする', async () => {
    const owner = await registerCharacter('takepi')
    const other = await registerCharacter('kana')
    await shotCharacters.add({
      shotId: shot.id,
      characterId: owner.character.id,
      lookId: other.look.id,
      prominence: 'primary',
      order: 0,
    })

    await expect(buildContext().charactersForShot(shot.id)).rejects.toBeInstanceOf(
      GenerationContextError,
    )
  })
})

describe('N+1 を作らないこと', () => {
  /** 登場人物 N 人の Shot を新しく作り、往復の段数と呼び出し回数を測る。 */
  const measure = async (characterCount: number): Promise<{ rounds: number; calls: number }> => {
    const freshCharacters = createInMemoryCharacterRepository()
    const freshLooks = createInMemoryCharacterLookRepository()
    const freshLinks = createInMemoryShotCharacterRepository()
    const freshShot = aShot(projectId)

    for (let index = 0; index < characterCount; index += 1) {
      const character = await freshCharacters.create({
        workspaceId, name: `c${index}`, displayName: `c${index}`,
      })
      const look = await freshLooks.create({
        characterId: character.id, key: 'STAGE_A', name: 'look',
      })
      await freshLinks.add({
        shotId: freshShot.id,
        characterId: character.id,
        lookId: look.id,
        prominence: 'primary',
        order: index,
      })
    }

    const recorder = createCallRecorder()
    const context = createGenerationContextSource({
      shotCharacters: countingShotCharacterRepository(freshLinks, recorder),
      characters: countingCharacterRepository(freshCharacters, recorder),
      looks: countingLookRepository(freshLooks, recorder),
      locations: createInMemoryLocationRepository(),
      shotReferences: createInMemoryShotReferenceRepository(),
      shots: createInMemoryShotRepository([freshShot]),
      takes: createInMemoryTakeRepository(),
      mediaAssets: createInMemoryMediaAssetRepository(),
    })

    const bundles = await context.charactersForShot(freshShot.id)
    expect(bundles).toHaveLength(characterCount)

    const calls = Object.values(recorder.counts()).reduce((total, n) => total + n, 0)
    return { rounds: recorder.rounds(), calls }
  }

  it('登場人物が 1 人でも 4 人でも往復の段数は変わらない', async () => {
    const one = await measure(1)
    const four = await measure(4)

    // 紐づけの取得で 1 段、全員分の解決で 1 段。人数に比例して段が増えない。
    expect(one.rounds).toBe(2)
    expect(four.rounds).toBe(2)
    // 呼び出し自体は 1 人あたり 4 件あるが、すべて同じ段で並列に飛んでいる。
    expect(one.calls).toBe(5)
    expect(four.calls).toBe(17)
  })
})

describe('manualReferencesForShot', () => {
  it('手動追加だけを order 昇順で返す（derived_* は返さない）', async () => {
    const manualSecond = await shotReferences.create({
      shotId: shot.id, mediaAssetId: newId(MediaAssetIdSchema),
      role: 'style', weight: 1, order: 1, sourceKind: 'manual',
    })
    const manualFirst = await shotReferences.create({
      shotId: shot.id, mediaAssetId: newId(MediaAssetIdSchema),
      role: 'brand', weight: 1, order: 0, sourceKind: 'manual',
    })
    await shotReferences.create({
      shotId: shot.id, mediaAssetId: newId(MediaAssetIdSchema),
      role: 'subject', weight: 1, order: 2, sourceKind: 'derived_character',
    })

    const found = await buildContext().manualReferencesForShot(shot.id)

    expect(found.map((reference) => reference.id)).toEqual([manualFirst.id, manualSecond.id])
  })
})

describe('locationsForShot', () => {
  /** Shot に場所を割り当て、その Shot だけを持つ文脈を作る。 */
  const contextWithLocation = async (): Promise<{
    readonly context: GenerationContextSource
    readonly location: Location
    readonly located: Shot
  }> => {
    const locations = createInMemoryLocationRepository()
    const location = await locations.create({
      workspaceId,
      name: 'iXA CUP 会場',
      description: '決勝の舞台',
      referenceAssetIds: [newId(MediaAssetIdSchema)],
    })
    const located = aShot(projectId, { locationId: location.id })
    return {
      context: buildContext({ locations, shots: createInMemoryShotRepository([located]) }),
      location,
      located,
    }
  }

  it('場所が未設定なら空を返す', async () => {
    await expect(buildContext().locationsForShot(shot.id)).resolves.toEqual([])
  })

  it('割り当てられた Location を 1 件だけ返す（ADR-0015）', async () => {
    const { context, location, located } = await contextWithLocation()

    // ひと続きのカットは 1 つの場所で起きる。配列は Port の形に合わせているだけ。
    await expect(context.locationsForShot(located.id)).resolves.toEqual([location])
  })

  it('存在しない Location を指した Shot は黙って落とさず例外にする', async () => {
    const located = aShot(projectId, { locationId: newId(LocationIdSchema) })
    const context = buildContext({ shots: createInMemoryShotRepository([located]) })

    // 参照を 1 つ落とすと背景が静かに変わり、動画を見るまで気づけない。
    await expect(context.locationsForShot(located.id)).rejects.toThrow(GenerationContextError)
  })
})

describe('startFrame', () => {
  it('ai_image_to_video の keyframeTakeId から MediaAsset を返す', async () => {
    const takeId = newId(TakeIdSchema)
    const imageShot = aShot(projectId, {
      sourceType: { type: 'ai_image_to_video', keyframeTakeId: takeId },
    })
    const keyframe = aTake(imageShot, 'a'.repeat(64), { id: takeId })

    const context = buildContext({
      shots: createInMemoryShotRepository([imageShot]),
      takes: createInMemoryTakeRepository([keyframe]),
    })

    await expect(context.startFrame(imageShot.id)).resolves.toBe(keyframe.mediaAssetId)
  })

  it('ai_video の Shot では null を返す', async () => {
    await expect(buildContext().startFrame(shot.id)).resolves.toBeNull()
  })

  it('keyframeTakeId が未設定なら null を返す', async () => {
    const imageShot = aShot(projectId, {
      sourceType: { type: 'ai_image_to_video', keyframeTakeId: null },
    })
    const context = buildContext({ shots: createInMemoryShotRepository([imageShot]) })

    await expect(context.startFrame(imageShot.id)).resolves.toBeNull()
  })
})

describe('previousShotLastFrame', () => {
  it('直前の Shot の採用 Take の最終フレームを返す', async () => {
    const lastFrame = await mediaAssets.create({
      workspaceId, projectId: null, kind: 'image', storageKey: 'last-frame.png',
      mimeType: 'image/png', bytes: 1024, checksumSha256: 'a'.repeat(64),
      origin: { type: 'upload', uploadedBy: 'tester' },
    })
    const video = await mediaAssets.create({
      workspaceId, projectId: null, kind: 'video', storageKey: 'take.mp4',
      mimeType: 'video/mp4', bytes: 4096, checksumSha256: 'b'.repeat(64),
      origin: { type: 'upload', uploadedBy: 'tester' },
      lastFrameAssetId: lastFrame.id,
    })

    const first = aShot(projectId, { order: 1000, code: 'shot_001' })
    const take = aTake(first, 'c'.repeat(64), { mediaAssetId: video.id })
    // order は 1000 刻みで連番ではない。間が空いていても直前として拾えること。
    const second = aShot(projectId, { order: 3000, code: 'shot_002' })

    const context = buildContext({
      shots: createInMemoryShotRepository([{ ...first, selectedTakeId: take.id }, second]),
      takes: createInMemoryTakeRepository([take]),
    })

    await expect(context.previousShotLastFrame(second.id)).resolves.toBe(lastFrame.id)
    // 先頭の Shot には前が無い
    await expect(context.previousShotLastFrame(first.id)).resolves.toBeNull()
  })

  it('前 Shot に採用 Take が無ければ null を返す', async () => {
    const first = aShot(projectId, { order: 1000, code: 'shot_001' })
    const second = aShot(projectId, { order: 2000, code: 'shot_002' })
    const context = buildContext({ shots: createInMemoryShotRepository([first, second]) })

    await expect(context.previousShotLastFrame(second.id)).resolves.toBeNull()
  })
})

describe('resolveReferences との統合（ARCHITECTURE.md §8）', () => {
  /** Port が返した値をそのまま resolveReferences へ流し込む。 */
  const resolveVia = async (context: GenerationContextSource, maxReferences: number) => {
    const [bundles, locations, manualReferences, previousShotLastFrameId, startFrameId] =
      await Promise.all([
        context.charactersForShot(shot.id),
        context.locationsForShot(shot.id),
        context.manualReferencesForShot(shot.id),
        context.previousShotLastFrame(shot.id),
        context.startFrame(shot.id),
      ])
    return resolveReferences({
      characters: bundles,
      locations,
      manualReferences,
      previousShotLastFrameId,
      startFrameId,
      maxReferences,
      supportedRoles: TIGHT_ROLES,
    })
  }

  it('参照枠 3 枚のモデルでは個別の識別画像ではなく四面図 1 枚に集約される', async () => {
    const { character, look } = await registerCharacter('takepi', {
      identity: ['four_view', 'face_front', 'full_body'],
      wardrobe: true,
      canonicalFrame: true,
    })
    await link(character, look, 'primary', 0)

    const resolved = await resolveVia(buildContext(), 3)

    expect(resolved).toHaveLength(3)
    expect(resolved.map((reference) => reference.origin)).toContain('four_view:takepi')
    // 四面図が 1 枠で兼ねるので、個別の識別画像は 1 枚も入らない
    expect(resolved.some((reference) => reference.origin.startsWith('identity:'))).toBe(false)
    // 空いた枠が衣装に回る
    expect(resolved.some((reference) => reference.role === 'wardrobe')).toBe(true)
  })

  it('canonical frame を持つ Look では、それが最優先で残る', async () => {
    const { character, look } = await registerCharacter('takepi', {
      identity: ['four_view', 'face_front'],
      wardrobe: true,
      canonicalFrame: true,
    })
    await link(character, look, 'primary', 0)

    const resolved = await resolveVia(buildContext(), 1)

    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.origin).toBe('canonical:takepi/STAGE_A')
    expect(resolved[0]?.mediaAssetId).toBe(look.canonicalFrameAssetId)
  })
})
