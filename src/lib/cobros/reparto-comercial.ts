/**
 * Reparto de UN pago entre varios negocios, propuesto por el comercial.
 *
 * Por qué existe (medido en producción SOENA, 2026-10-19): desde el 23-sep la financiera
 * rehízo 4 repartos y los 4 fallaron de una de dos maneras:
 *
 *   - **No repartió.** El pago de dos negocios quedó entero en uno (EXT-43545 en
 *     V0559/V0560; EXT-251163 en V0593/V0594, $3.786.759).
 *   - **Repartió en partes iguales cuando cada negocio debía distinto.** Ref 389928481:
 *     $1.326.725 a V0587 y a V0589, cuando debían $1.316.062 y $1.337.389. La financiera
 *     lo movió 4 veces en una hora hasta cuadrarlo.
 *
 * Las dos se evitan igual: el sistema llena cada monto con lo que ese negocio debe, el
 * reparto no se envía si no cuadra con el pago, y un pago que supera la deuda de su caso
 * avisa que puede cubrir otro.
 *
 * Puro: no toca DB, red ni reloj. Las acciones viven en `lib/actions/conciliacion-actions.ts`
 * y la escritura atómica en la función `guardar_reparto_comercial` (migración 20261019120000).
 */

import { valorARecaudar, type ModeloDinero } from '@/lib/upme/modelo-dinero'
import { cobradoConfirmado, type CobroParaSaldo } from '@/lib/cobros/saldo-negocio'
import { TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'
import {
  esPorcionPendienteDeConfirmar,
  type CobroParaRecaudo,
} from '@/lib/negocios/recaudo-confirmado'

/**
 * Redondeo tolerado entre lo repartido y el pago. Un peso, no el piso de materialidad
 * ($1.000): aquí no se está decidiendo si una deuda se persigue, se está diciendo a dónde
 * va cada peso de un pago que ya entró. Es la misma tolerancia que usa la base.
 */
const TOLERANCIA_CUADRE_COP = 1

// ── Lo que debe un negocio ───────────────────────────────────────────────────

/** Un cobro tal como hace falta para medir la deuda. */
export interface CobroParaDeuda extends CobroParaSaldo {
  external_ref?: string | null
  tipo_cobro?: string | null
}

/**
 * Lo que el negocio debe HOY: valor a recaudar (honorario + tarifa UPME confirmada) menos
 * lo recaudado. Es la cuenta de la tarjeta de Cobros del negocio y de `saldoCobrosCubierto`
 * (`lib/cobros/saldo-negocio.ts`), no una nueva.
 *
 * Por qué contra el valor a recaudar y no contra el honorario (que es lo que mide Cartera):
 * el cliente de SOENA paga honorario y tarifa en UN pago, y el reparto parte ESE pago.
 * Verificado contra las 4 correcciones de la financiera: honorario + tarifa confirmada de
 * V0587 ($614.250 + $701.812), V0589 ($614.250 + $723.139), V0593 ($682.500 + $816.895) y
 * V0594 ($682.500 + $1.604.863) dan exactamente lo que ella terminó asignando.
 *
 * `excluirRef`: al corregir un reparto, sus propias porciones no son plata que el negocio
 * ya tenga; si se contaran, el negocio parecería deber menos justo por el reparto que se
 * está corrigiendo.
 *
 * Nunca negativo: un negocio con plata a favor no debe nada, y el reparto no le resta.
 */
export function deudaParaReparto(input: {
  honorario: number
  modelo: ModeloDinero | null
  cobros: readonly CobroParaDeuda[]
  excluirRef?: string | null
}): number {
  const ref = (input.excluirRef ?? '').trim()
  const cobros = ref ? input.cobros.filter(c => (c.external_ref ?? '').trim() !== ref) : input.cobros
  const deuda = valorARecaudar(input.honorario, input.modelo) - cobradoConfirmado(cobros)
  return Math.max(0, Math.round(deuda))
}

// ── ¿Cuadra? ─────────────────────────────────────────────────────────────────

type EstadoCuadre = 'cuadra' | 'faltan' | 'sobran'

export interface Cuadre {
  total: number
  repartido: number
  /** `> 0` falta repartir; `< 0` se repartió de más. */
  diferencia: number
  estado: EstadoCuadre
  /** «Cuadra», «Faltan $X» o «Sobran $X». */
  texto: string
}

const fmt = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('es-CO')}`

export function cuadreDelReparto(total: number, montos: readonly number[]): Cuadre {
  const t = Number.isFinite(total) ? Math.round(total) : 0
  const repartido = montos.reduce((s, m) => s + (Number.isFinite(m) ? Math.round(m) : 0), 0)
  const diferencia = t - repartido
  if (Math.abs(diferencia) <= TOLERANCIA_CUADRE_COP) {
    return { total: t, repartido, diferencia, estado: 'cuadra', texto: 'Cuadra' }
  }
  return diferencia > 0
    ? { total: t, repartido, diferencia, estado: 'faltan', texto: `Faltan ${fmt(diferencia)}` }
    : { total: t, repartido, diferencia, estado: 'sobran', texto: `Sobran ${fmt(diferencia)}` }
}

/** Una fila del reparto en pantalla. */
export interface FilaReparto {
  negocio_id: string
  monto: number
  /** Lo que el negocio debe hoy. `null` = no se pudo medir (no se marca la fila). */
  debe: number | null
}

/** ¿La fila pone en el negocio más de lo que debe? Se marca, no se bloquea. */
export function filaSuperaDeuda(f: FilaReparto): boolean {
  if (f.debe == null) return false
  return f.monto - f.debe > TOLERANCIA_SALDO_COP
}

/**
 * Lo que impide enviar, en el idioma del comercial. Vacío = se puede enviar.
 *
 * Un reparto parcial NO se acepta: la diferencia es plata que no queda en ningún negocio,
 * y nadie la va a ir a buscar. Si alguna vez se acepta, es con una casilla explícita y
 * motivo (decisión con Mauricio, 2026-10-19), no por omisión.
 */
export function motivosParaNoEnviar(total: number, filas: readonly FilaReparto[]): string[] {
  const motivos: string[] = []
  if (!(total > 0)) motivos.push('Falta el total del pago')
  const conNegocio = filas.filter(f => f.negocio_id)
  if (conNegocio.length === 0) motivos.push('Elige al menos un negocio')
  if (conNegocio.some(f => !(f.monto > 0))) motivos.push('Cada negocio necesita un monto mayor a cero')
  const ids = conNegocio.map(f => f.negocio_id)
  if (new Set(ids).size !== ids.length) motivos.push('Un negocio está repetido')
  if (total > 0) {
    const c = cuadreDelReparto(total, conNegocio.map(f => f.monto))
    if (c.estado !== 'cuadra') motivos.push(`No cuadra con el pago: ${c.texto.toLowerCase()}`)
  }
  return motivos
}

// ── Aviso «no repartió» ──────────────────────────────────────────────────────

export interface CandidatoReparto {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  debe: number
}

export interface SugerenciaPorExceso {
  /** Lo que el pago trae de más sobre la deuda del caso. */
  excedente: number
  debeOrigen: number
  /** Otros negocios abiertos del mismo cliente que tienen saldo. */
  candidatos: CandidatoReparto[]
}

/**
 * ¿El pago supera lo que debe el caso y el mismo cliente tiene otro negocio con saldo?
 * Es la firma del «no repartió»: un pago de dos negocios cargado entero en uno.
 *
 * No bloquea: avisa. Un cliente puede pagar de más a propósito (sobrepago que luego se
 * devuelve), y eso lo resuelve la financiera.
 */
export function sugerenciaPorExceso(input: {
  monto: number
  debeOrigen: number | null
  candidatos: readonly CandidatoReparto[]
}): SugerenciaPorExceso | null {
  if (input.debeOrigen == null) return null
  const excedente = Math.round(input.monto - input.debeOrigen)
  if (excedente <= TOLERANCIA_SALDO_COP) return null
  const candidatos = input.candidatos.filter(c => c.debe > TOLERANCIA_SALDO_COP)
  if (candidatos.length === 0) return null
  return { excedente, debeOrigen: input.debeOrigen, candidatos }
}

/**
 * Filas iniciales del reparto: cada negocio con lo que debe hoy, sin acomodar nada. Si la
 * suma no da el pago, la barra lo dice («Faltan» / «Sobran») y el comercial decide: repartir
 * en silencio la diferencia es justo el error que esto viene a quitar.
 *
 * Única excepción: un solo negocio con total conocido es un pago simple, y su monto es el
 * pago (lo que debe solo se muestra).
 */
export function filasPrellenadas(
  total: number,
  negocios: ReadonlyArray<{ negocio_id: string; debe: number | null }>,
): FilaReparto[] {
  if (negocios.length === 1 && total > 0) {
    return [{ negocio_id: negocios[0].negocio_id, monto: Math.round(total), debe: negocios[0].debe }]
  }
  return negocios.map(n => ({ negocio_id: n.negocio_id, monto: n.debe ?? 0, debe: n.debe }))
}

// ── Estado del reparto: enviado / aprobado ───────────────────────────────────

export type EstadoReparto = 'enviado' | 'aprobado'

/**
 * Aprobado = la financiera ya validó alguna porción vigente de la referencia. Mismo
 * criterio que el motor de saldos (`esPorcionPendienteDeConfirmar`) y que la función de
 * la base: la marca `confirmado_at` de la porción, o el negocio conciliado.
 *
 * Basta UNA porción: la aprobación es de la referencia, y editar reemplaza todas las
 * porciones juntas, así que no se puede rehacer solo «la parte no aprobada».
 */
export function estadoDelReparto(
  porciones: ReadonlyArray<CobroParaRecaudo & { negocio_id: string | null }>,
  conciliadoPorNegocio: ReadonlyMap<string, boolean>,
): EstadoReparto {
  const aprobada = porciones.some(
    p => !esPorcionPendienteDeConfirmar(p, p.negocio_id ? conciliadoPorNegocio.get(p.negocio_id) ?? false : false),
  )
  return aprobada ? 'aprobado' : 'enviado'
}

// ── Lo que se le dice al comercial ───────────────────────────────────────────

export const MENSAJE_FALTA_MIGRACION =
  'Falta aplicar la migración del reparto (20261019120000). Avísale al equipo técnico; mientras tanto, el área financiera puede repartirlo desde Conciliación.'

/**
 * Traduce lo que rechaza `guardar_reparto_comercial` a lo que el comercial puede hacer de
 * verdad. Nunca le dice que elimine porciones: no tiene cómo.
 */
export function mensajeErrorReparto(crudo: string, referencia: string): string {
  const m = crudo ?? ''
  if (/guardar_reparto_comercial/.test(m) && /(does not exist|Could not find|PGRST202)/i.test(m)) {
    return MENSAJE_FALTA_MIGRACION
  }
  if (m.includes('REPARTO_APROBADO')) {
    return `El área financiera ya aprobó el reparto de la referencia ${referencia}: ya no se puede editar. Si hay un error, pídele que lo redistribuya desde Conciliación.`
  }
  if (m.includes('REPARTO_YA_ENVIADO')) {
    return `La referencia ${referencia} ya tiene un reparto enviado. Ábrelo con «Editar reparto» para corregirlo.`
  }
  if (m.includes('REPARTO_NO_EXISTE')) {
    return `La referencia ${referencia} ya no tiene un reparto por corregir: puede que el área financiera lo haya rechazado. Vuelve a repartirla.`
  }
  const enUso = m.match(/REPARTO_REF_EN_USO:([^\s"]+)/)
  if (enUso) {
    return `La referencia ${referencia} ya está registrada como pago en ${enUso[1]}. Para repartirla entre varios negocios, pídele al área financiera que la redistribuya desde Conciliación.`
  }
  const cerrado = m.match(/REPARTO_NEGOCIO_CERRADO:([^\s"]+)/)
  if (cerrado) return `El negocio ${cerrado[1]} no está abierto: no se le puede repartir un pago.`
  if (m.includes('REPARTO_NO_CUADRA')) return 'El reparto no cuadra con el total del pago.'
  if (m.includes('REPARTO_NEGOCIO_REPETIDO')) return 'Un negocio está repetido en el reparto.'
  if (m.includes('REPARTO_NEGOCIO_AJENO')) return 'Un negocio del reparto no es de este espacio de trabajo.'
  if (m.includes('REPARTO_MONTO_INVALIDO')) return 'Cada negocio necesita un monto mayor a cero.'
  if (m.includes('REPARTO_SIN_SESION')) return 'Tu sesión no tiene un espacio de trabajo activo.'
  return m || 'No se pudo guardar el reparto.'
}

/** Una porción tal como la devuelve la función de la base. */
export interface PorcionGuardada {
  negocio_id: string
  codigo: string | null
  monto: number | string
}

/** «V0587 $1.326.725, V0589 $1.326.726» — para el activity_log y el aviso a la financiera. */
export function describirPorciones(porciones: readonly PorcionGuardada[]): string {
  if (porciones.length === 0) return 'sin porciones'
  return porciones.map(p => `${p.codigo ?? 'negocio'} ${fmt(Number(p.monto))}`).join(', ')
}
