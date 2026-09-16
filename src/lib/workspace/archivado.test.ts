import { describe, it, expect } from 'vitest'
import { estaArchivado, armarSelectorDeWorkspaces, type WorkspaceConMarca } from './archivado'

const METRIK: WorkspaceConMarca = { id: 'w-metrik', slug: 'metrik', name: 'MéTRIK', archivado: null, grupo: 'metrik' }
const SOENA: WorkspaceConMarca = { id: 'w-soena', slug: 'soena', name: 'SOENA', archivado: null, grupo: 'clarity' }
const ADVISE: WorkspaceConMarca = { id: 'w-advise', slug: 'advise', name: 'Advise', archivado: true }
const HJBC: WorkspaceConMarca = { id: 'w-hjbc', slug: 'hjbc', name: 'HJBC', archivado: true, grupo: 'Clarity' }

const TODOS = [ADVISE, HJBC, METRIK, SOENA]

describe('estaArchivado', () => {
  it('solo el booleano JSON true archiva', () => {
    expect(estaArchivado(true)).toBe(true)
  })

  it('un dato mal escrito deja el workspace a la vista', () => {
    expect(estaArchivado('true')).toBe(false)
    expect(estaArchivado(1)).toBe(false)
    expect(estaArchivado(false)).toBe(false)
    expect(estaArchivado(null)).toBe(false)
    expect(estaArchivado(undefined)).toBe(false)
  })
})

describe('armarSelectorDeWorkspaces', () => {
  it('saca los archivados de la lista para escoger y conserva el orden', () => {
    const r = armarSelectorDeWorkspaces(TODOS, METRIK.id, METRIK.id)
    expect(r.workspaces.map(w => w.slug)).toEqual(['metrik', 'soena'])
  })

  it('sin ninguna marca la lista queda igual que antes', () => {
    const sinMarca = TODOS.map(w => ({ ...w, archivado: undefined }))
    const r = armarSelectorDeWorkspaces(sinMarca, METRIK.id, METRIK.id)
    expect(r.workspaces.map(w => w.slug)).toEqual(['advise', 'hjbc', 'metrik', 'soena'])
  })

  it('parado DENTRO de un archivado, la barra sigue sabiendo dónde está y a dónde volver', () => {
    const r = armarSelectorDeWorkspaces(TODOS, ADVISE.id, METRIK.id)
    expect(r.currentWorkspace).toEqual({ id: 'w-advise', slug: 'advise', name: 'Advise', grupo: 'sin_clasificar' })
    expect(r.homeWorkspace).toEqual({ id: 'w-metrik', slug: 'metrik', name: 'MéTRIK', grupo: 'metrik' })
    expect(r.workspaces.some(w => w.id === ADVISE.id)).toBe(false)
  })

  it('un home archivado también se resuelve', () => {
    const r = armarSelectorDeWorkspaces(TODOS, SOENA.id, HJBC.id)
    expect(r.homeWorkspace?.slug).toBe('hjbc')
  })

  it('no filtra la marca hacia el cliente: el resumen solo trae id, slug, name y el grupo ya normalizado', () => {
    const r = armarSelectorDeWorkspaces(TODOS, ADVISE.id, METRIK.id)
    for (const w of [...r.workspaces, r.currentWorkspace, r.homeWorkspace]) {
      expect(Object.keys(w ?? {}).sort()).toEqual(['grupo', 'id', 'name', 'slug'])
    }
  })

  it('el grupo viaja normalizado: una clave desconocida o ausente llega como sin_clasificar', () => {
    const r = armarSelectorDeWorkspaces(TODOS, HJBC.id, METRIK.id)
    expect(r.workspaces.map(w => [w.slug, w.grupo])).toEqual([['metrik', 'metrik'], ['soena', 'clarity']])
    expect(r.currentWorkspace?.grupo).toBe('sin_clasificar')
  })

  it('sin home ni actual resolubles devuelve null, no revienta', () => {
    const r = armarSelectorDeWorkspaces(TODOS, 'w-borrado', null)
    expect(r.currentWorkspace).toBeNull()
    expect(r.homeWorkspace).toBeNull()
  })
})
