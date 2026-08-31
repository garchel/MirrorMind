import { afterEach, describe, expect, it, vi } from 'vitest'

// O mock precisa existir antes do import de './updater' (que importa o plugin
// estaticamente); vi.mock e içado (hoisted) e executado antes de qualquer
// import do teste.
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}))

const { toUpdateErrorMessage, checkForAppUpdate } = await import('./updater')
const { check: checkMock } = (await import('@tauri-apps/plugin-updater')) as unknown as {
  check: ReturnType<typeof vi.fn>
}

describe('toUpdateErrorMessage', () => {
  it('traduz falhas de rede para mensagem amigavel', () => {
    const message = toUpdateErrorMessage(new Error('os error 123: failed to lookup address'))
    expect(message).toContain('Não foi possível verificar atualizações agora')
    expect(message).not.toContain('os error')
  })

  it('mantem mensagens desconhecidas com prefixo claro', () => {
    const message = toUpdateErrorMessage(new Error('manifesto inválido'))
    expect(message).toBe('Falha ao verificar atualizações: manifesto inválido')
  })

  it('aceita valores nao-Error', () => {
    const message = toUpdateErrorMessage('boom')
    expect(message).toBe('Falha ao verificar atualizações: boom')
  })

  it('cobre timeout, dns e rede', () => {
    expect(toUpdateErrorMessage(new Error('request timed out')).startsWith('Não')).toBe(true)
    expect(toUpdateErrorMessage(new Error('network unreachable')).startsWith('Não')).toBe(true)
    expect(toUpdateErrorMessage(new Error('dns error')).startsWith('Não')).toBe(true)
    expect(toUpdateErrorMessage(new Error('connection refused')).startsWith('Não')).toBe(true)
  })
})

describe('checkForAppUpdate', () => {
  afterEach(() => {
    checkMock.mockReset()
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('fora do runtime Tauri devolve idle (navegador no Vite)', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    const { status } = await checkForAppUpdate()
    expect(status.kind).toBe('idle')
    expect(checkMock).not.toHaveBeenCalled()
  })

  it('no runtime Tauri com versao nova devolve available com payload de exibicao', async () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    checkMock.mockResolvedValue({
      rid: 1,
      version: '0.2.0',
      currentVersion: '0.1.0',
      body: 'Notas da versao',
      downloadAndInstall: vi.fn(),
    })
    const { status, update } = await checkForAppUpdate()
    expect(status.kind).toBe('available')
    if (status.kind === 'available') {
      expect(status.update.version).toBe('0.2.0')
      expect(status.update.currentVersion).toBe('0.1.0')
      expect(status.update.notes).toBe('Notas da versao')
    }
    expect(update).not.toBeNull()
  })

  it('sem atualizacao devolve upToDate', async () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    checkMock.mockResolvedValue(null)
    const { status } = await checkForAppUpdate()
    expect(status.kind).toBe('upToDate')
  })

  it('erro do plugin vira failed com mensagem amigavel (sem excecao no mount)', async () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    checkMock.mockRejectedValue(new Error('os error 404'))
    const { status } = await checkForAppUpdate()
    expect(status.kind).toBe('failed')
    if (status.kind === 'failed') {
      expect(status.message).toContain('Não foi possível')
    }
  })
})
