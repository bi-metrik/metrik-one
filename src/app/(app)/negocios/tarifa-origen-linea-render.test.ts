/**
 * El origen de lo que muestra la línea dice la verdad (brief del 2026-10-21, punto 2): una línea
 * escrita a mano («Escríbelo a mano», con o sin costo) o costeada con el tarifario del proveedor
 * no dice «leída del pantallazo», ni pinta un «Pantallazo del proveedor · Leído: $0». La zona de
 * pegado queda como opción. La línea con pantallazo real sigue diciendo «leída del pantallazo».
 *
 * Datos ficticios. Se queda en `.ts`: el `include` de vitest es `src/**\/*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({
  leerCasillaDeItem: async () => ({ ok: true, mensaje: '', alertas: [] }),
  quitarCasillaDeItem: async () => ({ success: true }),
  confirmarMenorNoPaga: async () => ({ success: true }),
  actualizarComposicionDeItem: async () => ({ success: true }),
  confirmarTarifaPorPasajero: async () => ({ success: true }),
  corregirCampoDeFicha: async () => ({ success: true }),
  elegirMonedaDeTarifa: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/pantallazo-actions', () => ({
  descartarPropuestaDePantallazo: async () => ({ success: true }),
}))

const { default: TarifaPasajeroItem } = await import('./tarifa-pasajero-item')
const { ranuraPorSlug } = await import('@/lib/cotizaciones/ranuras-pantallazo')
const { MENSAJE_COSTO_PENDIENTE, monedaDeTarifa, origenDeMoneda, resolverTarifa } = await import('@/lib/cotizaciones/tarifa-pasajero')

const ACTIVIDAD = ranuraPorSlug('actividad_detalle')!
const DOS_ADULTOS = { adultos: 2, ninos: 0, infantes: 0 }

const lectura = (over: Record<string, unknown>) => ({
  moneda: 'COP',
  total: 0,
  aPagarAgencia: null,
  porTipo: [],
  ocupacion: { adultos: 2, ninos: 0, infantes: 0, total: 2 },
  ocupacionDelItem: false,
  identidad: {},
  notasCliente: [],
  alertas: [],
  campos: [{ label: 'Nombre', valor: 'Tour Ficticio de Bahía' }],
  nombre: 'Tour Ficticio de Bahía',
  descripcion: '',
  leidaEn: '2027-10-21T12:00:00Z',
  ...over,
})

/** «Escríbelo a mano» con «Todavía no tengo el costo»: sin precio, marcada costoPendiente. */
const A_MANO_SIN_COSTO = lectura({ origen: 'manual', costoPendiente: true })
/** La misma línea después de «Usar esta tarifa»: la casilla 1 la reemplaza la del tarifario. */
const DEL_TARIFARIO = lectura({
  origen: 'tarifario',
  total: 210000,
  porTipo: [{ tipo: 'adulto', cantidad: 2, subtotal: 210000 }],
  ocupacionDelItem: true,
  paraComposicion: DOS_ADULTOS,
  campos: [{ label: 'Nombre', valor: 'Tour Ficticio de Bahía' }, { label: 'Origen del precio', valor: 'Tarifa del proveedor Operador Ficticio, elegida en la cotización' }],
})
/** Una lectura de pantallazo de siempre (sin `origen`). */
const DE_PANTALLAZO = lectura({ total: 210000, porTipo: [{ tipo: 'adulto', cantidad: 2, subtotal: 210000 }] })

function pintar(primera: Record<string, unknown>) {
  return renderToStaticMarkup(
    React.createElement(TarifaPasajeroItem, {
      itemId: 'item-1',
      ranura: ACTIVIDAD,
      composicionViaje: DOS_ADULTOS,
      tarifaPax: { composicion: DOS_ADULTOS, casillas: { grupo_completo: primera } },
      costoUnitarioLinea: 0,
      onCambio: () => {},
    } as Parameters<typeof TarifaPasajeroItem>[0]),
  )
}

const visible = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
/** Lo visible menos las invitaciones a pegar uno: las únicas menciones de pantallazo permitidas. */
const sinInvitacion = (t: string) => t
  .replace('¿Tienes un pantallazo del proveedor? Pégalo aquí para reemplazar esto (Ctrl+V / Cmd+V)', '')
  .replace(MENSAJE_COSTO_PENDIENTE, '')

describe('la línea escrita a mano, sin costo todavía', () => {
  const t = visible(pintar(A_MANO_SIN_COSTO))
  it('dice que se escribió a mano: bloque, pasajeros y moneda', () => {
    expect(t).toContain('Escrita a mano')
    expect(t).toContain('Escrito a mano: sin costo todavía')
    expect(t).toContain('Esta línea cubre: 2 adultos · escrito a mano')
    expect(t).toContain('Moneda de la tarifa: COP · escrita a mano')
  })
  it('no simula un pantallazo leído', () => {
    expect(t).not.toContain('Pantallazo del proveedor')
    expect(t).not.toContain('Leído:')
    expect(t).not.toContain('$0')
    expect(sinInvitacion(t)).not.toMatch(/pantallazo/i)
  })
  it('pegar un pantallazo sigue como opción', () => {
    expect(t).toContain('¿Tienes un pantallazo del proveedor? Pégalo aquí para reemplazar esto')
  })
})

describe('la línea a mano, con la tarifa del proveedor ya usada', () => {
  const t = visible(pintar(DEL_TARIFARIO))
  it('dice que salió del tarifario del proveedor', () => {
    expect(t).toContain('Del tarifario del proveedor')
    expect(t).toContain('Tarifa del proveedor: $210.000 · 2 adultos')
    expect(t).toContain('Moneda de la tarifa: COP · del tarifario del proveedor')
  })
  it('ningún texto dice «pantallazo» salvo la invitación a pegar uno', () => {
    expect(t).not.toContain('Pantallazo del proveedor')
    expect(t).not.toContain('Leído:')
    expect(t).not.toContain('ocupación no visible en la imagen')
    expect(sinInvitacion(t)).not.toMatch(/pantallazo/i)
  })
})

describe('la línea con pantallazo real sigue igual', () => {
  const t = visible(pintar(DE_PANTALLAZO))
  it('dice «leída del pantallazo» y su bloque es el del pantallazo', () => {
    expect(t).toContain('Pantallazo de actividad · precio por pasajero')
    expect(t).toContain('Pantallazo del proveedor')
    expect(t).toContain('Leído: $210.000 · 2 adultos')
    expect(t).toContain('Esta línea cubre: 2 adultos · leído del pantallazo')
    expect(t).toContain('Moneda de la tarifa: COP · leída del pantallazo')
    expect(t).toContain('Pega otro pantallazo aquí para reemplazar este')
  })
})

describe('resolverTarifa nombra la fuente de la casilla 1 (lo lee también el servidor)', () => {
  const r = (l: Record<string, unknown>) => resolverTarifa(DOS_ADULTOS, { grupo_completo: l } as never, 'actividad_detalle')
  it('a mano o del tarifario, nunca «pantallazo»; de pantallazo, como siempre', () => {
    const tar = r(DEL_TARIFARIO)
    const pan = r(DE_PANTALLAZO)
    if (tar.estado !== 'resuelta' || pan.estado !== 'resuelta') throw new Error('debía resolver')
    expect(tar.mensaje).toMatch(/^La tarifa del proveedor ya trae el precio/)
    expect(tar.costos[0].deDonde).toMatch(/^Tarifa del proveedor: \$210\.000/)
    expect(pan.mensaje).toMatch(/^Este pantallazo ya trae el precio/)
    expect(pan.costos[0].deDonde).toMatch(/^Pantallazo 1: \$210\.000/)
    const mano = r({ ...DE_PANTALLAZO, origen: 'manual' })
    if (mano.estado !== 'resuelta') throw new Error('debía resolver')
    expect(mano.mensaje).toMatch(/^Lo escrito a mano ya trae el precio/)
    expect(mano.costos[0].deDonde).toMatch(/^Escrito a mano: /)
  })
})

describe('origenDeMoneda (lo usa también la tarjeta de costo)', () => {
  const de = (l: Record<string, unknown>) => origenDeMoneda(monedaDeTarifa({ casillas: { grupo_completo: l } } as never))
  it('dice la fuente de la lectura', () => {
    expect(de(DE_PANTALLAZO)).toBe('leída del pantallazo')
    expect(de(A_MANO_SIN_COSTO)).toBe('escrita a mano')
    expect(de(DEL_TARIFARIO)).toBe('del tarifario del proveedor')
  })
})
