/**
 * Aviso de sobrepago al área financiera — las reglas, sin base de datos.
 *
 * ── El caso que lo motivó ───────────────────────────────────────────────────
 *
 * V0442 (SOENA, septiembre de 2026): valor a recaudar $1.339.312 (honorario $637.500 +
 * tarifa UPME $701.812), el cliente pagó $1.356.500. Sobraban $17.188, por encima del piso
 * de materialidad. Como la etapa Cartera declara `conciliar_sobrepago`, el motor no la
 * saltó y el caso aterrizó ahí, con el diálogo de "pasar a recaudo". Operaciones no
 * entendió por qué.
 *
 * Decisión de Mauricio (2026-09-15): **un sobrepago NO detiene la gestión.** El caso sigue;
 * el sobrante queda en Tesorería y a la financiera se le avisa, pero NO a través del
 * negocio. Por eso este aviso no deja rastro en la pantalla del caso (ni `activity_log`,
 * ni metadata, ni gate): va a la campana y al correo del área, con el enlace a la lista de
 * sobrantes de `/conciliacion`.
 *
 * ⚠️ El orden de encendido importa. Apagar `conciliar_sobrepago` en Cartera ANTES de que
 * este aviso esté activo hace que los sobrepagos salten la etapa sin que nadie los vea.
 *
 * ── Qué cuenta como sobrepago ───────────────────────────────────────────────
 *
 * Exactamente lo que la pestaña Saldos de `/conciliacion` lista como "Sobrante", para que
 * el enlace del aviso aterrice en una lista que contiene el caso. No se escribe ninguna
 * resta: el exceso sale de `descuadreConciliacion` (mide contra honorario + tarifa, ver
 * `modelo-dinero.ts`), el recaudo de `sumarRecaudoConfirmado` con la misma exclusión que
 * usa el panel, y el piso de `saldoCuadrado`. `aviso-sobrepago.test.ts` fija el contrato
 * contra `saldoConciliacion`, que es lo que el panel filtra.
 *
 * ── Opt-in ──────────────────────────────────────────────────────────────────
 *
 *     config_extra.aviso_sobrepago = { "activo": true, "areas": ["financiera"], "email": true }
 *
 * En la LÍNEA (gana) o en el WORKSPACE. Solo `activo: true` lo enciende; sin la clave
 * ningún workspace cambia. `areas` por defecto es `["financiera"]`; `email` solo sale con
 * `true`, igual que `avisar_al_entrar`.
 *
 * ── Idempotencia ────────────────────────────────────────────────────────────
 *
 * Un aviso por negocio POR MONTO de sobrepago. La clave del pendiente de equipo lleva el
 * exceso: si el caso avanza diez veces con los mismos $17.188 de más, el aviso sale una
 * vez. Si entra otro pago y el sobrante cambia, es un sobrepago distinto y sale uno nuevo
 * (y el pendiente viejo, si seguía abierto, se retira: no puede haber dos cifras vivas
 * para el mismo caso). La existencia se mira en CUALQUIER estado, no solo pendiente: que
 * la financiera marque el aviso como atendido no puede hacer que el siguiente avance lo
 * vuelva a mandar.
 *
 * Puro: no toca DB ni red.
 */

import { descuadreConciliacion } from '@/lib/upme/modelo-dinero'
import { saldoCuadrado } from '@/lib/negocios/tolerancia-saldo'
import { sumarRecaudoConfirmado, type CobroParaRecaudo } from '@/lib/negocios/recaudo-confirmado'
import { formatearSaldo } from '@/lib/negocios/confirmacion-avance'
import { escaparHtml } from '@/lib/propuesta/terminos'
import { PALETA } from '@/lib/marca/paleta'

// ── Config ────────────────────────────────────────────────────────────────────

/** Lo que una línea o un workspace declaran en `config_extra.aviso_sobrepago`. */
export interface ConfigAvisoSobrepagoDeclarada {
  activo?: unknown
  areas?: unknown
  email?: unknown
}

/** Config ya resuelta: si existe, el aviso está encendido. */
export interface ConfigAvisoSobrepago {
  areas: string[]
  email: boolean
}

/** Área a la que se avisa si la config no dice otra cosa. */
export const AREA_POR_DEFECTO = 'financiera'

function declarada(configExtra: Record<string, unknown> | null | undefined): ConfigAvisoSobrepagoDeclarada | null {
  const cfg = configExtra?.aviso_sobrepago
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null
  const d = cfg as ConfigAvisoSobrepagoDeclarada
  // Sin un booleano en `activo` la declaración no decide nada: una config a medio
  // escribir no debe prender ni apagar el aviso en silencio.
  return typeof d.activo === 'boolean' ? d : null
}

/**
 * ¿El aviso está encendido para este negocio, y con qué destinos?
 *
 * La línea gana sobre el workspace: la primera que declare `activo` con un booleano,
 * manda (una línea puede apagarlo aunque el workspace lo tenga encendido). Devuelve `null`
 * cuando está apagado, que es el caso por defecto.
 */
export function configAvisoSobrepago(
  configExtraLinea: Record<string, unknown> | null | undefined,
  configExtraWorkspace: Record<string, unknown> | null | undefined,
): ConfigAvisoSobrepago | null {
  const d = declarada(configExtraLinea) ?? declarada(configExtraWorkspace)
  if (!d || d.activo !== true) return null

  const areas = Array.isArray(d.areas)
    ? [...new Set(d.areas.filter((a): a is string => typeof a === 'string').map((a) => a.trim()).filter(Boolean))]
    : []

  return {
    areas: areas.length > 0 ? areas : [AREA_POR_DEFECTO],
    email: d.email === true,
  }
}

// ── Cálculo ───────────────────────────────────────────────────────────────────

/**
 * Tipos de cobro que el panel de conciliación no suma al recaudo. Se reusa la misma
 * lista para que el aviso y la pestaña Saldos digan lo mismo sobre el mismo negocio.
 */
export const TIPOS_EXCLUIDOS_DEL_RECAUDO = ['devolucion_pendiente']

export interface EntradaSobrepago {
  /** `precio_aprobado ?? precio_estimado ?? 0` = HONORARIO, como lo lee el panel. */
  honorario: number
  /** Tarifa UPME confirmada (`tarifaConfirmadaPorNegocio`). 0 si no hay. */
  tarifaConfirmada: number
  /** Cobros del negocio, con `split_json` y `tipo_cobro`. */
  cobros: CobroParaRecaudo[]
  /** `negocio_conciliacion.conciliado`. */
  conciliado: boolean
}

/**
 * Pesos de más que el negocio recibió, si pasan el piso de materialidad. `0` si no hay
 * sobrepago que avisar (sin exceso, o con un residuo de redondeo).
 */
export function excesoParaAviso(e: EntradaSobrepago): number {
  const recaudado = sumarRecaudoConfirmado(e.cobros, e.conciliado, {
    excluirTipos: TIPOS_EXCLUIDOS_DEL_RECAUDO,
  })
  const { exceso } = descuadreConciliacion(
    e.honorario,
    { tarifa_upme: e.tarifaConfirmada, aprobado_plan: null, aprobado_honorario: null },
    recaudado,
  )
  return saldoCuadrado(exceso) ? 0 : exceso
}

// ── Idempotencia ──────────────────────────────────────────────────────────────

/** Prefijo común de todos los avisos de sobrepago de un negocio. */
export function prefijoAvisoSobrepago(negocioId: string): string {
  return `sobrepago:negocio:${negocioId}:`
}

/**
 * Clave del pendiente de equipo. Lleva el área, como `avisar_al_entrar`: si el aviso va
 * a dos áreas, que una lo atienda no debe borrárselo a la otra.
 */
export function claveAvisoSobrepago(negocioId: string, exceso: number, area: string): string {
  return `${prefijoAvisoSobrepago(negocioId)}exceso:${Math.round(exceso)}:area:${area}`
}

/** Un aviso de sobrepago que ya existe para el negocio, en cualquier estado. */
export interface AvisoPrevio {
  grupo_clave: string | null
  estado: string | null
}

export interface PlanAviso {
  /** Áreas a las que hay que crearles el aviso, con su clave. */
  crear: Array<{ area: string; clave: string }>
  /** Pendientes de un monto ANTERIOR que hay que retirar antes de crear el nuevo. */
  retirar: string[]
}

/**
 * Qué hacer con el sobrepago de hoy, dado lo que ya se avisó.
 *
 * Sin nada que crear no se retira nada: si el aviso vigente ya salió, cualquier pendiente
 * viejo que siga abierto es de otro momento y no le corresponde a este cálculo tocarlo.
 */
export function planAvisoSobrepago(input: {
  negocioId: string
  exceso: number
  areas: string[]
  previos: AvisoPrevio[]
}): PlanAviso {
  if (!(input.exceso > 0)) return { crear: [], retirar: [] }

  const existentes = new Set(input.previos.map((p) => p.grupo_clave).filter((g): g is string => !!g))
  const crear = input.areas
    .map((area) => ({ area, clave: claveAvisoSobrepago(input.negocioId, input.exceso, area) }))
    .filter((c) => !existentes.has(c.clave))
  if (crear.length === 0) return { crear: [], retirar: [] }

  const vigentes = new Set(input.areas.map((a) => claveAvisoSobrepago(input.negocioId, input.exceso, a)))
  const prefijo = prefijoAvisoSobrepago(input.negocioId)
  const retirar = [...new Set(
    input.previos
      .filter((p) => p.estado === 'pendiente' && !!p.grupo_clave && p.grupo_clave.startsWith(prefijo))
      .map((p) => p.grupo_clave as string)
      .filter((g) => !vigentes.has(g)),
  )]

  return { crear, retirar }
}

// ── Contenido ─────────────────────────────────────────────────────────────────

/**
 * A dónde lleva el aviso: la pestaña Saldos de Tesorería con el filtro de sobrantes, NO
 * el negocio. Lo lee `destinoInicialConciliacion` (`conciliacion/destino-inicial.ts`).
 */
export const ENLACE_SOBRANTES = '/conciliacion?pestana=saldos&saldo=sobrante'

export interface NegocioDelAviso {
  codigo: string | null
  nombre: string | null
}

function etiquetaNegocio(n: NegocioDelAviso): string {
  const nombre = (n.nombre ?? '').trim()
  const codigo = (n.codigo ?? '').trim()
  if (codigo && nombre) return `${codigo} — ${nombre}`
  return codigo || nombre || 'Un negocio'
}

/** Texto de la campana. */
export function contenidoAvisoSobrepago(n: NegocioDelAviso, exceso: number): string {
  return `Sobrepago en ${etiquetaNegocio(n)}: el cliente pagó ${formatearSaldo(exceso)} más de lo que había que recaudarle. Queda en Tesorería, pestaña Saldos.`
}

/** Asunto y cuerpo del correo al área. */
export function correoAvisoSobrepago(input: {
  negocio: NegocioDelAviso
  exceso: number
  workspaceSlug: string
  baseDomain: string
}): { asunto: string; html: string } {
  const monto = formatearSaldo(input.exceso)
  const etiqueta = etiquetaNegocio(input.negocio)
  const codigo = (input.negocio.codigo ?? '').trim()
  const enlace = `https://${input.workspaceSlug}.${input.baseDomain}${ENLACE_SOBRANTES}`

  const asunto = `Sobrepago${codigo ? ` en ${codigo}` : ''}: ${monto} de más`
  const html = `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:24px;background:${PALETA.papel};font-family:Helvetica,Arial,sans-serif;color:${PALETA.tinta}">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:28px">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${PALETA.tintaSuave}">Tesorería</p>
    <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35">Un negocio quedó con sobrepago</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151">El cliente pagó <strong>${escaparHtml(monto)}</strong> más de lo que había que recaudarle (honorario más tarifa). El caso sigue su curso; el sobrante queda en Tesorería para que lo concilies.</p>
    <p style="margin:0 0 22px;font-size:13px;color:#6B7280">Negocio: <strong style="color:${PALETA.tinta}">${escaparHtml(etiqueta)}</strong></p>
    <a href="${enlace}" style="display:inline-block;background:${PALETA.acento};color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600">Ver sobrantes en Tesorería</a>
    <p style="margin:24px 0 0;font-size:11px;color:#9CA3AF;border-top:1px solid #E5E7EB;padding-top:14px">Enviado por MéTRIK ONE</p>
  </div>
</body></html>`

  return { asunto, html }
}
