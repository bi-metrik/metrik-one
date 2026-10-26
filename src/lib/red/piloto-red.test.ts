import { describe, expect, it } from 'vitest'
import { esPilotoRed, normalizarNombre, personaMedida } from './piloto'
import { rutaNormalizada } from './eventos'
import { leerLoteRed } from './eventos-servidor'
import { asnDeRespuesta, consultaDeOrigen, marcaDeOperador, nombreDeRespuesta } from './operador'

describe('alcance del piloto', () => {
  it('solo soena', () => {
    expect(esPilotoRed('soena')).toBe(true)
    expect(esPilotoRed('trappvel')).toBe(false)
    expect(esPilotoRed(null)).toBe(false)
  })

  it('identifica solo a las personas de la lista, por nombre normalizado', () => {
    expect(normalizarNombre('  María Camila  GARZÓN David ')).toBe('maria camila garzon david')
    expect(personaMedida('soena', 'María Camila Garzón David')).toBe('maria camila garzon david')
    expect(personaMedida('soena', 'Jessica Tejada')).toBe('jessica tejada')
    expect(personaMedida('soena', 'Jenny Tatiana Cepeda Aldana')).toBe('jenny tatiana cepeda aldana')
    // Fuera de la lista (Deisy no la nombró Mauricio) y fuera del workspace: sin persona.
    expect(personaMedida('soena', 'Deisy Ramirez')).toBeNull()
    expect(personaMedida('trappvel', 'Jessica Tejada')).toBeNull()
    expect(personaMedida('soena', null)).toBeNull()
  })

  it('la ruta va sin ids ni query', () => {
    expect(rutaNormalizada('/negocios/84630bca-1111-4222-8333-444455556666?x=1')).toBe('/negocios/[id]')
  })
})

describe('lote de eventos', () => {
  const pulso = {
    tipo: 'pulso',
    id: 'a-1',
    t0: 1_790_000_000_000,
    t1: 1_790_000_300_000,
    visible_ms: 300_000,
    vercel: { n: 20, perdidas: 1, p50: 80 },
    control: { n: 20, perdidas: 0 },
    offline_ms: 0,
    sw: false,
  }

  it('acepta lo bueno y descarta solo lo malo', () => {
    const r = leerLoteRed(JSON.stringify({ eventos: [pulso, { tipo: 'falla', id: 'x' }, { tipo: 'otro' }] }))
    expect(r).toMatchObject({ ok: true, descartados: 2 })
    if (r.ok) expect(r.eventos).toHaveLength(1)
  })

  it('una falla con superficie válida pasa, recortada', () => {
    const r = leerLoteRed(
      JSON.stringify({ eventos: [{ tipo: 'falla', id: 'f-1', t: 1_790_000_000_000, superficie: 'subida', error: 'x'.repeat(900) }] }),
    )
    expect(r.ok && r.eventos[0].tipo === 'falla' && r.eventos[0].error?.length).toBe(300)
  })

  it('rechaza cuerpo roto o enorme', () => {
    expect(leerLoteRed('{')).toEqual({ ok: false, status: 400 })
    expect(leerLoteRed(JSON.stringify({ nada: 1 }))).toEqual({ ok: false, status: 400 })
    expect(leerLoteRed('x'.repeat(60 * 1024))).toEqual({ ok: false, status: 413 })
  })
})

describe('operador por DNS (Team Cymru)', () => {
  it('arma la consulta por prefijo, no guarda la IP', () => {
    expect(consultaDeOrigen('186.81.102.19')).toEqual({ nombre: '19.102.81.186.origin.asn.cymru.com', clave: '186.81.102' })
    expect(consultaDeOrigen('2800:e2:4a80::1')?.nombre.endsWith('.origin6.asn.cymru.com')).toBe(true)
    expect(consultaDeOrigen('no-es-ip')).toBeNull()
  })

  it('lee el ASN y el nombre con el formato real (medido 2026-10-06)', () => {
    expect(asnDeRespuesta('14080 | 186.81.102.0/23 | CO | lacnic | 2008-10-28')).toBe(14080)
    expect(nombreDeRespuesta('14080 | CO | lacnic | 1999-10-15 | AS14080 - Telmex Colombia S.A., CO')).toBe('Telmex Colombia S.A., CO')
  })

  it('marca comercial', () => {
    expect(marcaDeOperador('Telmex Colombia S.A., CO')).toBe('Claro')
    expect(marcaDeOperador('COLOMBIA TELECOMUNICACIONES S.A. ESP BIC, CO')).toBe('Movistar')
    expect(marcaDeOperador('UNE EPM TELECOMUNICACIONES S.A., CO')).toBe('Tigo-UNE')
    expect(marcaDeOperador('Otro Operador SAS, CO')).toBe('Otro Operador SAS')
  })
})
