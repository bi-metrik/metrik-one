import { describe, it, expect } from 'vitest'
import {
  tarifaConfirmadaDeData,
  niegaCertificacionUpme,
  tarifaConfirmadaPorNegocio,
  type FilaBloqueTarifa,
} from './modelo-dinero'

// Estas pruebas fijan el CONTRATO del resolvedor en lote contra el resolvedor por
// negocio (`leerModeloDineroCompleto`): mismas tres reglas, o el panel de conciliación
// juzga con una tarifa distinta a la del gate y vuelve el descuadre de siempre.

describe('tarifaConfirmadaDeData — solo la tarifa CONFIRMADA cuenta', () => {
  it('toggle marcado + valor > 0 → esa tarifa', () => {
    expect(tarifaConfirmadaDeData({ tarifa_confirmada: true, tarifa_upme_confirmada: 350906 })).toBe(350906)
  })

  it('valor presente pero SIN el toggle → 0 (la referencia no es la confirmación)', () => {
    // Caso real en producción (V0082, V0101): el bloque trae el número calculado y
    // nadie lo confirmó todavía. Tomarlo inflaría el valor a recaudar.
    expect(tarifaConfirmadaDeData({ tarifa_upme_confirmada: 701812 })).toBe(0)
  })

  it('toggle marcado con valor 0 o negativo → 0', () => {
    expect(tarifaConfirmadaDeData({ tarifa_confirmada: true, tarifa_upme_confirmada: 0 })).toBe(0)
    expect(tarifaConfirmadaDeData({ tarifa_confirmada: true, tarifa_upme_confirmada: -5 })).toBe(0)
  })

  it('valor en texto sucio o ausente → 0, nunca NaN', () => {
    expect(tarifaConfirmadaDeData({ tarifa_confirmada: true, tarifa_upme_confirmada: 'no' })).toBe(0)
    expect(tarifaConfirmadaDeData({ tarifa_confirmada: true })).toBe(0)
    expect(tarifaConfirmadaDeData(null)).toBe(0)
  })

  it('acepta el número como string (jsonb puede traerlo así)', () => {
    expect(tarifaConfirmadaDeData({ tarifa_confirmada: true, tarifa_upme_confirmada: '350906' })).toBe(350906)
  })
})

describe('niegaCertificacionUpme — el campo tiene que existir y estar en false', () => {
  it('declarado en false → niega', () => {
    expect(niegaCertificacionUpme({ requiere_certificacion_upme: false })).toBe(true)
  })

  it('bloque sin tocar (campo ausente) → NO niega', () => {
    // Un bloque recién nacido no debe anular la tarifa de un negocio normal.
    expect(niegaCertificacionUpme({})).toBe(false)
    expect(niegaCertificacionUpme(null)).toBe(false)
  })

  it('declarado en true → NO niega', () => {
    expect(niegaCertificacionUpme({ requiere_certificacion_upme: true })).toBe(false)
  })
})

describe('tarifaConfirmadaPorNegocio — resolución en lote', () => {
  const conf = (negocio_id: string, data: Record<string, unknown> | null): FilaBloqueTarifa => ({ negocio_id, data })

  it('mapea cada negocio a su tarifa confirmada', () => {
    const m = tarifaConfirmadaPorNegocio(
      [
        conf('a', { tarifa_confirmada: true, tarifa_upme_confirmada: 350906 }),
        conf('b', { tarifa_confirmada: true, tarifa_upme_confirmada: 701812 }),
      ],
      [],
    )
    expect(m.get('a')).toBe(350906)
    expect(m.get('b')).toBe(701812)
  })

  it('negocio sin bloque de confirmación → sin entrada (el caller lee 0)', () => {
    const m = tarifaConfirmadaPorNegocio([], [])
    expect(m.get('a')).toBeUndefined()
  })

  it('varias filas del mismo negocio → gana la confirmada, no la vacía', () => {
    // Las copias readonly heredadas viajan con el bloque entre etapas: el orden de
    // llegada no puede decidir el resultado.
    const m = tarifaConfirmadaPorNegocio(
      [
        conf('a', { tarifa_upme_ref: 999999 }),
        conf('a', { tarifa_confirmada: true, tarifa_upme_confirmada: 350906 }),
      ],
      [],
    )
    expect(m.get('a')).toBe(350906)

    const invertido = tarifaConfirmadaPorNegocio(
      [
        conf('a', { tarifa_confirmada: true, tarifa_upme_confirmada: 350906 }),
        conf('a', { tarifa_upme_ref: 999999 }),
      ],
      [],
    )
    expect(invertido.get('a')).toBe(350906)
  })

  it('el negocio que NO contrató la certificación queda sin tarifa', () => {
    // Sin este corte, un negocio que solo compró la gestión de IVA arrastraría una
    // tarifa que no le corresponde y su sobrepago real quedaría escondido.
    const m = tarifaConfirmadaPorNegocio(
      [conf('a', { tarifa_confirmada: true, tarifa_upme_confirmada: 350906 })],
      [conf('a', { requiere_certificacion_upme: false })],
    )
    expect(m.get('a') ?? 0).toBe(0)
  })

  it('el bloque de certificación sin tocar no anula la tarifa', () => {
    const m = tarifaConfirmadaPorNegocio(
      [conf('a', { tarifa_confirmada: true, tarifa_upme_confirmada: 350906 })],
      [conf('a', {})],
    )
    expect(m.get('a')).toBe(350906)
  })
})
