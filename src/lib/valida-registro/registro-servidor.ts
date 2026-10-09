import 'server-only'
import { createHash } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { MODULOS } from '@/lib/modulos/catalogo'
import { VENTANA_HORAS, dominioDeCorreo, motivoDeRechazo, type MotivoRechazo } from '@/lib/secop-registro/antiabuso'
import { derivarSlug, problemaDelSlug } from '@/lib/secop-registro/slug'
import { POLITICA_DATOS_VALIDA } from '@/lib/valida-api/politica'
import { CONDICIONES_PRUEBA } from './condiciones'
import {
  candidatosDeSlug,
  decidirOrigen,
  esTipoEntidad,
  limpiarCodigoAfi,
  limpiarUtm,
  normalizarRazonSocial,
  problemaDeRazonSocial,
  problemaDelNit,
  soloDigitos,
  textoMotivoValida,
  textoProblemaNit,
  type TipoEntidad,
} from './datos'
import { registroAbierto } from './llave'
import { emitirPruebaDelEspacio } from './prueba-servidor'

/**
 * El alta autogestionada de Valida, en el SERVIDOR (`18-recorrido-baja-friccion.md`, PR 3).
 *
 * Es el patrón de `src/lib/secop-registro/registro-servidor.ts` (leerlo primero: ahí está el porqué
 * de cada regla), con lo propio de Valida:
 *
 *   - el espacio nace SOLO con `valida_consulta` y `modo_vitrina`, como los CDA de hoy: la persona
 *     entra a «Valida», no a los módulos de gestión de ONE (§5, «la puerta de Valida abre ONE»);
 *   - la persona es dueña del espacio. La persona DESIGNADA del contrato llega al activar el plan
 *     (PR 6): en la prueba no hay contrato, y `entradaValidaCda()` deja pasar un espacio sin contrato;
 *   - la aceptación de las Condiciones de la prueba y la Política queda en `valida_registros` con la
 *     huella SHA-256 del texto que se mostró, ANTES de crear nada: sin aceptación no hay espacio;
 *   - la prueba (10 consultas, 7 días) la emite Valida y su llave va a Vault (`prueba-servidor.ts`).
 *
 * ## Las reglas del aislamiento (las mismas de SECOP)
 *
 * 1. Nada del cuerpo decide un `workspace_id`: sale del `insert` de esta función.
 * 2. La identidad es la sesión: el correo y el dueño salen de `getCachedUser()`. El código de 8
 *    dígitos del login ya verificó el correo.
 * 3. El slug lo decide el servidor, desde la razón social. Si está tomado, se le agrega un número.
 *
 * ## El orden de escritura
 *
 *   1. `valida_registros` como `intento` (alimenta los topes aunque todo lo demás falle).
 *   2. `workspaces`.
 *   3. el `intento` pasa a `creado` con la aceptación: el índice único del NIT y del correo es LA
 *      PUERTA. Si la rechaza, se borra el workspace recién nacido.
 *   4. `profiles`, `staff` y `fiscal_profiles`, solo después de la puerta.
 *   5. la prueba en Valida. Si falla, el espacio queda creado sin llave y el siguiente POST del
 *      mismo usuario la vuelve a pedir (`ya_tiene_espacio` con prueba pendiente).
 *
 * Punto de extensión del método de pago (decisión A2, ePayco): cuando exista la pasarela con cobro
 * recurrente, el paso 5 pasa a ser «registrar el método de pago y luego emitir la prueba», y
 * `valida_registros.metodo_pago_estado` deja de nacer en `no_requerido`. Hoy la prueba es sin tarjeta.
 */

export type CampoRegistro = 'razon_social' | 'nit' | 'dv' | 'tipo_entidad' | 'acepta'

export type ResultadoRegistroValida =
  | { tipo: 'ok'; slug: string }
  | { tipo: 'cerrado' }
  | { tipo: 'sin_sesion' }
  | { tipo: 'ya_tiene_espacio'; slug: string | null }
  | { tipo: 'rechazado'; motivo: MotivoRechazo; texto: string }
  | { tipo: 'dato'; campo: CampoRegistro; texto: string }
  | { tipo: 'prueba_pendiente'; slug: string }
  | { tipo: 'error' }

export interface DatosRegistroValida {
  razonSocial: string
  nit: string
  dv: string
  tipoEntidad: string
  /** La casilla de las Condiciones de la prueba y la Política de Datos. */
  acepta: boolean
  /** La versión de las Condiciones que vio la pantalla. Tiene que ser la vigente. */
  condicionesVersion: string
  recomendadoAfi: boolean | null
  codigoAfi: string | null
  ref: string | null
  utm: unknown
  /** Lo que el servidor leyó de las cabeceras. Nunca del cuerpo. */
  ip: string | null
}

/** Cupos del espacio: la persona que se registra y un segundo usuario, como los CDA de hoy. */
export const CUPOS_VALIDA = 2

/** La huella del texto EXACTO de las Condiciones que muestra la pantalla. */
export function huellaCondiciones(texto: string = CONDICIONES_PRUEBA.texto): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex')
}

export async function crearEspacioValida(datos: DatosRegistroValida): Promise<ResultadoRegistroValida> {
  if (!registroAbierto()) return { tipo: 'cerrado' }

  const { user } = await getCachedUser()
  const correo = user?.email ?? ''
  if (!user?.id || !correo) return { tipo: 'sin_sesion' }

  // `valida_registros` nace en 20261010090000 y no está en `database.ts`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any

  // ── Ya tiene espacio ──────────────────────────────────────────────────────
  const { data: perfil, error: eperfil } = await svc.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle()
  if (eperfil) {
    console.error('[valida-registro] perfil:', eperfil.message)
    return { tipo: 'error' }
  }
  const wsPrevio = (perfil as { workspace_id: string | null } | null)?.workspace_id ?? null
  if (wsPrevio) return reintentarPruebaPendiente(svc, wsPrevio, user.id, correo)

  // ── Los datos, antes de escribir nada ─────────────────────────────────────
  if (!datos.acepta) {
    return { tipo: 'dato', campo: 'acepta', texto: 'Para empezar la prueba tienes que aceptar las condiciones y la política de datos.' }
  }
  if (datos.condicionesVersion !== CONDICIONES_PRUEBA.version) {
    // La pantalla mostró otro texto (estaba abierta desde antes de un cambio): que lo vuelva a leer.
    return { tipo: 'dato', campo: 'acepta', texto: 'Las condiciones cambiaron mientras tenías la página abierta. Recarga y vuelve a leerlas.' }
  }
  const problemaRazon = problemaDeRazonSocial(datos.razonSocial)
  if (problemaRazon) return { tipo: 'dato', campo: 'razon_social', texto: problemaRazon }
  const razonSocial = normalizarRazonSocial(datos.razonSocial)

  const problemaNit = problemaDelNit(datos.nit, datos.dv)
  if (problemaNit) {
    const campo: CampoRegistro = problemaNit.startsWith('dv') ? 'dv' : 'nit'
    return { tipo: 'dato', campo, texto: textoProblemaNit(problemaNit) }
  }
  const nit = soloDigitos(datos.nit)
  const dv = soloDigitos(datos.dv)

  if (!esTipoEntidad(datos.tipoEntidad)) {
    return { tipo: 'dato', campo: 'tipo_entidad', texto: 'Elige qué tipo de empresa es.' }
  }
  const tipoEntidad: TipoEntidad = datos.tipoEntidad

  const utm = limpiarUtm(datos.utm)
  const codigoAfi = limpiarCodigoAfi(datos.codigoAfi)
  const { origen, fuente } = decidirOrigen({ ref: datos.ref, codigoAfi, recomendadoAfi: datos.recomendadoAfi, utm })

  // ── Antiabuso: el mismo veredicto puro del registro SECOP, contado sobre esta tabla ───────────
  const dominio = dominioDeCorreo(correo)
  const desde = new Date(Date.now() - VENTANA_HORAS * 3600_000).toISOString()
  const [porIp, porDominio] = await Promise.all([
    datos.ip
      ? svc.from('valida_registros').select('id', { count: 'exact', head: true }).eq('ip', datos.ip).gte('created_at', desde)
      : Promise.resolve({ count: null, error: null }),
    svc.from('valida_registros').select('id', { count: 'exact', head: true }).eq('correo_dominio', dominio).gte('created_at', desde),
  ])
  const motivo = motivoDeRechazo({
    correo,
    registrosPorIp: porIp.error ? null : porIp.count ?? null,
    registrosPorDominio: porDominio.error ? null : porDominio.count ?? null,
  })

  const filaBase = {
    usuario_id: user.id,
    correo,
    correo_dominio: dominio || 'desconocido',
    ip: datos.ip,
    identificacion: nit,
    dv,
    razon_social: razonSocial,
    tipo_entidad: tipoEntidad,
    origen,
    origen_fuente: fuente,
    ref: datos.ref ? datos.ref.trim().slice(0, 60) : null,
    codigo_afi: codigoAfi,
    recomendado_afi: datos.recomendadoAfi,
    utm,
    metodo_pago_estado: 'no_requerido',
  }

  if (motivo) {
    await svc.from('valida_registros').insert({ ...filaBase, estado: 'rechazado', motivo })
    return { tipo: 'rechazado', motivo, texto: textoMotivoValida(motivo) }
  }

  // ── 1. La huella del intento ──────────────────────────────────────────────
  const { data: intento, error: eIntento } = await svc
    .from('valida_registros')
    .insert({ ...filaBase, estado: 'intento' })
    .select('id')
    .single()
  if (eIntento || !intento) {
    console.error('[valida-registro] intento:', eIntento?.message)
    return { tipo: 'error' }
  }
  const registroId = (intento as { id: string }).id
  const cerrarIntento = async (m: string) => {
    await svc.from('valida_registros').update({ estado: 'rechazado', motivo: m, updated_at: new Date().toISOString() }).eq('id', registroId)
  }

  // ── 2. El espacio ─────────────────────────────────────────────────────────
  const slugBase = derivarSlug(razonSocial) || `valida-${nit.slice(-4)}`
  let workspaceId: string | null = null
  let slug = ''
  for (const candidato of candidatosDeSlug(slugBase)) {
    if (problemaDelSlug(candidato)) continue
    const { data: ocupado } = await svc.from('workspaces').select('id').eq('slug', candidato).maybeSingle()
    if (ocupado) continue
    const { data: creado, error: eWs } = await svc
      .from('workspaces')
      .insert({
        slug: candidato,
        name: razonSocial,
        tipo: 'nativo',
        subscription_status: 'trial',
        onboarding_completed: true,
        max_seats: CUPOS_VALIDA,
        equipo_declarado: 1,
        // SOLO Valida, con la navegación de Valida (la misma de los CDA).
        modules: { [MODULOS.valida.clave]: true },
        config_extra: { modo_vitrina: true, origen_registro: 'valida_autogestion' },
        drive_folder_id: null,
      })
      .select('id')
      .single()
    if (!eWs && creado) {
      workspaceId = (creado as { id: string }).id
      slug = candidato
      break
    }
  }
  if (!workspaceId) {
    await cerrarIntento('slug_tomado')
    return { tipo: 'error' }
  }

  // ── 3. La puerta: NIT y correo únicos entre los creados, con la aceptación ───────────────────
  const { error: ePuerta } = await svc
    .from('valida_registros')
    .update({
      estado: 'creado',
      workspace_id: workspaceId,
      slug_creado: slug,
      condiciones_version: CONDICIONES_PRUEBA.version,
      condiciones_sha256: huellaCondiciones(),
      politica_version: POLITICA_DATOS_VALIDA.version,
      aceptado_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', registroId)
  if (ePuerta) {
    await svc.from('workspaces').delete().eq('id', workspaceId)
    const m: MotivoRechazo = /correo_creado/.test(ePuerta.message) ? 'correo_tomado' : 'identificacion_tomada'
    await cerrarIntento(m)
    return { tipo: 'rechazado', motivo: m, texto: textoMotivoValida(m) }
  }

  // ── 4. La persona, dueña del espacio ──────────────────────────────────────
  const nombrePersona = correo.split('@')[0]
  const { error: eProf } = await svc
    .from('profiles')
    .upsert(
      { id: user.id, workspace_id: workspaceId, full_name: nombrePersona, role: 'owner', home_workspace_id: workspaceId },
      { onConflict: 'id' },
    )
  if (eProf) {
    console.error('[valida-registro] perfil del dueño:', eProf.message)
    return { tipo: 'error' }
  }
  // `rol_plataforma: 'dueno'`: `trg_sync_staff_role` lo espeja a `profiles.role`; 'administrador'
  // degradaría al dueño a `admin` en el mismo insert.
  const { error: eStaff } = await svc.from('staff').insert({
    workspace_id: workspaceId,
    profile_id: user.id,
    full_name: nombrePersona,
    rol_plataforma: 'dueno',
    tipo_acceso: 'app',
    is_active: true,
  })
  if (eStaff) console.error('[valida-registro] staff del dueño:', eStaff.message)

  const { error: eFiscal } = await svc
    .from('fiscal_profiles')
    .upsert({ workspace_id: workspaceId, nit, email_facturacion: correo }, { onConflict: 'workspace_id' })
  if (eFiscal) console.error('[valida-registro] perfil fiscal:', eFiscal.message)

  // ── 5. La prueba ──────────────────────────────────────────────────────────
  const prueba = await emitirPruebaDelEspacio({ workspaceId, registroId, usuarioId: user.id, correo, razonSocial, nit, dv })
  if (prueba.tipo !== 'ok') return { tipo: 'prueba_pendiente', slug }
  return { tipo: 'ok', slug }
}

/**
 * Quien ya tiene espacio y vuelve a enviar el formulario: si su espacio nació por este registro y la
 * prueba no alcanzó a emitirse, se pide otra vez. Si no, se le manda a su espacio.
 */
async function reintentarPruebaPendiente(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
  usuarioId: string,
  correo: string,
): Promise<ResultadoRegistroValida> {
  const { data: ws } = await svc.from('workspaces').select('slug').eq('id', workspaceId).maybeSingle()
  const slug = (ws as { slug: string } | null)?.slug ?? null
  const { data: reg } = await svc
    .from('valida_registros')
    .select('id, razon_social, identificacion, dv, valida_cliente_id')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'creado')
    .maybeSingle()
  const r = reg as { id: string; razon_social: string; identificacion: string; dv: string | null; valida_cliente_id: string | null } | null
  if (!r || r.valida_cliente_id || !r.dv || !slug) return { tipo: 'ya_tiene_espacio', slug }
  const prueba = await emitirPruebaDelEspacio({
    workspaceId,
    registroId: r.id,
    usuarioId,
    correo,
    razonSocial: r.razon_social,
    nit: r.identificacion,
    dv: r.dv,
  })
  return prueba.tipo === 'ok' ? { tipo: 'ok', slug } : { tipo: 'prueba_pendiente', slug }
}
