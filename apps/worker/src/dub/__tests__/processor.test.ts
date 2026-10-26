import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DUB_REASON, dialogueTelopOf, dubRecordOf, type TimelineClip } from '@ixa/domain'
import { probeMedia } from '@ixa/media'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { failInterruptedDubJob } from '../interrupted.js'
import { UNEXPECTED_DUB_MESSAGE, processDubJob } from '../processor.js'
import { CLICK_SOURCE_EXPR, createDubWorld, createWorkDir, line, makeSourceVideo, removeWorkDir } from './fixtures.js'
import type { DubTranscriber } from '../transcriber.js'

/**
 * 声の差し替えの通し（ADR-0062 段 5b）。偽の読み上げと **実 ffmpeg** で、合成した音付きの動画を差し替える。
 *
 * - 新しい Take ができ、元の Take は変わらず、採用が移り、字幕が記録の置いた時刻になる
 * - 保存した読み上げは使い回す（2 回目は読み上げを頼まない）
 * - 止める理由は日本語で、どの行・誰の声かを言う（声が無い・鍵の名札が違う・1.6 倍超・行の区間が決まらない・音が無い）
 */

let dir = ''
let video: Uint8Array = new Uint8Array()
let silent: Uint8Array = new Uint8Array()
let clicked: Uint8Array = new Uint8Array()

beforeAll(async () => {
  dir = await createWorkDir()
  video = await makeSourceVideo(dir, { audio: true })
  silent = await makeSourceVideo(dir, { audio: false })
  clicked = await makeSourceVideo(dir, { audio: true, expr: CLICK_SOURCE_EXPR, name: 'clicked.mp4' })
}, 30_000)

afterAll(async () => {
  await removeWorkDir(dir)
})

const dialogueSpans = (clips: readonly TimelineClip[]) =>
  clips
    .filter((clip) => clip.content.type === 'text' && dialogueTelopOf(clip.content.params) !== null)
    .sort((a, b) => a.startSec - b.startSec)
    .map((clip) => [clip.startSec, clip.durationSec])

describe('processDubJob（通し）', () => {
  it('新しい Take を作って採用し、元の Take は変えず、字幕を置いた時刻にする。2 回目は読み上げを使い回す', async () => {
    const world = await createDubWorld({ workDir: join(dir, 'ok'), video })
    const sourceBefore = structuredClone(await world.takes.findById(world.source.id))
    const job = await world.newJob()

    const outcome = await processDubJob(world.deps, { dubJobId: job.id })
    expect(outcome.state).toBe('succeeded')
    if (outcome.state !== 'succeeded') return

    const take = (await world.takes.findByShot(world.shot.id)).find((t) => t.id === outcome.takeId) ?? null
    expect(take).not.toBeNull()
    if (take === null) return
    expect(take.parentTakeId).toBe(world.source.id)
    expect(take.regenerationReason).toBe(DUB_REASON)
    expect(take.specHash).toBe(world.source.specHash)
    expect(take.spec).toEqual(world.source.spec)
    expect(take.providerId).toBe(world.source.providerId)
    expect(take.costUsd).toBeCloseTo(0.002, 6)

    const record = dubRecordOf(take)
    expect(record?.sourceTakeId).toBe(world.source.id)
    expect(record?.integratedLufs).toBeGreaterThan(-16.6)
    expect(record?.integratedLufs).toBeLessThan(-15.4)
    expect(record?.lines.map((l) => l.mode)).toEqual(['lip', 'lip'])
    for (const l of record?.lines ?? []) {
      expect(l.agreement).toBeGreaterThan(0.7)
      expect(l.tempoMin).toBeGreaterThanOrEqual(0.8)
      expect(l.tempoMax).toBeLessThanOrEqual(1.6)
      expect(l.reading).toBe('plain')
    }
    expect(record?.lines[0]?.placedStartSec).toBeCloseTo(0.46, 1)
    expect(record?.lines[1]?.placedStartSec).toBeCloseTo(1.76, 1)

    // 元の Take は 1 バイトも変わらない（追記のみ）。採用は新しい Take へ移る。
    expect(await world.takes.findById(world.source.id)).toEqual(sourceBefore)
    expect((await world.shots.findById(world.shot.id))?.selectedTakeId).toBe(take.id)
    expect(world.mediaQueue.enqueued()).toContain(take.mediaAssetId)

    // 映像は写すだけ・音がある。
    const asset = await world.deps.mediaAssets.findById(take.mediaAssetId)
    const outPath = join(dir, 'ok-out.mp4')
    await writeFile(outPath, await world.storage.get(asset?.storageKey ?? ''))
    const probe = await probeMedia(outPath)
    expect(probe.hasAudio).toBe(true)
    expect(probe.codec).toBe('h264')
    expect(probe.durationSec).toBeCloseTo(3, 0)

    // 字幕は記録の置いた時刻（Shot の頭 10 秒から）。
    const spans = dialogueSpans(world.timelineClips.snapshot())
    expect(spans).toHaveLength(2)
    expect(spans[0]?.[0]).toBeCloseTo(10 + (record?.lines[0]?.placedStartSec ?? 0), 3)
    expect(spans[1]?.[0]).toBeCloseTo(10 + (record?.lines[1]?.placedStartSec ?? 0), 3)

    const done = await world.dubJobs.findById(job.id)
    expect(done).toMatchObject({ status: 'succeeded', takeId: take.id })
    expect(done?.record?.lines).toHaveLength(2)

    // 2 回目（同じ元の Take から）。読み上げは保存済みを使うので頼まない・払わない。
    const calls = world.tts.calls().length
    expect(calls).toBe(2)
    const again = await world.dubJobs.create({ projectId: world.project.id, shotId: world.shot.id, sourceTakeId: world.source.id })
    const second = await processDubJob(world.deps, { dubJobId: again.id })
    expect(second.state).toBe('succeeded')
    // 同じ中身の音でも、前の Take を使い回さず、この Shot に新しい Take を作る（親は元の Take）。
    if (second.state !== 'succeeded') return
    expect(second.takeId).not.toBe(take.id)
    const secondTake = (await world.takes.findByShot(world.shot.id)).find((t) => t.id === second.takeId)
    expect(secondTake).toMatchObject({ shotId: world.shot.id, parentTakeId: world.source.id })
    expect((await world.shots.findById(world.shot.id))?.selectedTakeId).toBe(take.id)
    expect(world.tts.calls()).toHaveLength(calls)
    expect((await world.dubJobs.findById(again.id))?.costUsd).toBe(0)
    expect(world.ttsClips.snapshot()).toHaveLength(2)
  }, 60_000)

  it('同じ中身の素材が別の作品の Take（複製で写したもの）にあっても、その Take を採用せず、この Shot に新しい Take を作る', async () => {
    const first = await createDubWorld({ workDir: join(dir, 'dup-a'), video })
    const done = await processDubJob(first.deps, { dubJobId: (await first.newJob()).id })
    if (done.state !== 'succeeded') throw new Error('1 本目が作れませんでした')
    const theirs = (await first.takes.findByShot(first.shot.id)).find((t) => t.id === done.takeId)
    const theirAsset = theirs === undefined ? null : await first.mediaAssets.findById(theirs.mediaAssetId)
    if (theirs === undefined || theirAsset === null) throw new Error('1 本目の素材がありません')

    const world = await createDubWorld({ workDir: join(dir, 'dup-b'), video, seed: { assets: [theirAsset], takes: [theirs] } })
    await world.storage.put(theirAsset.storageKey, await first.storage.get(theirAsset.storageKey), { contentType: 'video/mp4' })
    const outcome = await processDubJob(world.deps, { dubJobId: (await world.newJob()).id })
    expect(outcome.state).toBe('succeeded')
    if (outcome.state !== 'succeeded') return
    expect(outcome.takeId).not.toBe(theirs.id)
    const mine = (await world.takes.findByShot(world.shot.id)).find((t) => t.id === outcome.takeId)
    expect(mine).toMatchObject({ shotId: world.shot.id, parentTakeId: world.source.id })
    expect((await world.shots.findById(world.shot.id))?.selectedTakeId).toBe(outcome.takeId)
  }, 60_000)

  it('保存した読み上げの素材が消されていたら読み直し、保存の行をその素材へ付け替える（毎回払わない）', async () => {
    const world = await createDubWorld({ workDir: join(dir, 'dead'), video })
    expect((await processDubJob(world.deps, { dubJobId: (await world.newJob()).id })).state).toBe('succeeded')
    const before = world.ttsClips.snapshot()
    for (const clip of before) await world.mediaAssets.softDelete(clip.mediaAssetId)
    expect((await processDubJob(world.deps, { dubJobId: (await world.newJob()).id })).state).toBe('succeeded')
    expect(world.tts.calls()).toHaveLength(4)
    const after = world.ttsClips.snapshot()
    expect(after).toHaveLength(2)
    expect(after.map((c) => c.mediaAssetId)).not.toEqual(before.map((c) => c.mediaAssetId))
    // 付け替えた後は使い回す。
    expect((await processDubJob(world.deps, { dubJobId: (await world.newJob()).id })).state).toBe('succeeded')
    expect(world.tts.calls()).toHaveLength(4)
  }, 60_000)

  it('別のワークスペースの保存した読み上げは使わない（鍵が同じでも）', async () => {
    const other = await createDubWorld({ workDir: join(dir, 'ws-a'), video })
    expect((await processDubJob(other.deps, { dubJobId: (await other.newJob()).id })).state).toBe('succeeded')
    const theirAssets = (await Promise.all(other.ttsClips.snapshot().map((c) => other.mediaAssets.findById(c.mediaAssetId)))).flatMap(
      (a) => (a === null ? [] : [a]),
    )
    const world = await createDubWorld({ workDir: join(dir, 'ws-b'), video, seed: { assets: theirAssets, ttsClips: other.ttsClips.snapshot() } })
    expect((await processDubJob(world.deps, { dubJobId: (await world.newJob()).id })).state).toBe('succeeded')
    expect(world.tts.calls()).toHaveLength(2)
  }, 60_000)

  it('頭にクリックがあっても、読み上げの長さで行の区間を選ぶ（クリックを 1 行目に渡さない）', async () => {
    const world = await createDubWorld({ workDir: join(dir, 'click'), video: clicked })
    const job = await world.newJob()
    const outcome = await processDubJob(world.deps, { dubJobId: job.id })
    expect(outcome.state).toBe('succeeded')
    const record = (await world.dubJobs.findById(job.id))?.record
    expect(record?.lines[0]?.sourceStartSec).toBeCloseTo(1.0, 1)
    expect(record?.lines[0]?.sourceEndSec).toBeCloseTo(1.7, 1)
    expect(record?.lines[1]?.sourceStartSec).toBeCloseTo(2.0, 1)
    expect(record?.lines[1]?.sourceEndSec).toBeCloseTo(2.6, 1)
    // 区間を決める前に読んだ読み上げは、行ごとの読み直しで使い回す（同じ文を 2 回頼まない・払わない）。
    const texts = world.tts.calls().map((call) => call.text)
    expect(texts.slice(0, 2)).toEqual(['こんにちは、ネズミくん。', 'やあ。'])
    expect(new Set(texts).size).toBe(texts.length)
    expect((await world.dubJobs.findById(job.id))?.costUsd).toBeCloseTo(0.001 * texts.length, 6)
  }, 60_000)

  it('文字起こしの語があれば、それで行の区間を決める（台本を渡し、長さだけの割り当てとは違う区間になる）', async () => {
    const asked: { prompt: string; samples: number }[] = []
    const transcribe: DubTranscriber = (input) => {
      asked.push({ prompt: input.prompt, samples: input.pcm.length })
      return Promise.resolve([
        { startSec: 0.0, endSec: 0.15, text: 'こんにちは' },
        { startSec: 1.0, endSec: 1.7, text: 'ネズミくん' },
        { startSec: 2.0, endSec: 2.6, text: 'やあ' },
      ])
    }
    const world = await createDubWorld({ workDir: join(dir, 'transcribed'), video: clicked, transcribe })
    const job = await world.newJob()
    expect((await processDubJob(world.deps, { dubJobId: job.id })).state).toBe('succeeded')
    expect(asked).toEqual([{ prompt: 'こんにちは、ネズミくん。 やあ。', samples: expect.any(Number) as number }])
    expect(asked[0]?.samples).toBeGreaterThan(16000 * 2.5)
    const record = (await world.dubJobs.findById(job.id))?.record
    // 長さだけなら 1 行目は 1.0 秒から（上のテスト）。語の通りに 0 秒の区間から受け持つ。
    expect(record?.lines[0]?.sourceStartSec).toBeCloseTo(0.0, 1)
    expect(record?.lines[0]?.sourceEndSec).toBeCloseTo(1.7, 1)
    expect(record?.lines[1]?.sourceStartSec).toBeCloseTo(2.0, 1)
    expect(record?.lines.flatMap((l) => l.warnings.map((w) => w.code))).not.toContain('line_span_by_length')
  }, 60_000)

  it('文字起こしの口が無い・失敗したら、読み上げの長さで決めて通し、行ごとに警告を残す', async () => {
    const down: DubTranscriber = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:8100'))
    for (const [name, transcribe] of [
      ['no-transcriber', null],
      ['transcriber-down', down],
    ] as const) {
      const world = await createDubWorld({ workDir: join(dir, name), video: clicked, transcribe })
      const job = await world.newJob()
      expect((await processDubJob(world.deps, { dubJobId: job.id })).state).toBe('succeeded')
      const record = (await world.dubJobs.findById(job.id))?.record
      expect(record?.lines[0]?.sourceStartSec).toBeCloseTo(1.0, 1)
      for (const l of record?.lines ?? []) {
        expect(l.warnings.map((w) => w.code)).toContain('line_span_by_length')
      }
      const message = record?.lines[0]?.warnings.find((w) => w.code === 'line_span_by_length')?.message
      expect(message).toContain('文字起こしが使えなかった')
    }
  }, 60_000)

  it('元の声のままの行は消さず読み直さない。記録の置いた時刻は元の区間', async () => {
    const world = await createDubWorld({
      workDir: join(dir, 'keep'),
      video,
      dialogue: (ids) => [line(ids.cat, 'こんにちは、ネズミくん。'), line(ids.mouse, 'やあ。', { keepOriginal: true })],
    })
    const job = await world.newJob()
    const outcome = await processDubJob(world.deps, { dubJobId: job.id })
    expect(outcome.state).toBe('succeeded')
    const record = (await world.dubJobs.findById(job.id))?.record
    expect(record?.lines[1]).toMatchObject({ mode: 'keep_original', agreement: null, reading: null })
    expect(record?.lines[1]?.placedStartSec).toBeCloseTo(1.8, 1)
    expect(world.tts.calls()).toHaveLength(1)
  }, 60_000)
})

describe('processDubJob（止める理由）', () => {
  const failed = async (world: Awaited<ReturnType<typeof createDubWorld>>) => {
    const job = await world.newJob()
    const outcome = await processDubJob(world.deps, { dubJobId: job.id })
    const after = await world.dubJobs.findById(job.id)
    // 止まったときは Take を作らず、採用も変えない。
    expect(await world.takes.findByShot(world.shot.id)).toHaveLength(1)
    expect((await world.shots.findById(world.shot.id))?.selectedTakeId).toBe(world.source.id)
    return { outcome, error: after?.error ?? null, status: after?.status, costUsd: after?.costUsd }
  }

  it('話し手にセリフの声が無ければ、誰のどの行かを言って止める（読み上げを頼まない）', async () => {
    const world = await createDubWorld({ workDir: join(dir, 'novoice'), video, mouseHasVoice: false })
    const { outcome, error } = await failed(world)
    expect(outcome).toEqual({ state: 'failed', code: 'no_dialogue_voice' })
    expect(error?.message).toBe('セリフの 2 行目（ネズミ）: ネズミ にセリフの声がありません。キャラクターの「セリフの声」を選んでください')
    expect(world.tts.calls()).toHaveLength(0)
  }, 30_000)

  it('作った声の鍵の名札が今の鍵と違えば止める', async () => {
    const world = await createDubWorld({ workDir: join(dir, 'key'), video, designedKeyLabel: 'key1-2026-01-01' })
    const { outcome, error } = await failed(world)
    expect(outcome).toEqual({ state: 'failed', code: 'key_label_mismatch' })
    expect(error?.message).toContain('名札「key1-2026-01-01」')
    expect(error?.message).toContain('今の鍵は「key2-2026-10-14」')
    expect(world.tts.calls()).toHaveLength(0)
  }, 30_000)

  it('3 通りの読み方がどれも 1.6 倍を超えたときだけ止める（収まらない行だけを読み足す）', async () => {
    const world = await createDubWorld({
      workDir: join(dir, 'fast'),
      video,
      dialogue: (ids) => [line(ids.cat, 'ながい、ながい、ながい。まだ。'), line(ids.mouse, 'やあ。')],
    })
    const { outcome, error, status, costUsd } = await failed(world)
    expect(status).toBe('failed')
    expect(outcome).toEqual({ state: 'failed', code: 'lines_unassigned' })
    expect(error?.message).toMatch(/^セリフの 1 行目に、読み上げの長さに合う元の声の区間が見つかりません/)
    expect(error?.suggestedSpans?.map((s) => s.lineIndex)).toEqual([0, 1])
    expect(world.tts.calls().map((call) => call.text)).toEqual([
      'ながい、ながい、ながい。まだ。',
      'やあ。',
      'ながい、<short pause>ながい、<short pause>ながい。<short pause>まだ。',
      'ながいながいながい。まだ。',
    ])
    // 止まるまでに読んだ分は払っている（1 行目の 3 通りと 2 行目）。
    expect(costUsd).toBeCloseTo(0.004, 6)
  }, 60_000)

  it('行の区間が決まらなければ、行を番号で言い、文字数の比で割った手の区間の案を付けて止める', async () => {
    const world = await createDubWorld({
      workDir: join(dir, 'merged'),
      video,
      dialogue: (ids) => [line(ids.cat, 'こんにちは'), line(ids.mouse, 'やあ'), line(ids.cat, 'またね')],
    })
    const { outcome, error } = await failed(world)
    expect(outcome).toEqual({ state: 'failed', code: 'lines_unassigned' })
    expect(error?.message).toContain('セリフの 1・2・3 行目')
    expect(error?.suggestedSpans?.map((s) => s.lineIndex)).toEqual([0, 1, 2])
    expect(error?.suggestedSpans?.[0]?.startSec).toBeCloseTo(0.5, 1)
    expect(error?.suggestedSpans?.[2]?.endSec).toBeCloseTo(2.4, 1)
  }, 30_000)

  it('元の Take に音が無ければ止める', async () => {
    const world = await createDubWorld({ workDir: join(dir, 'silent'), video: silent })
    const { outcome, error } = await failed(world)
    expect(outcome).toEqual({ state: 'failed', code: 'no_source_audio' })
    expect(error?.message).toContain('音がありません')
  }, 30_000)

  it('読み上げの途中で止められても、払った額はジョブに残る', async () => {
    const world = await createDubWorld({
      workDir: join(dir, 'cancel-mid'),
      video,
      afterSpeak: ({ dubJobs }) => async () => {
        for (const job of await dubJobs.findActiveByProject(dubJobs.snapshot()[0]?.projectId ?? ('' as never))) await dubJobs.cancel(job.id)
      },
    })
    const job = await world.newJob()
    expect(await processDubJob(world.deps, { dubJobId: job.id })).toEqual({ state: 'cancelled' })
    expect(world.tts.calls()).toHaveLength(1)
    expect((await world.dubJobs.findById(job.id))).toMatchObject({ status: 'cancelled', costUsd: 0.001 })
  }, 30_000)

  it('払った後に知らない失敗で止まっても、払った額はジョブに残る', async () => {
    const world = await createDubWorld({ workDir: join(dir, 'lost'), video, afterSpeak: () => () => Promise.resolve('lose_file') })
    const job = await world.newJob()
    await expect(processDubJob(world.deps, { dubJobId: job.id })).rejects.toThrow()
    const failed = await world.dubJobs.findById(job.id)
    expect(failed).toMatchObject({ status: 'failed', costUsd: 0.001 })
    // 画面・MCP に出る文は決まった日本語だけ（手元のパスや ffmpeg の出力を出さない。元の文はログだけ）。
    expect(failed?.error?.message).toBe(UNEXPECTED_DUB_MESSAGE)
  }, 30_000)

  it('キューに打ち切られたジョブを失敗にしても、払った額は消えない', async () => {
    const world = await createDubWorld({ workDir: join(dir, 'interrupted'), video })
    const job = await world.newJob()
    await world.dubJobs.markRunning(job.id)
    await world.dubJobs.addCost(job.id, 0.005)
    await failInterruptedDubJob(world.deps, { dubJobId: job.id }, 'stalled')
    expect((await world.dubJobs.findById(job.id))).toMatchObject({ status: 'failed', costUsd: 0.005 })
  })

  it('止めたジョブは作らずに手を引く', async () => {
    const world = await createDubWorld({ workDir: join(dir, 'cancel'), video })
    const job = await world.newJob()
    await world.dubJobs.cancel(job.id)
    expect(await processDubJob(world.deps, { dubJobId: job.id })).toEqual({ state: 'skipped', reason: 'status=cancelled' })
    expect(world.tts.calls()).toHaveLength(0)
  })
})
