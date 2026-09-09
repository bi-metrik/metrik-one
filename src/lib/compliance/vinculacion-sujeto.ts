/**
 * El puente entre la ficha del sujeto y su expediente de vinculación.
 *
 * Qué resuelve: en auditoría la pregunta no es "muéstrame los expedientes" ni
 * "muéstrame los proveedores", es "este proveedor, ¿está vinculado?". Hasta
 * ahora había que responderla en dos pantallas distintas — la base de sujetos y
 * la bandeja de vinculación — y confiando en que quien mira reconozca el mismo
 * nombre escrito de dos maneras.
 *
 * ── Se cruza por documento, no por nombre y no por id ─────────────────────
 *
 * El expediente vive en Valida y llega a ONE como espejo (`kyc_expediente_ref`)
 * por webhook firmado. No trae, ni puede traer, el id del sujeto en ONE: casi
 * siempre nace ANTES que la ficha (el oficial invita a una contraparte que
 * todavía no está en la base) y a veces después. Cruzar por
 * `claveContraparte` funciona en los dos órdenes y no deja nada que rellenar
 * después. Es la misma llave con la que ya se encuentran las liberaciones y las
 * consultas a listas.
 *
 * ── Por qué el espejo NO es la fuente ─────────────────────────────────────
 *
 * Lo que se muestra acá es un rótulo para orientar: "tiene expediente, va así".
 * El expediente en sí se abre en la bandeja, que lo lee de Valida en vivo. El
 * espejo puede ir atrás — si el webhook no está configurado va infinitamente
 * atrás — y por eso `VinculacionDeSujeto` expone `actualizado_en`: un rótulo
 * viejo con su fecha a la vista es honesto, un rótulo viejo sin fecha miente.
 *
 * Vive fuera de los archivos `'use server'` porque esos solo pueden exportar
 * funciones async, y porque esta regla tiene que poder probarse sin base.
 */

import { claveContraparte } from './liberaciones';
import {
  ESTADO_EXPEDIENTE_ACCION,
  ESTADO_EXPEDIENTE_LABEL,
  ESTADOS_EXPEDIENTE,
  type EstadoExpediente,
} from './vinculacion';

/** Una fila del espejo, tal como la deja el webhook. */
export type RefExpediente = {
  expediente_kyc_id: string;
  razon_social: string | null;
  nombre: string | null;
  documento_tipo: string | null;
  documento_numero: string | null;
  estado_cache: string;
  etapa_cache: string | null;
  actualizado_en: string;
};

export type VinculacionDeSujeto = {
  expediente_kyc_id: string;
  estado: EstadoExpediente | null;
  /** Etiqueta lista para pintar. `null` en estado_cache desconocido. */
  etiqueta: string;
  /** Qué le toca hacer al oficial con ese expediente. */
  accion: string;
  actualizado_en: string;
  /**
   * Cuántos expedientes tiene esta contraparte en total. Más de uno es normal
   * (se rechazó y se volvió a invitar) y la ficha lo dice en vez de esconderlo:
   * si mostrara solo el último sin avisar, un rechazo anterior desaparecería de
   * la vista de quien decide contratar.
   */
  total: number;
};

function esEstadoExpediente(v: string): v is EstadoExpediente {
  return (ESTADOS_EXPEDIENTE as readonly string[]).includes(v);
}

/**
 * Cuál de los expedientes de una contraparte manda: el más reciente.
 *
 * No se privilegia el aprobado. Un proveedor aprobado en marzo y rechazado en
 * agosto está rechazado, y ordenar por "el bueno primero" mostraría lo
 * contrario justo en el caso en que más caro sale equivocarse.
 *
 * El desempate por id no es cosmético: sin él, dos filas con el mismo
 * `actualizado_en` harían que la ficha cambiara de rótulo entre dos cargas sin
 * que nada hubiera pasado.
 */
function mandaEste(a: RefExpediente, b: RefExpediente): RefExpediente {
  if (a.actualizado_en !== b.actualizado_en) {
    return a.actualizado_en > b.actualizado_en ? a : b;
  }
  return a.expediente_kyc_id > b.expediente_kyc_id ? a : b;
}

export function resumirVinculacion(
  ref: RefExpediente,
  total: number,
): VinculacionDeSujeto {
  const estado = esEstadoExpediente(ref.estado_cache) ? ref.estado_cache : null;
  return {
    expediente_kyc_id: ref.expediente_kyc_id,
    estado,
    // Un estado que ONE no conoce se muestra crudo en vez de desaparecer: si
    // Valida agrega uno, la ficha lo dice y no finge que no hay expediente.
    etiqueta: estado ? ESTADO_EXPEDIENTE_LABEL[estado] : ref.estado_cache,
    accion: estado
      ? ESTADO_EXPEDIENTE_ACCION[estado]
      : 'Ábrelo en la bandeja para ver cómo va.',
    actualizado_en: ref.actualizado_en,
    total,
  };
}

/**
 * Indexa el espejo por `claveContraparte` para pegarlo a la base de sujetos.
 *
 * Las filas sin documento se descartan a propósito: un expediente que no se
 * puede pegar a nadie no debe pegarse a alguien por parecido de nombre.
 */
export function indexarVinculaciones(
  refs: readonly RefExpediente[],
): Map<string, VinculacionDeSujeto> {
  const porClave = new Map<string, { manda: RefExpediente; total: number }>();
  for (const ref of refs) {
    const clave = claveContraparte(ref.documento_tipo, ref.documento_numero);
    if (!clave) continue;
    const acc = porClave.get(clave);
    if (acc) {
      acc.manda = mandaEste(acc.manda, ref);
      acc.total += 1;
    } else {
      porClave.set(clave, { manda: ref, total: 1 });
    }
  }

  const out = new Map<string, VinculacionDeSujeto>();
  for (const [clave, { manda, total }] of porClave) {
    out.set(clave, resumirVinculacion(manda, total));
  }
  return out;
}
