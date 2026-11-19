import { useEffect, useRef, useState } from 'react'
import {
  BookOpenCheck,
  ClipboardList,
  Cpu,
  Database,
  Keyboard,
  MonitorSmartphone,
  Palette,
  Type,
} from 'lucide-react'

/** Domínio de Configurações: seções, grupos do menu lateral e navegação.
 *
 * Extraído do App.tsx (sem mudança de comportamento): o menu lateral é
 * agrupado por afinidade, a seção ativa segue o painel rolável e a
 * command palette pode abrir Configurações já rolando até uma seção. */

export const SETTINGS_SECTIONS = [
  { id: 'aparencia', label: 'Aparência', icon: Palette },
  { id: 'editor', label: 'Editor', icon: Type },
  { id: 'leitura', label: 'Leitura', icon: BookOpenCheck },
  { id: 'atalhos', label: 'Atalhos', icon: Keyboard },
  { id: 'revisao', label: 'Revisão', icon: ClipboardList },
  { id: 'ia', label: 'IA da revisão', icon: Cpu },
  { id: 'sistema', label: 'Sistema', icon: MonitorSmartphone },
  { id: 'dados', label: 'Dados', icon: Database },
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id']

/** Menu lateral das Configuracoes, agrupado por afinidade para leitura rapida. */
export const SETTINGS_GROUPS = [
  { id: 'interface', label: 'Interface', sections: ['aparencia', 'editor', 'leitura', 'atalhos'] },
  { id: 'revisao', label: 'Revisão', sections: ['revisao', 'ia'] },
  { id: 'sistema', label: 'Sistema', sections: ['sistema', 'dados'] },
] as const

/** Navegação das Configurações: seção ativa (destaque do menu conforme o
 * painel rola), rolagem por clique e abertura pendente vinda da palette. */
/** Respiro acima da secao depois de rolar (o `scroll-margin-top` que o
 * `scrollIntoView` respeitava sozinho). */
const SCROLL_GAP = 8

export function useSettingsNav(isSettingsOpen: boolean) {
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>('aparencia')
  const settingsScrollRef = useRef<HTMLElement>(null)
  const pendingSettingsSectionRef = useRef<SettingsSectionId | null>(null)

  /** Destaque no menu lateral conforme a secao visivel no painel rolavel.
   * Engata ao ABRIR as Configuracoes: o painel (`settingsScrollRef`) so
   * existe com a pagina montada, entao o efeito com `[]` lia a ref nula no
   * mount do App e nunca anexava o listener. */
  useEffect(() => {
    if (!isSettingsOpen) return
    const panel = settingsScrollRef.current
    if (!panel) return
    const updateActiveSection = () => {
      const panelTop = panel.getBoundingClientRect().top
      let current: SettingsSectionId = SETTINGS_SECTIONS[0].id
      for (const section of SETTINGS_SECTIONS) {
        const element = document.getElementById(`settings-${section.id}`)
        if (element && element.getBoundingClientRect().top - panelTop <= 140) {
          current = section.id
        }
      }
      setActiveSettingsSection(current)
    }
    updateActiveSection()
    panel.addEventListener('scroll', updateActiveSection, { passive: true })
    return () => panel.removeEventListener('scroll', updateActiveSection)
  }, [isSettingsOpen])

  /** Rola SO o painel ate a secao escolhida.
   *
   * `scrollIntoView` arrasta todos os ancestrais rolaveis — inclusive a janela —
   * e a casca do app subia junto, saindo da tela. Aqui a conta e feita com o
   * `scrollTop` do proprio painel. */
  function scrollSectionIntoPanel(sectionId: SettingsSectionId) {
    const panel = settingsScrollRef.current
    const element = document.getElementById(`settings-${sectionId}`)
    if (!panel || !element) return
    if (typeof panel.scrollTo !== 'function') return
    const top = element.getBoundingClientRect().top
      - panel.getBoundingClientRect().top
      + panel.scrollTop
      - SCROLL_GAP
    panel.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }

  /** Rola o painel de Configuracoes ate a secao escolhida no menu lateral. */
  function scrollToSettingsSection(sectionId: SettingsSectionId) {
    setActiveSettingsSection(sectionId)
    scrollSectionIntoPanel(sectionId)
  }

  /** Registra a secao pedida (ex.: palette "atalhos"); o efeito abaixo rola
   * ate ela quando as Configuracoes estiverem abertas. */
  function requestSettingsSection(sectionId: SettingsSectionId) {
    pendingSettingsSectionRef.current = sectionId
  }

  useEffect(() => {
    if (!isSettingsOpen) return
    const pending = pendingSettingsSectionRef.current
    if (!pending) return
    pendingSettingsSectionRef.current = null
    setActiveSettingsSection(pending)
    const frame = window.requestAnimationFrame(() => {
      scrollSectionIntoPanel(pending)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isSettingsOpen])

  return {
    SETTINGS_SECTIONS,
    SETTINGS_GROUPS,
    activeSettingsSection,
    settingsScrollRef,
    scrollToSettingsSection,
    requestSettingsSection,
  }
}
