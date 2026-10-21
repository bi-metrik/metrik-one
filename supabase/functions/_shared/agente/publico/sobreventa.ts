// ============================================================
// Asistente público — los candados contra la sobreventa sobre el texto del modelo (§8.4, 2026-10-21)
// ------------------------------------------------------------
// Corren como guarda del núcleo (`DepsTurno.guardaTexto`): si algo salta, el error vuelve al modelo con UN reintento
// dentro del tope de llamados, igual que la guarda de precios; si insiste, sale la respuesta fija. Frenan:
//   · confirmación: «reservado», «confirmado», «tu mesa es», «te guardé el puesto». En la etapa 1 nada está reservado
//     ni confirmado: eso lo dicen las respuestas fijas (`rf.siguiente_paso`). Se dejan pasar las negaciones directas
//     («todavía no está reservado», «aún no queda confirmado»), que dicen justo lo que el diseño pide;
//   · escasez: «quedan pocos», «se agota», «últimos cupos», «queda poco»;
//   · condiciones sumadas: «se pueden sumar / acumular / combinar» y «con los dos (descuentos)», salvo que la ficha de
//     hoy diga que alguna es acumulable;
//   · condiciones que la herramienta no devolvió: un «2x1» o un «% de descuento» que no está en la ficha.
// Los montos (también los de condiciones y recargos) los revisa `precios.ts` contra lo que devolvió la herramienta: una
// condición vencida no sale de `ver_catalogo`, así que su monto tampoco pasa. Puro.
// ============================================================

const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const NEGACION = String.raw`(?:no|todavia no|aun no|ni)\s+(?:(?:esta|queda|quedo|ha quedado|te puedo dar(?:\s+(?:por|como))?|lo doy por|lo puedo dar por|puedo dar por|es)\s+)?`;

const CONFIRMACION: Array<[RegExp, string]> = [
  [/\b(reservad[oa]s?)\b/, '«reservado»'],
  [/\b(confirmad[oa]s?)\b/, '«confirmado»'],
  [/\btu mesa (es|sera|queda)\b/, '«tu mesa es»'],
  [/\bte (guarde|aparte|separe) (el|tu|los|un) (puesto|cupo|lugar|mesa)\b/, '«te guardé el puesto»'],
];
const ESCASEZ: Array<[RegExp, string]> = [
  [/\bquedan? (muy )?poc[oa]s\b/, '«quedan pocos»'],
  [/\bqueda poco\b/, '«queda poco»'],
  [/\bse (estan |esta |va(n)? a )?agota(n|ndo|r)?\b/, '«se agota»'],
  [/\bultimos (cupos|puestos|lugares)\b/, '«últimos cupos»'],
];
const COMBINAR = /\b(se |los )?(pueden|puedes|puede|podes) (sumar|acumular|combinar|juntar)\b|\bcon (los|ambos) (dos )?(descuentos|beneficios)\b|\b(sumando|acumulando|combinando) (los|ambos)\b/;

function afirmada(t: string, re: RegExp): boolean {
  for (const m of t.matchAll(new RegExp(re.source, 'g'))) {
    const antes = t.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
    if (new RegExp(`${NEGACION}$`).test(antes)) continue;
    return true;
  }
  return false;
}

/**
 * Los errores para el modelo (vacío = pasa). `herramientas`: lo que devolvieron las herramientas (JSON en texto), para
 * saber qué condiciones existen y si alguna se acumula. Pura.
 */
export function frasesDeSobreventa(texto: string, herramientas: ReadonlyArray<string>): string[] {
  const t = sinTildes(texto);
  const fuentes = sinTildes(herramientas.join('\n'));
  const errores: string[] = [];
  for (const [re, nombre] of CONFIRMACION) {
    if (afirmada(t, re)) errores.push(`dijiste ${nombre}: en esta etapa nada queda reservado ni confirmado por el bot; el equipo de Sabor confirma cupo, mesa y pago (si te preguntan, dilo así)`);
  }
  for (const [re, nombre] of ESCASEZ) {
    if (afirmada(t, re)) errores.push(`dijiste ${nombre}: no tienes inventario; no fabriques escasez ni urgencia`);
  }
  const acumulable = /"acumulable":"si"/.test(fuentes);
  if (!acumulable && afirmada(t, COMBINAR)) errores.push('las condiciones especiales no se suman entre sí: aplica una sola y el equipo confirma el total');
  for (const m of t.matchAll(/\b(\d+)\s?x\s?(\d+)\b/g)) {
    if (!fuentes.includes(`${m[1]}x${m[2]}`) && !fuentes.includes(`${m[1]} x ${m[2]}`)) errores.push(`el «${m[0]}» no está en la ficha: no lo repitas; di que no lo tienes publicado y que lo confirma el equipo`);
  }
  for (const m of t.matchAll(/\b(\d+)\s?%/g)) {
    if (!fuentes.includes(`${m[1]}%`) && !fuentes.includes(`${m[1]} %`)) errores.push(`el «${m[0]}» no está en la ficha: no lo repitas; usa solo las condiciones que devolvió ver_catalogo`);
  }
  return [...new Set(errores)];
}
