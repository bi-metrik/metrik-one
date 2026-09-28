/**
 * Ingreso manual en pantalla (brief del 2026-09-28): el enlace de la bandeja, el formulario, la
 * fila que deja en la bandeja y la opción ya aceptada en su tarjeta.
 *
 * Se queda en `.ts` por el `include` de vitest.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { lecturaManual, type HotelManual } from '@/lib/cotizaciones/ingreso-manual'
import { ranuraPorSlug } from '@/lib/cotizaciones/ranuras-pantallazo'
import { tarifaConHabitaciones } from '@/lib/cotizaciones/habitaciones'
import type { Borrador } from '@/lib/cotizaciones/proceso-captura'
import type { LecturaCasilla, TarifaPax } from '@/lib/cotizaciones/tarifa-pasajero'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }) }))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} }) }))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({ quitarHabitacion: async () => ({ success: true }) }))
vi.mock('@/app/(app)/negocios/adicional-actions', () => ({}))
vi.mock('@/app/(app)/negocios/ranura-actions', () => ({}))

const { default: BandejaCapturas, FilaCaptura } = await import('./bandeja-capturas')
const { default: IngresoManualForm, AYUDA_NETO, AYUDA_FUENTE, AYUDA_EDAD_NINO } = await import('./ingreso-manual-form')
const { default: TarjetaOpcion } = await import('./tarjeta-opcion')

const HOTEL = ranuraPorSlug('hotel_detalle')!
const GRUPO = { adultos: 4, ninos: 1, infantes: 0 }

function habitacion(over: Partial<HotelManual> = {}): LecturaCasilla {
  const r = lecturaManual({
    ranura: HOTEL,
    entrada: {
      tipo: 'hotel',
      datos: {
        hotel: 'Hotel Verdemar', ciudad: 'San Andrés', entrada: '2026-11-23', salida: '2026-11-26',
        habitacion: 'Doble estándar', regimen: 'Desayuno y cena', incluye: 'Traslado aeropuerto – hotel',
        adultos: 2, ninos: 0, infantes: 0, netoAdulto: 279_000, netoNino: 223_000, netoInfante: 0,
        edadDesde: 2, edadHasta: 11, fuente: 'Portafolio Verdemar 2026', ...over,
      },
    },
    leidaEn: '2026-09-28T15:00:00Z',
    hoy: '2026-09-28',
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errores))
  return r.lectura
}

const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('la bandeja ofrece el ingreso manual', () => {
  it('«Ingresar a mano» al lado de los pantallazos', () => {
    const html = renderToStaticMarkup(React.createElement(BandejaCapturas, { cotizacionId: 'c1', items: [], composicion: GRUPO }))
    expect(texto(html)).toContain('¿La tarifa viene de un portafolio o por teléfono? Ingresar a mano')
    expect(html).toContain('data-abrir-ingreso-manual')
  })
})

describe('el formulario', () => {
  const pintar = () => renderToStaticMarkup(React.createElement(IngresoManualForm, {
    composicion: GRUPO, onEnviar: async () => ({ ok: true as const }), onCerrar: () => {},
  }))

  it('hotel por habitación: los campos del brief, con el régimen siempre a la vista', () => {
    const t = texto(pintar())
    for (const r of ['Hotel', 'Ciudad', 'Fuente de la tarifa', 'Check-in', 'Check-out', 'Habitación', 'Régimen', 'Qué más incluye',
      'Adultos', 'Niños', 'Infantes', 'Adulto', 'Niño', 'Infante', 'Desde (años)', 'Hasta (años)']) {
      expect(t).toContain(r)
    }
    expect(t).toContain('Pasajeros de la habitación')
    expect(t).toContain('Costo neto por persona por noche')
    expect(t).toContain('Una habitación a la vez. ONE multiplica por noches y pasajeros.')
    // «Acomodación» en el documento es la ocupación («Acomodación: 2 adultos»): aquí no.
    expect(t).not.toContain('Acomodación')
  })

  it('la fuente va al final y dice que es interna; lo que incluye dice que sale al cliente', () => {
    const t = texto(pintar())
    expect(t.indexOf('Fuente de la tarifa')).toBeGreaterThan(t.indexOf('Hasta (años)'))
    expect(t).toContain(AYUDA_FUENTE)
    expect(t).toContain('Sale en la cotización del cliente.')
    expect(t).toContain('Edad de niño según el hotel (opcional)')
    expect(t).toContain(AYUDA_EDAD_NINO)
  })

  it('montos y pasajeros: texto con teclado numérico, sin type=number ni cifras de ejemplo', () => {
    const html = pintar()
    expect(html).not.toContain('type="number"')
    for (const k of ['adultos', 'ninos', 'infantes', 'netoAdulto', 'netoNino', 'netoInfante', 'edadDesde', 'edadHasta']) {
      const input = html.match(new RegExp(`<input[^>]*data-campo-manual="${k}"[^>]*>`))?.[0] ?? ''
      expect(input, k).toContain('inputMode="numeric"')
      expect(input, k).toContain('tabular-nums')
    }
    expect(html).not.toContain('279.000')
    expect(html).not.toContain('223.000')
  })

  it('un solo botón negro: el tipo elegido va con el acento, no con el primario', () => {
    const html = pintar()
    expect(html.match(/bg-\[#191713\]/g)?.length).toBe(1)
    expect(html).toMatch(/aria-pressed="true"[^>]*bg-\[#EAF1EE\]|bg-\[#EAF1EE\][^>]*aria-pressed="true"/)
  })

  it('⚠️ el rótulo del costo dice que es lo que cobra el proveedor: el margen lo pone ONE', () => {
    expect(AYUDA_NETO).toBe('Lo que te cobra el proveedor, sin sumarle nada. El margen lo pone ONE.')
    expect(texto(pintar())).toContain(AYUDA_NETO)
  })

  it('no pide cancelación: esa es la condición del proveedor y el cliente no la ve', () => {
    expect(texto(pintar())).not.toMatch(/Cancelaci/)
  })
})

describe('la fila que deja en la bandeja', () => {
  it('se revisa y se acepta como un pantallazo, sin miniatura de imagen', () => {
    const l = habitacion()
    const borrador = { tipo: 'hotel', lectura: l, lecturaJson: JSON.stringify(l), firma: 'f', pistas: { lugar: 'San Andrés', origen: null, destino: null } } as unknown as Borrador
    const html = renderToStaticMarkup(React.createElement(FilaCaptura, {
      captura: {
        id: 'cap-m', preview: '', dataUrl: '', estado: { fase: 'lista', alertas: l.alertas }, tipo: 'hotel', pistas: borrador.pistas,
        borrador, itemId: null, donde: 'Hotel en San Andrés · nuevo', leida: null, error: null,
      },
    }))
    expect(html).toContain('data-miniatura-manual')
    expect(html).toContain('aria-label="Ingresado a mano, sin pantallazo"')
    expect(texto(html)).not.toMatch(/pantallazo/i)
    expect(html).not.toContain('data-miniatura=')
    expect(texto(html)).toContain('Hotel Verdemar · Doble estándar · 2 adultos')
    expect(html).toMatch(/>Aceptar</)
    // Sin alertas de «la captura no muestra…».
    expect(html).not.toContain('data-alerta-decision')
  })
})

describe('la fila manual no habla de «pantallazo»', () => {
  const l = habitacion()
  const borrador = { tipo: 'hotel', lectura: l, lecturaJson: JSON.stringify(l), firma: 'f', pistas: { lugar: 'San Andrés', origen: null, destino: null } } as unknown as Borrador
  const fila = (estado: Record<string, unknown>) => renderToStaticMarkup(React.createElement(FilaCaptura, {
    captura: {
      id: 'cap-m', preview: '', dataUrl: '', estado, tipo: 'hotel', pistas: borrador.pistas,
      borrador, itemId: null, donde: null, leida: null, error: null,
    },
  } as unknown as Parameters<typeof FilaCaptura>[0]))

  it('la × dice «Quitar esta tarifa»', () => {
    expect(fila({ fase: 'leyendo' })).toContain('aria-label="Quitar esta tarifa"')
  })

  it('quitada: «Quitaste esta tarifa»', () => {
    expect(texto(fila({ fase: 'borrada', antes: { fase: 'lista', alertas: [] } }))).toContain('Quitaste esta tarifa. No entró a la cotización.')
  })
})

describe('la opción aceptada, en su tarjeta', () => {
  function pintar(tarifa: TarifaPax, extra: Record<string, unknown> = {}) {
    return renderToStaticMarkup(React.createElement(TarjetaOpcion, {
      itemId: 'item-1', numero: 1, item: { nombre: 'HOTEL VERDEMAR', grupo: 'hotel', tarifa_pax: tarifa }, tarifa,
      composicionViaje: GRUPO, editable: true, abierta: true, onAlternar: () => {}, precioOpcion: 3_000_000,
      precioLinea: 3_000_000, costoLinea: 2_500_000, confirmada: null, margenAplicado: 15, convencion: 'sobre_venta',
      administrativosPct: 0, pisoPct: 5, adicionales: [], adicionalesDisponible: true,
      margenCotizacion: { margenPct: 15, convencion: 'sobre_venta' }, pendiente: null, onIrABandeja: () => {},
      onEliminar: () => {}, onMover: () => {}, mover: null, respaldo: null, nota: null, bloqueTitulo: 'Hotel en San Andrés',
      onGuardarNota: () => {}, onCambio: () => {}, ...extra,
    }))
  }
  const tarifa = () => tarifaConHabitaciones({}, [
    { id: 'h1', lectura: habitacion() },
    { id: 'h2', lectura: habitacion({ ninos: 1 }) },
  ], GRUPO)

  it('cada habitación dice que fue a mano y de dónde salió la tarifa; la ficha interna también', () => {
    const html = pintar(tarifa())
    expect(html.match(/data-habitacion-manual/g)?.length).toBe(2)
    const ficha = html.slice(html.indexOf('data-ficha'), html.indexOf('</dl>', html.indexOf('data-ficha')))
    expect(texto(ficha)).toContain('Ingresado a mano Portafolio Verdemar 2026')
  })

  it('«Así lo ve el cliente»: la tarifa niño y lo que incluye, nunca la fuente', () => {
    const html = pintar(tarifa())
    const hoja = texto(html.slice(html.indexOf('data-hoja-cliente')))
    expect(hoja).toContain('Tarifa niño de 2 a 11 años cumplidos a la fecha del viaje')
    expect(hoja).toContain('Incluye: Traslado aeropuerto – hotel')
    expect(hoja).toContain('Desayuno y cena')
    expect(hoja).not.toContain('Portafolio')
  })
})
