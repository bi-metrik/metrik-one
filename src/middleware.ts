import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { landingForWorkspace } from '@/lib/auth/landing'
import { extractSlug } from '@/lib/tenant/extract-slug'
import { destinoTrasAutenticar, esRelativo } from '@/lib/tenant/destino-tenant'
import { destinoSiBloqueada, rutaGateada } from '@/lib/modulos/gate'
import { leerPerfilDeAcceso, type ClientePerfil } from '@/lib/modulos/perfil-de-acceso'
import { RUTA_DESINCRONIZADA, hayDesincronizacionDeTenant } from '@/lib/tenant/desincronizacion'

const IS_DEV = process.env.NODE_ENV === 'development'

/**
 * ¿Esta petición es una NAVEGACIÓN? Solo a esas se las manda al aviso de pestaña
 * desincronizada.
 *
 * Un server action es un POST a la misma URL de la pantalla: redirigirlo perdería la
 * escritura sin decir nada. A esos los corta `getWorkspace`, que devuelve `workspaceId: null`
 * (ver `lib/tenant/desincronizacion.ts`) y es el guard que impide que el dato caiga en el
 * inquilino equivocado. `/api` queda fuera por lo mismo: un cliente que espera JSON no sabe
 * qué hacer con un 307 a una pantalla.
 */
function esNavegacion(request: NextRequest): boolean {
  const metodo = request.method.toUpperCase()
  if (metodo !== 'GET' && metodo !== 'HEAD') return false
  if (request.headers.get('next-action')) return false
  if (request.nextUrl.pathname.startsWith('/api/')) return false
  return true
}

/**
 * Propaga las cookies de sesion refrescadas (las que `updateSession` escribio en
 * `supabaseResponse` via el callback `setAll`) sobre CUALQUIER NextResponse que el
 * middleware arme (redirect o next). Sin esto, cuando Supabase rota el refresh token
 * y el middleware redirige con una respuesta nueva y vacia, el browser se queda con el
 * token viejo (ya invalidado) -> la siguiente request falla -> bounce a /login.
 * Pitfall documentado de Supabase SSR: "copy over the cookies when creating a new
 * NextResponse, or the session terminates prematurely".
 */
function withAuthCookies(response: NextResponse, supabaseResponse: NextResponse): NextResponse {
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie)
  })
  return response
}

/** Role-aware landing: check permissions + workspace config */
async function getLanding(supabase: Awaited<ReturnType<typeof updateSession>>['supabase'], role?: string, workspaceId?: string): Promise<string> {
  let modules: Record<string, boolean> | null = null
  let modoVitrina = false
  if (workspaceId) {
    const { data: ws } = await supabase
      .from('workspaces')
      .select('modules, config_extra')
      .eq('id', workspaceId)
      .single()
    modules = (ws?.modules as Record<string, boolean> | null) ?? null
    modoVitrina = (ws?.config_extra as { modo_vitrina?: boolean } | null)?.modo_vitrina === true
  }
  // Fuente unica de verdad (compartida con callback de auth y accept-invite)
  return landingForWorkspace(role, modules, modoVitrina)
}

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || ''
  const slug = extractSlug(hostname)
  const { pathname } = request.nextUrl

  // La tarjeta Open Graph por inquilino es publica y no depende de sesion: quien
  // la pide es el rastreador de WhatsApp o LinkedIn, que llega sin cookies. Se
  // corta ANTES de `updateSession` por dos razones: no gastar un viaje a Auth en
  // cada scrape, y sobre todo que la respuesta pueda quedar cacheada en el CDN
  // (una respuesta con `Set-Cookie` no la cachea). Su contenido depende solo del
  // slug de la ruta. Ver `app/api/og/[slug]/route.tsx`.
  if (pathname.startsWith('/api/og/')) return NextResponse.next()

  // El endpoint del módulo Ferretería lo llaman escritores SIN sesión (el agente de MeTRIK y el
  // cron del Mac) con `Authorization: Bearer fer_...`. No tiene cookies que refrescar, y en un
  // subdominio el `!user` de abajo lo mandaría a `/login` con un 307 que un cliente de JSON no
  // entiende. La ruta autentica sola (ver `lib/ferreteria/api.ts`).
  if (pathname.startsWith('/api/ferreteria/')) return NextResponse.next()

  // Refresh Supabase session
  const { user, supabaseResponse, supabase } = await updateSession(request)

  // --- TENANT SUBDOMAIN ROUTES ---
  if (slug) {
    // El slug del inquilino tiene que llegar al SERVER COMPONENT, y la unica via es una
    // cabecera de REQUEST: en la funcion serverless que renderiza, el `host` y el
    // `x-forwarded-host` NO traen el subdominio (por eso `/login` ya hacia este mismo
    // rewrite). Puesto solo en la respuesta, como estaba, el servidor nunca lo veia: la
    // pestaña no tenia forma de saber en que inquilino la abrieron, y el workspace se
    // resolvia siempre desde `profiles.workspace_id`, que es global por usuario.
    // Cero lecturas nuevas: el slug ya esta calculado arriba.
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-tenant-slug', slug)
    const respuestaTenant = () => {
      const res = withAuthCookies(
        NextResponse.next({ request: { headers: requestHeaders } }),
        supabaseResponse,
      )
      // Se conserva tambien en la respuesta: es lo que habia y sirve para diagnosticar
      // desde el navegador de que inquilino vino un render.
      res.headers.set('x-tenant-slug', slug)
      return res
    }

    // Rutas publicas permitidas en el subdomain sin sesion
    if (pathname.startsWith('/auth/callback')) return respuestaTenant()
    if (pathname === '/login') {
      // Reenviar el slug del tenant al server component. En el edge (aqui) el host
      // es correcto; en la funcion serverless que renderiza /login,
      // headers().get('host')/x-forwarded-host NO traen el subdominio. Se pasa por
      // DOS vias: (1) rewrite con ?__ws=slug (URL que la funcion SIEMPRE recibe) y
      // (2) header de request x-tenant-slug (belt-and-suspenders), el mismo
      // `requestHeaders` que ahora usan todas las rutas del inquilino.
      const rwUrl = request.nextUrl.clone()
      rwUrl.searchParams.set('__ws', slug)
      return withAuthCookies(
        NextResponse.rewrite(rwUrl, { request: { headers: requestHeaders } }),
        supabaseResponse
      )
    }
    if (pathname === '/sin-espacio') return respuestaTenant()
    // Signup cerrado: registro / onboarding / invitaciones ya no existen -> al login
    if (pathname === '/registro' || pathname === '/onboarding' || pathname === '/accept-invite') {
      return withAuthCookies(NextResponse.redirect(new URL('/login', request.url)), supabaseResponse)
    }
    // Certificacion publica via QR (read-only, sin login). La pagina valida el
    // flag del workspace y solo expone lotes estado='publicado' via service-role.
    if (pathname.startsWith('/cert/')) return respuestaTenant()
    if (pathname.startsWith('/c/')) return respuestaTenant()
    // Muro proyectable (televisor del piso, sin login). La pagina valida el
    // modulo, el opt-in config_extra.muro_publico y el token de la URL, y solo
    // expone agregados sin dinero ni identificador de cliente.
    if (pathname.startsWith('/muro/')) return respuestaTenant()

    // Formulario publico de vinculacion de contrapartes (CCBF). La contraparte
    // NO tiene usuario en ONE: la credencial es el token del enlace, que la
    // pagina valida contra Valida. La marca que se pinta sale del workspace del
    // propio expediente, no de este subdominio.
    if (pathname.startsWith('/vinculacion/')) return respuestaTenant()

    // No autenticado → login DEL MISMO SUBDOMAIN (no marketing). Asi el magic link
    // siembra sesion en este subdomain via /auth/callback, en lugar de pasar por
    // marketing/login que redirigiria al subdomain del profile.workspace_id actual
    // (rompia el caso platform_admin tecleando un subdomain distinto al activo).
    if (!user) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirectTo', pathname)
      return withAuthCookies(NextResponse.redirect(loginUrl), supabaseResponse)
    }

    // Root → role-based landing
    if (pathname === '/') {
      const { data: tenantProfile } = await supabase
        .from('profiles')
        .select('role, workspace_id')
        .eq('id', user.id)
        .single()
      const landing = await getLanding(supabase, tenantProfile?.role ?? undefined, tenantProfile?.workspace_id ?? undefined)
      return withAuthCookies(NextResponse.redirect(new URL(landing, request.url)), supabaseResponse)
    }

    // Guard: contador can only access /revision.
    // `/suscripcion-suspendida` queda fuera del guard: es a donde manda el layout de
    // la app cuando el workspace está suspendido, y sin esta excepción un contador
    // rebotaría entre /revision (layout → suspendida) y aquí (guard → /revision).
    // `/pestana-desincronizada` queda fuera por la misma razón: el guard de abajo manda ahí,
    // y sin esta excepción un contador rebotaría entre esa pantalla y /revision para siempre.
    const aplicaGuardContador =
      pathname !== '/revision' && !pathname.startsWith('/revision/') && !pathname.startsWith('/auth/') &&
      pathname !== '/suscripcion-suspendida' && pathname !== RUTA_DESINCRONIZADA
    // Gate por módulo: una pantalla de un módulo apagado no abre (ver `lib/modulos/gate.ts`,
    // que explica por qué vive aquí y no en el layout). Comparte la lectura del perfil con
    // el guard del contador: una sola ida a la base, como antes.
    const aplicaGateModulo = rutaGateada(pathname)
    if (aplicaGuardContador || aplicaGateModulo) {
      const perfil = await leerPerfilDeAcceso(supabase as unknown as ClientePerfil, user.id, aplicaGateModulo)
      // ── La pestaña quedó en otro espacio de trabajo ──────────────────────
      // Va PRIMERO y va AQUÍ, no en `(app)/layout.tsx`: en una navegación del lado del
      // cliente Next solo renderiza los segmentos que cambian, así que el layout NO vuelve a
      // correr y su guard no se entera (medido el 2026-09-19: de /negocios a /movimientos por
      // `<Link>` la pantalla siguió pintando el inquilino viejo, sin un solo aviso). El
      // middleware, en cambio, corre en toda navegación.
      //
      // Cero consultas nuevas: el slug de la sesión viaja en el MISMO perfil que ya leían el
      // guard del contador y el gate por módulo, y el de la pestaña lo calculó `extractSlug`.
      // Inerte sin cabecera (dominio base, previews) y si el slug de la sesión no se pudo
      // leer, por las razones de `lib/tenant/desincronizacion.ts`.
      if (esNavegacion(request) && hayDesincronizacionDeTenant(slug, perfil.slugWorkspace)) {
        return withAuthCookies(
          NextResponse.redirect(new URL(RUTA_DESINCRONIZADA, request.url)),
          supabaseResponse,
        )
      }
      if (aplicaGuardContador && perfil.role === 'contador') {
        return withAuthCookies(NextResponse.redirect(new URL('/revision', request.url)), supabaseResponse)
      }
      const destino = perfil.gate ? destinoSiBloqueada(pathname, perfil.gate) : null
      if (destino) {
        return withAuthCookies(NextResponse.redirect(new URL(destino, request.url)), supabaseResponse)
      }
    }

    return respuestaTenant()
  }

  // --- MARKETING DOMAIN (no subdomain) ---

  // Dev workspace override: ?__ws=<slug> → setea cookie y redirige limpio
  if (IS_DEV) {
    const devWs = request.nextUrl.searchParams.get('__ws')
    if (devWs !== null) {
      const cleanUrl = new URL(request.url)
      cleanUrl.searchParams.delete('__ws')
      const res = withAuthCookies(NextResponse.redirect(cleanUrl), supabaseResponse)
      if (devWs === 'off') {
        res.cookies.delete('__dev_ws')
      } else {
        res.cookies.set('__dev_ws', devWs, { path: '/', httpOnly: true, sameSite: 'lax' })
      }
      return res
    }
  }

  if (pathname.startsWith('/auth/callback')) return supabaseResponse
  if (pathname === '/sin-espacio') return supabaseResponse

  // Signup cerrado: registro / onboarding / invitaciones -> al login
  if (pathname === '/registro' || pathname === '/onboarding' || pathname === '/accept-invite') {
    return withAuthCookies(NextResponse.redirect(new URL('/login', request.url)), supabaseResponse)
  }

  // Login page
  if (pathname === '/login') {
    if (user) {
      // Authenticated → check if has workspace → redirect to tenant subdomain
      const { data: profile } = await supabase
        .from('profiles')
        .select('workspace_id, role')
        .eq('id', user.id)
        .single()

      if (profile?.workspace_id) {
        const { data: ws } = await supabase
          .from('workspaces')
          .select('slug')
          .eq('id', profile.workspace_id)
          .single()

        if (ws?.slug) {
          const landing = await getLanding(supabase, profile.role ?? undefined, profile.workspace_id ?? undefined)
          // Fuente unica: en un preview (`*.vercel.app`) no hay subdominio del tenant
          // al que ir, asi que el destino se queda en el mismo host.
          const destino = destinoTrasAutenticar(ws.slug, landing, hostname)
          return withAuthCookies(
            NextResponse.redirect(esRelativo(destino) ? new URL(destino, request.url) : destino),
            supabaseResponse
          )
        }
      }

      // Usuario autenticado sin workspace → no hay self-serve, lo maneja /sin-espacio
      return withAuthCookies(NextResponse.redirect(new URL('/sin-espacio', request.url)), supabaseResponse)
    }
    return supabaseResponse
  }

  // Root of marketing domain
  if (pathname === '/') {
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('workspace_id, role')
        .eq('id', user.id)
        .single()

      if (profile?.workspace_id) {
        const { data: ws } = await supabase
          .from('workspaces')
          .select('slug')
          .eq('id', profile.workspace_id)
          .single()

        if (ws?.slug) {
          const landing = await getLanding(supabase, profile.role ?? undefined, profile.workspace_id ?? undefined)
          // Fuente unica: en un preview (`*.vercel.app`) no hay subdominio del tenant
          // al que ir, asi que el destino se queda en el mismo host.
          const destino = destinoTrasAutenticar(ws.slug, landing, hostname)
          return withAuthCookies(
            NextResponse.redirect(esRelativo(destino) ? new URL(destino, request.url) : destino),
            supabaseResponse
          )
        }
      }

      // Usuario autenticado sin workspace → /sin-espacio
      return withAuthCookies(NextResponse.redirect(new URL('/sin-espacio', request.url)), supabaseResponse)
    }
    return supabaseResponse
  }

  // Protected app routes — redirect to login if not authenticated
  const protectedPaths = ['/numeros', '/negocios', '/directorio', '/nuevo', '/gastos', '/config', '/mi-negocio', '/story-mode', '/tableros', '/revision', '/equipo', '/movimientos', '/calidad']
  if (protectedPaths.some(p => pathname.startsWith(p)) && !user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirectTo', pathname)
    return withAuthCookies(NextResponse.redirect(loginUrl), supabaseResponse)
  }

  // Gate por módulo también en el dominio base: la app se renderiza sin subdominio (un
  // preview de Vercel, `localhost`, o `metrikone.co/negocios` con la sesión del dominio
  // base), y el layout pinta el workspace del perfil igual que en el subdominio.
  if (user && rutaGateada(pathname)) {
    const perfil = await leerPerfilDeAcceso(supabase as unknown as ClientePerfil, user.id, true)
    const destino = perfil.gate ? destinoSiBloqueada(pathname, perfil.gate) : null
    if (destino) {
      return withAuthCookies(NextResponse.redirect(new URL(destino, request.url)), supabaseResponse)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
