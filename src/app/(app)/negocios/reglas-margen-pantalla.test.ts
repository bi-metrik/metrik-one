/**
 * Las reglas de margen en la pantalla de la cotización por pasos (brief del 2026-10-27): la
 * tarjeta de cada opción (colchón del vuelo, descuento del hotel, comisión de la Pública) y el paso
 * «Tarifas» (margen de hoteles, puntos extra, descuentos sobre el total, margen global y la
 * autorización). Las cifras salen de la cascada REAL sobre un viaje ficticio
 * (`test/caso-reglas-margen.ts`). Con `CAPTURAS_HTML=<carpeta>` deja el HTML de cada estado para las
 * capturas del PR.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { calcularCascada, type LineaCalculada } from '@/lib/cotizaciones/totales'
import { paramsPorOpcion } from '@/lib/cotizaciones/reglas-margen'
import { preciosDeLasOpciones, tarifasCalculadas } from '@/lib/cotizaciones/por-pasos-vista'
import { lineasDelCaso, NOMBRES_DEL_CASO, paramsDelCaso, TARIFAS_DEL_CASO } from '../../../../test/caso-reglas-margen'

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} }) }))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({
  ajustarOpcion: async () => ({ success: true }),
  elegirMonedaDeTarifa: async () => ({ success: true }),
  confirmarTarifaPorPasajero: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/adicional-actions', () => ({
  agregarAdicional: async () => ({ success: true }),
  actualizarAdicional: async () => ({ success: true }),
  eliminarAdicional: async () => ({ success: true }),
}))

const { default: TarjetaCosto } = await import('./tarjeta-costo')
const { TarifasPorPasos } = await import('./por-pasos/tarifas-por-pasos')
type PropsTarjeta = React.ComponentProps<typeof TarjetaCosto>

const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
function volcar(nombre: string, html: string) {
  const dir = process.env.CAPTURAS_HTML
  if (dir) writeFileSync(path.join(dir, `${nombre}.html`), html)
}

/** La tarjeta de una opción, con lo que la cascada por opción dice de ella. */
function tarjeta(id: string, descuento: 3 | 7 = 3) {
  const lineas = lineasDelCaso(descuento)
  const params = paramsDelCaso()
  const l = calcularCascada(lineas, paramsPorOpcion(params)).lineas.find(x => x.id === id) as LineaCalculada
  const item = lineas.find(x => x.id === id)!
  const tarifa = (item.tarifa_pax ?? {}) as { descuentoCliente?: never; tipoTarifa?: { tipo: 'neta' | 'publica'; comisionPct?: number } }
  const props: PropsTarjeta = {
    itemId: id,
    editable: true,
    confirmada: null,
    preciosAMano: undefined,
    precioLinea: l.precioLinea,
    costoLinea: l.costoLinea,
    margenAplicado: l.margenAplicado,
    convencion: 'sobre_venta',
    administrativosPct: 0,
    pisoPct: l.reglas?.tipo === 'hotel' ? params.reglas!.politica.pisoHotelPct : 0,
    adicionales: [],
    adicionalesDisponible: true,
    margenCotizacion: { margenPct: 15, convencion: 'sobre_venta' },
    moneda: { moneda: 'COP', asumida: false, origen: 'captura', leida: 'COP', decision: null } as never,
    onCambio: () => {},
    apilable: true,
    tipoTarifa: tarifa.tipoTarifa?.tipo ?? 'neta',
    reglas: { linea: l.reglas!, descuento: tarifa.descuentoCliente ?? null, comisionPct: tarifa.tipoTarifa?.comisionPct ?? null },
  }
  return renderToStaticMarkup(React.createElement(TarjetaCosto, props))
}

function tarifas(descuento: 3 | 7) {
  const lineas = lineasDelCaso(descuento)
  const params = paramsDelCaso()
  const calculadas = tarifasCalculadas(lineas, params, TARIFAS_DEL_CASO)
  const precios = preciosDeLasOpciones(lineas, params)
  return renderToStaticMarkup(React.createElement(TarifasPorPasos, {
    tarifas: calculadas,
    servicios: [{ grupo: 'hotel', tipo: 'hotel', nombre: 'Hotel en San Andrés', opciones: ['h-eco', 'h-rec', 'h-pre'], estado: 'incluido', lugar: 'San Andrés', fecha: null, candidatas: ['h-eco', 'h-rec', 'h-pre'] }],
    iguales: [], opcionales: [], noVan: [],
    nombreDeOpcion: (id: string) => NOMBRES_DEL_CASO[id] ?? id,
    detalleDeOpcion: () => null,
    precioDeOpcion: (id: string) => precios.get(id)?.precio ?? 0,
    margenPct: 15, pisoPct: 12, avisoPct: 12,
    editable: true, ocupado: false,
    autorizacion: { bloquea: true, dueno: 'Gerente', esDueno: false, vigente: null, perdida: false, pedido: null, disponible: true },
    verElCalculo: null, rastro: null,
    onElegir: () => {}, onMandar: () => {}, onMargen: () => {}, onPedir: () => {}, onAutorizar: () => {}, onRetirar: () => {},
    onReponer: () => {}, onVerEnElViaje: () => {}, onRenombrar: () => {}, onEliminarTarifa: () => {}, onMotivo: () => {}, onSeguir: () => {},
    reglas: { puntosExtra: 5, puntosMax: 5, descuentos: params.reglas!.descuentos, pisoHotelPct: 10 },
    onPuntos: () => {}, onDescuentos: () => {},
  }))
}

describe('la tarjeta de cada opción', () => {
  it('vuelo: el colchón por tiquete es su margen', () => {
    const html = tarjeta('v-ida')
    volcar('colchon-vuelo', html)
    expect(texto(html)).toContain('Colchón $60.000 por tiquete · 2 tiquetes · vuelo nacional = $120.000')
    expect(html).toContain('data-colchon-vuelo')
  })

  it('hotel con 3 de descuento: el cliente lo ve, queda en 12 % y no pide autorización', () => {
    const html = tarjeta('h-rec', 3)
    volcar('descuento-hotel', html)
    const t = texto(html)
    expect(t).toContain('Descuento para el cliente · Reserva esta semana')
    expect(t).toContain('Antes $4.000.000')
    expect(t).toMatch(/Margen 12(,0)? %/)
    expect(t).not.toContain('Con este margen necesitas autorización')
  })

  it('hotel con 7 de descuento: queda en 8 % y pide autorización', () => {
    const html = tarjeta('h-rec', 7)
    expect(texto(html)).toMatch(/Margen 8(,0)? %/)
    expect(html).toContain('Con este margen necesitas autorización')
  })

  it('Pública: la comisión entra al margen global', () => {
    const html = tarjeta('a-tour')
    expect(html).toContain('data-comision-publica')
    expect(html).toContain('value="15"')
    expect(texto(html)).toContain('Entra al margen global con su comisión de 15 %')
  })

  it('un plan nuevo nace en 0 % y no muestra nada de reglas', () => {
    const html = tarjeta('a-lancha')
    expect(texto(html)).toMatch(/Margen 0 %/)
    expect(html).not.toContain('data-descuento-hotel')
  })
})

describe('el paso «Tarifas» con reglas', () => {
  it('margen de hoteles, puntos extra, descuentos sobre el total y el margen global, sin autorización', () => {
    const html = tarifas(3)
    volcar('tarifas-sin-aprobacion', html)
    const t = texto(html)
    expect(t).toContain('Margen de hoteles')
    expect(t).toContain('Puntos extra')
    expect(html).toContain('value="5"')
    expect(t).toContain('Cliente recurrente 2 %')
    expect(t).toContain('Margen global (no se edita)')
    expect(html).not.toContain('data-autorizacion')
  })

  it('con 7 de descuento en el hotel de la Recomendada, pide la autorización y dice por qué', () => {
    const html = tarifas(7)
    volcar('tarifas-con-aprobacion', html)
    const t = texto(html)
    expect(html).toContain('data-autorizacion')
    expect(t).toContain('Recomendada · Bajo el mínimo')
    expect(t).toMatch(/Hotel Ficticio Coral con su descuento queda al 8(,0)? % \(mínimo de hotel 10 %\)/)
    expect(t).toContain('Pedir autorización a Gerente')
  })
})
