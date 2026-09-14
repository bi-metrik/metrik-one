import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clienteFalso, estado, reiniciarDoble, type Fila } from '../../../test/cuentas-cobro-doble'

// Ninguna prueba renderiza ni sube nada: todas corren en dry-run. Los dos modulos
// se doblan solo para que importar el generador no arrastre credenciales ni red.
vi.mock('@/lib/pdf/pdf-render-client', () => ({ renderCuentaCobro: vi.fn() }))
vi.mock('@/lib/google-drive', () => ({ createDriveFolder: vi.fn(), uploadFileToDrive: vi.fn() }))

import { generarCuentasCobroPeriodo } from './generar-cuentas-cobro'
import { emitirCuentaDesdeCuota } from './emitir-cuota-explicita'
import { planesConCronogramaExplicito } from './cronograma-explicito'

// ─── El caso real: workspace metrik, septiembre de 2026 ─────────────────────
//
// AFI International Group tiene tres planes uniformes (416.667 + 400.000 +
// 100.000 = 916.667, agrupados en UNA cuenta) y uno de licencias con cronograma
// explicito (400.000, su propia cuenta). SOENA tiene un plan uniforme.
// El 10-sep el cron emitio CC-2026-09-002 (la agrupada de AFI) y CC-2026-09-003
// (la de licencias). Desde el 11 la consulta de idempotencia encontraba DOS
// filas de AFI en el mes, `maybeSingle` devolvia error, y se emitia otra
// agrupada identica: 09-005, 09-006, 09-007, 09-008.

const WS = 'ws-metrik'
const AFI = 'emp-afi'
const SOENA = 'emp-soena'

const COBRO_AFI_1 = 'cob-44752727'
const COBRO_AFI_2 = 'cob-e784c329'
const COBRO_AFI_3 = 'cob-4d8d7098'
const COBRO_SOENA = 'cob-f976ae67'
const GRUPO_AFI = [COBRO_AFI_1, COBRO_AFI_2, COBRO_AFI_3]

function plan(id: string, negocio: string, monto: number, fechaInicio: string, cuotas: number): Fila {
  return {
    id, workspace_id: WS, negocio_id: negocio, monto, total_cuotas: cuotas,
    fecha_inicio: fechaInicio, fecha_fin: '2027-12-31', concepto_detalle_template: null,
    activo: true, frecuencia: 'mensual',
  }
}

function cobro(id: string, planId: string, cuota: number, monto: number, negocio: string, empresa: string): Fila {
  return {
    id, workspace_id: WS, plan_cobro_id: planId, numero_cuota: cuota, monto,
    negocio_id: negocio, fecha_esperada: '2026-09-15', fecha: null, tipo_cobro: 'programado',
    negocios: { id: negocio, codigo: `C-${negocio}`, nombre: `Negocio ${negocio}`, empresa_id: empresa, carpeta_url: null },
  }
}

function cuenta(numero: string, empresa: string, estadoCuenta: string, cobros: string[], creada: string, mes = 9): Fila {
  return {
    id: `id-${numero}`, numero, workspace_id: WS, anio: 2026, mes,
    empresa_id_pagador: empresa, estado: estadoCuenta, cobros_ids: cobros, created_at: creada,
  }
}

function sembrarSeptiembre(cuentas: Fila[]) {
  estado.fixtures = {
    planes_cobro: [
      plan('plan-soena', 'neg-soena', 1_750_000, '2026-04-15', 6),
      plan('plan-594f', 'neg-afi-a', 416_667, '2026-05-15', 12),
      plan('plan-f927', 'neg-afi-b', 400_000, '2026-05-15', 12),
      plan('plan-ff8c', 'neg-afi-c', 100_000, '2026-05-15', 12),
      plan('plan-licencias', 'neg-afi-lic', 400_000, '2026-08-27', 12),
    ],
    // El plan de licencias tiene cronograma explicito: no pasa por el generador uniforme.
    plan_cobro_cuotas: [{ id: 'cuota-lic-2', plan_cobro_id: 'plan-licencias', numero: 2 }],
    cobros: [
      cobro(COBRO_SOENA, 'plan-soena', 6, 1_750_000, 'neg-soena', SOENA),
      cobro(COBRO_AFI_1, 'plan-594f', 5, 416_667, 'neg-afi-a', AFI),
      cobro(COBRO_AFI_2, 'plan-f927', 5, 400_000, 'neg-afi-b', AFI),
      cobro(COBRO_AFI_3, 'plan-ff8c', 5, 100_000, 'neg-afi-c', AFI),
    ],
    empresas: [
      { id: AFI, nombre: 'AFI', razon_social: 'AFI International Group' },
      { id: SOENA, nombre: 'SOENA', razon_social: 'SOENA' },
    ],
    planillas_pila_periodo: [],
    cuentas_cobro_emitidas: cuentas,
  }
}

async function emitirSeptiembre() {
  return generarCuentasCobroPeriodo(clienteFalso() as unknown as SupabaseClient, WS, 2026, 9, {
    dryRun: true,
  })
}

const detalleDe = (r: Awaited<ReturnType<typeof emitirSeptiembre>>, empresa: string) =>
  r.detalles.find((d) => d.empresa_id === empresa)

const CC_09_001 = cuenta('CC-2026-09-001', SOENA, 'enviada', [COBRO_SOENA], '2026-09-10T12:00:53Z')
const CC_09_002 = cuenta('CC-2026-09-002', AFI, 'emitida_pendiente_aprobacion', GRUPO_AFI, '2026-09-10T12:00:56Z')
const CC_09_003 = cuenta('CC-2026-09-003', AFI, 'emitida_pendiente_aprobacion', ['cob-cfca24eb'], '2026-09-10T12:00:59Z')

beforeEach(() => reiniciarDoble())

describe('generarCuentasCobroPeriodo · idempotencia contra el caso real de septiembre', () => {
  it('no vuelve a emitir la agrupada de AFI cuando en el mes conviven la agrupada y la de licencias', async () => {
    // El estado exacto de la noche del 10-sep. Con el codigo viejo AFI salia 'creada'.
    sembrarSeptiembre([CC_09_001, CC_09_002, CC_09_003])

    const r = await emitirSeptiembre()

    expect(detalleDe(r, AFI)?.estado).toBe('omitida')
    expect(detalleDe(r, AFI)?.numero).toBe('CC-2026-09-002')
    expect(detalleDe(r, SOENA)?.estado).toBe('omitida')
    expect(r.cuentasCreadas).toBe(0)
    expect(r.errores).toEqual([])
  })

  it('tampoco emite con los cuatro duplicados ya creados (el estado de hoy)', async () => {
    sembrarSeptiembre([
      CC_09_001, CC_09_002, CC_09_003,
      cuenta('CC-2026-09-005', AFI, 'emitida_pendiente_aprobacion', GRUPO_AFI, '2026-09-11T12:00:35Z'),
      cuenta('CC-2026-09-006', AFI, 'emitida_pendiente_aprobacion', GRUPO_AFI, '2026-09-12T12:00:32Z'),
      cuenta('CC-2026-09-007', AFI, 'emitida_pendiente_aprobacion', GRUPO_AFI, '2026-09-13T12:00:31Z'),
      cuenta('CC-2026-09-008', AFI, 'emitida_pendiente_aprobacion', GRUPO_AFI, '2026-09-14T12:00:40Z'),
    ])

    const r = await emitirSeptiembre()

    expect(r.cuentasCreadas).toBe(0)
    expect(detalleDe(r, AFI)?.estado).toBe('omitida')
    // La que se reporta es la primera que se emitio, no la ultima copia.
    expect(detalleDe(r, AFI)?.numero).toBe('CC-2026-09-002')
  })

  it('la cuenta de licencias (otro plan, otros cobros) no bloquea la agrupada', async () => {
    // Si el camino uniforme fallo el dia 10 y el explicito no, en el mes solo queda
    // la de licencias. El codigo viejo la leia como "ya hay cuenta de AFI" y dejaba
    // el mes sin facturar la agrupada.
    sembrarSeptiembre([CC_09_001, CC_09_003])

    const r = await emitirSeptiembre()

    expect(detalleDe(r, AFI)?.estado).toBe('creada')
    expect(detalleDe(r, AFI)?.cobros_ids.sort()).toEqual([...GRUPO_AFI].sort())
    expect(detalleDe(r, SOENA)?.estado).toBe('omitida')
  })

  it('una cuenta anulada no bloquea la re-emision', async () => {
    sembrarSeptiembre([
      CC_09_001,
      cuenta('CC-2026-09-002', AFI, 'anulada', GRUPO_AFI, '2026-09-10T12:00:56Z'),
    ])

    const r = await emitirSeptiembre()

    expect(detalleDe(r, AFI)?.estado).toBe('creada')
  })

  it('una anulada de OTRO periodo que traia cobros de este mes tampoco bloquea', async () => {
    // CC-2026-08-001 (anulada) contiene 44752727 y e784c329, que vencen en septiembre.
    sembrarSeptiembre([
      CC_09_001,
      cuenta('CC-2026-08-001', AFI, 'anulada', [COBRO_AFI_2, 'cob-83218c1c', COBRO_AFI_1], '2026-08-14T18:09:32Z', 8),
    ])

    const r = await emitirSeptiembre()

    expect(detalleDe(r, AFI)?.estado).toBe('creada')
  })

  it('un cobro que ya esta en una cuenta viva de OTRO periodo bloquea: un cobro no se cobra dos veces', async () => {
    sembrarSeptiembre([
      CC_09_001,
      cuenta('CC-2026-08-009', AFI, 'enviada', GRUPO_AFI, '2026-08-14T18:09:32Z', 8),
    ])

    const r = await emitirSeptiembre()

    expect(detalleDe(r, AFI)?.estado).toBe('omitida')
    expect(detalleDe(r, AFI)?.numero).toBe('CC-2026-08-009')
  })

  it('interseccion parcial: no emite y lo reporta para revision a mano', async () => {
    sembrarSeptiembre([
      CC_09_001,
      cuenta('CC-2026-09-002', AFI, 'emitida_pendiente_aprobacion', [COBRO_AFI_1, COBRO_AFI_2], '2026-09-10T12:00:56Z'),
    ])

    const r = await emitirSeptiembre()

    expect(detalleDe(r, AFI)?.estado).toBe('omitida')
    expect(r.cuentasCreadas).toBe(0)
    expect(r.errores).toHaveLength(1)
    expect(r.errores[0].empresa_id).toBe(AFI)
    expect(r.errores[0].error).toContain('CC-2026-09-002')
    expect(r.errores[0].error).toContain(COBRO_AFI_3)
  })

  it('si no se puede leer cuentas_cobro_emitidas, no emite: el error no se traga', async () => {
    sembrarSeptiembre([])
    estado.tablasQueFallan.add('cuentas_cobro_emitidas')

    const r = await emitirSeptiembre()

    expect(r.cuentasCreadas).toBe(0)
    expect(r.detalles.every((d) => d.estado !== 'creada')).toBe(true)
    expect(r.errores.map((e) => e.empresa_id).sort()).toEqual([AFI, SOENA].sort())
  })

  it('sin ninguna cuenta previa sigue emitiendo las dos (el dia 10 normal)', async () => {
    sembrarSeptiembre([])

    const r = await emitirSeptiembre()

    expect(detalleDe(r, AFI)?.estado).toBe('creada')
    expect(detalleDe(r, SOENA)?.estado).toBe('creada')
    expect(r.errores).toEqual([])
  })
})

describe('planesConCronogramaExplicito', () => {
  it('lanza si no puede leer plan_cobro_cuotas en vez de tratar todo plan como uniforme', async () => {
    // Un Set vacio por error manda los planes explicitos al generador uniforme:
    // la cuota de licencias terminaria dentro de la agrupada de AFI.
    estado.tablasQueFallan.add('plan_cobro_cuotas')

    await expect(
      planesConCronogramaExplicito(clienteFalso() as unknown as SupabaseClient, ['plan-licencias']),
    ).rejects.toThrow()
  })
})

describe('emitirCuentaDesdeCuota · idempotencia', () => {
  function sembrarCuotaLicencias(cuentas: Fila[]) {
    estado.fixtures = {
      plan_cobro_cuotas: [{
        id: 'cuota-lic-2', workspace_id: WS, plan_cobro_id: 'plan-licencias', numero: 2,
        tipo: 'cuota', monto: 400_000, fecha_vencimiento: '2026-09-18', concepto_detalle: null,
      }],
      planes_cobro: [{ id: 'plan-licencias', negocio_id: 'neg-afi-lic', total_cuotas: 12, concepto_detalle_template: null }],
      negocios: [{ id: 'neg-afi-lic', nombre: 'Licencias', empresa_id: AFI, carpeta_url: null }],
      empresas: [{ id: AFI, nombre: 'AFI', razon_social: 'AFI International Group' }],
      cobros: [{ id: 'cob-cfca24eb', plan_cobro_id: 'plan-licencias', numero_cuota: 2 }],
      cuentas_cobro_emitidas: cuentas,
    }
  }

  it('si no puede leer las cuentas previas, falla en vez de emitir otra', async () => {
    sembrarCuotaLicencias([CC_09_003])
    estado.tablasQueFallan.add('cuentas_cobro_emitidas')

    const r = await emitirCuentaDesdeCuota(clienteFalso() as unknown as SupabaseClient, 'cuota-lic-2', {
      dryRun: true,
    })

    expect(r.success).toBe(false)
    expect(r.estado).toBe('error')
  })

  it('con la cuenta ya emitida la omite', async () => {
    sembrarCuotaLicencias([CC_09_003])

    const r = await emitirCuentaDesdeCuota(clienteFalso() as unknown as SupabaseClient, 'cuota-lic-2', {
      dryRun: true,
    })

    expect(r.success).toBe(true)
    expect(r.estado).toBe('omitida')
    if (r.success) expect(r.numero).toBe('CC-2026-09-003')
  })
})
