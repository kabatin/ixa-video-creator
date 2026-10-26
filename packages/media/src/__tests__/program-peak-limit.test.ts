import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { measureLoudness } from '../audio.js'
import { runFfmpeg } from '../ffmpeg-runner.js'
import { PROGRAM_PEAK_LIMIT_DBFS, limitProgramPeaks, programPeakLimitArgs } from '../program-loudness.js'

/**
 * 仕上げ「山だけ抑える」（ADR-0060）。全体の大きさはそろえず、-1.5 dBFS を超える山だけを alimiter で抑える。
 * 全体を -14 LUFS にそろえると、セリフの大きさに合わせて曲まで上下するため。
 */

const TIMEOUT_MS = 120_000

describe('programPeakLimitArgs', () => {
  it('映像は写すだけで、音に alimiter（-1.5 dBFS・自動の持ち上げなし）だけを通す', () => {
    expect(PROGRAM_PEAK_LIMIT_DBFS).toBe(-1.5)
    expect(programPeakLimitArgs('/in.mp4', '/out.mp4', '192k')).toEqual([
      '-y', '-i', '/in.mp4', '-map', '0:v?', '-map', '0:a', '-c:v', 'copy',
      '-af', 'alimiter=limit=0.841395:level=disabled',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '/out.mp4',
    ])
  })
})

let workDir = ''

/** 映像と音の mp4。音は指定の大きさ（dB）の 1kHz。 */
const makeToneVideo = async (path: string, gainDb: number): Promise<void> => {
  await runFfmpeg([
    '-y',
    '-f', 'lavfi', '-i', 'color=c=black:size=160x120:rate=12:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=3',
    '-af', `volume=${gainDb}dB`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', path,
  ])
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ixa-peak-limit-'))
}, TIMEOUT_MS)

afterAll(async () => {
  if (workDir !== '') await rm(workDir, { recursive: true, force: true })
})

describe('limitProgramPeaks', () => {
  it(
    '山（0 dBFS 近く）は -1.5 dBFS 付近まで抑える',
    async () => {
      const input = join(workDir, 'loud.mp4')
      const output = join(workDir, 'loud.limited.mp4')
      // sine は振幅 1/8（約 -18 dBFS）なので、+17 dB で 0 dBFS 近くまで上げる。
      await makeToneVideo(input, 17)
      expect((await measureLoudness(input)).truePeakDb).toBeGreaterThan(-1)
      const measured = await limitProgramPeaks(input, output, '192k')
      // AAC にし直すと山が少しはみ出すので、0.5 dB の余裕を見る。
      expect(measured?.truePeakDb).toBeLessThan(PROGRAM_PEAK_LIMIT_DBFS + 0.5)
    },
    TIMEOUT_MS,
  )

  it(
    '静かな音は持ち上げない（全体をそろえない）',
    async () => {
      const input = join(workDir, 'quiet.mp4')
      const output = join(workDir, 'quiet.limited.mp4')
      await makeToneVideo(input, -12)
      const before = await measureLoudness(input)
      const after = await limitProgramPeaks(input, output, '192k')
      expect(after).not.toBeNull()
      expect(Math.abs((after?.integratedLufs ?? 0) - before.integratedLufs)).toBeLessThan(0.5)
    },
    TIMEOUT_MS,
  )

  it(
    '音が無ければ書かずに null',
    async () => {
      const input = join(workDir, 'silent.mp4')
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=black:size=160x120:rate=12:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input])
      expect(await limitProgramPeaks(input, join(workDir, 'silent.limited.mp4'), '192k')).toBeNull()
    },
    TIMEOUT_MS,
  )
})
