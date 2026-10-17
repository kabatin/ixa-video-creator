import { describe, expect, it } from 'vitest'
import {
  CharacterId,
  CharacterIdentityImageId,
  ImageGenerationJob,
  KEY_ART_CONCEPT_MAX_LENGTH,
  KEY_ART_INSTRUCTION_MAX_LENGTH,
  KeyArtInstruction,
  MediaAssetId,
  ModelId,
  ProjectId,
  ProviderId,
  ShotId,
  compileKeyArtPrompt,
  imageJobViolation,
  pickKeyArtReferences,
  type CharacterIdentityImage,
} from '../index.js'

/** サムネイルの背景を AI に描かせる（ADR-0051）。Shot にもキャラクターにも属さない絵のジョブ。 */

const asset = (n: number) => MediaAssetId.parse(`01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, '0')}`)

const keyArtJob = (patch: Partial<ImageGenerationJob> = {}): ImageGenerationJob =>
  ImageGenerationJob.parse({
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    projectId: ProjectId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAX'),
    kind: 'key_art',
    shotId: null,
    characterId: null,
    status: 'queued',
    instruction: '夕焼けの屋上',
    providerId: ProviderId.parse('codex-cli'),
    modelId: ModelId.parse('codex-cli/image-gen'),
    referenceAssetIds: [],
    mediaAssetId: null,
    error: null,
    providerRecord: null,
    queuedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    ...patch,
  })

describe('キーアートのジョブ', () => {
  it('Shot もキャラクターも持たない', () => {
    expect(imageJobViolation(keyArtJob())).toBeNull()
    expect(imageJobViolation(keyArtJob({ instruction: null }))).toBeNull()
    expect(imageJobViolation(keyArtJob({ shotId: ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAY') }))).toMatch(/Shot/)
    expect(imageJobViolation(keyArtJob({ characterId: CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAZ') }))).toMatch(
      /キャラクター/,
    )
  })

  it('指示はキーアートだけが持つ', () => {
    expect(
      imageJobViolation(keyArtJob({ kind: 'start_frame', shotId: ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAY') })),
    ).toMatch(/指示/)
  })

  it('前からある行（指示の列が無い）は null として読む', () => {
    const withoutInstruction = Object.fromEntries(Object.entries(keyArtJob()).filter(([key]) => key !== 'instruction'))
    expect(ImageGenerationJob.parse(withoutInstruction).instruction).toBeNull()
  })

  it('指示は 500 字まで。空は「指示なし」', () => {
    expect(KeyArtInstruction.parse('  ')).toBeNull()
    expect(KeyArtInstruction.parse(' 青空 ')).toBe('青空')
    expect(KeyArtInstruction.safeParse('あ'.repeat(KEY_ART_INSTRUCTION_MAX_LENGTH)).success).toBe(true)
    expect(KeyArtInstruction.safeParse('あ'.repeat(KEY_ART_INSTRUCTION_MAX_LENGTH + 1)).success).toBe(false)
    expect(ImageGenerationJob.safeParse({ ...keyArtJob(), instruction: 'あ'.repeat(501) }).success).toBe(false)
  })
})

describe('compileKeyArtPrompt', () => {
  const prompt = compileKeyArtPrompt({
    project: { name: 'iXA CUP', styleGuide: 'ネオンの夜', avoid: '血' },
    concept: '大会に挑む 3 人',
    cast: [{ displayName: 'はると', description: '赤いパーカー', identityAnchors: ['黒髪'] }],
    instruction: '夕焼けの屋上',
  })

  it('サムネイルの主役の絵として、顔を大きく・左に題名の余白を言う', () => {
    expect(prompt).toContain('YouTube サムネイル')
    expect(prompt).toContain('顔を大きく')
    expect(prompt).toContain('コントラスト')
    expect(prompt).toContain('左 3 分の 1')
    expect(prompt).toContain('文字・ロゴ')
  })

  it('作品の方針・登場人物・指示・避けることを入れる', () => {
    expect(prompt).toContain('はると: 黒髪、赤いパーカー')
    expect(prompt).toContain('大会に挑む 3 人')
    expect(prompt).toContain('ネオンの夜')
    expect(prompt).toContain('夕焼けの屋上')
    expect(prompt).toMatch(/避けること:\n血/)
  })

  it('制作者の指示と避けることを先に置き、長いコンセプトは縮めて最後に置く（末尾が切られても指示は残る）', () => {
    const long = compileKeyArtPrompt({
      project: { name: 'x', styleGuide: '', avoid: '血' },
      concept: 'あ'.repeat(KEY_ART_CONCEPT_MAX_LENGTH + 500),
      cast: [],
      instruction: '夕焼けの屋上',
    })
    expect(long.indexOf('夕焼けの屋上')).toBeLessThan(long.indexOf('描き方'))
    expect(long.indexOf('避けること')).toBeLessThan(long.indexOf('描き方'))
    expect(long.indexOf('作品のコンセプト')).toBeGreaterThan(long.indexOf('描き方'))
    expect(long).toContain(`${'あ'.repeat(KEY_ART_CONCEPT_MAX_LENGTH)}…`)
    expect(long).not.toContain('あ'.repeat(KEY_ART_CONCEPT_MAX_LENGTH + 1))
  })

  it('空の項目は見出しごと出さない', () => {
    const bare = compileKeyArtPrompt({
      project: { name: 'x', styleGuide: '', avoid: ' ' },
      concept: '',
      cast: [],
      instruction: null,
    })
    expect(bare).not.toContain('避けること')
    expect(bare).not.toContain('登場人物')
    expect(bare).not.toContain('制作者の指示')
  })
})

describe('pickKeyArtReferences', () => {
  const image = (n: number, role: CharacterIdentityImage['role'], isPrimary = false): CharacterIdentityImage => ({
    id: CharacterIdentityImageId.parse(`01ARZ3NDEKTSV4RRFFQ69G5E${String(n).padStart(2, '0')}`),
    characterId: CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAZ'),
    mediaAssetId: asset(n),
    role,
    isPrimary,
    order: n,
  })

  it('人物 1 人につき顔が分かる 1 枚。四面図より正面の顔', () => {
    const picked = pickKeyArtReferences({
      cast: [{ identityImages: [image(10, 'four_view', true), image(11, 'face_front')] }, { identityImages: [image(12, 'full_body')] }],
      styleReferenceIds: [],
      maxReferences: 4,
    })
    expect(picked).toEqual([asset(11), asset(12)])
  })

  it('余った枠は作品の手本画像で埋め、モデルの上限を超えない', () => {
    const picked = pickKeyArtReferences({
      cast: [{ identityImages: [image(10, 'face_front')] }, { identityImages: [image(11, 'face_front')] }],
      styleReferenceIds: [asset(20), asset(21)],
      maxReferences: 3,
    })
    expect(picked).toEqual([asset(10), asset(11), asset(20)])
    expect(pickKeyArtReferences({ cast: [], styleReferenceIds: [asset(20)], maxReferences: 0 })).toEqual([])
  })

  it('画像の無い人物は飛ばし、同じ素材は 2 度入れない', () => {
    const picked = pickKeyArtReferences({
      cast: [{ identityImages: [] }, { identityImages: [image(10, 'face_front')] }],
      styleReferenceIds: [asset(10)],
      maxReferences: 4,
    })
    expect(picked).toEqual([asset(10)])
  })
})
