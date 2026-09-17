/**
 * El área no corta una CORRECCIÓN HACIA ATRÁS — regla pura.
 *
 * Caso que lo motivó (SOENA, 2026-09-17): la supervisora de `operaciones` necesita
 * corregir campos y reemplazar documentos de etapas ya superadas, sin importar a qué
 * área pertenezca esa etapa. Medido contra producción ese día, sobre la línea
 * GIT EV/HEV (`34a0fa6b-9ed3-4652-a419-42601132d1a8`): de los 113 bloques
 * `datos`+`documento` de la línea, **68 viven en stages `venta` o `cobro`** y estaban
 * cerrados para ella; de los 67 bloques ORIGINALES, 53 declaran
 * `corregir_campos_gerencial` y **30 de esos 53 son de `venta` (29) o `cobro` (1)** —
 * son los que este cambio le abre. Los 14 originales sin el opt-in siguen cerrados.
 *
 * ⚠️ Estos archivos van en `.test.ts` y NO en el `can-edit.test.mjs` que está al lado:
 * el `include` de `vitest.config.ts` es `src/**\/*.test.ts`, así que aquel archivo
 * (`node:test`) NO lo corre `npm test` ni, por tanto, el check obligatorio del PR.
 * Escribir aquí las pruebas de esta regla es lo que hace que CI las mire.
 *
 * ── Mutaciones corridas contra este archivo (2026-09-17) ──────────────────────
 *   · `corrigeHaciaAtrasSinArea` devuelve siempre `true`  → 4 rojas
 *   · `corrigeHaciaAtrasSinArea` devuelve siempre `false` → 3 rojas
 *   · `esEtapaSuperada` con `<=` en vez de `<`            → 3 rojas
 *   · `canAdvanceStage` pasando `esPostAvance: true`      → 1 roja
 *   · quitar `areaDuena !== null &&`                      → **0 rojas, SOBREVIVE**
 *
 * Esa última sobrevive porque hoy es redundante: las dos ramas de `canEditBloque`
 * resuelven el stage sin área dueña (`cerrado`) antes de mirar `correccionHaciaAtras`.
 * El comportamiento SÍ está fijado —la prueba del stage `cerrado` de abajo lo exige—,
 * solo que lo sostiene otra línea. No se borró: ver el comentario en `can-edit.ts`.
 */

import { describe, it, expect } from 'vitest'
import {
  canAdvanceStage,
  canEditBloque,
  corrigeHaciaAtrasSinArea,
  esEtapaSuperada,
  type Role,
  type Area,
  type UserContext,
} from './can-edit'

const persona = (role: Role, areas: Area[] = [], id = 'staff-1'): UserContext => ({ id, role, areas })

/** Deisy: supervisora de operaciones en SOENA (medido en producción, 2026-09-17). */
const deisy = persona('supervisor', ['operaciones'])
/** Un ejecutor de la misma área, responsable del negocio. */
const ejecutor = persona('operator', ['operaciones'], 'staff-eje')

const bloqueVentaPasado = { stage: 'venta' as const, esPostAvance: true }
const bloqueVentaActual = { stage: 'venta' as const }

describe('corrigeHaciaAtrasSinArea', () => {
  it('solo aplica cuando el bloque es de una etapa ya superada', () => {
    expect(corrigeHaciaAtrasSinArea(deisy, { esPostAvance: true })).toBe(true)
    expect(corrigeHaciaAtrasSinArea(deisy, { esPostAvance: false })).toBe(false)
    expect(corrigeHaciaAtrasSinArea(deisy, {})).toBe(false)
  })

  it('cubre los tres roles de corrección y a NADIE más', () => {
    for (const role of ['owner', 'admin', 'supervisor'] as Role[]) {
      expect(corrigeHaciaAtrasSinArea(persona(role, ['operaciones']), { esPostAvance: true })).toBe(true)
    }
    for (const role of ['operator', 'contador', 'read_only'] as Role[]) {
      expect(corrigeHaciaAtrasSinArea(persona(role, ['operaciones']), { esPostAvance: true })).toBe(false)
    }
  })
})

describe('esEtapaSuperada', () => {
  it('estar EN la etapa no es haberla superado', () => {
    expect(esEtapaSuperada(6, 7)).toBe(true)
    expect(esEtapaSuperada(6, 6)).toBe(false)
    expect(esEtapaSuperada(7, 6)).toBe(false)
  })

  it('sin alguno de los dos órdenes no se afirma nada', () => {
    expect(esEtapaSuperada(null, 7)).toBe(false)
    expect(esEtapaSuperada(6, undefined)).toBe(false)
    expect(esEtapaSuperada(undefined, undefined)).toBe(false)
  })
})

describe('canEditBloque — corrección hacia atrás', () => {
  it('supervisora de operaciones corrige un bloque de VENTA de una etapa pasada', () => {
    expect(canEditBloque(deisy, bloqueVentaPasado, [])).toBe(true)
  })

  it('la misma supervisora sigue bloqueada en el bloque de VENTA de la etapa ACTUAL', () => {
    expect(canEditBloque(deisy, bloqueVentaActual, [])).toBe(false)
  })

  it('un operator de operaciones NO gana nada, ni siendo responsable', () => {
    expect(canEditBloque(ejecutor, bloqueVentaPasado, [ejecutor.id])).toBe(false)
    // Y lo que ya podía, lo sigue pudiendo: su propia área, en su etapa.
    expect(canEditBloque(ejecutor, { stage: 'ejecucion' }, [ejecutor.id])).toBe(true)
  })

  it('contador y read_only quedan fuera aunque la etapa esté superada', () => {
    expect(canEditBloque(persona('contador'), bloqueVentaPasado, [])).toBe(false)
    expect(canEditBloque(persona('read_only'), bloqueVentaPasado, [])).toBe(false)
  })

  it('admin con área financiera corrige hacia atrás un bloque de venta', () => {
    const diana = persona('admin', ['financiera'])
    expect(canEditBloque(diana, bloqueVentaActual, [])).toBe(false)
    expect(canEditBloque(diana, bloqueVentaPasado, [])).toBe(true)
  })

  it('un stage SIN área dueña (cerrado) no se abre: lo que se omite es el chequeo de ÁREA', () => {
    // `cerrado` está reservado a owner/admin, y además `guardEditarBloque` frena antes
    // por negocio cerrado. La excepción no puede convertir a un supervisor en owner.
    expect(canEditBloque(deisy, { stage: 'cerrado', esPostAvance: true }, [])).toBe(false)
    expect(canEditBloque(persona('owner', ['operaciones']), { stage: 'cerrado', esPostAvance: true }, [])).toBe(true)
  })

  it('sin áreas asignadas el criterio no cambia (la segmentación ni siquiera se activa)', () => {
    const sinArea = persona('supervisor', [])
    expect(canEditBloque(sinArea, bloqueVentaActual, [])).toBe(true)
    expect(canEditBloque(sinArea, bloqueVentaPasado, [])).toBe(true)
  })

  it('`direccion` sigue cubriendo las tres áreas sin necesitar la excepción', () => {
    const juan = persona('owner', ['comercial', 'direccion'])
    expect(canEditBloque(juan, bloqueVentaActual, [])).toBe(true)
    expect(canEditBloque(juan, { stage: 'cobro' }, [])).toBe(true)
  })
})

describe('canAdvanceStage — no se toca', () => {
  it('corregir un dato de una etapa pasada NO habilita mover el negocio', () => {
    // La supervisora de operaciones no avanza a un stage de venta, ni antes ni ahora:
    // `canAdvanceStage` nunca pasa `esPostAvance`.
    expect(canAdvanceStage(deisy, 'venta', [])).toBe(false)
    expect(canAdvanceStage(deisy, 'ejecucion', [])).toBe(true)
  })

  it('`areas_que_avanzan` sigue siendo la única vía para avanzar una etapa ajena', () => {
    expect(canAdvanceStage(deisy, 'venta', [], ['operaciones'])).toBe(true)
  })
})
