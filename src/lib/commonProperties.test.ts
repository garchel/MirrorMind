import { describe, expect, it } from 'vitest'
import { COMMON_PROPERTIES, COMMON_PROPERTY_KEYS, propertyIcon } from './commonProperties'
import { Hash } from 'lucide-react'

describe('commonProperties', () => {
  it('lista canonica sem chaves duplicadas', () => {
    const keys = COMMON_PROPERTIES.map((property) => property.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(COMMON_PROPERTY_KEYS).toEqual(keys)
  })

  it('resolve icone case-insensitive com fallback generico', () => {
    expect(propertyIcon('phone')).toBe(COMMON_PROPERTIES[0].icon)
    expect(propertyIcon('  EMAIL ')).toBe(COMMON_PROPERTIES[1].icon)
    expect(propertyIcon('qualquer-coisa-custom')).toBe(Hash)
    expect(propertyIcon('')).toBe(Hash)
  })
})
