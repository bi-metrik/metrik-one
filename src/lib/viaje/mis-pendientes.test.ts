/**
 * «Mis pendientes» y el tablero de margen (F6-8, F6-9), lo puro.
 *
 * VISTO FALLAR (2026-10-12), una mutación a la vez:
 *   · quitar el `continue` de `v.esPrueba` → cae «un negocio de prueba no le aparece al equipo»;
 *   · `c.esPrueba` fuera del filtro del tablero → cae «excluye es_prueba y cuadra».
 */
import { describe, expect, it } from 'vitest'
import { loProximo, pendientesDe, tableroDeMargen, type ViajePendiente } from './mis-pendientes'

const HOY = '2026-11-02'

function viaje(o: Partial<ViajePendiente> = {}): ViajePendiente {
  return {
    id: 'neg-a', nombre: 'V 26 1 — Cusco', cliente: 'Valeria Prueba', etapaNumero: 5, etapaGates: [], esPrueba: false,
    salida: '2026-11-21', regreso: '2026-11-25', precioAprobado: 4_052_000, metadata: {},
    comercialStaffId: 's-dani', operacionesStaffId: 's-ale',
    cuotas: [
      { numero: 0, monto: 1_216_000, fecha: '2026-10-12', concepto: null },
      { numero: 1, monto: 2_026_000, fecha: '2026-10-30', concepto: null },
      { numero: 2, monto: 810_000, fecha: '2026-11-21', concepto: null },
    ],
    pagos: [{ monto: 1_216_000, fecha: '2026-10-12' }],
    servicios: [
      { id: 'hotel', nombre: 'Hotel Andino', proveedor_nombre: 'Andino', estado: 'reservado', costo_cotizado: 1_100_000, valor_por_pagar: null, confirmacion_ref: null, fecha_limite_pago: '2026-11-04', gastos: [], aprobaciones: [] },
    ],
    aprobaciones: [],
    ...o,
  }
}

const DANI = { staffId: 's-dani', esDireccion: false, areas: ['comercial'] }
const ALE = { staffId: 's-ale', esDireccion: false, areas: ['operaciones'] }
const EDGAR = { staffId: 's-edgar', esDireccion: true, areas: [] }

describe('Mis pendientes (F6-9)', () => {
  it('la comercial ve la cuota vencida de su cliente', () => {
    const p = pendientesDe([viaje()], DANI, HOY)
    expect(p).toEqual([expect.objectContaining({ grupo: 'vencido', texto: 'Cuota de Valeria vencida: faltan $2.026.000.', accion: { tipo: 'abrir', label: 'Pegar comprobante' } })])
  })

  it('operaciones ve el pago a proveedor que vence en 2 días', () => {
    const p = pendientesDe([viaje()], ALE, HOY)
    expect(p.map(x => x.texto)).toEqual(['Paga Hotel Andino: vence el 04/11.'])
    expect(p[0].grupo).toBe('semana')
  })

  it('la dirección ve la aprobación con Aprobar en la línea y la cuota vencida hace 2 días o más', () => {
    const v = viaje({ aprobaciones: [{ id: 'apr-1', tipo: 'medio_personal', entidad_tipo: 'servicio', entidad_id: 'hotel', estado: 'solicitada', motivo: null, detalle: { monto: 1_180_000 }, solicitada_por_nombre: 'Alejandra', decidida_at: null }] })
    const p = pendientesDe([v], EDGAR, HOY)
    expect(p[0]).toMatchObject({ grupo: 'vencido', texto: 'Cuota vencida: Valeria Prueba · $2.026.000 · hace 3 días.' })
    expect(p[1]).toMatchObject({ grupo: 'hoy', texto: 'Alejandra pide pagar $1.180.000 a Andino: con tarjeta personal.', accion: { tipo: 'aprobar', aprobacionId: 'apr-1', servicioId: 'hotel' } })
  })

  it('otra comercial no ve los negocios ajenos; un negocio de prueba no le aparece al equipo', () => {
    expect(pendientesDe([viaje()], { staffId: 's-tati', esDireccion: false, areas: ['comercial'] }, HOY)).toEqual([])
    expect(pendientesDe([viaje({ esPrueba: true })], { ...DANI, staffId: 's-otra' }, HOY)).toEqual([])
    expect(pendientesDe([viaje({ esPrueba: true })], EDGAR, HOY)).toEqual([])
    // Quien lo lleva (la cuenta de prueba) sí lo ve.
    expect(pendientesDe([viaje({ esPrueba: true })], DANI, HOY)).toHaveLength(1)
  })

  it('la aprobación del viaje de prueba le llega a la dirección de prueba (aprobadora de SU línea), no a Edgar (F8-1)', () => {
    const DP = { staffId: 's-dp', esDireccion: true, areas: [] }
    const aprob = { id: 'apr-p', tipo: 'medio_personal', entidad_tipo: 'servicio', entidad_id: 'hotel', estado: 'solicitada' as const, motivo: null, detalle: { monto: 1_180_000 }, solicitada_por_nombre: 'OP', decidida_at: null }
    const v = viaje({ esPrueba: true, comercialStaffId: 's-cp', operacionesStaffId: 's-op', aprobadoresStaffIds: ['s-dp'], aprobaciones: [aprob] })
    expect(pendientesDe([v], EDGAR, HOY)).toEqual([])
    expect(pendientesDe([v], DP, HOY).some(p => p.accion?.tipo === 'aprobar')).toBe(true)
  })

  it('el vacío dice lo próximo', () => {
    const v = viaje({ pagos: [{ monto: 3_242_000, fecha: '2026-10-12' }], servicios: [] })
    expect(pendientesDe([v], DANI, HOY)).toEqual([])
    expect(loProximo([v], HOY)).toEqual({ texto: 'cuota de Valeria', fecha: '2026-11-21' })
  })
})

describe('tablero de margen (F6-8)', () => {
  it('excluye es_prueba y cuadra con la suma de los cierres', () => {
    const t = tableroDeMargen([
      { negocioId: 'a', nombre: 'A', esPrueba: false, mes: '2026-12', margenReal: 660_000, ingresoNeto: 3_900_000, margenCotizado: 800_000, servicios: [{ proveedor: 'Andino', cotizado: 1_100_000, real: 1_190_000 }], gastosProveedor: [{ monto: 1_190_000, titular: 'personal' }, { monto: 1_800_000, titular: 'empresa' }] },
      { negocioId: 'b', nombre: 'B', esPrueba: false, mes: '2026-12', margenReal: 340_000, ingresoNeto: 2_100_000, margenCotizado: 300_000, servicios: [{ proveedor: 'LATAM', cotizado: 900_000, real: 860_000 }], gastosProveedor: [{ monto: 860_000, titular: 'empresa' }] },
      { negocioId: 'p', nombre: 'PRUEBA', esPrueba: true, mes: '2026-12', margenReal: 9_999_999, ingresoNeto: 1, margenCotizado: 0, servicios: [], gastosProveedor: [] },
    ])
    expect(t.meses).toEqual([{ mes: '2026-12', viajes: 2, margenReal: 1_000_000, ingresoNeto: 6_000_000, pctReal: 16.7, margenCotizado: 1_100_000, pctCotizado: 18.3 }])
    expect(t.viajes.map(v => v.negocioId)).toEqual(['a', 'b'])
    expect(t.proveedores).toEqual([{ proveedor: 'Andino', desviacion: 90_000 }, { proveedor: 'LATAM', desviacion: -40_000 }])
    expect(t.pctTarjetasPersonales).toBe(30.9)
  })

  it('el cierre de prueba suma solo para quien lo lleva o lo aprueba (visibles, F8-1)', () => {
    const cierres = [
      { negocioId: 'a', nombre: 'A', esPrueba: false, mes: '2026-12', margenReal: 660_000, ingresoNeto: 3_900_000, margenCotizado: 800_000, servicios: [], gastosProveedor: [] },
      { negocioId: 'p', nombre: 'PRUEBA', esPrueba: true, mes: '2026-12', margenReal: 100_000, ingresoNeto: 1_000_000, margenCotizado: 0, servicios: [], gastosProveedor: [] },
    ]
    expect(tableroDeMargen(cierres).viajes.map(v => v.negocioId)).toEqual(['a'])
    expect(tableroDeMargen(cierres, new Set(['p'])).viajes.map(v => v.negocioId)).toEqual(['a', 'p'])
  })
})
