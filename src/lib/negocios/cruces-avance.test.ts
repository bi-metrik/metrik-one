/**
 * Avanzar un cruce con motivo: quién puede, qué motivo sirve, y que la excepción valga
 * solo para ESOS datos. Si el dato cambia y el cruce vuelve a fallar, vuelve a frenar.
 *
 * Datos inventados (sin clientes de verdad).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cumpleCondicion } from './condicion-bloque'
import { evaluarCruces, leerCruces, type Cruce } from './cruces'
import {
  MOTIVO_AVANCE_MAX,
  advertenciasDeCruces,
  aplicarAvances,
  crucesQueSeAvanzan,
  esAvanzable,
  puedeAvanzarCruces,
  staffIdsQueAvanzanCruces,
  validarMotivoAvance,
  type AvanceCruce,
} from './cruces-avance'
import type { ContextoFuentes } from './fuentes-negocio'

function ctx(porSlug: Record<string, Record<string, unknown>>): ContextoFuentes {
  return {
    porSlug,
    evaluar: async c => cumpleCondicion(c as never, { porSlug, porEtapaOrden: {} }),
    aplica: async slug => slug in porSlug,
    etiqueta: () => null,
  }
}

const CERTIFICACION = 9

// Un cruce de valor con la forma del de SOENA (certificado contra factura).
const CRUCES: Cruce[] = leerCruces({
  cruces: [
    {
      slug: 'certificado_valor_vs_factura',
      tipo: 'coincide',
      mensaje: 'El certificado dice {a_valor} y la factura {b_valor}.',
      a: { source_bloque_slug: 'certificado', field: 'valor' },
      b: [{ source_bloque_slug: 'factura', field: 'valor_sin_iva' }],
      modo: 'monto',
      bloquea_en_etapas: [CERTIFICACION],
      advertencia: '  Avanzar así cuesta otra radicación.  ',
    },
    {
      slug: 'factura_compradores_vs_titularidad',
      tipo: 'cantidad',
      mensaje: 'La factura trae {a} y la titularidad dice {b_valor}.',
      a: { source_bloque_slug: 'factura', field: 'cantidad_compradores' },
      b: { source_bloque_slug: 'titularidad', field: 'modalidad', mapeo: { unico: 1, copropiedad: 2 } },
      bloquea_en_etapas: [CERTIFICACION],
    },
  ],
})

const CASO = {
  certificado: { valor: '100000000' },
  factura: { valor_sin_iva: '90000000', cantidad_compradores: '2' },
  titularidad: { modalidad: 'unico' },
}

describe('quién puede avanzar cruces', () => {
  it('solo la lista `avanzar_cruces.staff_ids`; ausente o mal formada = nadie', () => {
    const cfg = { avanzar_cruces: { staff_ids: ['s-1', '', 7, 's-2'] } }
    expect(staffIdsQueAvanzanCruces(cfg)).toEqual(['s-1', 's-2'])
    expect(puedeAvanzarCruces('s-1', cfg)).toBe(true)
    expect(puedeAvanzarCruces('s-3', cfg)).toBe(false)
    expect(puedeAvanzarCruces(null, cfg)).toBe(false)
    expect(puedeAvanzarCruces('s-1', null)).toBe(false)
    expect(puedeAvanzarCruces('s-1', {})).toBe(false)
    expect(puedeAvanzarCruces('s-1', { avanzar_cruces: { staff_ids: 's-1' } })).toBe(false)
    // La lista de omitir gates es OTRO permiso: no abre este.
    expect(puedeAvanzarCruces('s-1', { omitir_gate: { staff_ids: ['s-1'] } })).toBe(false)
  })
})

describe('el motivo', () => {
  it('es obligatorio, al menos una frase y cabe en el historial', () => {
    expect(validarMotivoAvance('')).toMatch(/motivo/)
    expect(validarMotivoAvance('   ok   ')).toMatch(/mínimo/)
    expect(validarMotivoAvance(undefined)).toMatch(/motivo/)
    expect(validarMotivoAvance('El cliente confirmó que la factura es la correcta.')).toBeNull()
    expect(validarMotivoAvance('x'.repeat(MOTIVO_AVANCE_MAX + 1))).toMatch(/280/)
  })
})

describe('la huella: la excepción vale para esos datos', () => {
  it('cada cruce que falla trae su huella y su texto de costo', async () => {
    const r = await evaluarCruces(CRUCES, ctx(CASO), CERTIFICACION)
    expect(r.map(c => c.slug)).toEqual(['certificado_valor_vs_factura', 'factura_compradores_vs_titularidad'])
    expect(r.every(esAvanzable)).toBe(true)
    expect(r[0].advertencia).toBe('Avanzar así cuesta otra radicación.')
    expect(r[1].advertencia).toBeUndefined()
  })

  it('los mismos datos dan la misma huella; otro dato que también falla da otra', async () => {
    const [a1] = await evaluarCruces(CRUCES, ctx(CASO), CERTIFICACION)
    const [a2] = await evaluarCruces(CRUCES, ctx(structuredClone(CASO)), CERTIFICACION)
    expect(a2.huella).toBe(a1.huella)
    const [b] = await evaluarCruces(CRUCES, ctx({ ...CASO, factura: { ...CASO.factura, valor_sin_iva: '95000000' } }), CERTIFICACION)
    expect(b.slug).toBe('certificado_valor_vs_factura')
    expect(b.huella).not.toBe(a1.huella)
  })

  it('avanzado con esos datos: no frena y sigue a la vista; cambia el dato y vuelve a frenar', async () => {
    const [antes] = await evaluarCruces(CRUCES, ctx(CASO), CERTIFICACION)
    const avances: AvanceCruce[] = [{
      cruce_slug: antes.slug,
      huella: antes.huella as string,
      motivo: 'El valor lo confirmó el proveedor por escrito.',
      autor: 'Persona Autorizada',
      created_at: '2026-10-05T10:00:00Z',
    }]

    const hoy = aplicarAvances(await evaluarCruces(CRUCES, ctx(CASO), CERTIFICACION), avances)
    expect(hoy[0].avanzado).toEqual({
      autor: 'Persona Autorizada',
      motivo: 'El valor lo confirmó el proveedor por escrito.',
      fecha: '2026-10-05T10:00:00Z',
    })
    // Las demás reglas siguen frenando.
    expect(hoy[1].avanzado).toBeUndefined()
    expect(hoy.filter(c => c.bloquea && !c.avanzado).map(c => c.slug)).toEqual(['factura_compradores_vs_titularidad'])

    const otroDato = { ...CASO, certificado: { valor: '110000000' } }
    const despues = aplicarAvances(await evaluarCruces(CRUCES, ctx(otroDato), CERTIFICACION), avances)
    expect(despues[0].slug).toBe('certificado_valor_vs_factura')
    expect(despues[0].avanzado).toBeUndefined()
    expect(despues[0].bloquea).toBe(true)
  })

  it('una excepción de OTRO cruce con la misma huella no cuenta', async () => {
    const [c] = await evaluarCruces(CRUCES, ctx(CASO), CERTIFICACION)
    const r = aplicarAvances([c], [{ cruce_slug: 'otro', huella: c.huella as string, motivo: 'm', autor: null, created_at: 'x' }])
    expect(r[0].avanzado).toBeUndefined()
  })

  it('con varias excepciones vigentes muestra la más reciente', async () => {
    const [c] = await evaluarCruces(CRUCES, ctx(CASO), CERTIFICACION)
    const base = { cruce_slug: c.slug, huella: c.huella as string, autor: null }
    const r = aplicarAvances([c], [
      { ...base, motivo: 'vieja', created_at: '2026-10-01T00:00:00Z' },
      { ...base, motivo: 'nueva', created_at: '2026-10-04T00:00:00Z' },
    ])
    expect(r[0].avanzado?.motivo).toBe('nueva')
  })

  it('un voto en disputa (sin huella) no se avanza por aquí', () => {
    const voto = { slug: 'voto:documento', mensaje: 'Las lecturas no coinciden', bloquea: true }
    expect(esAvanzable(voto)).toBe(false)
    expect(aplicarAvances([voto], [{ cruce_slug: 'voto:documento', huella: '', motivo: 'm', autor: null, created_at: 'x' }])[0].avanzado)
      .toBeUndefined()
  })
})

describe('el modal', () => {
  const cruce = (slug: string, advertencia?: string) => ({ nombre: slug, es_gate: true, tipo: 'cruce', cruce_slug: slug, advertencia })

  it('ofrece avanzar solo si TODO lo que frena son cruces', () => {
    expect(crucesQueSeAvanzan([cruce('a'), cruce('b'), cruce('a')])).toEqual(['a', 'b'])
    expect(crucesQueSeAvanzan([cruce('a'), { nombre: 'Falta el RUT', es_gate: true }])).toEqual([])
    expect(crucesQueSeAvanzan([])).toEqual([])
  })

  it('el texto de costo se muestra una vez aunque varios cruces lo declaren', () => {
    expect(advertenciasDeCruces([cruce('a', 'Cuesta X'), cruce('b', 'Cuesta X '), cruce('c')])).toEqual(['Cuesta X'])
  })
})

describe('configuración de SOENA (migración 20261005120100)', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20261005120100_soena_avanzar_cruces_con_motivo.sql'),
    'utf8',
  )

  it('el texto de costo de antes de radicar es el que pidió Mauricio', () => {
    expect(sql).toContain(
      "'Si radicas así, la UPME puede emitir el certificado incompleto y habría que pagar la tarifa otra vez'",
    )
  })

  it('declara exactamente los 4 cruces de antes de radicar', () => {
    const bloque = sql.match(/antes_de_radicar constant text\[\] := array\[([\s\S]*?)\];/)
    expect(bloque).not.toBeNull()
    const slugs = [...(bloque as RegExpMatchArray)[1].matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1])
    expect(slugs.sort()).toEqual([
      'factura_compradores_vs_titularidad',
      'rut2_entre_compradores',
      'rut_entre_compradores',
      'titular_2_completo_antes_de_radicar',
    ])
  })
})
