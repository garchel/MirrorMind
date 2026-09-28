import { describe, expect, it } from 'vitest'
import { isAutoUpdateEnabled, setAutoUpdateEnabled } from './useAppUpdater'

describe('auto-update preference', () => {
  it('ligado por padrao, persiste e volta ao padrao ao limpar', () => {
    localStorage.clear()
    expect(isAutoUpdateEnabled()).toBe(true)
    setAutoUpdateEnabled(false)
    expect(isAutoUpdateEnabled()).toBe(false)
    expect(localStorage.getItem('mirrormind.auto-update')).toBe('false')
    setAutoUpdateEnabled(true)
    expect(isAutoUpdateEnabled()).toBe(true)
    localStorage.clear()
  })

  it('valor corrompido conta como habilitado (contrato do prefs)', () => {
    localStorage.setItem('mirrormind.auto-update', 'talvez')
    expect(isAutoUpdateEnabled()).toBe(true)
    localStorage.clear()
  })
})
