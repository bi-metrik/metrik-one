/**
 * Ingreso manual en pantalla (brief del 2026-09-28): el enlace de la bandeja, el formulario, la
 * fila que deja en la bandeja y la opción ya aceptada en su tarjeta.
 *
 * Se queda en `.ts` por el `include` de vitest.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { lecturaManual, type HotelManual, type TrasladoManual } from '@/lib/cotizaciones/ingreso-manual'
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
const {
  default: IngresoManualForm, AYUDA_NETO, AYUDA_FUENTE, AYUDA_EDAD_NINO,
  PREGUNTA_PRECIO_TRASLADO, OPCION_POR_TRAYECTO, OPCION_IN_OUT, valorEscrito,
} = await import('./ingreso-manual-form')
const { BTN, BTN_ELEGIDO } = await import('@/components/viaje/estilo')
const { default: TarjetaOpcion } = await import('./tarjeta-opcion')

const HOTEL = ranuraPorSlug('hotel_detalle')!
const TRASLADO = ranuraPorSlug('traslado_detalle')!
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

/** El traslado de la prueba del 2026-09-28 (COT-2026-0017): 2 adultos + 1 infante. */
function trasladoManual(over: Partial<TrasladoManual> = {}): LecturaCasilla {
  const r = lecturaManual({
    ranura: TRASLADO,
    entrada: {
      tipo: 'traslado',
      datos: {
        ruta: 'Aeropuerto – hotel', fecha: '2026-11-09', adultos: 2, ninos: 0, infantes: 1, cobro: 'por_persona', precio: 'por_trayecto',
        neto: 45_000, netoNino: null, netoInfante: null, idaYRegreso: true, fuente: 'Portafolio Dolphins 2026', ...over,
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

  // Brief del 2026-10-01, punto 6: el elegido «apenas se distingue». Era `${BTN} border-[#0E5C43]
  // bg-[#EAF1EE] text-[#0E5C43]`, y en el CSS ganaban el borde gris y la tinta negra de `BTN`.
  it('el tipo elegido se distingue: acento y tinte, sin los colores de `BTN` compitiendo', () => {
    for (const tipo of ['hotel', 'traslado'] as const) {
      const html = renderToStaticMarkup(React.createElement(IngresoManualForm, {
        composicion: GRUPO, onEnviar: async () => ({ ok: true as const }), onCerrar: () => {}, tipoInicial: tipo,
      }))
      const elegido = html.match(/<button[^>]*aria-pressed="true"[^>]*>/)?.[0] ?? ''
      expect(elegido).toContain(`class="${BTN_ELEGIDO}"`)
      for (const gris of ['bg-white', 'border-[#CFCAC0]', 'text-[#191713]']) expect(elegido, gris).not.toContain(gris)
      const otro = html.match(/<button[^>]*aria-pressed="false"[^>]*>/)?.[0] ?? ''
      expect(otro).toContain(`class="${BTN}"`)
    }
  })

  // Brief del 2026-10-01, punto 7.
  it('los montos se ven con punto de miles al escribir; las cantidades y el texto no', () => {
    for (const k of ['netoAdulto', 'netoNino', 'netoInfante', 'neto']) expect(valorEscrito(k, '280000'), k).toBe('280.000')
    for (const k of ['adultos', 'edadDesde', 'hotel', 'fuente']) expect(valorEscrito(k, '1000'), k).toBe('1000')
  })

  it('⚠️ el rótulo del costo dice que es lo que cobra el proveedor: el margen lo pone ONE', () => {
    expect(AYUDA_NETO).toBe('Lo que te cobra el proveedor, sin sumarle nada. El margen lo pone ONE.')
    expect(texto(pintar())).toContain(AYUDA_NETO)
  })

  it('traslado por persona: adulto, niño e infante, como el hotel (el infante vacío es 0)', () => {
    const html = renderToStaticMarkup(React.createElement(IngresoManualForm, {
      composicion: { adultos: 2, ninos: 0, infantes: 1 }, onEnviar: async () => ({ ok: true as const }), onCerrar: () => {}, tipoInicial: 'traslado',
    }))
    expect(texto(html)).toContain('Costo neto por trayecto')
    for (const k of ['neto', 'netoNino', 'netoInfante']) {
      const input = html.match(new RegExp(`<input[^>]*data-campo-manual="${k}"[^>]*>`))?.[0] ?? ''
      expect(input, k).toContain('inputMode="numeric"')
    }
    expect(html.match(/<input[^>]*data-campo-manual="netoInfante"[^>]*>/)?.[0]).toContain('placeholder="0"')
  })

  // Brief del 2026-09-30: «Ida y regreso» marcado por defecto convertía un in-out de 45.000
  // en 90.000. Ahora se pregunta cómo viene el precio, sin respuesta marcada.
  it('traslado: pregunta cómo viene el precio, sin opción marcada', () => {
    const html = renderToStaticMarkup(React.createElement(IngresoManualForm, {
      composicion: { adultos: 2, ninos: 0, infantes: 0 }, onEnviar: async () => ({ ok: true as const }), onCerrar: () => {}, tipoInicial: 'traslado',
    }))
    const t = texto(html)
    expect(t).toContain(PREGUNTA_PRECIO_TRASLADO)
    expect(t).toContain(OPCION_POR_TRAYECTO)
    expect(t).toContain(OPCION_IN_OUT)
    const bloque = html.match(/data-campo-manual="precio"[\s\S]*?<\/div>/)?.[0] ?? ''
    expect(bloque).toContain('type="radio"')
    expect(bloque).not.toContain('checked')
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

  it('la moneda del hotel a mano dice «ingresada a mano» (las lecturas viven en las habitaciones)', () => {
    const t = texto(pintar(tarifa()))
    expect(t).toContain('COP · ingresada a mano')
    expect(t).not.toContain('leída del pantallazo')
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

describe('el traslado a mano, en su tarjeta', () => {
  function pintar(lectura: LecturaCasilla, extra: Record<string, unknown> = {}) {
    const tarifa: TarifaPax = { casillas: { grupo_completo: lectura }, composicion: { adultos: 2, ninos: 0, infantes: 1 } }
    return renderToStaticMarkup(React.createElement(TarjetaOpcion, {
      itemId: 'item-t', numero: 1, item: { nombre: 'Traslado aeropuerto – hotel', grupo: 'traslado', tarifa_pax: tarifa }, tarifa,
      composicionViaje: { adultos: 2, ninos: 0, infantes: 1 }, editable: true, abierta: true, onAlternar: () => {},
      precioOpcion: 211_765, precioLinea: 211_765, costoLinea: 180_000, confirmada: null, margenAplicado: 15,
      convencion: 'sobre_venta', administrativosPct: 0, pisoPct: 5, adicionales: [], adicionalesDisponible: true,
      margenCotizacion: { margenPct: 15, convencion: 'sobre_venta' }, pendiente: null, onIrABandeja: () => {},
      onEliminar: () => {}, onMover: () => {}, mover: null, respaldo: null, nota: 'NOTA-DEL-TRASLADO',
      bloqueTitulo: 'Traslados', onGuardarNota: () => {}, onCambio: () => {}, ...extra,
    }))
  }

  it('tiene «Así lo ve el cliente», como el hotel: la línea de «Inversión» del documento', () => {
    const html = pintar(trasladoManual())
    expect(html).toContain('data-hoja-cliente')
    expect(html.indexOf('data-hoja-cliente')).toBeGreaterThan(html.indexOf('aria-label="Costo y precio"'))
    const hoja = texto(html.slice(html.indexOf('data-hoja-cliente')))
    expect(hoja).toContain('TRASLADOS')
    expect(hoja).toContain('OPCIÓN 1')
    expect(hoja).toContain('Traslado aeropuerto – hotel')
    expect(hoja).toContain('INVERSIÓN')
    expect(hoja).toContain('Así sale esta opción en la cotización que recibe el cliente.')
    // La fuente es interna; la nota del traslado se sigue escribiendo aparte.
    expect(hoja).not.toContain('Dolphins')
    expect(texto(html)).toContain('NOTA-DEL-TRASLADO')
  })

  it('los adicionales salen como «Incluye: …», igual que en la línea del PDF', () => {
    const html = pintar(trasladoManual(), {
      adicionales: [{ id: 'a1', item_id: 'item-t', codigo: 'otro', nombre: 'Silla de bebé', cantidad: 1, costo: 10_000, precio: 12_000, moneda: 'COP' }],
    })
    expect(texto(html.slice(html.indexOf('data-hoja-cliente')))).toContain('Incluye: Silla de bebé')
  })

  it('bajo «Costo y precio» la moneda dice que se ingresó a mano, no que se leyó del pantallazo', () => {
    const t = texto(pintar(trasladoManual()))
    expect(t).toContain('COP · ingresada a mano')
    expect(t).not.toContain('leída del pantallazo')
  })
})
