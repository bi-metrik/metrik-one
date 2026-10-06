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
  renderAnexoPlanAnual,
  TEXTO_SIN_OFERTA,
  validarAceptante,
  type MotivoSinOferta,
  type PlazoAnual,
} from './plan-anual'
import { ANEXO_PLAN_ANUAL_PLANTILLA, ANEXO_PLAN_ANUAL_SLUG, ANEXO_PLAN_ANUAL_VERSION } from './plan-anual-anexo'

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

/** Los datos del anexo que no escribe la persona: empresa, términos aceptados y el plazo. */
export interface DatosAnexoBase {
  razonSocial: string
  nit: string
  versionTerminos: string
  plazo: Pick<PlazoAnual, 'desde' | 'hasta'>
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
        | { estado: 'activo'; desde: string; hasta: string }
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

async function datosBase(ctx: Ctx, plazo: PlazoAnual, db: Db): Promise<DatosAnexoBase | 'error'> {
  const [empresa, docs] = await Promise.all([
    db.from('empresas').select('nombre, razon_social, numero_documento').eq('id', ctx.contrato.empresaId).maybeSingle(),
    documentosDelCliente(),
  ])
  if (empresa.error || !empresa.data || !docs.ok) return 'error'
  const razonSocial = String(empresa.data.razon_social || empresa.data.nombre || '').trim()
  const nit = String(empresa.data.numero_documento || '').trim()
  // La versión de los Términos que el CDA aceptó (la más reciente aceptada del Plan CDA).
  const aceptados = docs.documentos
    .filter((d) => d.aceptadoAt !== null && d.slug.startsWith('terminos-suscripcion-valida-cda'))
    .sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde))
  const version = aceptados[0]?.version.replace(/^v/i, '') ?? ''
  if (!razonSocial || !nit || !version) return 'error'
  return { razonSocial, nit, versionTerminos: version, plazo: { desde: plazo.desde, hasta: plazo.hasta } }
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
  if (activo) return { tipo: 'ok', mes, anual: { estado: 'activo', desde: activo.periodo_desde, hasta: activo.periodo_hasta } }

  const elegido = elecciones.find((e) => e.estado === 'elegido')
  if (elegido?.cobro_id && elegido.enlace_expira && Date.parse(elegido.enlace_expira) > ahoraMs) {
    const c = await db.from('cobros').select('enlace_pago_url, fecha, anulado_at').eq('id', elegido.cobro_id).maybeSingle()
    const enlace = c.data && !c.data.fecha && !c.data.anulado_at ? enlaceDePagoValido(c.data.enlace_pago_url) : null
    if (enlace) return { tipo: 'ok', mes, anual: { estado: 'elegido', desde: elegido.periodo_desde, hasta: elegido.periodo_hasta, enlace } }
  }

  const plazo = plazoAnual(hoy, ctx.contrato.vigenteDesde)
  const oferta = ofertaPlanAnual({
    habilitado: true,
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
  const { anexo, casilla } = renderAnexoPlanAnual({
    ...datos,
    nombreUsuario: aceptante.nombre,
    tipoDocumento: aceptante.tipoDocumento,
    numeroDocumento: aceptante.numeroDocumento,
  })
  if (input.casillaMostrada !== casilla || input.anexoSha256 !== huellaTexto(anexo)) {
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
    documento_slug: ANEXO_PLAN_ANUAL_SLUG,
    documento_version: ANEXO_PLAN_ANUAL_VERSION,
    documento_texto_sha256: huellaTexto(ANEXO_PLAN_ANUAL_PLANTILLA),
    texto_anexo: anexo,
    texto_anexo_sha256: huellaTexto(anexo),
    texto_aceptacion: casilla,
    texto_aceptacion_sha256: huellaTexto(casilla),
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
