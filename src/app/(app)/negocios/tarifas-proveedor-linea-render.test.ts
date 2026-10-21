/**
 * Lo que la línea MUESTRA de las tarifas del proveedor (Mauricio, 2026-10-19; criterios de Noor y
 * Hana; hoja única del 2026-10-21): el filtro a la vista y quitable, de dónde sale cada precio y su
 * total, la tarifa de cada pasajero ya marcada, «Detalles del costo» plegado, el motivo cuando no
 * hay tarifas y el buscador cuando no hay proveedor. Render de servidor con datos ficticios.
 *
 * ⚠️ Se queda en `.ts`: el `include` de vitest es `src/**\/*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }))
vi.mock('@/app/(app)/negocios/tarifas-proveedor-actions', () => ({
  buscarFichasParaLinea: async () => ({ ok: true, fichas: [] }),
  buscarProveedoresParaCotizacion: async () => ({ ok: true, fichas: [] }),
  crearLineaConTarifa: async () => ({ ok: false, error: 'no en la prueba' }),
  elegirTarifasDeLinea: async () => ({ ok: false, error: 'no en la prueba' }),
  fijarProveedorDeLinea: async () => ({ ok: true }),
  tarifasDeLinea: async () => ({ ok: false, error: 'no en la prueba' }),
  tarifasParaLineaNueva: async () => ({ ok: false, error: 'no en la prueba' }),
}))

import { tarifasParaCotizar } from '@/lib/proveedores/tarifas-extraidas'
import { ajustesPorDefecto, ofrecerTarifas } from '@/lib/proveedores/oferta-tarifas'
import type { TarifasDeLinea } from './tarifas-proveedor-actions'

const { default: TarifasProveedorLinea } = await import('./tarifas-proveedor-linea')

const fila = (x: Record<string, unknown>) => ({ moneda: 'COP', establecimiento: null, archivo: 'Tarifas Ficticias 2027.pdf', fuente: { pagina: 3 }, ...x })
const TARIFARIO = {
  canal: 'neta',
  temporadas: [{ id: 'T1', nombre: 'Baja', rangos: [{ desde: '2027-01-10', hasta: '2027-03-14' }] }, { id: 'T2', nombre: 'Alta', rangos: [{ desde: '2027-03-15', hasta: '2027-04-05' }] }],
  tarifas: [
    fila({ categoria: 'Doble Estándar', temporada_id: 'T1', ocupacion: 'doble', base_precio: 'por_habitacion_noche', precio: 300000, plan: 'Desayuno' }),
    fila({ categoria: 'Doble Estándar', temporada_id: 'T2', ocupacion: 'doble', base_precio: 'por_habitacion_noche', precio: 400000, plan: 'Desayuno' }),
    fila({ categoria: 'Doble Estándar', temporada_id: 'T1', base_precio: 'por_persona_noche', tipo_pasajero: 'nino', precio: 80000 }),
  ],
}
const composicion = { adultos: 2, ninos: 0, infantes: 0 }

function vista(extra: Partial<TarifasDeLinea> = {}): TarifasDeLinea {
  const u = tarifasParaCotizar({ estado: 'revisada', vigenciaDesde: '2027-01-01', vigenciaHasta: '2027-12-31', tarifario: TARIFARIO, monedas: null }, null)
  if (!u.ok) throw new Error(u.motivo)
  const o = ofrecerTarifas({ usables: u.tarifas, tarifario: TARIFARIO, composicion, entrada: '2027-02-01', salida: '2027-02-04' })
  return {
    editable: true,
    proveedor: { id: 'p1', nombre: 'Hotel Ficticio Playa', ciudad: 'Cartagena', enlace: '/proveedores/p1', por: 'linea' },
    motivo: null,
    aviso: null,
    nuevaPorRevisar: false,
    opciones: o.opciones,
    avisos: o.avisos,
    calendario: o.calendario,
    fechas: { entrada: '2027-02-01', salida: '2027-02-04', deLaLinea: true },
    composicion,
    composicionDelViaje: false,
    ajustes: ajustesPorDefecto({ ficha: { tarifaCanal: null, ivaIncluido: null }, tarifario: TARIFARIO }),
    ivaDeclarado: true,
    elegida: null,
    conHabitaciones: false,
    ...extra,
  }
}

const pintar = (v: TarifasDeLinea | null, extra: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(TarifasProveedorLinea, { itemId: 'i1', onCambio: () => {}, inicial: v, ...extra }))
const ELEGIDA_FILA_0 = { extraccion_id: 'x', proveedor_id: 'p1', tarifario_de_id: null, filas: [{ indice_fila: 0, cantidad: 1, noches: 3, tipo: null }], noPagan: [], canal: 'neta' as const, comision_pct: null, iva_incluido: false, iva_pct: 19, moneda: 'COP', archivo: 'Tarifas Ficticias 2027.pdf', leidaEn: 't', por: 'Ana Ficticia', porId: null }

describe('las tarifas del proveedor en la línea', () => {
  it('cerrada, es un botón: nada se pide ni se elige hasta abrirla', () => {
    const html = pintar(null)
    expect(html).toContain('Usar tarifa de proveedor')
    expect(html).toContain('data-abrir-tarifas')
    expect(html).not.toContain('data-hoja-tarifas')
    expect(html).not.toContain('data-opciones-tarifa')
  })

  it('abierta es una hoja (pantalla completa en el celular, centrada en escritorio) con UN solo scroll', () => {
    const html = pintar(vista())
    expect(html).toContain('data-hoja-tarifas')
    expect(html).toMatch(/class="fixed inset-0 z-50/)
    expect(html).toContain('sm:max-w-2xl')
    // Un solo área con scroll: la lista no tiene un `max-h` propio.
    expect(html.match(/overflow-y-auto/g)).toHaveLength(1)
    expect(html).not.toContain('max-h-80')
    // El pie fijo con el botón, fuera del área con scroll.
    expect(html).toMatch(/data-lista-tarifas[\s\S]*<\/div><footer[^>]*data-pie-tarifas/)
  })

  it('el filtro a la vista (fechas, temporada, pasajeros) y quitable; las filtradas no se ven', () => {
    const html = pintar(vista())
    expect(html).toContain('data-filtro-tarifas')
    expect(html).toMatch(/1 feb 2027 – 4 feb 2027 · 3 noches \(de la línea\)/)
    expect(html).toContain('Temporada Baja')
    expect(html).toContain('2 adultos (de la línea)')
    expect(html).toContain('Quitar filtro (2 ocultas)')
    expect(html).toContain('data-opcion-tarifa="0"')
    expect(html).not.toContain('data-opcion-tarifa="1"')
  })

  it('las fechas y los pasajeros del viaje se dicen «del viaje»', () => {
    const html = pintar(vista({ fechas: { entrada: '2027-02-01', salida: '2027-02-04', deLaLinea: false }, composicionDelViaje: true }))
    expect(html).toMatch(/1 feb 2027 – 4 feb 2027 · 3 noches \(del viaje\)/)
    expect(html).toContain('2 adultos (del viaje)')
  })

  it('agrupadas por habitación y plan; cada tarifa dice su total a la derecha, base, temporada y de dónde sale', () => {
    const html = pintar(vista())
    expect(html).toContain('Doble Estándar · Desayuno</h3>')
    expect(html).toContain('doble · temporada Baja (3 noches del viaje)')
    expect(html).toContain('$300.000 COP por habitación, por noche')
    expect(html).toMatch(/data-total-fila[^>]*><span[^>]*>\$900\.000<\/span><span[^>]*>1 × 3 noches × \$300\.000<\/span>/)
    expect(html).toContain('Fila 1 de «Tarifas Ficticias 2027.pdf», pág. 3')
  })

  it('sin elección previa, la tarifa de cada pasajero viene marcada y el pie dice «Usar · $total»', () => {
    const html = pintar(vista())
    expect(html).toMatch(/type="checkbox"[^>]*checked/)
    expect(html).toContain('data-preseleccion="unica"')
    expect(html).toMatch(/data-usar-tarifa[^>]*>[\s\S]*Usar · \$900\.000/)
  })

  it('«Detalles del costo» (canal, comisión, IVA, no paga, cantidades) viene cerrado si la ficha tiene el dato', () => {
    const html = pintar(vista())
    expect(html).toContain('Detalles del costo')
    expect(html).toMatch(/data-abrir-detalles/)
    expect(html).toMatch(/aria-expanded="false"[^>]*data-abrir-detalles/)
    expect(html).not.toContain('aria-label="Canal de la tarifa"')
  })

  it('«Detalles del costo» se abre solo si falta el dato (el tarifario no dice el canal)', () => {
    const html = pintar(vista({ ajustes: { canal: 'sin_dato', comisionPct: null, ivaIncluido: false, ivaPct: 19 } }))
    expect(html).toContain('aria-label="Canal de la tarifa"')
    expect(html).toContain('El precio ya trae IVA (19 %)')
    expect(html).toContain('la casilla «Calcular con IVA» de la cotización se lo suma')
  })

  it('con una tarifa ya elegida (sin costo confirmado): dice de dónde salió y la deja marcada', () => {
    const html = pintar(vista({ elegida: ELEGIDA_FILA_0 }))
    expect(html).toContain('El costo de la línea salió de la fila 1 de «Tarifas Ficticias 2027.pdf», elegida por Ana Ficticia.')
    expect(html).toMatch(/type="checkbox"[^>]*checked/)
    expect(html).toContain('Usar · $900.000')
  })

  it('sin tarifas usables: el motivo en llano con enlace a la ficha', () => {
    const html = pintar(vista({ motivo: 'La carga del tarifario no se ha cerrado: confirma la vigencia y la moneda.', opciones: [] }))
    expect(html).toContain('data-motivo-sin-tarifas')
    expect(html).toContain('La carga del tarifario no se ha cerrado')
    expect(html).toContain('href="/proveedores/p1"')
  })

  it('sin proveedor: el buscador (sin botón «Buscar»: busca mientras se escribe)', () => {
    const html = pintar(vista({ proveedor: null, opciones: [] }))
    expect(html).toContain('data-buscador-fichas')
    expect(html).toContain('aria-label="Proveedor"')
    expect(html).not.toMatch(/>\s*Buscar\s*</)
  })

  it('el proveedor reconocido por nombre se dice, y se puede cambiar', () => {
    const v = vista()
    const html = pintar({ ...v, proveedor: { ...v.proveedor!, por: 'nombre' } })
    expect(html).toContain('reconocido por el nombre del pantallazo')
    expect(html).toContain('Es otro proveedor')
  })

  it('«Cambiar el costo»: el título lo dice y la fila de hoy se señala sin marcarse', () => {
    const cerrada = pintar(null, { costoActual: 240000 })
    expect(cerrada).toContain('Cambiar el costo por una tarifa del proveedor')
    const html = pintar(vista({ elegida: ELEGIDA_FILA_0 }), { costoActual: 240000 })
    expect(html).toContain('aria-label="Cambiar el costo"')
    expect(html).toMatch(/data-opcion-tarifa="0"[\s\S]*data-tarifa-actual="true">La que usas hoy</)
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/)
    expect(html).toContain('Elige una tarifa')
  })

  it('una actividad por persona de un día no habla de noches (punto 3) y dice «2 × $105.000»', () => {
    const tour = {
      temporadas: [{ id: 'A', nombre: 'Alta', rangos: [{ desde: '2027-11-01', hasta: '2027-11-30' }] }],
      tarifas: [fila({ categoria: 'Tour Ficticio de Bahía', temporada_id: 'A', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 105000 })],
    }
    const u = tarifasParaCotizar({ estado: 'revisada', vigenciaDesde: '2027-01-01', vigenciaHasta: '2027-12-31', tarifario: tour, monedas: null }, null)
    if (!u.ok) throw new Error(u.motivo)
    const o = ofrecerTarifas({ usables: u.tarifas, tarifario: tour, composicion, entrada: '2027-11-15', salida: null })
    const html = pintar(vista({ opciones: o.opciones, avisos: o.avisos, calendario: o.calendario, fechas: { entrada: '2027-11-15', salida: null, deLaLinea: true } }))
    expect(html).toContain('temporada Alta · aplica el 15 nov')
    expect(html).not.toMatch(/noche/)
    expect(html).toMatch(/\$210\.000<\/span><span[^>]*>2 × \$105\.000<\/span>/)
  })
})
