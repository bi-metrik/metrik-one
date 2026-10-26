import { describe, expect, it } from 'vitest'
import {
  RAZONES_CIERRE_DEVOLUCION,
  cobradoDelNegocio,
  recaudadoNeto,
  validarDevolucion,
} from './devolucion-dinero'

const HOY = '2026-10-09'
const OK = {
  negocio_id: 'n-1',
  monto: 637500,
  fecha: '2026-10-08',
  motivo: 'La clienta desistió y se le devolvió el anticipo',
  cerrar_caso: false,
}

describe('validarDevolucion', () => {
  it('acepta una devolución completa, y una parcial', () => {
    expect(validarDevolucion(OK, HOY, { neto: 637500 })).toBeNull()
    expect(validarDevolucion({ ...OK, monto: 100000 }, HOY, { neto: 637500 })).toBeNull()
  })

  it('rechaza más que el recaudado neto', () => {
    expect(validarDevolucion({ ...OK, monto: 637501 }, HOY, { neto: 637500 })).toMatch(/recaudado neto/)
  })

  it('rechaza monto cero o negativo, fecha futura, sin fecha y motivo corto', () => {
    expect(validarDevolucion({ ...OK, monto: 0 }, HOY)).toMatch(/mayor a cero/)
    expect(validarDevolucion({ ...OK, monto: -5 }, HOY)).toMatch(/mayor a cero/)
    expect(validarDevolucion({ ...OK, fecha: '2026-10-10' }, HOY)).toMatch(/futura/)
    expect(validarDevolucion({ ...OK, fecha: '' }, HOY)).toMatch(/fecha/)
    expect(validarDevolucion({ ...OK, motivo: 'corto' }, HOY)).toMatch(/motivo/)
    expect(validarDevolucion({ ...OK, negocio_id: '' }, HOY)).toMatch(/negocio/)
  })

  it('el día de hoy sí se permite', () => {
    expect(validarDevolucion({ ...OK, fecha: HOY }, HOY)).toBeNull()
  })

  it('cerrar un caso abierto exige razón; uno ya cerrado no', () => {
    expect(validarDevolucion({ ...OK, cerrar_caso: true }, HOY, { abierto: true })).toMatch(/razón/)
    expect(validarDevolucion({ ...OK, cerrar_caso: true, razon_cierre: 'desistio' }, HOY, { abierto: true })).toBeNull()
    expect(validarDevolucion({ ...OK, cerrar_caso: true }, HOY, { abierto: false })).toBeNull()
  })

  it('una razón que no es de la lista se rechaza siempre', () => {
    expect(validarDevolucion({ ...OK, cerrar_caso: true, razon_cierre: 'inventada' }, HOY)).toMatch(/razón/)
  })

  it('la razón que solo pone el sistema no se ofrece', () => {
    expect(RAZONES_CIERRE_DEVOLUCION.map((r) => r.value)).not.toContain('no_conversion_post_pausa')
    expect(RAZONES_CIERRE_DEVOLUCION.map((r) => r.value)).toContain('desistio')
  })
})

describe('cobradoDelNegocio y recaudadoNeto', () => {
  it('cuenta lo que entró: sin cuotas por pagar ni remanentes por devolver', () => {
    const cobrado = cobradoDelNegocio([
      { monto: 637500, tipo_cobro: 'anticipo', fecha: '2026-09-09' },
      { monto: 500000, tipo_cobro: 'programado', fecha: null },
      { monto: -2500, tipo_cobro: 'devolucion_pendiente', fecha: '2026-09-10' },
      { monto: 0, tipo_cobro: 'externo', fecha: '2026-09-11' }, // anulado
    ])
    expect(cobrado).toBe(637500)
    expect(recaudadoNeto(cobrado, 100000)).toBe(537500)
  })
})
