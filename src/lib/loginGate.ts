/**
 * A pergunta de conta aparece uma vez, na primeira abertura, antes do vault.
 *
 * "Continuar sem conta" grava a resposta: o app é local-first e não deve
 * interrogar o mesmo usuário a cada inicialização. A flag é local (localStorage),
 * não vai para a conta — quem reinstalar o app vê a tela de novo.
 */
const LOGIN_SKIPPED_KEY = 'mirrormind.account.login-skipped'

export function readLoginSkipped(): boolean {
  try {
    return localStorage.getItem(LOGIN_SKIPPED_KEY) === 'true'
  } catch {
    // localStorage indisponível (WebView restrito): trata como já respondido,
    // senão a tela abriria em loop.
    return true
  }
}

export function markLoginSkipped() {
  try {
    localStorage.setItem(LOGIN_SKIPPED_KEY, 'true')
  } catch {
    // melhor esforço: sem localStorage não há o que gravar
  }
}

/** "Sair" devolve o app à tela de login: a pergunta precisa voltar a aparecer. */
export function clearLoginSkipped() {
  try {
    localStorage.removeItem(LOGIN_SKIPPED_KEY)
  } catch {
    // melhor esforço
  }
}
