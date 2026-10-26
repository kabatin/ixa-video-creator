import path from 'node:path'
import { isBlank, type EnvValues } from '../lib/env-file.js'
import { storageRootOf, type RepoPaths } from '../lib/repo.js'
import type { RunResult, System } from '../system.js'
import type { CheckResult } from '../types.js'

/**
 * 任意のもの（無くても動く）。Claude Code・Codex・文字起こしのモデル・素材の置き場・課金の鍵の有無・音の解析の依存。
 * 課金の鍵は「入っている／いない」だけ（値も長さも出さない）。
 */

/** お金が掛かる・原稿が外に出る鍵。入れるかは制作者が決める。 */
export const PAID_KEYS = ['FAL_API_KEY', 'GEMINI_API_KEY', 'ELEVENLABS_API_KEY'] as const

/** 置き場の空きがこれより少なければ知らせる（動画 1 本で数百 MB になる）。 */
export const LOW_FREE_BYTES = 10 * 1024 ** 3

export type OptionalFacts = {
  readonly claude: RunResult
  readonly codex: RunResult
  readonly whisperModelCached: boolean
  readonly audioVenv: boolean
  readonly storageRoot: string
  readonly storageWritable: boolean
  readonly storageFreeBytes: number | null
  readonly paidKeys: Readonly<Record<(typeof PAID_KEYS)[number], boolean>>
}

const DOCS = 'INSTALL.md#任意'

const installed = (result: RunResult): boolean => result.kind === 'completed' && result.exitCode === 0

const cliCheck = (id: string, label: string, result: RunResult, purpose: string, url: string): CheckResult =>
  installed(result)
    ? { id, group: 'optional', level: 'ok', message: `${label} が入っています` }
    : {
        id,
        group: 'optional',
        level: 'warn',
        message: `${label} がありません（${purpose}）`,
        fix: { hint: `使うなら入れてサインインする（${url}）。入れるかは制作者が決める`, needsHuman: true },
        docs: DOCS,
      }

const gib = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`

const storageCheck = (facts: OptionalFacts): CheckResult => {
  const id = 'optional.storage'
  if (!facts.storageWritable) {
    return {
      id,
      group: 'optional',
      level: 'fail',
      message: `素材の置き場（${facts.storageRoot}）に書けません`,
      fix: { hint: '.env の STORAGE_DIR を書ける絶対パスにする', needsHuman: true },
      docs: DOCS,
    }
  }
  if (facts.storageFreeBytes !== null && facts.storageFreeBytes < LOW_FREE_BYTES) {
    return {
      id,
      group: 'optional',
      level: 'warn',
      message: `素材の置き場の空きが ${gib(facts.storageFreeBytes)} しかありません`,
      fix: { hint: '空きを作るか、.env の STORAGE_DIR を別のディスクにする', needsHuman: true },
      docs: DOCS,
    }
  }
  const free = facts.storageFreeBytes === null ? '' : `（空き ${gib(facts.storageFreeBytes)}）`
  return { id, group: 'optional', level: 'ok', message: `素材の置き場に書けます${free}` }
}

/** 判定（純粋）。 */
export const judgeOptional = (facts: OptionalFacts): readonly CheckResult[] => [
  facts.audioVenv
    ? { id: 'tools.audio-deps', group: 'tools', level: 'ok', message: '音の解析の依存が入っています' }
    : {
        id: 'tools.audio-deps',
        group: 'tools',
        level: 'fail',
        message: '音の解析の依存（apps/audio/.venv）がありません。pnpm dev で音の解析が起動しません',
        fix: { hint: 'uv で入れる（Python 3.12 も uv が用意する）', command: 'uv sync --directory apps/audio', needsHuman: false },
        docs: DOCS,
      },
  cliCheck('optional.claude', 'Claude Code', facts.claude, 'AI エージェントのタブ・絵コンテの案・絵のチェックに使う', 'https://docs.anthropic.com/en/docs/claude-code'),
  cliCheck('optional.codex', 'Codex', facts.codex, '絵コンテの画像に使う', 'https://github.com/openai/codex'),
  facts.whisperModelCached
    ? { id: 'optional.whisper-model', group: 'optional', level: 'ok', message: '文字起こしのモデル（faster-whisper small）が手元にあります' }
    : {
        id: 'optional.whisper-model',
        group: 'optional',
        level: 'skip',
        message: '文字起こしのモデル（faster-whisper small）はまだありません。初めての文字起こしのときに取ってきます（約 500 MB）',
      },
  storageCheck(facts),
  {
    id: 'optional.paid-keys',
    group: 'optional',
    level: 'ok',
    message: `課金の鍵: ${PAID_KEYS.map((key) => `${key} ${facts.paidKeys[key] ? '入っている' : '入っていない'}`).join(' / ')}（入れるかは制作者が決める）`,
  },
]

/** faster-whisper のモデルは Hugging Face の置き場に入る（`HF_HOME` があればそちら）。 */
const whisperModelDir = (homedir: string, hfHome: string | undefined): string =>
  path.join(hfHome ?? path.join(homedir, '.cache', 'huggingface'), 'hub', 'models--Systran--faster-whisper-small')

export const gatherOptional = async (system: System, env: EnvValues, repo: RepoPaths): Promise<OptionalFacts> => {
  const storageRoot = storageRootOf(env, system.homedir)
  const [claude, codex, whisperModelCached, audioVenv, storageWritable, storageFreeBytes] = await Promise.all([
    system.run('claude', ['--version'], { timeoutMs: 10_000 }),
    system.run('codex', ['--version'], { timeoutMs: 10_000 }),
    system.exists(whisperModelDir(system.homedir, process.env['HF_HOME'])),
    system.exists(repo.audioVenv),
    system.canWrite(storageRoot),
    system.freeBytes(storageRoot),
  ])
  return {
    claude,
    codex,
    whisperModelCached,
    audioVenv,
    storageRoot,
    storageWritable,
    storageFreeBytes,
    paidKeys: {
      FAL_API_KEY: !isBlank(env, 'FAL_API_KEY'),
      GEMINI_API_KEY: !isBlank(env, 'GEMINI_API_KEY'),
      ELEVENLABS_API_KEY: !isBlank(env, 'ELEVENLABS_API_KEY'),
    },
  }
}
