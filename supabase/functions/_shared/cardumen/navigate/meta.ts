// Navigate — lector determinista de META-respuestas: lo que la persona escribe cuando NO
// responde la pregunta sino que pregunta de vuelta ("¿quién eres?", "¿esto es una
// encuesta?") o se niega ("no quiero responder", "paso").
//
// Corre ANTES del modelo, en todos los pasos. Dos razones: no cuesta nada, y sobre todo
// garantiza que una pregunta o una negativa jamás lleguen al lector como si fueran una
// ubicación que leer. El modelo es la segunda barrera, no la primera.
//
// Es deliberadamente ESTRECHO. Un falso positivo aquí se traga una respuesta real:
// "no, primero la gente" no es una negativa; "no del todo nuevo" tampoco; "quién es el
// que manda" es una respuesta sobre el poder, no una pregunta de vuelta. Ante la duda
// devuelve null y el turno sigue su camino normal (el modelo dirá si se lee o no).

import { normalizarTexto } from "./interprete.ts";

export type Meta = "pregunta" | "negativa";

/** Una pregunta de vuelta es corta. Un párrafo largo que menciona "quién es usted" en el
 *  medio es una historia, y se deja pasar. */
const MAX_PALABRAS_PREGUNTA = 14;

// Sobre texto normalizado: minúsculas, sin tildes, sin signos (¿? ¡! , . ; : " ' * _).
const PREGUNTAS: readonly RegExp[] = [
  /\b(quien|que) (eres|es usted|sos|son ustedes|es este numero)\b/,
  /\busted quien es\b/,
  /\bquien (me )?(escribe|habla|pregunta|manda esto)\b/,
  /\bcon quien (hablo|estoy hablando)\b/,
  /\b(eres|es|sos|usted es|es usted) (un |una )?(bot|robot|maquina|persona|humano|humana|ia|inteligencia artificial|programa)\b/,
  /\b(que|de que) (es|se trata|va) (esto|este chat|esta conversacion|esta vaina|esta cosa)\b/,
  // Anclada: "es una prueba de que ya venia pasando" es una respuesta, no una pregunta.
  /^(y )?(esto )?es (una |un )?(encuesta|entrevista|estudio|prueba|broma|estafa|spam|publicidad)( o que| de verdad| en serio| real)?$/,
  /\bpara (que|quien) (sirve|es|son|usan|usaran|quieren) (esto|eso|estas preguntas|esta informacion|mis respuestas)\b/,
  /\bpara que sirve\b/,
  /\bpara que (me )?(pregunta|preguntan|quieren saber|necesitan)\b/,
  /^(que|para que) (quieres|quiere|quieren|buscan|busca|necesitan)\b/,
  /\bque (van a|vas a|va a|haran|hacen|hara) (hacer )?con (esto|eso|mis datos|mis respuestas|mi informacion)\b/,
  /\bquien (esta|hay) detras\b/,
  /\bque es (navigate|cardumen|metrik|esto)\b/,
  /\bde donde (sacaron|saco|sacan|tienen|obtuvieron) mi (numero|telefono|contacto|celular)\b/,
  /\bes (esto )?(seguro|confidencial|anonimo)\b/,
  /\b(quien|donde) (lo |la |me )?(ve|vera|lee|leera) (esto|mis respuestas)\b/,
];

// Anclados a la frase completa (con un "no" opcional adelante y una cortesía opcional
// atrás): "no quiero responder esa pregunta, gracias" sí; "no quiero que se acabe" no.
const CORTESIA = "(?: (?:gracias|por favor|perdon|disculpe|disculpa|lo siento))?";
const OBJETO = "(?: (?:a )?(?:esa|esta|la|eso|esto|nada|mas|ninguna)(?: pregunta)?)?";
const NEGATIVAS: readonly RegExp[] = [
  new RegExp(`^(?:no )?paso(?: de (?:esto|eso|esa|esta))?${CORTESIA}$`),
  new RegExp(`^(?:no )?(?:prefiero|mejor|preferiria) no(?: (?:responder|contestar|decir(?:lo)?|seguir|continuar|participar|hablar(?: de eso)?|opinar))?${OBJETO}${CORTESIA}$`),
  new RegExp(`^(?:no )?no (?:quiero|deseo|voy a|pienso|puedo|quisiera|me gustaria)(?: (?:responder|contestar|decir(?:lo)?|seguir|continuar|participar|hablar(?: de eso)?|opinar|hacerlo))?${OBJETO}${CORTESIA}$`),
  new RegExp(`^(?:no )?no me (?:interesa|provoca|apetece|da la gana)(?: (?:responder|contestar|seguir|continuar))?${OBJETO}${CORTESIA}$`),
  new RegExp(`^(?:no )?no gracias$`),
  new RegExp(`^(?:no )?sin comentarios${CORTESIA}$`),
  new RegExp(`^(?:no )?(?:la )?siguiente(?: pregunta)?${CORTESIA}$`),
  new RegExp(`^(?:no )?salt(?:e|a|emos|en|ese|ela|elo|ala|alo)(?: (?:esa|esta|la))?(?: pregunta)?${CORTESIA}$`),
];

/** Sin una sola letra o dígito: cadena vacía, solo espacios, solo emojis o solo signos. */
export function sinPalabras(texto: string): boolean {
  return !/[\p{L}\p{N}]/u.test(texto || "");
}

export function leerMeta(texto: string): Meta | null {
  const n = normalizarTexto(texto);
  if (!n) return null;
  if (NEGATIVAS.some((re) => re.test(n))) return "negativa";
  const palabras = n.split(" ").length;
  if (palabras <= MAX_PALABRAS_PREGUNTA && PREGUNTAS.some((re) => re.test(n))) return "pregunta";
  return null;
}
