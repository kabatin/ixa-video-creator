import { ModelId, MUSIC_COUNT_MAX, MUSIC_DURATION_MIN_SEC, STABLE_AUDIO_MUSIC_DURATION_MAX_SEC } from '@ixa/domain'
import type { MusicModelDescriptor } from '@ixa/provider-core'
import type { LocalServerIdentity } from '@ixa/provider-video'
import { SFX_API_IDENTITY, SFX_API_PROVIDER_ID } from './descriptor.js'

/**
 * sfx-api の歌なし BGM（ADR-0048 追記）。効果音と同じサーバ・同じ待ち行列の別の workflow で、
 * Stable Audio 3 Medium を曲に使う。**歌は作れない**（歌詞・ボーカルの指定は受けない）。
 *
 * 契約の正は sfx-api の `docs/api.md`（"stable-audio-3-medium-music" 節）と `GET /v1/capabilities`:
 * 本文は効果音と同じ形（説明・長さ・数・種）。説明は英語 1〜1000 文字で、
 * 「TrackType: Music, VocalType: Instrumental, 」の前置きはサーバが付ける（ixa は付けない）。
 * 長さはサーバが 0.5〜190 秒を受けるが、ixa の曲は 10 秒から（曲のジョブの下限）。
 * 出力は PCM16・44.1kHz・ステレオの WAV で、長さは頼んだとおり。
 */
export const STABLE_AUDIO_MUSIC_WORKFLOW_ID = 'stable-audio-3-medium-music'

export const STABLE_AUDIO_MUSIC_MODEL_ID: ModelId = ModelId.parse(`sfx_api/${STABLE_AUDIO_MUSIC_WORKFLOW_ID}`)

/** 効果音と同じサーバ（合言葉・口・起こし方）。失敗の文だけ「曲」と言う。 */
export const SFX_API_MUSIC_IDENTITY: LocalServerIdentity = Object.freeze({
  ...SFX_API_IDENTITY,
  label: 'ローカルの曲の生成（Stable Audio）',
  workflowId: STABLE_AUDIO_MUSIC_WORKFLOW_ID,
})

export const stableAudioMusicModel: MusicModelDescriptor = Object.freeze({
  id: STABLE_AUDIO_MUSIC_MODEL_ID,
  providerId: SFX_API_PROVIDER_ID,
  label: 'Stable Audio 3 Medium（歌なし・手元）',
  durationSec: Object.freeze({ min: MUSIC_DURATION_MIN_SEC, max: STABLE_AUDIO_MUSIC_DURATION_MAX_SEC }),
  maxCount: MUSIC_COUNT_MAX,
})
