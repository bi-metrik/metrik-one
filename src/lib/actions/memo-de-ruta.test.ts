/**
 * El memo de las rutas (brief Trappvel del 2026-10-01, punto 3): dentro de una petición, la
 * sesión se resuelve una vez; fuera, nada cambia.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { enPeticionDeRuta, memoDeRuta } from './memo-de-ruta'

describe('memoDeRuta', () => {
  it('dentro de una petición, cinco llamadas son UN viaje, también si van a la vez', async () => {
    let n = 0
    const sesion = memoDeRuta(async () => { n++; return { workspaceId: 'ws' } })
    await enPeticionDeRuta(async () => {
      await sesion()
      await Promise.all([sesion(), sesion()])
      await sesion()
      await sesion()
    })
    expect(n).toBe(1)
  })

  it('cada petición tiene su memo: dos peticiones, dos viajes', async () => {
    let n = 0
    const sesion = memoDeRuta(async () => ++n)
    const [a, b] = await Promise.all([enPeticionDeRuta(() => sesion()), enPeticionDeRuta(() => sesion())])
    expect(n).toBe(2)
    expect(new Set([a, b]).size).toBe(2)
  })

  it('una petición dentro de otra (acción envuelta que llama a otra) REUSA el memo de afuera', async () => {
    let n = 0
    const sesion = memoDeRuta(async () => { n++ })
    await enPeticionDeRuta(async () => {
      await sesion()
      await enPeticionDeRuta(() => sesion())
    })
    expect(n).toBe(1)
  })

  it('fuera de una petición de ruta no memoiza: el resto de la app sigue igual', async () => {
    let n = 0
    const sesion = memoDeRuta(async () => { n++ })
    await sesion()
    await sesion()
    expect(n).toBe(2)
  })
})

describe('contrato · quién lo usa', () => {
  const fuente = (ruta: string) => readFileSync(join(process.cwd(), ruta), 'utf8')

  it('`getWorkspace` va por el memo (y por el `cache()` de React en el render)', () => {
    expect(fuente('src/lib/actions/get-workspace-impl.ts')).toContain('export const getWorkspaceCached = cache(memoDeRuta(getWorkspaceImpl))')
  })

  it('«Aceptar» y la relectura de la bandeja de Trappvel corren dentro de `enPeticionDeRuta`', () => {
    expect(fuente('src/app/api/cotizaciones/[id]/aceptar-captura/route.ts')).toContain('enPeticionDeRuta(() => aceptarCapturaDeBandeja(id, borrador))')
    expect(fuente('src/app/api/cotizaciones/[id]/vista/route.ts')).toContain('enPeticionDeRuta(() => leer(req, ctx))')
  })
})
