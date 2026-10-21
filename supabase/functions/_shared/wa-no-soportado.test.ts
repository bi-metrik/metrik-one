import { describe, expect, it } from 'vitest'
import { contestarNoSoportado, textoNoSoportado } from './wa-no-soportado'
import type { WaUser } from './types'

/** Un video, un sticker o una tarjeta de contacto: el bot dice que no lo lee (antes se perdían en silencio). */

const u = (modulos: WaUser['modulos']) => ({ modulos })

describe('textoNoSoportado', () => {
  it('dice qué no lee y qué sí recibe (foto o PDF del soporte)', () => {
    expect(textoNoSoportado('video')).toContain('No puedo leer videos')
    expect(textoNoSoportado('sticker')).toContain('stickers')
    expect(textoNoSoportado('video')).toContain('foto o PDF')
    expect(textoNoSoportado('contacts')).toContain('escríbeme su nombre y su celular')
    expect(textoNoSoportado(undefined)).toContain('ese tipo de mensaje')
  })
})

describe('contestarNoSoportado', () => {
  it('en un workspace de ONE sí contesta', () => {
    expect(contestarNoSoportado(u({ modules: { clarity: true } }), { phone: '573001112233' })).toBe(true)
    expect(contestarNoSoportado(u(null), { phone: '573001112233' })).toBe(true)
  })

  it('con la bandeja de solicitudes (o su agente) sigue callado, como antes', () => {
    expect(contestarNoSoportado(u({ modules: { bandeja_solicitudes_wa: true } }), { phone: '573001112233' })).toBe(false)
    expect(contestarNoSoportado(u({ bot_conversacional: { agente: true } }), { phone: '573001112233' })).toBe(false)
    expect(contestarNoSoportado(u({ bot_conversacional: { agente: true, agente_telefonos: ['570000000000'] } }), { phone: '573001112233' })).toBe(false)
    expect(contestarNoSoportado(u({ bot_conversacional: { dominio: 'bandeja' } }), { phone: '573001112233' })).toBe(false)
  })
})
