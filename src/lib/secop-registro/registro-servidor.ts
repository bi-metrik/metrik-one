import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { MODULOS } from '@/lib/modulos/catalogo'
import {
  VENTANA_HORAS,
  dominioDeCorreo,
  motivoDeRechazo,
  textoMotivo,
  type MotivoRechazo,
} from './antiabuso'
import { derivarSlug, problemaDelSlug, textoProblemaSlug } from './slug'
import {
  normalizarIdentificacion,
  problemaDeIdentificacion,
  textoProblemaIdentificacion,
} from './identificacion'

/**
 * La creación del espacio ONE SECOP, en el SERVIDOR. Es la mitad delicada de todo el experimento:
 * **la primera vez que alguien de afuera hace que se creen filas de tenant en ONE** (spec §3.1).
 *
 * ## Las tres reglas que sostienen el aislamiento, y dónde están
 *
 * 1. **Nada del cuerpo de la petición decide a qué workspace pertenece una fila.** El `workspace_id`
 *    de todo lo que se escribe aquí sale del `insert` que esta función acaba de hacer, nunca de un
 *    parámetro. Lo único que llega de afuera son tres textos —nombre, slug pedido, identificación—,
 *    y ninguno es un id.
 * 2. **La identidad es la sesión, no el formulario.** El correo, y por lo tanto el dueño del
 *    espacio, salen de `getCachedUser()`. No hay un campo «correo» que el navegador pueda mandar.
 * 3. **El slug lo decide el servidor.** Lo que llega es una propuesta: se normaliza, se valida
 *    contra `RESERVED_SLUGS` y se comprueba libre aquí.
 *
 * ## Por qué el correo ya está verificado sin construir verificación
 *
 * El login de ONE es magic link con OTP (`src/app/(marketing)/login/login-client.tsx`): **la única
 * forma de tener sesión es haber abierto el correo**. No hay contraseña, ni OAuth encendido, ni
 * `signUp` con clave. Entonces «correo verificado antes de crear cualquier fila de tenant» (capa 1 de
 * §0-quater) lo cumple el camino de entrada, y lo que esta función agrega es el bloqueo de dominios
 * desechables, que es la parte que faltaba.
 *
 * ⚠️ NO se comprueba `email_confirmed_at`, y no es un descuido: `getCachedUser()` resuelve al usuario
 * verificando la firma del JWT (`src/lib/supabase/claims-user.ts`) y ese token trae **solo `sub` y
 * `email`**. Leer la marca de confirmación obligaría a ir al endpoint admin de Auth, que en esta
 * instancia está roto para listados (ver la nota de `scripts/setup-workspace-users.ts:145`), o a una
 * función SQL nueva sobre el esquema `auth`. El otro camino por el que puede existir una sesión es un
 * usuario creado por MéTRIK con `email_confirm: true`, y ese ya tiene espacio: cae en
 * `ya_tiene_espacio` antes de llegar a crear nada. Si algún día se habilita una forma de entrar sin
 * probar el correo, esta comprobación deja de estar cubierta y hay que escribirla aquí.
 *
 * ## El orden de escritura, que no es arbitrario
 *
 *   1. `secop_registros` como `intento` → queda la huella incluso si todo lo demás falla, y es lo
 *      que alimenta el tope por IP y por dominio del siguiente intento.
 *   2. `workspaces` → la fila del tenant, sin Drive y sin `business` (§0-bis).
 *   3. el `intento` pasa a `creado` con su `workspace_id`. **Este UPDATE es la puerta**: el índice
 *      único parcial de la migración es lo que de verdad impide dos espacios con el mismo NIT, y
 *      dos peticiones en paralelo se resuelven ahí y no en la comprobación previa. Si lo rechaza, se
 *      borra el workspace que se acababa de crear —todavía no tiene ni una fila colgando— y se
 *      responde que la identificación está tomada.
 *   4. `profiles` y `staff` **solo después de pasar la puerta**: así el usuario nunca queda apuntado
 *      a un workspace que se va a borrar.
 *
 * `staff.rol_plataforma` va en `'dueno'` y no en `'administrador'`: el trigger
 * `trg_sync_staff_role` espeja ese valor sobre `profiles.role`, y con `'administrador'` degradaría
 * al dueño del espacio a `admin` en el mismo insert que lo crea.
 *
 * ## Lo que esta función NO hace, a propósito
 *
 * No crea carpeta en Drive (§3.2: un cliente de Radar no emite documentos), no enciende `business`,
 * no toca `contextoSuscripcion()` ni nada del camino de Valida (§0-ter), no cobra y no acepta
 * términos: el gate de términos ya existe y corre cuando la persona entra a `/radar`.
 */

export type ResultadoRegistro =
  | { tipo: 'ok'; slug: string }
  | { tipo: 'sin_sesion' }
  | { tipo: 'ya_tiene_espacio'; slug: string | null }
  | { tipo: 'rechazado'; motivo: MotivoRechazo; texto: string }
  | { tipo: 'dato'; campo: 'nombre' | 'slug' | 'identificacion'; texto: string }
  | { tipo: 'error' }

export interface DatosRegistro {
  /** Nombre visible del espacio. Es también de lo que se deriva el slug si no lo pidieron. */
  nombre: string
  /** El slug que propuso la pantalla. Vacío = derivarlo del nombre. */
  slugPedido?: string
  /** NIT o cédula, como la persona lo escribió. */
  identificacion: string
  /** Lo que el servidor leyó de las cabeceras. Nunca del cuerpo. */
  ip: string | null
}

const LARGO_MIN_NOMBRE = 3
const LARGO_MAX_NOMBRE = 80

/** Cupos del espacio SECOP: los 2 de la suscripción, **incluido quien aceptó** (§0-bis). */
export const CUPOS_SECOP = 2

export async function crearEspacioSecop(datos: DatosRegistro): Promise<ResultadoRegistro> {
  const { user } = await getCachedUser()
  const correo = user?.email ?? ''
  if (!user?.id || !correo) return { tipo: 'sin_sesion' }

  // `secop_registros` nace en 20260929090000 y no está en `database.ts`. Mismo trato que
  // `radar_procesos` en `src/lib/radar/datos-servidor.ts:73`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any

  // ── Ya tiene espacio ──────────────────────────────────────────────────────
  // Antes de cualquier otra cosa: el que ya entró no vuelve a registrarse, y esto evita además que
  // un segundo POST del mismo formulario cree un espacio de más.
  const { data: perfil, error: eperfil } = await svc
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .maybeSingle()
  if (eperfil) {
    console.error('[secop-registro] perfil:', eperfil.message)
    return { tipo: 'error' }
  }
  const wsPrevio = (perfil as { workspace_id: string | null } | null)?.workspace_id ?? null
  if (wsPrevio) {
    const { data: ws } = await svc.from('workspaces').select('slug').eq('id', wsPrevio).maybeSingle()
    return { tipo: 'ya_tiene_espacio', slug: (ws as { slug: string } | null)?.slug ?? null }
  }

  // ── Los datos, antes de escribir nada ─────────────────────────────────────
  const nombre = datos.nombre.trim().replace(/\s+/g, ' ')
  if (nombre.length < LARGO_MIN_NOMBRE) {
    return { tipo: 'dato', campo: 'nombre', texto: 'Escribe el nombre de tu espacio.' }
  }
  if (nombre.length > LARGO_MAX_NOMBRE) {
    return { tipo: 'dato', campo: 'nombre', texto: `El nombre no puede pasar de ${LARGO_MAX_NOMBRE} caracteres.` }
  }

  const problemaId = problemaDeIdentificacion(datos.identificacion)
  if (problemaId) {
    return { tipo: 'dato', campo: 'identificacion', texto: textoProblemaIdentificacion(problemaId) }
  }
  const identificacion = normalizarIdentificacion(datos.identificacion)

  // El slug pedido se NORMALIZA, no se confía: lo que el navegador manda puede traer mayúsculas o
  // espacios, y si queda vacío se deriva del nombre.
  const pedido = (datos.slugPedido ?? '').trim().toLowerCase()
  const slug = pedido ? pedido : derivarSlug(nombre)
  const problemaSlug = problemaDelSlug(slug)
  if (problemaSlug) {
    const texto =
      problemaSlug === 'vacio' && !pedido
        ? 'No pudimos armar la dirección desde ese nombre. Escríbela tú.'
        : textoProblemaSlug(problemaSlug)
    return { tipo: 'dato', campo: 'slug', texto }
  }

  // ── Capas 1 a 3 del antiabuso ─────────────────────────────────────────────
  const dominio = dominioDeCorreo(correo)
  const desde = new Date(Date.now() - VENTANA_HORAS * 3600_000).toISOString()
  const [porIp, porDominio] = await Promise.all([
    datos.ip
      ? svc.from('secop_registros').select('id', { count: 'exact', head: true }).eq('ip', datos.ip).gte('created_at', desde)
      : Promise.resolve({ count: null, error: null }),
    svc
      .from('secop_registros')
      .select('id', { count: 'exact', head: true })
      .eq('correo_dominio', dominio)
      .gte('created_at', desde),
  ])

  const motivo = motivoDeRechazo({
    correo,
    registrosPorIp: porIp.error ? null : porIp.count ?? null,
    registrosPorDominio: porDominio.error ? null : porDominio.count ?? null,
  })

  const filaBase = {
    correo,
    correo_dominio: dominio || 'desconocido',
    identificacion,
    ip: datos.ip,
    slug_pedido: slug,
  }

  if (motivo) {
    // El rechazo se guarda: sin esta fila el tope no se puede medir y el experimento no sabe si el
    // abuso apareció o no (§0-quater, «lo que sí tiene que existir desde el día uno»).
    await svc.from('secop_registros').insert({ ...filaBase, estado: 'rechazado', motivo })
    return { tipo: 'rechazado', motivo, texto: textoMotivo(motivo) }
  }

  // ── 1. La huella del intento ──────────────────────────────────────────────
  const { data: intento, error: eIntento } = await svc
    .from('secop_registros')
    .insert({ ...filaBase, estado: 'intento' })
    .select('id')
    .single()
  if (eIntento || !intento) {
    console.error('[secop-registro] intento:', eIntento?.message)
    return { tipo: 'error' }
  }
  const intentoId = (intento as { id: string }).id

  const cerrarIntento = async (m: MotivoRechazo) => {
    await svc.from('secop_registros').update({ estado: 'rechazado', motivo: m }).eq('id', intentoId)
  }

  // El slug libre se comprueba aquí para poder decirlo con un mensaje útil; lo que de verdad lo
  // garantiza es el `unique` de `workspaces.slug`, que se maneja abajo.
  const { data: ocupado } = await svc.from('workspaces').select('id').eq('slug', slug).maybeSingle()
  if (ocupado) {
    await cerrarIntento('slug_tomado')
    return { tipo: 'dato', campo: 'slug', texto: 'Esa dirección ya está en uso. Elige otra.' }
  }

  // ── 2. La fila del tenant ─────────────────────────────────────────────────
  const { data: creado, error: eWs } = await svc
    .from('workspaces')
    .insert({
      slug,
      name: nombre,
      // `nativo` y no `clarity`: no es un espacio de consultoría, es un suscriptor directo.
      tipo: 'nativo',
      subscription_status: 'trial',
      // No hay onboarding que completar: el espacio nace con su único módulo encendido.
      onboarding_completed: true,
      max_seats: CUPOS_SECOP,
      equipo_declarado: 1,
      // SOLO el Radar. Sin `business`: en un espacio SECOP no existen negocios, etapas, cuentas de
      // cobro del cliente ni cotizaciones (§0-bis).
      modules: { [MODULOS.radar_secop.clave]: true },
      // Sin Drive, explícito (§3.2). Nada precargado: el logo y el color los carga la persona.
      drive_folder_id: null,
    })
    .select('id')
    .single()
  if (eWs || !creado) {
    console.error('[secop-registro] workspace:', eWs?.message)
    await cerrarIntento('slug_tomado')
    return { tipo: 'dato', campo: 'slug', texto: 'Esa dirección ya está en uso. Elige otra.' }
  }
  const workspaceId = (creado as { id: string }).id

  // ── 3. La puerta: el índice único de `secop_registros` ────────────────────
  const { error: ePuerta } = await svc
    .from('secop_registros')
    .update({ estado: 'creado', workspace_id: workspaceId, slug_creado: slug })
    .eq('id', intentoId)
  if (ePuerta) {
    // Dos peticiones a la vez con el mismo NIT (o con el mismo correo) se resuelven acá. El
    // workspace se borra porque acaba de nacer y no tiene una sola fila colgando: ni perfil, ni
    // staff, ni datos. Si el borrado falla queda un espacio huérfano sin usuarios, que es preferible
    // a dejar dos espacios con la misma llave.
    await svc.from('workspaces').delete().eq('id', workspaceId)
    const tomadoPorCorreo = /correo_creado/.test(ePuerta.message)
    const m: MotivoRechazo = tomadoPorCorreo ? 'correo_tomado' : 'identificacion_tomada'
    await cerrarIntento(m)
    return { tipo: 'rechazado', motivo: m, texto: textoMotivo(m) }
  }

  // ── 4. La persona: es el administrador, y no hay «designado» ──────────────
  // §0-ter: quien se registra y crea el espacio ES el administrador. `role: 'owner'` es lo que hace
  // que la sección Suscripción se resuelva por «es el administrador del espacio» y no por una
  // designación que en el SECOP no existe.
  // El JWT no trae `full_name` (solo `sub` y `email`), así que el nombre de la persona sale del
  // correo. Es un valor de arranque: la persona lo corrige en su perfil, y «nada precargado» (§0-ter)
  // aplica también aquí — no se inventa un nombre bonito que después nadie sabe de dónde salió.
  const nombrePersona = correo.split('@')[0]

  const { error: eProf } = await svc
    .from('profiles')
    .upsert(
      { id: user.id, workspace_id: workspaceId, full_name: nombrePersona, role: 'owner', home_workspace_id: workspaceId },
      { onConflict: 'id' },
    )
  if (eProf) {
    // Aquí NO se borra el workspace: la llave ya quedó tomada y el espacio existe. Se reporta para
    // que se resuelva a mano, que es preferible a deshacer una fila que ya es la buena.
    console.error('[secop-registro] perfil del dueño:', eProf.message)
    return { tipo: 'error' }
  }

  // `rol_plataforma: 'dueno'` a propósito: `trg_sync_staff_role` espeja este valor sobre
  // `profiles.role`, y 'administrador' degradaría a `admin` al dueño que se acabó de crear.
  const { error: eStaff } = await svc.from('staff').insert({
    workspace_id: workspaceId,
    profile_id: user.id,
    full_name: nombrePersona,
    rol_plataforma: 'dueno',
    tipo_acceso: 'app',
    is_active: true,
  })
  if (eStaff) console.error('[secop-registro] staff del dueño:', eStaff.message)

  // El perfil fiscal con la identificación declarada: es el dato de facturación de la cláusula 9 y
  // se guarda donde ya vive para todos los espacios, no en una tabla nueva.
  const { error: eFiscal } = await svc
    .from('fiscal_profiles')
    .upsert({ workspace_id: workspaceId, nit: identificacion, email_facturacion: correo }, { onConflict: 'workspace_id' })
  if (eFiscal) console.error('[secop-registro] perfil fiscal:', eFiscal.message)

  return { tipo: 'ok', slug }
}
