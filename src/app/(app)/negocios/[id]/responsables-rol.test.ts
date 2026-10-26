import { describe, expect, it } from 'vitest'
import { etiquetaRol, lineaAsignador, ordenarResponsables, textoResponsable, type QuienAsigno } from './responsables-rol'

describe('etiquetaRol', () => {
  it('nombra las dos áreas', () => {
    expect(etiquetaRol('comercial')).toBe('Comercial')
    expect(etiquetaRol('operaciones')).toBe('Operaciones')
  })
  it('sin rol o rol desconocido no inventa etiqueta', () => {
    expect(etiquetaRol(null)).toBeNull()
    expect(etiquetaRol(undefined)).toBeNull()
    expect(etiquetaRol('financiero')).toBeNull()
  })
})

describe('textoResponsable', () => {
  it('antepone el área al nombre completo, sin truncar', () => {
    expect(textoResponsable({ id: 'a', full_name: 'Tatiana Cortés Ramírez', rol: 'comercial' }))
      .toBe('Comercial · Tatiana Cortés Ramírez')
  })
  it('sin rol queda solo el nombre', () => {
    expect(textoResponsable({ id: 'a', full_name: 'Ana Pérez', rol: null })).toBe('Ana Pérez')
  })
})

describe('ordenarResponsables', () => {
  it('comercial, operaciones, sin rol; estable dentro del grupo', () => {
    const lista = [
      { id: 'n1', full_name: 'N1', rol: null },
      { id: 'o1', full_name: 'O1', rol: 'operaciones' },
      { id: 'n2', full_name: 'N2' },
      { id: 'c1', full_name: 'C1', rol: 'comercial' },
    ]
    expect(ordenarResponsables(lista).map((r) => r.id)).toEqual(['c1', 'o1', 'n1', 'n2'])
    expect(lista[0].id).toBe('n1')
  })
})

describe('lineaAsignador (quién asignó, bajo el nombre)', () => {
  // 23 oct en Bogotá (15:00 UTC = 10:00 Bogotá).
  const base: QuienAsigno = { assigned_at: '2026-10-23T15:00:00Z', origen: null, asignadoPor: null, seAsigno: false, etapa: null }

  it('persona: «Asignó Edgar Alba · 23 oct»', () => {
    expect(lineaAsignador({ ...base, origen: 'persona', asignadoPor: 'Edgar Alba' })).toEqual({ texto: 'Asignó Edgar Alba · 23 oct' })
  })

  it('filas viejas sin origen pero con quien asignó: también persona', () => {
    expect(lineaAsignador({ ...base, asignadoPor: 'Tatiana Ríos' })?.texto).toBe('Asignó Tatiana Ríos · 23 oct')
  })

  it('el mismo responsable: «Se asignó · 23 oct»', () => {
    expect(lineaAsignador({ ...base, origen: 'persona', asignadoPor: 'Edgar Alba', seAsigno: true })?.texto).toBe('Se asignó · 23 oct')
  })

  it('bot: texto corto y el title completo', () => {
    expect(lineaAsignador({ ...base, origen: 'bot_whatsapp' })).toEqual({
      texto: 'Asignado por el bot de WhatsApp · 23 oct',
      title: 'Asignado automáticamente por el bot de WhatsApp el 23 oct',
    })
  })

  it('regla por etapa: con la etapa, o «Automático por etapa» si no se sabe', () => {
    expect(lineaAsignador({ ...base, origen: 'regla_etapa', etapa: 'Cotización' })?.texto).toBe('Automático al entrar a Cotización · 23 oct')
    expect(lineaAsignador({ ...base, origen: 'regla_etapa', etapa: null })?.texto).toBe('Automático por etapa · 23 oct')
  })

  it('sin origen ni quién asignó, sin datos, o persona que no se resuelve: no se pinta', () => {
    expect(lineaAsignador(base)).toBeNull()
    expect(lineaAsignador(undefined)).toBeNull()
    expect(lineaAsignador({ ...base, origen: 'persona', asignadoPor: null })).toBeNull()
  })

  it('sin fecha, sin el « · »', () => {
    expect(lineaAsignador({ ...base, assigned_at: null, origen: 'bot_whatsapp' })).toEqual({
      texto: 'Asignado por el bot de WhatsApp', title: 'Asignado automáticamente por el bot de WhatsApp',
    })
  })
})
