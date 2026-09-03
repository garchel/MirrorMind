import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Divisao de dependencias em chunks estaveis por familia (code splitting):
// o main fica com o codigo do app (~400 kB), cada familia de dependencias
// pesada vira um chunk nomeado cacheavel, e nada passa de 500 kB (exceto o
// three, que e lazy-loaded somente quando o grafo 3D abre — ver abaixo).
function vendorChunkId(id: string) {
  if (!id.includes('node_modules')) return undefined
  const match = id.match(/node_modules\/(?:@[^/]+\/)?[^/]+/)
  const pkg = match?.[0].replace('node_modules/', '') ?? ''
  if (pkg === 'three' || pkg.startsWith('three/')) return 'vendor-three'
  if (pkg.startsWith('pdfjs')) return 'vendor-pdf'
  if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler' || pkg === 'react-is') return 'vendor-react'
  if (pkg === 'katex') return 'vendor-katex'
  if (pkg === 'rehype-katex') return 'vendor-rehype-katex'
  if (pkg.startsWith('@codemirror') || pkg.startsWith('@lezer')) {
    // Um chunk por pacote: o legacy-modes sozinho tem ~460 kB e o
    // lang-angular ~170 kB; agrupar tudo em um unico chunk passaria de
    // 1 MB. O nucleo do editor (view/state/language/commands/search) fica
    // em vendor-codemirror-core.
    const name = pkg.replace('@codemirror/', 'cm-').replace('@lezer/', 'lezer-')
    if (name === 'cm-view' || name === 'cm-state' || name === 'cm-language' || name === 'cm-commands' || name === 'cm-search') {
      return 'vendor-codemirror-core'
    }
    return `vendor-codemirror-${name}`
  }
  if (pkg === 'yaml') return 'vendor-yaml'
  if (pkg === 'zod') return 'vendor-zod'
  if (pkg.startsWith('@tauri-apps') || pkg.startsWith('@radix-ui') || pkg === 'vaul') return 'vendor-ui'
  if (pkg === 'lucide-react' || pkg === 'react-icons') return 'vendor-icons'
  // Stack react-markdown (remark/rehype/hast/mdast/unist/vfile e auxiliares).
  if (
    /^(react-markdown|remark|rehype|hast|mdast|micromark|unist|vfile|comma-separated-tokens|property-information|space-separated-tokens|stringify-entities|character-entities|trim-lines|bail|ccount|decode-named-character-reference|devlop|extend|is-plain-obj|longest-streak|lowlight|parse-entities|html-url-attributes|unified|trough|remark-parse|remark-rehype|remark-stringify)/.test(pkg)
  ) {
    return 'vendor-markdown'
  }
  return 'vendor-misc'
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Unico chunk acima de 500 kB e o vendor-three (lazy-loaded apenas quando
    // o grafo 3D e aberto); 600 acomoda o three + o componente NoteGraph3D.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: vendorChunkId,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/vitest.setup.ts',
    // App.regression/ReviewSession renderizam o app inteiro; sob carga de
    // paralelismo (CI ou suite cheia) ultrapassavam o default de 5s como
    // flakiness, nao como regressao. 15s cobre o pior caso observado (~10s)
    // sem permitir hang passar despercebido.
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/vitest.setup.ts',
      ],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage/frontend',
    },
  },
})
