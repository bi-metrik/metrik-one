/**
 * El selector del platform admin pinta los workspaces BAJO SU ENCABEZADO de grupo.
 *
 * La regla (orden de grupos, alfabético adentro, "Sin clasificar" al final) vive y se prueba en
 * `src/lib/workspace/grupo.test.ts`. Lo que fija esta prueba es un hecho de pantalla que esas
 * pruebas no ven: que el desplegable use la agrupación en vez de pintar la lista plana.
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
  ws('alma-afi', 'ALMA — Concesion Alto Magdalena', 'clarity'),
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

function pintar(workspaces: WorkspaceSummary[]): string {
  const state: PlatformAdminState = {
    platformAdmin: true,
    currentWorkspace: workspaces.find(w => w.slug === 'metrik') ?? null,
    homeWorkspace: workspaces.find(w => w.slug === 'metrik') ?? null,
    workspaces,
    isAway: false,
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

describe('selector del platform admin agrupado', () => {
  it('guardia: el desplegable se pinta abierto (si no, las demás pruebas pasarían vacías)', () => {
    expect(pintar(PRODUCCION)).toContain('Buscar workspace...')
  })

  it('producción: encabezados MéTRIK, Valida, Clarity y Demo, alfabético dentro de cada uno', () => {
    expect(grupos(pintar(PRODUCCION))).toEqual([
      ['MéTRIK', ['MeTRIK']],
      ['Valida', ['CDA del Caquetá', 'CDA El Carmen', 'CDA Puerto Test', 'Maxitec — CDA S.A.S.']],
      [
        'Clarity',
        [
          'AFI International Group S.A.S.',
          'ALMA — Concesion Alto Magdalena',
          'Dimpro',
          'SOENA',
          'Termotech SAS',
          'Trappvel',
          'WMC SM SAS',
        ],
      ],
      ['Demo', ['Estudio Creativo Lúmina']],
    ])
  })

  it('el encabezado se ve como texto, no solo como atributo', () => {
    const html = pintar(PRODUCCION)
    for (const etiqueta of ['MéTRIK', 'Valida', 'Clarity', 'Demo']) {
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
    expect(g).toHaveLength(5)
  })
})
