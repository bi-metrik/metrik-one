/**
 * El desplegable "Todos los workspaces" de /admin/workflows usa los mismos encabezados y el mismo
 * orden que el selector del platform admin (regla en `src/lib/workspace/grupo.ts`).
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import type { AdminLineaItem } from './actions'
import WorkflowsList from './workflows-list'

function linea(slug: string, nombre: string, grupo: AdminLineaItem['workspace_grupo'], i: number): AdminLineaItem {
  return {
    workspace_id: `w-${slug}`,
    workspace_slug: slug,
    workspace_name: nombre,
    workspace_grupo: grupo,
    linea_id: `l-${slug}-${i}`,
    linea_nombre: `Línea ${i}`,
    linea_tipo: 'clarity',
    is_active: true,
    total_etapas: 1,
    total_bloques: 1,
  }
}

// Orden de llegada = `order('nombre')` de líneas, que no tiene nada que ver con el de workspaces.
const ITEMS: AdminLineaItem[] = [
  linea('soena', 'SOENA', 'clarity', 1),
  linea('ana-demo', 'Estudio Creativo Lúmina', 'demo', 2),
  linea('metrik', 'MeTRIK', 'metrik', 3),
  linea('afi', 'AFI International Group S.A.S.', 'clarity', 4),
  linea('maxitec', 'Maxitec — CDA S.A.S.', 'valida', 5),
  linea('soena', 'SOENA', 'clarity', 6),
  linea('suelto', 'Workspace sin grupo', 'sin_clasificar', 7),
  linea('alma-afi', 'ALMA — Concesion Alto Magdalena', 'sustenta', 8),
]

function desplegable(html: string): Array<[string, string[]]> {
  const select = html.split('Todos los workspaces')[1].split('</select>')[0]
  return select
    .split('<optgroup')
    .slice(1)
    .map(g => [
      /label="([^"]+)"/.exec(g)?.[1] ?? '?',
      [...g.matchAll(/<option value="[^"]*">([^<]+)<\/option>/g)].map(m => m[1]),
    ])
}

describe('desplegable de workspaces en /admin/workflows', () => {
  it('agrupa por tipología en el orden fijo, sin repetir workspaces', () => {
    const html = renderToStaticMarkup(React.createElement(WorkflowsList, { items: ITEMS }))
    expect(desplegable(html)).toEqual([
      ['MéTRIK', ['MeTRIK']],
      ['Valida', ['Maxitec — CDA S.A.S.']],
      ['Clarity', ['AFI International Group S.A.S.', 'SOENA']],
      ['Sustenta', ['ALMA — Concesion Alto Magdalena']],
      ['Demo', ['Estudio Creativo Lúmina']],
      ['Sin clasificar', ['Workspace sin grupo']],
    ])
  })
})
