/**
 * La insignia de honorario del panel de ventas dice la verdad sobre el caso.
 *
 * El defecto (QA 2026-09-14): V0066 y V0429 son ventas en cero, sin honorario aprobado.
 * La vista las marca `caso_completo` porque compara su recaudo contra cero, y el panel les
 * pintaba "Honorario cubierto" con $0 al lado. No hay honorario que cubrir: la insignia
 * verde afirmaba algo falso.
 *
 * Prueba de RENDER a proposito: una prueba de un helper puro seguiria verde con el JSX
 * mal pintado.
 *
 * ⚠️ Mutacion corrida: volver a preguntar primero por `caso_completo` tumba la primera
 * prueba.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { HonorarioCasoChip } from './honorario-caso-chip'

function texto(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function pintar(caso: { sin_honorario_aprobado: boolean; caso_completo: boolean; recaudado: number }) {
  return texto(renderToStaticMarkup(React.createElement(HonorarioCasoChip, { caso })))
}

describe('insignia de honorario del panel de ventas', () => {
  it('una venta sin honorario aprobado no dice "Honorario cubierto", aunque la vista la marque completa', () => {
    const t = pintar({ sin_honorario_aprobado: true, caso_completo: true, recaudado: 0 })
    expect(t).toBe('Sin honorario aprobado')
    expect(t).not.toContain('Honorario cubierto')
  })

  it('un honorario aprobado y cubierto sigue diciendo "Honorario cubierto"', () => {
    const t = pintar({ sin_honorario_aprobado: false, caso_completo: true, recaudado: 535_714 })
    expect(t).toBe('Honorario cubierto')
  })

  it('un honorario aprobado sin cubrir dice cuanto se ha recaudado', () => {
    const t = pintar({ sin_honorario_aprobado: false, caso_completo: false, recaudado: 267_857 })
    expect(t).toBe('$267.857 recaudado')
  })
})
