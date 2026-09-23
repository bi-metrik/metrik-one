/**
 * La fila de una captura en la bandeja (bug #859, COT-2026-0011).
 *
 * Lo que se fija:
 *  1. La ficha sale de lo que devolvió la lectura (`leida`), no de la lista de líneas de la
 *     página: con la opción recién creada todavía vacía en la página (el refresco llega tarde),
 *     la fila pinta la aerolínea y los tramos, y NUNCA dice «La lectura no dejó datos».
 *  2. Mientras no llega nada que pintar: «Preparando la ficha…», sin «Aceptar».
 *  3. Con la ficha vacía no se ofrece «Aceptar»: se manda a revisar en su bloque.
 *  4. El título es el nombre real de la ranura, no «Vuelo» a secas.
 *  5. Qué cuenta como trabajo en el aire (para el aviso al recargar).
 *
 * Se queda en `.ts` por el `include` de vitest.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import fixture from '@/lib/cotizaciones/providencia-equipaje.fixture.json'
import { ranuraPorSlug } from '@/lib/cotizaciones/ranuras-pantallazo'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }) }))
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }))
vi.mock('@/app/(app)/negocios/cotizacion-actions', () => ({
  deleteItem: async () => ({ success: true }),
  recalcularTotales: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({
  leerCasillaDeItem: async () => ({ ok: true, mensaje: '', alertas: [] }),
  confirmarTarifaPorPasajero: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/ranura-actions', () => ({
  crearRanuraConOpcion: async () => ({ success: true, itemId: 'x', grupo: 'vuelo' }),
  agregarOpcionARanura: async () => ({ success: true, itemId: 'x', grupo: 'vuelo' }),
  detectarCaptura: async () => ({ ok: false, codigo: 'SIN_TIPO', mensaje: '' }),
}))

const { FilaCaptura, enElAireCaptura, opcionesParaComparar } = await import('./bandeja-capturas')
type Captura = Parameters<typeof FilaCaptura>[0]['captura']
type Item = NonNullable<Parameters<typeof FilaCaptura>[0]['item']>

const VUELO = ranuraPorSlug('vuelo_detalle')!
const LECTURAS = fixture as unknown as Record<string, Record<string, string | null>>

/** La opción como la devuelve `leerCasillaDeItem` tras leer la captura de Avianca. */
function leidaAvianca(): Item {
  const valores = LECTURAS['01-vuelo1-bog-adz-avianca.png']
  const campos = VUELO.campos
    .filter(c => valores[c.slug] !== null && valores[c.slug] !== undefined)
    .map(c => ({ label: c.label, valor: valores[c.slug] as string }))
  return {
    id: 'item-1',
    nombre: 'OPCIÓN 1',
    grupo: 'vuelo 3',
    tarifa_pax: { casillas: { grupo_completo: { moneda: 'COP', total: 1, campos } } },
    tramos: null,
    cargo_destino_valor: null,
    cargo_destino_moneda: null,
  }
}

function captura(extra: Partial<Captura> = {}): Captura {
  return {
    id: 'cap-1',
    preview: 'data:image/png;base64,AA==',
    dataUrl: 'data:image/png;base64,AA==',
    estado: { fase: 'lista', alertas: [] },
    itemId: 'item-1',
    donde: 'Vuelo a Providencia · nuevo',
    tipo: 'vuelo',
    etiqueta: 'Vuelo a Providencia',
    leida: null,
    abierta: true,
    error: null,
    ...extra,
  }
}

function pintar(c: Captura, item: Item | null) {
  const nada = () => {}
  return renderToStaticMarkup(React.createElement(FilaCaptura, {
    captura: c,
    item,
    composicion: { adultos: 2, ninos: 0, infantes: 1 },
    onAlternar: nada,
    onAceptar: nada,
    onRevisar: nada,
    onBorrar: nada,
    onDeshacer: nada,
    onElegirTipo: nada,
    onElegirOpcion: nada,
  }))
}

describe('la fila de una captura leída', () => {
  it('pinta la ficha con lo que devolvió la lectura aunque la página aún tenga la opción vacía', () => {
    // La página todavía trae la opción recién creada, sin lectura (el refresco llega tarde).
    const vacia: Item = { id: 'item-1', nombre: 'OPCIÓN 1', grupo: 'vuelo 3', tarifa_pax: null }
    const html = pintar(captura({ leida: leidaAvianca() }), vacia)
    expect(html).toContain('Avianca')
    expect(html).toContain('BOG 06:05')
    expect(html).not.toContain('La lectura no dejó datos')
    expect(html).toContain('Aceptar')
  })

  it('sin lectura ni opción en la página: «Preparando la ficha…» y sin Aceptar', () => {
    const html = pintar(captura({ leida: null }), null)
    expect(html).toContain('Preparando la ficha…')
    expect(html).not.toContain('Aceptar')
    expect(html).not.toContain('La lectura no dejó datos')
  })

  it('con la ficha vacía no ofrece Aceptar: manda a revisar en su bloque', () => {
    const vacia: Item = { id: 'item-1', nombre: 'OPCIÓN 1', grupo: 'vuelo 3', tarifa_pax: null }
    const html = pintar(captura({ leida: vacia }), null)
    expect(html).not.toContain('Aceptar')
    expect(html).toContain('Revisar en su bloque')
  })

  it('el título es el nombre real de la ranura cuando la opción aún no tiene nombre', () => {
    const html = pintar(captura({ estado: { fase: 'leyendo' }, leida: null }), null)
    expect(html).toContain('Vuelo a Providencia')
  })
})

describe('trabajo en el aire (aviso al recargar)', () => {
  it('cuenta lo que se procesa y la opción que espera a que se elija cuál leer', () => {
    expect(enElAireCaptura({ estado: { fase: 'leyendo' }, itemId: 'i' })).toBe(true)
    expect(enElAireCaptura({ estado: { fase: 'mirando' }, itemId: null })).toBe(true)
    expect(enElAireCaptura({ estado: { fase: 'eligiendo_opcion', mensaje: '', opciones: [] }, itemId: 'i' })).toBe(true)
  })

  it('no cuenta lo que ya terminó ni lo que no dejó nada creado', () => {
    expect(enElAireCaptura({ estado: { fase: 'lista', alertas: [] }, itemId: 'i' })).toBe(false)
    expect(enElAireCaptura({ estado: { fase: 'eligiendo_tipo', motivo: '' }, itemId: null })).toBe(false)
    expect(enElAireCaptura({ estado: { fase: 'rechazada', mensaje: '' }, itemId: null })).toBe(false)
  })
})

describe('el pantallazo repetido (P10)', () => {
  it('misma imagen: dice dónde está ya, que no se procesó, y ofrece Deshacer', () => {
    const html = pintar(captura({ estado: { fase: 'repetida', mensaje: 'Ya está como Opción 2 de Vuelo 1' }, itemId: null }), null)
    expect(html).toContain('Ya está como Opción 2 de Vuelo 1')
    expect(html).toContain('no se volvió a procesar')
    expect(html).toContain('Deshacer')
    expect(html).not.toContain('Aceptar')
  })

  it('parece igual: Descartar (por defecto) y Agregar igual, sin Aceptar', () => {
    const html = pintar(captura({
      estado: { fase: 'parecida', conItemId: 'item-0', donde: 'Opción 1 de Vuelo 1', alertas: [] },
      leida: leidaAvianca(),
    }), null)
    expect(html).toContain('Parece igual a Opción 1 de Vuelo 1')
    expect(html).toContain('Descartar')
    expect(html).toContain('Agregar igual')
    expect(html).not.toContain('Aceptar')
    // Descartar es la primera y la destacada.
    expect(html.indexOf('Descartar')).toBeLessThan(html.indexOf('Agregar igual'))
  })

  it('otro precio: Reemplazar el precio de la opción, o Agregar como otra opción', () => {
    const html = pintar(captura({
      estado: { fase: 'otro_precio', conItemId: 'item-0', donde: 'Opción 1 de Vuelo 1', corta: 'Opción 1', alertas: [] },
      leida: leidaAvianca(),
    }), null)
    expect(html).toContain('Reemplazar el precio de Opción 1')
    expect(html).toContain('Agregar como otra opción')
    expect(html).not.toContain('Aceptar')
  })

  it('una parecida sin responder es trabajo en el aire (su opción existe y se retira al salir)', () => {
    expect(enElAireCaptura({ estado: { fase: 'parecida', conItemId: 'x', donde: '', alertas: [] }, itemId: 'i' })).toBe(true)
    expect(enElAireCaptura({ estado: { fase: 'otro_precio', conItemId: 'x', donde: '', corta: '', alertas: [] }, itemId: 'i' })).toBe(false)
  })
})

describe('las opciones contra las que se compara (P10)', () => {
  it('suma las de la página y las leídas en la bandeja, sin la propia ni las borradas', () => {
    const items: Item[] = [{ id: 'p1' }, { id: 'item-1', nombre: 'vieja' }]
    const cs = [
      captura({ id: 'c-propia', itemId: 'item-9', leida: { id: 'item-9' } }),
      captura({ id: 'c-otra', itemId: 'item-1', leida: { id: 'item-1', nombre: 'fresca' } }),
      captura({ id: 'c-borrada', itemId: 'item-5', leida: { id: 'item-5' }, estado: { fase: 'borrada', antes: { fase: 'lista', alertas: [] } } }),
    ]
    const r = opcionesParaComparar(items, cs, 'c-propia')
    expect(r.map(o => o.id).sort()).toEqual(['item-1', 'p1'])
    expect(r.find(o => o.id === 'item-1')?.nombre).toBe('fresca')
  })
})

describe('la × mientras se analiza (P11)', () => {
  const boton = (html: string) => html.match(/<button[^>]*data-quitar-captura[^>]*>/)?.[0] ?? ''

  it('en «Analizando…» la × está habilitada y dice que deja de analizar', () => {
    for (const fase of ['mirando', 'ubicando', 'leyendo'] as const) {
      const b = boton(pintar(captura({ estado: { fase }, leida: null }), null))
      expect(b).not.toBe('')
      expect(b).not.toContain('disabled')
      expect(b).toContain('se deja de analizar')
    }
  })

  it('quitada a mitad del análisis, la fila lo dice y ofrece Deshacer', () => {
    const html = pintar(captura({ estado: { fase: 'borrada', antes: { fase: 'mirando' }, reanudar: true } }), null)
    expect(html).toContain('se dejó de analizar')
    expect(html).toContain('Deshacer')
  })
})
