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
  puedeSerAprobador,
  activoEnEquipo,
  opcionesAprobador,
  perfilesConEstadoEnEquipo,
  MENSAJE_ESTADO_INVALIDO,
  MENSAJE_FALTA_APROBADOR,
  MENSAJE_ROL_APROBACION,
  MENSAJE_NO_ES_EL_APROBADOR,
  MENSAJE_YA_DECIDIDA,
  MENSAJE_APROBADOR_AJENO,
  MENSAJE_APROBADOR_NO_PUEDE_DECIDIR,
  MENSAJE_DECISOR_INACTIVO,
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
  const base = { ahoraISO: AHORA, bloqueEstado: 'pendiente' as string | null, activo: true }

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
      designado: { role: 'admin', activo: true },
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

describe('quién puede ser aprobador', () => {
  it('solo dueño o administrador, y activo en el equipo', () => {
    expect(puedeSerAprobador({ role: 'owner', activo: true })).toBe(true)
    expect(puedeSerAprobador({ role: 'admin', activo: true })).toBe(true)
    for (const role of ['supervisor', 'operator', 'contador', 'read_only', null, undefined]) {
      expect(puedeSerAprobador({ role, activo: true })).toBe(false)
    }
    expect(puedeSerAprobador({ role: 'owner', activo: false })).toBe(false)
  })

  it('un activo ausente no autoriza, y una persona ausente tampoco', () => {
    expect(puedeSerAprobador({ role: 'owner', activo: undefined })).toBe(false)
    expect(puedeSerAprobador(null)).toBe(false)
  })

  it('solo una fila de staff marcada inactiva saca a alguien del equipo', () => {
    expect(activoEnEquipo(null)).toBe(true)
    expect(activoEnEquipo(undefined)).toBe(true)
    expect(activoEnEquipo({ is_active: true })).toBe(true)
    expect(activoEnEquipo({ is_active: null })).toBe(true)
    expect(activoEnEquipo({ is_active: false })).toBe(false)
  })

  it('cada profile toma el estado de SU fila de staff, y sin fila queda activo', () => {
    const marcados = perfilesConEstadoEnEquipo(
      [
        { id: 'p1', role: 'admin' },
        { id: 'p2', role: 'owner' },
        { id: 'p3', role: 'admin' },
      ],
      [
        { profile_id: 'p1', is_active: false },
        { profile_id: 'p2', is_active: true },
        { profile_id: null, is_active: false },
      ],
    )
    expect(marcados).toEqual([
      { id: 'p1', role: 'admin', activo: false },
      { id: 'p2', role: 'owner', activo: true },
      { id: 'p3', role: 'admin', activo: true },
    ])
  })
})

describe('opcionesAprobador (la lista del selector)', () => {
  const perfiles = [
    { id: 'p-owner', full_name: 'Dueña', role: 'owner', activo: true },
    { id: 'p-oper', full_name: 'Operadora', role: 'operator', activo: true },
    { id: 'p-admin-baja', full_name: 'Admin de baja', role: 'admin', activo: false },
    { id: 'p-admin', full_name: 'Admin', role: 'admin', activo: true },
  ]

  it('ofrece solo a quien puede decidir, en el orden recibido', () => {
    const { elegibles, designadoInvalido } = opcionesAprobador(perfiles, '')
    expect(elegibles.map(p => p.id)).toEqual(['p-owner', 'p-admin'])
    expect(designadoInvalido).toBeNull()
  })

  it('un designado válido no se marca', () => {
    expect(opcionesAprobador(perfiles, 'p-admin').designadoInvalido).toBeNull()
  })

  it('un designado que no puede decidir no se borra: vuelve marcado con su motivo', () => {
    expect(opcionesAprobador(perfiles, 'p-oper').designadoInvalido)
      .toEqual({ id: 'p-oper', perfil: perfiles[1], motivo: 'rol' })
    expect(opcionesAprobador(perfiles, 'p-admin-baja').designadoInvalido)
      .toEqual({ id: 'p-admin-baja', perfil: perfiles[2], motivo: 'inactivo' })
    expect(opcionesAprobador(perfiles, 'p-otro').designadoInvalido)
      .toEqual({ id: 'p-otro', perfil: null, motivo: 'fuera_del_equipo' })
  })

  it('un perfil sin rol ni estado conocidos no aparece', () => {
    expect(opcionesAprobador([{ id: 'p-x', full_name: 'X' }], '').elegibles).toEqual([])
  })
})

describe('planAprobacion: designar exige a alguien que pueda decidir', () => {
  const base = {
    ahoraISO: AHORA, bloqueEstado: 'pendiente' as string | null, activo: true,
    role: 'owner', profileId: 'p-owner', guardada: { referencia: 'x' },
  }
  const asignar = (aprobadorId: string) => ({ accion: 'asignar' as const, aprobadorId })

  it('un no gerencial se rechaza', () => {
    expect(planAprobacion({ ...base, entrada: asignar('p-oper'), designado: { role: 'operator', activo: true } }))
      .toEqual({ error: MENSAJE_APROBADOR_NO_PUEDE_DECIDIR })
  })

  it('un gerencial desactivado se rechaza', () => {
    expect(planAprobacion({ ...base, entrada: asignar('p-admin'), designado: { role: 'admin', activo: false } }))
      .toEqual({ error: MENSAJE_APROBADOR_NO_PUEDE_DECIDIR })
  })

  it('alguien que no es del equipo se rechaza', () => {
    expect(planAprobacion({ ...base, entrada: asignar('p-otro'), designado: null }))
      .toEqual({ error: MENSAJE_APROBADOR_AJENO })
  })

  it('quitar el aprobador no necesita designado', () => {
    expect(planAprobacion({ ...base, entrada: asignar(''), designado: null }))
      .toEqual({ data: { referencia: 'x', estado: 'pendiente' }, completar: false })
  })

  it('la lista y el servidor son la misma regla: aparece en la lista si y solo si se puede designar', () => {
    const roles = ['owner', 'admin', 'supervisor', 'operator', 'contador', 'read_only', null]
    for (const role of roles) {
      for (const activo of [true, false]) {
        const enLista = opcionesAprobador([{ id: 'p-1', full_name: 'P', role, activo }], '').elegibles.length === 1
        const plan = planAprobacion({ ...base, entrada: asignar('p-1'), designado: { role, activo } })
        expect({ role, activo, designable: !('error' in plan) }).toEqual({ role, activo, designable: enLista })
      }
    }
  })
})

describe('planAprobacion: decidir exige seguir pudiendo ser aprobador', () => {
  it('el designado desactivado en el equipo ya no decide', () => {
    const r = planAprobacion({
      ahoraISO: AHORA, bloqueEstado: 'pendiente', activo: false,
      role: 'admin', profileId: 'p-1', guardada: { aprobador_id: 'p-1' },
      entrada: { accion: 'decidir', decision: 'aprobado', comentario: '' },
    })
    expect(r).toEqual({ error: MENSAJE_DECISOR_INACTIVO })
  })
})
