/**
 * エージェントの返事を整形した文章にする（ADR-0058）。Markdown の小さな部分集合だけを読む
 * （見出し・段落・箇条書き・番号付き・コード・太字）。**HTML は作らない**（部品が文字として描く）。
 */

export type AgentInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }

export type AgentBlock =
  | { readonly kind: 'heading'; readonly inline: readonly AgentInline[] }
  | { readonly kind: 'paragraph'; readonly inline: readonly AgentInline[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly (readonly AgentInline[])[] }
  | { readonly kind: 'code'; readonly text: string }

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g

export const parseInline = (text: string): readonly AgentInline[] =>
  text
    .split(INLINE)
    .filter((part) => part !== '')
    .map((part): AgentInline => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return { kind: 'strong', text: part.slice(2, -2) }
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return { kind: 'code', text: part.slice(1, -1) }
      return { kind: 'text', text: part }
    })

const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
const HEADING = /^\s*#{1,6}\s+(.*)$/

type Acc = { readonly blocks: readonly AgentBlock[]; readonly paragraph: readonly string[]; readonly code: readonly string[] | null }

const flushParagraph = (acc: Acc): Acc =>
  acc.paragraph.length === 0
    ? acc
    : { ...acc, blocks: [...acc.blocks, { kind: 'paragraph', inline: parseInline(acc.paragraph.join('\n')) }], paragraph: [] }

const addListItem = (acc: Acc, ordered: boolean, text: string): Acc => {
  const flushed = flushParagraph(acc)
  const last = flushed.blocks.at(-1)
  if (last?.kind === 'list' && last.ordered === ordered) {
    return { ...flushed, blocks: [...flushed.blocks.slice(0, -1), { ...last, items: [...last.items, parseInline(text)] }] }
  }
  return { ...flushed, blocks: [...flushed.blocks, { kind: 'list', ordered, items: [parseInline(text)] }] }
}

const step = (acc: Acc, line: string): Acc => {
  if (acc.code !== null) {
    if (line.trim().startsWith('```')) return { ...acc, blocks: [...acc.blocks, { kind: 'code', text: acc.code.join('\n') }], code: null }
    return { ...acc, code: [...acc.code, line] }
  }
  if (line.trim().startsWith('```')) return { ...flushParagraph(acc), code: [] }
  if (line.trim() === '') return flushParagraph(acc)
  const heading = HEADING.exec(line)
  if (heading?.[1] !== undefined) {
    const flushed = flushParagraph(acc)
    return { ...flushed, blocks: [...flushed.blocks, { kind: 'heading', inline: parseInline(heading[1]) }] }
  }
  const bullet = BULLET.exec(line)
  if (bullet?.[1] !== undefined) return addListItem(acc, false, bullet[1])
  const numbered = NUMBERED.exec(line)
  if (numbered?.[1] !== undefined) return addListItem(acc, true, numbered[1])
  return { ...acc, paragraph: [...acc.paragraph, line] }
}

export const parseAgentText = (text: string): readonly AgentBlock[] => {
  const end = text.split('\n').reduce<Acc>(step, { blocks: [], paragraph: [], code: null })
  const closed = end.code === null ? end : { ...end, blocks: [...end.blocks, { kind: 'code' as const, text: end.code.join('\n') }], code: null }
  return flushParagraph(closed).blocks
}
