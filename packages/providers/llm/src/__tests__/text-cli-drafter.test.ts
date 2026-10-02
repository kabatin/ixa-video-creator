import { describe, expect, it } from 'vitest'
import { createTextCliStoryboardDrafter } from '../text-cli-drafter.js'
import type { TextCli, TextCliOutcome } from '../text-cli.js'
import { aDraftRequest, aDraftShot, aDraftedItem } from './draft-fixtures.js'

/**
 * 絵コンテの案を Codex・Grok でも（ADR-0032 の 2・4 段目）。プロンプトと確かめ方は Claude と同じ。
 */

const cliReturning = (outcome: TextCliOutcome): TextCli => ({
  tool: 'codex',
  complete: () => Promise.resolve(outcome),
})

describe('createTextCliStoryboardDrafter', () => {
  const shot = aDraftShot()

  it('返事の JSON を案にする', async () => {
    const text = JSON.stringify({ items: [aDraftedItem(shot.id)] })
    const outcome = await createTextCliStoryboardDrafter(cliReturning({ ok: true, text, costUsd: 0 })).draft(
      aDraftRequest({ shots: [shot] }),
    )

    expect(outcome).toMatchObject({ ok: true, items: [{ shotId: shot.id }] })
  })

  it('頼んだ Shot の案が足りなければ失敗にする（黙って捨てない）', async () => {
    const other = aDraftShot({ code: 'INTRO-02' })
    const text = JSON.stringify({ items: [aDraftedItem(shot.id)] })
    const outcome = await createTextCliStoryboardDrafter(cliReturning({ ok: true, text, costUsd: 0 })).draft(
      aDraftRequest({ shots: [shot, other] }),
    )

    expect(outcome).toMatchObject({ ok: false, error: { code: 'missing_shot_id' } })
  })

  it('CLI の失敗（サインインしていない など）はそのまま理由にする', async () => {
    const outcome = await createTextCliStoryboardDrafter(
      cliReturning({ ok: false, code: 'cli_not_signed_in', message: 'Grok にサインインしていません', costUsd: 0 }),
    ).draft(aDraftRequest({ shots: [shot] }))

    expect(outcome).toMatchObject({ ok: false, error: { code: 'cli_not_signed_in' } })
  })
})
