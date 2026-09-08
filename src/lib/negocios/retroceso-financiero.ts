/**
 * Retroceso financiero: a dónde vuelve un caso cuando la plata cambió.
 *
 * ── El problema que resuelve ────────────────────────────────────────────────
 *
 * Redistribuir una referencia des-concilia y reabre los gates que esa plata había
 * cerrado, pero NO mueve el caso. Un negocio puede quedar tres etapas adelante de donde
 * su plata lo sostiene, y nadie lo ve: la pantalla se ve igual que un caso sano.
 *
 * ── Los tres destinos ───────────────────────────────────────────────────────
 *
 * No todo cambio de plata merece el mismo retroceso, y eso es lo que decide esto:
 *
 * 1. **El reparto estaba mal contabilizado.** La plata siempre estuvo; se anotó en el
 *    negocio equivocado. El caso NO se mueve: reabrir sus gates ya alcanza.
 * 2. **Falta plata.** El negocio quedó con menos de lo que su etapa exige. Vuelve a
 *    **Precobro**, que es donde se le pide al cliente.
 * 3. **Las condiciones estaban mal pactadas.** El precio o el plan de pago no eran los
 *    que se acordaron. Vuelve a **Negociación**, que es donde se fijan.
 *
 * ── La marca financiera ─────────────────────────────────────────────────────
 *
 * Un retroceso originado por el área financiera se marca como tal y **queda fuera del
 * cómputo de calidad de operaciones**. Contarlo como reproceso de operaciones le imputa
 * a quien hizo bien su trabajo un error que ocurrió con la plata; eso es exactamente lo
 * que invierte un indicador (ver la lección de `reproceso_eventos`).
 *
 * Puro: no toca DB ni red. La regla canónica vive en
 * `cerebro/reglas/retroceso-financiero-tres-destinos.md`.
 */

import { TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'

/** Por qué cambió la plata. Lo elige el área financiera, no se deduce. */
export type CausaRetrocesoFinanciero =
  /** La plata siempre estuvo; estaba anotada en el negocio equivocado. */
  | 'reparto_mal_contabilizado'
  /** El negocio quedó con menos plata de la que su etapa exige. */
  | 'falta_plata'
  /** El precio o el plan de pago no eran los pactados. */
  | 'condiciones_mal_pactadas'

/** Qué gobierna cada etapa, para poder proponer destino sin nombres quemados. */
export interface EtapaCandidata {
  id: string
  nombre: string
  orden: number
  numero: number
  /** `venta` | `ejecucion` | `cobro` | `cerrado`. */
  stage: string
  /** Marcada en la línea como el punto donde se pide la plata. */
  esPrecobro?: boolean
  /** Marcada en la línea como el punto donde se fijan las condiciones. */
  esNegociacion?: boolean
}

export interface PropuestaRetroceso {
  /** null = no se mueve de etapa. */
  destinoEtapaId: string | null
  destinoNombre: string | null
  /** Frase para la persona, no para el registro. */
  explicacion: string
  /** Siempre true acá: el origen es el área financiera. Va al evento, no al de calidad. */
  marcaFinanciera: true
  /**
   * Otras etapas a las que se puede volver. La financiera puede elegir cualquiera de
   * las ya recorridas: el destino sugerido es una propuesta, no un carril.
   */
  alternativas: EtapaCandidata[]
}

const MOTIVO_MIN = 10

/**
 * Propone a dónde vuelve el caso. NO lo mueve.
 *
 * `etapasRecorridas` son las que el caso efectivamente pasó, no las anteriores por
 * `orden`: el orden no ordena el recorrido cuando hay routing con saltos, y proponer una
 * etapa que el caso nunca recorrió lo manda a hacer trabajo que no le toca.
 */
export function proponerRetrocesoFinanciero(input: {
  causa: CausaRetrocesoFinanciero
  etapaActual: EtapaCandidata
  etapasRecorridas: EtapaCandidata[]
}): PropuestaRetroceso {
  const { causa, etapaActual, etapasRecorridas } = input

  // Solo se puede volver a donde el caso ya estuvo, y nunca a donde ya está.
  const alternativas = etapasRecorridas
    .filter(e => e.id !== etapaActual.id && e.orden < etapaActual.orden)
    .sort((a, b) => b.orden - a.orden)

  if (causa === 'reparto_mal_contabilizado') {
    return {
      destinoEtapaId: null,
      destinoNombre: null,
      explicacion:
        'La plata siempre estuvo; solo estaba anotada en el negocio equivocado. ' +
        'El caso se queda donde está y se reabren los gates que esa plata había cerrado.',
      marcaFinanciera: true,
      alternativas,
    }
  }

  const marca = causa === 'falta_plata' ? 'esPrecobro' : 'esNegociacion'
  const destino = alternativas.find(e => e[marca])

  if (!destino) {
    // Sin la etapa marcada en la línea, esto NO adivina: propone la anterior recorrida y
    // lo dice. Elegir una por su nombre sería quemar la topología de un cliente.
    const previa = alternativas[0] ?? null
    return {
      destinoEtapaId: previa?.id ?? null,
      destinoNombre: previa?.nombre ?? null,
      explicacion: previa
        ? `Esta línea no declara cuál es su etapa de ${causa === 'falta_plata' ? 'precobro' : 'negociación'}. ` +
          `Se propone volver a ${previa.nombre}; revísalo antes de aplicar.`
        : 'El caso no ha recorrido ninguna etapa anterior a la que está.',
      marcaFinanciera: true,
      alternativas,
    }
  }

  return {
    destinoEtapaId: destino.id,
    destinoNombre: destino.nombre,
    explicacion:
      causa === 'falta_plata'
        ? `Al negocio le falta plata para sostener ${etapaActual.nombre}. Vuelve a ${destino.nombre}, ` +
          'que es donde se le pide al cliente.'
        : `Las condiciones de pago no eran las pactadas. Vuelve a ${destino.nombre}, ` +
          'que es donde se fijan.',
    marcaFinanciera: true,
    alternativas,
  }
}

/**
 * ¿Se puede aplicar este retroceso?
 *
 * El motivo escrito no es burocracia: es lo único que después explica por qué un caso
 * retrocedió, y si el equipo rechaza siempre la misma propuesta, sin el motivo eso no se
 * ve (misma razón por la que la reversa de ruta lo exige en sus dos salidas).
 */
export function validarRetroceso(input: {
  destinoEtapaId: string | null
  motivo: string
  etapasRecorridas: EtapaCandidata[]
  etapaActual: EtapaCandidata
}): { ok: boolean; errores: string[] } {
  const errores: string[] = []
  const motivo = (input.motivo ?? '').trim()

  if (motivo.length < MOTIVO_MIN) {
    errores.push(`Escribe por qué retrocede el caso (mínimo ${MOTIVO_MIN} caracteres).`)
  }

  if (input.destinoEtapaId) {
    if (input.destinoEtapaId === input.etapaActual.id) {
      errores.push('El caso ya está en esa etapa.')
    } else {
      const destino = input.etapasRecorridas.find(e => e.id === input.destinoEtapaId)
      if (!destino) {
        errores.push('El caso nunca pasó por esa etapa: devolverlo ahí lo pondría a hacer trabajo que no le toca.')
      } else if (destino.orden >= input.etapaActual.orden) {
        errores.push('Eso no es un retroceso: la etapa destino va después de la actual.')
      }
    }
  }

  return { ok: errores.length === 0, errores }
}

/**
 * El aviso que queda pegado al negocio hasta que alguien lo resuelve.
 *
 * Lo ven la financiera **y** el comercial, y **reaparece cuando el comercial intenta
 * avanzar**: un aviso que solo se muestra una vez lo cierra quien pasaba por ahí, y el
 * caso sigue adelante con plata que ya no tiene.
 */
export interface AvisoRecaudoCambiado {
  tipo: 'recaudo_cambiado'
  referencia: string
  motivo: string
  /** Etapa en la que estaba el caso cuando cambió la plata. */
  etapaAlCambiar: string
  gatesReabiertos: number
  /** Propuesta de destino, si la hubo. */
  destinoSugerido: string | null
  creadoEn: string
  creadoPor: string | null
}

/**
 * ¿Este reparto le dejó al negocio algo que una PERSONA deba decidir?
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * El aviso se ponía SIEMPRE que se redistribuía una referencia, incluso cuando el
 * reparto quedaba cuadrado. Como es un gate que no cede al override, y hasta el
 * 2026-09-08 ninguna pantalla podía resolverlo, cualquier negocio con el reparto
 * corregido quedaba congelado de forma permanente. Caso real: V0442 y V0443
 * (ref EXT-593279), repartidos correctamente y atascados en Negociación.
 *
 * ── Las tres preguntas, en orden ────────────────────────────────────────────
 *
 * 1. **¿Se cayó algún gate que esta plata sostenía?** Si el recálculo reabrió gates,
 *    el caso ya está adelante de donde su plata lo sostiene: eso lo mira una persona.
 *
 * 2. **¿El reparto le quitó algo al negocio?** Si quedó igual o con MÁS plata que
 *    antes, no puede haberse quedado corto: antes del reparto nadie tenía nada que
 *    decidir sobre él, y ahora tiene al menos lo mismo. Sin aviso.
 *
 * 3. **Perdió plata: ¿le sigue alcanzando?** Solo se da por cuadrado si con lo que
 *    quedó cubre TODO lo que el cliente le debe a ese negocio (honorario + tarifa
 *    pasante). Es a propósito el listón más alto y no uno por etapa: un negocio que
 *    tiene la cuenta completa no puede estar corto en NINGUNA etapa, así que la
 *    respuesta no depende de dónde esté ni de por dónde vaya su routing. Es el caso
 *    de V0442: perdió la mitad de la referencia y aun así cubre su cuenta entera
 *    (honorario $637.500 + UPME $701.812 < $1.356.500).
 *
 * Si perdió plata y no se puede medir cuánto debe (`loQueDebePagar === null`: negocio
 * sin cotizar), el aviso SE QUEDA. No medir no es lo mismo que estar cuadrado.
 *
 * Puro: no toca DB ni red.
 */
export function avisoRecaudoNecesario(input: {
  /** Gates que el recálculo reabrió en ESTE negocio (no en el conjunto del reparto). */
  gatesReabiertos: number
  /** Lo que el reparto le sumó (positivo) o le quitó (negativo) a ESTE negocio. */
  deltaRecaudo: number
  /** Recaudo confirmado del negocio DESPUÉS del reparto (todas sus referencias). */
  recaudoConfirmado: number
  /**
   * Todo lo que el cliente le debe al negocio: honorario + tarifa pasante
   * (`valorARecaudar`). `null` cuando no hay con qué medirlo (sin precio y sin
   * propuesta aprobada en cero).
   */
  loQueDebePagar: number | null
  /** Materialidad de saldo. Por defecto, la del sistema. */
  toleranciaCop?: number
}): boolean {
  if (input.gatesReabiertos > 0) return true
  if (input.deltaRecaudo >= 0) return false
  if (input.loQueDebePagar === null) return true

  const tolerancia = input.toleranciaCop ?? TOLERANCIA_SALDO_COP
  return input.recaudoConfirmado < input.loQueDebePagar - tolerancia
}

export function construirAviso(input: {
  referencia: string
  motivo: string
  etapaAlCambiar: string
  gatesReabiertos: number
  destinoSugerido: string | null
  ahora: string
  staffId: string | null
}): AvisoRecaudoCambiado {
  return {
    tipo: 'recaudo_cambiado',
    referencia: input.referencia,
    motivo: input.motivo.trim(),
    etapaAlCambiar: input.etapaAlCambiar,
    gatesReabiertos: input.gatesReabiertos,
    destinoSugerido: input.destinoSugerido,
    creadoEn: input.ahora,
    creadoPor: input.staffId,
  }
}
