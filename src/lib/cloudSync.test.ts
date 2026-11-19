import { describe, expect, it } from 'vitest'
import {
  cloudIndicatorState,
  formatBytes,
  formatLastSync,
  reportCount,
  summarizeReport,
  type CloudReport,
} from './cloudSync'

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

describe('última sincronização', () => {
  it('sem data, diz que nunca aconteceu', () => {
    expect(formatLastSync(null)).toBe('nunca')
    expect(formatLastSync('não é data')).toBe('nunca')
  })

  it('formata no padrão brasileiro, dia e hora', () => {
    const texto = formatLastSync('2026-11-19T17:30:00Z')
    expect(texto).toMatch(/\d{2}\/\d{2}/)
    expect(texto).toMatch(/\d{2}:\d{2}/)
  })
})

describe('estado do indicador da nuvem', () => {
  it('sem vínculo, nada aparece', () => {
    expect(cloudIndicatorState({ linked: false, syncing: true, lastError: null })).toBe('off')
  })

  it('sincronizando vence erro anterior', () => {
    expect(cloudIndicatorState({ linked: true, syncing: true, lastError: 'falhou' })).toBe(
      'syncing',
    )
  })

  it('erro recente aparece até o próximo ciclo dar certo', () => {
    expect(cloudIndicatorState({ linked: true, syncing: false, lastError: 'falhou' })).toBe(
      'error',
    )
    expect(cloudIndicatorState({ linked: true, syncing: false, lastError: null })).toBe('synced')
  })
})
