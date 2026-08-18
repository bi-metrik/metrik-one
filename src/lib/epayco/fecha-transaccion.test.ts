import { describe, it, expect } from 'vitest'
import { fechaTransaccionBogota } from './fecha-transaccion'

// El caso que obligo al modulo: el 3 de agosto de 2026 se concilio una tanda de
// pagos de ePayco entre las 15:36 y las 15:55, y los ocho cobros quedaron
// fechados ese dia. Tres de ellos (V0046, V0122, V0123) definieron el mes de la
// venta de su negocio, que por eso conto en agosto con plata de julio.

describe('fechaTransaccionBogota', () => {
  it('lee el formato del panel de ePayco como hora de Bogota', () => {
    expect(fechaTransaccionBogota('2026-07-30 15:36:12')).toBe('2026-07-30')
  })

  it('acepta la variante con T y sin segundos', () => {
    expect(fechaTransaccionBogota('2026-07-30T15:36')).toBe('2026-07-30')
  })

  it('NO corre el dia en una transaccion de la noche', () => {
    // 19:00 de Bogota es medianoche UTC. Leido en UTC, este pago se habria
    // contado el 31; el cliente pago el 30. Es el mismo gotcha que motivo
    // `todayBogotaISO`, aqui aplicado a un dato ajeno.
    expect(fechaTransaccionBogota('2026-07-30 23:50:00')).toBe('2026-07-30')
  })

  it('respeta una zona explicita y la proyecta a Bogota', () => {
    // 01-ago 02:00 UTC es 31-jul 21:00 en Bogota: la venta es de julio.
    expect(fechaTransaccionBogota('2026-08-01T02:00:00Z')).toBe('2026-07-31')
    expect(fechaTransaccionBogota('2026-07-31T21:00:00-05:00')).toBe('2026-07-31')
  })

  it('deja pasar un dia civil tal cual', () => {
    expect(fechaTransaccionBogota('2026-07-30')).toBe('2026-07-30')
  })

  it('entiende el formato de dia primero', () => {
    expect(fechaTransaccionBogota('30/07/2026 15:36:12')).toBe('2026-07-30')
    expect(fechaTransaccionBogota('30/07/2026')).toBe('2026-07-30')
  })

  it('devuelve null en vez de inventar una fecha', () => {
    // La regla del modulo: si no se puede leer, quien llama decide y deja
    // rastro. Caer en "hoy" en silencio repondria el defecto original.
    expect(fechaTransaccionBogota('')).toBeNull()
    expect(fechaTransaccionBogota(null)).toBeNull()
    expect(fechaTransaccionBogota(undefined)).toBeNull()
    expect(fechaTransaccionBogota('ayer')).toBeNull()
    expect(fechaTransaccionBogota('2026-13-45 99:99:99')).toBeNull()
  })

  it('el supuesto de zona solo mueve la madrugada', () => {
    // Entre 00:00 y 05:00 de Bogota, el mismo crudo leido en UTC caeria el dia
    // anterior. Es el unico rango donde el supuesto declarado cambia el
    // resultado, y por eso esta escrito en el modulo.
    expect(fechaTransaccionBogota('2026-08-01 02:00:00')).toBe('2026-08-01')
  })
})
