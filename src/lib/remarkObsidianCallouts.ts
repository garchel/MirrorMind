type MarkdownNode = {
  children?: MarkdownNode[]
  data?: {
    hName?: string
    hProperties?: Record<string, unknown>
  }
  position?: {
    start: { line: number }
  }
  type: string
  value?: string
}

type MarkdownFile = {
  value?: unknown
}

const CALLOUT_HEADER = /^\s*(?:(?:[-+*]|\d+[.)])\s+)?\s*(?:>\s*)+\[!([^\]\s]+)\]([+-])?\s*(.*)$/u

function removeCalloutHeader(paragraph: MarkdownNode) {
  const bodyChildren: MarkdownNode[] = []
  let headerEnded = false

  for (const child of paragraph.children ?? []) {
    if (headerEnded) {
      bodyChildren.push(child)
      continue
    }
    if (child.type !== 'text' || typeof child.value !== 'string') continue

    const newlineIndex = child.value.indexOf('\n')
    if (newlineIndex < 0) continue
    headerEnded = true
    const remainder = child.value.slice(newlineIndex + 1)
    if (remainder) bodyChildren.push({ ...child, value: remainder })
  }

  return bodyChildren
}

function transformCallout(node: MarkdownNode, sourceLines: string[]) {
  if (node.type !== 'blockquote' || !node.position || node.children?.[0]?.type !== 'paragraph') return

  const sourceLine = sourceLines[node.position.start.line - 1] ?? ''
  const header = sourceLine.match(CALLOUT_HEADER)
  if (!header) return

  const firstParagraph = node.children[0]
  const remainingInlineContent = removeCalloutHeader(firstParagraph)
  node.children = remainingInlineContent.length > 0
    ? [{ ...firstParagraph, children: remainingInlineContent }, ...node.children.slice(1)]
    : node.children.slice(1)
  node.data = {
    ...node.data,
    hName: 'blockquote',
    hProperties: {
      ...node.data?.hProperties,
      dataCalloutFold: header[2] ?? '',
      dataCalloutTitle: header[3].trim(),
      dataCalloutType: header[1].toLowerCase(),
    },
  }
}

function walkMarkdownTree(root: MarkdownNode, sourceLines: string[]) {
  const pending = [root]
  while (pending.length > 0) {
    const node = pending.pop()!
    transformCallout(node, sourceLines)
    const children = node.children ?? []
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index])
  }
}

export function remarkObsidianCallouts() {
  return (tree: MarkdownNode, file: MarkdownFile) => {
    walkMarkdownTree(tree, String(file.value ?? '').split('\n'))
  }
}
