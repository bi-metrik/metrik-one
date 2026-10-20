/**
 * Lo que la línea MUESTRA de las tarifas del proveedor (Mauricio, 2026-10-19; criterios de Noor y
 * Hana): el filtro a la vista y quitable, de dónde sale cada precio y su base en llano, el motivo
 * cuando no hay tarifas, el buscador cuando no hay proveedor, y ningún precio en la línea sin que
 * la persona lo elija. Render de servidor del componente con datos ficticios.
 *
 * ⚠️ Se queda en `.ts`: el `include` de vitest es `src/**\/*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }))
vi.mock('@/app/(app)/negocios/tarifas-proveedor-actions', () => ({
  buscarFichasParaLinea: async () => ({ ok: true, fichas: [] }),
  elegirTarifasDeLinea: async () => ({ ok: false, error: 'no en la prueba' }),
  fijarProveedorDeLinea: async () => ({ ok: true }),
  tarifasDeLinea: async () => ({ ok: false, error: 'no en la prueba' }),
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
    ajustes: ajustesPorDefecto({ ficha: { tarifaCanal: null, ivaIncluido: null }, tarifario: TARIFARIO }),
    ivaDeclarado: true,
    elegida: null,
    conHabitaciones: false,
    ...extra,
  }
}

const pintar = (v: TarifasDeLinea | null) => renderToStaticMarkup(React.createElement(TarifasProveedorLinea, { itemId: 'i1', onCambio: () => {}, inicial: v }))

describe('las tarifas del proveedor en la línea', () => {
  it('cerrada, es un botón: nada se pide ni se elige hasta abrirla', () => {
    const html = pintar(null)
    expect(html).toContain('Tarifas del proveedor')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('data-opciones-tarifa')
  })

  it('abierta: el filtro a la vista (fechas, temporada, pasajeros) y quitable; las filtradas no se ven', () => {
    const html = pintar(vista())
    expect(html).toContain('data-filtro-tarifas')
    expect(html).toMatch(/1 feb 2027 – 4 feb 2027 · 3 noches/)
    expect(html).toContain('Temporada Baja')
    expect(html).toContain('2 adultos')
    expect(html).toContain('Quitar filtro (2 ocultas)')
    expect(html).toContain('data-opcion-tarifa="0"')
    expect(html).not.toContain('data-opcion-tarifa="1"')
  })

  it('cada opción dice precio, moneda, base en llano, temporada y de qué archivo, fila y página sale', () => {
    const html = pintar(vista())
    expect(html).toContain('Doble Estándar · Desayuno · doble')
    expect(html).toContain('$300.000')
    expect(html).toContain('por habitación, por noche')
    expect(html).toContain('temporada Baja (3 noches del viaje)')
    expect(html).toContain('Fila 1 de «Tarifas Ficticias 2027.pdf», pág. 3')
  })

  it('ninguna casilla viene marcada: el precio entra solo cuando la persona elige', () => {
    const html = pintar(vista())
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/)
    expect(html).not.toContain('data-usar-tarifa')
  })

  it('con una tarifa ya elegida: dice de dónde salió el costo y muestra el cálculo, el canal y el IVA', () => {
    const html = pintar(vista({
      elegida: { extraccion_id: 'x', proveedor_id: 'p1', tarifario_de_id: null, filas: [{ indice_fila: 0, cantidad: 1, noches: 3, tipo: null }], noPagan: [], canal: 'neta', comision_pct: null, iva_incluido: false, iva_pct: 19, moneda: 'COP', archivo: 'Tarifas Ficticias 2027.pdf', leidaEn: 't', por: 'Ana Ficticia', porId: null },
    }))
    expect(html).toContain('El costo de la línea salió de la fila 1 de «Tarifas Ficticias 2027.pdf», elegida por Ana Ficticia.')
    expect(html).toContain('Fila 1: 1 habitación × 3 noches × $300.000 = $900.000')
    expect(html).toContain('Costo para la agencia: $900.000')
    expect(html).toContain('aria-label="Canal de la tarifa"')
    expect(html).toContain('El precio ya trae IVA (19 %)')
    expect(html).toContain('la casilla «Calcular con IVA» de la cotización se lo suma')
    expect(html).toContain('data-usar-tarifa')
  })

  it('sin tarifas usables: el motivo en llano con enlace a la ficha; el pantallazo y el costo a mano siguen', () => {
    const html = pintar(vista({ motivo: 'La carga del tarifario no se ha cerrado: confirma la vigencia y la moneda.', opciones: [] }))
    expect(html).toContain('data-motivo-sin-tarifas')
    expect(html).toContain('La carga del tarifario no se ha cerrado')
    expect(html).toContain('href="/proveedores/p1"')
    expect(html).toContain('Puedes seguir con el pantallazo o el costo a mano.')
  })

  it('sin proveedor: el buscador de fichas', () => {
    const html = pintar(vista({ proveedor: null, opciones: [] }))
    expect(html).toContain('data-buscador-fichas')
    expect(html).toContain('aria-label="Buscar la ficha del proveedor"')
  })

  it('el proveedor reconocido por nombre se dice, y se puede cambiar', () => {
    const v = vista()
    const html = pintar({ ...v, proveedor: { ...v.proveedor!, por: 'nombre' } })
    expect(html).toContain('reconocido por el nombre del pantallazo')
    expect(html).toContain('Es otro proveedor')
  })
})
