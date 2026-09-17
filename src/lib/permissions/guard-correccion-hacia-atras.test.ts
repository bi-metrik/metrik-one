/**
 * `guardEditarBloque` — cableado de la corrección hacia atrás.
 *
 * La regla vive en `can-edit.ts` y tiene sus propias pruebas
 * (`correccion-hacia-atras.test.ts`). Lo que se cuida aquí es lo que solo se puede
 * romper en el guard:
 *
 *  · que el `esPostAvance` salga de comparar el orden de la etapa DEL BLOQUE contra el
 *    de la etapa actual del NEGOCIO, y no de otra cosa;
 *  · que el negocio cerrado siga cortando ANTES que nada (es el choke point de toda
 *    mutación de bloques);
 *  · que el camino normal —trabajar un bloque de la etapa propia— no pague la consulta
 *    extra que la excepción necesita.
 *
 * EL DOBLE APLICA LOS FILTROS `.eq()` y CUENTA LAS CONSULTAS: sin eso, «no consultó
 * `etapas_negocio`» y «consultó y le dio igual» se ven idénticos.
 *
 * ── Mutaciones corridas contra este archivo (2026-09-17) ──────────────────────
 *   · el guard pasa `esPostAvance: true` siempre                → 2 rojas
 *   · el guard nunca pasa `esPostAvance`                        → 2 rojas
 *   · `bloqueDeEtapaSuperada` devuelve true sin mirar el orden   → 1 roja
 *   · se quita el corte por negocio cerrado                      → 1 roja
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Sesion = { role: string; areas: string[]; staffId: string }

let sesion: Sesion = { role: 'supervisor', areas: ['operaciones'], staffId: 'staff-deisy' }
let estadoNegocio = 'abierto'
/** Orden de la etapa donde vive el bloque / de la etapa actual del negocio. */
let ordenBloque: number | null = 6
let ordenEtapaActual: number | null = 7
let stageBloque: string | null = 'venta'
let areasEditoras: string[] = []
let responsables: string[] = []
let consultas: string[] = []

vi.mock('@/lib/modulos/exigir-modulo', () => ({
  exigirModulo: async () => ({ ok: true }),
  MENSAJE_MODULO_NO_ACTIVO: 'modulo',
  REQUISITO: { clarity: 'clarity' },
}))

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(),
    workspaceId: 'ws-1',
    userId: 'user-1',
    staffId: sesion.staffId,
    role: sesion.role,
    areas: sesion.areas,
    error: null,
  }),
}))

function clienteFalso() {
  return {
    from(tabla: string) {
      consultas.push(tabla)
      const filtros: [string, unknown][] = []
      const api = {
        select: () => api,
        eq: (col: string, val: unknown) => { filtros.push([col, val]); return api },
        // `.single()` y `.maybeSingle()` son thenables en el cliente real.
        single: async () => resolver(tabla, filtros),
        maybeSingle: async () => resolver(tabla, filtros),
        then: (r: (v: unknown) => unknown) => r(resolver(tabla, filtros)),
      }
      return api
    },
  }
}

function resolver(tabla: string, filtros: [string, unknown][]): { data: unknown; error: null } {
  if (tabla === 'negocio_bloques') {
    if (filtros.some(([c, v]) => c === 'id' && v !== 'nb-1')) return { data: null, error: null }
    return {
      data: {
        negocio_id: 'neg-1',
        negocios: { estado: estadoNegocio, etapa_actual_id: ordenEtapaActual === null ? null : 'etapa-actual' },
        bloque_configs: {
          config_extra: { areas_editoras: areasEditoras },
          etapas_negocio: { stage: stageBloque, orden: ordenBloque },
        },
      },
      error: null,
    }
  }
  if (tabla === 'etapas_negocio') {
    return { data: ordenEtapaActual === null ? null : { orden: ordenEtapaActual }, error: null }
  }
  if (tabla === 'negocio_responsables') {
    return { data: responsables.map(staff_id => ({ staff_id })), error: null }
  }
  return { data: null, error: null }
}

const { guardEditarBloque } = await import('./guard-negocio')

beforeEach(() => {
  sesion = { role: 'supervisor', areas: ['operaciones'], staffId: 'staff-deisy' }
  estadoNegocio = 'abierto'
  ordenBloque = 6
  ordenEtapaActual = 7
  stageBloque = 'venta'
  areasEditoras = []
  responsables = []
  consultas = []
})

describe('guardEditarBloque — el área no corta una corrección hacia atrás', () => {
  it('supervisora de operaciones sobre un bloque de VENTA de una etapa pasada: pasa', async () => {
    const r = await guardEditarBloque('nb-1')
    expect(r.ok).toBe(true)
    // La excepción CUESTA una consulta: si no se preguntó el orden de la etapa actual,
    // el `ok` estaría saliendo de otra parte.
    expect(consultas).toContain('etapas_negocio')
  })

  it('el mismo bloque en la etapa ACTUAL sigue bloqueado', async () => {
    ordenBloque = 7
    const r = await guardEditarBloque('nb-1')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('Tu rol o área no permite editar en esta fase del negocio')
  })

  it('una etapa POSTERIOR tampoco abre nada (la excepción es hacia atrás, no hacia adelante)', async () => {
    ordenBloque = 9
    const r = await guardEditarBloque('nb-1')
    expect(r.ok).toBe(false)
  })

  it('un operator de operaciones, responsable, sigue bloqueado en el bloque pasado', async () => {
    sesion = { role: 'operator', areas: ['operaciones'], staffId: 'staff-eje' }
    responsables = ['staff-eje']
    const r = await guardEditarBloque('nb-1')
    expect(r.ok).toBe(false)
    // Y no paga la consulta extra: `corrigeHaciaAtrasSinArea` lo descarta sin IO.
    expect(consultas).not.toContain('etapas_negocio')
  })

  it('el negocio cerrado corta ANTES, aunque el rol pudiera corregir hacia atrás', async () => {
    estadoNegocio = 'completado'
    const r = await guardEditarBloque('nb-1')
    expect(r.ok).toBe(false)
    expect(r.error).not.toBe('Tu rol o área no permite editar en esta fase del negocio')
    expect(consultas).not.toContain('etapas_negocio')
  })

  it('trabajar un bloque de la PROPIA área no paga la consulta extra', async () => {
    stageBloque = 'ejecucion'
    const r = await guardEditarBloque('nb-1')
    expect(r.ok).toBe(true)
    expect(consultas).not.toContain('etapas_negocio')
  })

  it('un negocio sin etapa actual no puede declararse superado: se rechaza', async () => {
    ordenEtapaActual = null
    const r = await guardEditarBloque('nb-1')
    expect(r.ok).toBe(false)
  })

  it('`areas_editoras` sigue resolviendo sin necesitar la excepción', async () => {
    areasEditoras = ['operaciones']
    ordenBloque = 7
    const r = await guardEditarBloque('nb-1')
    expect(r.ok).toBe(true)
    expect(consultas).not.toContain('etapas_negocio')
  })
})
