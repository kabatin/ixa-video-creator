import {
  lyricLines,
  lyricsDuring,
  narrationCharBudget,
  type AssistField,
  type Character,
  type CharacterLook,
  type Location,
  type Project,
  type Shot,
} from '@ixa/domain'
import type { AssistContextLine } from '@ixa/provider-llm'

/**
 * 「✦ AI」に渡す材料（ADR-0032 の 3 段目）。**欄ごとに、案を出すのに要るものだけ**を並べる。
 * 自分の欄（いま直している文）は材料に入れない（「いまの文」として別に渡る）。空の材料はプロンプト側で落ちる。
 */

export type AssistMaterials = {
  readonly project: Pick<Project, 'name' | 'styleGuide' | 'avoid' | 'lyrics' | 'lyricCues' | 'durationSec'>
  /** コンセプト・あらすじ（脚本）。まだ無ければ null。 */
  readonly concept: string | null
  /** 作品の Shot（並び順）。前後の Shot を引くのに使う。 */
  readonly shots: readonly Shot[]
  readonly shot: Shot | null
  readonly character: Pick<Character, 'displayName' | 'description' | 'identityAnchors'> | null
  readonly look: Pick<CharacterLook, 'name' | 'era' | 'description' | 'wardrobeTokens'> | null
  readonly location: Pick<Location, 'name'> | null
}

const line = (label: string, text: string): AssistContextLine => ({ label, text })

/** 作品の方針。直している欄そのものは入れない。 */
const projectLines = (field: AssistField, m: AssistMaterials): readonly AssistContextLine[] => [
  line('作品名', m.project.name),
  ...(field === 'concept' ? [] : [line('コンセプト・あらすじ', m.concept ?? '')]),
  ...(field === 'look' ? [] : [line('ルック', m.project.styleGuide)]),
  ...(field === 'avoid' ? [] : [line('避けたいもの', m.project.avoid)]),
]

const shotLines = (field: AssistField, m: AssistMaterials): readonly AssistContextLine[] => {
  const shot = m.shot
  if (shot === null) return []
  const index = m.shots.findIndex((candidate) => candidate.id === shot.id)
  const previous = index > 0 ? m.shots[index - 1] : undefined
  const next = index >= 0 ? m.shots[index + 1] : undefined
  const sung = lyricsDuring(lyricLines(m.project.lyrics), m.project.lyricCues, shot)
  return [
    line('この Shot', `${shot.code}（${shot.startSec.toFixed(2)} 秒から ${shot.durationSec.toFixed(2)} 秒）`),
    line('この Shot で歌われる歌詞', sung.map((text) => `「${text}」`).join('')),
    field === 'shot_mood' ? line('この Shot の説明', shot.description) : line('この Shot の雰囲気', shot.mood ?? ''),
    line('前の Shot の説明', previous?.description ?? ''),
    line('次の Shot の説明', next?.description ?? ''),
  ]
}

const characterLines = (field: AssistField, m: AssistMaterials): readonly AssistContextLine[] =>
  m.character === null
    ? []
    : [
        line('人物', m.character.displayName),
        line('人物の説明', m.character.description),
        ...(field === 'identity_anchors' ? [] : [line('識別アンカー', m.character.identityAnchors.join('、'))]),
      ]

const lookLines = (m: AssistMaterials): readonly AssistContextLine[] =>
  m.look === null
    ? []
    : [line('Look', `${m.look.name}${m.look.era === null ? '' : `（${m.look.era}）`}`), line('Look の説明', m.look.description)]

/**
 * ナレーションの原稿（ADR-0038）。作品の長さ（と、そこに収まる目安の字数）と、説明の書けている Shot の流れ。
 * 長さを渡さないと、15 秒の CM に 1 分ぶんの原稿が返る。
 */
const narrationLines = (m: AssistMaterials): readonly AssistContextLine[] => [
  line(
    '作品の長さ',
    m.project.durationSec === null
      ? ''
      : `${String(Math.round(m.project.durationSec))} 秒（読み上げて ${String(narrationCharBudget(m.project.durationSec))} 字ほど）`,
  ),
  line(
    'Shot の流れ',
    m.shots
      .filter((shot) => shot.description.trim() !== '')
      .map((shot) => `${shot.code}: ${shot.description.trim()}`)
      .join(' / '),
  ),
]

export const assistContext = (field: AssistField, m: AssistMaterials): readonly AssistContextLine[] => {
  const base = projectLines(field, m)
  switch (field) {
    case 'concept':
    case 'look':
    case 'avoid':
      return [...base, line('歌詞', m.project.lyrics)]
    case 'shot_description':
    case 'shot_mood':
      return [...base, ...shotLines(field, m)]
    case 'identity_anchors':
      return [...base, ...characterLines(field, m)]
    case 'wardrobe':
      return [...base, ...characterLines(field, m), ...lookLines(m)]
    case 'location_description':
      return [...base, line('ロケーション', m.location?.name ?? '')]
    case 'narration_script':
      return [...base, ...narrationLines(m)]
  }
}
