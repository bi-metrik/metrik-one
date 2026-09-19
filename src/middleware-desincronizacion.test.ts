/**
 * El guard de pestaña desincronizada, de punta a punta en el middleware.
 *
 * Por qué vive acá y no en `(app)/layout.tsx`: en una navegación del lado del cliente Next
 * solo renderiza los segmentos que cambian, así que el layout compartido NO vuelve a correr y
 * su guard no se entera. Medido el 2026-09-19 contra `next dev` con un clic real en el menú,
 * con la sesión en `metrik` y la pestaña en `soena`:
 *
 *   - clic en «Movimientos»  -> GET /movimientos?_rsc=… 200, y la pantalla pintó /movimientos
 *     NORMAL, con el nombre del inquilino viejo en la barra y CERO avisos;
 *   - clic en «Workflows» (una de las pantallas que hace `redirect('/login')` cuando no hay
 *     workspace) -> GET /flujo?_rsc=… 200 y luego GET /login?_rsc=… 200: la pestaña terminó en
 *     el formulario de inicio de sesión, con la sesión viva y sin un solo aviso;
 *   - recargando la misma URL (carga completa de documento) el aviso SÍ salía.
 *
 * O sea: el guard del layout solo existía en la recarga. Estas pruebas fijan que ahora el
 * middleware lo aplica en toda navegación, y —igual de importante— que NO lo aplica donde
 * rompería algo: los server actions (POST), `/api`, y la propia pantalla del aviso.
 *
 * VISTAS FALLAR (2026-09-19), seis mutaciones, y entre las seis cae cada uno de los 12 casos
 * (las que afirman que el guard NO se dispara solo pueden caer con una mutación que lo deje
 * siempre activo, así que hacen falta las dos direcciones):
 *
 *   1. guard apagado (`if (false)`)                                  -> 3 rojas
 *   2. sin el filtro `esNavegacion` (redirige POST y /api)           -> 2 rojas
 *   3. guard siempre activo (sin comparar los slugs)                 -> 4 rojas
 *   4. sin la excepción de `/pestana-desincronizada` en el contador  -> 2 rojas
 *   5. el mismo guard también en la rama del dominio base            -> 1 roja
 *   6. el guard pide el perfil por su cuenta (una consulta más)      -> 1 roja
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { RUTA_DESINCRONIZADA } from '@/lib/tenant/desincronizacion'

interface Perfil {
  role: string
  /** Slug del workspace que tiene la SESIÓN (`profiles.workspace_id`). */
  slug: string | null
}

let perfil: Perfil | null = { role: 'owner', slug: 'metrik' }
let errorPerfil: { message: string } | null = null
let consultas = 0

function dobleSupabase() {
  return {
    from(tabla: string) {
      if (tabla !== 'profiles') throw new Error(`consulta inesperada a ${tabla}`)
      return {
        select() {
          return {
            eq() {
              return {
                single: async () => {
                  consultas += 1
                  if (errorPerfil || !perfil) {
                    return { data: null, error: errorPerfil ?? { message: 'sin fila' } }
                  }
                  return {
                    data: {
                      role: perfil.role,
                      platform_admin: false,
                      workspace_id: 'ws-1',
                      home_workspace_id: 'ws-1',
                      // `business` para que el gate por módulo deje pasar todo y lo único que
                      // se esté midiendo sea el guard de desincronización.
                      workspace: {
                        slug: perfil.slug,
                        modules: { business: true, conciliacion: true },
                        modo_vitrina: null,
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

/** El `pathname` del redirect, o null si la petición pasó. */
async function pedir(
  host: string,
  ruta: string,
  opciones: { metodo?: string; cabeceras?: Record<string, string> } = {},
) {
  const res = await middleware(
    new NextRequest(`http://${host}${ruta}`, {
      method: opciones.metodo ?? 'GET',
      headers: { host, ...(opciones.cabeceras ?? {}) },
    }),
  )
  const location = res.headers.get('location')
  return location ? new URL(location).pathname : null
}

const PESTANA = 'soena.localhost:3000'
const SESION = 'metrik.localhost:3000'

beforeEach(() => {
  perfil = { role: 'owner', slug: 'metrik' }
  errorPerfil = null
  consultas = 0
})

describe('middleware: la pestaña que quedó en otro espacio de trabajo', () => {
  it('manda la navegación al aviso, y no solo en la carga inicial', async () => {
    expect(await pedir(PESTANA, '/negocios')).toBe(RUTA_DESINCRONIZADA)
    expect(await pedir(PESTANA, '/negocios/abc')).toBe(RUTA_DESINCRONIZADA)
    expect(await pedir(PESTANA, '/movimientos')).toBe(RUTA_DESINCRONIZADA)
    // Una ruta común, sin módulo: el perfil se lee igual por el guard del contador.
    expect(await pedir(PESTANA, '/servicios')).toBe(RUTA_DESINCRONIZADA)
  })

  it('la navegación del lado del cliente (petición RSC) también va al aviso', async () => {
    // Es el hueco por el que se escapó: acá el layout de `(app)` no corre.
    expect(await pedir(PESTANA, '/movimientos', { cabeceras: { RSC: '1' } })).toBe(
      RUTA_DESINCRONIZADA,
    )
    expect(
      await pedir(PESTANA, '/negocios', {
        cabeceras: { RSC: '1', 'Next-Router-Prefetch': '1' },
      }),
    ).toBe(RUTA_DESINCRONIZADA)
  })

  it('la pestaña sincronizada no se entera de nada', async () => {
    expect(await pedir(SESION, '/negocios')).toBeNull()
    expect(await pedir(SESION, '/movimientos', { cabeceras: { RSC: '1' } })).toBeNull()
  })

  it('un server action NO se redirige: eso perdería la escritura sin decir nada', async () => {
    // A esos los corta `getWorkspace`, devolviendo `workspaceId: null`.
    expect(
      await pedir(PESTANA, '/negocios', {
        metodo: 'POST',
        cabeceras: { 'Next-Action': '7f3a2b' },
      }),
    ).toBeNull()
    expect(await pedir(PESTANA, '/negocios', { metodo: 'POST' })).toBeNull()
  })

  it('`/api` tampoco: quien espera JSON no sabe qué hacer con un 307 a una pantalla', async () => {
    expect(await pedir(PESTANA, '/api/negocios/export')).toBeNull()
  })

  it('la propia pantalla del aviso no se redirige a sí misma', async () => {
    expect(await pedir(PESTANA, RUTA_DESINCRONIZADA)).toBeNull()
  })

  it('un contador desincronizado ve el aviso, no rebota a /revision', async () => {
    perfil = { role: 'contador', slug: 'metrik' }
    expect(await pedir(PESTANA, '/numeros')).toBe(RUTA_DESINCRONIZADA)
    // Y desde el aviso NO lo mandan a /revision: si no, los dos guards se lo pasarían.
    expect(await pedir(PESTANA, RUTA_DESINCRONIZADA)).toBeNull()
  })

  it('el contador sincronizado sigue confinado a /revision', async () => {
    perfil = { role: 'contador', slug: 'metrik' }
    expect(await pedir(SESION, '/numeros')).toBe('/revision')
  })

  it('si el slug de la sesión no se pudo resolver, el guard no afirma nada', async () => {
    perfil = { role: 'owner', slug: null }
    expect(await pedir(PESTANA, '/negocios')).toBeNull()
  })

  it('si el perfil no se puede leer, la ruta pasa (RLS sigue ahí)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    errorPerfil = { message: 'caida' }
    expect(await pedir(PESTANA, '/negocios')).toBeNull()
    log.mockRestore()
  })

  it('en el dominio base es inerte: no hay subdominio de inquilino que comparar', async () => {
    expect(await pedir('localhost:3000', '/negocios')).toBeNull()
  })

  it('no cuesta una consulta nueva: sigue siendo UNA lectura del perfil por petición', async () => {
    consultas = 0
    await pedir(PESTANA, '/negocios')
    expect(consultas).toBe(1)
    consultas = 0
    await pedir(PESTANA, '/servicios')
    expect(consultas).toBe(1)
    consultas = 0
    await pedir(SESION, '/negocios')
    expect(consultas).toBe(1)
  })
})
