import { describe, expect, it } from 'vitest'
import { formatBytes, reportCount, summarizeReport, type CloudReport } from './cloudSync'

function relatorio(over: Partial<CloudReport> = {}): CloudReport {
  return {
    uploaded: [],
    downloaded: [],
    conflicts: [],
    deleted: [],
    skipped: [],
    failed: [],
    bytesUp: 0,
    bytesDown: 0,
    ...over,
  }
}

describe('resumo do ciclo de sincronização', () => {
  it('ciclo sem mudanças diz que está tudo em dia', () => {
    expect(summarizeReport(relatorio())).toBe('Tudo já estava sincronizado.')
  })

  it('conta cada tipo de trabalho separadamente', () => {
    const texto = summarizeReport(
      relatorio({
        uploaded: ['a', 'b'],
        downloaded: ['c'],
        conflicts: ['d'],
        failed: [{ path: 'e', reason: 'sem conexão' }],
      }),
    )
    expect(texto).toContain('2 enviado(s)')
    expect(texto).toContain('1 recebido(s)')
    expect(texto).toContain('1 conflito(s)')
    expect(texto).toContain('1 com erro')
  })

  it('erro não é escondido pelo sucesso', () => {
    const texto = summarizeReport(
      relatorio({ uploaded: ['a'], failed: [{ path: 'b', reason: 'falhou' }] }),
    )
    expect(texto).toMatch(/enviado.*erro/)
  })

  it('itens do relatório somam o que a tela exibe', () => {
    expect(
      reportCount(relatorio({ uploaded: ['a'], skipped: ['b'], deleted: ['c'] })),
    ).toBe(3)
  })
})

describe('tamanho legível', () => {
  it('usa a unidade certa em cada faixa', () => {
    expect(formatBytes(0)).toBe('0 KB')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB')
  })
})
