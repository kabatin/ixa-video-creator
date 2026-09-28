import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CapabilityViolationError, type CliInvocation, type CliRunResult } from '@ixa/provider-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { codexCliImageModel, CODEX_CLI_PROVIDER_ID, codexFrameFor } from '../codex-cli/descriptor.js'
import { createCodexCliImageProvider } from '../codex-cli/provider.js'
import {
  assetId,
  createTempDir,
  makeImageRequest,
  pollUntilSettled,
  removeTempDir,
} from './fixtures.js'

/**
 * Codex CLI の画像アダプタ（ADR-0012 / ADR-0029）の契約テスト。**実 CLI は叩かない。**
 *
 * 偽の CLI は実測（2026-09-28、codex-cli 0.154.0）どおりに振る舞う:
 * - 指示は stdin で受ける（`-i` が複数の値を取り、後ろに置いた指示を画像として食うため）
 * - 画像は `$CODEX_HOME/generated_images/<thread_id>/exec-*.png` にでき、指示すれば作業ディレクトリへ写す
 * - `--json` の最初の出来事 `thread.started` に thread_id が出る
 */

const THREAD_ID = '01a0e7da-cff4-7940-b276-37ca86f3e922'
const PNG = Buffer.from('89504e470d0a1a0a', 'hex')
const threadStarted = `${JSON.stringify({ type: 'thread.started', thread_id: THREAD_ID })}\n`

let root: string
let codexHome: string
let refsDir: string
beforeEach(async () => {
  root = await createTempDir()
  codexHome = join(root, 'codex-home')
  refsDir = join(root, 'refs')
  await mkdir(refsDir, { recursive: true })
})
afterEach(async () => {
  await removeTempDir(root)
})

type FakeCli = {
  readonly calls: CliInvocation[]
  readonly runner: (invocation: CliInvocation) => Promise<CliRunResult>
}

/** 実測どおりの偽 CLI。`copy` が false なら作業ディレクトリへは写さない（CODEX_HOME にだけ残る）。 */
const fakeCli = (behaviour: { copy?: boolean; image?: boolean; result?: CliRunResult } = {}): FakeCli => {
  const calls: CliInvocation[] = []
  return {
    calls,
    runner: async (invocation) => {
      calls.push(invocation)
      if (invocation.args[0] === '--version') {
        return { kind: 'completed', exitCode: 0, stdout: 'codex-cli 0.154.0\n', stderr: '' }
      }
      if (behaviour.result !== undefined) return behaviour.result
      if (behaviour.image !== false) {
        const generated = join(codexHome, 'generated_images', THREAD_ID)
        await mkdir(generated, { recursive: true })
        await writeFile(join(generated, 'exec-1.png'), PNG)
        if (behaviour.copy !== false && invocation.cwd !== undefined) {
          await writeFile(join(invocation.cwd, 'frame.png'), PNG)
        }
      }
      return { kind: 'completed', exitCode: 0, stdout: threadStarted, stderr: 'Reading prompt from stdin...\n' }
    },
  }
}

const frame = codexFrameFor('16:9')
const storyboardRequest = (references: { path: string }[] = []) =>
  makeImageRequest(codexCliImageModel, {
    prompt: '夜明け前のガレージ。作業台にマットブラックのヘルメット',
    resolution: { width: frame.width, height: frame.height },
    aspectRatio: '16:9',
    references: references.map((_, index) => ({
      mediaAssetId: assetId(`01ARZ3NDEKTSV4RRFFQ69G5FA${String(index)}`),
      role: 'subject' as const,
    })),
    resolveReference: (id) => {
      const index = Number(id.slice(-1))
      const reference = references[index]
      return reference === undefined ? Promise.reject(new Error('未知の参照')) : Promise.resolve(reference.path)
    },
  })

const providerWith = (cli: FakeCli) =>
  createCodexCliImageProvider({ workingDirRoot: join(root, 'work'), codexHome, runner: cli.runner })

const run = async (cli: FakeCli, references: { path: string }[] = []) => {
  const provider = providerWith(cli)
  const handle = await provider.submit(storyboardRequest(references))
  return { handle, status: await pollUntilSettled(provider, handle) }
}

describe('Codex CLI 画像アダプタ', () => {
  it('作業ディレクトリを切り、指示を stdin で渡し、参照は -i で添える', async () => {
    const cli = fakeCli()
    const ref = join(refsDir, 'takepi.png')
    await writeFile(ref, PNG)

    await run(cli, [{ path: ref }])

    const call = cli.calls.find((invocation) => invocation.args[0] === 'exec')
    expect(call?.command).toBe('codex')
    expect(call?.args).toEqual(
      expect.arrayContaining(['exec', '--skip-git-repo-check', '--ephemeral', '--json', '-i', ref]),
    )
    expect(call?.args.join(' ')).toContain('--sandbox workspace-write')
    expect(call?.args).toContain(call?.cwd)
    // 指示は引数に置かない（`-i` に食われる）。stdin に全部入れる。
    expect(call?.args.join(' ')).not.toContain('ガレージ')
    expect(call?.stdin).toContain('ガレージ')
    expect(call?.stdin).toContain('frame.png')
    expect(call?.stdin).toContain(`${String(frame.width)}x${String(frame.height)}`)
    expect(call?.stdin).toContain('参照画像 1')
  })

  it('作業ディレクトリに写した絵を返す', async () => {
    const { handle, status } = await run(fakeCli())

    expect(status.state).toBe('succeeded')
    if (status.state !== 'succeeded') return
    expect(status.outputs).toEqual([{ type: 'local', path: join(root, 'work', handle.ref, 'frame.png') }])
    expect(status.costUsd).toBe(0)
  })

  it('写し忘れても、thread_id から CODEX_HOME の絵を拾う', async () => {
    const { status } = await run(fakeCli({ copy: false }))

    expect(status.state).toBe('succeeded')
    if (status.state !== 'succeeded') return
    const output = status.outputs[0]
    expect(output?.type === 'local' ? await readFile(output.path) : null).toEqual(PNG)
  })

  /** 取り込んだら CODEX_HOME に置いたままにしない（ADR-0012 の実装規約）。 */
  it('拾った後は CODEX_HOME のその回の絵を消す', async () => {
    await run(fakeCli())

    expect(await readdir(join(codexHome, 'generated_images'))).toEqual([])
  })

  /** 取り込んだら作業ディレクトリも消す（1 枚 2MB ほどが /tmp に積もっていた）。 */
  it('片付けを頼むと、その回の作業ディレクトリを消し、記録も忘れる', async () => {
    const provider = providerWith(fakeCli())
    const handle = await provider.submit(storyboardRequest())
    await pollUntilSettled(provider, handle)

    await provider.release?.(handle)

    expect(await readdir(join(root, 'work'))).toEqual([])
    await expect(provider.poll(handle)).rejects.toThrow(/記録が見つかりません/)
  })

  it('片付けで消すのは自分が切ったディレクトリだけ（参照に ../ が来ても外を消さない）', async () => {
    const provider = providerWith(fakeCli())
    await mkdir(join(root, 'keep'), { recursive: true })

    await provider.release?.({ providerId: CODEX_CLI_PROVIDER_ID, modelId: codexCliImageModel.id, ref: '../keep', submittedAt: new Date() })

    expect(await readdir(root)).toContain('keep')
  })

  it('絵ができなければ、理由を付けて失敗にする（やり直せる）', async () => {
    const { status } = await run(fakeCli({ image: false }))

    expect(status).toMatchObject({ state: 'failed', error: { code: 'no_image', retryable: true } })
  })

  it('0 以外で終われば、終了コードと最後の 1 行を理由にする', async () => {
    const { status } = await run(
      fakeCli({ result: { kind: 'completed', exitCode: 1, stdout: '', stderr: 'Reading prompt\nError: rate limited\n' } }),
    )

    expect(status).toMatchObject({ state: 'failed', error: { code: 'cli_exit_failed', retryable: true } })
    if (status.state === 'failed') {
      expect(status.error.message).toContain('1')
      expect(status.error.message).toContain('rate limited')
    }
  })

  it('CLI が無ければ、入れ方を確かめるよう言う（やり直しても同じ）', async () => {
    const { status } = await run(fakeCli({ result: { kind: 'not_found', reason: 'ENOENT' } }))

    expect(status).toMatchObject({ state: 'failed', error: { code: 'cli_not_found', retryable: false } })
  })

  it('時間切れは、やり直せる失敗にする', async () => {
    const { status } = await run(fakeCli({ result: { kind: 'timeout', timeoutMs: 300_000 } }))

    expect(status).toMatchObject({ state: 'failed', error: { code: 'cli_timeout', retryable: true } })
  })

  it('記録には指示の本文を残さない（長さとハッシュだけ）。CLI の版と thread_id は残す', async () => {
    const { status } = await run(fakeCli())

    if (status.state !== 'succeeded') throw new Error('成功のはず')
    const raw = JSON.stringify(status.raw)
    expect(raw).not.toContain('ガレージ')
    expect(status.raw).toMatchObject({ kind: 'cli', cliVersion: 'codex-cli 0.154.0', exitCode: 0, threadId: THREAD_ID })
  })

  it('参照は手元のファイルしか渡せない（URL は断る）', async () => {
    const provider = providerWith(fakeCli())

    await expect(provider.submit(storyboardRequest([{ path: 'https://storage.test/a.png?sig=x' }]))).rejects.toThrow(
      /手元のファイル/,
    )
  })

  it('1 回に作れるのは 1 枚だけ', async () => {
    const provider = providerWith(fakeCli())

    await expect(provider.submit({ ...storyboardRequest(), count: 2 })).rejects.toBeInstanceOf(
      CapabilityViolationError,
    )
  })

  it('作れない大きさは断る', async () => {
    const provider = providerWith(fakeCli())

    await expect(
      provider.submit({ ...storyboardRequest(), resolution: { width: 1920, height: 1080 } }),
    ).rejects.toBeInstanceOf(CapabilityViolationError)
  })

  it('知らないジョブは、記録が無いと言う', async () => {
    const provider = providerWith(fakeCli())

    await expect(
      provider.poll({ providerId: CODEX_CLI_PROVIDER_ID, modelId: codexCliImageModel.id, ref: 'x', submittedAt: new Date() }),
    ).rejects.toThrow(/記録が見つかりません/)
  })

  it('不正な設定は Provider の生成時点で弾く', () => {
    expect(() => createCodexCliImageProvider({ workingDirRoot: '' })).toThrow()
  })
})

describe('codexFrameFor', () => {
  it('比に近い形で作る（16:9 は横長、9:16 は縦長、1:1 は正方形）', () => {
    expect(codexFrameFor('16:9')).toMatchObject({ width: 1536, height: 1024 })
    expect(codexFrameFor('9:16')).toMatchObject({ width: 1024, height: 1536 })
    expect(codexFrameFor('1:1')).toMatchObject({ width: 1024, height: 1024 })
  })
})
