import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewCalibrationSettings } from './ReviewCalibrationSettings'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('../../lib/tauri', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/tauri')>()
  return { ...original, invoke: invokeMock }
})

// O painel de comparacao le o sidecar por um comando proprio. Sem este mock
// ele falha e vira um segundo `alert` na tela, quebrando as consultas por
// papel.
vi.mock('./calibrationComparison', async (importOriginal) => {
  const original = await importOriginal<typeof import('./calibrationComparison')>()
  return {
    ...original,
    getCalibrationComparison: vi.fn().mockResolvedValue({
      total: 0,
      divergences: 0,
      divergenceRate: null,
      recent: [],
      collecting: false,
    }),
  }
})

afterEach(() => {
  cleanup()
  invokeMock.mockReset()
})

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'

function state(overrides: Record<string, unknown> = {}) {
  return {
    strategy: 'off',
    typesafeConfigured: false,
    typesafeConsent: false,
    calibrationValidated: false,
    typesafeEndpoint: ENDPOINT,
    ...overrides,
  }
}

function respond(configuration: Record<string, unknown>) {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'get_calibration_configuration') return configuration
    if (command === 'set_calibration_strategy_for_vault') {
      return { ...configuration, strategy: 'jev', typesafeConfigured: true, typesafeConsent: true }
    }
    if (command === 'confirm_typesafe_data_consent') return true
    if (command === 'set_typesafe_data_consent') return { ...configuration, typesafeConsent: false, strategy: 'off' }
    if (command === 'configure_typesafe_api_key') return { ...configuration, typesafeConfigured: true }
    if (command === 'remove_typesafe_api_key') return { ...configuration, strategy: 'off', typesafeConfigured: false }
    throw new Error(`comando inesperado: ${command}`)
  })
}

describe('ReviewCalibrationSettings', () => {
  it('pede um Vault aberto', () => {
    render(<ReviewCalibrationSettings />)
    expect(screen.getByText(/Abra um Vault/)).toBeInTheDocument()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('nao repete a leitura a cada render', async () => {
    // Regressao: a engine era criada dentro do render, entao o `useEffect`
    // — que depende de `[engine]` — re-executava a cada render. O efeito
    // visivel era o `select` controlado voltando ao valor do backend sem
    // parar, e o usuario via as opcoes sem conseguir selecionar nenhuma.
    const user = userEvent.setup()
    respond(state())
    render(<ReviewCalibrationSettings vaultPath={'C:\\Vault'} />)

    const select = await screen.findByLabelText(/Como julgar/)
    await waitFor(() => expect(
      invokeMock.mock.calls.filter((call) => call[0] === 'get_calibration_configuration').length,
    ).toBe(1))

    // Interagir com o painel nao pode disparar nova leitura.
    await user.type(screen.getByLabelText(/Chave da TypeSafe AI/), 'x')
    await waitFor(() => expect(
      invokeMock.mock.calls.filter((call) => call[0] === 'get_calibration_configuration').length,
    ).toBe(1))
    expect(select).toBeInTheDocument()
  })

  it('permite escolher uma estrategia disponivel', async () => {
    // O caminho feliz que o bug anterior impedia: com chave e autorizacao, o
    // `jev` tem de ser selecionavel e a escolha tem de chegar ao backend.
    const user = userEvent.setup()
    respond(state({ typesafeConfigured: true, typesafeConsent: true }))
    render(<ReviewCalibrationSettings vaultPath={'C:\\Vault'} />)

    const select = await screen.findByLabelText(/Como julgar/)
    const jevOption = (select as HTMLSelectElement).querySelector('option[value="jev"]')
    await waitFor(() => expect((jevOption as HTMLOptionElement | null)?.disabled).toBe(false))

    await user.selectOptions(select, 'jev')

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      'set_calibration_strategy_for_vault',
      { vaultRoot: 'C:\\Vault', strategy: 'jev' },
    ))
  })

  it('mantem a opcao escolhida na tela depois da troca', async () => {
    // O `select` e controlado pelo estado. Se a escolha reverter, o usuario
    // ve o valor antigo e conclui que nada aconteceu.
    const user = userEvent.setup()
    let strategy = 'off'
    respond(state({ typesafeConfigured: true, typesafeConsent: true }))
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'get_calibration_configuration') {
        return state({ typesafeConfigured: true, typesafeConsent: true, strategy })
      }
      if (command === 'set_calibration_strategy_for_vault') {
        strategy = args?.strategy as string
        return state({ typesafeConfigured: true, typesafeConsent: true, strategy })
      }
      throw new Error(`comando inesperado: ${command}`)
    })
    render(<ReviewCalibrationSettings vaultPath={'C:\\Vault'} />)

    const select = await screen.findByLabelText(/Como julgar/)
    await user.selectOptions(select, 'jev')

    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('jev'))
  })

  it('explica por que as opcoes calibradas estao indisponiveis', async () => {
    // Um option desabilitado sem explicacao parece bug. O texto diz o que
    // falta.
    respond(state())
    render(<ReviewCalibrationSettings vaultPath={'C:\\Vault'} />)

    // O texto aparece nas duas opcoes desabilitadas e no paragrafo de
    // orientacao, entao a busca e por todos.
    expect(await screen.findAllByText(/falta a chave da TypeSafe AI/i)).toHaveLength(3)
    expect(screen.getByText(/ainda não configurada/i)).toBeInTheDocument()
    expect(screen.getByText(/ainda não concedida/i)).toBeInTheDocument()
  })

  it('oferece os três modos, deixando indisponíveis os que faltam credencial', async () => {
    respond(state())
    render(<ReviewCalibrationSettings vaultPath={'C:\\Vault'} />)

    const select = await screen.findByLabelText(/Como julgar/)
    expect(select).toBeInTheDocument()
    const options = Array.from(select.querySelectorAll('option')) as HTMLOptionElement[]
    expect(options.map((option) => option.value)).toEqual(['off', 'jev', 'dual'])
    expect(options.find((option) => option.value === 'jev')?.disabled).toBe(true)
    expect(options.find((option) => option.value === 'off')?.disabled).toBe(false)
  })

  it('libera jev e dual depois que chave e autorização existem', async () => {
    respond(state({ typesafeConfigured: true, typesafeConsent: true }))
    render(<ReviewCalibrationSettings vaultPath={'C:\\Vault'} />)

    const select = await screen.findByLabelText(/Como julgar/)
    const options = Array.from(select.querySelectorAll('option')) as HTMLOptionElement[]
    expect(options.every((option) => !option.disabled)).toBe(true)
  })

  it('avisa que a confiança ainda não foi validada', async () => {
    // Decisão D10: o número aparece desde já, mas a legenda diz que ele não foi
    // medido contra veredito humano. Esconder o número seria honesto e
    // impediria coletar o dado que precisa validá-lo.
    respond(state())
    render(<ReviewCalibrationSettings vaultPath={'C:\\Vault'} />)

    expect(await screen.findByText(/não foi validada/i)).toBeInTheDocument()
  })

  it('silencia o aviso de validação depois que o harness confirma', async () => {
    respond(state({ calibrationValidated: true }))
    render(<ReviewCalibrationSettings vaultPath={'C:\\Vault'} />)

    await screen.findByLabelText(/Como julgar/)
    expect(screen.queryByText(/não foi validada/i)).not.toBeInTheDocument()
  })

  it('recusa um estado impossível em vez de renderizar o painel', async () => {
    // `jev` sem autorização nunca deveria chegar à UI: o schema rejeita na
    // fronteira. Se chegar, é bug — e a resposta honesta é dizer que não
    // dá para confiar no estado, não desenhar um painel Operating normally.
    respond(state({ strategy: 'jev', typesafeConfigured: true, typesafeConsent: false }))
    render(<ReviewCalibrationSettings vaultPath={'C:\\Vault'} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/autoriza/i)
    expect(screen.queryByLabelText(/Como julgar/)).not.toBeInTheDocument()
  })

  it('não oferece o checkbox de autorização já marcado', async () => {
    // Desmarcar é revogar; marcar de novo exigiria o diálogo nativo. Um
    // checkbox que aceitasse `true` do renderer burlaria o diálogo do SO.
    respond(state({ typesafeConsent: true, typesafeConfigured: true }))
    render(<ReviewCalibrationSettings vaultPath={'C:\\Vault'} />)

    const checkbox = await screen.findByRole('checkbox')
    expect(checkbox).toBeChecked()
    expect(checkbox).toBeDisabled()
  })

  it('concede a autorização pelo diálogo nativo do sistema operacional', async () => {
    const user = userEvent.setup()
    let consent = false
    respond(state())
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'get_calibration_configuration') {
        return consent ? state({ typesafeConsent: true, typesafeConfigured: true }) : state()
      }
      if (command === 'confirm_typesafe_data_consent') {
        consent = true
        return true
      }
      throw new Error(`comando inesperado: ${command}`)
    })
    render(<ReviewCalibrationSettings vaultPath={'C:\\Vault'} />)

    const checkbox = await screen.findByRole('checkbox')
    await user.click(checkbox)

    await waitFor(() => expect(checkbox).toBeChecked())
    expect(invokeMock).toHaveBeenCalledWith('confirm_typesafe_data_consent', undefined)
  })

  it('nunca pede concessão de autorização pelo renderer', async () => {
    const user = userEvent.setup()
    let consent = false
    respond(state())
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'get_calibration_configuration') {
        return consent ? state({ typesafeConsent: true, typesafeConfigured: true }) : state()
      }
      if (command === 'confirm_typesafe_data_consent') {
        consent = true
        return true
      }
      if (command === 'set_typesafe_data_consent' && args?.consent === true) {
        throw new Error('a concessão por renderer não pode existir')
      }
      return state({ typesafeConsent: false, strategy: 'off' })
    })
    render(<ReviewCalibrationSettings vaultPath={'C:\\Vault'} />)

    await user.click(await screen.findByRole('checkbox'))
    await waitFor(() => expect(consent).toBe(true))
    expect(
      invokeMock.mock.calls.some(
        ([, args]) => args && (args as Record<string, unknown>).consent === true,
      ),
    ).toBe(false)
  })

  it('mostra o erro do backend em vez de cair para off em silêncio', async () => {
    const user = userEvent.setup()
    respond(state({ typesafeConfigured: true, typesafeConsent: true }))
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'get_calibration_configuration') {
        return state({ typesafeConfigured: true, typesafeConsent: true })
      }
      if (command === 'set_calibration_strategy_for_vault') {
        throw new Error('A chave foi revogada no cofre nativo.')
      }
      throw new Error(`comando inesperado: ${command}`)
    })
    render(<ReviewCalibrationSettings vaultPath={'C:\\Vault'} />)

    await user.selectOptions(await screen.findByLabelText(/Como/), 'jev')

    expect(await screen.findByRole('alert')).toHaveTextContent(/revogada no cofre/)
    expect(
      (screen.getByLabelText(/Como/) as HTMLSelectElement).value,
      'não pode fingir que a troca deu certo',
    ).toBe('off')
  })

  it('exibe o destino dos dados para o usuário saber o que sai do Vault', async () => {
    respond(state())
    render(<ReviewCalibrationSettings vaultPath={'C:\\Vault'} />)

    expect(await screen.findByText(ENDPOINT)).toBeInTheDocument()
  })

  it('salva a chave no cofre nativo', async () => {
    const user = userEvent.setup()
    respond(state())
    render(<ReviewCalibrationSettings vaultPath={'C:\\Vault'} />)

    await user.type(await screen.findByLabelText(/Chave da TypeSafe AI/), 'ts-chave-de-teste')
    await user.click(screen.getByRole('button', { name: /Salvar chave/ }))

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      'configure_typesafe_api_key',
      { vaultRoot: 'C:\\Vault', apiKey: 'ts-chave-de-teste' },
    ))
  })

  it('não envia chave vazia', async () => {
    respond(state())
    render(<ReviewCalibrationSettings vaultPath={'C:\\Vault'} />)

    const button = await screen.findByRole('button', { name: /Salvar chave/ })
    expect(button).toBeDisabled()
  })

  it('oferece remover a chave só quando existe chave', async () => {
    respond(state())
    render(<ReviewCalibrationSettings vaultPath={'C:\\Vault'} />)
    expect(screen.queryByRole('button', { name: /Remover chave/ })).not.toBeInTheDocument()

    cleanup()
    respond(state({ typesafeConfigured: true }))
    render(<ReviewCalibrationSettings vaultPath={'C:\\Vault'} />)
    expect(await screen.findByRole('button', { name: /Remover chave/ })).toBeInTheDocument()
  })
})