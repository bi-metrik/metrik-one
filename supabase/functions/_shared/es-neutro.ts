// Español neutro de Colombia, garantizado en CODIGO y no solo pedido al prompt.
//
// POR QUE EXISTE: el system prompt de R1 ya prohibe el voseo con una lista explicita que
// incluye "conta" y "contame", y el modelo igual escribio **"Contame de una vez que no salio
// asi"** en una conversacion real (2026-08-12, turno 3). La misma pregunta, en la corrida
// anterior y con el mismo prompt, habia salido bien ("Cuentame..."). O sea: la instruccion
// negativa reduce la frecuencia pero no la elimina, y lo que llega al cliente no puede
// depender de la suerte de un turno.
//
// Regla del proyecto: en un bot, los pasos criticos van en codigo determinista, no en el
// prompt. La voz de marca es uno de esos pasos.
//
// CRITERIO DEL MAPA: solo formas INEQUIVOCAS de voseo. Nada que en tuteo sea correcto.
// Ejemplos de lo que NO se toca: "estas"/"estás" (tuteo valido), "despues", "Tomas".
// El caso "fijate" es de acento, no de persona: en tuteo es "fijate" -> "fíjate".
//
// ⚠️ NO usar `\b` de JavaScript con formas acentuadas. `\b` no considera "á"/"í" como
// caracteres de palabra, asi que `\bmirá\b` NO matchea "Mirá," — lo comprobe: en la primera
// version de este archivo se escaparon "Mirá" y "vení" mientras "contame" y "tenés" (que
// terminan en consonante) si se corregian. Es el mismo gotcha que este repo ya documenta para
// `hasAnaphoricSignal` en el parser de WhatsApp. Se usan lookarounds con \p{L} y flag `u`.

const MAPA_VOSEO: ReadonlyArray<readonly [RegExp, string]> = [
  // imperativos con enclitico (los mas frecuentes en la practica)
  [/(?<!\p{L})contame(?!\p{L})/gui, "cuéntame"],
  [/(?<!\p{L})contanos(?!\p{L})/gui, "cuéntanos"],
  [/(?<!\p{L})contá(?!\p{L})/gui, "cuenta"],
  [/(?<!\p{L})decime(?!\p{L})/gui, "dime"],
  [/(?<!\p{L})decinos(?!\p{L})/gui, "dinos"],
  [/(?<!\p{L})decí(?!\p{L})/gui, "di"],
  [/(?<!\p{L})mirá(?!\p{L})/gui, "mira"],
  [/(?<!\p{L})mirame(?!\p{L})/gui, "mírame"],
  [/(?<!\p{L})fijate(?!\p{L})/gui, "fíjate"],
  [/(?<!\p{L})andá(?!\p{L})/gui, "anda"],
  [/(?<!\p{L})vení(?!\p{L})/gui, "ven"],
  [/(?<!\p{L})pensá(?!\p{L})/gui, "piensa"],
  [/(?<!\p{L})esperá(?!\p{L})/gui, "espera"],
  // presentes de indicativo
  [/(?<!\p{L})tenés(?!\p{L})/gui, "tienes"],
  [/(?<!\p{L})querés(?!\p{L})/gui, "quieres"],
  [/(?<!\p{L})podés(?!\p{L})/gui, "puedes"],
  [/(?<!\p{L})sabés(?!\p{L})/gui, "sabes"],
  [/(?<!\p{L})sentís(?!\p{L})/gui, "sientes"],
  [/(?<!\p{L})pensás(?!\p{L})/gui, "piensas"],
  [/(?<!\p{L})hacés(?!\p{L})/gui, "haces"],
  [/(?<!\p{L})vivís(?!\p{L})/gui, "vives"],
  [/(?<!\p{L})decís(?!\p{L})/gui, "dices"],
  [/(?<!\p{L})venís(?!\p{L})/gui, "vienes"],
  [/(?<!\p{L})sos(?!\p{L})/gui, "eres"],
  // pronombre
  [/(?<!\p{L})vos(?!\p{L})/gui, "tú"],
];

export interface ResultadoNeutro {
  texto: string;
  correcciones: string[]; // formas encontradas, para el log (asi se ve si el prompt esta empeorando)
}

/** Devuelve el texto en tuteo neutro. Determinista y pura: se puede probar sin modelo. */
export function aEspanolNeutro(input: string): ResultadoNeutro {
  let texto = input ?? "";
  const correcciones: string[] = [];
  for (const [re, reemplazo] of MAPA_VOSEO) {
    const encontradas = texto.match(re);
    if (encontradas?.length) {
      correcciones.push(...encontradas.map((f) => `${f}→${reemplazo}`));
      // preserva mayuscula inicial si la forma original la tenia
      texto = texto.replace(re, (m) =>
        m[0] === m[0].toUpperCase() ? reemplazo[0].toUpperCase() + reemplazo.slice(1) : reemplazo,
      );
    }
  }
  return { texto, correcciones };
}

/** true si queda alguna forma de voseo despues de corregir (senal de que el mapa esta corto). */
export function tieneVoseoResidual(texto: string): boolean {
  return /(?<!\p{L})(vos|sos|tenés|querés|podés|sabés|sentís|pensás|hacés|contame|contá|decime|decí|mirá|andá|vení|pensá|esperá|fijate)(?!\p{L})/ui.test(texto);
}
