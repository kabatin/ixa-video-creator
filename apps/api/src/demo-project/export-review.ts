import { demoTotalBytes, type DemoManifest } from '@ixa/domain'
import { parseDemoSource, type DemoSource } from './source-wire.js'

/**
 * 書き出した後に作る人へ見せる点検の一覧（ADR-0067「公開する目録に入れないもの」）。純粋。
 * 数と大きさ、**そのまま公開する文の欄の名前**（値は出さない）、最後に「上げる前に一度読む」。
 * 機械と持ち主の情報は書き出しが外し、点検が断る。ここに挙げるのは、人が読んで決める中身。
 */

type TextField = { readonly label: string; readonly path: string; readonly values: (source: DemoSource) => readonly (string | null | undefined)[] }

const TEXT_FIELDS: readonly TextField[] = [
  { label: 'ルック', path: 'project.styleGuide', values: (s) => [s.project.styleGuide] },
  { label: '避けたいもの', path: 'project.avoid', values: (s) => [s.project.avoid] },
  { label: '歌詞', path: 'project.lyrics', values: (s) => [s.project.lyrics] },
  { label: 'コンセプト・あらすじ', path: 'concept', values: (s) => [s.concept] },
  { label: '曲の題', path: 'tracks[].track.title', values: (s) => s.tracks.map((t) => t.track.title) },
  { label: 'Shot の説明', path: 'shots[].shot.description', values: (s) => s.shots.map((e) => e.shot.description) },
  { label: 'Shot の雰囲気', path: 'shots[].shot.mood', values: (s) => s.shots.map((e) => e.shot.mood) },
  { label: 'セリフ', path: 'shots[].shot.dialogue[].text', values: (s) => s.shots.flatMap((e) => e.shot.dialogue.map((d) => d.text)) },
  { label: 'Take の指示文', path: 'shots[].takes[].spec.prompt', values: (s) => s.shots.flatMap((e) => e.takes.map((t) => t.spec.prompt)) },
  { label: 'Take の送った文', path: 'shots[].takes[].sentPrompt', values: (s) => s.shots.flatMap((e) => e.takes.map((t) => t.sentPrompt?.prompt)) },
  { label: '作り直しの理由', path: 'shots[].takes[].regenerationReason', values: (s) => s.shots.flatMap((e) => e.takes.map((t) => t.regenerationReason)) },
  { label: 'キャラクターの名前・説明', path: 'characters[]', values: (s) => s.characters.flatMap((c) => [c.name, c.displayName, c.description, ...c.identityAnchors]) },
  { label: 'キャラクターの声の説明', path: 'characters[].voiceDescription', values: (s) => s.characters.flatMap((c) => [c.speechName, c.voiceDescription]) },
  { label: 'Look の名前・説明', path: 'characterAssets[].looks[].look', values: (s) => s.characterAssets.flatMap((a) => a.looks.flatMap((l) => [l.look.name, l.look.description])) },
  { label: 'ロケーション', path: 'locations[]', values: (s) => s.locations.flatMap((l) => [l.name, l.description]) },
  { label: 'ブランド資産', path: 'brandAssets[]', values: (s) => s.brandAssets.flatMap((b) => [b.name, b.value, b.usageRule]) },
  { label: '文字の見た目の名前', path: 'textStyles[].name', values: (s) => s.textStyles.map((t) => t.name) },
  { label: 'テロップの文字', path: 'clips[].content.params.text', values: (s) => s.clips.map((c) => (c.content.type === 'text' && typeof c.content.params.text === 'string' ? c.content.params.text : null)) },
  { label: 'シーケンス', path: 'sequences[]', values: (s) => s.sequences.flatMap((q) => [q.name, q.notes]) },
  { label: '声の名前・話し方', path: 'voices[]', values: (s) => s.voices.flatMap((v) => [v.name, v.styleNote]) },
  { label: 'ナレーションの原稿', path: 'narrationLines[].text', values: (s) => s.narrationLines.map((l) => l.text) },
]

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'] as const

const formatSize = (bytes: number): string => {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${BYTE_UNITS[unit] ?? 'B'}`
}

const hasText = (value: string | null | undefined): boolean => typeof value === 'string' && value.trim() !== ''

export const exportReviewLines = (manifest: DemoManifest): readonly string[] => {
  const source = parseDemoSource(manifest.source)
  const takes = source.shots.reduce((sum, entry) => sum + entry.takes.length, 0)
  const published = TEXT_FIELDS.filter((field) => field.values(source).some(hasText))
  return [
    `Shot ${String(source.shots.length)} 件・Take ${String(takes)} 件・素材のファイル ${String(manifest.media.length)} 件（合わせて ${formatSize(demoTotalBytes(manifest))}）`,
    'そのまま公開する文の欄:',
    ...(published.length === 0 ? ['  （ありません）'] : published.map((field) => `  - ${field.label}（${field.path}）`)),
    '素材のファイルそのものの中の情報（写真の撮影情報など）は見ていません。',
    '上げる前に、manifest.json を一度読んでください。',
  ]
}
