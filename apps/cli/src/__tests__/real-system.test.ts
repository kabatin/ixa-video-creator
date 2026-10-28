import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { readSecretLine, type SecretInput } from '../real-system.js'

/** raw モードの端末の偽物。`emit('data' | 'end')` で打鍵と閉じを起こす。 */
const fakeTty = (): EventEmitter & SecretInput => {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    isTTY: true,
    setRawMode: () => emitter,
    setEncoding: () => emitter,
    resume: () => emitter,
    pause: () => emitter,
  }) as unknown as EventEmitter & SecretInput
}

describe('readSecretLine（promptSecret）', () => {
  it('Enter までを返し、打った文字は出さない', async () => {
    const input = fakeTty()
    const written: string[] = []
    const answer = readSecretLine(input, (t) => written.push(t), 'code: ')
    input.emit('data', 'ab\u007fc\r')
    expect(await answer).toBe('ac')
    expect(written.join('')).toBe('code: \n')
  })

  it('stdin が閉じたら null で返る（待ち続けない）', async () => {
    const input = fakeTty()
    const answer = readSecretLine(input, () => undefined, 'code: ')
    input.emit('data', 'partial')
    input.emit('end')
    expect(await answer).toBeNull()
    expect(input.listenerCount('data')).toBe(0)
  })
})
