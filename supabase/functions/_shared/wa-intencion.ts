// Lectura determinista de una respuesta corta de WhatsApp.
//
// POR QUE EXISTE: los flujos del bot venian comparando la respuesta contra arreglos sueltos
// escritos en el sitio (`['sí','si','yes','1']`, `['después','despues','luego']`). Cada copia
// reconocia un vocabulario distinto, y lo que quedaba fuera no producia un error: caia por
// todas las ramas del `if` y terminaba en el camino de salida. En `awaiting_image` eso
// significaba que un "Si" —la respuesta natural a una pregunta de si/no— CERRABA la sesion
// y expulsaba a quien queria mandar la foto.
//
// Regla del proyecto: el criterio con el que se lee a una persona vive en UN modulo puro,
// no repartido en literales. Este es ese modulo. La referencia buena era el motor de
// Cardumen (`cardumen/navigate/motor.ts`, sets SI/NO + MAX_REINTENTOS); aqui se generaliza
// para los flujos de ONE sin tocar ese motor, que responde a un instrumento aprobado.
//
// ⚠️ NO usar `\b` de JavaScript: no considera "á"/"í" caracteres de palabra, asi que
// `\bsí\b` no matchea "Sí,". La normalizacion de abajo ya quita las tildes, pero los
// lookarounds con `\p{L}` y flag `u` son la forma que este repo ya usa (`es-neutro.ts`) y
// no depende de que la normalizacion corra antes.

export type Intencion = 'si' | 'no' | 'despues' | 'cancelar' | 'desconocido';

/**
 * Minusculas, sin tildes, sin signos y con los espacios colapsados.
 *
 * La puntuacion se reemplaza por ESPACIO, no por vacio: "no,tengo" tiene que quedar
 * "no tengo" y no "notengo". Los emoji NO se quitan — son respuesta en si mismos
 * (un 👍 es un si) y se leen aparte.
 */
export function normalizarRespuesta(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[!¡?¿.,;:"'`*_()[\]{}/\\|@#+=<>~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Emoji que valen como respuesta por si solos. Se comparan sobre el texto CRUDO. */
const EMOJI_SI = ['👍', '👌', '🙌', '✅', '✔', '☑'];
const EMOJI_NO = ['👎', '❌', '🚫', '⛔'];

/**
 * Patrones por intencion, en ORDEN DE PRIORIDAD. El orden no es cosmetico:
 *
 * - `cancelar` primero porque es una salida explicita y nunca es otra cosa.
 * - `despues` antes que `no`, porque "ahorita no" y "no, luego" son un aplazamiento,
 *   no una negativa.
 * - `no` antes que `si`, porque "no tengo" contiene "tengo" (marca de si) y la negacion
 *   es la que manda.
 *
 * Cada marca va con lookarounds de letra: sin ellos, "si" se colaria dentro de "sino" y
 * "no" dentro de "nota".
 */
const PATRONES: ReadonlyArray<readonly [Intencion, RegExp]> = [
  [
    'cancelar',
    /(?<!\p{L})(cancelar|cancela|cancelalo|cancelemos|olvidalo|olvidate|olvidemos|dejalo asi|deja asi|dejemoslo asi|salir)(?!\p{L})/u,
  ],
  [
    'despues',
    /(?<!\p{L})(despues|luego|ahorita|ahora no|mas tarde|mas rato|al rato|en un rato|mas adelante|manana|otro dia|otro momento)(?!\p{L})/u,
  ],
  [
    'no',
    /(?<!\p{L})(no|nop|nope|nel|nada|ninguno|ninguna|negativo|nunca|nao|not)(?!\p{L})/u,
  ],
  [
    'si',
    /(?<!\p{L})(si|sii+|sip|sipi|s|claro|dale|ok|oka|okey|okay|oki|listo|tengo|ya|yes|yep|yeah|vale|correcto|exacto|afirmativo|bueno|perfecto|obvio|seguro|va|sim|de una|asi es|de acuerdo|esta bien|ahi va|ahi voy|ya va|ya voy|un momento|espera|esperame|enseguida|de inmediato)(?!\p{L})/u,
  ],
];

/**
 * Lee una respuesta corta y devuelve la intencion. `desconocido` cuando no hay marca:
 * es una respuesta valida y a proposito — quien llama decide que hacer con ella, y lo
 * que NO puede hacer es tratarla como una salida.
 */
export function clasificarRespuesta(texto: string | null | undefined): Intencion {
  const crudo = texto ?? '';
  const t = normalizarRespuesta(crudo);

  // Los emoji se juzgan primero y solos: un mensaje que es SOLO un 👍 se normaliza a un
  // texto sin ninguna marca de palabra y caeria en `desconocido`.
  if (EMOJI_NO.some((e) => crudo.includes(e))) return 'no';
  if (EMOJI_SI.some((e) => crudo.includes(e))) return 'si';

  if (!t) return 'desconocido';

  for (const [intencion, patron] of PATRONES) {
    if (patron.test(t)) return intencion;
  }
  return 'desconocido';
}
