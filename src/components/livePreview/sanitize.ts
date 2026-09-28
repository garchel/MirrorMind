/** Sanitizacao de HTML inline (allowlist): extraida de
 * markdownLivePreview.ts sem mudanca de comportamento. */
// --- HTML inline sanitizado (Marco 5) ---------------------------------------
//
// Elementos HTML inline (`<mark>`, `<kbd>`, `<sup>`, `<a>`, ...) viram um
// widget que SANITIZA o conteudo com a mesma base do schema do Leitura
// (rehype-sanitize defaultSchema + mark): tags fora da allowlist sao
// desembrulhadas, tags perigosas (script/style/iframe) removidas por inteiro,
// atributos filtrados (sem `on*`, sem `javascript:`/`data:`). Blocos HTML
// multilinha (HTMLBlock) permanecem crus (view plugins não cruzam linhas).

const HTML_ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'code', 'data', 'del', 'details', 'dfn', 'div',
  'dl', 'dd', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd',
  'li', 'mark', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'small', 'span', 'strong', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr',
])
const HTML_DANGEROUS_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'input', 'button', 'textarea',
  'select', 'base', 'noscript', 'template', 'svg', 'math',
])
const HTML_ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href']),
  img: new Set(['src', 'alt', 'width', 'height']),
  td: new Set(['colspan', 'rowspan', 'align']),
  th: new Set(['colspan', 'rowspan', 'align', 'scope']),
  ol: new Set(['start', 'type']),
  del: new Set(['datetime']),
  ins: new Set(['datetime']),
  table: new Set(['align', 'border', 'width']),
}
const HTML_COMMON_ATTRS = new Set(['class', 'title'])

/** Sanitiza HTML para exibicao (allowlist de tags/atributos, como o Leitura). */
function sanitizeHtml(source: string): string {
  let parsed: Document | null = null
  try {
    parsed = new DOMParser().parseFromString(source, 'text/html')
  } catch {
    return ''
  }
  if (!parsed) return ''

  const walkChildren = (parent: Node) => {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.COMMENT_NODE) {
        parent.removeChild(child)
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const el = child as Element
      const tag = el.tagName.toLowerCase()
      if (HTML_DANGEROUS_TAGS.has(tag)) {
        parent.removeChild(el)
        continue
      }
      if (!HTML_ALLOWED_TAGS.has(tag)) {
        // Desembrulha (preserva texto/filhos) e sanitiza o conteudo solto.
        const fragment = document.createDocumentFragment()
        while (el.firstChild) fragment.appendChild(el.firstChild)
        parent.replaceChild(fragment, el)
        walkChildren(fragment)
        continue
      }
      const allowed = HTML_ALLOWED_ATTRS[tag]
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase()
        const value = attr.value
        if (!(allowed?.has(name) ?? false) && !HTML_COMMON_ATTRS.has(name)) {
          el.removeAttribute(attr.name)
          continue
        }
        if (name === 'href' || name === 'src') {
          const lower = value.trim().toLowerCase()
          if (lower.startsWith('javascript:') || lower.startsWith('data:')) {
            el.removeAttribute(attr.name)
          }
        }
      }
      walkChildren(el)
    }
  }

  walkChildren(parsed.body)
  return parsed.body.innerHTML
}

/** sanitizeHtml memoizado por fonte (DOMParser + walk por widget a cada
 * passada e caro; fontes repetidas reaproveitam). Limite simples anti-vazamento. */
const sanitizeHtmlCache = new Map<string, string>()
const SANITIZE_HTML_CACHE_LIMIT = 200
export function sanitizeHtmlCached(source: string): string {
  const cached = sanitizeHtmlCache.get(source)
  if (cached !== undefined) return cached
  const html = sanitizeHtml(source)
  if (sanitizeHtmlCache.size >= SANITIZE_HTML_CACHE_LIMIT) sanitizeHtmlCache.clear()
  sanitizeHtmlCache.set(source, html)
  return html
}
