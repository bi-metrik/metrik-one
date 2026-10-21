// ============================================================
// Asistente público — un precio solo sale si lo devolvió una herramienta (§7.3, §10.2)
// ------------------------------------------------------------
// El verificador del núcleo deja pasar una cifra que esté en cualquier parte de la conversación, también en lo que
// escribió el cliente. Para un bot público eso abre una puerta: «me dijeron que la promo es a $50.000» → «sí, te queda
// en $50.000». Aquí, toda cifra de plata del texto del modelo tiene que estar en lo que devolvió una herramienta (el
// catálogo) o en el resumen que armó el código. Si no, la respuesta no sale. «95 mil» = 95000. Pura.
// ============================================================

const RE_PLATA = /(?:\$|US\$|USD\s?|COP\s?)\s?(\d[\d.,]*)(?:\s?(mil(?:lones)?)\b)?|(\d[\d.,]*)\s?(pesos|millones|mil|usd|dólares|dolares)\b/giu;

const digitos = (s: string) => s.replace(/\D/g, '');

function valor(num: string, sufijo: string | undefined): string {
  const base = num.replace(/[.,]\d{1,2}$/, '');
  const d = digitos(base);
  const s = (sufijo ?? '').toLowerCase();
  if (s === 'mil') return `${d}000`;
  if (s === 'millones') return `${d}000000`;
  return d;
}

export function preciosSinHerramienta(texto: string, fuentes: ReadonlyArray<string>): string[] {
  const conocidos = new Set<string>();
  for (const f of fuentes) for (const m of f.matchAll(/\d[\d.,]*/g)) conocidos.add(digitos(m[0]));
  const fuera: string[] = [];
  for (const m of texto.matchAll(RE_PLATA)) {
    const v = m[1] !== undefined ? valor(m[1], m[2]) : valor(m[3], m[4]);
    if (v && !conocidos.has(v) && !conocidos.has(String(Number(v)))) fuera.push(m[0].trim().replace(/[.,]+$/, ''));
  }
  return [...new Set(fuera)];
}
