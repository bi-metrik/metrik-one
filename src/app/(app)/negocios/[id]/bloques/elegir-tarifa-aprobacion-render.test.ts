/**
 * La pregunta de «Aprobar» con tarifas, RENDERIZADA (2026-09-22).
 *
 * La regla de qué se puede escoger vive en el servidor (`validarTarifaElegida`); esto
 * comprueba lo otro: que quien aprueba vea cada tarifa con el precio que dejaría, sepa
 * cuál es la Recomendada y no pueda confirmar sin escoger ni con una tarifa sin precio.
 *
 * ⚠️ Se queda en `.ts`: el `include` de `vitest.config.ts` es `src/**\/*.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import ElegirTarifaAprobacion, { type TarifaOpcion } from './ElegirTarifaAprobacion'

const TARIFAS: TarifaOpcion[] = [
  { itinerarioId: 'eco', nombre: 'Económica', esRecomendada: false, precio: 2_000_000, motivo: null },
  { itinerarioId: 'rec', nombre: 'Recomendada', esRecomendada: true, precio: 2_400_000, motivo: null },
  { itinerarioId: 'pre', nombre: 'Premium', esRecomendada: false, precio: 3_120_000, motivo: null },
]

function pintar(tarifas: TarifaOpcion[], elegida: string | null) {
  return renderToStaticMarkup(
    React.createElement(ElegirTarifaAprobacion, {
      tarifas,
      elegida,
      onElegir: () => {},
      onConfirmar: () => {},
      onCancelar: () => {},
      pendiente: false,
      enPortal: false,
    }),
  )
}

/** El botón de confirmar: el último `<button>` del diálogo. */
function botonConfirmar(html: string): string {
  const ultimo = html.lastIndexOf('<button')
  return html.slice(ultimo, html.indexOf('</button>', ultimo))
}

describe('ElegirTarifaAprobacion', () => {
  it('pregunta cuál escogió el cliente y muestra cada tarifa con su precio', () => {
    const html = pintar(TARIFAS, 'rec')
    expect(html).toContain('¿Qué tarifa escogió el cliente?')
    expect(html).toContain('Económica')
    expect(html).toContain('Premium')
    expect(html).toMatch(/3\.120\.000/)
    expect(html).toMatch(/2\.400\.000/)
  })

  it('distingue la Recomendada, una sola vez', () => {
    const html = pintar(TARIFAS, 'rec')
    expect(html.split('>Recomendada</span>').length - 1).toBe(1)
  })

  it('el botón dice con cuál se aprueba', () => {
    expect(botonConfirmar(pintar(TARIFAS, 'pre'))).toContain('Aprobar con Premium')
  })

  it('sin escoger, no se puede confirmar', () => {
    const boton = botonConfirmar(pintar(TARIFAS, null))
    expect(boton).toContain('disabled')
    expect(boton).toContain('Escoge una tarifa')
  })

  it('una tarifa sin precio calculable se ve, dice por qué y no se puede escoger', () => {
    const conFallo = TARIFAS.map(t =>
      t.itinerarioId === 'pre' ? { ...t, precio: null, motivo: '«IBERIA» tiene precio y no tiene costo' } : t,
    )
    const html = pintar(conFallo, 'pre')
    expect(html).toContain('«IBERIA» tiene precio y no tiene costo')
    expect(botonConfirmar(html)).toContain('disabled')
    // Su radio queda deshabilitado.
    const radio = html.slice(html.indexOf('value="pre"') - 80, html.indexOf('value="pre"') + 80)
    expect(radio).toContain('disabled')
  })
})
