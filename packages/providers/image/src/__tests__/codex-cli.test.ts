import { describe, expect, it } from 'vitest'
import {
  codexCliImageModel,
  CODEX_CLI_PROVIDER_ID,
} from '../codex-cli/descriptor.js'
import {
  CODEX_CLI_NOT_IMPLEMENTED_MESSAGE,
  createCodexCliImageProvider,
} from '../codex-cli/provider.js'
import { makeImageRequest } from './fixtures.js'

/**
 * **このテストは「まだ実装されていない」ことを固定している**（ADR-0012 の Follow-up）。
 * `codex exec` での非対話実行と出力パス取得を実装したら、このファイルごと書き換えること。
 * 実装したのにテストが通り続ける、という状態にならないようにしてある。
 */
const provider = () =>
  createCodexCliImageProvider({ workingDirRoot: '/tmp/ixa-codex-cli' })

const handle = () => ({
  providerId: CODEX_CLI_PROVIDER_ID,
  modelId: codexCliImageModel.id,
  ref: 'not-submitted',
  submittedAt: new Date(),
})

describe('Codex CLI 画像アダプタ（未実装）', () => {
  it('submit は明示的なエラーで失敗する', async () => {
    await expect(provider().submit(makeImageRequest(codexCliImageModel))).rejects.toThrow(
      'Codex CLI アダプタは未実装です（ADR-0012 の Follow-up）',
    )
  })

  it('poll と cancel も同じく未実装であることを明示する', async () => {
    await expect(provider().poll(handle())).rejects.toThrow(CODEX_CLI_NOT_IMPLEMENTED_MESSAGE)
    await expect(provider().cancel(handle())).rejects.toThrow(CODEX_CLI_NOT_IMPLEMENTED_MESSAGE)
  })

  it('不正な設定は Provider の生成時点で弾く', () => {
    expect(() => createCodexCliImageProvider({ workingDirRoot: '' })).toThrow()
    expect(() =>
      createCodexCliImageProvider({ workingDirRoot: '/tmp/x', timeoutMs: 0 }),
    ).toThrow()
  })

  it('型と capability 宣言だけは今の時点で持つ', () => {
    const instance = provider()
    expect(instance.id).toBe(CODEX_CLI_PROVIDER_ID)
    expect(instance.models).toHaveLength(1)

    const caps = codexCliImageModel.capabilities
    // 参照画像の上限は未確認のため 4 枚と控えめに宣言している（descriptor.ts のコメント参照）
    expect(caps.referenceImages.max).toBe(4)
    // マスク編集は OpenAI 側の機能として対応（ARCHITECTURE.md §9）
    expect(caps.maskEdit).toBe(true)
    expect(caps.seed).toBe(false)
  })
})
