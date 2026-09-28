import { describe, expect, it } from 'vitest'
import { errorMessage } from './tauri'

describe('errorMessage', () => {
  it('preserva Error, string e objeto com message', () => {
    expect(errorMessage(new Error('quebrou'), 'fallback')).toBe('quebrou')
    expect(errorMessage('falha remota', 'fallback')).toBe('falha remota')
    expect(errorMessage({ message: 'causa aninhada' }, 'fallback')).toBe('causa aninhada')
  })

  it('usa o fallback so quando nao ha nada legivel', () => {
    expect(errorMessage(new Error('   '), 'fallback')).toBe('fallback')
    expect(errorMessage('   ', 'fallback')).toBe('fallback')
    expect(errorMessage(undefined, 'fallback')).toBe('fallback')
    expect(errorMessage(null, 'fallback')).toBe('fallback')
    expect(errorMessage(42, 'fallback')).toBe('fallback')
    expect(errorMessage({}, 'fallback')).toBe('fallback')
  })
})
