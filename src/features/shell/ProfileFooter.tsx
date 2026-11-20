import { ChevronRight, LogOut, Settings, Sparkles, UserRound, Users } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { useEntitlement } from '../../lib/entitlement'
import { deriveProfile, initialsFrom } from '../../lib/profile'
import { disabledSessionClient, useSession, type SessionClient } from '../../lib/session'

/**
 * Rodapé de perfil do trilho: avatar + nome + plano, e o menu de conta.
 *
 * Estrutura do menu (inspirada no menu do ChatGPT, **sem** o botão de upgrade ao
 * lado do gatilho — decisão explícita do produto):
 *
 *   [avatar] Nome                         >
 *            Plano
 *   ──────────────────────────────────────
 *   ✦  Fazer upgrade do plano
 *   👥 Trocar de perfil        (só com perfis locais)
 *   👤 Perfil / Entrar na conta
 *   ⚙  Configurações
 *   ──────────────────────────────────────
 *   →  Sair
 *
 * O cabeçalho é clicável e leva à página de conta — é o caminho que a seta
 * promete. "Sair" existe nos dois estados: com conta encerra a sessão; como
 * convidado leva à tela de login.
 */
export function ProfileFooter({
  accountClient,
  onOpenSettings,
  onOpenAccount,
  onOpenUpgrade,
  localProfile,
  onSwitchProfile,
  onLeaveAccount,
}: {
  accountClient: SessionClient | null
  onOpenSettings: () => void
  /** Abre a página de conta (entrar, criar, sair). */
  onOpenAccount: () => void
  /** Abre a página de planos. Sem isto, o item de upgrade não aparece. */
  onOpenUpgrade?: () => void
  /** Perfil local em uso neste vault (quem está estudando), se houver. */
  localProfile?: { name: string; color: string } | null
  /** Reabre "Quem está usando este vault?" para trocar de perfil a quente. */
  onSwitchProfile?: () => void
  /** Encerra a sessão, fecha o vault e volta à tela de login inicial. */
  onLeaveAccount?: () => void
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

  async function sair() {
    if (profile.signedIn) await signOut()
    if (onLeaveAccount) onLeaveAccount()
    else onOpenAccount()
  }

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
          <Button
            type="button"
            variant="bare"
            className="rail-profile-menu-head"
            onClick={onOpenAccount}
            aria-label={`Abrir conta de ${profile.name}`}
          >
            <span className="rail-profile-avatar" aria-hidden="true">{profile.initials}</span>
            <span className="rail-profile-copy">
              <span className="rail-profile-name" title={profile.name}>{profile.name}</span>
              <span className="rail-profile-plan">{profile.planLabel}</span>
            </span>
            <ChevronRight
              size={16}
              strokeWidth={1.6}
              aria-hidden="true"
              className="rail-profile-menu-chevron"
            />
          </Button>

          <div className="rail-profile-menu-group">
            {onOpenUpgrade ? (
              <Button
                type="button"
                variant="bare"
                size="sm"
                className="rail-profile-menu-item"
                onClick={onOpenUpgrade}
              >
                <Sparkles size={15} strokeWidth={1.6} aria-hidden="true" />
                Fazer upgrade do plano
              </Button>
            ) : null}

            {onSwitchProfile ? (
              <Button
                type="button"
                variant="bare"
                size="sm"
                className="rail-profile-menu-item"
                onClick={onSwitchProfile}
              >
                <Users size={15} strokeWidth={1.6} aria-hidden="true" />
                Trocar de perfil
              </Button>
            ) : null}

            {/* "Perfil" só para quem tem conta: para o convidado, o caminho é o
                cabeçalho (que leva à página de conta) e o "Sair" — manter um item
                "Entrar na conta" aqui seria o segundo rótulo para a mesma porta,
                que já foi corrigido uma vez. */}
            {profile.signedIn ? (
              <Button
                type="button"
                variant="bare"
                size="sm"
                className="rail-profile-menu-item"
                onClick={onOpenAccount}
              >
                <UserRound size={15} strokeWidth={1.6} aria-hidden="true" />
                Perfil
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
          </div>

          {accountClient ? (
            <div className="rail-profile-menu-group rail-profile-menu-group--end">
              <Button
                type="button"
                variant="bare"
                size="sm"
                className="rail-profile-menu-item"
                onClick={() => void sair()}
              >
                <LogOut size={15} strokeWidth={1.6} aria-hidden="true" />
                Sair
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  )
}
