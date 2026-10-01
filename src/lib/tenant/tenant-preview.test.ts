import { describe, it, expect } from 'vitest'
import {
  accionTenantPreview,
  entradaDeWorkspaceEnPreview,
  esDeploymentDePreview,
  limpiarSlugDePreview,
  slugTenantDePreview,
} from './tenant-preview'

describe('esDeploymentDePreview', () => {
  it('solo un preview de Vercel cuenta como preview', () => {
    expect(esDeploymentDePreview('preview')).toBe(true)
    expect(esDeploymentDePreview('production')).toBe(false)
    expect(esDeploymentDePreview('development')).toBe(false)
    expect(esDeploymentDePreview(undefined)).toBe(false)
    expect(esDeploymentDePreview('')).toBe(false)
  })
})

describe('limpiarSlugDePreview', () => {
  it('acepta un slug normal y lo normaliza', () => {
    expect(limpiarSlugDePreview('trappvel')).toBe('trappvel')
    expect(limpiarSlugDePreview('  Trappvel ')).toBe('trappvel')
    expect(limpiarSlugDePreview('ws-2')).toBe('ws-2')
  })

  it('descarta basura, rutas y slugs reservados', () => {
    expect(limpiarSlugDePreview('')).toBeNull()
    expect(limpiarSlugDePreview(null)).toBeNull()
    expect(limpiarSlugDePreview('../admin')).toBeNull()
    expect(limpiarSlugDePreview('trappvel.metrikone.co')).toBeNull()
    expect(limpiarSlugDePreview('-trappvel')).toBeNull()
    expect(limpiarSlugDePreview('www')).toBeNull()
    expect(limpiarSlugDePreview('admin')).toBeNull()
  })
})

describe('slugTenantDePreview (criterio 3: producción no cambia)', () => {
  it('en un preview la cookie declara el inquilino', () => {
    expect(slugTenantDePreview('trappvel', 'preview')).toBe('trappvel')
  })

  it('en producción y en local la cookie se ignora', () => {
    expect(slugTenantDePreview('trappvel', 'production')).toBeNull()
    expect(slugTenantDePreview('trappvel', undefined)).toBeNull()
  })

  it('una cookie inválida no declara nada', () => {
    expect(slugTenantDePreview('<script>', 'preview')).toBeNull()
  })
})

describe('accionTenantPreview', () => {
  it('?__ws=<slug> fija el inquilino en un preview', () => {
    expect(accionTenantPreview('trappvel', 'preview')).toEqual({ tipo: 'fijar', slug: 'trappvel' })
  })

  it('?__ws=off lo quita', () => {
    expect(accionTenantPreview('off', 'preview')).toEqual({ tipo: 'quitar' })
  })

  it('un slug inválido quita en vez de dejar el anterior', () => {
    expect(accionTenantPreview('no válido', 'preview')).toEqual({ tipo: 'quitar' })
  })

  it('sin parámetro no hay nada que hacer', () => {
    expect(accionTenantPreview(null, 'preview')).toBeNull()
  })

  it('en producción el parámetro no hace nada', () => {
    expect(accionTenantPreview('trappvel', 'production')).toBeNull()
    expect(accionTenantPreview('trappvel', undefined)).toBeNull()
  })
})

describe('entradaDeWorkspaceEnPreview', () => {
  it('es relativa al host actual (no sale a producción)', () => {
    expect(entradaDeWorkspaceEnPreview('trappvel')).toBe('/?__ws=trappvel')
    expect(entradaDeWorkspaceEnPreview('Trappvel ').startsWith('/')).toBe(true)
  })
})
