/**
 * Cierre económico, En viaje y Postventa (F6), lo puro. El caso es el del guion de Vera §8 paso 27.
 *
 * VISTO FALLAR (2026-10-12), una mutación a la vez:
 *   · quitar `- iva` del ingreso neto → cae «guion paso 27» (margen inflado por el IVA, C8);
 *   · comparar la huella con `!==` → `===` en `faltaParaCerrar` → cae «cambiar un gasto pide confirmar otra vez»;
 *   · `p.referido === 'no_se_lo_pedi'` fuera de `faltaPostventa` → cae «No se lo pedí no cierra».
 */
import { describe, expect, it } from 'vitest'
import {
  calcularCierre,
  celularReferido,
  configEtapasPorFecha,
  decisionSaldoVigente,
  faltaParaCerrar,
  faltaPostventa,
  huellaCierre,
  leerCierreGuardado,
  leerPostventa,
  mensajeEncuesta,
  mensajeSaldoAFavor,
  movimientoPorFecha,
  textoEnViaje,
  validarValorCortesia,
  type EntradaCierre,
} from './cierre-viaje'

const servicios = [
  { id: 'vuelo', nombre: 'Vuelo', proveedor_nombre: 'LATAM', estado: 'reservado', costo_cotizado: 1_800_000, valor_por_pagar: null, comision_esperada: null, comision_estado: null },
  { id: 'hotel', nombre: 'Hotel', proveedor_nombre: 'Andino', estado: 'reservado', costo_cotizado: 1_100_000, valor_por_pagar: 1_190_000, comision_esperada: 45_000, comision_estado: 'por_cobrar' },
  { id: 'traslado', nombre: 'Traslado', proveedor_nombre: null, estado: 'reservado', costo_cotizado: 200_000, valor_por_pagar: null, comision_esperada: null, comision_estado: null },
]
const gastos = [
  { monto: 1_800_000, servicio_id: 'vuelo', categoria: 'proveedor_viaje', descripcion: null },
  { monto: 1_190_000, servicio_id: 'hotel', categoria: 'proveedor_viaje', descripcion: null },
  { monto: 200_000, servicio_id: 'traslado', categoria: 'proveedor_viaje', descripcion: null },
  { monto: 50_000, servicio_id: null, categoria: 'cortesia_viaje', descripcion: 'Acompañamiento en aeropuerto' },
]
const A: EntradaCierre = { precioAprobado: 4_052_000, cobrado: 4_076_300, iva: 152_000, recargo: 24_300, servicios, gastos }

describe('cierre económico (F6-4, C8)', () => {
  it('guion paso 27: margen real $660.000 contra cotizado $800.000, sin IVA ni recargo', () => {
    const c = calcularCierre(A)
    expect(c).toMatchObject({ ingresoReal: 4_076_300, ingresoNeto: 3_900_000, costoReal: 3_240_000, margenReal: 660_000, costoCotizado: 3_100_000, margenCotizado: 800_000, saldoAFavor: 0, porCobrar: 0 })
    expect(c.margenRealPct).toBe(16.9)
    expect(c.margenCotizadoPct).toBe(20.5)
    expect(c.explicacion).toBe('Dejó $140.000 menos de lo cotizado: Hotel (+$90.000), una cortesía ($50.000).')
    expect(c.comisiones).toEqual([{ servicioId: 'hotel', proveedor: 'Andino', esperada: 45_000, estado: 'por_cobrar' }])
  })

  it('un servicio sacado del viaje no pasa a margen en silencio: sigue en lo cotizado y se explica (H9-3)', () => {
    const conAvion = [...servicios, { id: 'avion', nombre: 'Air France', proveedor_nombre: 'AF', estado: 'cancelado', costo_cotizado: 300_000, valor_por_pagar: null, comision_esperada: null, comision_estado: null }]
    const c = calcularCierre({ ...A, precioAprobado: 4_052_000 + 300_000, cobrado: 4_076_300 + 300_000, servicios: conAvion })
    // El margen cotizado es el del precio que aceptó el cliente, con el avión dentro.
    expect(c.costoCotizado).toBe(3_400_000)
    expect(c.margenCotizado).toBe(800_000)
    const avion = c.filas.find(f => f.id === 'avion')!
    expect(avion).toMatchObject({ sacado: true, sinCosto: false, real: 0, diferencia: -300_000 })
    expect(faltaParaCerrar(c, leerCierreGuardado({}), 'Valeria')).not.toContain('Falta el costo real de Air France.')
  })

  // H-28 (QA 2026-10-29, R-11): hasta aquí los $300.000 del avión subían el margen real a $960.000
  // sin que nadie decidiera nada. Son del cliente hasta que la dirección decida.
  it('la plata del servicio sacado es saldo a favor, no margen, hasta que se decida (H-28)', () => {
    const conAvion = [...servicios, { id: 'avion', nombre: 'Air France', proveedor_nombre: 'AF', estado: 'cancelado', costo_cotizado: 300_000, valor_por_pagar: null, comision_esperada: null, comision_estado: null }]
    const entrada = { ...A, precioAprobado: 4_052_000 + 300_000, cobrado: 4_076_300 + 300_000, servicios: conAvion }
    const c = calcularCierre(entrada)
    expect(c.saldoAFavor).toBe(300_000)
    expect(c.saldoPorSacados).toBe(300_000)
    expect(c.sacados).toEqual([{ id: 'avion', nombre: 'Air France', cotizado: 300_000 }])
    expect(c.margenReal).toBe(660_000)
    expect(c.explicacion).toBe('Dejó $140.000 menos de lo cotizado: Hotel (+$90.000), una cortesía ($50.000).')
    expect(faltaParaCerrar(c, leerCierreGuardado({}), 'Valeria')[0]).toBe(
      'Valeria tiene un saldo a favor de $300.000 (todo por Air France, que se sacó del viaje). Decide antes de cerrar: devolverlo, dejarlo abonado a su próximo viaje o retenerlo con motivo.',
    )
    // Retenerlo, y solo eso, lo vuelve margen; la explicación lo dice con su nombre.
    const r = calcularCierre({ ...entrada, decisionSaldo: 'retener' })
    expect(r.margenReal).toBe(960_000)
    expect(r.explicacion).toBe('Dejó $160.000 más de lo cotizado: Hotel (+$90.000), Air France sacado del viaje: se retienen $300.000, una cortesía ($50.000).')
    expect(calcularCierre({ ...entrada, decisionSaldo: 'devolver' }).margenReal).toBe(660_000)
    // La decisión vale para el saldo sobre el que se tomó; una de antes de H-28 (sin monto) no lo veía.
    const g = (monto?: number) => leerCierreGuardado({ cierre_viaje: { saldo_a_favor: { decision: 'devolver', por: 's', at: 'x', nota: null, ...(monto !== undefined ? { monto } : {}) } } })
    expect(decisionSaldoVigente(c, g(300_000))).toBe(true)
    expect(decisionSaldoVigente(c, g(250_000))).toBe(false)
    expect(decisionSaldoVigente(c, g())).toBe(false)
    expect(mensajeSaldoAFavor({ nombreCliente: 'Valeria Gómez', monto: 300_000, decision: 'proximo_viaje', sacados: c.sacados })).toBe(
      'Valeria, tienes un saldo a favor de $300.000 por Air France, que salió del viaje. Queda abonado para tu próximo viaje con nosotros.',
    )
    expect(mensajeSaldoAFavor({ nombreCliente: 'Valeria', monto: 300_000, decision: 'retener', sacados: c.sacados })).toBeNull()
  })

  it('sin IVA en la línea: todo se recalcula con la misma fórmula', () => {
    const c = calcularCierre({ ...A, precioAprobado: 3_900_000, cobrado: 3_900_000, iva: 0, recargo: 0 })
    expect(c.margenReal).toBe(660_000)
    expect(c.margenCotizado).toBe(800_000)
  })

  it('un servicio que va sin ningún pago: falta su costo real', () => {
    const c = calcularCierre({ ...A, gastos: gastos.filter(g => g.servicio_id !== 'traslado') })
    expect(faltaParaCerrar(c, leerCierreGuardado({}), 'Valeria')).toContain('Falta el costo real de Traslado.')
  })

  it('saldo a favor bloquea hasta decidir; la comisión pendiente no (N2, C13)', () => {
    const c = calcularCierre({ ...A, cobrado: 4_126_300 })
    expect(c.saldoAFavor).toBe(50_000)
    const sin = faltaParaCerrar(c, leerCierreGuardado({}), 'Valeria')
    expect(sin[0]).toBe('Valeria tiene un saldo a favor de $50.000. Decide antes de cerrar: devolverlo, dejarlo abonado a su próximo viaje o retenerlo con motivo.')
    const conf = { huella: huellaCierre(c), por: 's-edgar', at: 'x', margen_real: 0, margen_real_pct: null, margen_cotizado: 0, margen_cotizado_pct: null, ingreso_neto: 0, costo_real: 0 }
    const decidido = leerCierreGuardado({ cierre_viaje: { confirmado: conf, saldo_a_favor: { decision: 'devolver', por: 's-edgar', at: 'x', nota: null } } })
    expect(faltaParaCerrar(c, decidido, 'Valeria')).toEqual([])
  })

  it('cambiar un gasto después de confirmar pide confirmar otra vez (F6-5)', () => {
    const c = calcularCierre(A)
    const g = leerCierreGuardado({ cierre_viaje: { confirmado: { huella: huellaCierre(c), por: 's', at: 'x' } } })
    expect(faltaParaCerrar(c, g, 'V')).toEqual([])
    const otro = calcularCierre({ ...A, gastos: [...gastos.slice(0, 3), { ...gastos[3], monto: 50_001 }] })
    expect(faltaParaCerrar(otro, g, 'V')[0]).toMatch(/^Cambió un pago o un gasto después de confirmar/)
  })
})

describe('H-25 (QA G12) · la fila del Cierre separa la diferencia de cambio del sobrecosto', () => {
  // Viaje 06: Renaissance cotizado USD 2.084,40 a 4.150 = $8.650.260, pagado a TRM 4.230.
  const ren = { id: 'ren', nombre: 'Renaissance', proveedor_nombre: 'Renaissance', estado: 'reservado', costo_cotizado: 8_650_260, valor_por_pagar: null, comision_esperada: null, comision_estado: null, moneda: { moneda: 'USD', monto: 2084.4, tasa: 4150 } }
  const base = { precioAprobado: 9_611_400, cobrado: 9_611_400, iva: 0, recargo: 0, servicios: [ren] }

  it('solo cambio: +$166.752 de diferencia de cambio y cero sobrecosto', () => {
    const c = calcularCierre({ ...base, gastos: [{ monto: 8_817_012, servicio_id: 'ren', categoria: 'proveedor_viaje', descripcion: null, moneda: 'USD', tasa_cambio: 4230 }] })
    expect(c.filas[0]).toMatchObject({ diferencia: 166_752, cambio: 166_752, sobrecosto: 0 })
  })

  it('cambio y además el hotel subió: cada cosa en su lugar', () => {
    // USD 2.184,40 a 4.230 = $9.240.012: USD 100 de más (sobrecosto) y la TRM.
    const c = calcularCierre({ ...base, gastos: [{ monto: 9_240_012, servicio_id: 'ren', categoria: 'proveedor_viaje', descripcion: null, moneda: 'USD', tasa_cambio: 4230 }] })
    const f = c.filas[0]
    expect(f.diferencia).toBe(589_752)
    expect(f.cambio).toBe(174_752)
    expect(f.sobrecosto).toBe(415_000)
  })

  it('un servicio en pesos no tiene diferencia de cambio: todo es sobrecosto', () => {
    const c = calcularCierre(A)
    expect(c.filas.find(f => f.id === 'hotel')).toMatchObject({ diferencia: 90_000, cambio: 0, sobrecosto: 90_000 })
  })
})

describe('En viaje por fechas (F6-1)', () => {
  const config = configEtapasPorFecha({ etapas_por_fecha: { entrar: { etapa_numero: 7 }, salir: { etapa_numero: 8, offset: 1 } } })!
  it('entra el día de salida desde la 6 y sale el día después del regreso', () => {
    const base = { config, salida: '2026-11-21', regreso: '2026-11-25' }
    expect(movimientoPorFecha({ ...base, etapaNumero: 6, hoy: '2026-11-20' })).toBeNull()
    expect(movimientoPorFecha({ ...base, etapaNumero: 6, hoy: '2026-11-21' })).toBe('entrar')
    expect(movimientoPorFecha({ ...base, etapaNumero: 7, hoy: '2026-11-25' })).toBeNull()
    expect(movimientoPorFecha({ ...base, etapaNumero: 7, hoy: '2026-11-26' })).toBe('salir')
    expect(movimientoPorFecha({ ...base, etapaNumero: 5, hoy: '2026-11-21' })).toBeNull()
  })
  it('config inválida = el cron no toca la línea', () => {
    expect(configEtapasPorFecha({})).toBeNull()
    expect(configEtapasPorFecha({ etapas_por_fecha: { entrar: { etapa_numero: 7 }, salir: { etapa_numero: 7 } } })).toBeNull()
  })
  it('texto del día', () => {
    expect(textoEnViaje('2026-12-04', '2026-12-09', '2026-12-06')).toBe('Viajando · día 3 de 6 · regresan el miércoles 9 dic')
  })
  it('cortesía sin valor no se guarda (F6-3)', () => {
    expect(validarValorCortesia('')).toEqual({ ok: false, error: 'Ponle un valor aproximado. Sin valor no suma al costo real.' })
    expect(validarValorCortesia('$120.000')).toEqual({ ok: true, valor: 120_000 })
  })
})

describe('Postventa (F6-7)', () => {
  it('cerrar exige calificación y la respuesta del referido; «No se lo pedí» no cierra', () => {
    expect(faltaPostventa(leerPostventa({}))).toBe('Para cerrar falta: la calificación del viaje y si pediste el referido.')
    expect(faltaPostventa(leerPostventa({ postventa: { calificacion: 5, referido: 'no_se_lo_pedi' } }))).toBe('Para cerrar falta: si pediste el referido.')
    expect(faltaPostventa(leerPostventa({ postventa: { calificacion: 5, referido: 'no_quiso' } }))).toBeNull()
    expect(leerPostventa({ postventa: { calificacion: 9 } }).calificacion).toBeNull()
  })
  it('celular del referido y encuesta por C1', () => {
    expect(celularReferido('+57 300 123 4567')).toBe('3001234567')
    expect(celularReferido('12345')).toBeNull()
    const t = mensajeEncuesta({ nombreCliente: 'Valeria Prueba', destino: 'Cusco', comercial: 'Daniela', agencia: 'Trappvel' })
    expect(t.startsWith('Valeria, ¿cómo les fue en Cusco? Respóndeme con un número del 1 al 5.')).toBe(true)
  })
})
