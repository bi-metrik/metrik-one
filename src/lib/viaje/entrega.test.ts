/**
 * Documentos y entrega (F4), lo puro. Casos del guion de Vera §8 (negocio A: $4.052.000, salida
 * D+40, cuotas $1.216.000 · $2.026.000 a D+25 · $810.000 el día del viaje).
 *
 * VISTO FALLAR (2026-10-12), una mutación a la vez:
 *   · `dias <= regla.dias_antes` → `<` en `cobroMinimo` → cae «a T-15 exacto mide el 80 %»;
 *   · quitar `pideVoucher` del filtro de vouchers → cae «la fila de $0 no pide voucher»;
 *   · `fecha_vencimiento >= limite` → `>` en `avisoVencimiento` → cae «vence justo a los 6 meses».
 */
import { describe, expect, it } from 'vitest'
import {
  avisoVencimiento,
  cobroMinimo,
  configEntrega,
  documentoDesdeLectura,
  esInternacional,
  faltaDocumentos,
  huellaVouchers,
  itinerarioDesdeServicios,
  leerPaqueteEnviado,
  mensajeCobroMinimo,
  mensajePaquete,
  mensajeVouchers,
  riesgoDelPlan,
  sumarMeses,
  textoCuentaRegresiva,
  vouchersDelViaje,
  type FilaEntrega,
} from './entrega'

const D = '2026-10-12'
const SALIDA = '2026-11-21' // D+40
const CUOTAS = [
  { monto: 1_216_000, fecha: D },
  { monto: 2_026_000, fecha: '2026-11-06' }, // T-15
  { monto: 810_000, fecha: SALIDA },
]
const base = { total: 4_052_000, cuotas: CUOTAS, fechaSalida: SALIDA }

describe('interruptor', () => {
  it('ausente o distinto de true = apagado', () => {
    expect(configEntrega({}).activo).toBe(false)
    expect(configEntrega({ entrega_viaje: { activo: 'true' } }).activo).toBe(false)
    expect(configEntrega({ entrega_viaje: { activo: true, contactos_emergencia: ' Edgar 313 ' } })).toEqual({ activo: true, contactosEmergencia: 'Edgar 313' })
  })
})

describe('cobro mínimo (F4-3)', () => {
  it('guion paso 20: a T-14 con el 30 % pagado, bloquea con el texto literal y el faltante', () => {
    const e = cobroMinimo({ ...base, pagado: 1_216_000, hoy: '2026-11-07' })
    expect(e).toMatchObject({ modo: 'ochenta', cumple: false, dias: 14, pct: 30, requerido: 3_242_000, faltan: 2_026_000 })
    expect(mensajeCobroMinimo(e, 'Valeria')).toBe(
      'No se puede enviar el paquete todavía. Faltan 14 días para el viaje y Valeria ha pagado el 30 %. La regla pide el 80 % ($3.242.000): faltan $2.026.000.',
    )
  })

  it('guion paso 21: con la cuota 2 pagada cumple', () => {
    const e = cobroMinimo({ ...base, pagado: 3_242_000, hoy: '2026-11-07' })
    expect(e.cumple).toBe(true)
    expect(mensajeCobroMinimo(e, 'Valeria')).toBeNull()
  })

  it('a T-15 exacto ya mide el 80 %', () => {
    expect(cobroMinimo({ ...base, pagado: 1_216_000, hoy: '2026-11-06' }).modo).toBe('ochenta')
    expect(cobroMinimo({ ...base, pagado: 1_216_000, hoy: '2026-11-05' }).modo).toBe('al_dia')
  })

  it('antes de T-15: basta ir al día con las cuotas vencidas', () => {
    const alDia = cobroMinimo({ ...base, pagado: 1_216_000, hoy: '2026-10-20' })
    expect(alDia).toMatchObject({ modo: 'al_dia', cumple: true, requerido: 1_216_000 })
    const atrasado = cobroMinimo({ ...base, pagado: 0, hoy: '2026-10-20' })
    expect(atrasado.cumple).toBe(false)
    expect(mensajeCobroMinimo(atrasado, 'Valeria')).toBe('No se puede enviar el paquete todavía. Valeria no va al día con sus cuotas: faltan $1.216.000 de las que ya vencieron.')
  })

  it('cuenta regresiva y vacío de Noor', () => {
    expect(textoCuentaRegresiva(cobroMinimo({ ...base, pagado: 2_066_000, hoy: '2026-11-08' }), CUOTAS)).toBe('Faltan 13 días para el viaje · pagado 50 %')
    expect(textoCuentaRegresiva(cobroMinimo({ ...base, pagado: 1_216_000, hoy: '2026-10-20' }), CUOTAS))
      .toBe('La regla del 80 % se mide desde el 6 nov. Hoy va en 30 % y el plan llega a 80 % el 6 nov.')
  })

  it('riesgo del plan (avisos T-30 y T-20): plan que no llega o cuota vencida', () => {
    expect(riesgoDelPlan({ ...base, pagado: 1_216_000, hoy: '2026-10-22' })).toEqual({ planLlega: true, cuotaVencida: false })
    expect(riesgoDelPlan({ ...base, pagado: 0, hoy: '2026-10-22' }).cuotaVencida).toBe(true)
    const corto = [{ monto: 1_216_000, fecha: D }, { monto: 2_836_000, fecha: SALIDA }]
    expect(riesgoDelPlan({ ...base, cuotas: corto, pagado: 1_216_000, hoy: '2026-10-22' }).planLlega).toBe(false)
  })
})

const fila = (o: Partial<FilaEntrega> & { id: string }): FilaEntrega => ({
  nombre: o.id, estado: 'reservado', costo_cotizado: 100, valor_por_pagar: null, voucher_ref: null, gastos: [], ...o,
})

describe('vouchers (F4-1)', () => {
  it('«n de m» desde las filas; No va y la fila de $0 no piden voucher', () => {
    const filas = [
      fila({ id: 'vuelo', voucher_ref: 'one://x/v.pdf' }),
      fila({ id: 'hotel', nombre: 'Hotel Arena Blanca' }),
      fila({ id: 'kayak', estado: 'cancelado' }),
      fila({ id: 'recargo', costo_cotizado: 0 }),
    ]
    const v = vouchersDelViaje(filas)
    expect(v).toMatchObject({ conVoucher: 1, total: 2 })
    expect(mensajeVouchers(v)).toBe('Falta el voucher de Hotel Arena Blanca.')
    expect(mensajeVouchers(vouchersDelViaje([fila({ id: 'a', nombre: 'A' }), fila({ id: 'b', nombre: 'B' })]))).toBe('Faltan 2 vouchers: A y B.')
  })

  it('la huella cambia si cambia un voucher', () => {
    const a = huellaVouchers([fila({ id: 'h', voucher_ref: 'one://x/1.pdf' })])
    expect(huellaVouchers([fila({ id: 'h', voucher_ref: 'one://x/2.pdf' })])).not.toBe(a)
    expect(huellaVouchers([fila({ id: 'h', voucher_ref: 'one://x/1.pdf' }), fila({ id: 'k', estado: 'cancelado' })])).toBe(a)
  })
})

describe('documentos del viajero (F4-2)', () => {
  it('guion paso 18: pasaporte que vence D+150 con regreso D+44 → aviso rojo', () => {
    const doc = { tipo: 'pasaporte' as const, fecha_vencimiento: '2027-03-11', nombre_en_documento: 'VALERIA PRUEBA' }
    expect(avisoVencimiento(doc, '2026-11-25', 'Valeria Prueba')).toBe('El pasaporte de VALERIA vence el 11 mar 2027: menos de 6 meses después del regreso.')
  })

  it('vence justo a los 6 meses del regreso: no avisa', () => {
    expect(avisoVencimiento({ tipo: 'pasaporte', fecha_vencimiento: '2027-05-25', nombre_en_documento: null }, '2026-11-25', 'Valeria')).toBeNull()
    expect(sumarMeses('2026-08-31', 6)).toBe('2027-02-28')
  })

  it('internacional pide pasaporte; nacional no pide nada', () => {
    expect(esInternacional('Internacional')).toBe(true)
    expect(esInternacional('nacional')).toBe(false)
    expect(esInternacional(null)).toBeNull()
    const sin = { documentos: [], fechaRegreso: '2026-11-25', nombreContacto: 'Valeria' }
    expect(faltaDocumentos({ ...sin, internacional: true })).toBe('Falta el pasaporte del viajero.')
    expect(faltaDocumentos({ ...sin, internacional: false })).toBeNull()
    expect(faltaDocumentos({ ...sin, internacional: null })).toBeNull()
    const ok = { id: '1', tipo: 'pasaporte' as const, numero: 'AB1', nombre_en_documento: null, pais: null, fecha_vencimiento: '2030-01-01', archivo_ref: null }
    expect(faltaDocumentos({ ...sin, internacional: true, documentos: [ok] })).toBeNull()
  })

  it('la lectura propone y limpia', () => {
    expect(documentoDesdeLectura({
      numero: { value: 'ab 123 456' }, nombre: { value: 'VALERIA PRUEBA' }, fecha_vencimiento: { value: '2027-03-11' }, fecha_emision: { value: 'no sé' },
    } as never)).toEqual({ numero: 'AB123456', nombre: 'VALERIA PRUEBA', pais: null, fecha_emision: null, fecha_vencimiento: '2027-03-11' })
  })
})

describe('paquete (F4-4)', () => {
  it('itinerario por día desde los servicios; lo que no tiene día va al final', () => {
    const dias = itinerarioDesdeServicios([
      fila({ id: 'h', nombre: 'Hotel', fecha_servicio: '2026-11-22', proveedor_nombre: 'Arena Blanca' }),
      fila({ id: 'v', nombre: 'Vuelo', fecha_servicio: SALIDA, localizador: 'XK2L9' }),
      fila({ id: 'a', nombre: 'Asistencia' }),
      fila({ id: 'k', nombre: 'Kayak', estado: 'cancelado', fecha_servicio: SALIDA }),
    ], SALIDA)
    expect(dias.map(d => d.titulo)).toEqual(['Día 1 · 21 nov 2026', 'Día 2 · 22 nov 2026', 'Durante el viaje'])
    expect(dias[0].lineas).toEqual(['Vuelo · localizador XK2L9'])
  })

  it('el mensaje dice que el PDF va adjunto (C1) y firma la comercial', () => {
    const t = mensajePaquete({ nombreCliente: 'Valeria Prueba', fechaSalida: SALIDA, hoy: '2026-11-07', nota: null, comercial: 'Daniela', agencia: 'Trappvel' })
    expect(t).toContain('Valeria, ¿todo listo para el 21 nov? Aquí va tu paquete de viaje (te lo adjunto en PDF).')
    expect(t.endsWith('Daniela · Trappvel')).toBe(true)
    expect(t).not.toMatch(/sale por WhatsApp/i)
  })

  it('lee lo que quedó en metadata.paquete_viaje', () => {
    expect(leerPaqueteEnviado({})).toBeNull()
    expect(leerPaqueteEnviado({ paquete_viaje: { enviado_at: '2026-11-07T15:00:00Z', huella_vouchers: 'x', correo: 'enviado' } }))
      .toMatchObject({ enviado_at: '2026-11-07T15:00:00Z', correo: 'enviado', forzado: null })
  })
})
