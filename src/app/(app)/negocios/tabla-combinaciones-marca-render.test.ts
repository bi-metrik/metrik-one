/**
 * «Va en propuesta» con otra acción de la tabla en curso, RENDERIZADO.
 *
 * Ensayo del 2026-09-23 (COT-2026-0009, hallazgo 24): se marcaron las tres tarifas seguidas y
 * la Recomendada no quedó. Los registros de Vercel muestran dos llamadas para tres clics: el del
 * medio cayó sobre una casilla deshabilitada por `isPending` mientras la primera volvía.
 *
 * Esta prueba fija lo que la pantalla tiene que hacer para que eso no pase: con una transición
 * de la tabla en curso, la casilla SIGUE habilitada. El control de que el doble funciona son los
 * desplegables de las celdas, que sí se apagan durante una acción (cambian la combinación y el
 * servidor los rechazaría a medias).
 *
 * ⚠️ Archivo aparte a propósito: doblar `useTransition` en pendiente alteraría las demás pruebas
 * de render de la tabla. Y se queda en `.ts`: el `include` de vitest es `src/**\/*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Una acción de la tabla en curso: `isPending` en verdadero durante todo el render.
vi.mock('react', async importOriginal => {
  const real = await importOriginal<typeof import('react')>()
  const enCurso = () => [true, (fn: () => void) => fn()] as const
  return { ...real, default: { ...real, useTransition: enCurso }, useTransition: enCurso }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }),
}))
vi.mock('sonner', () => ({
  toast: { success: () => {}, error: () => {}, warning: () => {} },
}))
vi.mock('@/app/(app)/negocios/itinerario-actions', () => ({
  armarTarifas: async () => ({ success: true, creadas: 3, yaExistian: 0 }),
  renombrarRanura: async () => ({ success: true, grupo: 'hotel', lineas: 3 }),
  cambiarOpcionDeItinerario: async () => ({ success: true, desmarcados: [] }),
  marcarEnPropuesta: async () => ({ success: true, desmarcados: [] }),
  guardarMotivoDeTarifa: async () => ({ success: true, motivo: { codigo: null, texto: null } }),
  renombrarItinerario: async () => ({ success: true }),
  eliminarItinerario: async () => ({ success: true }),
}))

const { default: TablaCombinaciones } = await import('./tabla-combinaciones')

const HOTEL = {
  grupo: 'hotel', etiqueta: 'Hotel', prefijo: 'Hotel', nombre: '', renombrable: true,
  candidatos: [
    { id: 'sunscape', nombre: 'SUNSCAPE' },
    { id: 'riu', nombre: 'RIU CARIBE' },
    { id: 'hyatt', nombre: 'HYATT ZILARA' },
  ],
}

/** Las tres tarifas del ensayo, completas y sobre el piso: nada impide marcarlas. */
function tarifa(id: string, nombre: string, orden: number, hotel: string, vaEnPropuesta: boolean) {
  return {
    id, nombre, orden, vaEnPropuesta, esPrincipal: false,
    seleccion: [hotel], ranurasFaltantes: [],
    costo: 1_000_000, precio: 1_180_000, margenRealPct: 15.3, bloqueo: null,
    motivoCodigo: null, motivoTexto: null,
  }
}

function pintar() {
  return renderToStaticMarkup(
    React.createElement(TablaCombinaciones, {
      cotizacionId: 'cot-9',
      editable: true,
      estado: {
        ranuras: [HOTEL],
        fijosConAlternativas: [],
        itinerarios: [
          tarifa('it-eco', 'Económica', 1, 'sunscape', true),
          tarifa('it-rec', 'Recomendada', 2, 'riu', false),
          tarifa('it-pre', 'Premium', 3, 'hyatt', false),
        ],
        umbrales: { pisoPct: 5, avisoPct: 10 },
        tablasAusentes: false,
        motivoDisponible: false,
        recomendadaFalta: null,
        aceptadaId: null,
      },
    }),
  )
}

/** La etiqueta `<input>` de la casilla de una tarifa, entera. */
function casilla(html: string, nombre: string): string {
  const m = new RegExp(`<input[^>]*aria-label="Va en propuesta: ${nombre}"[^>]*>`).exec(html)
  if (!m) throw new Error(`No se pintó la casilla de ${nombre}`)
  return m[0]
}

describe('con una acción de la tabla en curso', () => {
  it('el doble funciona: los desplegables de las celdas sí están apagados', () => {
    const selects = pintar().match(/<select[^>]*>/g) ?? []
    expect(selects.length).toBeGreaterThan(0)
    expect(selects.every(s => / disabled=""/.test(s))).toBe(true)
  })

  it('la casilla de la Recomendada sigue habilitada: el segundo clic no se pierde', () => {
    expect(casilla(pintar(), 'Recomendada')).not.toMatch(/ disabled=""/)
  })

  it('ninguna de las tres casillas se apaga por la acción en curso', () => {
    const html = pintar()
    for (const nombre of ['Económica', 'Recomendada', 'Premium']) {
      expect(casilla(html, nombre)).not.toMatch(/ disabled=""/)
    }
  })

  it('cada casilla pinta lo que dice el servidor mientras nadie la toca', () => {
    const html = pintar()
    expect(casilla(html, 'Económica')).toMatch(/ checked=""/)
    expect(casilla(html, 'Recomendada')).not.toMatch(/ checked=""/)
  })
})
