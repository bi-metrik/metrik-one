// ============================================================
// Bandeja — el link de autorización de datos del cliente (`link_autorizacion`), lo puro
// ------------------------------------------------------------
// La comercial le pide al bot el link de un cliente; el bot contesta con DOS mensajes que escribe el código: la
// instrucción para ella y, aparte, el mensaje para el cliente con el link, para que lo reenvíe tal cual. El bot nunca le
// escribe al cliente. Si el cliente ya autorizó, lo dice con la fecha en vez de mandar link.
//
// Los textos por defecto son los de la pieza 3b de Emilio y son COPIA de `src/lib/autorizacion-datos/texto.ts`
// (`MENSAJES_POR_DEFECTO`): una prueba compara las dos. La versión publicada del workspace los puede reemplazar.
// ============================================================

import type { Salida } from '../tipos.ts';

export const MENSAJE_WHATSAPP_POR_DEFECTO = [
  'Hola [NOMBRE_CLIENTE], soy [NOMBRE_COMERCIAL] de [AGENCIA].',
  'Para preparar su cotización necesitamos que autorice el uso de sus datos en este enlace (1 minuto): [LINK]',
  'Cualquier duda me escribe por aquí.',
].join('\n');

export const INSTRUCCION_POR_DEFECTO =
  'Mándale esto a [NOMBRE_CLIENTE] en tu primera respuesta, antes de pedirle más datos. Mientras no autorice, el viaje no pasa a Cotización.';

/** Lo que el puerto sabe de la autorización del cliente. */
export type AutorizacionAgente =
  | { estado: 'autorizado'; fecha: string; menores: boolean }
  | { estado: 'sin_texto' }
  | { estado: 'pendiente'; url: string; agencia: string; whatsapp: string | null; instruccion: string | null };

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** «3 oct» (con el año si no es el de hoy), en hora de Bogotá. Pura. */
export function fechaCorta(iso: string, hoyIso: string): string {
  const b = new Date(Date.parse(iso) - 5 * 3600 * 1000);
  const hoy = new Date(Date.parse(hoyIso) - 5 * 3600 * 1000);
  const base = `${b.getUTCDate()} ${MESES[b.getUTCMonth()]}`;
  return b.getUTCFullYear() === hoy.getUTCFullYear() ? base : `${base} ${b.getUTCFullYear()}`;
}

const primerNombre = (s: string) => s.trim().split(/\s+/)[0] ?? s;

function llenar(t: string, m: Record<string, string>): string {
  let s = t;
  for (const [k, v] of Object.entries(m)) s = s.split(`[${k}]`).join(v);
  return s;
}

/**
 * Las salidas de `link_autorizacion`. Pura.
 *  · ya autorizó → un mensaje: «Mauricio Moreno ya autorizó el 3 oct.»
 *  · sin texto publicado → un mensaje: el link todavía no se puede firmar.
 *  · pendiente → dos mensajes: la instrucción para la comercial y, solo, el mensaje para el cliente.
 */
export function salidasLinkAutorizacion(p: { cliente: string; comercial: string; a: AutorizacionAgente; ahoraIso: string }): Salida[] {
  if (p.a.estado === 'autorizado') {
    const menores = p.a.menores ? '' : ' No marcó la casilla de menores: si el viaje lleva menores, cópiale el link desde el viaje en ONE.';
    return [{ tipo: 'texto', texto: `${p.cliente} ya autorizó el ${fechaCorta(p.a.fecha, p.ahoraIso)}.${menores}` }];
  }
  if (p.a.estado === 'sin_texto') {
    return [{ tipo: 'texto', texto: 'Todavía no está publicado el texto de la autorización de datos: el link no se puede firmar aún. Avísale a quien administra ONE.' }];
  }
  const m = { NOMBRE_CLIENTE: p.cliente, NOMBRE_COMERCIAL: primerNombre(p.comercial), AGENCIA: p.a.agencia, LINK: p.a.url };
  const instruccion = llenar(p.a.instruccion ?? INSTRUCCION_POR_DEFECTO, m);
  const mensaje = llenar(p.a.whatsapp ?? MENSAJE_WHATSAPP_POR_DEFECTO, m);
  return [
    { tipo: 'texto', texto: `${instruccion}\nEl mensaje va abajo, solo, para que lo reenvíes tal cual.` },
    { tipo: 'texto', texto: mensaje },
  ];
}
