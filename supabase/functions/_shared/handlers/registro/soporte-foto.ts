// Contrato del estado `awaiting_image`: que hace el bot con cada mensaje que llega
// mientras espera la foto del soporte de un gasto.
//
// POR QUE ES UN MODULO PURO: el defecto que esto cierra no era de copy, era de ROUTING.
// El bloque de `resume.ts` reconocia imagen, audio y "después"; cualquier otra cosa caia
// por todas las ramas y llegaba a `completeSession` — la conversacion se cerraba en
// silencio y el gasto quedaba con `soporte_pendiente: true` para siempre. Un defecto asi
// solo se prueba ejercitando la DECISION, y el handler no se puede colectar desde vitest
// (arrastra `wa-parse.ts`, que lee `Deno.env` al importarse). Asi que la decision vive
// aqui, sin red ni base, y `resume.ts` se limita a ejecutarla.
//
// INVARIANTE: no entender NUNCA cierra la sesion. Solo cierran un desenlace explicito
// (foto, no tengo, despues, cancelar) y el tope de reintentos.

import type { IncomingMessage } from '../../types.ts';
import { clasificarRespuesta } from '../../wa-intencion.ts';

/** Ids de los botones del paso. Los lee el handler y los escribe `execute.ts`. */
export const BTN_DESPUES = 'btn_despues';
export const BTN_SIN_SOPORTE = 'btn_sin_soporte';

/**
 * Las dos salidas reales del paso, ademas de mandar la foto.
 *
 * La pregunta anterior ("¿Tienes soporte fotográfico?") invitaba a un si/no y ofrecia UN
 * boton: quien contestaba "Si" no tenia donde tocar y el bot lo expulsaba. El copy pasa a
 * ser imperativo y los botones cubren las dos formas de NO mandar la foto ahora.
 */
export const BOTONES_SOPORTE: ReadonlyArray<{ id: string; title: string }> = [
  { id: BTN_DESPUES, title: '⏰ Después' },
  { id: BTN_SIN_SOPORTE, title: '🚫 No tengo' },
];

export const MSG_SOPORTE = {
  pedir: '📷 Envíame la foto o el PDF del soporte.',
  adjunta: '👍 Perfecto, adjunta la foto o el PDF aquí.',
  sinSoporte: '👍 Listo. Queda registrado sin soporte; lo puedes subir después desde la app.',
  despues: '👍 Sin problema. Puedes enviarlo después.',
  audio: '📷 Necesito la *foto* o el *PDF* del soporte, no un audio. Si no lo tienes, lo puedes agregar después.',
  noEsFoto: '📷 Necesito la *foto* o el *PDF* del soporte. Otro tipo de archivo, súbelo después desde la app.',
  repregunta: '📷 No te entendí. Mándame la foto o el PDF del soporte, o toca un botón.',
  rendicion: 'Lo dejo hasta aquí; el gasto quedó registrado y puedes subir el soporte después desde la app.',
} as const;

/**
 * Cuantas veces se repregunta antes de soltar. Dos repreguntas; al TERCER mensaje sin
 * entender, se cierra con una explicacion. Sin este tope, un texto que el clasificador no
 * reconoce deja al bot repitiendo la misma pregunta indefinidamente.
 */
export const MAX_REINTENTOS_SOPORTE = 2;

export interface EntradaSoporte {
  tipo: IncomingMessage['type'];
  /**
   * `true` solo si llego el archivo con el id con el que se baja: una foto (`image`) o, desde el 2026-10-21, un
   * documento PDF o de imagen (`document`). Lo calcula `archivoDeSoporte`.
   */
  tieneImagen: boolean;
  botonId?: string;
  texto: string;
}

export type DecisionSoporte =
  /** Bajar y guardar la foto, y despues cerrar. */
  | { accion: 'guardar_foto' }
  /** Cerrar la sesion diciendo esto. */
  | { accion: 'cerrar'; mensaje: string }
  /** Seguir en `awaiting_image`; `reintentos` es el contador que hay que persistir. */
  | { accion: 'permanecer'; mensaje: string; conBotones: boolean; reintentos: number };

/** Tipos de documento que sirven de soporte (los mismos que acepta la app al subir el soporte de un gasto). */
export const MIME_SOPORTE = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

/**
 * El id de Meta del archivo que sirve de soporte: la foto, o un documento PDF/imagen. `null` si no hay. Pura.
 * Un documento sin tipo declarado se toma (Meta casi siempre lo manda; si no, la descarga trae el content-type).
 */
export function archivoDeSoporte(m: Pick<IncomingMessage, 'type' | 'image_id' | 'document_id' | 'document_mime'>): string | null {
  if (m.type === 'image') return m.image_id ?? null;
  if (m.type === 'document' && m.document_id) return !m.document_mime || MIME_SOPORTE.has(m.document_mime) ? m.document_id : null;
  return null;
}

export function decidirSoporte(entrada: EntradaSoporte, reintentosPrevios: number): DecisionSoporte {
  // 1. Lo unico que completa el paso.
  if ((entrada.tipo === 'image' || entrada.tipo === 'document') && entrada.tieneImagen) return { accion: 'guardar_foto' };

  const reintentos = Number.isFinite(reintentosPrevios) && reintentosPrevios > 0
    ? Math.floor(reintentosPrevios)
    : 0;

  // 2. Los botones mandan sobre el texto: su id es inequivoco, mientras que el titulo
  //    viaja como `text` y tendria que volver a interpretarse.
  if (entrada.botonId === BTN_SIN_SOPORTE) return { accion: 'cerrar', mensaje: MSG_SOPORTE.sinSoporte };
  if (entrada.botonId === BTN_DESPUES) return { accion: 'cerrar', mensaje: MSG_SOPORTE.despues };

  // 3. El texto escrito. El audio tambien pasa por aqui: el webhook lo transcribe ANTES de
  //    enrutar, asi que una nota de voz que dice "no tengo" es una respuesta legible y
  //    tratarla como "mandaste un audio" seria dejar sin salida a quien solo contesta
  //    hablando — la misma trampa que este frente viene a cerrar.
  switch (clasificarRespuesta(entrada.texto)) {
    case 'si':
      // No cuenta como reintento: se entendio. El contador vigila lo que NO se entiende.
      return { accion: 'permanecer', mensaje: MSG_SOPORTE.adjunta, conBotones: false, reintentos };
    case 'no':
      return { accion: 'cerrar', mensaje: MSG_SOPORTE.sinSoporte };
    case 'despues':
      return { accion: 'cerrar', mensaje: MSG_SOPORTE.despues };
    case 'cancelar':
      // El gasto YA esta registrado: cancelar no lo deshace, solo suelta la conversacion.
      // Por eso se despide con el mensaje de "después" y no con uno que prometa mas.
      return { accion: 'cerrar', mensaje: MSG_SOPORTE.despues };
  }

  // 4. No se entendio. Aqui vive la guarda de bucle.
  if (reintentos >= MAX_REINTENTOS_SOPORTE) return { accion: 'cerrar', mensaje: MSG_SOPORTE.rendicion };

  const mensaje = entrada.tipo === 'audio'
    ? MSG_SOPORTE.audio
    : entrada.tipo === 'text' || entrada.tipo === 'interactive'
    ? MSG_SOPORTE.repregunta
    // Ubicacion, respuesta de Flow, una imagen sin id, o un documento que no es PDF ni imagen.
    : MSG_SOPORTE.noEsFoto;

  return { accion: 'permanecer', mensaje, conBotones: true, reintentos: reintentos + 1 };
}
