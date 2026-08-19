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

describe('niegaCertificacionUpme — lo decide el servicio contratado', () => {
  it('solo_iva → niega', () => {
    expect(niegaCertificacionUpme({ servicio: 'solo_iva' })).toBe(true)
  })

  it('las otras dos ramas SÍ llevan certificación → NO niegan', () => {
    expect(niegaCertificacionUpme({ servicio: 'completo' })).toBe(false)
    expect(niegaCertificacionUpme({ servicio: 'solo_upme' })).toBe(false)
  })

  it('bloque sin responder → NO niega', () => {
    // Un bloque recién nacido no debe anular la tarifa de un negocio normal.
    expect(niegaCertificacionUpme({})).toBe(false)
    expect(niegaCertificacionUpme(null)).toBe(false)
  })

  it('el campo DERIVADO ya no decide: leerlo fue lo que costó plata', () => {
    // Cinco negocios llegaron con `requiere_certificacion_upme: false` puesto por un
    // relleno retroactivo, no por una respuesta. Dos SÍ habían contratado la
    // certificación y el sistema les anulaba la tarifa. Se lee la fuente, no el reflejo.
    expect(niegaCertificacionUpme({ requiere_certificacion_upme: false })).toBe(false)
    expect(niegaCertificacionUpme({ requiere_certificacion_upme: false, servicio: 'completo' })).toBe(false)
    expect(niegaCertificacionUpme({ requiere_certificacion_upme: true, servicio: 'solo_iva' })).toBe(true)
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
      [conf('a', { servicio: 'solo_iva' })],
    )
    expect(m.get('a') ?? 0).toBe(0)
  })

  it('el bloque de servicio sin responder no anula la tarifa', () => {
    const m = tarifaConfirmadaPorNegocio(
      [conf('a', { tarifa_confirmada: true, tarifa_upme_confirmada: 350906 })],
      [conf('a', {})],
    )
    expect(m.get('a')).toBe(350906)
  })
})
