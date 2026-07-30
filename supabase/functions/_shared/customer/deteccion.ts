// Detección determinista sobre lo que escribe la persona.
//
// Esto NO vive en el prompt a propósito. Un modelo puede distraerse; una
// tarjeta que se cuela queda guardada en el historial de la conversación y
// eso no se deshace. Las barreras que importan se evalúan en código, antes
// y después de llamar al modelo.

/** Luhn — valida el dígito de control de una tarjeta. */
function luhnValido(digitos: string): boolean {
  let suma = 0;
  let doble = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let d = digitos.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (doble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    suma += d;
    doble = !doble;
  }
  return suma % 10 === 0;
}

export type TipoSensible = "tarjeta" | "cuenta_bancaria" | "documento" | "cvv";

/**
 * Busca datos que no deben viajar por este canal.
 *
 * Se usa Luhn para la tarjeta en vez de "16 dígitos seguidos": sin esa
 * validación, un número de radicado o una cédula larga levantarían la
 * alarma y el bot regañaría a la persona sin motivo, que es peor que no
 * avisar (enseña a ignorar el aviso).
 */
export function detectarDatoSensible(text: string): TipoSensible | null {
  const t = (text || "").trim();
  if (!t) return null;

  // Secuencias de 13 a 19 dígitos, tolerando espacios y guiones intercalados.
  const candidatos = t.match(/\b(?:\d[ -]?){12,18}\d\b/g) ?? [];
  for (const c of candidatos) {
    const soloDigitos = c.replace(/[^\d]/g, "");
    if (soloDigitos.length >= 13 && soloDigitos.length <= 19 && luhnValido(soloDigitos)) {
      return "tarjeta";
    }
  }

  // Seguro Social de EE.UU.: 3-2-4 con separador explícito. Sin separador
  // son nueve dígitos sueltos y eso sí genera falsos positivos.
  if (/\b\d{3}[ -]\d{2}[ -]\d{4}\b/.test(t)) return "documento";

  // CVV declarado. Tres dígitos sueltos no alcanzan: tiene que venir
  // nombrado, o cualquier "son 123" dispararía la alarma.
  if (/\b(cvv|cvc|c[oó]digo de seguridad|security code)\b[^\d]{0,12}\d{3,4}\b/i.test(t)) return "cvv";

  // Cuenta o ruta bancaria nombrada explícitamente y seguida de dígitos.
  if (/\b(n[uú]mero de (cuenta|ruta)|routing|cuenta (de ahorros|corriente)|account number)\b[^\d]{0,20}\d{6,}/i.test(t)) {
    return "cuenta_bancaria";
  }

  return null;
}

/** Correo electrónico. Determinista: no se le pregunta al modelo algo que una expresión resuelve. */
export function extraerCorreo(text: string): string | null {
  const m = (text || "").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

/**
 * Enmascara datos sensibles antes de persistir el historial.
 *
 * Si la persona igual escribió la tarjeta, el aviso del bot no sirve de nada
 * cuando el número queda guardado en `state.history` en texto plano. Se
 * guarda enmascarado; el bot ya respondió sobre el original en memoria.
 */
export function enmascarar(text: string): string {
  return (text || "")
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => {
      const d = m.replace(/[^\d]/g, "");
      return d.length >= 13 && d.length <= 19 && luhnValido(d) ? "[dato de pago omitido]" : m;
    })
    .replace(/\b\d{3}[ -]\d{2}[ -]\d{4}\b/g, "[documento omitido]");
}
