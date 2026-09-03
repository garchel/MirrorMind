import { useEffect, useRef, useState } from 'react'
import {
  BookOpenCheck,
  ClipboardList,
  Cpu,
  Keyboard,
  MonitorSmartphone,
  Network,
  Orbit,
  Palette,
  SlidersHorizontal,
} from 'lucide-react'

/** Domínio de Configurações: seções, grupos do menu lateral e navegação.
 *
 * Extraído do App.tsx (sem mudança de comportamento): o menu lateral é
 * agrupado por afinidade, a seção ativa segue o painel rolável e a
 * command palette pode abrir Configurações já rolando até uma seção. */

export const SETTINGS_SECTIONS = [
  { id: 'aparencia', label: 'Aparência', icon: Palette },
  { id: 'workspace', label: 'Workspace', icon: SlidersHorizontal },
  { id: 'leitura', label: 'Leitura', icon: BookOpenCheck },
  { id: 'atalhos', label: 'Atalhos', icon: Keyboard },
  { id: 'grafo3d', label: 'Grafo 3D', icon: Orbit },
  { id: 'grafo2d', label: 'Grafo 2D', icon: Network },
  { id: 'revisao', label: 'Revisão', icon: ClipboardList },
  { id: 'aplicativo', label: 'Aplicativo', icon: MonitorSmartphone },
  { id: 'provedor-ia', label: 'Provedor de IA', icon: Cpu },
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id']

/** Menu lateral das Configuracoes, agrupado por afinidade para leitura rapida. */
export const SETTINGS_GROUPS = [
  { id: 'interface', label: 'Interface', sections: ['aparencia', 'workspace', 'leitura', 'atalhos'] },
  { id: 'conhecimento', label: 'Conhecimento', sections: ['grafo3d', 'grafo2d', 'revisao'] },
  { id: 'sistema', label: 'Sistema', sections: ['aplicativo', 'provedor-ia'] },
] as const

/** Navegação das Configurações: seção ativa (destaque do menu conforme o
 * painel rola), rolagem por clique e abertura pendente vinda da palette. */
export function useSettingsNav(isSettingsOpen: boolean) {
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>('aparencia')
  const settingsScrollRef = useRef<HTMLElement>(null)
  const pendingSettingsSectionRef = useRef<SettingsSectionId | null>(null)

  /** Destaque no menu lateral conforme a secao visivel no painel rolavel. */
  useEffect(() => {
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
  }, [])

  /** Rola o painel de Configuracoes ate a secao escolhida no menu lateral. */
  function scrollToSettingsSection(sectionId: SettingsSectionId) {
    setActiveSettingsSection(sectionId)
    const element = document.getElementById(`settings-${sectionId}`)
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
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
      const element = document.getElementById(`settings-${pending}`)
      if (element && typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
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
