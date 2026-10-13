/**
 * El paso de la prueba al plan contra un doble que LEE y ESCRIBE, con Valida simulada: qué pago abre
 * ciclo, con qué cuerpo se le pide a Valida, qué queda en `config_extra`, y que nada de esto toca a un
 * espacio que no nació en el registro autogestionado (los CDA de hoy).
 */
import { describe, expect, it } from 'vitest'
import { crearDoble, type Tablas } from '../../../test/tablas-doble'
import type { PeticionValida, ResultadoValida } from '@/lib/valida-api/cliente-nucleo'
import { abrirCicloSiCorresponde, detalleCiclo, reconciliarCiclosValida, type LlamarValida } from './ciclo-servidor'

const METRIK = 'ws-metrik'
const PRUEBA = 'ws-prueba'
const CDA = 'ws-cda'
const CLIENTE = 'cliente-valida-1'
const AHORA = new Date('2026-10-20T15:00:00Z')

function base(extra: Partial<Tablas> = {}): Tablas {
  return {
    catalogo_servicios: [{ slug: 'valida-cda-licencia', modulo: 'valida_consulta' }],
    servicios_contratados: [
      { id: 'sc-prueba', workspace_id: METRIK, negocio_id: 'n-prueba', servicio_slug: 'valida-cda-licencia', estado: 'activo', workspace_pagador_id: PRUEBA, parametros: { precio_mensual: 150_000, limite_consultas_mes: 3000 } },
      { id: 'sc-cda', workspace_id: METRIK, negocio_id: 'n-cda', servicio_slug: 'valida-cda-licencia', estado: 'activo', workspace_pagador_id: CDA, parametros: { precio_mensual: 150_000 } },
    ],
    workspaces: [
      {
        id: PRUEBA,
        config_extra: {
          modo_vitrina: true,
          origen_registro: 'valida_autogestion',
          valida_cliente_id: CLIENTE,
          valida_prueba: { cliente_id: CLIENTE, consultas: 10, vence_en: '2026-10-16T15:00:00.000Z' },
        },
      },
      // Un CDA de hoy: tiene cliente de Valida pero NO nació en el registro.
      { id: CDA, config_extra: { modo_vitrina: true, valida_cliente_id: 'cliente-cda' } },
    ],
    valida_registros: [{ id: 'r1', workspace_id: PRUEBA, estado: 'creado', usuario_id: 'u-dueña', correo: 'Gerencia@CDA.co' }],
    plan_cobro_cuotas: [
      { id: 'q1', plan_cobro_id: 'p-prueba', numero: 1, fecha_vencimiento: '2026-10-18' },
      { id: 'q2', plan_cobro_id: 'p-prueba', numero: 2, fecha_vencimiento: '2026-11-18' },
      { id: 'q1-cda', plan_cobro_id: 'p-cda', numero: 1, fecha_vencimiento: '2026-10-23' },
    ],
    cobros: [
      { id: 'cobro-1', workspace_id: METRIK, negocio_id: 'n-prueba', plan_cobro_id: 'p-prueba', numero_cuota: 1, monto: 150_000, fecha: '2026-10-19', anulado_at: null },
      { id: 'cobro-cda', workspace_id: METRIK, negocio_id: 'n-cda', plan_cobro_id: 'p-cda', numero_cuota: 1, monto: 150_000, fecha: '2026-10-19', anulado_at: null },
    ],
    ...extra,
  }
}

function valida(respuesta: ResultadoValida<unknown> = { tipo: 'ok', status: 201, datos: { ya_registrada: false, vence_en: '2026-11-23T05:00:00.000Z' } }) {
  const llamadas: PeticionValida[] = []
  const llamar = (async (p: PeticionValida) => {
    llamadas.push(p)
    return respuesta
  }) as LlamarValida
  return { llamar, llamadas }
}

describe('el pago de una cuota abre el ciclo en Valida', () => {
  it('pide la bolsa del mes con el límite del contrato, la referencia del cobro y la gracia', async () => {
    const { db, tablas } = crearDoble(base())
    const v = valida()
    const r = await abrirCicloSiCorresponde('cobro-1', { db, llamar: v.llamar, ahora: AHORA, env: {} })
    expect(r.tipo).toBe('abierto')
    expect(v.llamadas).toHaveLength(1)
    expect(v.llamadas[0]).toMatchObject({ metodo: 'POST', ruta: `/autogestion/${CLIENTE}/ciclos` })
    expect(v.llamadas[0].cuerpo).toEqual({
      actor: { usuario_id: 'u-dueña', correo: 'gerencia@cda.co' },
      workspace_one_id: PRUEBA,
      referencia: 'one-ciclo:cobro-1',
      consultas: 3000,
      precio_total: 150_000,
      vence_en: '2026-11-23T05:00:00.000Z',
    })
    const config = tablas.workspaces.find((w) => w.id === PRUEBA)?.config_extra as Record<string, unknown>
    // La llave ya no vence: `valida_prueba` se va, y un 401 vuelve a ser un 401.
    expect(config).not.toHaveProperty('valida_prueba')
    expect(config.valida_plan).toMatchObject({ cliente_id: CLIENTE, limite_mes: 3000, cobro_id: 'cobro-1', cuota_numero: 1, desde: '2026-10-18', hasta: '2026-11-17' })
    expect(config).toMatchObject({ modo_vitrina: true, origen_registro: 'valida_autogestion' })
    expect(detalleCiclo(r)).toEqual({ revisar: false, detalle: 'Valida: plan abierto hasta el 2026-11-17 con 3.000 consultas.' })
  })

  it('el límite es el de los textos (3.000) aunque el contrato traiga otro (fila 23 de Vera)', async () => {
    const t = base()
    ;(t.servicios_contratados[0].parametros as Record<string, unknown>).limite_consultas_mes = 4500
    const { db } = crearDoble(t)
    const v = valida()
    await abrirCicloSiCorresponde('cobro-1', { db, llamar: v.llamar, ahora: AHORA, env: { VALIDA_PLAN_LIMITE_MES: '9000' } })
    expect((v.llamadas[0].cuerpo as { consultas: number }).consultas).toBe(3000)
  })

  it('el mismo pago dos veces (reintento del webhook) no vuelve a llamar a Valida', async () => {
    const { db } = crearDoble(base())
    const v = valida()
    await abrirCicloSiCorresponde('cobro-1', { db, llamar: v.llamar, ahora: AHORA, env: {} })
    const segunda = await abrirCicloSiCorresponde('cobro-1', { db, llamar: v.llamar, ahora: AHORA, env: {} })
    expect(segunda.tipo).toBe('ya_abierto')
    expect(v.llamadas).toHaveLength(1)
  })

  it('NO toca un espacio que no nació en el registro (los CDA de hoy)', async () => {
    const { db, escrituras } = crearDoble(base())
    const v = valida()
    const r = await abrirCicloSiCorresponde('cobro-cda', { db, llamar: v.llamar, ahora: AHORA, env: {} })
    expect(r).toEqual({ tipo: 'no_aplica', motivo: 'no_es_autogestion' })
    expect(v.llamadas).toHaveLength(0)
    expect(escrituras).toHaveLength(0)
    expect(detalleCiclo(r)).toBeNull()
  })

  it('un cobro sin pagar, anulado o que no es cuota de plan no aplica', async () => {
    const t = base()
    t.cobros.push(
      { id: 'sin-pago', workspace_id: METRIK, negocio_id: 'n-prueba', plan_cobro_id: 'p-prueba', numero_cuota: 2, fecha: null, anulado_at: null },
      { id: 'anulado', workspace_id: METRIK, negocio_id: 'n-prueba', plan_cobro_id: 'p-prueba', numero_cuota: 2, fecha: '2026-10-19', anulado_at: '2026-10-19T10:00:00Z' },
      { id: 'suelto', workspace_id: METRIK, negocio_id: 'n-prueba', plan_cobro_id: null, numero_cuota: null, fecha: '2026-10-19', anulado_at: null },
    )
    const { db } = crearDoble(t)
    const v = valida()
    for (const id of ['sin-pago', 'anulado', 'suelto']) {
      expect((await abrirCicloSiCorresponde(id, { db, llamar: v.llamar, ahora: AHORA, env: {} })).tipo).toBe('no_aplica')
    }
    expect(v.llamadas).toHaveLength(0)
  })

  it('Valida caída: queda pendiente para el cron, sin tocar config_extra', async () => {
    const { db, escrituras } = crearDoble(base())
    const v = valida({ tipo: 'no_disponible', motivo: 'red' })
    const r = await abrirCicloSiCorresponde('cobro-1', { db, llamar: v.llamar, ahora: AHORA, env: {} })
    expect(r.tipo).toBe('pendiente')
    expect(detalleCiclo(r)?.revisar).toBe(true)
    expect(escrituras).toHaveLength(0)
  })
})

describe('el cron recoge lo que el webhook no alcanzó', () => {
  it('abre el ciclo del pago más nuevo de cada espacio autogestionado, y nada de los demás', async () => {
    const t = base()
    t.cobros.push({ id: 'cobro-2', workspace_id: METRIK, negocio_id: 'n-prueba', plan_cobro_id: 'p-prueba', numero_cuota: 2, monto: 150_000, fecha: '2026-11-17', anulado_at: null })
    const { db, tablas } = crearDoble(t)
    const v = valida()
    const r = await reconciliarCiclosValida({ db, llamar: v.llamar, ahora: AHORA, env: {} })
    expect(r).toMatchObject({ revisados: 1, abiertos: 1, pendientes: [], errores: [] })
    expect(v.llamadas).toHaveLength(1)
    expect((v.llamadas[0].cuerpo as { referencia: string }).referencia).toBe('one-ciclo:cobro-2')
    const config = tablas.workspaces.find((w) => w.id === PRUEBA)?.config_extra as Record<string, unknown>
    expect((config.valida_plan as { cuota_numero: number }).cuota_numero).toBe(2)

    // Segunda corrida: ya abierto, sin llamadas.
    const otra = await reconciliarCiclosValida({ db, llamar: v.llamar, ahora: AHORA, env: {} })
    expect(otra.abiertos).toBe(0)
    expect(v.llamadas).toHaveLength(1)
  })
})
