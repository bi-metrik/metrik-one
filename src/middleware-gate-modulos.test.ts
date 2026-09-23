/**
 * El gate por módulo, de punta a punta en el middleware: la petición entra con un host y una
 * ruta, y lo que se afirma es la respuesta (redirect o no). Las funciones puras ya tienen sus
 * pruebas en `lib/modulos/gate.test.ts`; esta fija que el middleware efectivamente las llama en
 * las dos ramas (subdominio del tenant y dominio base) y que no rompe el guard del contador.
 *
 * Por qué importa que esté en el middleware y no en el layout: en una navegación con `<Link>`
 * el layout compartido no vuelve a correr (medido con Next 16.1.6, ver `gate.ts`). Quitar el
 * gate de aquí deja abiertas las rutas aunque el layout las mirara.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { workspaceMedido } from '@/lib/modulos/__fixtures__/workspaces-2026-09-15'
import { SELECT_PERFIL_BASE } from '@/lib/modulos/perfil-de-acceso'

interface Perfil {
  role: string
  platform_admin?: boolean
  slug: string
}

let perfil: Perfil | null = null
let errorPerfil: { message: string } | null = null
const selects: string[] = []

function dobleSupabase() {
  return {
    from(tabla: string) {
      if (tabla !== 'profiles') throw new Error(`consulta inesperada a ${tabla}`)
      return {
        select(columnas: string) {
          selects.push(columnas)
          return {
            eq() {
              return {
                single: async () => {
                  if (errorPerfil || !perfil) return { data: null, error: errorPerfil ?? { message: 'sin fila' } }
                  const w = workspaceMedido(perfil.slug)
                  return {
                    data: {
                      role: perfil.role,
                      platform_admin: perfil.platform_admin ?? false,
                      // El slug va en el embed porque desde el 2026-09-19 el middleware
                      // también compara la pestaña contra la sesión; acá los dos coinciden
                      // siempre, así que ese guard queda inerte y lo que se mide es el gate.
                      workspace: {
                        slug: perfil.slug,
                        modules: w.modules,
                        modo_vitrina: w.modoVitrina ? true : null,
                      },
                    },
                    error: null,
                  }
                },
              }
            },
          }
        },
      }
    },
  }
}

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async () => ({
    user: { id: 'u1' },
    supabaseResponse: NextResponse.next(),
    supabase: dobleSupabase(),
  }),
}))

const { middleware } = await import('./middleware')

async function pedir(host: string, ruta: string) {
  const res = await middleware(new NextRequest(`http://${host}${ruta}`, { headers: { host } }))
  const location = res.headers.get('location')
  return location ? new URL(location).pathname : null
}

const TENANT = 'cda-caqueta.localhost:3000'
const DOMINIO_BASE = 'localhost:3000'

beforeEach(() => {
  perfil = null
  errorPerfil = null
  selects.length = 0
})

describe('middleware: gate por módulo', () => {
  it('un CDA no abre /negocios en su subdominio: va a /valida', async () => {
    perfil = { role: 'owner', slug: 'cda-caqueta' }
    expect(await pedir(TENANT, '/negocios')).toBe('/valida')
    expect(await pedir(TENANT, '/negocios/abc/archivos')).toBe('/valida')
  })

  it('tampoco por el dominio base (preview, localhost o metrikone.co con sesión)', async () => {
    perfil = { role: 'owner', slug: 'cda-caqueta' }
    expect(await pedir(DOMINIO_BASE, '/negocios')).toBe('/valida')
  })

  it('lo que el CDA sí tiene abre: Valida, Suscripción, la vitrina de Tableros y lo común', async () => {
    perfil = { role: 'operator', slug: 'cda-caqueta' }
    expect(await pedir(TENANT, '/valida')).toBeNull()
    expect(await pedir(TENANT, '/suscripcion')).toBeNull()
    expect(await pedir(TENANT, '/tableros')).toBeNull()
    expect(await pedir(TENANT, '/servicios')).toBeNull()
  })

  it('Números ya no abre en un CDA: usa ONE solo con Valida', async () => {
    perfil = { role: 'operator', slug: 'cda-caqueta' }
    expect(await pedir(TENANT, '/numeros')).not.toBeNull()
  })

  it('un workspace con Clarity abre /negocios igual que antes', async () => {
    perfil = { role: 'operator', slug: 'soena' }
    expect(await pedir('soena.localhost:3000', '/negocios')).toBeNull()
    expect(await pedir(DOMINIO_BASE, '/negocios')).toBeNull()
  })

  it('el platform admin pasa', async () => {
    perfil = { role: 'owner', platform_admin: true, slug: 'cda-caqueta' }
    expect(await pedir(TENANT, '/negocios')).toBeNull()
  })

  it('una ruta sin módulo no pide los módulos: el guard del contador lee solo el rol, como antes', async () => {
    perfil = { role: 'owner', slug: 'cda-caqueta' }
    await pedir(TENANT, '/servicios')
    expect(selects).toEqual([SELECT_PERFIL_BASE])
    selects.length = 0
    await pedir(TENANT, '/negocios')
    expect(selects).toHaveLength(1)
    expect(selects[0]).toContain('workspaces!profiles_workspace_id_fkey')
  })

  it('si el perfil no se puede leer, la ruta pasa (RLS sigue ahí) y se registra', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    errorPerfil = { message: 'caida' }
    expect(await pedir(TENANT, '/negocios')).toBeNull()
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

describe('middleware: el guard del contador no cambia', () => {
  it('un contador fuera de /revision va a /revision', async () => {
    perfil = { role: 'contador', slug: 'soena' }
    expect(await pedir('soena.localhost:3000', '/numeros')).toBe('/revision')
  })

  it('un contador en /revision de un workspace sin Clarity no rebota entre los dos guards', async () => {
    perfil = { role: 'contador', slug: 'regat' }
    expect(await pedir('regat.localhost:3000', '/revision')).toBeNull()
  })
})
