import type { AgentInline } from '@/lib/agent-text'
import { parseAgentText } from '@/lib/agent-text'

const Inline = ({ parts }: { readonly parts: readonly AgentInline[] }) => (
  <>
    {parts.map((part, i) => {
      if (part.kind === 'strong') return <strong key={i}>{part.text}</strong>
      if (part.kind === 'code') return <code key={i} className="rounded bg-surface-2 px-1 font-mono text-xs">{part.text}</code>
      return <span key={i}>{part.text}</span>
    })}
  </>
)

/** エージェントの返事を整形して描く（ADR-0058）。HTML は作らない。 */
export const AgentText = ({ text }: { readonly text: string }) => (
  <div className="space-y-2 text-sm leading-relaxed text-text">
    {parseAgentText(text).map((block, i) => {
      switch (block.kind) {
        case 'heading':
          return <p key={i} className="font-semibold"><Inline parts={block.inline} /></p>
        case 'paragraph':
          return <p key={i} className="whitespace-pre-wrap break-words"><Inline parts={block.inline} /></p>
        case 'code':
          return <pre key={i} className="overflow-x-auto rounded bg-surface-2 p-2 font-mono text-xs">{block.text}</pre>
        case 'list': {
          const items = block.items.map((item, j) => <li key={j}><Inline parts={item} /></li>)
          return block.ordered ? (
            <ol key={i} className="list-decimal space-y-0.5 pl-5">{items}</ol>
          ) : (
            <ul key={i} className="list-disc space-y-0.5 pl-5">{items}</ul>
          )
        }
      }
    })}
  </div>
)
