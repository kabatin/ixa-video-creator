import dns from 'node:dns'
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LAN_CONNECT_ATTEMPT_TIMEOUT_MS, tolerateSlowLan } from '../local-server/lan-connections.js'

describe('tolerateSlowLan', () => {
  const before = {
    order: dns.getDefaultResultOrder(),
    timeout: net.getDefaultAutoSelectFamilyAttemptTimeout(),
  }
  afterEach(() => {
    dns.setDefaultResultOrder(before.order)
    net.setDefaultAutoSelectFamilyAttemptTimeout(before.timeout)
  })

  // Node の既定は 1 宛先 250ms。Wi-Fi 越しの vpipe はそれを超え、全宛先が ETIMEDOUT になった（2026-10-14）。
  it('1 宛先あたりの接続の待ちを Node の既定 250ms より長くする', () => {
    tolerateSlowLan()
    expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(LAN_CONNECT_ATTEMPT_TIMEOUT_MS)
    expect(LAN_CONNECT_ATTEMPT_TIMEOUT_MS).toBeGreaterThan(250)
  })

  it('IPv4 を先に試す（.local は届かない IPv6 を先に返す）', () => {
    dns.setDefaultResultOrder('verbatim')
    tolerateSlowLan()
    expect(dns.getDefaultResultOrder()).toBe('ipv4first')
  })
})
