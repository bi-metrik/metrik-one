import { describe, it, expect } from 'vitest'
import { resolverCliente, normalizar, dominioDe, type Directorio, type EmpresaDirectorio } from './cliente'

function empresa(p: Partial<EmpresaDirectorio> & { id: string; nombre: string }): EmpresaDirectorio {
  return { codigo: null, correos: [], dominios: [], negocios: [], ...p }
}

// Directorio calcado del workspace metrik real (medido 2026-08-22).
const SOENA = empresa({
  id: 'e-soena',
  nombre: 'Soena',
  codigo: 'S1',
  negocios: [
    { id: 'n1', codigo: 'S1 26 2', nombre: 'Clarity Full Parte 1 Soena', estado: 'abierto', stageActual: 'ejecucion' },
    { id: 'n2', codigo: 'S1 26 3', nombre: 'Clarity Full Fase 2', estado: 'abierto', stageActual: 'venta' },
    { id: 'n3', codigo: 'S1 26 1', nombre: 'Diagnóstico 360', estado: 'completado', stageActual: 'cerrado' },
  ],
})
const AFI = empresa({
  id: 'e-afi',
  nombre: 'AFI International Group',
  codigo: 'A1',
  negocios: [
    { id: 'n4', codigo: 'A1 26 2', nombre: 'Clarity Express AFI', estado: 'abierto', stageActual: 'ejecucion' },
  ],
})
const TRAPPVEL = empresa({
  id: 'e-trap',
  nombre: 'Trappvel',
  codigo: 'T1',
  correos: ['gerencia@trappvel.com'],
  dominios: ['trappvel.com'],
  negocios: [
    { id: 'n5', codigo: 'T1 26 1', nombre: 'Clarity Trappvel', estado: 'abierto', stageActual: 'ejecucion' },
  ],
})
const DIR: Directorio = { empresas: [SOENA, AFI, TRAPPVEL] }

describe('normalizar', () => {
  it('quita tildes, caja y forma juridica', () => {
    expect(normalizar('Guillermo García')).toBe('guillermo garcia')
    expect(normalizar('Regat SAS')).toBe('regat')
    expect(normalizar('INVERSIONES Y SOLUCIONES HJBC S.A.S.')).toBe('inversiones y soluciones hjbc')
  })

  it('no borra palabras del nombre real', () => {
    expect(normalizar('AFI International Group')).toBe('afi international group')
  })
})

describe('dominioDe', () => {
  it('devuelve el dominio corporativo', () => {
    expect(dominioDe('yessica.vasquez@afiinternationalgroup.com.co')).toBe('afiinternationalgroup.com.co')
  })

  it('descarta el correo personal: gmail no identifica una empresa', () => {
    expect(dominioDe('comercial.trappvel@gmail.com')).toBeNull()
    expect(dominioDe('Sergiomora_06@hotmail.com')).toBeNull()
  })
})

describe('resolverCliente', () => {
  it('el correo exacto gana y no hay ambiguedad de negocio', () => {
    const r = resolverCliente(['gerencia@trappvel.com'], 'Lo que sea', DIR)
    expect(r.empresa?.id).toBe('e-trap')
    expect(r.senal).toBe('correo_exacto')
    expect(r.confianza).toBe('alta')
    expect(r.negocio?.codigo).toBe('T1 26 1')
    expect(r.senalNegocio).toBe('unico_abierto')
  })

  it('resuelve por dominio corporativo cuando el correo aun no esta', () => {
    const r = resolverCliente(['contabilidad@trappvel.com'], null, DIR)
    expect(r.empresa?.id).toBe('e-trap')
    expect(r.senal).toBe('dominio_corporativo')
    expect(r.correosNuevos).toEqual(['contabilidad@trappvel.com'])
  })

  // El caso que tumbo el plan de cruzar solo por correo.
  it('un gmail sin titulo no resuelve nada, y no inventa cliente', () => {
    const r = resolverCliente(['comercial.trappvel@gmail.com'], null, DIR)
    expect(r.empresa).toBeNull()
    expect(r.senal).toBeNull()
    expect(r.confianza).toBe('ninguna')
    expect(r.correosNuevos).toEqual(['comercial.trappvel@gmail.com'])
  })

  it('el mismo gmail SI resuelve por el titulo del evento', () => {
    const r = resolverCliente(
      ['comercial.trappvel@gmail.com'],
      'Daniela Gomez - Trappvel x MéTRIK',
      DIR,
    )
    expect(r.empresa?.id).toBe('e-trap')
    expect(r.senal).toBe('titulo_evento')
    expect(r.confianza).toBe('media')
  })

  it('la contraparte corta pega con el nombre largo de la empresa', () => {
    const r = resolverCliente(
      ['yessica.vasquez@afiinternationalgroup.com.co'],
      'Revisión para entrega WS ALMA - AFI x MéTRIK',
      DIR,
    )
    expect(r.empresa?.id).toBe('e-afi')
    expect(r.senal).toBe('titulo_evento')
    expect(r.negocio?.codigo).toBe('A1 26 2')
  })

  it('con varios abiertos desempata el que esta en ejecucion', () => {
    const r = resolverCliente(
      ['daniela.jativa@gruposoena.com'],
      'Temas Marketing + Ventas - Soena x MéTRIK',
      DIR,
    )
    expect(r.empresa?.id).toBe('e-soena')
    expect(r.negocio?.codigo).toBe('S1 26 2')
    expect(r.senalNegocio).toBe('unico_en_ejecucion')
    expect(r.negociosCandidatos.map((n) => n.codigo)).toEqual(['S1 26 2', 'S1 26 3'])
  })

  it('sin ninguno en ejecucion no elige: dos en venta siguen ambiguos', () => {
    const soloVenta = empresa({
      id: 'e-v',
      nombre: 'Imperviun',
      negocios: [
        { id: 'a', codigo: 'I1 26 1', nombre: 'Fase 1', estado: 'abierto', stageActual: 'venta' },
        { id: 'b', codigo: 'I1 26 2', nombre: 'Fase 2', estado: 'abierto', stageActual: 'venta' },
      ],
    })
    const r = resolverCliente([], 'Tema - Imperviun x MéTRIK', { empresas: [soloVenta] })
    expect(r.empresa?.id).toBe('e-v')
    expect(r.negocio).toBeNull()
    expect(r.senalNegocio).toBeNull()
    expect(r.negociosCandidatos).toHaveLength(2)
  })

  it('dos en ejecucion tampoco desempatan: no se cuelga del proyecto equivocado', () => {
    const dos = empresa({
      id: 'e-d',
      nombre: 'Dimpro',
      negocios: [
        { id: 'a', codigo: 'D1 26 1', nombre: 'Skid', estado: 'abierto', stageActual: 'ejecucion' },
        { id: 'b', codigo: 'D1 26 2', nombre: 'Trailer', estado: 'abierto', stageActual: 'ejecucion' },
      ],
    })
    const r = resolverCliente([], 'Tema - Dimpro x MéTRIK', { empresas: [dos] })
    expect(r.negocio).toBeNull()
    expect(r.negociosCandidatos).toHaveLength(2)
  })

  it('el negocio completado no entra como candidato', () => {
    const r = resolverCliente([], 'X - Soena x MéTRIK', DIR)
    expect(r.negociosCandidatos.every((n) => n.estado === 'abierto')).toBe(true)
  })

  it('dos empresas que abren igual es empate, no resolucion', () => {
    const dir: Directorio = {
      empresas: [empresa({ id: 'a', nombre: 'Alfa Uno' }), empresa({ id: 'b', nombre: 'Alfa Dos' })],
    }
    expect(resolverCliente([], 'Tema - Alfa x MéTRIK', dir).empresa).toBeNull()
  })

  it('una reunion sin titulo ni pistas no resuelve', () => {
    expect(resolverCliente([], null, DIR).confianza).toBe('ninguna')
  })

  it('correosNuevos ignora los que ya estan en el directorio', () => {
    const r = resolverCliente(['gerencia@trappvel.com', 'nuevo@trappvel.com'], null, DIR)
    expect(r.correosNuevos).toEqual(['nuevo@trappvel.com'])
  })
})
