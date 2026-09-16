import { describe, it, expect } from 'vitest'
import { grupoDeWorkspace, agruparWorkspaces } from './grupo'

// Los 13 workspaces NO archivados de producción, leídos el 2026-09-16 (slug, name y
// `config_extra->grupo`), en el orden en que llegan de la consulta (`order('name')`).
const PRODUCCION_2026_09_16 = [
  { slug: 'afi', name: 'AFI International Group S.A.S.', grupo: 'clarity' },
  { slug: 'alma-afi', name: 'ALMA — Concesion Alto Magdalena', grupo: 'clarity' },
  { slug: 'cda-caqueta', name: 'CDA del Caquetá', grupo: 'valida' },
  { slug: 'cda-elcarmen', name: 'CDA El Carmen', grupo: 'valida' },
  { slug: 'cda-puertotest', name: 'CDA Puerto Test', grupo: 'valida' },
  { slug: 'dimpro', name: 'Dimpro', grupo: 'clarity' },
  { slug: 'ana-demo', name: 'Estudio Creativo Lúmina', grupo: 'demo' },
  { slug: 'maxitec', name: 'Maxitec — CDA S.A.S.', grupo: 'valida' },
  { slug: 'metrik', name: 'MeTRIK', grupo: 'metrik' },
  { slug: 'soena', name: 'SOENA', grupo: 'clarity' },
  { slug: 'termotech', name: 'Termotech SAS', grupo: 'clarity' },
  { slug: 'trappvel', name: 'Trappvel', grupo: 'clarity' },
  { slug: 'wmc-sm', name: 'WMC SM SAS', grupo: 'clarity' },
]

function resumen(grupos: ReturnType<typeof agruparWorkspaces<{ slug: string; name: string; grupo?: unknown }>>) {
  return grupos.map(g => [g.etiqueta, g.workspaces.map(w => w.slug)])
}

describe('grupoDeWorkspace', () => {
  it('reconoce las cuatro claves', () => {
    expect(grupoDeWorkspace('metrik')).toBe('metrik')
    expect(grupoDeWorkspace('valida')).toBe('valida')
    expect(grupoDeWorkspace('clarity')).toBe('clarity')
    expect(grupoDeWorkspace('demo')).toBe('demo')
  })

  it('ausente, vacío, mal escrito o de otro tipo cae en sin clasificar', () => {
    for (const v of [undefined, null, '', 'Valida', ' valida', 'nativo', 'otro', true, 1, {}]) {
      expect(grupoDeWorkspace(v)).toBe('sin_clasificar')
    }
  })

  it('es idempotente sobre una clave ya normalizada', () => {
    expect(grupoDeWorkspace(grupoDeWorkspace('valida'))).toBe('valida')
    expect(grupoDeWorkspace(grupoDeWorkspace('xyz'))).toBe('sin_clasificar')
  })
})

describe('agruparWorkspaces', () => {
  it('producción: MéTRIK primero, luego Valida, Clarity y Demo; alfabético adentro', () => {
    expect(resumen(agruparWorkspaces(PRODUCCION_2026_09_16))).toEqual([
      ['MéTRIK', ['metrik']],
      ['Valida', ['cda-caqueta', 'cda-elcarmen', 'cda-puertotest', 'maxitec']],
      ['Clarity', ['afi', 'alma-afi', 'dimpro', 'soena', 'termotech', 'trappvel', 'wmc-sm']],
      ['Demo', ['ana-demo']],
    ])
  })

  it('el orden de grupos no depende del orden de llegada', () => {
    const alReves = [...PRODUCCION_2026_09_16].reverse()
    expect(agruparWorkspaces(alReves).map(g => g.clave)).toEqual(['metrik', 'valida', 'clarity', 'demo'])
  })

  it('MéTRIK va primero aunque su nombre ordene después de los demás', () => {
    const r = agruparWorkspaces([
      { slug: 'a', name: 'Aaa', grupo: 'demo' },
      { slug: 'z', name: 'Zzz MéTRIK', grupo: 'metrik' },
    ])
    expect(r.map(g => g.clave)).toEqual(['metrik', 'demo'])
  })

  it('un grupo ausente o desconocido NO esconde el workspace: va a "Sin clasificar", al final', () => {
    const r = agruparWorkspaces([
      { slug: 'nuevo', name: 'Nuevo', grupo: undefined },
      { slug: 'typo', name: 'Aaa Typo', grupo: 'Clarity' },
      { slug: 'soena', name: 'SOENA', grupo: 'clarity' },
    ])
    expect(resumen(r)).toEqual([
      ['Clarity', ['soena']],
      ['Sin clasificar', ['typo', 'nuevo']],
    ])
  })

  it('no pierde ni duplica workspaces', () => {
    const r = agruparWorkspaces(PRODUCCION_2026_09_16)
    const slugs = r.flatMap(g => g.workspaces.map(w => w.slug)).sort()
    expect(slugs).toEqual(PRODUCCION_2026_09_16.map(w => w.slug).sort())
  })

  it('los grupos vacíos no aparecen (ej. tras filtrar por la búsqueda)', () => {
    const soloCdas = PRODUCCION_2026_09_16.filter(w => w.name.toLowerCase().includes('cda'))
    expect(resumen(agruparWorkspaces(soloCdas))).toEqual([
      ['Valida', ['cda-caqueta', 'cda-elcarmen', 'cda-puertotest', 'maxitec']],
    ])
    expect(agruparWorkspaces([])).toEqual([])
  })

  it('alfabético en español: ignora tildes y mayúsculas, desempata por slug', () => {
    const r = agruparWorkspaces([
      { slug: 'b', name: 'Ñandú', grupo: 'demo' },
      { slug: 'c', name: 'ábaco', grupo: 'demo' },
      { slug: 'a2', name: 'Nube', grupo: 'demo' },
      { slug: 'a1', name: 'nube', grupo: 'demo' },
    ])
    expect(r[0].workspaces.map(w => w.slug)).toEqual(['c', 'a1', 'a2', 'b'])
  })

  it('no reordena la lista de entrada', () => {
    const entrada = [...PRODUCCION_2026_09_16]
    agruparWorkspaces(entrada)
    expect(entrada).toEqual(PRODUCCION_2026_09_16)
  })
})
