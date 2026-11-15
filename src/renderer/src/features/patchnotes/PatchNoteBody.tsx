// PatchNoteBody — draws a patch note's sanitized node tree as React elements.
//
// NO `dangerouslySetInnerHTML`: main already reduced the developer's HTML to a closed tree
// (shared/patchNotesHtml.ts), and every tag here goes through `ELEMENT`, a fixed table, so even a
// tree that somehow carried another tag name would draw only its text. Links open in the system
// browser: `target="_blank"` is turned into `shell.openExternal` by main's window-open handler,
// which passes only an allowlisted https URL.

import { createElement, type JSX, type ReactNode } from 'react'
import { Box, Link } from '@mui/material'
import type { PatchNoteNode, PatchNoteTag } from '@shared/patchNotesHtml'

const ELEMENT: Readonly<Record<Exclude<PatchNoteTag, 'a' | 'br'>, string>> = {
  p: 'p',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  ul: 'ul',
  ol: 'ol',
  li: 'li',
  strong: 'strong',
  em: 'em',
  u: 'u',
  s: 's'
}

function renderNodes(nodes: readonly PatchNoteNode[], prefix: string): ReactNode[] {
  return nodes.map((n, i) => renderNode(n, `${prefix}.${String(i)}`))
}

function renderNode(n: PatchNoteNode, key: string): ReactNode {
  if (typeof n === 'string') return n
  if (n.tag === 'br') return <br key={key} />
  const children = renderNodes(n.children, key)
  if (n.tag === 'a') {
    return (
      <Link key={key} href={n.href} target="_blank" rel="noreferrer">
        {children}
      </Link>
    )
  }
  const el = Object.prototype.hasOwnProperty.call(ELEMENT, n.tag) ? ELEMENT[n.tag] : null
  return el === null ? children : createElement(el, { key }, ...children)
}

const BODY_SX = {
  fontSize: 14,
  lineHeight: 1.6,
  color: 'text.primary',
  '& h2': { fontSize: 18, fontWeight: 600, mt: 2.5, mb: 1, color: 'primary.main' },
  '& h3': { fontSize: 16, fontWeight: 600, mt: 2, mb: 0.75 },
  '& h4': { fontSize: 14, fontWeight: 600, mt: 1.5, mb: 0.5 },
  '& p': { my: 1 },
  '& ul, & ol': { pl: 3, my: 1 },
  '& li': { my: 0.4 },
  '& s': { color: 'text.secondary' },
  '& > :first-of-type': { mt: 0 }
} as const

export default function PatchNoteBody({ nodes }: { nodes: readonly PatchNoteNode[] }): JSX.Element {
  return (
    <Box sx={BODY_SX} data-testid="patchnotes-body">
      {renderNodes(nodes, 'n')}
    </Box>
  )
}
