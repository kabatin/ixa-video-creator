import type { ProjectEvent, VoiceJobKind } from '@ixa/domain'

/** 声のジョブ（ADR-0038）の種類ごとに、作れなかったものの言い方。 */
const FAILED: Readonly<Record<VoiceJobKind, string>> = {
  speak: '声を作れませんでした',
  preview: '試しに読めませんでした',
  transcribe: '録音を文字起こしできませんでした',
  char_timing: '字の時刻を取れませんでした',
}

/**
 * 声のジョブが失敗したら、上の知らせに出す文（何を作れなかったかと理由）。失敗でなければ null。
 * 理由を捨てると、利用者から見て「遅い」と「失敗した」が区別できない。
 */
export const voiceJobNotice = (event: Extract<ProjectEvent, { type: 'voice_job.status' }>): string | null =>
  event.status === 'failed' ? `${FAILED[event.kind]}: ${event.error ?? '理由が届きませんでした。'}` : null
