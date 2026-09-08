/**
 * El item "Tesorería" del sidebar NO trae contador.
 *
 * Es una prueba de render y no de lógica pura a propósito: lo que se decidió el
 * 2026-09-08 es un hecho de pantalla — que el nav de Caja no pinte un número junto a
 * Tesorería. No hay función pura que fijar; lo único que puede volver a romperlo es
 * que alguien reintroduzca el `<span>` en el JSX.
 *
 * Por qué el badge se quitó (y por qué no basta con "ya no lo pintamos"): contaba una
 * mezcla —sobrepagos sin conciliar + referencias duplicadas + negocios etiquetados a
 * mano— que no coincide con NINGUNA de las cuatro pestañas de la pantalla de Tesorería,
 * que sí muestran su propio conteo junto al rótulo. Y una de sus tres patas está muerta:
 * nada en el código escribe ya `solicitud_conciliacion` ni `conciliacion_atendida`
 * (ver `src/lib/activity/tipos.ts`), así que los negocios etiquetados en julio 2026
 * sumaban para siempre sin forma de apagarlos desde la app.
 *
 * `renderToStaticMarkup` corre en el entorno `node` de vitest, sin DOM: alcanza para el
 * primer render, que es donde vive todo lo que se afirma acá. Mismo patrón que
 * `conciliacion/tarjeta-retenido-render.test.ts`.
 *
 * ⚠️ Mutación corrida el 2026-09-08 — se reintrodujo a mano en el `<Link>` de los items
 * de Caja el bloque del badge (píldora ámbar con el conteo) y se confirmó que las
 * pruebas CAEN. Sin esa comprobación el verde no significaría nada: un archivo que solo
 * afirma ausencias pasa igual de verde con la pantalla rota.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

// Lo único que AppShell y el FAB que cuelga de él necesitan de Next en el primer render:
// la ruta actual y el router (que solo se usa al hacer clic, nunca al pintar). `createClient`
// de Supabase no se dobla porque solo se invoca dentro de `handleSignOut`.
vi.mock('next/navigation', () => ({
  usePathname: () => '/negocios',
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}))

import AppShell from './app-shell'

/** Un workspace con el módulo de Tesorería encendido, que es el único caso donde el
 *  item existe. Con `conciliacion: false` la prueba pasaría vacía. */
const pintarShell = () =>
  renderToStaticMarkup(
    React.createElement(
      AppShell,
      {
        fullName: 'Persona de prueba',
        workspaceName: 'Workspace de prueba',
        role: 'owner',
        modules: { business: true, conciliacion: true },
      },
      // El contenido de la página no importa acá: lo que se mide es el nav del shell.
      null,
    ),
  )

/** El `<a>` de Tesorería, aislado del resto del nav. */
function enlaceTesoreria(html: string): string {
  const anclas = html.match(/<a\b[^>]*href="\/conciliacion"[\s\S]*?<\/a>/g) ?? []
  expect(anclas.length).toBeGreaterThan(0)
  return anclas.join('')
}

describe('el item "Tesorería" del sidebar', () => {
  it('existe cuando el módulo está encendido (si no, lo demás no probaría nada)', () => {
    const html = pintarShell()
    expect(html).toContain('href="/conciliacion"')
    expect(html).toContain('Tesorería')
  })

  it('NO pinta ningún número junto al rótulo', () => {
    const enlace = enlaceTesoreria(pintarShell())
    // El texto visible del enlace, sin etiquetas ni clases: solo debe decir el rótulo.
    const textoVisible = enlace.replace(/<[^>]*>/g, '').trim()
    expect(textoVisible).toBe('Tesorería')
    expect(textoVisible).not.toMatch(/\d/)
  })

  it('NO trae la píldora ámbar del contador (ni su versión de puntito)', () => {
    // El badge era lo único ámbar del shell: si vuelve, en cualquiera de sus dos ramas
    // (píldora expandida o puntito colapsado), esta afirmación cae.
    expect(pintarShell()).not.toContain('bg-amber-500')
  })
})
