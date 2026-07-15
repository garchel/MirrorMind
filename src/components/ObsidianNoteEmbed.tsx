import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getMarkdownBody } from '../lib/markdown'
import { extractObsidianEmbedFragment } from '../lib/obsidianEmbed'
import { parseNoteDocument } from '../lib/vault'

type ObsidianNoteEmbedProps = {
  fragment: string | null
  relativePath: string
  renderContent: (content: string) => ReactNode
  vaultPath: string
}

const MAX_CONCURRENT_EMBED_READS = 4
const embedReadQueue: Array<() => void> = []
const inFlightEmbedReads = new Map<string, Promise<unknown>>()
let activeEmbedReads = 0

function runNextEmbedRead() {
  if (activeEmbedReads >= MAX_CONCURRENT_EMBED_READS) return
  embedReadQueue.shift()?.()
}

function scheduleEmbedRead(task: () => Promise<unknown>) {
  return new Promise<unknown>((resolve, reject) => {
    const run = () => {
      activeEmbedReads += 1
      void task().then(resolve, reject).finally(() => {
        activeEmbedReads -= 1
        runNextEmbedRead()
      })
    }
    embedReadQueue.push(run)
    runNextEmbedRead()
  })
}

function readEmbeddedNote(vaultPath: string, relativePath: string) {
  const key = `${vaultPath}\u0000${relativePath}`
  const existing = inFlightEmbedReads.get(key)
  if (existing) return existing

  const request = scheduleEmbedRead(() => invoke<unknown>('read_note', { path: vaultPath, relativePath }))
  inFlightEmbedReads.set(key, request)
  void request.finally(() => inFlightEmbedReads.delete(key)).catch(() => undefined)
  return request
}

export function ObsidianNoteEmbed({ fragment, relativePath, renderContent, vaultPath }: ObsidianNoteEmbedProps) {
  const [content, setContent] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setContent(null)
    void readEmbeddedNote(vaultPath, relativePath)
      .then((payload) => {
        if (!cancelled) setContent(extractObsidianEmbedFragment(getMarkdownBody(parseNoteDocument(payload).content), fragment))
      })
      .catch(() => {
        if (!cancelled) setContent('')
      })
    return () => { cancelled = true }
  }, [fragment, relativePath, vaultPath])

  if (content === null) return <section className="obsidian-note-embed is-loading">Carregando nota incorporada...</section>
  if (!content) return <section className="obsidian-note-embed is-missing">A nota incorporada nao foi encontrada.</section>

  return <section className="obsidian-note-embed">{renderContent(content)}</section>
}
