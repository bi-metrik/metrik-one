import { describe, it, expect } from 'vitest'
import {
  proponerRetrocesoFinanciero,
  validarRetroceso,
  construirAviso,
  type EtapaCandidata,
} from './retroceso-financiero'

// La topología real de SOENA VE, recortada. El `orden` NO es contiguo a propósito:
// así es en producción tras fusionar etapas.
const NEGOCIACION: EtapaCandidata = { id: 'e-neg', nombre: 'Negociación', orden: 5, numero: 5, stage: 'venta', esNegociacion: true }
const PRECOBRO: EtapaCandidata = { id: 'e-pre', nombre: 'Precobro', orden: 8, numero: 7, stage: 'cobro', esPrecobro: true }
const DOCUMENTACION: EtapaCandidata = { id: 'e-doc', nombre: 'Documentación', orden: 11, numero: 9, stage: 'ejecucion' }
const CITA: EtapaCandidata = { id: 'e-cita', nombre: 'Cita', orden: 16, numero: 14, stage: 'ejecucion' }

const RECORRIDAS = [NEGOCIACION, PRECOBRO, DOCUMENTACION]
const MOTIVO = 'La referencia se había repartido mal entre dos negocios'

describe('proponerRetrocesoFinanciero — los tres destinos', () => {
  it('un reparto mal contabilizado NO mueve el caso', () => {
    const p = proponerRetrocesoFinanciero({
      causa: 'reparto_mal_contabilizado',
      etapaActual: CITA,
      etapasRecorridas: RECORRIDAS,
    })

    expect(p.destinoEtapaId).toBeNull()
    expect(p.explicacion).toMatch(/se queda donde está/)
    // Aun sin mover, ofrece las alternativas: la financiera puede decidir otra cosa.
    expect(p.alternativas.map(e => e.id)).toEqual(['e-doc', 'e-pre', 'e-neg'])
  })

  it('si falta plata, vuelve a Precobro', () => {
    const p = proponerRetrocesoFinanciero({
      causa: 'falta_plata',
      etapaActual: CITA,
      etapasRecorridas: RECORRIDAS,
    })

    expect(p.destinoEtapaId).toBe('e-pre')
    expect(p.destinoNombre).toBe('Precobro')
  })

  it('si las condiciones estaban mal pactadas, vuelve a Negociación', () => {
    const p = proponerRetrocesoFinanciero({
      causa: 'condiciones_mal_pactadas',
      etapaActual: CITA,
      etapasRecorridas: RECORRIDAS,
    })

    expect(p.destinoEtapaId).toBe('e-neg')
    expect(p.destinoNombre).toBe('Negociación')
  })

  it('todo retroceso lleva la marca financiera', () => {
    for (const causa of ['reparto_mal_contabilizado', 'falta_plata', 'condiciones_mal_pactadas'] as const) {
      const p = proponerRetrocesoFinanciero({ causa, etapaActual: CITA, etapasRecorridas: RECORRIDAS })
      expect(p.marcaFinanciera).toBe(true)
    }
  })
})

describe('proponerRetrocesoFinanciero — solo etapas REALMENTE recorridas', () => {
  it('no propone una etapa por la que el caso nunca pasó', () => {
    // El caso saltó Precobro (saldo cubierto). Proponerlo lo mandaría a pedir plata
    // que ya entró.
    const p = proponerRetrocesoFinanciero({
      causa: 'falta_plata',
      etapaActual: CITA,
      etapasRecorridas: [NEGOCIACION, DOCUMENTACION],
    })

    expect(p.alternativas.map(e => e.id)).not.toContain('e-pre')
    expect(p.destinoEtapaId).not.toBe('e-pre')
  })

  it('nunca ofrece la etapa en la que el caso ya está', () => {
    const p = proponerRetrocesoFinanciero({
      causa: 'falta_plata',
      etapaActual: PRECOBRO,
      etapasRecorridas: [...RECORRIDAS, CITA],
    })

    expect(p.alternativas.map(e => e.id)).not.toContain('e-pre')
    // Tampoco las que van DESPUÉS: volver hacia adelante no es volver.
    expect(p.alternativas.map(e => e.id)).not.toContain('e-cita')
  })

  it('sin la etapa marcada en la línea, propone la anterior Y LO DICE', () => {
    const sinMarcas = [
      { ...NEGOCIACION, esNegociacion: false },
      { ...DOCUMENTACION },
    ]
    const p = proponerRetrocesoFinanciero({
      causa: 'condiciones_mal_pactadas',
      etapaActual: CITA,
      etapasRecorridas: sinMarcas,
    })

    expect(p.destinoEtapaId).toBe('e-doc')
    expect(p.explicacion).toMatch(/no declara cuál es su etapa/)
    expect(p.explicacion).toMatch(/revísalo antes de aplicar/)
  })

  it('un caso en la primera etapa no tiene a dónde volver', () => {
    const p = proponerRetrocesoFinanciero({
      causa: 'falta_plata',
      etapaActual: NEGOCIACION,
      etapasRecorridas: [NEGOCIACION],
    })

    expect(p.destinoEtapaId).toBeNull()
    expect(p.alternativas).toEqual([])
  })
})

describe('validarRetroceso', () => {
  it('exige motivo escrito', () => {
    const v = validarRetroceso({
      destinoEtapaId: 'e-pre',
      motivo: 'ajuste',
      etapasRecorridas: RECORRIDAS,
      etapaActual: CITA,
    })

    expect(v.ok).toBe(false)
    expect(v.errores.join(' ')).toMatch(/por qué retrocede/)
  })

  it('rechaza una etapa que el caso nunca recorrió', () => {
    const v = validarRetroceso({
      destinoEtapaId: 'e-pre',
      motivo: MOTIVO,
      etapasRecorridas: [NEGOCIACION, DOCUMENTACION],
      etapaActual: CITA,
    })

    expect(v.ok).toBe(false)
    expect(v.errores.join(' ')).toMatch(/nunca pasó por esa etapa/)
  })

  it('rechaza "retroceder" hacia adelante', () => {
    const v = validarRetroceso({
      destinoEtapaId: 'e-cita',
      motivo: MOTIVO,
      etapasRecorridas: [...RECORRIDAS, CITA],
      etapaActual: PRECOBRO,
    })

    expect(v.ok).toBe(false)
    expect(v.errores.join(' ')).toMatch(/va después de la actual/)
  })

  it('rechaza la etapa en la que ya está', () => {
    const v = validarRetroceso({
      destinoEtapaId: 'e-cita',
      motivo: MOTIVO,
      etapasRecorridas: RECORRIDAS,
      etapaActual: CITA,
    })

    expect(v.ok).toBe(false)
    expect(v.errores.join(' ')).toMatch(/ya está en esa etapa/)
  })

  it('acepta el caso de no mover, siempre que haya motivo', () => {
    const v = validarRetroceso({
      destinoEtapaId: null,
      motivo: MOTIVO,
      etapasRecorridas: RECORRIDAS,
      etapaActual: CITA,
    })

    expect(v.ok).toBe(true)
  })

  it('acepta un retroceso legítimo', () => {
    const v = validarRetroceso({
      destinoEtapaId: 'e-pre',
      motivo: MOTIVO,
      etapasRecorridas: RECORRIDAS,
      etapaActual: CITA,
    })

    expect(v.ok).toBe(true)
    expect(v.errores).toEqual([])
  })
})

describe('construirAviso', () => {
  it('conserva la referencia y el motivo para que el aviso se explique solo', () => {
    const aviso = construirAviso({
      referencia: '375720883',
      motivo: `  ${MOTIVO}  `,
      etapaAlCambiar: 'Cita',
      gatesReabiertos: 2,
      destinoSugerido: 'Precobro',
      ahora: '2026-08-11T10:00:00Z',
      staffId: 'staff-diana',
    })

    expect(aviso.tipo).toBe('recaudo_cambiado')
    expect(aviso.motivo).toBe(MOTIVO)
    expect(aviso.referencia).toBe('375720883')
    expect(aviso.gatesReabiertos).toBe(2)
  })
})
