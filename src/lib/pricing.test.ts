import { describe, expect, it } from 'vitest'
import { buildPricingCards, currentPlanLabel } from './pricing'

describe('catálogo de planos', () => {
  it('convidado: os planos de nuvem pedem para entrar antes de comprar', () => {
    const cartoes = buildPricingCards({ signedIn: false, cloudActive: false })
    const nuvem = cartoes.filter((cartao) => cartao.id.startsWith('nuvem_'))

    expect(nuvem).toHaveLength(2)
    for (const cartao of nuvem) {
      expect(cartao.cta.kind).toBe('signin')
    }
  })

  it('com conta e sem add-on: os dois períodos ficam compráveis', () => {
    const cartoes = buildPricingCards({ signedIn: true, cloudActive: false })
    const mensal = cartoes.find((cartao) => cartao.id === 'nuvem_mensal')
    const anual = cartoes.find((cartao) => cartao.id === 'nuvem_anual')

    expect(mensal?.cta).toEqual({ kind: 'buy', label: 'Comprar agora', cloud: 'cloud_month' })
    expect(anual?.cta).toEqual({ kind: 'buy', label: 'Comprar agora', cloud: 'cloud_year' })
  })

  it('com add-on ativo: ninguém oferece comprar de novo', () => {
    const cartoes = buildPricingCards({ signedIn: true, cloudActive: true })
    for (const cartao of cartoes.filter((item) => item.id.startsWith('nuvem_'))) {
      expect(cartao.cta.kind).toBe('active')
    }
  })

  it('o plano grátis é sempre o atual e nunca é vendido', () => {
    const cartoes = buildPricingCards({ signedIn: true, cloudActive: true })
    expect(cartoes.find((cartao) => cartao.id === 'gratis')?.cta.kind).toBe('current')
  })

  it('IA gerenciada aparece sem preço inventado', () => {
    const cartoes = buildPricingCards({ signedIn: true, cloudActive: false })
    const ia = cartoes.find((cartao) => cartao.id === 'ia')

    expect(ia?.cta.kind).toBe('soon')
    // preço não definido: travessão, nunca um número que ninguém decidiu
    expect(ia?.price).toBe('—')
    expect(ia?.priceNote).toContain('definição')
  })

  it('o anual é o destaque e mostra quanto economiza', () => {
    const cartoes = buildPricingCards({ signedIn: true, cloudActive: false })
    const anual = cartoes.find((cartao) => cartao.id === 'nuvem_anual')

    expect(anual?.highlight).toBe(true)
    expect(anual?.badge).toBe('Recomendado')
    expect(anual?.priceNote).toContain('R$ 25')
  })

  it('os preços do add-on são os da decisão de produto', () => {
    const cartoes = buildPricingCards({ signedIn: true, cloudActive: false })
    expect(cartoes.find((cartao) => cartao.id === 'nuvem_mensal')?.price).toBe('R$ 30')
    expect(cartoes.find((cartao) => cartao.id === 'nuvem_anual')?.price).toBe('R$ 300')
  })

  it('o rótulo do plano atual acompanha o add-on', () => {
    expect(currentPlanLabel({ cloudActive: false })).toBe('Grátis')
    expect(currentPlanLabel({ cloudActive: true })).toBe('Grátis + Nuvem')
  })
})
