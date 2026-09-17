/**
 * El selector del platform admin pinta los workspaces BAJO SU ENCABEZADO de grupo, y lo
 * hace en los DOS modos de la barra: en casa y estando dentro de otro workspace.
 *
 * La regla (orden de grupos, alfabético adentro, "Sin clasificar" al final) vive y se prueba en
 * `src/lib/workspace/grupo.test.ts`. Lo que fija esta prueba es un hecho de pantalla que esas
 * pruebas no ven: que el desplegable use la agrupación en vez de pintar la lista plana, y que
 * exista también en modo away — ahí antes solo había "Regresar a {home}", así que ir de un
 * cliente a otro obligaba a pasar por MeTRIK.
 *
 * El desplegable solo se dibuja abierto, y `open` nace en `false`. Sin DOM no hay clic, así que
 * se dobla `useState` para que ese único booleano nazca en `true`; nada más en el componente
 * arranca en `false`.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import type { PlatformAdminState, WorkspaceSummary } from '@/lib/actions/platform-admin'

vi.mock('react', async importOriginal => {
  const real = await importOriginal<typeof import('react')>()
  const useState = ((inicial: unknown) => real.useState(inicial === false ? true : inicial)) as typeof real.useState
  return { ...real, default: { ...real, useState }, useState }
})

vi.mock('@/lib/actions/platform-admin', () => ({
  switchWorkspace: async () => ({}),
  returnHome: async () => ({}),
}))

const { PlatformAdminBar } = await import('./platform-admin-bar')

function ws(slug: string, name: string, grupo: WorkspaceSummary['grupo']): WorkspaceSummary {
  return { id: `w-${slug}`, slug, name, grupo }
}

// Los 13 visibles de producción al 2026-09-16, en el orden en que llegan (`order('name')`).
const PRODUCCION: WorkspaceSummary[] = [
  ws('afi', 'AFI International Group S.A.S.', 'clarity'),
  ws('alma-afi', 'ALMA — Concesion Alto Magdalena', 'sustenta'),
  ws('cda-caqueta', 'CDA del Caquetá', 'valida'),
  ws('cda-elcarmen', 'CDA El Carmen', 'valida'),
  ws('cda-puertotest', 'CDA Puerto Test', 'valida'),
  ws('dimpro', 'Dimpro', 'clarity'),
  ws('ana-demo', 'Estudio Creativo Lúmina', 'demo'),
  ws('maxitec', 'Maxitec — CDA S.A.S.', 'valida'),
  ws('metrik', 'MeTRIK', 'metrik'),
  ws('soena', 'SOENA', 'clarity'),
  ws('termotech', 'Termotech SAS', 'clarity'),
  ws('trappvel', 'Trappvel', 'clarity'),
  ws('wmc-sm', 'WMC SM SAS', 'clarity'),
]

/**
 * `isAway = false` reproduce el estado de casa (el actual ES el home). Con `true`, el
 * platform admin está metido en un workspace de cliente y su home sigue siendo MeTRIK,
 * que es justo el caso donde antes no había desde dónde saltar a un tercero.
 */
function pintar(workspaces: WorkspaceSummary[], isAway = false): string {
  const home = workspaces.find(w => w.slug === 'metrik') ?? null
  const actual = isAway ? (workspaces.find(w => w.slug === 'soena') ?? null) : home
  const state: PlatformAdminState = {
    platformAdmin: true,
    currentWorkspace: actual,
    homeWorkspace: home,
    workspaces,
    isAway,
  }
  return renderToStaticMarkup(React.createElement(PlatformAdminBar, { state }))
}

/** Encabezados en el orden en que aparecen, con los nombres de workspace que cuelgan de cada uno. */
function grupos(html: string): Array<[string, string[]]> {
  const bloques = html.split('role="group"').slice(1)
  return bloques.map(b => {
    const etiqueta = /aria-label="([^"]+)"/.exec(b)?.[1] ?? '?'
    const nombres = [...b.matchAll(/text-slate-800">([^<]+)</g)].map(m => m[1])
    return [etiqueta, nombres]
  })
}

/** El fragmento de HTML del botón de un workspace, buscado por su nombre visible. */
function botonDe(html: string, nombre: string): string {
  return html.split('<button').slice(1).find(b => b.includes(`>${nombre}</div>`)) ?? ''
}

describe('selector del platform admin agrupado', () => {
  it('guardia: el desplegable se pinta abierto (si no, las demás pruebas pasarían vacías)', () => {
    expect(pintar(PRODUCCION)).toContain('Buscar workspace...')
  })

  it('producción: encabezados MéTRIK, Valida, Clarity, Sustenta y Demo, alfabético dentro de cada uno', () => {
    expect(grupos(pintar(PRODUCCION))).toEqual([
      ['MéTRIK', ['MeTRIK']],
      ['Valida', ['CDA del Caquetá', 'CDA El Carmen', 'CDA Puerto Test', 'Maxitec — CDA S.A.S.']],
      [
        'Clarity',
        [
          'AFI International Group S.A.S.',
          'Dimpro',
          'SOENA',
          'Termotech SAS',
          'Trappvel',
          'WMC SM SAS',
        ],
      ],
      ['Sustenta', ['ALMA — Concesion Alto Magdalena']],
      ['Demo', ['Estudio Creativo Lúmina']],
    ])
  })

  it('el encabezado se ve como texto, no solo como atributo', () => {
    const html = pintar(PRODUCCION)
    for (const etiqueta of ['MéTRIK', 'Valida', 'Clarity', 'Sustenta', 'Demo']) {
      expect(html).toContain(`>${etiqueta}</div>`)
    }
  })

  it('sin workspaces sin clasificar, el encabezado "Sin clasificar" no aparece', () => {
    expect(pintar(PRODUCCION)).not.toContain('Sin clasificar')
  })

  it('un workspace sin grupo reconocible se ve al final, bajo "Sin clasificar"', () => {
    const conHuerfano = [...PRODUCCION, ws('nuevo', 'Aaa Nuevo', 'sin_clasificar')]
    const g = grupos(pintar(conHuerfano))
    expect(g.at(-1)).toEqual(['Sin clasificar', ['Aaa Nuevo']])
    expect(g).toHaveLength(6)
  })
})

describe('dentro de otro workspace (modo away) se puede saltar a un tercero', () => {
  it('guardia: los dos modos son ramas distintas — solo away trae el botón de regreso', () => {
    expect(pintar(PRODUCCION, true)).toContain('Regresar a MeTRIK')
    expect(pintar(PRODUCCION)).not.toContain('Regresar a')
  })

  it('el desplegable se pinta, con los MISMOS grupos que en casa', () => {
    const html = pintar(PRODUCCION, true)
    expect(html).toContain('Buscar workspace...')
    expect(grupos(html)).toEqual(grupos(pintar(PRODUCCION)))
  })

  it('el botón de regreso sigue ahí junto al selector', () => {
    const html = pintar(PRODUCCION, true)
    expect(html).toContain('Buscar workspace...')
    expect(html).toContain('Regresar a MeTRIK')
  })

  it('el workspace en el que se está sigue marcado "Aqui" y deshabilitado', () => {
    const html = pintar(PRODUCCION, true)
    const actual = botonDe(html, 'SOENA')
    expect(actual).toContain('Aqui')
    expect(actual).toContain('disabled=""')
    // Y un tercero sí es alcanzable desde aquí: es el punto del cambio.
    const otro = botonDe(html, 'Trappvel')
    expect(otro).not.toContain('disabled=""')
    expect(otro).not.toContain('Aqui')
  })
})
