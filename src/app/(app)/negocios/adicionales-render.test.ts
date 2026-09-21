/**
 * Lo que la PANTALLA del adicional dice, medido sobre el HTML que pinta.
 *
 * ⚠️ Por qué render y no una prueba del helper: lo que se afirma aquí es del JSX. Una
 * prueba de `totalesDeAdicionales` sigue en verde con el componente pintando el número
 * equivocado, o con la sección apareciendo en una cotización que no la pidió. Es el mismo
 * motivo por el que existen las demás pruebas de render de este directorio.
 *
 * Se queda en `.ts`: el `include` de vitest es `src/**\/*.test.ts`, y renombrar a `.tsx`
 * para usar JSX saca el archivo de la suite EN SILENCIO.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }),
}))
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }))
vi.mock('@/app/(app)/negocios/adicional-actions', () => ({
  agregarAdicional: async () => ({ success: true }),
  eliminarAdicional: async () => ({ success: true }),
}))

import AdicionalesItem from './adicionales-item'
import type { FilaAdicional } from '@/lib/cotizaciones/adicionales'

const MALETA: FilaAdicional = {
  id: 'a1',
  item_id: 'avianca',
  codigo: 'equipaje_bodega',
  nombre: null,
  cantidad: 2,
  costo: 90_000,
  precio: 120_000,
  moneda: 'COP',
  tasa_cop: null,
  origen: 'manual',
  orden: 1,
}

function html(props: Partial<Parameters<typeof AdicionalesItem>[0]> = {}): string {
  return renderToStaticMarkup(
    React.createElement(AdicionalesItem, {
      itemId: 'avianca',
      filas: [],
      disponible: true,
      editable: true,
      ...props,
    }),
  )
}

describe('la sección de adicionales', () => {
  it('dice que van DENTRO de esta opción y que no acompañan a otra', () => {
    // Es la frase que evita el error que el diseño marca con dos advertencias. Sin ella,
    // la pantalla no explica por qué la maleta está en esta línea y no en la ranura.
    const h = html()
    expect(h).toContain('dentro')
    expect(h).toContain('no la acompañan')
  })

  it('lista cada adicional con su cantidad, su costo, su precio y su margen', () => {
    const h = html({ filas: [MALETA] })
    expect(h).toContain('Equipaje de bodega adicional')
    expect(h).toContain('×2')
    // 90.000 × 2 = 180.000 de costo; 120.000 × 2 = 240.000 de precio.
    expect(h).toContain('180.000')
    expect(h).toContain('240.000')
    // ⚠️ Y el UNITARIO no aparece por ninguna parte. Sin esta línea, pintar `ad.precio`
    // en vez del total de la fila pasa igual de verde: la cifra multiplicada seguiría
    // saliendo en «Suman a esta opción» y la prueba no probaría nada.
    expect(h).not.toContain('120.000')
    expect(h).not.toContain('90.000')
    // (120.000 − 90.000) / 120.000 = 25%
    expect(h).toContain('25,0%')
  })

  it('declara cuánto SUMAN a la opción: es la cifra que explica la diferencia entre dos variantes', () => {
    const h = html({ filas: [MALETA, { ...MALETA, id: 'a2', codigo: 'seguro_viaje', cantidad: 1, costo: 20_000, precio: 30_000 }] })
    expect(h).toContain('Suman a esta opción')
    expect(h).toContain('270.000')
  })

  it('⚠️ lo que no se puede convertir se DECLARA, no se pinta en cero', () => {
    // Un cero ahí es plata que se regala sin que nada falle. Solo llega por una vía que
    // no pasó por `normalizarAdicional` (SQL, un cargue).
    const h = html({ filas: [{ ...MALETA, moneda: 'USD', tasa_cop: null }] })
    expect(h).toContain('sin tasa')
    expect(h).not.toContain('240.000')
  })

  it('sin la migración y sin nada cargado la sección NO existe: R6 en la pantalla', () => {
    expect(html({ disponible: false })).toBe('')
  })

  it('sin la migración pero CON algo cargado se ve, de solo lectura', () => {
    // Esconder plata que sí suma sería peor que mostrarla sin poder editarla.
    const h = html({ disponible: false, filas: [MALETA] })
    expect(h).toContain('Equipaje de bodega adicional')
    expect(h).toContain('falta aplicar la migración')
  })

  it('una cotización congelada MUESTRA sus adicionales y no ofrece tocarlos', () => {
    const h = html({ editable: false, filas: [MALETA] })
    expect(h).toContain('Equipaje de bodega adicional')
    expect(h).not.toContain('Agregar adicional')
  })

  it('la lista corta se ofrece entera, y ADEMÁS el texto libre (§1.3)', () => {
    // El desplegable vive detrás del botón, así que aquí se comprueba que el botón existe
    // con su nombre exacto: la sección vacía cita ese nombre y renombrarlo sin tocar la
    // frase manda a buscar algo que no existe.
    expect(html()).toContain('Agregar adicional')
  })
})
