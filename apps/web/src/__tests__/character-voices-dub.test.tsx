import { Character, CharacterId, MediaAssetId, ProjectId, VoiceProfileId, WorkspaceId, newId } from '@ixa/domain'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CharacterVoices } from '@/components/workbench/inspector/character-voices'
import { ApiError } from '@/lib/api-error'
import type { WireVoice } from '@/lib/narration-api'
import { PROJECT_ID } from './fixtures'
import { assetStoreValue, renderInWorkbench } from './workbench-fixture'

/**
 * キャラクターの「セリフの声」と「距離の既定」、声の一覧の「説明から声を作る」（ADR-0062）。
 */

const api = vi.hoisted(() => ({ mediaUrl: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ createApiClient: () => api }))

const cat = Character.parse({
  id: newId(CharacterId),
  workspaceId: newId(WorkspaceId),
  projectId: ProjectId.parse(PROJECT_ID),
  name: 'neko',
  displayName: 'ネコ',
  speakerNo: 1,
  createdAt: new Date('2026-10-26T00:00:00.000Z'),
})

const voice = (name: string, characterId: CharacterId | null): WireVoice => ({
  id: newId(VoiceProfileId),
  projectId: ProjectId.parse(PROJECT_ID),
  name,
  tool: 'gemini_api',
  model: 'gemini-3.8-flash-tts',
  voiceName: 'Kore',
  styleNote: '',
  speed: 1,
  volume: 1,
  language: 'ja',
  tuning: {},
  textStyleId: null,
  characterId,
  designedVoice: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
})

const mine = voice('ネコのふだん', cat.id)
const others = voice('ナレーター', null)

const setup = () => {
  const store = assetStoreValue({ voices: { state: 'ready', value: [mine, others] } })
  const updateCharacter = vi.fn(() => Promise.resolve(cat))
  const designVoice = vi.fn()
  const actions = { ...store.actions, updateCharacter, designVoice }
  renderInWorkbench(<CharacterVoices character={cat} />, {}, { ...store, actions })
  return { updateCharacter, designVoice }
}

beforeEach(() => {
  api.mediaUrl.mockReset().mockResolvedValue({ url: 'http://127.0.0.1:3001/files/sample.wav', expiresInSec: 300 })
})

describe('CharacterVoices のセリフの声', () => {
  it('セリフの声はこの人の声から選び、選んだ時点で保存する', async () => {
    const { updateCharacter } = setup()
    const select = screen.getByRole('combobox', { name: 'セリフの声' })
    expect([...(select as HTMLSelectElement).options].map((option) => option.text)).toEqual(['なし', 'ネコのふだん'])
    await userEvent.selectOptions(select, mine.id)
    await waitFor(() => {
      expect(updateCharacter).toHaveBeenCalledWith(cat.id, { dialogueVoiceProfileId: mine.id })
    })
  })

  it('距離の既定は -40〜12 dB。外れた値は保存しない', async () => {
    const { updateCharacter } = setup()
    const field = screen.getByRole('textbox', { name: '距離の既定（dB）' })
    await userEvent.clear(field)
    await userEvent.type(field, '20')
    await userEvent.tab()
    expect(await screen.findByText('距離は -40〜12 dB で入れてください')).toBeTruthy()
    expect(updateCharacter).not.toHaveBeenCalled()
    await userEvent.clear(field)
    await userEvent.type(field, '-9.5')
    await userEvent.tab()
    await waitFor(() => {
      expect(updateCharacter).toHaveBeenCalledWith(cat.id, { dialogueLevelDb: -9.5 })
    })
  })
})

describe('説明から声を作る', () => {
  it('説明・性別・名前で作り、試し聞きを出し、「セリフの声にする」でこの人のセリフの声にする', async () => {
    const { designVoice, updateCharacter } = setup()
    const made = { ...voice('ネコのセリフの声', cat.id), voiceName: 'voice_abc' }
    const sample = newId(MediaAssetId)
    designVoice.mockResolvedValue({ voice: made, sampleMediaAssetId: sample })
    await userEvent.click(screen.getByRole('button', { name: '説明から声を作る' }))
    const dialog = screen.getByRole('dialog', { name: '説明から声を作る' })
    await userEvent.type(screen.getByRole('textbox', { name: '説明' }), 'やわらかく、いたずらっぽい若い女性の声')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '性別' }), 'female')
    await userEvent.click(screen.getByRole('button', { name: '作って試し聞き' }))
    await waitFor(() => {
      expect(designVoice).toHaveBeenCalledWith(cat.id, {
        description: 'やわらかく、いたずらっぽい若い女性の声',
        gender: 'female',
        displayName: 'ネコのセリフの声',
      })
    })
    expect(await screen.findByText('✓ 「ネコのセリフの声」を作って、声の一覧に保存しました')).toBeTruthy()
    expect(api.mediaUrl).toHaveBeenCalledWith(sample)
    expect(dialog.querySelector('audio')).not.toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'セリフの声にする' }))
    await waitFor(() => {
      expect(updateCharacter).toHaveBeenCalledWith(cat.id, { dialogueVoiceProfileId: made.id })
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '説明から声を作る' })).toBeNull()
    })
  })

  it('説明が空なら頼まない。作れなければ理由を出す', async () => {
    const { designVoice } = setup()
    await userEvent.click(screen.getByRole('button', { name: '説明から声を作る' }))
    await userEvent.click(screen.getByRole('button', { name: '作って試し聞き' }))
    expect((await screen.findByRole('alert')).textContent).toBe('説明を入れてください')
    expect(designVoice).not.toHaveBeenCalled()

    designVoice.mockRejectedValue(
      new ApiError('POST: 503', 503, JSON.stringify({ success: false, error: '説明から声を作れません（Gemini の鍵の名札が未設定です）' })),
    )
    await userEvent.type(screen.getByRole('textbox', { name: '説明' }), '低い声')
    await userEvent.click(screen.getByRole('button', { name: '作って試し聞き' }))
    expect((await screen.findByRole('alert')).textContent).toContain('説明から声を作れません（Gemini の鍵の名札が未設定です）')
  })
})
