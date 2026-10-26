import { describe, expect, it } from 'vitest'
import { createOutput } from '../printer.js'
import { errorPayload, redactUrls } from '../lib/errors.js'
import { runSteps } from '../setup/run-steps.js'
import { parseMarker, pendingCheck, pendingUpdateStep } from '../update/marker.js'

const marker = { from: '0.8.0', to: '0.9.0', ref: 'v0.9.0', main: false, at: '2026-10-27T00:00:00.000Z' }

describe('更新の途中の印', () => {
  it('印を読む。形が違えば null（壊れた印で止まり続けない）', () => {
    expect(parseMarker(JSON.stringify(marker))).toEqual(marker)
    expect(parseMarker('{"from":"x"}')).toBeNull()
    expect(parseMarker('not json')).toBeNull()
  })

  it('印があれば、update は「最新です」と言わず続きを勧める', () => {
    expect(pendingUpdateStep(marker)).toMatchObject({
      id: 'update.pending',
      status: 'failed',
      fix: { command: 'pnpm -s ixa update --resume', needsHuman: false },
    })
    expect(pendingUpdateStep(marker).message).toContain('0.8.0 → 0.9.0')
  })

  it('doctor も ✗ で続きを勧める。印が無ければ ✓', () => {
    expect(pendingCheck(marker)).toMatchObject({ id: 'tools.update-pending', level: 'fail', fix: { command: 'pnpm -s ixa update --resume' } })
    expect(pendingCheck(null).level).toBe('ok')
  })
})

describe('途中で投げても、失敗の手順と直し方にする', () => {
  it('手順が投げたら failed にして、そこで止める（続きの直し方つき）', async () => {
    const ran: string[] = []
    const results = await runSteps(
      {},
      [
        () => Promise.resolve({ id: 'a', status: 'done', message: 'a' }),
        () => Promise.reject(new Error('postgresql://ixa:secret@127.0.0.1:5432/ixa に届きません')),
        () => {
          ran.push('c')
          return Promise.resolve({ id: 'c', status: 'done', message: 'c' })
        },
      ],
      createOutput(true),
      'pnpm -s ixa setup',
    )
    expect(results.map((r) => r.status)).toEqual(['done', 'failed'])
    expect(results[1]?.fix?.command).toBe('pnpm -s ixa setup')
    expect(results[1]?.message).not.toContain('secret')
    expect(ran).toEqual([])
  })

  it('URL の合言葉を伏せる', () => {
    expect(redactUrls('redis://:pw@127.0.0.1:6379 と postgresql://u:p@h/db')).toBe('redis://***@127.0.0.1:6379 と postgresql://***@h/db')
  })

  it('最上位で投げたら、--json なら JSON 1 つにする（コマンドの名前つき）', () => {
    expect(errorPayload(['update', '--json'], new Error('x'))).toEqual({ command: 'update', ok: false, error: 'x' })
    expect(errorPayload(['--', 'doctor'], 'y')).toEqual({ command: 'doctor', ok: false, error: 'y' })
  })
})
