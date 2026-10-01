/**
 * El cruce `requeridos` y el freno de SOENA que lo usa: en copropiedad no se sale de
 * Documentación (6) ni de Cargue (7, donde se radica ante la UPME) sin el segundo titular
 * completo. La configuración se lee de la MIGRACIÓN, no de una copia.
 *
 * Datos inventados con la forma de los reales (sin clientes de verdad).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cumpleCondicion } from './condicion-bloque'
import { evaluarCruces, leerCruces, slugsDeCruces } from './cruces'
import type { ContextoFuentes } from './fuentes-negocio'

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261001100000_soena_freno_titular_2_antes_de_radicar.sql'),
  'utf8',
)
const m = SQL.match(/\$cruce_titular_2\$([\s\S]*?)\$cruce_titular_2\$/)
if (!m) throw new Error('la migración no trae el bloque $cruce_titular_2$')
const CRUCES = leerCruces({ cruces: [JSON.parse(m[1])] })

// `condition` de cada bloque en producción (bloque_configs.config_extra.condition).
const CONDICION_BLOQUE: Record<string, Record<string, unknown> | null> = {
  tipo_de_solicitante: null,
  titularidad: { field: 'tipo_persona', value: 'natural', source_bloque_slug: 'tipo_de_solicitante' },
  rut: { field: 'tipo_persona', value: 'natural', source_bloque_slug: 'tipo_de_solicitante' },
  rut_solicitante_2: { field: 'modalidad_solicitante', value: 'copropiedad', source_bloque_slug: 'titularidad' },
}

function ctx(porSlug: Record<string, Record<string, unknown>>): ContextoFuentes {
  const evaluar = async (c: Record<string, unknown>) => cumpleCondicion(c as never, { porSlug, porEtapaOrden: {} })
  return {
    porSlug,
    evaluar,
    aplica: async slug => {
      if (!(slug in CONDICION_BLOQUE)) return false
      const c = CONDICION_BLOQUE[slug]
      return c ? evaluar(c) : true
    },
    etiqueta: () => null,
  }
}

const DOCUMENTACION = 6
const CARGUE = 7
const PAGO_UPME = 8
const CERTIFICACION = 9

const BASE = {
  tipo_de_solicitante: { tipo_persona: 'natural' },
  rut: { razon_social: 'PEREZ GOMEZ ANA MARIA', numero_identificacion: '52000111' },
}
// Como V0286: copropiedad con el RUT del segundo titular completo.
const COPROPIEDAD_COMPLETA = {
  ...BASE,
  titularidad: { modalidad_solicitante: 'copropiedad' },
  rut_solicitante_2: { razon_social: 'RUIZ LOPEZ CARLOS ANDRES', numero_identificacion: '79000222', nit: '79000222' },
}
// Como los 20 casos migrados: copropiedad y el bloque del RUT 2 sin una sola fila.
const COPROPIEDAD_SIN_RUT2 = { ...BASE, titularidad: { modalidad_solicitante: 'copropiedad' } }

describe('freno de titulares antes de radicar (SOENA)', () => {
  it('la migración declara un cruce `requeridos` válido que frena en Documentación y Cargue', () => {
    expect(CRUCES).toHaveLength(1)
    expect(CRUCES[0].tipo).toBe('requeridos')
    expect(CRUCES[0].bloquea_en_etapas).toEqual([DOCUMENTACION, CARGUE])
    expect(slugsDeCruces(CRUCES)).toContain('rut_solicitante_2')
  })

  it('copropiedad con los dos titulares completos: no frena', async () => {
    for (const etapa of [DOCUMENTACION, CARGUE]) {
      expect(await evaluarCruces(CRUCES, ctx(COPROPIEDAD_COMPLETA), etapa)).toEqual([])
    }
  })

  it('copropiedad sin segundo titular: frena en 6 y 7 diciendo qué falta', async () => {
    for (const etapa of [DOCUMENTACION, CARGUE]) {
      const [c, ...resto] = await evaluarCruces(CRUCES, ctx(COPROPIEDAD_SIN_RUT2), etapa)
      expect(resto).toEqual([])
      expect(c.bloquea).toBe(true)
      expect(c.mensaje).toContain('La titularidad es copropiedad y falta el nombre del segundo titular')
      expect(c.mensaje).toContain(' y el número de documento del segundo titular')
      expect(c.mensaje).not.toContain('{faltantes}')
    }
  })

  it('un bloque del RUT 2 vacío (fila creada, nada leído) cuenta como faltante', async () => {
    const r = await evaluarCruces(CRUCES, ctx({ ...COPROPIEDAD_SIN_RUT2, rut_solicitante_2: {} }), CARGUE)
    expect(r).toHaveLength(1)
    expect(r[0].bloquea).toBe(true)
  })

  it('solo falta el documento: el mensaje nombra solo el documento', async () => {
    const r = await evaluarCruces(
      CRUCES,
      ctx({ ...COPROPIEDAD_SIN_RUT2, rut_solicitante_2: { razon_social: 'RUIZ LOPEZ CARLOS ANDRES', numero_identificacion: '  ' } }),
      CARGUE,
    )
    expect(r).toHaveLength(1)
    expect(r[0].mensaje).toContain('falta el número de documento del segundo titular')
    expect(r[0].mensaje).not.toContain('el nombre del segundo titular')
  })

  it('después de Cargue solo avisa (la tarjeta lo muestra, el avance no se frena)', async () => {
    for (const etapa of [PAGO_UPME, CERTIFICACION]) {
      const r = await evaluarCruces(CRUCES, ctx(COPROPIEDAD_SIN_RUT2), etapa)
      expect(r).toHaveLength(1)
      expect(r[0].bloquea).toBe(false)
    }
  })

  it('un solo titular o leasing: no exige el segundo', async () => {
    for (const modalidad of ['unico', 'leasing']) {
      const r = await evaluarCruces(CRUCES, ctx({ ...BASE, titularidad: { modalidad_solicitante: modalidad } }), CARGUE)
      expect(r).toEqual([])
    }
  })

  it('sin titularidad respondida no frena (la condición no se cumple)', async () => {
    expect(await evaluarCruces(CRUCES, ctx(BASE), CARGUE)).toEqual([])
  })
})

describe('cruce `requeridos` (genérico)', () => {
  const COND = { field: 'modalidad_solicitante', value: 'copropiedad', source_bloque_slug: 'titularidad' }

  it('sin `condition` se descarta: exigiría el dato a toda la línea', () => {
    const crudo = { slug: 'x', tipo: 'requeridos', mensaje: 'falta {faltantes}', campos: [{ source_bloque_slug: 'rut', field: 'razon_social', label: 'el nombre' }] }
    expect(leerCruces({ cruces: [crudo] })).toEqual([])
    expect(leerCruces({ cruces: [{ ...crudo, condition: COND }] })).toHaveLength(1)
  })

  it('un campo sin `label` o una lista vacía se descartan', () => {
    const base = { slug: 'x', tipo: 'requeridos', mensaje: 'falta {faltantes}', condition: COND }
    expect(leerCruces({ cruces: [{ ...base, campos: [] }] })).toEqual([])
    expect(leerCruces({ cruces: [{ ...base, campos: [{ source_bloque_slug: 'rut', field: 'razon_social' }] }] })).toEqual([])
  })

  it('un bloque que no le aplica al caso no se exige', async () => {
    const cruces = leerCruces({
      cruces: [{
        slug: 'x', tipo: 'requeridos', mensaje: 'falta {faltantes}', condition: COND, bloquea_en_etapas: [7],
        campos: [
          // Bloque que no existe en la línea: no aplica, calla.
          { source_bloque_slug: 'bloque_de_otra_linea', field: 'algo', label: 'algo' },
          { source_bloque_slug: 'rut_solicitante_2', field: 'razon_social', label: 'el nombre' },
        ],
      }],
    })
    const r = await evaluarCruces(cruces, ctx(COPROPIEDAD_SIN_RUT2), 7)
    expect(r.map(c => c.mensaje)).toEqual(['falta el nombre'])
  })

  it('una alternativa con el dato basta', async () => {
    const cruces = leerCruces({
      cruces: [{
        slug: 'x', tipo: 'requeridos', mensaje: 'falta {faltantes}', condition: COND,
        campos: [{ source_bloque_slug: 'rut_solicitante_2', alternativas: ['rut'], field: 'razon_social', label: 'el nombre' }],
      }],
    })
    expect(await evaluarCruces(cruces, ctx(COPROPIEDAD_SIN_RUT2), 7)).toEqual([])
  })

  it('tres faltantes se enumeran con comas y «y»', async () => {
    const cruces = leerCruces({
      cruces: [{
        slug: 'x', tipo: 'requeridos', mensaje: 'falta {faltantes}', condition: COND,
        campos: ['a', 'b', 'c'].map(f => ({ source_bloque_slug: 'rut_solicitante_2', field: f, label: f })),
      }],
    })
    const [c] = await evaluarCruces(cruces, ctx(COPROPIEDAD_SIN_RUT2), null)
    expect(c.mensaje).toBe('falta a, b y c')
    expect(c.bloquea).toBe(false)
  })
})
