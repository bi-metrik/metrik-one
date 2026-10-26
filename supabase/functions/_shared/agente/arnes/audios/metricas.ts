// ============================================================
// Arnés de audios — las métricas (spec 2026-10-26, §4.6). Puras.
// ------------------------------------------------------------
// Lo que cuenta es lo que hace falta para registrar: nombres de personas y clientes, cifras y códigos. La tasa de error
// de palabras (WER) es secundaria. Y la inserción falsa: palabras de los nombres de la base que la transcripción
// escribe sin que estén en la referencia (el riesgo de las pistas).
//
// Cómo se compara:
//   · nombres: sin tildes ni mayúsculas ni puntuación, las palabras del nombre seguidas en la transcripción. «Yeimy» y
//     «Jeimy» son distintos: eso es justo lo que se mide.
//   · cifras: las cifras dichas en palabras o en dígitos se vuelven valor («60 mil», «60.000», «sesenta mil» → 60000;
//     «un millón trescientos cincuenta mil» → 1350000). Una cifra de varias partes (una cédula dictada de a dígitos o
//     de a grupos) se compara como la cadena de dígitos seguida.
//   · códigos: sin espacios ni guiones y con los números como valor («I1 26 5», «I uno veintiséis cinco», «i1-26-5» →
//     «i1265»), contenidos en la transcripción.
//   · WER: distancia de edición por palabras sobre el texto normalizado (números como valor en los dos lados).
// ============================================================

/** Sin tildes y en minúsculas; la ñ cuenta como n («Castano» acierta «Castaño», como una tilde que falta). */
function plano(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Palabras de un nombre o de un texto, sin puntuación. */
export function palabras(s: string): string[] {
  return plano(s).replace(/[^a-z0-9ñ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

const UNIDADES: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23,
  veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400,
  cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700,
  setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};
const MULTIPLICADORES: Record<string, number> = { mil: 1000, millon: 1e6, millones: 1e6 };

/** Un token de dígitos como número: «60.000» → 60000, «2,5» → 2.5, «1.023.456.789» → 1023456789. */
function valorDigitos(t: string): number | null {
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  // «350,000» es plata con la coma de miles (así escribe a veces el modelo); un decimal de tres cifras no se dicta.
  if (/^\d{1,3}(,\d{3})+$/.test(t)) return Number(t.replace(/,/g, ''));
  if (/^\d+,\d+$/.test(t)) return Number(t.replace(',', '.'));
  if (/^\d+\.\d{1,2}$/.test(t)) return Number(t);
  if (/^\d+$/.test(t)) return Number(t);
  return null;
}

/** Tokens con la puntuación como corte («|»): «60 mil, me pagó 40» → 60 · mil · | · me · pago · 40. */
function tokensConCortes(s: string): string[] {
  const t = plano(s).replace(/\$/g, ' ');
  const out: string[] = [];
  const re = /\d+(?:[.,]\d+)*|[a-zñ]+\d*|[.,;:!?¿¡\n]/g;
  for (const m of t.matchAll(re)) out.push(/^[.,;:!?¿¡\n]$/.test(m[0]) ? '|' : m[0]);
  return out;
}

/**
 * El texto con las cifras como valor, en tokens (sin cortes). Las cifras en palabras se juntan como se dicen
 * («trescientos cincuenta mil» → «350000»); dos números que no se pueden sumar como parte de una misma cifra («uno
 * cero dos», «veintiséis cinco») quedan separados. Pura.
 */
export function normalizarConCifras(s: string): string[] {
  const toks = tokensConCortes(s);
  const out: string[] = [];
  let activo = false;
  let total = 0;
  let actual = 0;
  let ultimoMult = 0;
  let empezoEnCero = false;
  const soltar = () => {
    if (activo) out.push(String(total + actual));
    activo = false; total = 0; actual = 0; ultimoMult = 0; empezoEnCero = false;
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === '|') { soltar(); continue; }
    if (t === 'y' && activo) {
      const sig = toks[i + 1];
      if ((sig === 'medio' || sig === 'media') && ultimoMult && actual === 0) { total += ultimoMult / 2; i++; continue; }
      if (sig && sig in UNIDADES && UNIDADES[sig] < 10 && actual % 10 === 0 && actual % 100 !== 0 && actual >= 20) continue;
    }
    if (t in MULTIPLICADORES) {
      const m = MULTIPLICADORES[t];
      if (!activo) { activo = true; actual = 1; }
      if (m === 1000) { total += (actual || 1) * 1000; actual = 0; } else { total = (total + (actual || 0) || 1) * m; actual = 0; }
      ultimoMult = m;
      continue;
    }
    const palabra = t in UNIDADES;
    const v = palabra ? UNIDADES[t] : valorDigitos(t);
    if (v === null) { soltar(); out.push(t); continue; }
    if (!activo) { activo = true; actual = v; empezoEnCero = palabra && v === 0; continue; }
    let sumar = false;
    if (palabra) {
      if (actual === 0) sumar = !empezoEnCero && total > 0 && (!ultimoMult || v < ultimoMult);
      else if (actual % 10 !== 0) sumar = false;
      else if (actual % 100 !== 0) sumar = actual >= 20 && v < 10;
      else if (actual % 1000 !== 0) sumar = v < 100;
    } else {
      sumar = actual === 0 && total > 0 && !empezoEnCero && v < (ultimoMult || 0);
    }
    if (sumar) actual += v;
    else { soltar(); activo = true; actual = v; empezoEnCero = palabra && v === 0; }
  }
  soltar();
  return out;
}

const esValor = (t: string) => /^\d+(\.\d+)?$/.test(t);

/** La llave de una cifra marcada: su valor, o la cadena de dígitos si tiene varias partes (una cédula). */
export function llaveCifra(texto: string): { valor: string } | { digitos: string } | null {
  const nums = normalizarConCifras(texto).filter(esValor);
  if (!nums.length) return null;
  return nums.length === 1 ? { valor: nums[0] } : { digitos: nums.join('') };
}

/** La llave de un código: sin separadores y con los números como valor. «I1 26 5» → «i1265». */
export function llaveCodigo(texto: string): string {
  return normalizarConCifras(texto).join('');
}

/** ¿Están las palabras de `nombre` seguidas en `texto`? */
export function contieneNombre(texto: string, nombre: string): boolean {
  const t = palabras(texto);
  const n = palabras(nombre);
  if (!n.length) return false;
  for (let i = 0; i + n.length <= t.length; i++) if (n.every((w, j) => t[i + j] === w)) return true;
  return false;
}

export function aciertaCifra(transcripcion: string, cifra: string): boolean {
  const k = llaveCifra(cifra);
  if (!k) return false;
  const nums = normalizarConCifras(transcripcion).filter(esValor);
  if ('valor' in k) return nums.some((n) => Number(n) === Number(k.valor));
  return nums.join('').includes(k.digitos);
}

/** El código, pegado, empieza y termina en borde de palabra: «I1 26 50» no acierta «I1 26 5». */
export function aciertaCodigo(transcripcion: string, codigo: string): boolean {
  const k = llaveCodigo(codigo);
  if (!k) return false;
  const toks = normalizarConCifras(transcripcion);
  const bordes = new Set<number>([0]);
  let largo = 0;
  for (const t of toks) { largo += t.length; bordes.add(largo); }
  const pegado = toks.join('');
  for (let i = pegado.indexOf(k); i >= 0; i = pegado.indexOf(k, i + 1)) if (bordes.has(i) && bordes.has(i + k.length)) return true;
  return false;
}

/** Palabras comunes que no cuentan como inserción aunque estén en un nombre de la base. */
const COMUNES = new Set([
  'de', 'del', 'la', 'las', 'los', 'el', 'y', 'en', 'con', 'por', 'para', 'san', 'santa', 'obra', 'casa', 'calle',
  'torre', 'conjunto', 'edificio', 'cubierta', 'terraza', 'fachada', 'tanque', 'parque', 'noche', 'taller', 'cata',
  'brunch', 'mercado', 'cejas', 'pestanas', 'diseno', 'unas', 'depilacion', 'hilo',
]);

/**
 * Las palabras de los nombres de la base que pueden contar como inserción falsa en esta nota: las de 4 letras o más,
 * que no son comunes y que NO están en la referencia. Pura.
 */
export function candidatasInsercion(nombresBase: string[], referencia: string): string[] {
  const enRef = new Set(palabras(referencia));
  const out = new Set<string>();
  for (const n of nombresBase) for (const w of palabras(n)) if (w.length >= 4 && !COMUNES.has(w) && !/\d/.test(w) && !enRef.has(w)) out.add(w);
  return [...out];
}

/** Las candidatas que la transcripción escribió (sin repetir). */
export function insercionesFalsas(transcripcion: string, candidatas: string[]): string[] {
  const t = new Set(palabras(transcripcion));
  return candidatas.filter((w) => t.has(w));
}

/** WER: distancia de edición por palabras / palabras de la referencia, con las cifras como valor en los dos lados. */
export function wer(referencia: string, hipotesis: string): number {
  const r = normalizarConCifras(referencia);
  const h = normalizarConCifras(hipotesis);
  if (!r.length) return h.length ? 1 : 0;
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[h.length] / r.length;
}

// ── Una transcripción contra su guion ─────────────────────────────────────────

export type TipoMarca = 'nombre' | 'cifra' | 'codigo';
export interface Marca { tipo: TipoMarca; texto: string }

export interface Medida {
  nombres: { aciertos: number; total: number; fallados: string[] };
  cifras: { aciertos: number; total: number; fallados: string[] };
  codigos: { aciertos: number; total: number; fallados: string[] };
  inserciones: string[];
  wer: number;
}

export function medir(a: { referencia: string; marcas: Marca[]; candidatas: string[]; transcripcion: string }): Medida {
  const cuenta = (tipo: TipoMarca, f: (t: string, m: string) => boolean) => {
    const ms = a.marcas.filter((m) => m.tipo === tipo);
    const fallados = ms.filter((m) => !f(a.transcripcion, m.texto)).map((m) => m.texto);
    return { aciertos: ms.length - fallados.length, total: ms.length, fallados };
  };
  return {
    nombres: cuenta('nombre', contieneNombre),
    cifras: cuenta('cifra', aciertaCifra),
    codigos: cuenta('codigo', aciertaCodigo),
    inserciones: insercionesFalsas(a.transcripcion, a.candidatas),
    wer: wer(a.referencia, a.transcripcion),
  };
}

// ── El agregado por modelo y con o sin pistas ────────────────────────────────

export interface Intento {
  modelo: string;
  conPistas: boolean;
  guion: string;
  repeticion: number;
  /** `null` si la transcripción falló (error de la API, corte, INAUDIBLE). */
  medida: Medida | null;
  error?: string;
  transcripcion?: string | null;
  ms?: number;
}

export interface Agregado {
  modelo: string;
  conPistas: boolean;
  intentos: number;
  fallos: number;
  nombres: number | null;
  cifras: number | null;
  codigos: number | null;
  /** Inserciones falsas por transcripción. */
  insercionPorNota: number | null;
  /** Transcripciones con al menos una inserción falsa / transcripciones. */
  notasConInsercion: number | null;
  wer: number | null;
}

const razon = (a: number, b: number) => (b ? a / b : null);

export function agregar(intentos: Intento[]): Agregado[] {
  const grupos = new Map<string, Intento[]>();
  for (const i of intentos) {
    const k = `${i.modelo}\u0000${i.conPistas}`;
    grupos.set(k, [...(grupos.get(k) ?? []), i]);
  }
  return [...grupos.values()].map((g) => {
    const ok = g.map((i) => i.medida).filter((m): m is Medida => !!m);
    const suma = (f: (m: Medida) => number) => ok.reduce((s, m) => s + f(m), 0);
    return {
      modelo: g[0].modelo,
      conPistas: g[0].conPistas,
      intentos: g.length,
      fallos: g.length - ok.length,
      nombres: razon(suma((m) => m.nombres.aciertos), suma((m) => m.nombres.total)),
      cifras: razon(suma((m) => m.cifras.aciertos), suma((m) => m.cifras.total)),
      codigos: razon(suma((m) => m.codigos.aciertos), suma((m) => m.codigos.total)),
      insercionPorNota: razon(suma((m) => m.inserciones.length), ok.length),
      notasConInsercion: razon(ok.filter((m) => m.inserciones.length > 0).length, ok.length),
      wer: razon(suma((m) => m.wer), ok.length),
    };
  }).sort((a, b) => a.modelo.localeCompare(b.modelo) || Number(a.conPistas) - Number(b.conPistas));
}

/**
 * La regla para adoptar las pistas en un modelo (spec §4.6): nombres y códigos no bajan, al menos uno sube, la inserción
 * falsa no sube y no hay más fallos. Pura.
 */
export function veredicto(sin: Agregado, con: Agregado): { adoptar: boolean; motivo: string } {
  const n = (v: number | null) => v ?? 0;
  if (con.fallos > sin.fallos) return { adoptar: false, motivo: `más fallos con pistas (${con.fallos} contra ${sin.fallos})` };
  if (n(con.insercionPorNota) > n(sin.insercionPorNota)) return { adoptar: false, motivo: 'sube la inserción falsa' };
  if (n(con.nombres) < n(sin.nombres) || n(con.codigos) < n(sin.codigos)) return { adoptar: false, motivo: 'bajan nombres o códigos' };
  if (n(con.nombres) === n(sin.nombres) && n(con.codigos) === n(sin.codigos)) return { adoptar: false, motivo: 'no mejoran ni nombres ni códigos' };
  return { adoptar: true, motivo: 'mejoran nombres o códigos sin subir la inserción falsa' };
}

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)} %`);
const num = (v: number | null) => (v === null ? '—' : v.toFixed(2));

/** La tabla en texto, una fila por modelo y con o sin pistas, más el veredicto por modelo. Pura. */
export function tabla(agregados: Agregado[]): string {
  const filas = [
    ['modelo', 'pistas', 'intentos', 'fallos', 'nombres', 'cifras', 'códigos', 'inserción/nota', 'notas con inserción', 'WER'],
    ...agregados.map((a) => [a.modelo, a.conPistas ? 'con' : 'sin', String(a.intentos), String(a.fallos), pct(a.nombres), pct(a.cifras),
      pct(a.codigos), num(a.insercionPorNota), pct(a.notasConInsercion), pct(a.wer)]),
  ];
  const anchos = filas[0].map((_, j) => Math.max(...filas.map((f) => f[j].length)));
  const lineas = filas.map((f) => f.map((c, j) => c.padEnd(anchos[j])).join('  ').trimEnd());
  lineas.splice(1, 0, anchos.map((w) => '-'.repeat(w)).join('  '));
  const modelos = [...new Set(agregados.map((a) => a.modelo))];
  for (const m of modelos) {
    const sin = agregados.find((a) => a.modelo === m && !a.conPistas);
    const con = agregados.find((a) => a.modelo === m && a.conPistas);
    if (sin && con) {
      const v = veredicto(sin, con);
      lineas.push(`${m}: ${v.adoptar ? 'ADOPTAR pistas' : 'NO adoptar pistas'} (${v.motivo})`);
    }
  }
  return lineas.join('\n');
}
