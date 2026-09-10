/**
 * El FAB parado sobre un negocio CERRADO.
 *
 * EL CASO QUE IMPORTA: qué se apaga y qué NO. "Nuevo negocio" y "Actualizar saldo" no
 * le cargan nada a ESE negocio y tienen que seguir sirviendo; si se fueran, quedarse
 * parado sobre un cerrado dejaría el FAB sin salida para un `operator`, cuyo menú se
 * reduce a esas acciones.
 *
 * ⚠️ Es prueba de RENDER, no del helper: la lección de `recaudo-cambiado-banner` y del
 * PR #581 es que una prueba pura no fija que el JSX obedezca la decisión — el botón
 * puede ignorar `accionBloqueadaPorCierre` y el helper sigue verde. Por eso se monta
 * `MenuAccionesFab` con el catálogo REAL (`FAB_ACTIONS`), no con un fixture inventado:
 * si mañana alguien agrega una acción que alimenta al negocio y olvida la marca, esta
 * prueba no lo ve, pero si alguien le quita la marca a una de las cuatro, sí.
 *
 * Se monta el menú y no el FAB entero a propósito: el menú vive detrás de
 * `{open && …}` y `open` arranca en `false`, así que renderizar `<FAB/>` devuelve un
 * botón y nada más. Además el estado de "cerrado" lo trae un `useEffect`, que
 * `renderToStaticMarkup` no ejecuta.
 *
 * MUTACIONES MEDIDAS el 2026-09-10 (26 verdes en la linea base de las 4 suites):
 *   · `accionBloqueadaPorCierre` siempre `false`                → 1 roja
 *   · `accionBloqueadaPorCierre` devolviendo `contextoCerrado`  → 2 rojas
 *     (apaga tambien "Nuevo negocio", y con el el menu del operator)
 *   · quitar `disabled={bloqueada}` dejando la clase gris       → 1 roja
 *   · borrar la nota que explica el apagado                     → 1 roja
 *
 * ⚠️ La nota NO la tumba la primera mutacion: cuelga de `contextoCerrado` directo, no
 * del helper. Son dos decisiones separadas y cada una tiene su prueba.
 */
import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MenuAccionesFab, accionesVisiblesFab, type AccionFab } from './fab-acciones'

function pintar(opts: {
  role: string
  contextoCerrado: boolean
  registrarPagoEnabled?: boolean
  hayContexto?: boolean
}): { html: string; acciones: AccionFab[] } {
  const acciones = accionesVisiblesFab({
    role: opts.role,
    registrarPagoEnabled: opts.registrarPagoEnabled ?? true,
    hayContexto: opts.hayContexto ?? true,
  })
  const html = renderToStaticMarkup(
    React.createElement(MenuAccionesFab, {
      acciones,
      contextoCerrado: opts.contextoCerrado,
      onAccion: () => {},
    }),
  )
  return { html, acciones }
}

/** El `<button>` completo de esa acción, para poder mirar su `disabled`. */
function botonDe(html: string, label: string): string {
  const partes = html.split('<button')
  const trozo = partes.find((p) => p.includes(`>${label}</button>`))
  if (!trozo) throw new Error(`no se pintó la acción "${label}" — html: ${html}`)
  return trozo
}

const ALIMENTAN = ['Registrar horas', 'Registrar gasto', 'Programar cobro', 'Registrar pago']
const NO_ALIMENTAN = ['Nuevo negocio']

describe('FAB parado sobre un negocio cerrado', () => {
  it('las cuatro que le cargan información al negocio salen deshabilitadas', () => {
    const { html } = pintar({ role: 'owner', contextoCerrado: true })
    for (const label of ALIMENTAN) {
      expect(botonDe(html, label), label).toContain('disabled')
    }
  })

  it('"Nuevo negocio" sigue disponible: no depende del contexto', () => {
    const { html } = pintar({ role: 'owner', contextoCerrado: true })
    for (const label of NO_ALIMENTAN) {
      expect(botonDe(html, label), label).not.toContain('disabled')
    }
  })

  it('dice POR QUÉ están apagadas', () => {
    const { html } = pintar({ role: 'owner', contextoCerrado: true })
    expect(html).toContain('Este negocio está cerrado')
  })

  it('un operator conserva una acción utilizable, no queda con el menú muerto', () => {
    const { html, acciones } = pintar({ role: 'operator', contextoCerrado: true })
    const utilizables = acciones.filter((a) => !botonDe(html, a.label).includes('disabled'))
    expect(utilizables.map((a) => a.label)).toContain('Nuevo negocio')
  })
})

describe('control: sobre un negocio ABIERTO no cambia nada', () => {
  it('ninguna acción sale deshabilitada', () => {
    const { html, acciones } = pintar({ role: 'owner', contextoCerrado: false })
    for (const a of acciones) {
      expect(botonDe(html, a.label), a.label).not.toContain('disabled')
    }
    expect(acciones.map((a) => a.label)).toEqual(
      expect.arrayContaining([...ALIMENTAN, ...NO_ALIMENTAN]),
    )
  })

  it('no aparece la nota de cierre', () => {
    const { html } = pintar({ role: 'owner', contextoCerrado: false })
    expect(html).not.toContain('Este negocio está cerrado')
  })
})

describe('lo que el cierre NO toca', () => {
  it('sin el flag del workspace, "Registrar pago" no está — cerrado o abierto', () => {
    for (const contextoCerrado of [true, false]) {
      const { acciones } = pintar({ role: 'owner', contextoCerrado, registrarPagoEnabled: false })
      expect(acciones.map((a) => a.label)).not.toContain('Registrar pago')
    }
  })

  it('"Programar cobro" sigue siendo solo-contexto: fuera de un negocio no aparece', () => {
    const { acciones } = pintar({ role: 'owner', contextoCerrado: false, hayContexto: false })
    expect(acciones.map((a) => a.label)).not.toContain('Programar cobro')
  })
})
