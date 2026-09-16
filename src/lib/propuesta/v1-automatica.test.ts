/**
 * La inicialización automática de la v1 de una propuesta económica ya no es una server
 * action, y nunca pisa un bloque que tenga contenido.
 *
 * El hueco (riesgo 11): `crearV1Automatica` estaba exportada desde
 * `propuesta-economica-actions.ts`, un archivo `'use server'`, así que era un endpoint
 * alcanzable por POST. No pedía sesión ni miraba el workspace, y reemplazaba el `data`
 * del bloque por uno vacío: con cualquier `bloqueId` borraba versiones, aprobación,
 * plan elegido y honorario congelado de una propuesta ajena.
 *
 * Lo que se fija aquí:
 *   (a) CONTRATO DE ARCHIVOS: la función no se exporta desde ningún archivo
 *       `'use server'`, vive en un módulo `server-only`, y los dos llamadores la importan
 *       de ahí. Se mira el código fuente porque lo que importa es DÓNDE vive: una prueba
 *       de comportamiento daría igual con la función en cualquiera de los dos archivos.
 *   (b) GUARDA: un bloque aprobado, con versiones o ya inicializado sale intacto.
 *   (c) El camino sano sigue funcionando: un bloque vacío se inicializa con la base.
 *
 * EL DOBLE APLICA LOS `.eq()` Y REGISTRA LAS ESCRITURAS: la prueba de la guarda mira
 * que no haya update, no solo lo que devuelve la función.
 *
 * VISTO FALLAR (2026-09-16):
 *   - con `propuesta-economica-actions.ts` y `negocio-v2-actions.ts` de `origin/main`
 *     (la función exportada desde el archivo `'use server'` y los llamadores apuntando
 *     ahí): cayeron 2 de 8, "ningún archivo `use server` la exporta" y "los llamadores
 *     la importan del módulo nuevo";
 *   - quitando la llamada a `motivoParaNoInicializar` dentro de `crearV1Automatica`
 *     (el cuerpo viejo, sin guarda): cayeron los 3 casos de la guarda; el camino sano
 *     y el contrato siguieron verdes.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, vi } from 'vitest'

type Fila = Record<string, unknown>

const escenario: { bloque: Fila | null } = { bloque: null }
const escrituras: Array<{ tabla: string; filtros: Fila; payload: Fila }> = []

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ from: (tabla: string) => constructor(tabla) }),
}))

function constructor(tabla: string) {
  const filtros: Fila = {}
  let operacion: 'select' | 'update' = 'select'
  let payload: Fila = {}

  const resolver = () => {
    if (tabla === 'negocio_bloques') {
      const b = escenario.bloque
      return { data: b && filtros.id === b.id ? b : null, error: null }
    }
    if (tabla === 'servicios') {
      return filtros.id === 'svc-1'
        ? { data: { precio_estandar: 1_000_000, tarifa_iva: 0.19 }, error: null }
        : { data: null, error: null }
    }
    throw new Error(`tabla inesperada en el doble: ${tabla}`)
  }

  const q = {
    select: () => q,
    update: (p: Fila) => {
      operacion = 'update'
      payload = p
      return q
    },
    eq: (columna: string, valor: unknown) => {
      filtros[columna] = valor
      return q
    },
    single: async () => resolver(),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      if (operacion === 'update') {
        escrituras.push({ tabla, filtros: { ...filtros }, payload })
        return Promise.resolve({ error: null }).then(ok, ko)
      }
      return Promise.resolve(resolver()).then(ok, ko)
    },
  }
  return q
}

import { crearV1Automatica } from './v1-automatica'

function bloqueCon(data: Fila): Fila {
  return {
    id: 'blq-1',
    negocio_id: 'neg-1',
    data,
    bloque_configs: {
      config_extra: {},
      workspace_id: 'ws-1',
      bloque_definitions: { tipo: 'propuesta_economica' },
    },
  }
}

beforeEach(() => {
  escenario.bloque = null
  escrituras.length = 0
})

describe('crearV1Automatica — guarda sobre un bloque con contenido', () => {
  it('una propuesta aprobada no se pisa', async () => {
    escenario.bloque = bloqueCon({
      precio_base_con_iva: 1_190_000,
      aprobado_at: '2026-09-01T15:00:00Z',
      aprobado_plan: 1,
      aprobado_honorario: 850_000,
      versiones: [{ n: 1 }],
    })
    const r = await crearV1Automatica('blq-1', 'svc-1')
    expect(r.ok).toBe(true)
    expect(escrituras).toHaveLength(0)
  })

  it('una propuesta con versiones y sin aprobar no se pisa', async () => {
    escenario.bloque = bloqueCon({ versiones: [{ n: 1 }, { n: 2 }], aprobado_at: null })
    await crearV1Automatica('blq-1', 'svc-1')
    expect(escrituras).toHaveLength(0)
  })

  it('una propuesta ya inicializada (descuentos a medio editar) no se pisa', async () => {
    escenario.bloque = bloqueCon({
      precio_base_con_iva: 1_190_000,
      descuento_pct_plan1: 20,
      versiones: [],
      aprobado_at: null,
    })
    await crearV1Automatica('blq-1', 'svc-1')
    expect(escrituras).toHaveLength(0)
  })
})

describe('crearV1Automatica — camino sano', () => {
  it('un bloque vacío se inicializa con la base con IVA del servicio', async () => {
    escenario.bloque = bloqueCon({})
    const r = await crearV1Automatica('blq-1', 'svc-1')
    expect(r).toEqual({ ok: true })
    expect(escrituras).toHaveLength(1)
    expect(escrituras[0].filtros).toEqual({ id: 'blq-1' })
    const data = escrituras[0].payload.data as Fila
    expect(data.precio_base_con_iva).toBe(1_190_000)
    expect(data.valor_final_plan1).toBe(1_190_000)
    expect(data.valor_final_plan2).toBe(1_190_000)
    expect(data.versiones).toEqual([])
  })

  it('un bloque que no es propuesta económica no se toca', async () => {
    escenario.bloque = {
      ...bloqueCon({}),
      bloque_configs: { config_extra: {}, workspace_id: 'ws-1', bloque_definitions: { tipo: 'datos' } },
    }
    const r = await crearV1Automatica('blq-1', 'svc-1')
    expect(r.ok).toBe(false)
    expect(escrituras).toHaveLength(0)
  })
})

describe('crearV1Automatica — no es una server action', () => {
  const leer = (ruta: string) => readFileSync(ruta, 'utf8')

  /**
   * La directiva cuenta solo si es la primera sentencia del archivo (se permiten
   * comentarios antes). Buscar el literal en cualquier parte daría falsos positivos con
   * los comentarios que la mencionan, como el del propio módulo nuevo.
   */
  function esUseServer(fuente: string): boolean {
    const sinCabecera = fuente.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '')
    return /^['"]use server['"]/.test(sinCabecera)
  }

  function archivosTs(dir: string): string[] {
    const salida: string[] = []
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre)
      if (statSync(ruta).isDirectory()) salida.push(...archivosTs(ruta))
      else if (/\.tsx?$/.test(nombre) && !nombre.endsWith('.test.ts')) salida.push(ruta)
    }
    return salida
  }

  it('ningún archivo `use server` la exporta', () => {
    const culpables = archivosTs('src').filter((ruta) => {
      const fuente = leer(ruta)
      return esUseServer(fuente) && /export\s+async\s+function\s+crearV1Automatica\b/.test(fuente)
    })
    expect(culpables).toEqual([])
  })

  it('vive en un módulo `server-only` sin `use server`', () => {
    const fuente = leer('src/lib/propuesta/v1-automatica.ts')
    expect(fuente.startsWith("import 'server-only'")).toBe(true)
    expect(esUseServer(fuente)).toBe(false)
  })

  it('los llamadores la importan del módulo nuevo', () => {
    const fuente = leer('src/app/(app)/negocios/negocio-v2-actions.ts')
    expect(fuente).toContain("await import('@/lib/propuesta/v1-automatica')")
    expect(fuente).not.toMatch(/crearV1Automatica[^\n]*propuesta-economica-actions/)
  })
})
