import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generarEnlacePagoCuota } from '@/lib/cobros/enlace-pago-cuota-servidor'
import { MOTIVO_SIN_PASARELA, pasarelaDeEnlaces } from '@/lib/cobros/enlace-pago-cuota'
import { referenciaEnlaceCobro } from '@/lib/cobros/referencia-enlace'
import type { ContextoSuscripcion } from '@/lib/seccion-suscripcion/contexto-servidor'
import { createServiceClient } from '@/lib/supabase/server'
import { adapterPara } from '@/lib/suscripciones/pasarela/registro'
import type { PasarelaAdapter } from '@/lib/suscripciones/pasarela/adapter'
import { origenPeticion } from '@/lib/valida-api/contexto'
import { huellaTexto } from '@/lib/valida-api/politica-huella'
import { documentosDelCliente } from '@/lib/valida-api/terminos-servidor'
import { cuotasConEstado, enlaceDePagoValido } from './pago-pendiente'
import { leerCuentaCda } from './pago-servidor'
import {
  descripcionEnlaceAnual,
  expiraEnlaceAnualMs,
  ofertaPlanAnual,
  PLAN_ANUAL,
  planAnualHabilitado,
  plazoAnual,
  plantillaDelAnexo,
  renderAnexoPlanAnual,
  TEXTO_SIN_OFERTA,
  textoMencionAutoriza,
  textoRevocacionMencion,
  validarAceptante,
  type MotivoSinOferta,
  type PlazoAnual,
} from './plan-anual'

/**
 * El lado del servidor del Plan Anual (reglas en `plan-anual.ts`): lo que ve la pestaña Pagos de
 * `/suscripcion`, la elección con su aceptación y su enlace, el enlace del mes, y la activación que
 * corre el webhook de la pasarela al aprobarse el pago.
 *
 * Quién puede lo decide la acción (`/suscripcion/acciones.ts`: la persona designada, en su sesión);
 * aquí se recibe el contexto ya resuelto. Todo lo que no es del espacio de la sesión se lee con el
 * cliente de servicio, SIEMPRE por los ids del contrato que devolvió `mis_servicios()`.
 */

type Ctx = Extract<ContextoSuscripcion, { tipo: 'ok' }>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** Los datos del anexo que no escribe la persona: empresa, términos aceptados (deciden el anexo) y el plazo. */
export interface DatosAnexoBase {
  razonSocial: string
  nit: string
  versionTerminos: string
  /** Solo Términos v2.0 (`parametros.orden_numero`). */
  ordenNumero: string | null
  /** Solo Términos v2.0 (`parametros.valor_usuario_adicional`). */
  precioUsuarioAdicional: number | null
  plazo: Pick<PlazoAnual, 'desde' | 'hasta'>
}

/** La autorización de mención (anexo, numeral 11) vigente para el contrato. */
export interface EstadoMencion {
  autoriza: boolean
  /** Cuándo se dio o se revocó (ISO). */
  desde: string
}

export interface CuotaDelMes {
  cuotaId: string
  numero: number
  saldo: number
  /** El enlace vigente de la cuota, si ya lo hay. */
  enlace: string | null
}

export type OpcionesPago =
  /** No es un CDA, el contrato no tiene el plan encendido o no se pudo leer: la pestaña sigue igual. */
  | { tipo: 'oculto' }
  | {
      tipo: 'ok'
      /** La cuota pendiente que se paga sola («Pagar el mes»), o `null` si no hay. */
      mes: CuotaDelMes | null
      anual:
        | { estado: 'activo'; desde: string; hasta: string; razonSocial: string | null; mencion: EstadoMencion | null }
        | { estado: 'elegido'; desde: string; hasta: string; enlace: string }
        | { estado: 'oferta'; datos: DatosAnexoBase }
        | { estado: 'no_disponible'; motivo: MotivoSinOferta; texto: string }
    }

interface FilaPlanAnual {
  id: string
  estado: 'elegido' | 'activo' | 'sin_efecto' | 'requiere_revision'
  periodo_desde: string
  periodo_hasta: string
  cobro_id: string | null
  enlace_expira: string | null
  negocio_id: string
  plan_cobro_id: string
  workspace_id: string
  servicio_contratado_id: string
  monto: number | string
}

const COLUMNAS_PLAN = 'id, estado, periodo_desde, periodo_hasta, cobro_id, enlace_expira, negocio_id, plan_cobro_id, workspace_id, servicio_contratado_id, monto'

async function eleccionesDelContrato(db: Db, servicioContratadoId: string): Promise<FilaPlanAnual[] | 'error'> {
  const r = await db
    .from('planes_anuales_cda')
    .select(COLUMNAS_PLAN)
    .eq('servicio_contratado_id', servicioContratadoId)
    .in('estado', ['elegido', 'activo'])
  if (r.error) {
    console.error('[plan-anual] elecciones:', r.error.message)
    return 'error'
  }
  return (r.data ?? []) as FilaPlanAnual[]
}

/** Las series de Términos del Plan CDA: la v1.x de suscripción y la v2.0 de uso vía AFI. */
const SLUGS_TERMINOS_CDA = ['terminos-suscripcion-valida-cda', 'terminos-uso-valida']

async function datosBase(ctx: Ctx, plazo: PlazoAnual, db: Db): Promise<DatosAnexoBase | 'error'> {
  const [empresa, docs] = await Promise.all([
    db.from('empresas').select('nombre, razon_social, numero_documento').eq('id', ctx.contrato.empresaId).maybeSingle(),
    documentosDelCliente(),
  ])
  if (empresa.error || !empresa.data || !docs.ok) return 'error'
  const razonSocial = String(empresa.data.razon_social || empresa.data.nombre || '').trim()
  const nit = String(empresa.data.numero_documento || '').trim()
  // La versión de los Términos que el CDA aceptó (la más reciente aceptada): decide qué anexo ve.
  const aceptados = docs.documentos
    .filter((d) => d.aceptadoAt !== null && SLUGS_TERMINOS_CDA.some((p) => d.slug.startsWith(p)))
    .sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde))
  const version = aceptados[0]?.version.replace(/^v/i, '') ?? ''
  const plantilla = plantillaDelAnexo(version)
  if (!razonSocial || !nit || !plantilla) return 'error'
  // El anexo de los Términos v2.0 nombra la Orden y el valor de su usuario adicional: sin ellos no se arma.
  const p = ctx.contrato.parametros
  const ordenNumero = typeof p.orden_numero === 'string' && p.orden_numero.trim() ? p.orden_numero.trim() : null
  const precioUsuarioAdicional = typeof p.valor_usuario_adicional === 'number' && p.valor_usuario_adicional > 0 ? p.valor_usuario_adicional : null
  if (plantilla.terminos === 'v2' && (!ordenNumero || precioUsuarioAdicional === null)) return 'error'
  return {
    razonSocial,
    nit,
    versionTerminos: version,
    ordenNumero: plantilla.terminos === 'v2' ? ordenNumero : null,
    precioUsuarioAdicional: plantilla.terminos === 'v2' ? precioUsuarioAdicional : null,
    plazo: { desde: plazo.desde, hasta: plazo.hasta },
  }
}

/** La última elección de mención del contrato que cuenta: la de /suscripcion, o la del anexo de un plan activo. */
async function mencionVigente(db: Db, servicioContratadoId: string): Promise<EstadoMencion | null> {
  const r = await db
    .from('v_autorizacion_mencion_cda')
    .select('autoriza, created_at')
    .eq('servicio_contratado_id', servicioContratadoId)
    .maybeSingle()
  if (r.error || !r.data) {
    if (r.error) console.error('[plan-anual] mención:', r.error.message)
    return null
  }
  return { autoriza: r.data.autoriza === true, desde: String(r.data.created_at) }
}

async function razonSocialDe(db: Db, empresaId: string): Promise<string | null> {
  const r = await db.from('empresas').select('nombre, razon_social').eq('id', empresaId).maybeSingle()
  return r.data ? String(r.data.razon_social || r.data.nombre || '').trim() || null : null
}

/** Lo que muestra la pestaña Pagos junto a la cuota pendiente. */
export async function leerOpcionesPago(ctx: Ctx, ahoraMs: number = Date.now()): Promise<OpcionesPago> {
  if (ctx.producto !== 'valida_cda' || !planAnualHabilitado(ctx.contrato.parametros)) return { tipo: 'oculto' }
  const db = createServiceClient() as Db
  const hoy = ctx.entrada.hoy

  const [cuenta, elecciones] = await Promise.all([leerCuentaCda(ctx.entrada.servicioContratadoId), eleccionesDelContrato(db, ctx.contrato.id)])
  if (cuenta.estado !== 'ok' || elecciones === 'error') return { tipo: 'oculto' }

  const estados = cuotasConEstado({ cuotas: cuenta.cuotas, cobros: cuenta.cobros, hoy, ahoraISO: new Date(ahoraMs).toISOString() })
  const pendiente = estados.find((c) => c.estado !== 'pagada' && c.cuotaId)
  const mes: CuotaDelMes | null = pendiente?.cuotaId
    ? { cuotaId: pendiente.cuotaId, numero: pendiente.numero, saldo: pendiente.saldo, enlace: pendiente.enlacePago }
    : null

  const activo = elecciones.find((e) => e.estado === 'activo' && e.periodo_hasta >= hoy)
  if (activo) {
    const [mencion, razonSocial] = await Promise.all([mencionVigente(db, ctx.contrato.id), razonSocialDe(db, ctx.contrato.empresaId)])
    return { tipo: 'ok', mes, anual: { estado: 'activo', desde: activo.periodo_desde, hasta: activo.periodo_hasta, razonSocial, mencion } }
  }

  const elegido = elecciones.find((e) => e.estado === 'elegido')
  if (elegido?.cobro_id && elegido.enlace_expira && Date.parse(elegido.enlace_expira) > ahoraMs) {
    const c = await db.from('cobros').select('enlace_pago_url, fecha, anulado_at').eq('id', elegido.cobro_id).maybeSingle()
    const enlace = c.data && !c.data.fecha && !c.data.anulado_at ? enlaceDePagoValido(c.data.enlace_pago_url) : null
    if (enlace) return { tipo: 'ok', mes, anual: { estado: 'elegido', desde: elegido.periodo_desde, hasta: elegido.periodo_hasta, enlace } }
  }

  const plazo = plazoAnual(hoy, ctx.contrato.vigenteDesde)
  const oferta = ofertaPlanAnual({
    habilitado: true,
    precioMensual: typeof ctx.contrato.parametros.precio_mensual === 'number' ? ctx.contrato.parametros.precio_mensual : null,
    hoy,
    ahoraMs,
    hayCuotasVencidas: estados.some((c) => c.estado === 'vencida'),
    planActivoHasta: null,
    plazo,
  })
  if (!oferta.disponible) {
    return { tipo: 'ok', mes, anual: { estado: 'no_disponible', motivo: oferta.motivo, texto: TEXTO_SIN_OFERTA[oferta.motivo] } }
  }
  const datos = await datosBase(ctx, plazo, db)
  if (datos === 'error') return { tipo: 'ok', mes, anual: { estado: 'no_disponible', motivo: 'apagado', texto: 'No se pudo preparar el plan anual. Escríbenos.' } }
  return { tipo: 'ok', mes, anual: { estado: 'oferta', datos } }
}

// ── Pagar el mes ────────────────────────────────────────────────────────────────────────

/** El enlace de la cuota pendiente: el vigente o uno nuevo, con la misma función del botón y del cron. */
export async function enlaceDelMes(ctx: Ctx, deps: { adapterPara?: (p: string) => PasarelaAdapter | null } = {}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const opciones = await leerOpcionesPago(ctx)
  if (opciones.tipo !== 'ok' || !opciones.mes) return { ok: false, error: 'No hay una cuota pendiente para pagar.' }
  if (opciones.mes.enlace) return { ok: true, url: opciones.mes.enlace }
  const r = await generarEnlacePagoCuota(
    { workspaceId: ctx.contrato.cobradorId, cuotaId: opciones.mes.cuotaId },
    { db: createServiceClient() as unknown as SupabaseClient, adapterPara: deps.adapterPara },
  )
  if (!r.ok) return r
  return { ok: true, url: r.url }
}

// ── Elegir el plan anual ────────────────────────────────────────────────────────────────

export interface EntradaEleccion {
  nombre: unknown
  tipoDocumento: unknown
  numeroDocumento: unknown
  /** El texto de la casilla que la pantalla tenía a la vista. */
  casillaMostrada: unknown
  /** La huella del anexo que la pantalla tenía a la vista. */
  anexoSha256: unknown
  aceptaCasilla: unknown
  /** El texto de la casilla SEPARADA de mención (numeral 11) que la pantalla tenía a la vista. */
  casillaMencionMostrada: unknown
  /** La casilla de mención: voluntaria, desmarcada por defecto, no condiciona nada. */
  autorizaMencion: unknown
}

/**
 * La elección: comprueba de nuevo la oferta, arma el anexo con los datos de la persona y lo compara con
 * lo que la pantalla mostró, crea el cobro programado de $1.650.000, genera el enlace que vence al empezar
 * el plazo, y deja la constancia. Si algo falla antes de la constancia, el cobro queda anulado: no hay
 * enlace sin aceptación.
 */
export async function elegirPlanAnual(
  ctx: Ctx,
  input: EntradaEleccion,
  deps: { adapterPara?: (p: string) => PasarelaAdapter | null; ahoraMs?: number } = {},
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (input.aceptaCasilla !== true) return { ok: false, error: 'Marca la casilla para aceptar el anexo.' }
  const aceptante = validarAceptante(input)
  if (!aceptante.ok) return aceptante

  const ahoraMs = deps.ahoraMs ?? Date.now()
  const opciones = await leerOpcionesPago(ctx, ahoraMs)
  if (opciones.tipo !== 'ok') return { ok: false, error: 'El plan anual no está disponible para tu suscripción.' }
  if (opciones.anual.estado === 'elegido') return { ok: true, url: opciones.anual.enlace }
  if (opciones.anual.estado === 'activo') return { ok: false, error: TEXTO_SIN_OFERTA.plan_activo }
  if (opciones.anual.estado === 'no_disponible') return { ok: false, error: opciones.anual.texto }

  const datos = opciones.anual.datos
  if (typeof input.autorizaMencion !== 'boolean') return { ok: false, error: 'Falta tu respuesta sobre la autorización de mención.' }
  const { documento, anexo, casilla, casillaMencion } = renderAnexoPlanAnual({
    ...datos,
    nombreUsuario: aceptante.nombre,
    tipoDocumento: aceptante.tipoDocumento,
    numeroDocumento: aceptante.numeroDocumento,
  })
  if (
    input.casillaMostrada !== casilla ||
    input.casillaMencionMostrada !== casillaMencion ||
    input.anexoSha256 !== huellaTexto(anexo)
  ) {
    return { ok: false, error: 'El anexo cambió mientras lo leías. Recarga la página y vuelve a leerlo antes de aceptar.' }
  }

  const db = createServiceClient() as Db
  const ws = ctx.contrato.cobradorId

  // El plan de cobro del contrato y su pasarela.
  const planes = await db.from('planes_cobro').select('id, pasarela').eq('negocio_id', ctx.contrato.negocioId).eq('workspace_id', ws)
  if (planes.error) return { ok: false, error: 'No se pudo leer el plan de cobro. Intenta de nuevo.' }
  if ((planes.data ?? []).length !== 1) return { ok: false, error: 'Tu suscripción no tiene un plan de cobro único. Escríbenos y lo resolvemos.' }
  const plan = planes.data[0] as { id: string; pasarela: string | null }
  const cfg = await db.from('workspaces').select('config_extra').eq('id', ws).maybeSingle()
  const resolver = deps.adapterPara ?? adapterPara
  const pasarela = pasarelaDeEnlaces({
    pasarelaPlan: plan.pasarela,
    configWorkspace: cfg.data?.config_extra ?? null,
    generaEnlaces: (x) => Boolean(resolver(x)?.crearEnlacePago),
  })
  const adapter = pasarela ? resolver(pasarela) : null
  if (!pasarela || !adapter?.crearEnlacePago) return { ok: false, error: MOTIVO_SIN_PASARELA }
  const faltante = adapter.faltaConfiguracion?.() ?? null
  if (faltante) return { ok: false, error: faltante }

  // Una elección anterior cuyo enlace venció queda sin efecto (anexo 2.3), con su cobro anulado.
  const viejas = await db
    .from('planes_anuales_cda')
    .select('id, cobro_id')
    .eq('servicio_contratado_id', ctx.contrato.id)
    .eq('estado', 'elegido')
  if (viejas.error) return { ok: false, error: 'No se pudo leer la elección anterior. Intenta de nuevo.' }
  for (const v of (viejas.data ?? []) as { id: string; cobro_id: string | null }[]) {
    if (v.cobro_id) {
      await db.from('cobros').update({ anulado_at: new Date(ahoraMs).toISOString() }).eq('id', v.cobro_id).is('fecha', null).is('anulado_at', null)
    }
    const u = await db
      .from('planes_anuales_cda')
      .update({ estado: 'sin_efecto', detalle: 'El enlace venció sin pago (anexo 2.3).' })
      .eq('id', v.id)
      .eq('estado', 'elegido')
    if (u.error) return { ok: false, error: 'No se pudo cerrar la elección anterior. Intenta de nuevo.' }
  }

  const plazo = datos.plazo
  // 1. El cobro programado del plan, sin cuota todavía: la cuota anual nace al aprobarse el pago.
  const cobro = await db
    .from('cobros')
    .insert({
      workspace_id: ws,
      negocio_id: ctx.contrato.negocioId,
      plan_cobro_id: plan.id,
      numero_cuota: null,
      monto: PLAN_ANUAL.monto,
      tipo_cobro: 'programado',
      fecha_esperada: plazo.desde,
      // `cobros.fecha` tiene DEFAULT CURRENT_DATE: sin el null explícito nace «pagado».
      fecha: null,
      revisado: false,
      retencion: 0,
      notas: `Plan anual: 12 períodos del ${plazo.desde} al ${plazo.hasta}`,
    })
    .select('id')
    .single()
  if (cobro.error || !cobro.data?.id) return { ok: false, error: 'No se pudo crear el cobro del plan anual. Intenta de nuevo.' }
  const cobroId = cobro.data.id as string
  const anular = () => db.from('cobros').update({ anulado_at: new Date().toISOString() }).eq('id', cobroId).is('fecha', null)

  // 2. El enlace, que vence al empezar el plazo.
  const referencia = referenciaEnlaceCobro(cobroId, ahoraMs)
  const enlace = await adapter.crearEnlacePago({
    cobroId,
    monto: PLAN_ANUAL.monto,
    descripcion: descripcionEnlaceAnual(plazo),
    referencia,
    expiraMs: expiraEnlaceAnualMs(plazo.desde),
  })
  if (!enlace.ok) {
    await anular()
    return { ok: false, error: enlace.error }
  }

  // 3. La constancia de la aceptación, con el enlace.
  const origen = await origenPeticion()
  const ins = await db.from('planes_anuales_cda').insert({
    workspace_id: ws,
    workspace_cliente_id: ctx.workspaceId,
    servicio_contratado_id: ctx.contrato.id,
    negocio_id: ctx.contrato.negocioId,
    plan_cobro_id: plan.id,
    estado: 'elegido',
    periodo_desde: plazo.desde,
    periodo_hasta: plazo.hasta,
    periodos: PLAN_ANUAL.periodos,
    monto: PLAN_ANUAL.monto,
    precio_lista: PLAN_ANUAL.precioLista,
    // El documento que se MOSTRÓ (el de la serie de Términos del cliente): versión y huella de su plantilla.
    documento_slug: documento.slug,
    documento_version: documento.version,
    documento_texto_sha256: huellaTexto(documento.plantilla),
    texto_anexo: anexo,
    texto_anexo_sha256: huellaTexto(anexo),
    texto_aceptacion: casilla,
    texto_aceptacion_sha256: huellaTexto(casilla),
    // La autorización de mención (numeral 11), aparte de la aceptación: el trigger de la base deja además
    // su fila en `autorizaciones_mencion_cda` (13.2: «se registra aparte»).
    autoriza_mencion: input.autorizaMencion,
    texto_mencion: casillaMencion,
    texto_mencion_sha256: huellaTexto(casillaMencion),
    usuario_id: ctx.usuarioId,
    nombre_aceptante: aceptante.nombre,
    tipo_documento: aceptante.tipoDocumento,
    numero_documento: aceptante.numeroDocumento,
    ip: origen.ip,
    user_agent: origen.userAgent,
    cobro_id: cobroId,
    enlace_referencia: referencia,
    enlace_expira: enlace.expira,
  })
  if (ins.error) {
    await anular()
    if (ins.error.code === '23505') return { ok: false, error: 'Ya hay una elección del plan anual en curso. Recarga la página.' }
    console.error('[plan-anual] constancia:', ins.error.message)
    return { ok: false, error: 'No se pudo registrar la aceptación. Nada quedó cobrado; intenta de nuevo.' }
  }

  // 4. El enlace en el cobro, donde lo busca el webhook.
  const up = await db
    .from('cobros')
    .update({ enlace_pago_url: enlace.url, enlace_pago_expira: enlace.expira })
    .eq('id', cobroId)
    .is('fecha', null)
    .is('anulado_at', null)
  if (up.error) console.error('[plan-anual] enlace en el cobro:', up.error.message)
  return { ok: true, url: enlace.url }
}

// ── La autorización de mención (anexo, numeral 11) ──────────────────────────────────────

/**
 * Dar o revocar después la autorización de mención, desde /suscripcion. Solo con un plan anual activo (la
 * autorización es del anexo). Revocar es siempre posible; darla repite el texto exacto de la casilla del
 * anexo, que la pantalla mostró. Cada cambio es una fila nueva en `autorizaciones_mencion_cda` (con
 * fecha, persona, IP y dispositivo): nada se sobrescribe.
 */
export async function cambiarMencion(
  ctx: Ctx,
  input: { autoriza: unknown; textoMostrado: unknown },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof input.autoriza !== 'boolean') return { ok: false, error: 'Falta la respuesta.' }
  const opciones = await leerOpcionesPago(ctx)
  if (opciones.tipo !== 'ok' || opciones.anual.estado !== 'activo') {
    return { ok: false, error: 'La autorización de mención es del plan anual, y tu suscripción no tiene uno activo.' }
  }
  const { razonSocial, mencion } = opciones.anual
  if (!razonSocial) return { ok: false, error: 'No se pudo leer la razón social de tu empresa. Intenta de nuevo.' }
  if ((mencion?.autoriza ?? false) === input.autoriza) return { ok: true }
  const texto = input.autoriza ? textoMencionAutoriza(razonSocial) : textoRevocacionMencion(razonSocial)
  if (input.textoMostrado !== texto) return { ok: false, error: 'El texto cambió mientras lo leías. Recarga la página.' }
  const db = createServiceClient() as Db
  const activo = await db
    .from('planes_anuales_cda')
    .select('id')
    .eq('servicio_contratado_id', ctx.contrato.id)
    .eq('estado', 'activo')
    .order('periodo_hasta', { ascending: false })
    .limit(1)
    .maybeSingle()
  const origen = await origenPeticion()
  const ins = await db.from('autorizaciones_mencion_cda').insert({
    servicio_contratado_id: ctx.contrato.id,
    workspace_cliente_id: ctx.workspaceId,
    plan_anual_id: activo.data?.id ?? null,
    origen: 'suscripcion',
    autoriza: input.autoriza,
    texto,
    texto_sha256: huellaTexto(texto),
    usuario_id: ctx.usuarioId,
    ip: origen.ip,
    user_agent: origen.userAgent,
  })
  if (ins.error) {
    console.error('[plan-anual] cambiar mención:', ins.error.message)
    return { ok: false, error: 'No se pudo registrar tu respuesta. Intenta de nuevo.' }
  }
  return { ok: true }
}
