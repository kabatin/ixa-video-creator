import { isTakeAudioMuted } from '@ixa/domain'
import type { WireCharacter, WireShot } from '../wire.js'

/**
 * 会話劇の状態を、MCP の結果に載せる形に畳む（ADR-0059〜0061）。get_project と list_takes が使う。
 * 既定の値（画面内・訳文なし）は出さない。
 */

/** Shot のセリフ（話し手の名前つき）と警告。セリフが無ければ何も出さない。 */
export const dialogueViewOf = (shot: WireShot, speakerName: ReadonlyMap<string, string>) => {
  const lines = shot.dialogue ?? []
  const warnings = (shot.dialogueWarnings ?? []).map((w) => w.message)
  return {
    ...(lines.length === 0
      ? {}
      : {
          dialogue: lines.map((line) => ({
            speaker: speakerName.get(line.speakerId) ?? line.speakerId,
            speakerId: line.speakerId,
            text: line.text,
            ...(line.offscreen === true ? { offscreen: true } : {}),
            ...(line.translation === undefined || line.translation === null ? {} : { translation: line.translation }),
          })),
        }),
    ...(warnings.length === 0 ? {} : { dialogueWarnings: warnings }),
  }
}

/** 話し手の声。足りなければ null のまま見せる（Take を作る前に足りないと分かるように）。 */
export const speechViewOf = (character: WireCharacter) => ({
  speechName: character.speechName ?? null,
  voiceDescription: character.voiceDescription ?? null,
})

/**
 * Shot の Take の音の設定（ADR-0060）。`muted` は実際に消すか、`auto` は制作者が選んでいない（セリフのある Shot だけ鳴らす）。
 * 判定は domain の `isTakeAudioMuted`（プレビュー・書き出しと同じ規則）。
 */
export const takeAudioViewOf = (shot: WireShot) => {
  const chosen = shot.takeAudioMuted ?? null
  return {
    volume: shot.takeAudioVolume ?? 1,
    muted: isTakeAudioMuted({ takeAudioMuted: chosen, dialogue: shot.dialogue ?? [] }),
    auto: chosen === null,
  }
}
