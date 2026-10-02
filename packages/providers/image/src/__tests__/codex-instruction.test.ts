import { describe, expect, it } from 'vitest'
import { buildCodexImageInstruction } from '../codex-cli/instruction.js'

/**
 * Codex へ渡す手順。絵コンテの画像（1 つの場面。比に切り抜く）と、キャラクターシート（1 枚の中に 4 つの全身を
 * 並べる。切り抜かない。ADR-0035）で守ることが違う。シートに「候補を並べない」「中央に寄せる」を言うと、
 * 4 つの向きを並べる指示とぶつかる。
 */

const frame = { label: '横長', width: 1536, height: 1024 } as const

describe('buildCodexImageInstruction', () => {
  it('場面の絵は、切り抜かれても成り立つよう中央に寄せさせ、候補を並べさせない', () => {
    const text = buildCodexImageInstruction({ prompt: '夜の屋上', frame, referenceRoles: ['subject'] })

    expect(text).toMatch(/中央寄り/)
    expect(text).toMatch(/候補を並べない/)
  })

  it('シートは端まで使わせ、描くものの並べ方に従わせる（候補を並べない・中央に寄せる、は言わない）', () => {
    const text = buildCodexImageInstruction({ prompt: '四面図', frame, referenceRoles: ['subject'], composition: 'sheet' })

    expect(text).not.toMatch(/中央寄り|候補を並べない/)
    expect(text).toMatch(/切り抜かない/)
    expect(text).toMatch(/並べ方/)
    expect(text).toMatch(/1 枚の画像/)
  })
})
