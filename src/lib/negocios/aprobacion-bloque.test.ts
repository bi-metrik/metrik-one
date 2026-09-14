/**
 * Quién decide un bloque de aprobación y qué escribe la decisión (`aprobacion-bloque.ts`).
 *
 * La regla la comparten la pantalla y `actualizarAprobacion`. El cableado contra la server
 * action (guard, tipo, escritura) está en `negocios/actualizar-aprobacion-guard.test.ts`.
 */

import { describe, it, expect } from 'vitest'
import {
  rolGestionaAprobacion,
  esAprobadorAsignado,
  leerEntradaAprobacion,
  planAprobacion,
  MENSAJE_ESTADO_INVALIDO,
  MENSAJE_FALTA_APROBADOR,
  MENSAJE_ROL_APROBACION,
  MENSAJE_NO_ES_EL_APROBADOR,
  MENSAJE_YA_DECIDIDA,
} from './aprobacion-bloque'

const AHORA = '2026-09-14T15:00:00.000Z'

describe('rolGestionaAprobacion', () => {
  it('solo dueño y administrador', () => {
    expect(rolGestionaAprobacion('owner')).toBe(true)
    expect(rolGestionaAprobacion('admin')).toBe(true)
    for (const r of ['supervisor', 'operator', 'contador', 'read_only', '', null, undefined]) {
      expect(rolGestionaAprobacion(r)).toBe(false)
    }
  })
})

describe('esAprobadorAsignado', () => {
  it('coincide solo con el profile designado', () => {
    expect(esAprobadorAsignado('p-1', 'p-1')).toBe(true)
    expect(esAprobadorAsignado('p-2', 'p-1')).toBe(false)
  })

  it('un aprobador vacío o ausente no lo es nadie, tampoco un profile vacío', () => {
    expect(esAprobadorAsignado('', '')).toBe(false)
    expect(esAprobadorAsignado(undefined, undefined)).toBe(false)
    expect(esAprobadorAsignado('p-1', undefined)).toBe(false)
  })
})

describe('leerEntradaAprobacion', () => {
  it('pendiente con aprobador es designar', () => {
    expect(leerEntradaAprobacion({ estado: 'pendiente', aprobador_id: ' p-1 ' }))
      .toEqual({ accion: 'asignar', aprobadorId: 'p-1' })
  })

  it('pendiente sin aprobador no se entiende', () => {
    expect(leerEntradaAprobacion({ estado: 'pendiente' })).toEqual({ error: MENSAJE_FALTA_APROBADOR })
  })

  it('aprobado y rechazado son decidir; lo que mande el navegador sobre quién y cuándo se ignora', () => {
    expect(leerEntradaAprobacion({
      estado: 'aprobado', comentario: ' ok ', aprobado_at: '1999-01-01', aprobador_id: 'otro',
    })).toEqual({ accion: 'decidir', decision: 'aprobado', comentario: 'ok' })
    expect(leerEntradaAprobacion({ estado: 'rechazado' }))
      .toEqual({ accion: 'decidir', decision: 'rechazado', comentario: '' })
  })

  it('un estado fuera de los permitidos, o ninguno, se rechaza', () => {
    for (const raw of [{ estado: 'completo' }, { estado: 'APROBADO' }, {}, null, 'aprobado']) {
      expect(leerEntradaAprobacion(raw)).toEqual({ error: MENSAJE_ESTADO_INVALIDO })
    }
  })
})

describe('planAprobacion', () => {
  const base = { ahoraISO: AHORA, bloqueEstado: 'pendiente' as string | null }

  it('un rol que no gestiona la aprobación no hace nada', () => {
    const r = planAprobacion({
      ...base, role: 'supervisor', profileId: 'p-1', guardada: { aprobador_id: 'p-1' },
      entrada: { accion: 'decidir', decision: 'aprobado', comentario: '' },
    })
    expect(r).toEqual({ error: MENSAJE_ROL_APROBACION })
  })

  it('designar conserva lo guardado y deja el estado pendiente', () => {
    const r = planAprobacion({
      ...base, role: 'admin', profileId: 'p-9', guardada: { nota_interna: 'x', aprobador_id: 'p-1' },
      entrada: { accion: 'asignar', aprobadorId: 'p-2' },
    })
    expect(r).toEqual({ data: { nota_interna: 'x', aprobador_id: 'p-2', estado: 'pendiente' }, completar: false })
  })

  it('designar en blanco quita el aprobador', () => {
    const r = planAprobacion({
      ...base, role: 'owner', profileId: 'p-9', guardada: { aprobador_id: 'p-1' },
      entrada: { accion: 'asignar', aprobadorId: '' },
    })
    expect(r).toEqual({ data: { estado: 'pendiente' }, completar: false })
  })

  it('decidir exige ser el aprobador designado, aunque el rol sea gerencial', () => {
    const r = planAprobacion({
      ...base, role: 'owner', profileId: 'p-2', guardada: { aprobador_id: 'p-1' },
      entrada: { accion: 'decidir', decision: 'aprobado', comentario: '' },
    })
    expect(r).toEqual({ error: MENSAJE_NO_ES_EL_APROBADOR })
  })

  it('sin aprobador designado nadie decide', () => {
    const r = planAprobacion({
      ...base, role: 'owner', profileId: 'p-1', guardada: {},
      entrada: { accion: 'decidir', decision: 'aprobado', comentario: '' },
    })
    expect(r).toEqual({ error: MENSAJE_NO_ES_EL_APROBADOR })
  })

  it('aprobar escribe quién, cuándo y el comentario encima de lo guardado, y cierra el bloque', () => {
    const r = planAprobacion({
      ...base, role: 'admin', profileId: 'p-1', guardada: { aprobador_id: 'p-1', otra: 7 },
      entrada: { accion: 'decidir', decision: 'aprobado', comentario: 'va' },
    })
    expect(r).toEqual({
      data: { aprobador_id: 'p-1', otra: 7, estado: 'aprobado', comentario: 'va', aprobado_at: AHORA, decidido_por: 'p-1' },
      completar: true,
    })
  })

  it('rechazar registra la decisión sin cerrar el bloque, igual que antes', () => {
    const r = planAprobacion({
      ...base, role: 'owner', profileId: 'p-1', guardada: { aprobador_id: 'p-1' },
      entrada: { accion: 'decidir', decision: 'rechazado', comentario: 'no' },
    })
    expect(r).toMatchObject({ data: { estado: 'rechazado', decidido_por: 'p-1' }, completar: false })
  })

  it('una aprobación ya decidida no se vuelve a decidir ni se reasigna', () => {
    for (const guardada of [{ aprobador_id: 'p-1', estado: 'aprobado' }, { aprobador_id: 'p-1', estado: 'rechazado' }]) {
      expect(planAprobacion({
        ...base, role: 'owner', profileId: 'p-1', guardada,
        entrada: { accion: 'decidir', decision: 'aprobado', comentario: '' },
      })).toEqual({ error: MENSAJE_YA_DECIDIDA })
      expect(planAprobacion({
        ...base, role: 'owner', profileId: 'p-1', guardada,
        entrada: { accion: 'asignar', aprobadorId: 'p-2' },
      })).toEqual({ error: MENSAJE_YA_DECIDIDA })
    }
  })

  it('un bloque ya completo tampoco, aunque su data diga pendiente', () => {
    expect(planAprobacion({
      ...base, bloqueEstado: 'completo', role: 'owner', profileId: 'p-1', guardada: { aprobador_id: 'p-1' },
      entrada: { accion: 'decidir', decision: 'aprobado', comentario: '' },
    })).toEqual({ error: MENSAJE_YA_DECIDIDA })
  })
})
