/**
 * Gate `saldo_cero`: solo cubre lo que ENTRÓ y la financiera confirmó (barrido 2026-10-22).
 */
import { describe, expect, it } from 'vitest'
import { calcularSaldoCero, mensajeSaldoCero, precioParaSaldoCero, recaudoParaSaldoCero } from './saldo-cero'
import { leerSaldoCero } from './saldo-cero-datos'

const pago = (monto: number, extra: Record<string, unknown> = {}) => ({ monto, fecha: '2026-10-01', ...extra })

describe('saldo_cero', () => {
  it('un cobro anulado no cubre el saldo', () => {
    const s = calcularSaldoCero({ precio: 1_000_000, cobros: [pago(1_000_000, { anulado_at: '2026-10-02T10:00:00Z' })], conciliado: false })
    expect(s.cubierto).toBe(false)
    expect(s.saldo).toBe(1_000_000)
    expect(mensajeSaldoCero(s)).toMatch(/^Saldo pendiente: \$\s?1\.000\.000$/)
  })

  it('un cobro sin fecha (cuota programada) no cubre el saldo', () => {
    const s = calcularSaldoCero({ precio: 1_000_000, cobros: [pago(1_000_000, { fecha: null })], conciliado: false })
    expect(s.cubierto).toBe(false)
  })

  it('un pago con fecha cubre, con la retención de IVA y el piso de $1.000', () => {
    expect(calcularSaldoCero({ precio: 1_000_000, cobros: [pago(985_000, { retencion_iva: 15_000 })], conciliado: false }).cubierto).toBe(true)
    expect(calcularSaldoCero({ precio: 1_000_000, cobros: [pago(999_500)], conciliado: false }).cubierto).toBe(true)
    expect(calcularSaldoCero({ precio: 1_000_000, cobros: [pago(998_000)], conciliado: false }).cubierto).toBe(false)
  })

  it('la porción de un reparto del comercial sin confirmar no cubre y se nombra', () => {
    const cobros = [pago(500_000), pago(500_000, { split_json: { origen: 'comercial' } })]
    const s = calcularSaldoCero({ precio: 1_000_000, cobros, conciliado: false })
    expect(s.cubierto).toBe(false)
    expect(s.sinConfirmar).toBe(500_000)
    expect(mensajeSaldoCero(s)).toContain('sin confirmar por el área financiera')
    // Confirmada la porción (o el negocio conciliado), cubre.
    expect(recaudoParaSaldoCero([pago(500_000), pago(500_000, { split_json: { origen: 'comercial', confirmado_at: '2026-10-03' } })], false)).toBe(1_000_000)
    expect(calcularSaldoCero({ precio: 1_000_000, cobros, conciliado: true }).cubierto).toBe(true)
  })

  it('un sobrepago no frena', () => {
    expect(calcularSaldoCero({ precio: 1_000_000, cobros: [pago(1_200_000)], conciliado: false }).cubierto).toBe(true)
  })

  it('la base es el precio aprobado; sin él, el estimado', () => {
    expect(precioParaSaldoCero({ precio_aprobado: 900, precio_estimado: 1000 })).toBe(900)
    expect(precioParaSaldoCero({ precio_aprobado: null, precio_estimado: 1000 })).toBe(1000)
    expect(precioParaSaldoCero(null)).toBe(0)
  })
})

describe('leerSaldoCero', () => {
  function db(fallar: string | null, cobros: unknown[] = []) {
    return {
      from(tabla: string) {
        const res = fallar === tabla
          ? { data: null, error: { message: 'caído' } }
          : tabla === 'negocios'
            ? { data: { precio_aprobado: 1_000_000, precio_estimado: null }, error: null }
            : tabla === 'cobros'
              ? { data: cobros, error: null }
              : { data: null, error: null }
        const q: Record<string, unknown> = {}
        for (const m of ['select', 'eq']) q[m] = () => q
        q.maybeSingle = () => Promise.resolve(res)
        q.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok)
        return q
      },
    }
  }

  it('si no puede leer, retiene (falla cerrado)', async () => {
    for (const t of ['negocios', 'cobros', 'negocio_conciliacion']) {
      const r = await leerSaldoCero(db(t), { workspaceId: 'w', negocioId: 'n' })
      expect(r.ok).toBe(false)
    }
  })

  it('lee y calcula con los cobros que entraron', async () => {
    const r = await leerSaldoCero(db(null, [pago(1_000_000, { anulado_at: 'x' })]), { workspaceId: 'w', negocioId: 'n' })
    expect(r.ok && r.saldo.cubierto).toBe(false)
    const r2 = await leerSaldoCero(db(null, [pago(1_000_000)]), { workspaceId: 'w', negocioId: 'n' })
    expect(r2.ok && r2.saldo.cubierto).toBe(true)
  })
})
