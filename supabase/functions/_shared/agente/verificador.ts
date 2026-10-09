// ============================================================
// Núcleo conversacional — el verificador de `responder` (§3.5, «no afirmar lo que nadie devolvió»)
// ------------------------------------------------------------
// Solo lo estructural: todo código de viaje, celular, correo, fecha, cifra y porcentaje del texto tiene que estar en el
// respaldo (un resultado de herramienta, un mensaje de la conversación, lo que el bot ya dijo, el estado y el reglamento
// que armó el código). No lee palabras.
//
// Hasta el 2026-10-09 también atajaba «nombres propios» (toda palabra con mayúscula fuera de una lista) y «verbos de
// hecho» (una lista de verbos y participios, con la afirmación cruzada contra los hechos del turno). En producción, del
// 7 al 9 de octubre, los 5 rechazos (en 4 de 48 turnos) fueron falsos: «¿Quieres…?», «Pasajeros», «Envíame», «Quedo» tomados
// como nombres, «los anotamos» (futuro) como hecho, y dos afirmaciones ciertas tras un `ver_viaje`. Cada uno costó un
// llamado y uno terminó en «No pude revisarlo ahora» con el modelo sano. Se quitaron, no se ampliaron las listas
// (Mauricio: el modelo interpreta; el código protege invariantes).
// El invariante «los hechos los escribe el sistema» lo sostienen la estructura y no este archivo: nada se escribe sin
// `proponer` + el toque, la confirmación de un hecho la redacta el código (`rf.hecho`, las líneas del dominio), y un
// código de viaje inventado no sale. El arnés sigue contando como dañina todo texto del modelo que diga «cargué/abrí…».
// Pura.
// ============================================================

const RE_CODIGO = /\b[A-ZÑ]\d{0,2} \d{2} \d{1,4}\b/gu;
const RE_CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const RE_CEL_CORTO = /(?:…|\.\.\.)\s?(\d{3,4})\b/gu;
const RE_CEL_LARGO = /(?<![\d])\+?\d[\d\s().-]{5,}\d(?![\d])/gu;
const MESES = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic';
const RE_FECHA = new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+)?(${MESES})\\b|\\b(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{2,4}))?\\b`, 'giu');
const RE_PORCENTAJE = /(\d+(?:[.,]\d+)?)\s?%/gu;
const RE_PLATA = /(?:\$|US\$|USD\s?)\s?(\d[\d.,]*)|(\d[\d.,]*)\s?(?:pesos|millones|mil|usd|dólares|dolares)\b/giu;
const RE_NUMERO = /\b\d{2,}(?:[.,]\d+)*\b/gu;

export function normal(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function digitos(s: string): string {
  return s.replace(/\D/g, '');
}

export interface Respaldo {
  texto: string;
  digitos: string;
  numeros: Set<string>;
}

/** El respaldo armado una vez por turno. */
export function respaldoDe(fuentes: ReadonlyArray<string>): Respaldo {
  const texto = fuentes.join('\n');
  const n = normal(texto);
  const numeros = new Set<string>();
  for (const m of texto.matchAll(/\d[\d.,]*/g)) {
    const d = digitos(m[0]);
    if (d) { numeros.add(d); numeros.add(String(Number(d))); }
  }
  return { texto: n.replace(/\s+/g, ' '), digitos: digitos(texto), numeros };
}

/** Los motivos por los que el texto no puede salir: los datos que no están en el respaldo. Vacío = pasa. */
export function verificar(texto: string, r: Respaldo): string[] {
  return datosSinRespaldo(texto, r);
}

/** Los datos de un texto (códigos, correos, celulares, fechas, cifras, porcentajes) que no están en el respaldo. */
function datosSinRespaldo(texto: string, r: Respaldo): string[] {
  const motivos: string[] = [];
  const usados = new Set<string>();
  for (const m of texto.matchAll(RE_CODIGO)) {
    usados.add(m[0]);
    if (!r.texto.includes(normal(m[0]))) motivos.push(`código «${m[0]}» que ninguna herramienta devolvió`);
  }
  for (const m of texto.matchAll(RE_CORREO)) {
    if (!r.texto.includes(normal(m[0]))) motivos.push(`correo «${m[0]}» sin respaldo`);
  }
  for (const m of texto.matchAll(RE_CEL_CORTO)) {
    usados.add(m[1]);
    if (!r.digitos.includes(m[1])) motivos.push(`celular «…${m[1]}» sin respaldo`);
  }
  for (const m of texto.matchAll(RE_CEL_LARGO)) {
    const d = digitos(m[0]);
    if (d.length < 7) continue;
    usados.add(m[0].trim());
    if (!r.digitos.includes(d.slice(-7))) motivos.push(`número «${m[0].trim()}» sin respaldo`);
  }
  for (const m of texto.matchAll(RE_FECHA)) {
    const partes = [m[1], m[3], m[4], m[5]].filter(Boolean) as string[];
    for (const p of partes) usados.add(p);
    // La fecha tiene que estar como la dijeron (el día con su mes) o sus números en el respaldo.
    if (!r.texto.includes(normal(m[0]).replace(/\s+/g, ' ')) && !partes.every((p) => r.numeros.has(String(Number(p))))) {
      motivos.push(`fecha «${m[0]}» sin respaldo`);
    }
  }
  for (const m of texto.matchAll(RE_PORCENTAJE)) {
    usados.add(m[1]);
    if (!r.numeros.has(digitos(m[1]))) motivos.push(`porcentaje «${m[0]}» sin respaldo`);
  }
  for (const m of texto.matchAll(RE_PLATA)) {
    const num = m[1] ?? m[2];
    usados.add(num);
    if (!r.numeros.has(digitos(num))) motivos.push(`cifra «${m[0].trim()}» sin respaldo`);
  }
  for (const m of texto.matchAll(RE_NUMERO)) {
    if ([...usados].some((u) => u.includes(m[0]))) continue;
    const d = digitos(m[0]);
    if (!r.numeros.has(d) && !r.numeros.has(String(Number(d)))) motivos.push(`cifra «${m[0]}» sin respaldo`);
  }

  return [...new Set(motivos)];
}
