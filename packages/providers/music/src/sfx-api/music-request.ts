import { MUSIC_PROMPT_MAX_LENGTH } from '@ixa/domain'
import type { MusicGenerationRequest } from '@ixa/provider-core'
import { localServerInputError } from '@ixa/provider-video'
import { SFX_API_MUSIC_IDENTITY, stableAudioMusicModel } from './music-descriptor.js'

/**
 * 送る前の検査（sfx-api の契約と同じ範囲）。呼ぶ側（API の `musicSpecProblem`）でも検査しているが、
 * 口が増えたときのためにここでも止める。**歌あり・歌詞ありは黙って捨てずに断る**（歌なしの曲が届いてしまう）。
 */
export const ensureSfxApiMusicRequest = (request: MusicGenerationRequest): void => {
  const fail = (message: string): never => {
    throw localServerInputError(SFX_API_MUSIC_IDENTITY, message)
  }
  const { model } = request
  if (model.id !== stableAudioMusicModel.id) fail('知らない曲のモデルです')
  if (!request.instrumental) fail(`${model.label}は歌なしの曲だけを作ります`)
  if (request.lyrics.trim() !== '') fail(`${model.label}では歌詞は使えません`)
  if (request.prompt.trim() === '') fail('曲調が空です')
  if ([...request.prompt].length > MUSIC_PROMPT_MAX_LENGTH) {
    fail(`曲調が ${String(MUSIC_PROMPT_MAX_LENGTH)} 文字を超えています`)
  }
  if (
    !Number.isFinite(request.durationSec) ||
    request.durationSec < model.durationSec.min ||
    request.durationSec > model.durationSec.max
  ) {
    fail(`長さは ${String(model.durationSec.min)}〜${String(model.durationSec.max)} 秒にしてください`)
  }
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > model.maxCount) {
    fail(`曲の数は 1〜${String(model.maxCount)} にしてください`)
  }
  if (request.seed !== null && (!Number.isInteger(request.seed) || request.seed < 0)) {
    fail('種は 0 以上の整数にしてください')
  }
}
