import { Settings } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { useEntitlement } from '../../lib/entitlement'
import { deriveProfile } from '../../lib/profile'
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
}: {
  accountClient: SessionClient | null
  onOpenSettings: () => void
}) {
  const { resolved } = useEntitlement()
  const { snapshot, signOut } = useSession(accountClient ?? disabledSessionClient)
  const profile = deriveProfile(snapshot, resolved.plan)

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
            profile.signedIn ? (
              <Button
                type="button"
                variant="bare"
                size="sm"
                className="rail-profile-menu-item"
                onClick={() => void signOut()}
              >
                Sair
              </Button>
            ) : (
              <Button
                type="button"
                variant="bare"
                size="sm"
                className="rail-profile-menu-item"
                onClick={onOpenSettings}
              >
                Entrar na conta
              </Button>
            )
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  )
}
