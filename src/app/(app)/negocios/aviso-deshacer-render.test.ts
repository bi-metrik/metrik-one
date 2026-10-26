/**
 * Criterio 7 ajustado (Mauricio, 2026-10-01): al quitar una habitación desde la tarjeta, el total
 * cambia al vencer el «Deshacer», y mientras tanto un aviso visible lo dice.
 *
 * Tres capas, porque ninguna prueba de este repo tiene DOM para hacer el clic y esperar:
 *  1. la cuenta, pura (`espera-deshacer.ts`): aparece, cuenta, se va al vencer y al deshacer;
 *  2. el aviso pintado (`AvisoDeshacerTotal`) con y sin espera;
 *  3. el contrato de la tarjeta: el clic agrega la espera, «Deshacer» y la quita ya escrita la sacan,
 *     y la relectura (`onCambio`) va DESPUÉS de sacarla.
 *
 * Se queda en `.ts` por el `include` de vitest.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  agregarEspera,
  quitarEspera,
  segundosParaElTotal,
  SIN_ESPERAS,
  textoAvisoDeshacer,
} from '@/lib/cotizaciones/espera-deshacer'

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} }) }))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({}))

const { AvisoDeshacerTotal } = await import('./tarjeta-opcion')

const T = 1_000_000
const VENTANA = 6000

describe('la cuenta del «Deshacer»', () => {
  it('sin nada quitado no hay aviso', () => {
    expect(segundosParaElTotal(SIN_ESPERAS, T)).toBeNull()
  })

  it('al quitar aparece con 6 s y cuenta hacia abajo', () => {
    const e = agregarEspera(SIN_ESPERAS, 'h2', T + VENTANA)
    expect(segundosParaElTotal(e, T)).toBe(6)
    expect(segundosParaElTotal(e, T + 2_500)).toBe(4)
    expect(segundosParaElTotal(e, T + 5_900)).toBe(1)
  })

  it('al llegar a cero sigue en 1 hasta que la quita se escribe; escrita, se va', () => {
    const e = agregarEspera(SIN_ESPERAS, 'h2', T + VENTANA)
    expect(segundosParaElTotal(e, T + VENTANA + 800)).toBe(1)
    expect(segundosParaElTotal(quitarEspera(e, 'h2'), T + VENTANA + 800)).toBeNull()
  })

  it('al tocar «Deshacer» se va', () => {
    const e = agregarEspera(SIN_ESPERAS, 'h2', T + VENTANA)
    expect(segundosParaElTotal(quitarEspera(e, 'h2'), T + 1_000)).toBeNull()
  })

  it('dos habitaciones quitadas: cuenta la última, y deshacer una deja el aviso de la otra', () => {
    let e = agregarEspera(SIN_ESPERAS, 'h1', T + VENTANA)
    e = agregarEspera(e, 'h2', T + 3_000 + VENTANA)
    expect(segundosParaElTotal(e, T + 3_000)).toBe(6)
    expect(segundosParaElTotal(quitarEspera(e, 'h2'), T + 3_000)).toBe(3)
  })
})

describe('el aviso en la tarjeta', () => {
  it('con espera: visible, anunciado y con la cuenta', () => {
    const html = renderToStaticMarkup(React.createElement(AvisoDeshacerTotal, { segundos: 4 }))
    expect(html).toContain('data-aviso-deshacer')
    expect(html).toContain('role="status"')
    expect(html).toContain('El total se actualiza cuando pase el Deshacer (4 s).')
    expect(textoAvisoDeshacer(4)).toBe('El total se actualiza cuando pase el Deshacer (4 s).')
  })

  it('sin espera: nada', () => {
    expect(renderToStaticMarkup(React.createElement(AvisoDeshacerTotal, { segundos: null }))).toBe('')
  })
})

describe('contrato · la tarjeta usa la cuenta', () => {
  const tarjeta = readFileSync(join(__dirname, 'tarjeta-opcion.tsx'), 'utf8')
  const quitar = tarjeta.slice(tarjeta.indexOf('function quitar(h: HabitacionRepartida'), tarjeta.indexOf('return (', tarjeta.indexOf('function quitar(h: HabitacionRepartida')))

  it('el clic agrega la espera con la ventana del «Deshacer»', () => {
    expect(quitar).toContain('setEsperas(prev => agregarEspera(prev, h.id, empieza + ESPERA_DESHACER_MS))')
  })

  it('«Deshacer» saca el aviso', () => {
    expect(quitar).toMatch(/label: 'Deshacer', onClick: \(\) => \{[^}]*sinAviso\(\)/)
  })

  it('al vencer: se escribe, se saca el aviso y DESPUÉS se relee el total', () => {
    const ejecutar = quitar.slice(quitar.indexOf('const ejecutar'), quitar.indexOf('const reloj'))
    expect(ejecutar.indexOf('sinAviso()')).toBeGreaterThan(-1)
    expect(ejecutar.indexOf('sinAviso()')).toBeLessThan(ejecutar.indexOf('onCambio()'))
  })

  it('el aviso se pinta en el alojamiento con la cuenta de las esperas', () => {
    expect(tarjeta).toContain('const segundosTotal = segundosParaElTotal(esperas, ahora)')
    expect(tarjeta).toContain('<AvisoDeshacerTotal segundos={segundosTotal} />')
  })
})
