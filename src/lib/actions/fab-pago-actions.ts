'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { getAreasEfectivas, type Area, type Role, type Stage } from '@/lib/permissions/can-edit'
import { guardAvanzarStage } from '@/lib/permissions/guard-negocio'
import {
  registrarPagoEnNegocio,
  leerModeloDineroCompleto,
  type AgregarPagoInput,
} from '@/lib/actions/conciliacion-actions'
import { ofrecimientoDeAvance, esGateDeAnticipo, type OfrecimientoAvance } from '@/lib/negocios/avance-tras-pago'
import { anticipoCubiertoPorSaldo } from '@/app/(app)/negocios/negocio-v2-actions'
import { siguienteEtapaPorDefecto } from '@/lib/negocios/flujo'
import { puedeOmitirGate } from '@/lib/negocios/gate-omitible'
import { sumarRecaudoConfirmado, type CobroParaRecaudo } from '@/lib/negocios/recaudo-confirmado'
import { saldoConciliacion } from '@/lib/upme/modelo-dinero'
import { leerAviso } from '@/lib/correcciones/retroceso'
import { archivarSoporte, type SoporteSubidoInput } from '@/lib/cobros/soporte-pago'
import { PREFIJO_REF_AUTOGENERADA } from '@/lib/cobros/referencia-externa'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { randomUUID } from 'crypto'

// Cast a untyped para columnas no presentes en database.ts (config_extra).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

/**
 * Guard del FAB "Registrar pago" — DESACOPLADO de STAGE_TO_AREA.
 *
 * Principio: "el cobro lo lidera el comercial". Registrar un pago vía FAB NO debe
 * exigir que el área del usuario coincida con el stage actual del negocio (a
 * diferencia de `guardEditarBloque`, que valida el área de la etapa). Por eso este
 * guard valida SOLO el ROL + excluye a operaciones pura:
 *
 *   - owner / admin            → habilitados (lideran todo)
 *   - supervisor / operator    → habilitados, SALVO que su única área sea operaciones
 *   - contador / read_only     → nunca (fuera del manejo de dinero)
 *
 * "Operaciones pura" = tiene área(s) asignada(s) y TODAS son 'operaciones' (sin
 * comercial/financiera/direccion). Si no tiene áreas, queda habilitado (el comercial
 * por defecto lidera el cobro). El negocio debe existir y ser del workspace — eso lo
 * valida `registrarPagoEnNegocio` al recibir el negocio_id.
 */
function rolHabilitadoParaPagoFab(role: Role, areas: Area[]): boolean {
  if (role === 'read_only' || role === 'contador') return false
  if (role === 'owner' || role === 'admin') return true
  if (role === 'supervisor' || role === 'operator') {
    if (areas.length === 0) return true // sin segmentación → lidera el cobro
    const efectivas = getAreasEfectivas({ id: '', role, areas })
    // Habilitado si tiene comercial o financiera (directa o vía dirección).
    // Excluido si su único alcance efectivo es operaciones.
    return efectivas.has('comercial') || efectivas.has('financiera')
  }
  return false
}

/**
 * ¿Este workspace cobra por ePayco?
 *
 * Es una capacidad del workspace, no una verdad del producto. SOENA cobra por la
 * pasarela y toda su operación de cobro se apoya en verificar la referencia contra
 * ePayco. Termotech cobra por transferencia y consignación: pedirle una `ref_payco`
 * dejaba el módulo de pagos inservible, con cero cobros registrados desde que se
 * activó.
 *
 * Lee `modules.fab_pago_epayco`. Ausente = no, que es lo correcto para todo
 * workspace nuevo: la pasarela se habilita cuando existe, no por defecto.
 */
export async function workspaceCobraPorEpayco(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('workspaces').select('modules').eq('id', workspaceId).maybeSingle()
  const modules = (data?.modules ?? {}) as Record<string, boolean>
  return modules.fab_pago_epayco === true
}

export async function ctxFabPago(): Promise<
  | { ok: true; supabase: unknown; workspaceId: string; staffId: string | null }
  | { ok: false; error: string }
> {
  const { supabase, workspaceId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: error ?? 'No autenticado' }
  // El pago se registra sobre un negocio: es de Clarity. Sin el módulo, ni la lista de
  // negocios ni el registro, aunque la acción se llame directo.
  if (!(await exigirModulo(REQUISITO.clarity)).ok) return { ok: false, error: MENSAJE_MODULO_NO_ACTIVO }
  const r = (role ?? 'read_only') as Role
  const a = (areas ?? []) as Area[]
  if (!rolHabilitadoParaPagoFab(r, a)) {
    return { ok: false, error: 'Tu rol no puede registrar pagos.' }
  }
  return { ok: true, supabase, workspaceId, staffId }
}

/**
 * Lo que el modal de pago necesita saber del workspace antes de pintar el
 * formulario: los negocios, y si hay pasarela contra la cual verificar.
 *
 * Va en la misma llamada que ya hacía el modal para traer los negocios. Una
 * consulta aparte solo para un booleano abriría la ventana en la que el
 * formulario se pinta con la fuente equivocada.
 */
export interface ContextoPagoFab {
  negocios: NegocioParaPagoFab[]
  cobraPorEpayco: boolean
  /** El modal lo necesita para el path del comprobante en Storage: la policy del
   *  bucket exige que la primera carpeta sea el workspace. */
  workspaceId: string | null
  error?: string
}

/** Negocio elegible para registrar un pago desde el FAB. */
export interface NegocioParaPagoFab {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  empresa: string | null
}

/**
 * Lista los negocios del workspace para el selector del FAB de pago. Incluye TODOS
 * los abiertos (sin filtrar por etapa/área ni por responsable) — el comercial que
 * recibe el pago puede registrarlo aunque el negocio esté en ejecución/cobro de
 * otra área. Guard por rol vía `ctxFabPago`.
 */
export async function getNegociosParaPagoFab(): Promise<ContextoPagoFab> {
  const ctx = await ctxFabPago()
  if (!ctx.ok) return { negocios: [], cobraPorEpayco: false, workspaceId: null, error: ctx.error }
  const { supabase, workspaceId } = ctx
  const cobraPorEpayco = await workspaceCobraPorEpayco(supabase, workspaceId)

  const { data: raw } = await db(supabase)
    .from('negocios')
    .select('id, codigo, nombre, estado, empresas:empresa_id ( nombre )')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'abierto')
    .order('created_at', { ascending: false })

  const negocios: NegocioParaPagoFab[] = ((raw ?? []) as Array<{
    id: string
    codigo: string | null
    nombre: string | null
    empresas: { nombre: string | null } | null
  }>).map((n) => ({
    negocio_id: n.id,
    codigo: n.codigo,
    nombre: n.nombre,
    empresa: n.empresas?.nombre ?? null,
  }))

  return { negocios, cobraPorEpayco, workspaceId }
}

/**
 * ¿Este negocio puede recibir un cobro hoy? Se pregunta al ELEGIR el negocio en
 * el modal, antes de teclear referencia y valor.
 *
 * Aquí el flag no puede viajar precomputado como en el detalle: el FAB elige el
 * negocio desde una lista de todos los abiertos (223 en SOENA), y resolverlo para
 * cada uno costaría una llamada por fila. Por eso pregunta una sola vez, cuando
 * ya se sabe por cuál.
 *
 * El criterio NO se reimplementa: lo responde `negocio_puede_recibir_cobro`, la
 * misma función que sostiene el trigger de `cobros`. Ante `null` (negocio de otro
 * workspace) o error se deja pasar: el trigger sigue siendo la barrera dura, y un
 * aviso que aparece por no poder leer el estado enseña a ignorarlo.
 */
export async function negocioPuedeRecibirCobro(
  negocioId: string,
): Promise<{ puede: boolean }> {
  const ctx = await ctxFabPago()
  if (!ctx.ok) return { puede: true }
  const { data, error } = await db(ctx.supabase).rpc('negocio_puede_recibir_cobro', {
    p_negocio_id: negocioId,
  })
  if (error || data == null) return { puede: true }
  return { puede: data === true }
}

/**
 * Registra un pago desde el FAB global. Guard por ROL (no por área de etapa) +
 * REUSA la vía única `registrarPagoEnNegocio` (misma validación ePayco/duplicado,
 * mismo saldo, mismo des-conciliar). Etiqueta el origen 'fab' en activity_log.
 *
 * NO abre el editor de la etapa: es un formulario aislado de captura. NO bypasea
 * ninguna barrera de control — solo desacopla el PERMISO de STAGE_TO_AREA.
 */
export async function agregarPagoFab(
  input: AgregarPagoInput & { soporte_subido?: SoporteSubidoInput },
): Promise<
  | { success: true }
  | { success: false; error: string; code?: 'epayco_no_aprobada' | 'referencia_duplicada'; negocio_existente?: { codigo: string | null } }
> {
  const ctx = await ctxFabPago()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx

  // El comprobante es OPCIONAL aquí, al revés que en el panel de pagos externos: este
  // modal registra ingresos que entran por transferencia, efectivo o cheque, y exigir
  // el pantallazo para poder anotar la plata deja el ingreso sin registrar, que es
  // peor que registrarlo sin foto. Si viene, viaja en el mismo INSERT que el cobro.
  const { soporte_subido, ...pago } = input

  // `external_ref` es la llave del registro de pagos y no puede ir vacía, pero pedirla
  // solo tiene sentido donde hay pasarela: ahí se teclea del comprobante de ePayco y
  // sostiene el control de duplicados. En un workspace que cobra por transferencia no
  // hay nada que teclear, así que la referencia se genera, igual que en el panel de
  // pagos externos. Lo que dice de dónde entró la plata es el comprobante adjunto.
  if (!pago.referencia?.trim()) {
    if (await workspaceCobraPorEpayco(supabase, workspaceId)) {
      return { success: false, error: 'Ingresa la referencia del pago' }
    }
    const dia = (pago.fecha || todayBogotaISO()).replace(/-/g, '')
    pago.referencia = `${PREFIJO_REF_AUTOGENERADA}${dia}-${randomUUID().slice(0, 6).toUpperCase()}`
  }
  let soporte: Record<string, unknown> | null = null
  if (soporte_subido?.storage_path) {
    soporte = await archivarSoporte(
      supabase, workspaceId, input.negocio_id, soporte_subido, null, staffId ?? '',
    )
    // Si el archivado falla, el pago igual se registra: perder el ingreso porque el
    // adjunto no se pudo guardar sería cambiar un problema chico por uno grande.
    if (!soporte) console.warn('[fab-pago] el comprobante no se pudo archivar')
  }

  return registrarPagoEnNegocio(
    supabase, workspaceId, staffId, { ...pago, soporte: soporte ?? pago.soporte }, 'fab',
  )
}

/**
 * Lo que la pantalla necesita para OFRECER el avance justo después de registrar el pago.
 *
 * La decisión de qué ofrecer vive en `ofrecimientoDeAvance` (puro, con sus pruebas);
 * aquí solo se resuelve el estado contra la base, sin reimplementar ningún criterio:
 *
 *   - el destino, con `siguienteEtapaPorDefecto`, la MISMA fuente que usan la ficha del
 *     negocio y el diagrama de `/flujo`;
 *   - el permiso, con `guardAvanzarStage`. ⚠️ Se le pasa el `stage_actual`, NO el del
 *     destino: es exactamente como lo llama `cambiarEtapaNegocioConGate`, y medirlo
 *     contra el destino daría una respuesta distinta de la del servidor;
 *   - los gates, con `puede_avanzar_etapa` y `gates_pendientes_etapa`, las mismas RPC
 *     que consulta el motor;
 *   - el saldo, con `saldoConciliacion`, que es `descuadreConciliacion` puesto en un
 *     solo número. No hay una segunda resta en este archivo.
 *
 * Se llama SOLO después de que el pago quedó registrado, y solo para ese negocio.
 */
export interface AvanceTrasPago {
  ofrecimiento: OfrecimientoAvance
  /**
   * Saldo del cliente CON SIGNO: `> 0` falta plata, `< 0` sobra, `0` está cuadrado.
   * Se muestra siempre, decida lo que decida el ofrecimiento: quien acaba de anotar la
   * plata quiere ver en qué quedó la cuenta aunque el caso no se pueda mover.
   */
  saldo: number
  /** Id de la etapa destino por defecto, con el que la pantalla llama al movedor. */
  etapaDestinoId: string | null
}

export async function estadoAvanceTrasPago(negocioId: string): Promise<AvanceTrasPago> {
  // Ante cualquier tropiezo se calla. El pago YA quedó registrado y eso es lo que
  // importaba: un panel que grita un error encima de una operación que salió bien
  // enseña a desconfiar del registro del pago, que es lo último que conviene.
  const mudo: AvanceTrasPago = { ofrecimiento: { tipo: 'no_aplica' }, saldo: 0, etapaDestinoId: null }

  const ctx = await ctxFabPago()
  if (!ctx.ok) return mudo
  const { supabase, workspaceId } = ctx

  const { data: negRaw } = await db(supabase)
    .from('negocios')
    .select('estado, pausado, etapa_actual_id, stage_actual, linea_id, precio_aprobado, precio_estimado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const negocio = negRaw as {
    estado: string | null; pausado: boolean | null; etapa_actual_id: string | null
    stage_actual: string | null; linea_id: string | null
    precio_aprobado: number | null; precio_estimado: number | null
  } | null
  if (!negocio) return mudo

  // El saldo se resuelve SIEMPRE, incluso para un negocio cerrado o sin etapa: es la
  // parte del panel que confirma en qué quedó la cuenta.
  const [cobrosRes, conciliadoRes, modelo] = await Promise.all([
    db(supabase).from('cobros').select('monto, split_json')
      .eq('negocio_id', negocioId).eq('workspace_id', workspaceId),
    db(supabase).from('negocio_conciliacion').select('conciliado')
      .eq('negocio_id', negocioId).eq('workspace_id', workspaceId).maybeSingle(),
    leerModeloDineroCompleto(supabase, negocioId),
  ])
  const recaudado = sumarRecaudoConfirmado(
    (cobrosRes.data ?? []) as CobroParaRecaudo[],
    (conciliadoRes.data as { conciliado: boolean } | null)?.conciliado === true,
  )
  const honorario = negocio.precio_aprobado ?? negocio.precio_estimado ?? 0
  const saldo = saldoConciliacion(honorario, modelo, recaudado)

  if (!negocio.etapa_actual_id || !negocio.linea_id) {
    return {
      ofrecimiento: ofrecimientoDeAvance({
        estado: negocio.estado,
        pausado: negocio.pausado === true,
        etapaDestinoNombre: null,
        puedeAvanzar: false,
        motivos: [],
      }),
      saldo,
      etapaDestinoId: null,
    }
  }

  // Por dónde sigue el proceso: misma regla que la ficha y que `/flujo`.
  const { data: etapasRaw } = await db(supabase)
    .from('etapas_negocio')
    .select('id, nombre, orden, config_extra')
    .eq('linea_id', negocio.linea_id)
    .order('orden', { ascending: true })
  const etapas = ((etapasRaw ?? []) as Array<{
    id: string; nombre: string; orden: number; config_extra: Record<string, unknown> | null
  }>).map((e) => ({
    id: e.id,
    nombre: e.nombre,
    orden: e.orden,
    config_extra: e.config_extra,
    routing: ((e.config_extra as { routing?: { default_etapa_orden?: number } } | null)?.routing ?? null),
  }))
  const etapaActual = etapas.find((e) => e.id === negocio.etapa_actual_id) ?? null
  const destino = etapaActual ? siguienteEtapaPorDefecto(etapaActual, etapas) : null

  // La etapa puede invitar a otra área a avanzarla, igual que en el motor.
  const areasQueAvanzan = ((etapaActual?.config_extra as { areas_que_avanzan?: unknown } | null)
    ?.areas_que_avanzan ?? []) as Area[]
  const permiso = await guardAvanzarStage(
    negocioId, (negocio.stage_actual ?? 'venta') as Stage, areasQueAvanzan,
  )

  const motivos = await motivosQueRetienen(supabase, workspaceId, negocioId, negocio.etapa_actual_id)

  return {
    ofrecimiento: ofrecimientoDeAvance({
      estado: negocio.estado,
      pausado: negocio.pausado === true,
      etapaDestinoNombre: destino?.nombre ?? null,
      puedeAvanzar: permiso.ok,
      motivos,
    }),
    saldo,
    etapaDestinoId: destino?.id ?? null,
  }
}

/**
 * Lo que retiene el caso HOY, con los nombres que el equipo reconoce. Dos fuentes, las
 * dos ya existentes:
 *
 *   - `gates_pendientes_etapa`, la misma RPC que lista el motor. Se le quitan los gates
 *     que ESTA persona puede declarar vencidos (`puedeOmitirGate`), porque a ella no la
 *     retienen: el motor los marca como "no aplica" y sigue. Sin ese filtro el panel
 *     afirmaría que algo retiene cuando el servidor la dejaría pasar. En producción es
 *     un solo bloque el que lo declara (el aviso del enlace de la DIAN, en SOENA), pero
 *     está vivo y el criterio es el mismo.
 *   - el aviso de recaudo cambiado, que es un gate duro y ADEMÁS no cede al override de
 *     nadie. Se nombra aparte porque su salida no es completar un bloque sino resolver
 *     el aviso desde la ficha del negocio, y decirlo aquí ahorra el viaje.
 *
 * Los demás gates del motor (saldo, handoff, campo, sobrepago, conciliación, duplicado)
 * NO se consultan: reimplementarlos sería una segunda vara para lo mismo, que es el
 * error que este repo ya pagó varias veces. Si retienen, el clic devuelve
 * `gate_bloqueado` y la pantalla los lista entonces.
 */
async function motivosQueRetienen(
  supabase: unknown,
  workspaceId: string,
  negocioId: string,
  etapaActualId: string,
): Promise<string[]> {
  const motivos: string[] = []

  const { data: puedeAvanzar } = await db(supabase).rpc('puede_avanzar_etapa', {
    p_negocio_id: negocioId,
    p_etapa_id: etapaActualId,
  })

  if (puedeAvanzar === false) {
    const { role, areas } = await getWorkspace()
    const { data: pendientesRaw } = await db(supabase).rpc('gates_pendientes_etapa', {
      p_negocio_id: negocioId,
      p_etapa_id: etapaActualId,
    })
    const pendientes = (pendientesRaw ?? []) as Array<{ bloque_config_id: string; nombre: string | null }>

    let cfgPorId = new Map<string, Record<string, unknown> | null>()
    if (pendientes.length > 0) {
      const { data: cfgs, error: errCfgs } = await db(supabase)
        .from('bloque_configs')
        .select('id, config_extra')
        .in('id', pendientes.map((p) => p.bloque_config_id))
      // Sin la config, ningún gate se da por omitible: el lado seguro de un control es
      // retener. Aquí eso solo significa listar de más, nunca dejar pasar de más.
      if (!errCfgs) {
        cfgPorId = new Map(((cfgs ?? []) as Array<{ id: string; config_extra: Record<string, unknown> | null }>)
          .map((c) => [c.id, c.config_extra]))
      }
    }

    // El saldo solo se consulta si hay un gate de anticipo entre los pendientes, mismo
    // corte que hace el motor: sin candidato no hay nada que preguntar.
    const anticipoCubierto =
      pendientes.some(p => esGateDeAnticipo(cfgPorId.get(p.bloque_config_id)))
        ? await anticipoCubiertoPorSaldo(supabase, workspaceId, negocioId)
        : false

    const usuario = { role: (role ?? 'read_only') as Role, areas: (areas ?? []) as Area[] }
    for (const p of pendientes) {
      const cfg = cfgPorId.get(p.bloque_config_id)
      // No retiene a esta persona: ella puede declarar vencido el paso.
      if (puedeOmitirGate(cfg, usuario)) continue
      // No retiene a nadie: el motor lo cierra solo en cuanto alguien avance.
      if (anticipoCubierto && esGateDeAnticipo(cfg)) continue
      motivos.push(p.nombre ?? 'Bloque pendiente')
    }
  }

  const aviso = await leerAviso(supabase, workspaceId, negocioId)
  if (aviso) {
    motivos.push(
      `El recaudo de este negocio cambió (referencia ${aviso.referencia}) y todavía nadie lo resolvió. ` +
      'Lo resuelve el área financiera desde el aviso del negocio.',
    )
  }

  return motivos
}
