import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { avisarFacturaCargada } from './aviso-factura-cuota-servidor'

/**
 * `avisarFacturaCargada` contra un doble de PostgREST que guarda las filas de `notificaciones` y
 * aplica los filtros de verdad (eq/in), para que «no duplica» se pruebe sobre lo que quedó escrito.
 */

type Fila = Record<string, unknown>

interface Doble {
  contratos: Fila[]
  notificaciones: Fila[]
  fallar: Partial<Record<'contratos' | 'leer_notif' | 'insert' | 'update', string>>
  lanzar?: boolean
}

function crearDoble(d: Doble) {
  let siguiente = 1
  function consulta(tabla: string) {
    const filtros: Array<(f: Fila) => boolean> = []
    let op: 'select' | 'update' = 'select'
    let cambios: Fila = {}
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => {
        filtros.push((f) => f[c] === v)
        return q
      },
      in: (c: string, vs: unknown[]) => {
        filtros.push((f) => vs.includes(f[c]))
        return q
      },
      update: (c: Fila) => {
        op = 'update'
        cambios = c
        return q
      },
      insert: (filas: Fila[]) => {
        if (d.fallar.insert) return Promise.resolve({ error: { message: d.fallar.insert } })
        for (const f of filas) d.notificaciones.push({ id: `n${siguiente++}`, ...f })
        return Promise.resolve({ error: null })
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        const fuente = tabla === 'servicios_contratados' ? d.contratos : d.notificaciones
        const filas = fuente.filter((f) => filtros.every((p) => p(f)))
        let r: { data?: Fila[]; error: { message: string } | null }
        if (tabla === 'servicios_contratados' && d.fallar.contratos) r = { error: { message: d.fallar.contratos } }
        else if (op === 'select' && tabla === 'notificaciones' && d.fallar.leer_notif) r = { error: { message: d.fallar.leer_notif } }
        else if (op === 'update' && d.fallar.update) r = { error: { message: d.fallar.update } }
        else if (op === 'update') {
          for (const f of filas) Object.assign(f, cambios)
          r = { error: null }
        } else r = { data: filas.map((f) => ({ ...f })), error: null }
        return Promise.resolve(r).then(res, rej)
      },
    }
    return q
  }
  return {
    from: (tabla: string) => {
      if (d.lanzar) throw new Error('red caída')
      return consulta(tabla)
    },
  }
}

const COBRADOR = 'ws-metrik'
const PAGADOR = 'ws-carmen'
const NEGOCIO = 'neg-1'

const contratosCarmen = (): Fila[] => [
  { id: 'sc-viejo', workspace_id: COBRADOR, negocio_id: NEGOCIO, estado: 'cancelado', vigente_desde: '2026-09-23', workspace_pagador_id: PAGADOR, aceptante_designado_id: 'oficial' },
  { id: 'sc-activo', workspace_id: COBRADOR, negocio_id: NEGOCIO, estado: 'activo', vigente_desde: '2026-09-23', workspace_pagador_id: PAGADOR, aceptante_designado_id: 'cda' },
]

const params = (extra: Partial<Parameters<typeof avisarFacturaCargada>[1]> = {}) => ({
  workspaceCobradorId: COBRADOR,
  ancla: { tipo: 'negocio' as const, id: NEGOCIO },
  cuotaId: 'q1',
  numeroCuota: 1,
  numeroFactura: 'FE-6',
  reemplazo: false,
  ...extra,
})

let errores: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errores = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  errores.mockRestore()
})

describe('avisarFacturaCargada', () => {
  it('crea un aviso en el espacio que paga, para la persona designada del contrato activo', async () => {
    const d: Doble = { contratos: contratosCarmen(), notificaciones: [], fallar: {} }
    const r = await avisarFacturaCargada(crearDoble(d), params())
    expect(r).toEqual({ avisado: true, workspacePagadorId: PAGADOR, creadas: 1, actualizadas: 0 })
    expect(d.notificaciones).toHaveLength(1)
    expect(d.notificaciones[0]).toMatchObject({
      workspace_id: PAGADOR,
      destinatario_id: 'cda',
      tipo: 'factura_cargada',
      estado: 'pendiente',
      contenido: 'Ya está tu factura FE-6 de la cuota 1. Descárgala en Pagos.',
      deep_link: '/suscripcion?tab=pagos',
      grupo_clave: 'factura_cuota:q1',
      metadata: { cuota_id: 'q1', numero_factura: 'FE-6', servicio_contratado_id: 'sc-activo' },
    })
  })

  it('recargar con el aviso pendiente lo actualiza y no crea otro', async () => {
    const d: Doble = { contratos: contratosCarmen(), notificaciones: [], fallar: {} }
    await avisarFacturaCargada(crearDoble(d), params())
    const r = await avisarFacturaCargada(crearDoble(d), params({ numeroFactura: 'FE-7', reemplazo: true }))
    expect(r).toMatchObject({ avisado: true, creadas: 0, actualizadas: 1 })
    expect(d.notificaciones).toHaveLength(1)
    expect(d.notificaciones[0].contenido).toBe('Se actualizó tu factura FE-7 de la cuota 1. Descárgala en Pagos.')
  })

  it('si el aviso anterior ya se leyó, la recarga avisa de nuevo', async () => {
    const d: Doble = { contratos: contratosCarmen(), notificaciones: [], fallar: {} }
    await avisarFacturaCargada(crearDoble(d), params())
    d.notificaciones[0].estado = 'completada'
    await avisarFacturaCargada(crearDoble(d), params({ reemplazo: true }))
    expect(d.notificaciones.filter((n) => n.estado === 'pendiente')).toHaveLength(1)
    expect(d.notificaciones).toHaveLength(2)
  })

  it('otra cuota es otro aviso', async () => {
    const d: Doble = { contratos: contratosCarmen(), notificaciones: [], fallar: {} }
    await avisarFacturaCargada(crearDoble(d), params())
    await avisarFacturaCargada(crearDoble(d), params({ cuotaId: 'q2', numeroCuota: 2, numeroFactura: 'FE-7' }))
    expect(d.notificaciones.map((n) => n.grupo_clave)).toEqual(['factura_cuota:q1', 'factura_cuota:q2'])
  })

  it('no lee contratos de otro cobrador', async () => {
    const d: Doble = { contratos: contratosCarmen(), notificaciones: [], fallar: {} }
    const r = await avisarFacturaCargada(crearDoble(d), params({ workspaceCobradorId: 'otro' }))
    expect(r).toEqual({ avisado: false, motivo: 'sin_contrato' })
    expect(d.notificaciones).toHaveLength(0)
  })

  it('sin persona designada no avisa a nadie', async () => {
    const contratos = contratosCarmen().map((c) => ({ ...c, aceptante_designado_id: null }))
    const d: Doble = { contratos, notificaciones: [], fallar: {} }
    expect(await avisarFacturaCargada(crearDoble(d), params())).toEqual({ avisado: false, motivo: 'sin_destinatarios' })
    expect(d.notificaciones).toHaveLength(0)
  })

  it('sin poder leer el aviso previo no crea otro (no duplica a ciegas)', async () => {
    const d: Doble = { contratos: contratosCarmen(), notificaciones: [], fallar: { leer_notif: 'timeout' } }
    expect(await avisarFacturaCargada(crearDoble(d), params())).toEqual({ avisado: false, motivo: 'error' })
    expect(d.notificaciones).toHaveLength(0)
  })

  it('nunca lanza: un error de la base o una excepción vuelven como motivo y quedan en el log', async () => {
    const d1: Doble = { contratos: contratosCarmen(), notificaciones: [], fallar: { insert: 'violates check constraint' } }
    expect(await avisarFacturaCargada(crearDoble(d1), params())).toEqual({ avisado: false, motivo: 'error' })
    const d2: Doble = { contratos: [], notificaciones: [], fallar: {}, lanzar: true }
    await expect(avisarFacturaCargada(crearDoble(d2), params())).resolves.toEqual({ avisado: false, motivo: 'error' })
    expect(errores).toHaveBeenCalled()
  })
})
