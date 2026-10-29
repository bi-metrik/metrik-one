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
import { cascadaDelTotal, margenDelEncabezado, preciosDeLasOpciones, tarifasCalculadas, type LineaDeCascada, type TarifaDeLaPantalla } from '@/lib/cotizaciones/por-pasos-vista'
import { exentaDelMinimo } from '@/lib/cotizaciones/itinerarios'
import type { ParametrosCascada } from '@/lib/cotizaciones/totales'
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

function tarifas(descuento: 3 | 7, opciones: { params?: ParametrosCascada; tarifas?: TarifaDeLaPantalla[]; pisoPct?: number; lineas?: LineaDeCascada[] } = {}) {
  const lineas = opciones.lineas ?? lineasDelCaso(descuento)
  const params = opciones.params ?? paramsDelCaso()
  const pantalla = opciones.tarifas ?? TARIFAS_DEL_CASO
  const calculadas = tarifasCalculadas(lineas, params, pantalla)
  const precios = preciosDeLasOpciones(lineas, params)
  // Lo que la vista le pasa: el total de la cotización, con la misma cifra que el encabezado.
  const total = cascadaDelTotal(lineas, params, pantalla)
  const delTotal = { margenPct: margenDelEncabezado(total, params), exenta: exentaDelMinimo(total), hotelesBajoPiso: total.reglas?.hotelesBajoPiso ?? [] }
  return renderToStaticMarkup(React.createElement(TarifasPorPasos, {
    tarifas: calculadas,
    servicios: [{ grupo: 'hotel', tipo: 'hotel', nombre: 'Hotel en San Andrés', opciones: ['h-eco', 'h-rec', 'h-pre'], estado: 'incluido', lugar: 'San Andrés', fecha: null, candidatas: ['h-eco', 'h-rec', 'h-pre'] }],
    iguales: [], opcionales: [], noVan: [],
    nombreDeOpcion: (id: string) => NOMBRES_DEL_CASO[id] ?? id,
    detalleDeOpcion: () => null,
    precioDeOpcion: (id: string) => precios.get(id)?.precio ?? 0,
    margenPct: 15, pisoPct: opciones.pisoPct ?? 12, avisoPct: opciones.pisoPct ?? 12,
    editable: true, ocupado: false,
    autorizacion: { bloquea: true, dueno: 'Gerente', esDueno: false, vigente: null, perdida: false, pedido: null, disponible: true },
    verElCalculo: null, rastro: null,
    onElegir: () => {}, onMandar: () => {}, onMargen: () => {}, onPedir: () => {}, onAutorizar: () => {}, onRetirar: () => {},
    onReponer: () => {}, onVerEnElViaje: () => {}, onRenombrar: () => {}, onEliminarTarifa: () => {}, onMotivo: () => {}, onSeguir: () => {},
    reglas: { puntosExtra: params.reglas!.puntosExtra, puntosMax: 5, descuentos: params.reglas!.descuentos, pisoHotelPct: 10 },
    onPuntos: () => {}, onDescuentos: () => {},
    delTotal,
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
    expect(t).toMatch(/Hotel Ficticio Coral \(recomendada\) queda en 8 %, mínimo 10 %/)
    expect(t).toContain('Pedir autorización a Gerente')
  })
})

// ── Brief del 2026-10-28 · dos fallas de pantalla ─────────────────────────────

/** Como lo escribe el encabezado (`lo-que-suma.tsx › margenTexto`). */
const comoEncabezado = (m: number) => `${String(Math.round(m * 10) / 10).replace('.', ',')} %`
/** Lo que dice el rótulo «Margen global (no se edita):», sin etiquetas. */
function rotulo(html: string) {
  const desde = html.indexOf('data-margenes-reales')
  return texto(html.slice(html.indexOf('>', desde) + 1, html.indexOf('</p>', desde)))
}
/** El encabezado del paso: el margen del total, el que pinta `LoQueSuma`. */
function encabezado(lineas: LineaDeCascada[], params: ParametrosCascada, pantalla: TarifaDeLaPantalla[]) {
  return comoEncabezado(margenDelEncabezado(cascadaDelTotal(lineas, params, pantalla), params) as number)
}

describe('falla 1 · el margen global en «Tarifas» lleva cifra y es la del encabezado', () => {
  const casos: [string, Parameters<typeof paramsDelCaso>[0]][] = [
    ['0 puntos extra', { puntosExtra: 0 }],
    ['3 puntos extra', { puntosExtra: 3 }],
    ['5 puntos extra', { puntosExtra: 5 }],
    ['5 puntos y un descuento sobre el total', { puntosExtra: 5, descuentos: [{ id: 'd1', descripcion: 'Cliente recurrente', pct: 4 }] }],
  ]

  for (const [nombre, r] of casos) {
    it(`sin tarifas (un hotel, nada que escoger), con ${nombre}`, () => {
      const params = paramsDelCaso(r)
      const html = tarifas(3, { params, tarifas: [] })
      if (nombre === '5 puntos extra') volcar('margen-global-sin-tarifas', html)
      expect(rotulo(html)).toBe(`Margen global (no se edita): ${encabezado(lineasDelCaso(3), params, [])}`)
    })

    it(`con las tres tarifas, la Recomendada (el total) con ${nombre}`, () => {
      const params = paramsDelCaso(r)
      const html = tarifas(3, { params })
      expect(rotulo(html)).toContain(`Recomendada ${encabezado(lineasDelCaso(3), params, TARIFAS_DEL_CASO)}`)
    })
  }

  it('la cifra se mueve con los puntos y los descuentos', () => {
    const cifras = [{ puntosExtra: 0 }, { puntosExtra: 5 }, { puntosExtra: 5, descuentos: [{ id: 'd1', descripcion: 'x', pct: 4 }] }]
      .map(r => rotulo(tarifas(3, { params: paramsDelCaso(r), tarifas: [] })))
    expect(new Set(cifras).size).toBe(3)
  })

  it('con reglas el encabezado es el margen global (el que se juzga); sin reglas, el de siempre', () => {
    const params = paramsDelCaso()
    const total = cascadaDelTotal(lineasDelCaso(3), params, TARIFAS_DEL_CASO)
    expect(margenDelEncabezado(total, params)).toBe(total.reglas!.margenGlobalPct)
    const sinReglas = { ...params, reglas: undefined }
    const plano = cascadaDelTotal(lineasDelCaso(3), sinReglas, TARIFAS_DEL_CASO)
    expect(margenDelEncabezado(plano, sinReglas)).toBe(plano.margenRealPct)
  })
})

describe('falla 2 · el aviso de aprobación dice la causa real', () => {
  const causas = (html: string) => [...html.matchAll(/data-causa-margen="(\w+)"[^>]*>([^<]*)</g)].map(m => [m[1], m[2]])

  it('por hotel: 8 % en el hotel con global ≥ 12 % nombra el hotel y no el global', () => {
    const html = tarifas(7, { params: paramsDelCaso({ descuentos: [] }) })
    volcar('aviso-hotel', html)
    expect(rotulo(html)).toContain('Recomendada 13 %')
    expect(causas(html)).toEqual([['hotel', 'Hotel Ficticio Coral (recomendada) queda en 8 %, mínimo 10 %']])
    expect(texto(html)).toContain('Pedir autorización a Gerente')
  })

  it('por global: global bajo 12 % y todos los hoteles ≥ 10 % habla del global', () => {
    const html = tarifas(3, { params: paramsDelCaso({ puntosExtra: 3 }) })
    volcar('aviso-global', html)
    const c = causas(html)
    expect(c.length).toBeGreaterThan(0)
    expect(c.every(([tipo]) => tipo === 'global')).toBe(true)
    expect(c.map(x => x[1])).toContain('Recomendada: margen 11,7 %, mínimo 12 %')
  })

  it('combinado: hotel bajo 10 % y global bajo 12 % salen las dos causas', () => {
    const html = tarifas(7)
    volcar('aviso-combinado', html)
    expect(causas(html)).toEqual([
      ['hotel', 'Hotel Ficticio Coral (recomendada) queda en 8 %, mínimo 10 %'],
      ['global', 'Recomendada: margen 11,2 %, mínimo 12 %'],
    ])
  })

  it('sin aviso: hotel en 12 % y global en 13 % no pide aprobación', () => {
    const html = tarifas(3)
    expect(html).not.toContain('data-autorizacion')
    expect(causas(html)).toEqual([])
  })

  it('sin tarifas, un hotel bajo su piso también abre la caja de la autorización y se nombra', () => {
    const lineas = lineasDelCaso(3).map(l => (l.id === 'h-eco' ? { ...l, tarifa_pax: { descuentoCliente: { motivo: 'x', tipo: 'pct', valor: 7 } } } : l))
    const params = paramsDelCaso({ descuentos: [] })
    expect(cascadaDelTotal(lineas, params, []).reglas!.hotelesBajoPiso.map(h => h.id)).toEqual(['h-eco'])
    const html = tarifas(3, { params, tarifas: [], lineas })
    expect(html).toContain('data-autorizacion')
    expect(causas(html)).toEqual([['hotel', 'Hotel Ficticio Arena queda en 8 %, mínimo 10 %']])
    expect(texto(html)).toContain('Bajo el mínimo')
  })
})

describe('un descuento sobre el total a una sola tarifa (2026-10-29)', () => {
  const causas = (html: string) => [...html.matchAll(/data-causa-margen="(\w+)"[^>]*>([^<]*)</g)].map(m => [m[1], m[2]])

  it('el chip dice a qué tarifa aplica y el de siempre dice «Todas las tarifas»', () => {
    const params = paramsDelCaso({
      descuentos: [
        { id: 'dt', descripcion: 'Cliente recurrente', pct: 2 },
        { id: 'dp', descripcion: 'Suba a Premium', pct: 8, aplicaA: 'tf-pre' },
      ],
    })
    const html = tarifas(3, { params })
    volcar('descuento-por-tarifa', html)
    expect(html).toContain('data-aplica-a="todas"')
    expect(html).toContain('data-aplica-a="tf-pre"')
    expect(html).toMatch(/<option value="tf-pre" selected="">Solo Premium<\/option>/)
    // El 8 % de la Premium la deja bajo el 12 %: frena ella sola, con su nombre.
    const c = causas(html)
    expect(c.length).toBe(1)
    expect(c[0][0]).toBe('global')
    expect(c[0][1]).toMatch(/^Premium: margen \d+(,\d)? %, mínimo 12 %$/)
  })

  it('un descuento cuya tarifa se borró lo dice y no frena a ninguna', () => {
    const params = paramsDelCaso({ descuentos: [{ id: 'dp', descripcion: 'Suba a Premium', pct: 8, aplicaA: 'tf-borrada' }] })
    const html = tarifas(3, { params })
    expect(texto(html)).toContain('Su tarifa ya no existe: no se aplica')
    expect(causas(html)).toEqual([])
  })
})
