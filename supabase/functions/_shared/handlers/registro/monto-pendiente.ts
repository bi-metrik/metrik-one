// Que hace el bot con los mensajes del flujo guiado de un gasto (W01), cuando el primer
// mensaje no traia monto ("Registrar gasto", "Registrar gasto de peaje") y cuando el
// usuario escribe texto libre sobre la confirmacion con botones.
//
// POR QUE EXISTE (Termotech, 2026-09-23): "Registrar gasto" es el boton del menu de
// ayuda y la entrada mas usada del bot. Dos fugas perdian el detalle del gasto:
//   1. Sin monto, `handleGasto` pedia el monto y NO guardaba sesion: la respuesta
//      ("18900") se parseaba desde cero y el "peaje" del primer mensaje se perdia.
//   2. En la confirmacion, cualquier texto que no fuera si/no se rechazaba con
//      "Presiona un botón...": quien escribia "Peaje" ahi, lo perdia.
//
// Decision de producto (Mauricio, 2026-09-23, ver `wa-gasto-descripcion.ts`): la
// descripcion sale de INTERPRETAR lo que el usuario escribe, sin preguntas nuevas. Por
// eso aqui no hay un paso "¿en qué fue?": se recuerda lo que ya dijo y se toma lo que
// escriba de mas.
//
// Modulo PURO (sin Deno, red ni base) para que vitest pruebe cada decision.

import type { ParsedFields } from '../../types.ts';
import { parseAmount, regexParse } from '../../wa-parse-reglas.ts';
import { extraerDescripcionGasto } from '../../wa-gasto-descripcion.ts';
import { clasificarRespuesta, normalizarRespuesta } from '../../wa-intencion.ts';
import { MSG_PEDIR_MONTO } from './mensajes-gasto.ts';

/** Repreguntas por el monto antes de soltar la conversacion (al tercer mensaje sin monto). */
export const MAX_REINTENTOS_MONTO = 2;

export const MSG_MONTO = {
  repregunta: `No encontré el monto. ${MSG_PEDIR_MONTO}\nSi prefieres no registrarlo, escribe *cancelar*.`,
  cancelado: '❌ Cancelado.',
  rendicion: 'Dejé el gasto sin registrar. Cuando quieras, escríbeme el monto y en qué fue.',
  otraOrden: 'Dejé el gasto sin registrar. Escríbeme de nuevo lo que necesitas.',
} as const;

/** Monto de la respuesta: las reglas del parser, y ademas un numero suelto corto ("500"). */
export function montoDeRespuesta(texto: string): number | undefined {
  const t = texto.trim();
  const delParser = parseAmount(t);
  if (delParser && delParser > 0) return delParser;
  // `parseAmount` exige 4 cifras para un numero sin puntos (asi no confunde "3 tubos"
  // con un monto). Si la respuesta es SOLO un numero, es el monto aunque sea corto.
  const solo = t.match(/^\$?\s*(\d+)(?:[.,](\d{1,2}))?\s*(?:pesos|cop)?$/iu);
  if (solo) {
    const n = parseFloat(solo[2] ? `${solo[1]}.${solo[2]}` : solo[1]);
    if (n > 0) return n;
  }
  return undefined;
}

function sinTildes(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Une el detalle del primer mensaje con el de la respuesta sin repetirlo:
 * "peaje" + "peaje" = "peaje"; "peaje" + "autopista norte" = "peaje autopista norte".
 */
export function unirDescripciones(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  const na = sinTildes(a);
  const nb = sinTildes(b);
  if (na.includes(nb)) return a;
  if (nb.includes(na)) return b;
  return `${a} ${b}`;
}

/** "Registrar gasto de peaje / 18900": los dos mensajes, en orden, como se escribieron. */
export function unirMensajes(previo: string | undefined, nuevo: string): string {
  const n = nuevo.trim();
  const p = previo?.trim();
  return p ? `${p} / ${n}` : n;
}

export type DecisionMonto =
  /** Hay monto: seguir el flujo de `handleGasto` con estos campos. */
  | { accion: 'continuar'; fields: ParsedFields }
  /**
   * Seguir esperando el monto. `reintentos` es el contador a persistir y `fields` los
   * campos del gasto con el detalle que haya traido este mensaje ("peaje" sin monto).
   */
  | { accion: 'repreguntar'; mensaje: string; reintentos: number; fields: ParsedFields }
  /** Cerrar la sesion diciendo esto. */
  | { accion: 'cerrar'; mensaje: string };

/**
 * La respuesta a "¿Cuánto fue y en qué?".
 *
 * - Con monto: se combina con lo que traia el primer mensaje (detalle, codigo del
 *   negocio, categoria) y se sigue. "18900 peaje" aporta monto Y detalle.
 * - "cancelar" / "no": cancela.
 * - Otra orden reconocible sin monto ("mis números", "cartera", "hola"): se suelta el
 *   gasto y se le pide repetir. No se ejecuta la orden aqui porque el enrutador vive en
 *   el webhook (con Gemini) y este flujo no lo puede invocar; soltar es lo que evita
 *   que la orden quede atrapada repreguntando un monto.
 * - Cualquier otra cosa sin monto: se repregunta, con tope. No entender NUNCA expulsa
 *   a la primera.
 */
export function decidirMontoPendiente(
  texto: string,
  previos: ParsedFields,
  reintentosPrevios: number,
): DecisionMonto {
  const monto = montoDeRespuesta(texto);

  if (!monto) {
    const intencion = clasificarRespuesta(texto);
    // "no" solo cancela como respuesta corta: "no recuerdo bien cuánto fue" no es cancelar.
    const corta = normalizarRespuesta(texto).split(' ').filter(Boolean).length <= 2;
    if (intencion === 'cancelar' || (intencion === 'no' && corta)) {
      return { accion: 'cerrar', mensaje: MSG_MONTO.cancelado };
    }
    const orden = regexParse(texto).intent;
    if (orden !== 'GASTO' && orden !== 'UNCLEAR') {
      return { accion: 'cerrar', mensaje: MSG_MONTO.otraOrden };
    }
    const reintentos = Number.isFinite(reintentosPrevios) && reintentosPrevios > 0
      ? Math.floor(reintentosPrevios)
      : 0;
    if (reintentos >= MAX_REINTENTOS_MONTO) return { accion: 'cerrar', mensaje: MSG_MONTO.rendicion };
    // Un mensaje sin monto puede traer el detalle ("peaje"): se guarda para cuando llegue
    // el monto. Solo si no es una respuesta corta ("ok", "ya", "listo"), que no describe nada.
    const fields: ParsedFields = { ...previos };
    if (intencion === 'desconocido' && texto.trim()) {
      const descripcion = unirDescripciones(previos.descripcion, extraerDescripcionGasto(texto));
      if (descripcion) fields.descripcion = descripcion;
      fields.mensaje_original = unirMensajes(previos.mensaje_original, texto);
    }
    return { accion: 'repreguntar', mensaje: MSG_MONTO.repregunta, reintentos: reintentos + 1, fields };
  }

  const detalle = extraerDescripcionGasto(texto, monto);
  const fields: ParsedFields = { ...previos, amount: monto };
  const descripcion = unirDescripciones(previos.descripcion, detalle);
  if (descripcion) fields.descripcion = descripcion;
  // Un codigo de negocio en la respuesta ("18900 peaje B1 26 2") cuenta si el primer
  // mensaje no traia uno. Solo el codigo: el `entity_hint` del respaldo por regex toma
  // cualquier palabra en mayuscula tras "de" y adivinaria negocios.
  if (!previos.project_code) {
    const codigo = regexParse(texto).fields.project_code;
    if (codigo) fields.project_code = codigo;
  }
  fields.mensaje_original = unirMensajes(previos.mensaje_original, texto);
  return { accion: 'continuar', fields };
}

// Respuestas cortas que confirman o cancelan en la confirmacion con botones. Es la lista
// de siempre; el resto de marcas de `clasificarRespuesta` solo cuenta en mensajes de una
// o dos palabras, porque una descripcion ("va para la obra", "ya pagado peaje") puede
// traer esas marcas sin ser una respuesta.
const CONFIRMA = ['sí', 'si', 'yes', '1', '✅', 'confirmo', 'dale'];
const CANCELA = ['no', 'cancelar', 'cancel', '❌', 'nel'];

export type DecisionConfirmacion =
  | { accion: 'confirmar' }
  | { accion: 'cancelar' }
  /** Texto libre: es la descripcion del gasto (el usuario la da o la corrige). */
  | { accion: 'describir'; fields: ParsedFields }
  /** Ni respuesta ni descripcion: repetir los botones. */
  | { accion: 'botones' };

/**
 * Lo que se escribe sobre la confirmacion de un gasto (W01, estado `confirming`).
 * Un texto que no es confirmar/cancelar es la descripcion: si ya habia una, la
 * REEMPLAZA (el usuario la esta corrigiendo). Un monto escrito aqui no se toma como
 * descripcion: cambiar el monto no se hace desde la confirmacion.
 */
export function decidirConfirmacionGasto(
  entrada: { texto: string; botonId?: string },
  fields: ParsedFields,
  monto: number | undefined,
): DecisionConfirmacion {
  if (entrada.botonId === 'btn_confirm') return { accion: 'confirmar' };
  if (entrada.botonId === 'btn_cancel') return { accion: 'cancelar' };

  const crudo = entrada.texto.trim();
  const texto = crudo.toLowerCase();
  if (CONFIRMA.includes(texto)) return { accion: 'confirmar' };
  if (CANCELA.includes(texto)) return { accion: 'cancelar' };

  const palabras = normalizarRespuesta(crudo).split(' ').filter(Boolean).length;
  if (palabras <= 2) {
    const intencion = clasificarRespuesta(crudo);
    if (intencion === 'si') return { accion: 'confirmar' };
    if (intencion === 'no' || intencion === 'cancelar') return { accion: 'cancelar' };
    if (intencion === 'despues') return { accion: 'botones' };
  }

  // Un numero con forma de monto que NO es el ya registrado: el usuario quiere cambiar
  // el monto, no describir el gasto.
  const montoEscrito = montoDeRespuesta(crudo);
  if (montoEscrito && montoEscrito !== monto) return { accion: 'botones' };

  const descripcion = extraerDescripcionGasto(crudo, monto);
  if (!descripcion) return { accion: 'botones' };
  // El concepto y la categoria sugerida salieron de la descripcion ANTERIOR: se quitan
  // para que no manden sobre la nueva ("peaje" -> "almuerzo del equipo" no es transporte).
  const { concept: _concepto, category_hint: _categoria, ...resto } = fields;
  return {
    accion: 'describir',
    fields: {
      ...resto,
      descripcion,
      mensaje_original: unirMensajes(fields.mensaje_original, crudo),
    },
  };
}
