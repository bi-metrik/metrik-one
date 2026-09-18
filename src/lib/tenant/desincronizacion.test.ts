/**
 * La regla de "esta pestaña quedó en otro inquilino", aislada.
 *
 * Es deliberadamente conservadora: solo dice que sí cuando conoce los DOS lados. El
 * cableado (que `getWorkspace` la aplique y corte el `workspaceId`) se fija en
 * `src/lib/actions/get-workspace-impl.test.ts`; acá se fija el criterio.
 *
 * Los dos casos que parecen de adorno no lo son: el del slug con ruido invisible viene
 * de que `NEXT_PUBLIC_BASE_DOMAIN` ya llegó a producción con un salto de línea pegado y
 * rompió el routing de TODOS los inquilinos (ver `extract-slug.ts`). Acá el mismo ruido
 * dejaría al usuario encerrado en una pantalla que le dice que su pestaña está mal.
 */
import { describe, it, expect } from 'vitest'
import { hayDesincronizacionDeTenant, urlDeWorkspace } from './desincronizacion'

describe('hayDesincronizacionDeTenant', () => {
  it('slugs distintos: la pestaña está desincronizada', () => {
    expect(hayDesincronizacionDeTenant('soena', 'metrik')).toBe(true)
  })

  it('el mismo slug: no pasa nada', () => {
    expect(hayDesincronizacionDeTenant('soena', 'soena')).toBe(false)
  })

  it('sin cabecera de inquilino es inerte', () => {
    expect(hayDesincronizacionDeTenant(null, 'soena')).toBe(false)
    expect(hayDesincronizacionDeTenant(undefined, 'soena')).toBe(false)
    expect(hayDesincronizacionDeTenant('', 'soena')).toBe(false)
  })

  it('sin slug de sesión tampoco afirma nada', () => {
    expect(hayDesincronizacionDeTenant('soena', null)).toBe(false)
    expect(hayDesincronizacionDeTenant('soena', undefined)).toBe(false)
    expect(hayDesincronizacionDeTenant('soena', '')).toBe(false)
  })

  it('espacios en blanco a cada lado no son un slug', () => {
    expect(hayDesincronizacionDeTenant('   ', 'soena')).toBe(false)
    expect(hayDesincronizacionDeTenant('soena', '\n')).toBe(false)
  })

  it('mayúsculas y saltos de línea pegados no cuentan como diferencia', () => {
    expect(hayDesincronizacionDeTenant(' SOENA\n', 'soena')).toBe(false)
    expect(hayDesincronizacionDeTenant('soena', 'Soena ')).toBe(false)
  })
})

describe('urlDeWorkspace', () => {
  it('arma la raíz del subdominio en producción', () => {
    expect(urlDeWorkspace('soena', 'metrikone.co')).toBe('https://soena.metrikone.co/')
  })

  it('en desarrollo el subdominio va por http', () => {
    expect(urlDeWorkspace('soena', 'localhost:3000', true)).toBe('http://soena.localhost:3000/')
  })

  it('el dominio base con un salto de línea pegado no rompe la URL', () => {
    expect(urlDeWorkspace('soena', 'metrikone.co\n')).toBe('https://soena.metrikone.co/')
  })
})
