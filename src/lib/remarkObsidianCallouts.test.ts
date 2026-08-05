import { describe, expect, it } from 'vitest'
import { remarkObsidianCallouts } from './remarkObsidianCallouts'

describe('Obsidian callout remark plugin', () => {
  it('walks deeply nested Markdown without exhausting the call stack', () => {
    const root: { type: string; children?: unknown[] } = { type: 'root', children: [] }
    let current = root
    for (let depth = 0; depth < 25_000; depth += 1) {
      const child: { type: string; children: unknown[] } = { type: 'blockquote', children: [] }
      current.children = [child]
      current = child
    }

    expect(() => remarkObsidianCallouts()(root as never, { value: '' })).not.toThrow()
  })
})
