import { describe, expect, it } from 'vitest'
import { CreateUploadedSfxInput, UPLOADED_SFX_TITLE_MAX_LENGTH } from '../sfx/uploaded-sfx.js'

const PROJECT = '01ARZ3NDEKTSV4RRFFQ69G5FA0'
const SOUND = '01ARZ3NDEKTSV4RRFFQ69G5FA1'

describe('CreateUploadedSfxInput', () => {
  it('日本語の名前をそのまま受け、前後の空白は落とす', () => {
    expect(CreateUploadedSfxInput.parse({ projectId: PROJECT, mediaAssetId: SOUND, title: ' ドアの音 ' }).title).toBe('ドアの音')
  })

  it('空の名前は受けない', () => {
    expect(CreateUploadedSfxInput.safeParse({ projectId: PROJECT, mediaAssetId: SOUND, title: '  ' }).success).toBe(false)
  })

  it('長すぎる名前は受けない', () => {
    const title = 'あ'.repeat(UPLOADED_SFX_TITLE_MAX_LENGTH + 1)
    expect(CreateUploadedSfxInput.safeParse({ projectId: PROJECT, mediaAssetId: SOUND, title }).success).toBe(false)
    expect(
      CreateUploadedSfxInput.safeParse({ projectId: PROJECT, mediaAssetId: SOUND, title: title.slice(1) }).success,
    ).toBe(true)
  })

  it('素材の ID の形でなければ受けない', () => {
    expect(CreateUploadedSfxInput.safeParse({ projectId: PROJECT, mediaAssetId: 'x', title: 'ドア' }).success).toBe(false)
  })
})
