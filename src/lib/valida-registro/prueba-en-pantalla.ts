import type { SaldoBolsa } from '@/lib/valida/corte-bolsa'
import { COBRO_TRAS_PRUEBA } from './condiciones-cobro'
import { fechaYHoraBogota } from './cobro-prueba'

/**
 * Lo que la franja de la prueba de `/valida` y la Suscripción en prueba de `/suscripcion` muestran de la
 * prueba gratis del registro autogestionado. Puro.
 *
 * ## Una sola fecha
 *
 * La prueba tiene dos fechas guardadas y en producción son la MISMA:
 *   - el fin de la bolsa de prueba en Valida (`vence_en`, la que trae `GET /cuenta/consumo` y la que
 *     quedó en `config_extra.valida_prueba`);
 *   - el cobro del primer mes (`valida_registros.cobro_programado_at`), que `momentoDelCobro` copia de
 *     ese `vence_en` al abrir la prueba.
 * Dos excepciones las separan: un preview con `VALIDA_COBRO_PRUEBA_MINUTOS` (el cobro N minutos después,
 * la bolsa a los 7 días) y un aviso de 48 h que salió tarde (el cobro se corre: `cobroDesdeMs`). Con
 * cobro programado la pantalla muestra la fecha del COBRO en los dos sitios: es la que promete la
 * cláusula y la única que tiene consecuencia de plata.
 */

export interface PruebaEnPantalla {
  /** El instante en que termina la prueba (y se cobra, con tarjeta). */
  finIso: string | null
  /** «23 de octubre». */
  finTexto: string | null
  cobro: {
    estado: 'programado' | 'cancelado'
    /** «viernes, 23 de octubre de 2026, 11:30 a. m.» */
    fechaYHora: string
    /** «23 de oct, 11:30 a. m.» */
    fechaCorta: string
    precio: number
    boton: string
    /** Solo la persona dueña, nunca «Ver como», y mientras no haya empezado el cobro. */
    puedeCancelar: boolean
  } | null
}

const DIA_MES = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', timeZone: 'America/Bogota' })
const CORTA = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Bogota',
})

export function fechaCortaBogota(iso: string): string {
  // «23 de oct., 11:30 a. m.» → «23 de oct, 11:30 a. m.» (el punto del mes antes de la coma sobra).
  return CORTA.format(new Date(iso)).replace(/(\p{L})\.,/u, '$1,')
}

export interface CobroDeLaPrueba {
  estado: string
  cobroDesde: string
  puedeCancelar: boolean
}

/**
 * null = no hay prueba que mostrar: ni la bolsa es de prueba ni hay un cobro de la prueba en curso (el
 * plan ya está pagado, o el cobro ya se hizo / se está haciendo y lo dice la suscripción).
 */
export function pruebaEnPantalla(p: {
  saldo: SaldoBolsa | null
  cobro: CobroDeLaPrueba | null
  /** `config_extra.valida_prueba.vence_en`, para cuando Valida no respondió el saldo. */
  venceConfig: string | null
  /** La persona dueña, sin «Ver como». */
  puedeCancelar: boolean
}): PruebaEnPantalla | null {
  const cobroVivo = p.cobro && (p.cobro.estado === 'programado' || p.cobro.estado === 'cancelado') ? p.cobro : null
  // Un cobro que ya empezó (cobrando, cobrado, revisar, rechazado) cierra la prueba en pantalla, aunque
  // la bolsa de prueba siga leyéndose un rato.
  if (p.cobro && !cobroVivo) return null
  if (!cobroVivo && !p.saldo?.esPrueba) return null
  const finIso = cobroVivo?.cobroDesde ?? p.saldo?.venceEn ?? p.venceConfig ?? null
  return {
    finIso,
    finTexto: finIso ? DIA_MES.format(new Date(finIso)) : null,
    cobro: cobroVivo
      ? {
          estado: cobroVivo.estado as 'programado' | 'cancelado',
          fechaYHora: fechaYHoraBogota(cobroVivo.cobroDesde),
          fechaCorta: fechaCortaBogota(cobroVivo.cobroDesde),
          precio: COBRO_TRAS_PRUEBA.precio,
          boton: COBRO_TRAS_PRUEBA.botonCancelar,
          puedeCancelar: cobroVivo.puedeCancelar && p.puedeCancelar,
        }
      : null,
  }
}
