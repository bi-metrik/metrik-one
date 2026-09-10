/**
 * Invitar a expediente CCBF en lote, desde la base de sujetos.
 *
 * El cargue masivo mete a los terceros a la base; esto abre el expediente de
 * cada uno y le manda su enlace personal. Son dos pasos y no uno a propósito:
 * cargar un archivo es un movimiento interno que no sale de la plataforma,
 * mientras que invitar le escribe a doscientos terceros reales, con el nombre
 * de la empresa encima y sin reversa. Fundirlos en un botón haría que un Excel
 * mal armado se convirtiera en doscientos correos antes de que nadie lo mire.
 *
 * ── A quién NO se le escribe ──────────────────────────────────────────────
 *
 * Tres exclusiones, y ninguna es un detalle de implementación:
 *
 *   1. Quien ya tiene expediente. Valida deduplica y respondería `reenviado`,
 *      pero `reenviado` MANDA EL CORREO otra vez: volver a subir la lista del
 *      mes pasado le llegaría como acoso al proveedor que ya contestó. La
 *      reinvitación existe y es un acto de a uno.
 *   2. Quien tiene la relación cerrada. Pedirle su documentación a alguien que
 *      ya salió no es solo inútil: es tratamiento de datos sin finalidad.
 *   3. Quien no tiene correo. No es un error, es un dato que falta: se cuenta
 *      y se dice, para que se complete en la plantilla o en la ficha.
 *
 * ── Sobre el espejo ───────────────────────────────────────────────────────
 *
 * "Ya tiene expediente" se responde con `kyc_expediente_ref`, el espejo que
 * Valida actualiza por webhook. Si el webhook no está configurado el espejo
 * está vacío y NADIE aparece como ya invitado, así que el plan diría que hay
 * que escribirle a todo el mundo. Por eso `planearInvitacionMasiva` recibe
 * `espejoVivo` y la pantalla avisa en vez de dejar que el oficial confíe en una
 * exclusión que no está corriendo.
 *
 * Reglas puras: nada de esto toca la base ni llama a Valida.
 */

import { claveContraparte } from './liberaciones';
import { relacionCerradaAl } from './sujetos';
import type { RefExpediente } from './vinculacion-sujeto';

/** El sujeto, con lo poco que hace falta para decidir si se le escribe. */
export type SujetoInvitable = {
  id: string;
  tipo: string;
  documento_tipo: string;
  documento_numero: string;
  nombre: string;
  correo: string | null;
  relacion_hasta: string | null;
};

export type EstadoInvitacion =
  | 'invitable'
  | 'sin_correo'
  | 'ya_tiene_expediente'
  | 'relacion_cerrada';

export type ItemInvitacion = {
  sujeto_id: string;
  nombre: string;
  documento_tipo: string;
  documento_numero: string;
  tipo: string;
  correo: string | null;
  estado: EstadoInvitacion;
  detalle: string;
};

export type PlanInvitacion = {
  items: ItemInvitacion[];
  resumen: Record<EstadoInvitacion, number>;
  /** false = el espejo de expedientes no está llegando; la exclusión 1 no corre. */
  espejoVivo: boolean;
};

/** Techo de una tanda. Por encima se invita en varias. */
export const LIMITE_INVITACIONES_LOTE = 200;

const VACIO: Record<EstadoInvitacion, number> = {
  invitable: 0,
  sin_correo: 0,
  ya_tiene_expediente: 0,
  relacion_cerrada: 0,
};

/**
 * El orden de las exclusiones no es arbitrario.
 *
 * La relación cerrada va primero porque a quien ya salió no se le escribe ni
 * aunque le falte el expediente: decir "sin correo" de un desvinculado invita a
 * completarle el correo, que es exactamente lo que no hay que hacer.
 */
export function planearInvitacionMasiva(
  sujetos: readonly SujetoInvitable[],
  refs: readonly RefExpediente[],
  hoyISO: string,
  espejoVivo = true,
): PlanInvitacion {
  const conExpediente = new Set<string>();
  for (const ref of refs) {
    const clave = claveContraparte(ref.documento_tipo, ref.documento_numero);
    if (clave) conExpediente.add(clave);
  }

  const items: ItemInvitacion[] = [];
  const resumen = { ...VACIO };

  for (const s of sujetos) {
    const clave = claveContraparte(s.documento_tipo, s.documento_numero);
    const base = {
      sujeto_id: s.id,
      nombre: s.nombre,
      documento_tipo: s.documento_tipo,
      documento_numero: s.documento_numero,
      tipo: s.tipo,
      correo: s.correo,
    };

    let estado: EstadoInvitacion;
    let detalle: string;

    if (relacionCerradaAl(s.relacion_hasta, hoyISO)) {
      estado = 'relacion_cerrada';
      detalle = `Salió el ${s.relacion_hasta}. No se le pide documentación.`;
    } else if (clave && conExpediente.has(clave)) {
      estado = 'ya_tiene_expediente';
      detalle = 'Ya tiene expediente abierto. Reinvitar es de a uno, desde la bandeja.';
    } else if (!s.correo) {
      estado = 'sin_correo';
      detalle = 'Falta el correo. Complétalo en la plantilla o en la ficha.';
    } else {
      estado = 'invitable';
      detalle = `Se le abre el expediente y le llega el enlace a ${s.correo}.`;
    }

    items.push({ ...base, estado, detalle });
    resumen[estado] += 1;
  }

  return { items, resumen, espejoVivo };
}

/** Los que efectivamente reciben correo. Es lo que se manda a la acción. */
export function invitables(plan: PlanInvitacion): ItemInvitacion[] {
  return plan.items.filter((i) => i.estado === 'invitable');
}

/**
 * El tipo de sujeto de ONE contra el tipo de persona que espera Valida.
 *
 * `empleado` y `contratista` son personas naturales; `proveedor`, `cliente` y
 * `socio` pueden ser cualquiera de las dos. Para esos se decide por el tipo de
 * documento, que es el dato duro: un NIT es una empresa y una cédula no.
 */
export function tipoPersonaDe(
  tipo: string,
  documentoTipo: string,
): 'natural' | 'juridica' {
  if (tipo === 'empleado') return 'natural';
  return documentoTipo.trim().toUpperCase() === 'NIT' ? 'juridica' : 'natural';
}
