import { describe, expect, it } from 'vitest'
import { PROGRAM_TARGET_LUFS, parseLoudnormJson, programLoudnessArgs } from '../program-loudness.js'

/**
 * 書き出しの音量を揃える（ADR-0039）。YouTube・SNS の基準（-14 LUFS・トゥルーピーク -1.5 dBTP）に、
 * ffmpeg の loudnorm を 2 回（測る → 直す）通して合わせる。映像はそのまま写し、音だけ作り直す。
 */

/** loudnorm の 1 回目の出力（実物の形。2026-10-05、ffmpeg 7）。 */
const STDERR = `[Parsed_loudnorm_0 @ 0x1]
{
	"input_i" : "-23.69",
	"input_tp" : "-16.43",
	"input_lra" : "2.00",
	"input_thresh" : "-33.88",
	"output_i" : "-14.30",
	"output_tp" : "-6.72",
	"output_lra" : "2.30",
	"output_thresh" : "-24.52",
	"normalization_type" : "dynamic",
	"target_offset" : "0.30"
}
frame=  180 fps=0.0`

describe('parseLoudnormJson', () => {
  it('1 回目の測った値を読む', () => {
    expect(parseLoudnormJson(STDERR)).toEqual({ inputI: -23.69, inputTp: -16.43, inputLra: 2, inputThresh: -33.88, targetOffset: 0.3 })
  })

  it('無音（-inf）や読めない出力なら null（直さずにそのまま使う）', () => {
    expect(parseLoudnormJson(STDERR.replace('"-23.69"', '"-inf"'))).toBeNull()
    expect(parseLoudnormJson('no json')).toBeNull()
  })
})

describe('programLoudnessArgs', () => {
  it(`測った値を渡して ${PROGRAM_TARGET_LUFS} LUFS に直す（線形・48kHz）。映像は写すだけ`, () => {
    const args = programLoudnessArgs('/in.mp4', '/out.mp4', { inputI: -23.69, inputTp: -16.43, inputLra: 2, inputThresh: -33.88, targetOffset: 0.3 }, '192k')
    expect(args).toEqual([
      '-y', '-i', '/in.mp4', '-map', '0:v?', '-map', '0:a', '-c:v', 'copy',
      '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-23.69:measured_TP=-16.43:measured_LRA=2:measured_thresh=-33.88:offset=0.3:linear=true',
      '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '/out.mp4',
    ])
  })
})
