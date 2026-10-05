/**
 * El gate y la tarjeta leen las excepciones de `negocio_cruces_avanzados`:
 *
 * - un cruce avanzado con los mismos datos ya no frena el avance, pero la tarjeta lo
 *   sigue mostrando, marcado «avanzado por X»;
 * - los demás cruces siguen frenando;
 * - si el dato cambia y el cruce vuelve a fallar, vuelve a frenar;
 * - si la tabla no se puede leer, frena (el lado seguro).
 *
 * Datos inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cumpleCondicion } from './condicion-bloque'
import type { ContextoFuentes } from './fuentes-negocio'

let porSlug: Record<string, Record<string, unknown>> = {}

vi.mock('./fuentes-negocio-servidor', () => ({
  contextoFuentesDelNegocio: async (): Promise<ContextoFuentes> => ({
    porSlug,
    evaluar: async c => cumpleCondicion(c as never, { porSlug, porEtapaOrden: {} }),
    aplica: async slug => slug in porSlug,
    etiqueta: () => null,
  }),
}))

import { contradiccionesQueBloquean, datosClaveDelNegocio, hashHuella } from './datos-clave-servidor'
import { evaluarCruces, leerCruces } from './cruces'

let avances: Array<Record<string, unknown>> = []
let falla = false

const supabase = {
  from: (tabla: string) => {
    const api = {
      select: () => api,
      eq: () => (tabla === 'negocio_cruces_avanzados'
        ? Promise.resolve(falla ? { data: null, error: { message: 'no existe' } } : { data: avances, error: null })
        : Promise.resolve({ data: [], error: null })),
    }
    return api
  },
}

const CERTIFICACION = 9
const CONFIG = {
  cruces: [
    {
      slug: 'certificado_valor_vs_factura',
      tipo: 'coincide',
      mensaje: 'El certificado dice {a_valor} y la factura {b_valor}.',
      a: { source_bloque_slug: 'certificado', field: 'valor' },
      b: [{ source_bloque_slug: 'factura', field: 'valor_sin_iva' }],
      modo: 'monto',
      bloquea_en_etapas: [CERTIFICACION],
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
}
const CASO = {
  certificado: { valor: '100000000' },
  factura: { valor_sin_iva: '90000000', cantidad_compradores: '2' },
  titularidad: { modalidad: 'unico' },
}
const ARGS = { negocioId: 'neg-1', lineaId: 'lin-1', etapaActualId: 'et-9', etapaOrden: CERTIFICACION, configLinea: CONFIG }

/** La huella en hash que el servidor guarda para el cruce de valor con estos datos. */
async function huellaDeValor(datos: typeof CASO): Promise<string> {
  porSlug = datos
  const [c] = await evaluarCruces(leerCruces(CONFIG), {
    porSlug: datos,
    evaluar: async () => true,
    aplica: async s => s in datos,
    etiqueta: () => null,
  }, CERTIFICACION)
  return hashHuella(c.huella as string)
}

beforeEach(() => {
  porSlug = structuredClone(CASO)
  avances = []
  falla = false
})

describe('excepciones de cruces en el gate y en la tarjeta', () => {
  it('sin excepción frenan los dos, con la huella ya en hash', async () => {
    const r = await contradiccionesQueBloquean(supabase, ARGS)
    expect(r.map(c => c.slug)).toEqual(['certificado_valor_vs_factura', 'factura_compradores_vs_titularidad'])
    expect(r[0].huella).toMatch(/^[0-9a-f]{32}$/)
    // El hash no deja ver los datos del caso.
    expect(r[0].huella).not.toContain('100000000')
  })

  it('avanzado con esos datos: deja de frenar, el otro sigue; la tarjeta lo muestra marcado', async () => {
    avances = [{
      cruce_slug: 'certificado_valor_vs_factura',
      huella: await huellaDeValor(CASO),
      motivo: 'El proveedor confirmó el valor por escrito.',
      created_at: '2026-10-05T10:00:00Z',
      autor: { full_name: 'Persona Autorizada' },
    }]
    porSlug = structuredClone(CASO)
    const frenan = await contradiccionesQueBloquean(supabase, ARGS)
    expect(frenan.map(c => c.slug)).toEqual(['factura_compradores_vs_titularidad'])

    const vista = await datosClaveDelNegocio(supabase, ARGS)
    const valor = vista?.contradicciones.find(c => c.slug === 'certificado_valor_vs_factura')
    expect(valor?.avanzado).toEqual({
      autor: 'Persona Autorizada',
      motivo: 'El proveedor confirmó el valor por escrito.',
      fecha: '2026-10-05T10:00:00Z',
    })
    expect(valor?.bloquea).toBe(true)
  })

  it('cambia el dato y el cruce vuelve a fallar: vuelve a frenar', async () => {
    avances = [{
      cruce_slug: 'certificado_valor_vs_factura',
      huella: await huellaDeValor(CASO),
      motivo: 'El proveedor confirmó el valor por escrito.',
      created_at: '2026-10-05T10:00:00Z',
      autor: null,
    }]
    porSlug = { ...structuredClone(CASO), certificado: { valor: '120000000' } }
    const frenan = await contradiccionesQueBloquean(supabase, ARGS)
    expect(frenan.map(c => c.slug)).toContain('certificado_valor_vs_factura')
  })

  it('si la tabla no se puede leer, frena', async () => {
    falla = true
    avances = [{ cruce_slug: 'certificado_valor_vs_factura', huella: await huellaDeValor(CASO), motivo: 'x', created_at: 'x', autor: null }]
    porSlug = structuredClone(CASO)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const frenan = await contradiccionesQueBloquean(supabase, ARGS)
    spy.mockRestore()
    expect(frenan.map(c => c.slug)).toContain('certificado_valor_vs_factura')
  })
})
