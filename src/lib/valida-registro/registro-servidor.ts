import 'server-only'
import { createHash } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { MODULOS } from '@/lib/modulos/catalogo'
import { VENTANA_HORAS, dominioDeCorreo, motivoDeRechazo, type MotivoRechazo } from '@/lib/secop-registro/antiabuso'
import { derivarSlug, problemaDelSlug } from '@/lib/secop-registro/slug'
import { POLITICA_DATOS_VALIDA } from '@/lib/valida-api/politica'
import { condicionesVigentes, textoAceptado, versionAceptada } from './condiciones'
import {
  candidatosDeSlug,
  decidirOrigen,
  limpiarCodigoAfi,
  limpiarUtm,
  normalizarRazonSocial,
  problemaDeRazonSocial,
  problemaDelNit,
  soloDigitos,
  textoMotivoValida,
  textoProblemaNit,
} from './datos'
import { registroAbierto } from './llave'
import { leerTarjeta, partirNombre, pideMetodoPago, textoProblemaTarjeta } from './metodo-pago'
import { registrarClienteEpayco } from '@/lib/suscripciones/pasarela/epayco'
import { emitirPruebaDelEspacio } from './prueba-servidor'
import { terminosParaElRegistro, type TerminosDelRegistroArmados } from './terminos-registro-servidor'
import { asegurarSuscripcionEnPrueba } from './suscripcion-prueba-servidor'

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
 *   - la aceptación queda en `valida_registros` con la huella SHA-256 de TODO lo que se leyó y marcó
 *     (Condiciones + aviso de datos + casilla, `textoAceptado()`), ANTES de crear nada: sin
 *     aceptación no hay espacio;
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
 * Con las Condiciones v2.0 (`condicionesVigentes().conCobro`) la tarjeta es OBLIGATORIA: se registra
 * en ePayco ANTES de crear nada (sin tarjeta no hay espacio ni prueba), `metodo_pago_estado` nace en
 * `registrado` y, al emitirse la prueba, queda programado el cobro del primer mes en el instante en que
 * se cumplen los 7 días (`cobro-prueba.ts`, `cobro-prueba-servidor.ts`).
 *
 * Con cobro, la casilla v1.2 acepta además los Términos de Uso de autoservicio (Condiciones 7.1;
 * Términos 16.2). El servidor arma los de ESTA empresa en el momento de aceptar (Orden con lo
 * declarado + Parte II, `terminosParaElRegistro`), los mete en la huella (`textoAceptado(c, terminos)`)
 * y guarda, en la misma escritura de la puerta, el texto aceptado entero y los Términos con su huella
 * (`aceptado_texto`, `terminos_*`, migración 20261014203000). El día 7 esos Términos se registran tal
 * cual sobre el contrato (`aceptarTerminosDelRegistro`) y el cobro sigue.
 */

export type CampoRegistro = 'razon_social' | 'nit' | 'dv' | 'acepta' | 'tarjeta'

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
  /** La casilla de las Condiciones de la prueba y la Política de Datos. */
  acepta: boolean
  /** La versión de Condiciones + aviso que vio la pantalla (`VERSION_ACEPTADA`). Tiene que ser la vigente. */
  condicionesVersion: string
  recomendadoAfi: boolean | null
  codigoAfi: string | null
  ref: string | null
  utm: unknown
  /** Lo que el servidor leyó de las cabeceras. Nunca del cuerpo. */
  ip: string | null
  /**
   * Solo cuando las Condiciones vigentes traen la cláusula de cobro y ePayco está encendido: el token
   * de ePayco.js, el titular y un celular. Nunca la tarjeta (`metodo-pago.ts`).
   */
  tarjeta?: unknown
}

/** Cupos del espacio: la persona que se registra y un segundo usuario, como los CDA de hoy. */
export const CUPOS_VALIDA = 2

/**
 * La huella de lo que la persona leyó y aceptó: Condiciones, aviso de datos tal como lo completa la
 * pantalla y texto de la casilla (`textoAceptado()`). No solo las Condiciones: la autorización del
 * titular se prueba con el aviso exacto (Decreto 1377 de 2013, art. 7).
 */
export function huellaAceptacion(texto: string = textoAceptado()): string {
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
  const condiciones = condicionesVigentes()
  if (datos.condicionesVersion !== versionAceptada(condiciones)) {
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
    // Ya no se pregunta (Mauricio, 2026-10-12: cualquier empresa). El segmento sale del RUT al activar
    // (CIIU 7120 = CDA); la columna queda en null, que su CHECK admite.
    tipo_entidad: null,
    origen,
    origen_fuente: fuente,
    ref: datos.ref ? datos.ref.trim().slice(0, 60) : null,
    codigo_afi: codigoAfi,
    recomendado_afi: datos.recomendadoAfi,
    utm,
    metodo_pago_estado: 'no_requerido' as 'no_requerido' | 'registrado',
    metodo_pago_ref: null as string | null,
  }

  if (motivo) {
    await svc.from('valida_registros').insert({ ...filaBase, estado: 'rechazado', motivo })
    return { tipo: 'rechazado', motivo, texto: textoMotivoValida(motivo) }
  }

  // ── El método de pago (decisión A2), solo con la cláusula de cobro vigente y ePayco encendido ───
  // Antes de crear nada: si la tarjeta no se registra, no hay espacio ni prueba que limpiar. ePayco
  // guarda la tarjeta; aquí queda solo su referencia (`epayco:<cliente>:<token>`).
  let celularPago: string | null = null
  if (pideMetodoPago(condiciones.conCobro)) {
    const t = leerTarjeta(datos.tarjeta)
    if (!t.ok) return { tipo: 'dato', campo: 'tarjeta', texto: textoProblemaTarjeta(t.problema) }
    const { nombre, apellido } = partirNombre(t.tarjeta.titular)
    const cliente = await registrarClienteEpayco({
      cardTokenId: t.tarjeta.token,
      pagador: { tipoDocumento: 'NIT', documento: nit, nombre, apellido, email: correo, celular: t.tarjeta.celular },
    })
    if (!cliente.ok) {
      console.error('[valida-registro] ePayco:', cliente.error)
      return { tipo: 'dato', campo: 'tarjeta', texto: textoProblemaTarjeta('token') }
    }
    filaBase.metodo_pago_estado = 'registrado'
    filaBase.metodo_pago_ref = cliente.ref
    celularPago = t.tarjeta.celular
  }

  // ── Los Términos de esta empresa, si la casilla los acepta (con cobro) ───────────────────────
  // El instante de la aceptación es UNO: el de `aceptado_at` y el de la Orden.
  const aceptadoMs = Date.now()
  let terminos: TerminosDelRegistroArmados | null = null
  if (condiciones.terminos) {
    const t = terminosParaElRegistro({
      razonSocial,
      nit,
      dv,
      correo,
      recomendadoAfi: datos.recomendadoAfi,
      aceptadoMs,
    })
    if (!t.ok) {
      // Un campo de la Orden sin llenar: no se acepta un texto con huecos.
      console.error('[valida-registro] Términos con campos sin llenar:', t.faltan.join(', '))
      return { tipo: 'error' }
    }
    terminos = t.terminos
  }
  const aceptado = textoAceptado(condiciones, terminos)

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
        config_extra: {
          modo_vitrina: true,
          origen_registro: 'valida_autogestion',
          // El celular que pide ePayco para cobrar con la tarjeta (de la persona dueña de la cuenta).
          ...(celularPago ? { valida_pagador: { celular: celularPago } } : {}),
        },
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
      condiciones_version: versionAceptada(condiciones),
      condiciones_sha256: huellaAceptacion(aceptado),
      politica_version: POLITICA_DATOS_VALIDA.version,
      aceptado_at: new Date(aceptadoMs).toISOString(),
      // La evidencia de los Términos aceptados en el registro (Términos 16.3). Solo con Términos: así
      // un registro sin cobro no depende de la migración 20261014203000.
      ...(terminos
        ? {
            aceptado_texto: aceptado,
            terminos_version: terminos.version,
            terminos_texto: terminos.texto,
            terminos_sha256: terminos.sha256,
          }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', registroId)
  if (ePuerta) {
    await svc.from('workspaces').delete().eq('id', workspaceId)
    if (ePuerta.code && ePuerta.code !== '23505') {
      // No es la puerta del NIT o del correo (p. ej. la migración de los Términos sin aplicar): no se
      // le dice a la persona que su NIT ya está tomado.
      console.error('[valida-registro] puerta:', ePuerta.code, ePuerta.message)
      await cerrarIntento('error_puerta')
      return { tipo: 'error' }
    }
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
  const prueba = await emitirPruebaDelEspacio({
    workspaceId,
    registroId,
    usuarioId: user.id,
    correo,
    razonSocial,
    nit,
    dv,
    conCobro: filaBase.metodo_pago_estado === 'registrado',
  })
  // ── 6. La suscripción EN PRUEBA (2026-10-16): la sección Suscripción existe desde hoy. Si falla, no
  //      tumba el registro: la activación la crea igual (`valida_activar_autogestion`).
  await suscripcionEnPrueba(svc, workspaceId)
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
    .select('id, razon_social, identificacion, dv, valida_cliente_id, metodo_pago_estado')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'creado')
    .maybeSingle()
  const r = reg as {
    id: string
    razon_social: string
    identificacion: string
    dv: string | null
    valida_cliente_id: string | null
    metodo_pago_estado: string
  } | null
  if (!r || r.valida_cliente_id || !r.dv || !slug) return { tipo: 'ya_tiene_espacio', slug }
  const prueba = await emitirPruebaDelEspacio({
    workspaceId,
    registroId: r.id,
    usuarioId,
    correo,
    razonSocial: r.razon_social,
    nit: r.identificacion,
    dv: r.dv,
    conCobro: r.metodo_pago_estado === 'registrado',
  })
  await suscripcionEnPrueba(svc, workspaceId)
  return prueba.tipo === 'ok' ? { tipo: 'ok', slug } : { tipo: 'prueba_pendiente', slug }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function suscripcionEnPrueba(svc: any, workspaceId: string): Promise<void> {
  const r = await asegurarSuscripcionEnPrueba(svc, { workspaceId })
  if (r.tipo === 'error') console.error('[valida-registro] suscripción en prueba:', r.mensaje)
}
