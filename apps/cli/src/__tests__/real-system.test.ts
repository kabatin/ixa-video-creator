import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
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

describe('run（端末につないだ子と Ctrl+C）', () => {
  // 本物の SIGINT は別のプロセス（fixtures/sigint-while-child.ts）に送る。テストのプロセスを巻き込まない。
  // 確かめるのは「CLI が子より先に落ちない・子の終了コードを返す・終わったら手を離す」まで。
  // Ctrl+C が子に届くのは端末が同じプロセスグループ全体へ送るからで、ここでは子は自分で終わる。
  it('子が動いている間は SIGINT で先に落ちず、子の本当の終了コードを返し、終わったら手を離す', () => {
    const tsx = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url))
    const fixture = fileURLToPath(new URL('./fixtures/sigint-while-child.ts', import.meta.url))
    const ran = spawnSync(tsx, [fixture], { encoding: 'utf8', timeout: 20_000 })
    expect({ status: ran.status, signal: ran.signal, stdout: ran.stdout }).toEqual({
      status: 0,
      signal: null,
      stdout: 'child:7\nlisteners:0\n',
    })
  })
})
