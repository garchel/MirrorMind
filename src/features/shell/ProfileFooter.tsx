import { Settings } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { useEntitlement } from '../../lib/entitlement'
import { deriveProfile, initialsFrom } from '../../lib/profile'
import { disabledSessionClient, useSession, type SessionClient } from '../../lib/session'

/**
 * Rodape de perfil do trilho: avatar + nome + plano e um atalho de
 * configuracoes, no lugar do antigo botao "Configuracoes".
 *
 * - Clicar na identidade abre um menu (Configuracoes / Entrar / Sair).
 * - O icone de engrenagem vai direto para Configuracoes.
 * - Com o trilho recolhido, o CSS esconde nome/engrenagem: o avatar
 *   continua abrindo o menu, entao Configuracoes nao fica inacessivel.
 *
 * A conta so aparece quando o App injeta o cliente (`accountClient`); sem
 * cobranca ligada, o menu mostra apenas Configuracoes e o plano resolvido
 * (Grátis por padrao).
 */
export function ProfileFooter({
  accountClient,
  onOpenSettings,
  onOpenAccount,
  localProfile,
  onSwitchProfile,
}: {
  accountClient: SessionClient | null
  onOpenSettings: () => void
  /** Abre a página de conta (entrar, criar, sair). */
  onOpenAccount: () => void
  /** Perfil local em uso neste vault (quem está estudando), se houver. */
  localProfile?: { name: string; color: string } | null
  /** Reabre "Quem está usando este vault?" para trocar de perfil a quente. */
  onSwitchProfile?: () => void
}) {
  const { resolved } = useEntitlement()
  const { snapshot, signOut } = useSession(accountClient ?? disabledSessionClient)
  const conta = deriveProfile(snapshot, resolved.plan)
  // O rodapé mostra **quem está usando o vault**; a conta vira a segunda linha
  // (plano) e o menu. Sem perfil local, cai na identidade de antes.
  const profile = localProfile
    ? {
        ...conta,
        name: localProfile.name,
        initials: initialsFrom(localProfile.name),
      }
    : conta

  return (
    <div className="rail-profile">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="bare"
            className="rail-profile-main"
            aria-label={`Abrir menu do perfil: ${profile.name}`}
            title={profile.name}
          >
            <span className="rail-profile-avatar" aria-hidden="true">{profile.initials}</span>
            <span className="rail-profile-copy">
              <span className="rail-profile-name">{profile.name}</span>
              <span className="rail-profile-plan">{profile.planLabel}</span>
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" sideOffset={8} className="rail-profile-menu">
          <div className="rail-profile-menu-head">
            <span className="rail-profile-avatar" aria-hidden="true">{profile.initials}</span>
            <span className="rail-profile-copy">
              <span className="rail-profile-name" title={profile.name}>{profile.name}</span>
              <span className="rail-profile-plan">{profile.planLabel}</span>
            </span>
          </div>
          {onSwitchProfile ? (
            <Button
              type="button"
              variant="bare"
              size="sm"
              className="rail-profile-menu-item"
              onClick={onSwitchProfile}
            >
              Trocar de perfil
            </Button>
          ) : null}
          <Button
            type="button"
            variant="bare"
            size="sm"
            className="rail-profile-menu-item"
            onClick={onOpenSettings}
          >
            <Settings size={15} strokeWidth={1.6} aria-hidden="true" />
            Configurações
          </Button>
          {accountClient ? (
            <>
              {profile.signedIn ? (
                <Button
                  type="button"
                  variant="bare"
                  size="sm"
                  className="rail-profile-menu-item"
                  onClick={onOpenAccount}
                >
                  Conta
                </Button>
              ) : null}
              {/* "Sair" existe nos dois estados: com conta, encerra a sessão;
                  como convidado, leva à tela de login. Antes o convidado via
                  "Entrar na conta" e o logado via "Sair" — dois rótulos para a
                  mesma porta, e nenhum caminho de volta para o login. */}
              <Button
                type="button"
                variant="bare"
                size="sm"
                className="rail-profile-menu-item"
                onClick={() => {
                  void (async () => {
                    if (profile.signedIn) await signOut()
                    onOpenAccount()
                  })()
                }}
              >
                Sair
              </Button>
            </>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  )
}
