import { describe, expect, it } from 'vitest'
import { judgeTools, type ToolFacts, type ToolName } from '../checks/tools.js'
import type { RunResult } from '../system.js'

const done = (stdout: string): RunResult => ({ kind: 'completed', exitCode: 0, stdout, stderr: '' })
const missing: RunResult = { kind: 'not_found' }
const broken: RunResult = { kind: 'completed', exitCode: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' }

const allPresent: Record<ToolName, RunResult> = {
  pnpm: done('9.15.4'),
  git: done('git version 2.50.1'),
  docker: done('Docker version 27.1.0, build x'),
  dockerDaemon: done('27.1.0'),
  compose: done('Docker Compose version v2.29.0'),
  ffmpeg: done('ffmpeg version 7.1 Copyright'),
  ffprobe: done('ffprobe version 7.1 Copyright'),
  uv: done('uv 0.9.26'),
  brew: done('Homebrew 4.4.0'),
}

const facts = (over: Partial<Record<ToolName, RunResult>> = {}, nodeVersion = '22.11.0'): ToolFacts => ({
  nodeVersion,
  expectedPnpm: '9.15.4',
  results: { ...allPresent, ...over },
})

const byId = (results: ReturnType<typeof judgeTools>, id: string) => results.find((r) => r.id === id)

describe('judgeTools（道具の判定）', () => {
  it('全部あれば ✓ だけ', () => {
    expect(judgeTools(facts()).every((r) => r.level === 'ok')).toBe(true)
  })

  it('Node 20 は古い（✗）。入れ方は人の同意が要る', () => {
    const node = byId(judgeTools(facts({}, '20.18.0')), 'tools.node')
    expect(node?.level).toBe('fail')
    expect(node?.fix?.needsHuman).toBe(true)
  })

  it('pnpm の版が少し違えば !、major が違えば ✗。直し方は corepack', () => {
    expect(byId(judgeTools(facts({ pnpm: done('9.12.0') })), 'tools.pnpm')?.level).toBe('warn')
    const major = byId(judgeTools(facts({ pnpm: done('8.15.0') })), 'tools.pnpm')
    expect(major?.level).toBe('fail')
    expect(major?.fix?.command).toContain('corepack prepare pnpm@9.15.4')
  })

  it('FFmpeg が無ければ brew install ffmpeg を出す（入れない・人の同意が要る）', () => {
    const ffmpeg = byId(judgeTools(facts({ ffmpeg: missing })), 'tools.ffmpeg')
    expect(ffmpeg?.level).toBe('fail')
    expect(ffmpeg?.fix).toMatchObject({ command: 'brew install ffmpeg', needsHuman: true })
  })

  it('Homebrew も無ければ、brew の 1 行ではなく Homebrew の入れ方を案内する', () => {
    const uv = byId(judgeTools(facts({ uv: missing, brew: missing })), 'tools.uv')
    expect(uv?.fix?.command).toBeUndefined()
    expect(uv?.fix?.hint).toContain('https://brew.sh')
  })

  it('Docker が無ければ Docker Desktop を入れてもらう（人）。動いているかは見ない', () => {
    const results = judgeTools(facts({ docker: missing, dockerDaemon: missing, compose: missing }))
    expect(byId(results, 'tools.docker')?.fix?.needsHuman).toBe(true)
    expect(byId(results, 'tools.docker-running')?.level).toBe('skip')
  })

  it('Docker が止まっていれば open -a Docker（人の同意は要らない）', () => {
    const running = byId(judgeTools(facts({ dockerDaemon: broken })), 'tools.docker-running')
    expect(running?.level).toBe('fail')
    expect(running?.fix).toMatchObject({ command: 'open -a Docker', needsHuman: false })
  })
})
