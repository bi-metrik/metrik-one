// Parseo tolerante de JSON de LLMs: envuelto en ```json```, con prosa alrededor,
// con varios objetos pegados, o truncado a la mitad.
export function parseLooseJSON<T = unknown>(raw: string): T {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  if (start < 0) return JSON.parse(s) as T; // deja que falle con mensaje claro
  s = s.slice(start);

  // Intento 1: primer objeto balanceado (maneja prosa colgante y objetos multiples).
  const balanced = firstBalanced(s);
  if (balanced) {
    try { return JSON.parse(balanced) as T; } catch { /* cae a reparacion */ }
  }
  // Intento 2: reparar truncamiento sobre el string completo desde el primer '{'.
  return JSON.parse(repairTruncated(s)) as T;
}

// Devuelve el primer objeto {...} con llaves balanceadas, o null si quedo truncado.
function firstBalanced(s: string): string | null {
  let depth = 0, inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== "\\") inStr = !inStr;
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return s.slice(0, i + 1); }
  }
  return null;
}

// Reparacion best-effort de JSON truncado (string sin cerrar / llaves/corchetes faltantes).
function repairTruncated(s: string): string {
  let out = s;
  const quotes = (out.match(/(?<!\\)"/g) || []).length;
  if (quotes % 2 !== 0) out += '"';
  const stack: string[] = [];
  let inStr = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (c === '"' && out[i - 1] !== "\\") inStr = !inStr;
    if (inStr) continue;
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }
  while (stack.length) out += stack.pop() === "{" ? "}" : "]";
  return out;
}
