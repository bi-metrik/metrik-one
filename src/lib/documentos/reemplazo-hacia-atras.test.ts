/**
 * `esReemplazoHaciaAtras` — cuándo subir un archivo es CORREGIR y no cargar.
 *
 * Corre contra `contextoCorreccion` REAL (la misma función que decide si la corrección de
 * un campo exige causa), no contra un doble de ella: si las dos señales se separaran, la
 * pantalla dejaría reemplazar un archivo que el registro no considera corrección. El doble
 * es el del cliente de Supabase y APLICA los filtros `.eq()`.
 *
 * Las tres situaciones que separa, medidas en producción el 2026-09-17:
 *   · etapa en curso → trabajo normal;
 *   · bloque vacío en etapa pasada → primera carga (bloque reactivado tarde, o la factura
 *     que baja de Siigo después). 25 bloques declaran `editable_siempre`, todos en SOENA;
 *   · bloque con archivo en etapa pasada → corrección: opt-in, causa y registro.
 *
 * ── Mutaciones corridas contra este archivo (2026-09-17) ──────────────────────
 *   · se ignora `editable_siempre`            → 1 roja
 *   · se ignora que el bloque esté vacío       → 2 rojas
 *   · `permiteCorregir` siempre true           → 1 roja
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { esReemplazoHaciaAtras } from './reemplazo-hacia-atras'

type Fila = Record<string, unknown>

let bloques: Fila[] = []
let negocios: Fila[] = []
let etapas: Fila[] = []

function clienteFalso() {
  return {
    from(tabla: string) {
      const filtros: [string, unknown][] = []
      const tablaDe = (): Fila[] =>
        tabla === 'negocio_bloques' ? bloques : tabla === 'negocios' ? negocios : etapas
      const resolver = () => {
        const filas = tablaDe().filter(f => filtros.every(([c, v]) => f[c] === v))
        return { data: filas[0] ? { ...filas[0] } : null, error: null }
      }
      const api = {
        select: () => api,
        eq: (c: string, v: unknown) => { filtros.push([c, v]); return api },
        single: async () => resolver(),
        maybeSingle: async () => resolver(),
      }
      return api
    },
  }
}

/** Bloque de Documentación (orden 6) con el caso ya en Cargue (orden 7). */
function sembrar(opts: {
  configExtra?: Record<string, unknown>
  data?: Record<string, unknown> | null
  ordenBloque?: number
  ordenActual?: number
}) {
  const ordenBloque = opts.ordenBloque ?? 6
  const ordenActual = opts.ordenActual ?? 7
  bloques = [{
    id: 'nb-1',
    negocio_id: 'neg-1',
    data: opts.data ?? null,
    bloque_configs: {
      config_extra: opts.configExtra ?? { corregir_campos_gerencial: true },
      etapas_negocio: { orden: ordenBloque },
    },
  }]
  negocios = [{ id: 'neg-1', etapa_actual_id: 'etapa-actual' }]
  etapas = [{ id: 'etapa-actual', orden: ordenActual }]
}

const CON_ARCHIVO = { drive_url: 'https://drive/x', file_name: 'factura-vieja.pdf' }

beforeEach(() => { bloques = []; negocios = []; etapas = [] })

describe('esReemplazoHaciaAtras', () => {
  it('bloque con archivo, etapa ya superada: es corrección y trae el nombre anterior', async () => {
    sembrar({ data: CON_ARCHIVO })
    const r = await esReemplazoHaciaAtras(clienteFalso(), 'nb-1')
    expect(r).toEqual({ aplica: true, permiteCorregir: true, nombreAnterior: 'factura-vieja.pdf' })
  })

  it('sin el opt-in del bloque, la corrección se declara imposible (no se deja pasar)', async () => {
    sembrar({ data: CON_ARCHIVO, configExtra: {} })
    const r = await esReemplazoHaciaAtras(clienteFalso(), 'nb-1')
    expect(r.aplica).toBe(true)
    expect(r.permiteCorregir).toBe(false)
  })

  it('la etapa EN CURSO no es corrección: es el trabajo de la etapa', async () => {
    sembrar({ data: CON_ARCHIVO, ordenBloque: 7, ordenActual: 7 })
    const r = await esReemplazoHaciaAtras(clienteFalso(), 'nb-1')
    expect(r.aplica).toBe(false)
  })

  it('bloque VACÍO en etapa pasada: primera carga, sin causa (bloque reactivado tarde)', async () => {
    sembrar({ data: null })
    expect((await esReemplazoHaciaAtras(clienteFalso(), 'nb-1')).aplica).toBe(false)
    sembrar({ data: { campos: {} } })
    expect((await esReemplazoHaciaAtras(clienteFalso(), 'nb-1')).aplica).toBe(false)
  })

  it('`editable_siempre` conserva su significado: abierto siempre, aunque ya tenga archivo', async () => {
    sembrar({
      data: CON_ARCHIVO,
      configExtra: { corregir_campos_gerencial: true, editable_siempre: true },
    })
    // La factura bajada de Siigo se vuelve a subir sin pedir causa: ese flag declara el
    // bloque abierto por diseño, no una excepción que haya que justificar.
    expect((await esReemplazoHaciaAtras(clienteFalso(), 'nb-1')).aplica).toBe(false)
  })

  it('un archivo sin `file_name` no inventa un nombre anterior', async () => {
    sembrar({ data: { drive_url: 'https://drive/x' } })
    const r = await esReemplazoHaciaAtras(clienteFalso(), 'nb-1')
    expect(r.aplica).toBe(true)
    expect(r.nombreAnterior).toBeNull()
  })
})
