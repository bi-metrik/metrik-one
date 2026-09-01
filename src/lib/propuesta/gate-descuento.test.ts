import { describe, it, expect } from 'vitest'
import { descuentoImplicito, motivoDescuentoRechazado } from './gate-descuento'

// Config viva de SOENA (linea GIT EV/HEV) al 2026-09-01.
const BASE = 850_000
const CFG = { cap: 100, umbral: 50 }

const gate = (honorario: number, role: string | null) =>
  motivoDescuentoRechazado({
    descuentoPct: descuentoImplicito(honorario, BASE),
    cap: CFG.cap,
    umbral: CFG.umbral,
    role,
    etiqueta: 'El valor corregido',
  })

describe('descuentoImplicito', () => {
  it('lee el descuento que un honorario implica contra la base', () => {
    expect(descuentoImplicito(637_500, BASE)).toBe(25)
    expect(descuentoImplicito(850_000, BASE)).toBe(0)
    expect(descuentoImplicito(425_000, BASE)).toBe(50)
  })

  it('sin base no hay descuento que medir — null, no cero', () => {
    // Cero haria pasar cualquier cifra como "sin descuento" y el gate no frenaria nada.
    expect(descuentoImplicito(100_000, 0)).toBeNull()
    expect(descuentoImplicito(100_000, NaN)).toBeNull()
  })

  it('un honorario sobre la base da descuento negativo, no lo recorta a cero', () => {
    expect(descuentoImplicito(1_000_000, BASE)).toBeLessThan(0)
  })

  it('conserva precision: el precio manda y el % es su lectura', () => {
    // 616.173 fue el valor real corregido en V0445 el 2026-08-31.
    expect(descuentoImplicito(616_173, BASE)).toBe(27.509059)
  })
})

describe('motivoDescuentoRechazado', () => {
  it('deja pasar un descuento bajo el umbral a cualquier rol de la lista de correccion', () => {
    expect(gate(637_500, 'comercial')).toBeNull()
  })

  it('frena el descuento sobre el umbral a quien no es gerencial', () => {
    // El hueco que cerro este cambio: 510.000 = 40% de descuento... bajo el umbral.
    expect(gate(510_000, 'comercial')).toBeNull()
    // 400.000 = 52,9%: pasa el umbral del 50%.
    expect(gate(400_000, 'comercial')).toContain('supervisor')
  })

  it('el mismo descuento pasa con rol gerencial', () => {
    for (const role of ['owner', 'admin', 'supervisor']) {
      expect(gate(400_000, role)).toBeNull()
    }
  })

  it('frena un honorario por encima de la tarifa base', () => {
    expect(gate(1_000_000, 'owner')).toContain('por encima de la tarifa base')
  })

  it('frena el descuento sobre el cap incluso al owner', () => {
    const r = motivoDescuentoRechazado({
      descuentoPct: descuentoImplicito(300_000, BASE),
      cap: 50,
      umbral: 50,
      role: 'owner',
      etiqueta: 'El valor corregido',
    })
    expect(r).toContain('supera el tope de la línea (50%)')
  })

  it('sin umbral configurado no hay gate de rol, solo el cap', () => {
    expect(motivoDescuentoRechazado({
      descuentoPct: 90, cap: 100, umbral: null, role: 'comercial', etiqueta: 'X',
    })).toBeNull()
  })

  it('sin base contra la cual medir no frena: es config faltante, no decision de precio', () => {
    expect(motivoDescuentoRechazado({
      descuentoPct: null, cap: 50, umbral: 20, role: 'comercial', etiqueta: 'X',
    })).toBeNull()
  })
})
