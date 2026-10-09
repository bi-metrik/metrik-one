// ============================================================
// Núcleo conversacional — la extracción de una carga (bandeja de solicitudes)
// ------------------------------------------------------------
// El modelo INTERPRETA y CLASIFICA; el código solo protege invariantes (Mauricio, 2026-10-07, sobre «4 o 5
// estrellas»: «el modelo tiene que tener la capacidad de entender de qué estoy hablando y clasificarlo. No puede ser
// tan paramétrico»). Aquí no hay listas de palabras ni regex sobre lo que escribió el comercial:
//   · `instruccionesCarga`: el prompt. El modelo conoce los campos con sus opciones, la fecha de hoy, lo que el viaje
//     ya tiene y lo propuesto sin confirmar; elige una opción solo si lo dicho corresponde a ella (una preferencia sin
//     cifra, «económico», no es un rango: va al texto), no llena por inferencia lo que nadie dijo (el tipo de viaje por
//     el destino), calcula lo que se puede calcular (regreso = salida + noches, el grupo por categorías) y dice cómo.
//     «No tiene / no dieron el dato / está abierto» es un dato: va a la opción de «aún no está definido» del campo si
//     la config la tiene (`no_definido`, «solo si lo dicen», o su etiqueta), también como corrección de un valor que
//     ya estaba (Mauricio, 2026-10-08, sobre #1074: «no nos dieron un número» → «Aún no tiene presupuesto definido»).
//     Sin esa opción, o con «eso no», devuelve `QUITAR` (tercera falla en vivo, 2026-10-07: «el presupuesto está
//     abierto» no tenía cómo decirse y el «menos de 3 millones» se quedó en el viaje).
//   · `esquemaCarga`: la salida estructurada. Las opciones de un campo cerrado son vocabulario cerrado (más `QUITAR`).
//   · `validarCarga`: lo único que decide el código, y no lee significado:
//       - el campo lo puede llenar el entendimiento (config: no `lo_llena: agencia`, no derivado);
//       - la frase que lo sostiene está escrita en un mensaje que el MODELO clasificó como del viaje;
//       - el valor cabe en su campo: entero ≥ 0, fecha real entre hoy y 18 meses, una de las opciones, texto acotado;
//       - el regreso no queda antes de la salida; un campo cuyo `pedir_si` no se cumple no se llena;
//       - `QUITAR` solo sobre un campo que tiene valor (en el viaje o en lo propuesto) y con su frase escrita.
// Lo demás lo ve el comercial en el resumen de la propuesta, y nada se escribe sin su toque.
// La extracción del flujo viejo de la bandeja (`wa-entendimiento-reglas.ts`, `wa-guardianes.ts`) no se toca.
// ============================================================

import { cumplePedirSi, parsearNumeroColombiano } from '../../niveles-solicitud.ts';
import {
  CLASES_MENSAJE, POR_DEFINIR, camposEntendibles, historiaDeCitas, normalizarTexto,
} from '../../wa-entendimiento-reglas.ts';
import type { CampoEntendible, ClaseMensaje, Sugerido } from '../../wa-entendimiento-reglas.ts';

/** El valor con que el modelo dice «este dato se quita» («eso no», o «abierto» en un campo sin opción de no definido). */
export const QUITAR = 'quitar';
/** Cómo salió un valor: escrito tal cual, calculado con lo dicho o deducido de una descripción. Lo declara el modelo. */
export const COMO = ['escrito', 'calculado', 'deducido'] as const;
export type Como = (typeof COMO)[number];

/** Un sugerido del núcleo: además de la frase, cómo salió (el resumen marca lo calculado o deducido). */
export type SugeridoAgente = Sugerido & { como?: Exclude<Como, 'escrito'> };

/** Un dato que el comercial pidió quitar: la frase que lo dice y, si el modelo la dio, la razón corta. */
export interface Quitado { frase: string; razon?: string }

/** Lo más lejos que se acepta una fecha de viaje, en meses desde hoy (la misma ventana del flujo viejo). */
export const MESES_MAXIMOS = 18;
/** El largo máximo de un valor de texto y de la explicación de un cálculo. */
export const MAX_TEXTO = 600;
const MAX_CALCULO = 160;

const SLUG_SALIDA = 'fecha_salida';
const SLUG_REGRESO = 'fecha_regreso';

const vacio = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

function opcionesDe(f: CampoEntendible): string[] {
  return (f.opciones ?? []).map((o) => String(o.value)).filter((v) => v !== '');
}

function formatoDe(f: CampoEntendible): string {
  if (f.tipo === 'numero') return 'un número entero con dígitos';
  if (f.tipo === 'fecha') return 'una fecha AAAA-MM-DD';
  const op = f.opciones ?? [];
  if (op.length) return `UNA de estas opciones (escribe el valor): ${op.map((o) => `${o.value} = ${o.label ?? o.value}${o.no_definido ? ' (solo si lo dicen)' : ''}`).join('; ')}`;
  return 'texto';
}

/** Las instrucciones para el modelo de extracción. Los campos, sus opciones y lo que ya se sabe salen de la config y del viaje. */
export function instruccionesCarga(
  fields: ReadonlyArray<CampoEntendible>,
  hoyISO: string,
  yaTiene: Record<string, unknown> = {},
  propuesto: Record<string, unknown> = {},
): string {
  const campos = camposEntendibles(fields);
  const deTexto = campos.filter((f) => f.tipo === 'texto' && !opcionesDe(f).length).map((f) => f.slug);
  const sabidos = campos.filter((f) => !vacio(yaTiene[f.slug])).map((f) => `- ${f.slug}: ${String(yaTiene[f.slug])}`);
  const enEspera = campos.filter((f) => !vacio(propuesto[f.slug])).map((f) => `- ${f.slug}: ${String(propuesto[f.slug])}`);
  const alTexto = deTexto.length ? ` (${deTexto.join(', ')})` : '';
  return [
    'Eres el asistente de una agencia de viajes. Te paso lo que un comercial escribió (o reenvió del cliente) sobre UN viaje.',
    'Tu trabajo es entender qué piden y anotarlo en los campos del viaje. Tú interpretas y clasificas con tu criterio;',
    'el sistema solo revisa que cada valor quepa en su campo y que esté sostenido por algo escrito. El comercial ve todo',
    'lo que propongas antes de que se guarde.',
    '',
    `Hoy es ${hoyISO} (Bogotá).`,
    ...(sabidos.length ? ['', 'Lo que el viaje YA tiene:', ...sabidos] : ['', 'El viaje todavía no tiene datos.']),
    ...(enEspera.length ? ['', 'Lo que ya le propusiste al comercial y todavía no confirma:', ...enEspera] : []),
    '',
    'Devuelve:',
    '1. mensajes: para CADA mensaje { n, clase }: cliente = habla del viaje (lo pide el cliente o lo cuenta el comercial);',
    '   comercial = una opinión del comercial sobre el cliente o la venta; tercero = una promoción de otra agencia, un pago,',
    '   un proveedor; ruido = saludos y lo que no es del viaje. Solo los mensajes «cliente» sostienen valores.',
    '2. citas: hasta 8 frases copiadas tal cual que cuenten lo que quieren.',
    '3. valores: para CADA campo { valor, frase, como, calculo }.',
    '   - valor: el dato en el formato del campo, solo si lo dijeron o se calcula con lo dicho. Si no, "' + POR_DEFINIR + '".',
    '   - frase: las palabras EXACTAS de un mensaje de donde sale el valor (también si lo calculaste).',
    '   - como: escrito = lo dijeron tal cual; calculado = sale de una cuenta con datos dichos (salida + noches, el total',
    '     menos los niños); deducido = lo entendiste de una descripción («él con su esposa» = 2 adultos).',
    '   - calculo: si es calculado o deducido, cómo, en pocas palabras («salida 2026-11-11 + 5 noches», «él, su esposa y',
    '     su hijo de 1 año»). Si está escrito tal cual, vacío.',
    '   - Un campo de opciones guarda UNA opción, y solo si lo dicho corresponde a ella. Una preferencia sin el dato que la',
    '     opción pide no es una opción: «económico», «algo bueno», «no muy caro» no son un rango de presupuesto. Ahí el',
    `     campo queda en "${POR_DEFINIR}" y la preferencia va, con sus palabras, al campo de texto que corresponda${alTexto}.`,
    '     Si nombran dos opciones («3 o 4 estrellas»), elige una de las dos y anota las dos en el texto.',
    '   - La opción de «aún no está definido» (la marcada «solo si lo dicen», o la que su etiqueta dice que no hay dato',
    '     todavía) es un dato: úsala cuando digan explícitamente que el cliente no lo tiene, no lo dio o está abierto («no',
    '     nos dieron un número», «el presupuesto está abierto, propongamos nosotros»). Una preferencia sola («económico»),',
    `     sin decir nada del dato, no es eso: queda en "${POR_DEFINIR}" y se pregunta. Si hay preferencia, va también al texto.`,
    '   - No llenes un campo por inferencia de algo que nadie dijo: el tipo de viaje no sale del destino, ni que las fechas',
    '     sean fijas de que haya una fecha. Calcular con lo dicho sí (el regreso, el grupo); suponer una preferencia, no.',
    `   - El campo de texto${alTexto} se escribe completo: lo que ya tiene más lo nuevo.`,
    '   - Si lo dicho ya está en el viaje o en lo propuesto, aunque lo digan con otras palabras («8, 10 años y 11 meses»',
    '     frente a «8, 10, 11 meses»), devuelve el valor EXACTO que ya está. Solo cambia un valor si lo dicho es distinto.',
    '   - Si el comercial corrige un dato que el viaje ya tiene o que propusiste a abierto o sin definir y el campo tiene la',
    '     opción de «aún no está definido», devuelve esa opción: reemplaza el valor. Si no la tiene, o la corrección es «eso',
    `     no» («no, eso no lo dijeron»), devuelve "${QUITAR}" con la frase de la corrección y, en calculo, la razón corta`,
    '     («dijeron que eso no»). Si además queda un matiz, va al campo de texto.',
    '   - Fechas: si no dicen el año, es la próxima vez que ocurre desde hoy. Calcula lo que se puede calcular con lo dicho y',
    '     con lo que el viaje ya tiene (con la salida y las noches sale el regreso). Un mes o una semana sin día no es una fecha.',
    '   - Pasajeros: entiende el grupo como lo describen. Infante es menor de 2 años. Si la descripción deja claro quiénes',
    '     viajan, pon 0 en la categoría donde no hay nadie; si no queda claro, "' + POR_DEFINIR + '". Un total sin desglose',
    '     («somos 4 con los niños») no se reparte.',
    '   - Si se corrigen («2… mejor 3»), vale lo último. Si un dato del viaje cambia, devuelve el nuevo con su frase.',
    '   - No inventes: lo que nadie dijo ni se puede calcular queda en "' + POR_DEFINIR + '".',
    '4. dudas: cuando lo dicho para un campo no es claro (una preferencia sin cifra, dos lecturas posibles), además de',
    `   dejarlo en "${POR_DEFINIR}", pregúntalo: { campo, pregunta, opciones }. La pregunta es corta y para el comercial,`,
    '   con sus palabras entre comillas («"Económico": ¿lo dejo como nota o es un rango?»); opciones, 2 a 4 respuestas',
    '   concretas («Menos de $3 millones», «Entre $3 y $5 millones», «Solo como nota»). Sin dudas, lista vacía. No',
    '   preguntes lo que nadie mencionó: eso lo pide el sistema aparte.',
    '',
    'Campos:',
    ...campos.map((f) => `- ${f.slug}: ${f.label ?? f.slug}${f.ayuda ? ` — ${f.ayuda}` : ''}. Formato: ${formatoDe(f)}.`),
  ].join('\n');
}

/** El `responseSchema` de la extracción, generado de la config. */
export function esquemaCarga(fields: ReadonlyArray<CampoEntendible>): Record<string, unknown> {
  const campos = camposEntendibles(fields);
  const properties: Record<string, unknown> = {};
  for (const f of campos) {
    const op = opcionesDe(f);
    properties[f.slug] = {
      type: 'object',
      properties: {
        valor: op.length ? { type: 'string', enum: [...op, POR_DEFINIR, QUITAR] } : { type: 'string' },
        frase: { type: 'string' },
        como: { type: 'string', enum: [...COMO] },
        calculo: { type: 'string' },
      },
      required: ['valor', 'frase'],
    };
  }
  return {
    type: 'object',
    properties: {
      mensajes: {
        type: 'array',
        items: { type: 'object', properties: { n: { type: 'integer' }, clase: { type: 'string', enum: [...CLASES_MENSAJE] } }, required: ['n', 'clase'] },
      },
      citas: { type: 'array', items: { type: 'string' } },
      valores: { type: 'object', properties, required: campos.map((f) => f.slug) },
      dudas: {
        type: 'array',
        items: {
          type: 'object',
          properties: { campo: { type: 'string', enum: campos.map((f) => f.slug) }, pregunta: { type: 'string' }, opciones: { type: 'array', items: { type: 'string' } } },
          required: ['campo', 'pregunta'],
        },
      },
    },
    required: ['mensajes', 'valores'],
  };
}

export interface CargaValidada {
  sugeridos: Record<string, SugeridoAgente>;
  /** Los campos que el comercial pidió quitar y que tienen valor (en el viaje o en lo propuesto). */
  quitar: Record<string, Quitado>;
  /** Lo que el modelo no entendió claro y le pregunta al comercial; primero lo que pide el mínimo para cotizar. */
  dudas: Duda[];
  descartados: Array<{ slug: string; motivo: string }>;
  historia: string;
}

/** Una duda de la extracción: el campo, la pregunta y respuestas concretas. Se pregunta; no bloquea lo demás. */
export interface Duda { campo: string; pregunta: string; opciones: string[] }

const MAX_PREGUNTA = 160;
const MAX_OPCION = 50;
const MAX_OPCIONES = 4;

/**
 * Las dudas que devolvió el modelo, acotadas: de un campo que existe, con pregunta, a lo más 4 opciones cortas. El orden
 * lo pone la config (el mínimo para cotizar primero) y, dentro de eso, el del modelo. No lee el texto. Pura.
 */
function dudasDe(raw: unknown, campos: ReadonlyArray<CampoEntendible>): Duda[] {
  if (!Array.isArray(raw)) return [];
  const nivel = new Map(campos.map((f) => [f.slug, f.nivel === 'minimo' ? 0 : 1]));
  const out: Duda[] = [];
  for (const x of raw as Array<{ campo?: unknown; pregunta?: unknown; opciones?: unknown }>) {
    const campo = typeof x?.campo === 'string' ? x.campo : '';
    const pregunta = typeof x?.pregunta === 'string' ? x.pregunta.replace(/\s+/g, ' ').trim() : '';
    if (!nivel.has(campo) || !pregunta || pregunta.length > MAX_PREGUNTA || out.some((d) => d.campo === campo)) continue;
    const opciones = (Array.isArray(x.opciones) ? x.opciones : [])
      .filter((o): o is string => typeof o === 'string' && !!o.trim() && o.trim().length <= MAX_OPCION)
      .map((o) => o.trim()).slice(0, MAX_OPCIONES);
    out.push({ campo, pregunta, opciones });
  }
  return out.map((d, i) => ({ d, i })).sort((a, b) => nivel.get(a.d.campo)! - nivel.get(b.d.campo)! || a.i - b.i).map((x) => x.d);
}

/** La duda como una línea del mensaje: «"Económico": ¿lo dejo como nota o es un rango? (A / B / C)». Pura. */
export function lineaDuda(d: Duda): string {
  return `${d.pregunta}${d.opciones.length ? ` (${d.opciones.join(' / ')})` : ''}`;
}

function fechaReal(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function masMeses(iso: string, meses: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d.toISOString().slice(0, 10);
}

/** Los textos que el modelo clasificó como del viaje. Sin clasificación (salida vieja o incompleta), todos. */
function textosDelViaje(raw: Record<string, unknown>, textos: ReadonlyArray<string>): string[] {
  const clases = new Map<number, ClaseMensaje>();
  if (Array.isArray(raw.mensajes)) {
    for (const x of raw.mensajes as Array<{ n?: unknown; clase?: unknown }>) {
      if (Number.isInteger(Number(x?.n)) && (CLASES_MENSAJE as readonly string[]).includes(String(x?.clase))) clases.set(Number(x.n), x.clase as ClaseMensaje);
    }
  }
  return textos.filter((_, i) => (clases.get(i + 1) ?? 'cliente') === 'cliente');
}

/**
 * Lo que el modelo devolvió, contra las invariantes. No interpreta el texto: no decide qué opción se nombró, ni si un
 * 0 está bien dicho, ni deriva fechas; eso es del modelo y lo ve el comercial en el resumen. Pura.
 */
export function validarCarga(
  raw: unknown,
  fields: ReadonlyArray<CampoEntendible>,
  textos: ReadonlyArray<string>,
  opts: { hoyISO: string; yaTiene?: Record<string, unknown> },
): CargaValidada {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const valores = (r.valores && typeof r.valores === 'object' ? r.valores : {}) as Record<string, unknown>;
  const fuente = textosDelViaje(r, textos);
  const enFuente = fuente.map(normalizarTexto);
  const campos = camposEntendibles(fields);
  const out: CargaValidada = { sugeridos: {}, quitar: {}, dudas: dudasDe(r.dudas, campos), descartados: [], historia: historiaDeCitas(r.citas, fuente.join('\n---\n')) };
  const descartar = (slug: string, motivo: string) => out.descartados.push({ slug, motivo });
  const tope = masMeses(opts.hoyISO, MESES_MAXIMOS);
  const enDuda = new Set(out.dudas.map((d) => d.campo));

  for (const f of campos) {
    const item = valores[f.slug] as { valor?: unknown; frase?: unknown; como?: unknown; calculo?: unknown } | undefined;
    if (item?.valor === undefined || item.valor === null) continue;
    const v = String(item.valor).trim();
    if (!v || normalizarTexto(v) === POR_DEFINIR || normalizarTexto(v) === 'por definir') continue;
    // Si el mismo modelo lo pregunta, no lo da por sabido: lo ambiguo no se llena.
    if (enDuda.has(f.slug)) { descartar(f.slug, 'el modelo tiene una duda sobre este campo'); continue; }
    const frase = typeof item.frase === 'string' ? item.frase.trim() : '';
    const nf = normalizarTexto(frase);
    if (!nf || !enFuente.some((t) => t.includes(nf))) {
      descartar(f.slug, 'sin una frase escrita del viaje que lo sostenga');
      continue;
    }
    const calculo = typeof item.calculo === 'string' && item.calculo.trim() ? item.calculo.trim().slice(0, MAX_CALCULO) : undefined;
    if (normalizarTexto(v) === QUITAR) {
      // Quitar es una acción explícita: solo sobre un campo que tiene algo que quitar.
      if (vacio(opts.yaTiene?.[f.slug])) { descartar(f.slug, 'quitar un campo que está vacío'); continue; }
      out.quitar[f.slug] = { frase, ...(calculo ? { razon: calculo } : {}) };
      continue;
    }
    // Lo que no está escrito tal cual se marca en el resumen: si el modelo explica un cálculo y no dice cómo, deducido.
    const como: SugeridoAgente['como'] = item.como === 'calculado' || item.como === 'deducido' ? item.como : calculo ? 'deducido' : undefined;
    const s = (valor: string | number): SugeridoAgente => ({ valor, frase, ...(calculo ? { deduccion: calculo } : {}), ...(como ? { como } : {}) });

    if (f.tipo === 'numero') {
      const n = parsearNumeroColombiano(v);
      if (n === null || !Number.isInteger(n) || n < 0) { descartar(f.slug, `no es un número entero: ${v}`); continue; }
      out.sugeridos[f.slug] = s(n);
    } else if (f.tipo === 'fecha') {
      if (!fechaReal(v)) { descartar(f.slug, `no es una fecha AAAA-MM-DD: ${v}`); continue; }
      if (v < opts.hoyISO) { descartar(f.slug, `fecha pasada: ${v}`); continue; }
      if (v > tope) { descartar(f.slug, `a más de ${MESES_MAXIMOS} meses: ${v}`); continue; }
      out.sugeridos[f.slug] = s(v);
    } else if (opcionesDe(f).length) {
      if (!opcionesDe(f).includes(v)) { descartar(f.slug, `fuera de las opciones: ${v}`); continue; }
      out.sugeridos[f.slug] = s(v);
    } else {
      if (v.length > MAX_TEXTO) { descartar(f.slug, `texto de más de ${MAX_TEXTO} caracteres`); continue; }
      out.sugeridos[f.slug] = s(v);
    }
  }

  // El regreso no queda antes de la salida (la de ahora o la que el viaje ya tiene).
  const salida = out.sugeridos[SLUG_SALIDA]?.valor ?? opts.yaTiene?.[SLUG_SALIDA];
  const regreso = out.sugeridos[SLUG_REGRESO];
  if (regreso && typeof salida === 'string' && fechaReal(salida) && String(regreso.valor) < salida) {
    delete out.sugeridos[SLUG_REGRESO];
    descartar(SLUG_REGRESO, `el regreso (${regreso.valor}) queda antes de la salida (${salida})`);
  }

  // Un campo cuyo `pedir_si` (config) no se cumple con lo que quedaría no se llena: el permiso de los menores no va en
  // un viaje sin menores.
  const quedaria: Record<string, unknown> = { ...(opts.yaTiene ?? {}) };
  for (const k of Object.keys(out.quitar)) delete quedaria[k];
  for (const [k, x] of Object.entries(out.sugeridos)) quedaria[k] = x.valor;
  for (const f of campos) {
    if (out.sugeridos[f.slug] && f.pedir_si !== undefined && f.pedir_si !== null && !cumplePedirSi(f.pedir_si, quedaria)) {
      delete out.sugeridos[f.slug];
      descartar(f.slug, 'no aplica a este viaje (su condición en la config no se cumple)');
    }
  }
  return out;
}
