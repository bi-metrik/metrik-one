// ============================================================
// Paso de entendimiento de la bandeja de WhatsApp — las reglas, sin I/O
// ------------------------------------------------------------
// Diseño: proyectos/trappvel/clarity/docs/diseno/motor-solicitud-viaje.md §3 (paso 2) y §4.
// Encargo: brief-max-2026-09-28-solicitud-configurable.md, PR 2.
//
// Toma una entrega de la bandeja ya respondida («¿De qué cliente es?») y la vuelve una
// solicitud: historia, valores sugeridos con la frase que los sostiene, y huecos. Aquí vive lo
// que se DECIDE; `wa-entendimiento.ts` lo ejecuta. Mismo motivo que `wa-bandeja-reglas.ts`:
// lo que importa `Deno.env` al cargarse no se puede colectar desde vitest.
//
// Tres reglas que no se negocian:
//   1. El esquema de salida del modelo SALE DE LA CONFIG de campos de la línea. Un campo nuevo
//      en la config se pide sin tocar código.
//   2. «Por definir» cuando no se mencionó, nunca «no». Un valor sin una frase del mensaje que
//      lo sostenga se descarta: el modelo no inventa.
//   3. Nunca se pisa un valor que escribió una persona, y nunca se une a un contacto por
//      parecido de nombre: ante 0 o varios candidatos, se pregunta.
//
// Guardianes deterministas (2026-10-01, simulación del chat de Punta Cana). El prompt pide lo
// mismo, pero `validarSalida` no le cree al modelo:
//   · Un mes o una ventana no es una fecha: un valor de fecha cuya frase no nombra ese día se
//     descarta («diciembre» no da 1-dic ni 31-dic).
//   · Una opción marcada `no_definido` en la config («Aún no tiene presupuesto definido», «Sin
//     preferencia») solo vale si la frase la DECLARA: preguntar el precio no es declararlo.
//   · `deducirCeros`: con las edades de todos los niños y ninguno menor de 2 años, infantes
//     queda en 0 como sugerido, con la deducción anotada en la marca.
// ============================================================

import { calcularNiveles, cumplePedirSi, leerPedirSi, parsearNumeroColombiano, type CampoConNivel, type Faltante } from './niveles-solicitud.ts';

export const POR_DEFINIR = 'por_definir';

/** Tipos de campo que el modelo puede llenar. El resto no captura un dato del cliente. */
const TIPOS_ENTENDIBLES = new Set(['texto', 'numero', 'fecha', 'select', 'radio']);

/**
 * Una opción de un `select`/`radio`. `no_definido: true` la marca como «el cliente todavía no lo
 * define» («Aún no tiene presupuesto definido», «Sin preferencia»): solo se sugiere si el cliente
 * lo DICE. Es dato de la config, no una lista de valores en el código.
 */
export interface OpcionCampo {
  value: string;
  label?: string;
  no_definido?: boolean;
}

export interface CampoEntendible extends CampoConNivel {
  ayuda?: string;
  opciones?: OpcionCampo[];
  suma_de?: string[];
  /**
   * Quién escribe el campo. `"agencia"` = lo produce la agencia para la cotización (la
   * presentación del destino, el formato, la complejidad): el entendimiento no lo llena nunca,
   * diga lo que diga el mensaje. Ausente = lo dice el cliente. Es dato de la config, no una
   * lista de slugs en el código (2026-10-01, QA de #969: el modelo redactó un párrafo turístico
   * en `presentacion_destino`).
   */
  lo_llena?: unknown;
}

/** Valor de `lo_llena` que saca un campo del entendimiento. */
export const LO_LLENA_AGENCIA = 'agencia';

/**
 * Los campos que el modelo puede llenar: los que capturan un dato del cliente y no son
 * derivados ni los escribe la agencia.
 */
export function camposEntendibles(fields: ReadonlyArray<CampoEntendible>): CampoEntendible[] {
  return fields.filter(f =>
    typeof f.slug === 'string'
    && !f.slug.startsWith('_')
    && TIPOS_ENTENDIBLES.has(f.tipo)
    && f.lo_llena !== LO_LLENA_AGENCIA
    && !(Array.isArray(f.suma_de) && f.suma_de.length > 0));
}

function valoresDeOpciones(f: CampoEntendible): string[] {
  return (f.opciones ?? []).map(o => String(o.value)).filter(v => v !== '');
}

/**
 * El `responseSchema` de Gemini, generado de la config. Cada campo es un objeto
 * `{ valor, frase }`; donde el campo tiene `opciones`, `valor` es vocabulario cerrado con
 * «por_definir» incluido.
 */
export function esquemaDeSalida(fields: ReadonlyArray<CampoEntendible>): Record<string, unknown> {
  const campos = camposEntendibles(fields);
  const properties: Record<string, unknown> = {};
  for (const f of campos) {
    const opciones = valoresDeOpciones(f);
    properties[f.slug] = {
      type: 'object',
      properties: {
        valor: opciones.length > 0
          ? { type: 'string', enum: [...opciones, POR_DEFINIR] }
          : { type: 'string' },
        frase: { type: 'string' },
      },
      required: ['valor', 'frase'],
    };
  }
  return {
    type: 'object',
    properties: {
      historia: { type: 'string' },
      cliente: {
        type: 'object',
        properties: { nombre: { type: 'string' }, telefono: { type: 'string' } },
      },
      valores: { type: 'object', properties, required: campos.map(f => f.slug) },
    },
    required: ['historia', 'valores'],
  };
}

function formatoDe(f: CampoEntendible): string {
  if (f.tipo === 'numero') return 'un número entero escrito con dígitos';
  if (f.tipo === 'fecha') return 'una fecha AAAA-MM-DD, solo si el mensaje nombra el día';
  const op = f.opciones ?? [];
  if (op.length > 0) {
    return `una de: ${op.map(o => `${o.value} (${o.label ?? o.value}${o.no_definido ? '; solo si el cliente lo dice' : ''})`).join(', ')}`;
  }
  return 'texto corto';
}

/** Las instrucciones para el modelo. La lista de campos también sale de la config. */
export function instruccionesEntendimiento(
  fields: ReadonlyArray<CampoEntendible>,
  hoyISO: string,
  /**
   * Lo que el negocio YA tiene, cuando la entrega se carga en uno existente. El modelo lo ve
   * para saber qué se sabe y qué falta; la decisión de no pisarlo es de `cargarEnExistente`.
   */
  conocidos?: Record<string, unknown>,
): string {
  const campos = camposEntendibles(fields);
  const lineas = campos.map(f => {
    const ayuda = f.ayuda ? ` — ${f.ayuda}` : '';
    return `- ${f.slug}: ${f.label ?? f.slug}${ayuda}. Formato: ${formatoDe(f)}.`;
  });
  const sabidos = conocidos
    ? campos.filter(f => !vacio(conocidos[f.slug])).map(f => `- ${f.slug}: ${String(conocidos[f.slug])}`)
    : [];
  const bloqueSabidos = sabidos.length === 0 ? [] : [
    '',
    'Este viaje YA existe. Lo que ya se sabe de conversaciones anteriores:',
    ...sabidos,
    'Estos mensajes son una conversación nueva con el mismo cliente:',
    '   - Si el mensaje repite lo que ya se sabe, devuelve el mismo valor con su frase.',
    '   - Si el mensaje dice OTRA cosa, devuelve lo que dice el mensaje con su frase: una persona decidirá.',
    `   - Si el mensaje no lo menciona, valor = "${POR_DEFINIR}": no copies lo que ya se sabe.`,
    '   - La historia cuenta solo lo nuevo de estos mensajes.',
  ];
  return [
    'Eres el asistente de una agencia. Un comercial te reenvió por WhatsApp lo que habló con un cliente',
    '(textos, transcripciones de notas de voz). Tu trabajo es entender la solicitud, no inventarla.',
    '',
    `Hoy es ${hoyISO} (Bogotá). Si una fecha no dice el año, es la próxima vez que ocurra desde hoy.`,
    '',
    'Devuelve:',
    '1. historia: dos o tres párrafos en prosa, en lenguaje de persona, contando lo que el cliente quiere.',
    '   Solo lo que está en los mensajes. Sin juicios sobre el cliente (su carácter, su trato, su bolsillo).',
    '2. cliente: nombre y teléfono del cliente si los mensajes los dicen; si no, déjalos vacíos.',
    '3. valores: para CADA campo de la lista, { valor, frase }.',
    `   - Si el mensaje no lo dice, valor = "${POR_DEFINIR}" y frase vacía. Nunca pongas "no" ni "0" por algo que no se dijo.`,
    '   - frase = las palabras EXACTAS del mensaje que sostienen el valor, copiadas tal cual.',
    '   - Si el cliente se corrige dentro de los mensajes («somos 2… ah no, 3»), devuelve lo ÚLTIMO que dijo, con esa frase.',
    '   - Una fecha solo se llena si el mensaje nombra un día concreto («el 27 de diciembre», «del 15 al 20 de noviembre»).',
    `     Un mes («diciembre»), una semana («la segunda semana de enero»), «en vacaciones» o «puente festivo» son "${POR_DEFINIR}":`,
    '     nunca pongas el primer o el último día del mes. Una duración o un plazo («20 días en mayo», «en 15 días») tampoco es una fecha.',
    '   - Un rango de fechas («del 15 al 20 de noviembre») da la salida y el regreso.',
    '   - Una opción marcada «solo si el cliente lo dice» vale únicamente si el cliente lo declara («no tenemos presupuesto»,',
    `     «el que sea»). Preguntar el precio («¿cuánto sale?») no es declarar presupuesto: es "${POR_DEFINIR}".`,
    '   - «Dos personas» sin más detalle son dos adultos; los niños solo cuentan si el mensaje los nombra.',
    `   - No pongas 0 en niños ni en bebés salvo que el mensaje lo diga («sin niños», «solo adultos»). Si no lo dice, "${POR_DEFINIR}".`,
    '',
    'Campos:',
    ...lineas,
    ...bloqueSabidos,
  ].join('\n');
}

// ── Validar la salida ────────────────────────────────────────────────────────

/** Minúsculas, sin tildes, espacios colapsados. Para buscar la frase dentro del mensaje. */
export function normalizarTexto(t: string): string {
  return (t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[“”«»"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Sugerido {
  valor: string | number;
  frase: string;
  /** Cuando el valor no sale de una frase sino de una deducción pura (`deducirCeros`). */
  deduccion?: string;
}

export interface SalidaEntendida {
  historia: string;
  cliente: { nombre: string | null; telefono: string | null };
  sugeridos: Record<string, Sugerido>;
  descartados: Array<{ slug: string; motivo: string }>;
}

function fechaValida(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// ── Guardián 1: un mes o una ventana no es una fecha ─────────────────────────

/** Los días del mes escritos con letras, como los deja una transcripción de audio. */
const DIAS_EN_LETRAS: Record<string, number> = {
  primero: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiuno: 21, veintiun: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30,
};

/** Los números de día (1 a 31) que la frase nombra, con dígitos o con letras. */
/** Un número seguido de una de estas palabras es una duración o un plazo, no un día. */
const UNIDADES_DE_TIEMPO = new Set(['dia', 'dias', 'noche', 'noches', 'semana', 'semanas', 'mes', 'meses', 'ano', 'anos', 'hora', 'horas']);

/**
 * Los números de día (1 a 31) que la frase nombra, con dígitos o con letras. Un número que
 * mide tiempo no es un día: «20 días en mayo» y «en 15 días» no nombran el 20 ni el 15.
 * «2026» no es el día 20; «15/11» sí da 15.
 */
export function diasNombrados(frase: string): number[] {
  const tokens = normalizarTexto(frase).split(/[^a-z0-9]+/).filter(Boolean);
  const out = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    let n: number | null = null;
    let fin = i;
    if (/^\d{1,2}$/.test(w)) n = Number(w);
    else if (w === 'treinta' && tokens[i + 1] === 'y' && (tokens[i + 2] === 'uno' || tokens[i + 2] === 'un')) { n = 31; fin = i + 2; }
    else if (w in DIAS_EN_LETRAS) n = DIAS_EN_LETRAS[w];
    if (n === null || n < 1 || n > 31) continue;
    if (UNIDADES_DE_TIEMPO.has(tokens[fin + 1] ?? '')) continue;
    out.add(n);
  }
  return [...out];
}

/** Lo más lejos que se acepta una fecha de viaje, en meses desde hoy. */
const MESES_MAXIMOS = 18;

function sumarMeses(iso: string, meses: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d.toISOString().slice(0, 10);
}

/**
 * Una fecha que el modelo propone, contra hoy:
 *   · anterior a hoy y la frase NO dice el año → la próxima vez que ocurre ese día y mes
 *     («salimos el 5 de septiembre» con hoy 1-oct-2026 → 2027-09-05);
 *   · anterior a hoy y la frase dice el año → se descarta (fecha pasada);
 *   · a más de 18 meses → se descarta.
 */
export function fechaDeViaje(v: string, frase: string, hoyISO: string): { valor: string } | { motivo: string } {
  let f = v;
  if (f < hoyISO) {
    if (/(?<!\d)(19|20)\d{2}(?!\d)/.test(frase)) return { motivo: `fecha pasada: ${v}` };
    const mesDia = v.slice(5);
    let candidata = `${hoyISO.slice(0, 4)}-${mesDia}`;
    if (candidata < hoyISO) candidata = `${Number(hoyISO.slice(0, 4)) + 1}-${mesDia}`;
    if (!fechaValida(candidata)) return { motivo: `fecha pasada: ${v}` };
    f = candidata;
  }
  if (f > sumarMeses(hoyISO, MESES_MAXIMOS)) return { motivo: `a más de ${MESES_MAXIMOS} meses: ${f}` };
  return { valor: f };
}

/**
 * ¿La frase nombra el día de esta fecha? «del 15 al 20 de noviembre» nombra el 15 y el 20
 * aunque el mes aparezca una sola vez; «diciembre» no nombra ningún día y «la segunda semana
 * de enero» tampoco. Se exige EL día del valor, no cualquier número: «puente del 12 de
 * octubre» no sostiene un 10-oct.
 */
export function fraseNombraElDia(frase: string, fechaISO: string): boolean {
  return diasNombrados(frase).includes(Number(fechaISO.slice(8, 10)));
}

/**
 * ¿La frase dice este número? Con dígitos («3 adultos») o con letras («seríamos tres»). El
 * cero también se dice con una negación («sin niños», «ningún bebé», «solo adultos»).
 * Lo usa `cargarEnExistente` para CAMBIAR un número que el negocio ya tiene: «hablé con mi
 * esposo» no cambia «3 adultos» a 2 (gemini-2.5-flash-lite lo hizo en la simulación del
 * 2026-10-01).
 */
export function fraseNombraNumero(frase: string, n: number): boolean {
  const t = ` ${normalizarTexto(frase).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if (n === 0 && / (cero|ningun\w*|sin|solo|solamente|no) /.test(t)) return true;
  if (new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(t)) return true;
  if (n === 1 && / (un|una|uno) /.test(t)) return true;
  return Object.entries(DIAS_EN_LETRAS).some(([w, v]) => v === n && w !== 'primero' && t.includes(` ${w} `));
}

// ── Guardián 2: una opción «no definido» solo si el cliente lo dice ───────────

/** Negación o indiferencia: lo que hace falta para DECLARAR que algo no está definido. */
const MARCAS_DE_DECLARACION: RegExp[] = [
  / no /, / sin /, / ni idea /, / cualquier\w* /, / da igual /, / da lo mismo /, / indiferente /,
  / (el|la|lo|los|las) que (sea|sean|haya|halla) /,
  / (el|la|lo|los|las) que (tu |usted |ustedes )?(nos |me )?recomiend\w* /,
];

/**
 * ¿La frase DECLARA que no hay definición o preferencia? Una pregunta nunca la declara
 * («¿cuánto sale?»); una declaración lleva una negación o una indiferencia («no tenemos
 * presupuesto», «el que sea», «lo que nos recomiendes»). Ante la duda, NO: el campo queda
 * vacío y el bot lo pregunta, que sale más barato que dar por definido lo que no está.
 */
export function declaraNoDefinido(frase: string): boolean {
  if (/[?¿]/.test(frase)) return false;
  const t = ` ${normalizarTexto(frase).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  return MARCAS_DE_DECLARACION.some(r => r.test(t));
}

/** Un número con dígitos o con letras: una preferencia concreta («cuatro o cinco estrellas», «unos 3 millones»). */
function nombraAlgunNumero(texto: string): boolean {
  const t = ` ${normalizarTexto(texto).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if (/\d/.test(t)) return true;
  return Object.keys(DIAS_EN_LETRAS).some(w => w !== 'primero' && w !== 'uno' && t.includes(` ${w} `));
}

/**
 * Las palabras propias de cada opción concreta del campo (no las que comparten todas, como
 * «estrellas» o «millones»): si el mensaje nombra una, el cliente dijo algo concreto.
 */
function palabrasDeOpcionesConcretas(f: CampoEntendible): string[] {
  const concretas = (f.opciones ?? []).filter(o => o.no_definido !== true);
  const palabrasDe = (o: OpcionCampo) => new Set(
    normalizarTexto(String(o.label ?? o.value)).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(w => w.length >= 5),
  );
  const conjuntos = concretas.map(palabrasDe);
  const todas = new Set(conjuntos.flatMap(c => [...c]));
  return [...todas].filter(w => !conjuntos.every(c => c.has(w)));
}

/**
 * ¿El mensaje trae una preferencia concreta para este campo? Un número, o una palabra propia
 * de una de sus opciones concretas. «Hotel cuatro o cinco estrellas, lo que tú nos recomiendes»
 * la trae: ahí la indiferencia acompaña a una preferencia y NO declara «sin preferencia».
 * La indiferencia solo cuenta si viene sola (QA de #969, A1 tanda 3).
 */
export function traePreferenciaConcreta(f: CampoEntendible, texto: string): boolean {
  if (nombraAlgunNumero(texto)) return true;
  const t = ` ${normalizarTexto(texto).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  return palabrasDeOpcionesConcretas(f).some(w => t.includes(` ${w} `));
}

/** El mensaje de la entrega que contiene la frase (los mensajes van separados por `---`). */
export function mensajeDeLaFrase(frase: string, textoFuente: string): string {
  const f = normalizarTexto(frase);
  return textoFuente.split(/\n---\n/).find(m => normalizarTexto(m).includes(f)) ?? frase;
}

/** Palabras que no cuentan para decir si un texto sale del mensaje. */
const PALABRAS_VACIAS = new Set([
  'para', 'pero', 'porque', 'como', 'con', 'los', 'las', 'del', 'una', 'uno', 'unos', 'unas', 'que', 'por', 'sus',
  'este', 'esta', 'estos', 'estas', 'muy', 'mas', 'son', 'sin', 'entre', 'desde', 'hasta', 'sobre',
]);

/**
 * ¿Un valor de texto sale de los mensajes? El modelo puede normalizar lo que el cliente
 * escribió («bgta» → BOGOTÁ, «pta cana» → PUNTA CANA), pero no redactar: un valor de más de
 * tres palabras tiene que estar hecho de palabras que aparecen en los mensajes. Así un párrafo
 * turístico inventado (QA de #969, A4: «Madrid, París y Roma son tres de las ciudades más
 * emblemáticas…») no entra aunque traiga una frase real.
 */
export function textoSaleDelMensaje(valor: string, fuente: string): boolean {
  const palabras = normalizarTexto(valor).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(w => w.length >= 3 && !PALABRAS_VACIAS.has(w));
  if (palabras.length <= 3) return true;
  const delMensaje = new Set(normalizarTexto(fuente).replace(/[^a-z0-9 ]/g, ' ').split(' '));
  return palabras.every(w => delMensaje.has(w));
}

// ── Guardián: un 0 en niños o bebés solo si el mensaje cierra quiénes viajan ──

/** Palabras que nombran a un menor. */
const RE_MENOR = /\b(nin[oa]s?|hij[oa]s?|bebes?|menor(es)?|peque\w*|pelad\w*|chiquit\w*|infantes?|nenes?)\b/;

/**
 * ¿La frase cierra que no viajan menores? Solo tres formas:
 *   · una negación pegada al menor: «sin niños», «ningún bebé», «no van los niños»;
 *   · «solo adultos», «solo nosotros»;
 *   · un total que es igual a los adultos y ninguna mención de menores: «somos dos» con 2 adultos.
 * «Somos 4 con los niños», «mi esposo y yo» o «los dos niños» NO cierran nada: el 0 solo sale de
 * aquí o de `deducirCeros` (todas las edades dadas y ninguna menor de 2). QA de #969, C11.
 */
export function fraseCierraMenores(frase: string, adultos: number | null): boolean {
  const t = ` ${normalizarTexto(frase).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if (/ (sin|ningun\w*|cero|no (van|viajan|vienen|llevamos|hay)) (los |las |mis |nuestros |nuestras )?(nin|hij|beb|menor|infant|nene|peque|pelad|chiquit)/.test(t)) return true;
  if (/ solo(mente)? (adultos|nosotros|nosotras|los dos|las dos)\b/.test(t)) return true;
  if (adultos === null || RE_MENOR.test(t)) return false;
  const m = / (somos|seriamos|seremos|vamos|viajamos|viajariamos|iriamos) (\w+)/.exec(t);
  if (!m) return false;
  const n = /^\d+$/.test(m[2]) ? Number(m[2]) : (DIAS_EN_LETRAS[m[2]] ?? null);
  return n !== null && n === adultos;
}

const SLUGS_MENORES = ['ninos', 'infantes'];

/** ¿El `pedir_si` del campo depende de que viajen menores? (lee niños o infantes) */
function dependeDeMenores(f: CampoEntendible): boolean {
  const p = leerPedirSi(f.pedir_si);
  if ('error' in p) return false;
  return p.condiciones.some(c =>
    (typeof c.field === 'string' && SLUGS_MENORES.includes(c.field))
    || (Array.isArray(c.suma_de) && c.suma_de.some(s => SLUGS_MENORES.includes(s))));
}

function textoONull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Lo que el modelo devolvió, filtrado contra la config y contra el mensaje. Un valor sale
 * como sugerido solo si: no es «por definir», cabe en el tipo del campo (y en sus opciones),
 * y trae una frase que de verdad está en los mensajes.
 *
 * @param opts.hoyISO    hoy en Bogotá: una fecha pasada se lleva a la próxima vez que ocurre
 *                       (si la frase no dice el año) o se descarta; a más de 18 meses, se descarta.
 * @param opts.conocidos lo que el negocio ya tiene: el regreso no puede quedar antes de la
 *                       salida, venga la salida en este mensaje o de antes.
 */
export function validarSalida(
  raw: unknown,
  fields: ReadonlyArray<CampoEntendible>,
  textoFuente: string,
  opts: { hoyISO?: string; conocidos?: Record<string, unknown> } = {},
): SalidaEntendida {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cli = (r.cliente && typeof r.cliente === 'object' ? r.cliente : {}) as Record<string, unknown>;
  const valores = (r.valores && typeof r.valores === 'object' ? r.valores : {}) as Record<string, unknown>;
  const fuente = normalizarTexto(textoFuente);

  const out: SalidaEntendida = {
    historia: textoONull(r.historia) ?? '',
    cliente: { nombre: textoONull(cli.nombre), telefono: textoONull(cli.telefono) },
    sugeridos: {},
    descartados: [],
  };

  for (const f of camposEntendibles(fields)) {
    const item = valores[f.slug] as { valor?: unknown; frase?: unknown } | undefined;
    const bruto = item?.valor;
    if (bruto === undefined || bruto === null) continue;
    const v = String(bruto).trim();
    if (v === '' || normalizarTexto(v) === POR_DEFINIR || normalizarTexto(v) === 'por definir') continue;

    const frase = textoONull(item?.frase);
    if (!frase || !fuente.includes(normalizarTexto(frase))) {
      out.descartados.push({ slug: f.slug, motivo: 'sin frase del mensaje que lo sostenga' });
      continue;
    }

    if (f.tipo === 'numero') {
      const n = parsearNumeroColombiano(v);
      if (n === null || !Number.isInteger(n) || n < 0) {
        out.descartados.push({ slug: f.slug, motivo: `no es un número entero: ${v}` });
        continue;
      }
      out.sugeridos[f.slug] = { valor: n, frase };
    } else if (f.tipo === 'fecha') {
      if (!fechaValida(v)) {
        out.descartados.push({ slug: f.slug, motivo: `no es una fecha AAAA-MM-DD: ${v}` });
        continue;
      }
      if (!fraseNombraElDia(frase, v)) {
        out.descartados.push({ slug: f.slug, motivo: `un mes o una ventana no es una fecha: «${frase}» no nombra el día ${Number(v.slice(8, 10))}` });
        continue;
      }
      const ajustada = opts.hoyISO ? fechaDeViaje(v, frase, opts.hoyISO) : { valor: v };
      if ('motivo' in ajustada) {
        out.descartados.push({ slug: f.slug, motivo: ajustada.motivo });
        continue;
      }
      out.sugeridos[f.slug] = { valor: ajustada.valor, frase };
    } else if (valoresDeOpciones(f).length > 0) {
      if (!valoresDeOpciones(f).includes(v)) {
        out.descartados.push({ slug: f.slug, motivo: `fuera de las opciones: ${v}` });
        continue;
      }
      if ((f.opciones ?? []).some(o => String(o.value) === v && o.no_definido === true)) {
        if (!declaraNoDefinido(frase)) {
          out.descartados.push({ slug: f.slug, motivo: `«no definido» sin que el cliente lo diga: «${frase}»` });
          continue;
        }
        // La indiferencia solo cuenta si viene sola: con una preferencia concreta en el mismo
        // mensaje, gana lo concreto (o queda vacío y se pregunta).
        if (traePreferenciaConcreta(f, mensajeDeLaFrase(frase, textoFuente))) {
          out.descartados.push({ slug: f.slug, motivo: `«no definido» junto a una preferencia concreta: «${frase}»` });
          continue;
        }
      }
      out.sugeridos[f.slug] = { valor: v, frase };
    } else {
      if (!textoSaleDelMensaje(v, textoFuente)) {
        out.descartados.push({ slug: f.slug, motivo: `el texto no sale de los mensajes: «${v.slice(0, 60)}»` });
        continue;
      }
      out.sugeridos[f.slug] = { valor: v, frase };
    }
  }

  // Un 0 en niños o bebés solo si la frase cierra quiénes viajan. La deducción determinista
  // (`deducirCeros`, todas las edades dadas) corre después y aparte.
  const adultosN = parsearNumeroColombiano(out.sugeridos.adultos?.valor ?? opts.conocidos?.adultos);
  for (const slug of SLUGS_MENORES) {
    const s = out.sugeridos[slug];
    if (s && Number(s.valor) === 0 && !fraseCierraMenores(s.frase, adultosN)) {
      delete out.sugeridos[slug];
      out.descartados.push({ slug, motivo: `un 0 que la frase no cierra: «${s.frase}»` });
    }
  }

  // Un campo que solo aplica si viajan menores (misma condición `pedir_si` que pinta la barra,
  // la de `edades_menores`) se descarta si no se sabe que viajen: el permiso de salida de los
  // menores no se llena en un viaje sin niños (QA de #969, A4).
  const conocidosYNuevos: Record<string, unknown> = { ...(opts.conocidos ?? {}) };
  for (const [k, s] of Object.entries(out.sugeridos)) conocidosYNuevos[k] = s.valor;
  for (const f of camposEntendibles(fields)) {
    if (!out.sugeridos[f.slug] || !dependeDeMenores(f)) continue;
    if (!cumplePedirSi(f.pedir_si, conocidosYNuevos)) {
      delete out.sugeridos[f.slug];
      out.descartados.push({ slug: f.slug, motivo: 'solo aplica si viajan menores, y no se sabe que viajen' });
    }
  }

  // El regreso no puede quedar antes de la salida (la de este mensaje o la que ya estaba).
  const regreso = out.sugeridos[SLUG_REGRESO];
  const salida = out.sugeridos[SLUG_SALIDA]?.valor ?? opts.conocidos?.[SLUG_SALIDA];
  if (regreso && typeof salida === 'string' && fechaValida(salida) && String(regreso.valor) < salida) {
    delete out.sugeridos[SLUG_REGRESO];
    out.descartados.push({ slug: SLUG_REGRESO, motivo: `el regreso (${regreso.valor}) queda antes de la salida (${salida})` });
  }
  return out;
}

/** La convención del bloque de viaje para las dos fechas. Sin ellas, la comparación no corre. */
const SLUG_SALIDA = 'fecha_salida';
const SLUG_REGRESO = 'fecha_regreso';

// ── Escribir en el bloque sin pisar a una persona ────────────────────────────

/** La marca que deja un valor sugerido en `negocio_bloques.data._sugeridos[slug]`. */
export interface MarcaSugerido {
  fuente: 'whatsapp';
  entrega_id: string;
  frase: string;
  en: string;
  /** El valor no sale de una frase sino de una deducción («Edades 9, 4: …»). */
  deduccion?: string;
  /** Lo que había antes, si este sugerido reemplazó a otro que nadie confirmó. */
  anterior?: string | number | null;
}

/** La marca de un sugerido. `anterior` solo cuando reemplaza a otro sugerido. */
export function marcaDe(s: Sugerido, meta: { entrega_id: string; en: string }, anterior?: unknown): MarcaSugerido {
  const m: MarcaSugerido = { fuente: 'whatsapp', entrega_id: meta.entrega_id, frase: s.frase, en: meta.en };
  if (s.deduccion) m.deduccion = s.deduccion;
  if (anterior !== undefined) m.anterior = typeof anterior === 'number' || typeof anterior === 'string' ? anterior : null;
  return m;
}

export const CLAVE_SUGERIDOS = '_sugeridos';

const vacio = (v: unknown) => v === '' || v === null || v === undefined;

/**
 * Mete los sugeridos en la `data` de un bloque. Solo escribe donde el campo está vacío o
 * todavía tiene su `default` (que no lo escribió nadie) y donde no hay una corrección
 * registrada (`_ediciones`). Cada valor escrito lleva su marca en `_sugeridos`.
 */
export function fusionarSugeridos(
  data: Record<string, unknown>,
  fields: ReadonlyArray<CampoEntendible>,
  sugeridos: Record<string, Sugerido>,
  meta: { entrega_id: string; en: string },
): { data: Record<string, unknown>; escritos: string[]; respetados: string[] } {
  const ediciones = (data._ediciones ?? {}) as Record<string, unknown>;
  const marcas = { ...((data[CLAVE_SUGERIDOS] ?? {}) as Record<string, MarcaSugerido>) };
  const out: Record<string, unknown> = { ...data };
  const escritos: string[] = [];
  const respetados: string[] = [];
  for (const f of fields) {
    const s = sugeridos[f.slug];
    if (!s) continue;
    const actual = data[f.slug];
    const esDefault = f.default !== undefined && actual === f.default;
    if ((!vacio(actual) && !esDefault) || ediciones[f.slug]) {
      respetados.push(f.slug);
      continue;
    }
    out[f.slug] = s.valor;
    marcas[f.slug] = marcaDe(s, meta);
    escritos.push(f.slug);
  }
  if (escritos.length > 0) out[CLAVE_SUGERIDOS] = marcas;
  return { data: out, escritos, respetados };
}

// ── Guardián 3: el mínimo tiene que poder cerrarse ───────────────────────────
//
// Los slugs son la convención del bloque de viaje de ONE (los mismos que `mayusculasDeViaje`
// y la composición de la cotización). Sin los tres en la config, la deducción no corre.

const SLUG_NINOS = 'ninos';
const SLUG_INFANTES = 'infantes';
const SLUG_EDADES = 'edades_menores';
/** Un infante es menor de 2 años («¿Viajan bebés menores de 2 años?»). */
const EDAD_INFANTE = 2;

/**
 * Las edades en años de un texto como «9, 4», «9 AÑOS Y 4 AÑOS» o «9, 6 y 1». `null` si
 * habla de meses («8 meses») o no trae ningún número: ahí no se deduce nada.
 */
export function leerEdades(texto: unknown): number[] | null {
  const t = normalizarTexto(String(texto ?? ''));
  if (!t || /\bmes(es)?\b/.test(t)) return null;
  const edades = [...t.matchAll(/(?<![\d.,])(\d{1,2})(?![\d.,]\d|\d)/g)].map(m => Number(m[1]));
  return edades.length > 0 ? edades : null;
}

/**
 * Lo que se deduce sin el modelo para que el mínimo pueda cerrarse. Una sola regla: si
 * infantes está vacío, hay `n` niños y las edades dadas son exactamente `n`, todas de 2 años o
 * más, infantes = 0. «Somos 4» sin edades no deduce nada; una edad menor de 2, tampoco.
 *
 * @param valores lo que queda en el negocio (lo que ya tenía más lo que llega), por slug.
 * @returns sugeridos con `deduccion` y frase vacía, solo para campos vacíos.
 */
export function deducirCeros(fields: ReadonlyArray<CampoEntendible>, valores: Record<string, unknown>): Record<string, Sugerido> {
  const slugs = new Set(fields.map(f => f.slug));
  if (![SLUG_NINOS, SLUG_INFANTES, SLUG_EDADES].every(s => slugs.has(s))) return {};
  if (!vacio(valores[SLUG_INFANTES])) return {};
  const ninos = parsearNumeroColombiano(valores[SLUG_NINOS]);
  if (ninos === null || !Number.isInteger(ninos) || ninos <= 0) return {};
  const edades = leerEdades(valores[SLUG_EDADES]);
  if (!edades || edades.length !== ninos || edades.some(e => e < EDAD_INFANTE)) return {};
  const quien = ninos === 1 ? 'el niño no es menor' : `ninguno de los ${ninos} niños es menor`;
  return {
    [SLUG_INFANTES]: { valor: 0, frase: '', deduccion: `Edades ${edades.join(', ')}: ${quien} de ${EDAD_INFANTE} años` },
  };
}

/**
 * Para un negocio NUEVO: los sugeridos más lo que `deducirCeros` saca de ellos (con los
 * `default` de la config, como los deja `crearNegocio`). Lo que el modelo ya llenó no se toca.
 */
export function conDeducciones(fields: ReadonlyArray<CampoEntendible>, sugeridos: Record<string, Sugerido>): Record<string, Sugerido> {
  const valores: Record<string, unknown> = {};
  for (const f of fields) if (f.default !== undefined) valores[f.slug] = f.default;
  for (const [k, v] of Object.entries(sugeridos)) valores[k] = v.valor;
  const out = { ...sugeridos };
  for (const [slug, s] of Object.entries(deducirCeros(fields, aplicarSumas(fields, valores)))) if (!(slug in out)) out[slug] = s;
  return out;
}

/**
 * El texto libre del bloque que captura el viaje se guarda en MAYÚSCULA (misma regla que
 * `src/lib/negocios/mayusculas.ts`: bloque con adultos/niños/infantes, campos `texto`, salvo
 * lo que lleve «@»). Si el sugerido entrara en minúscula, el primer guardado de la pantalla lo
 * cambiaría y parecería editado por una persona.
 */
export function mayusculasDeViaje(fields: ReadonlyArray<CampoEntendible>, data: Record<string, unknown>): Record<string, unknown> {
  if (!fields.some(f => ['adultos', 'ninos', 'infantes'].includes(f.slug))) return data;
  const out = { ...data };
  for (const f of fields) {
    const v = out[f.slug];
    if (f.tipo === 'texto' && typeof v === 'string' && !v.includes('@')) out[f.slug] = v.toLocaleUpperCase('es-CO');
  }
  return out;
}

/** `suma_de` recalculado (misma regla que `campo-suma.ts`: sin ninguna fuente, no se toca). */
export function aplicarSumas(fields: ReadonlyArray<CampoEntendible>, valores: Record<string, unknown>): Record<string, unknown> {
  let r = valores;
  for (const f of fields) {
    if (!Array.isArray(f.suma_de) || f.suma_de.length === 0) continue;
    const nums = f.suma_de.map(s => parsearNumeroColombiano(valores[s]));
    if (nums.every(n => n === null)) continue;
    const suma = nums.reduce<number>((a, n) => a + (n ?? 0), 0);
    if (r[f.slug] !== suma) r = { ...r, [f.slug]: suma };
  }
  return r;
}

// ── Lo que se le contesta al comercial ───────────────────────────────────────

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function partesFecha(v: string): { d: number; m: string } | null {
  if (!fechaValida(v)) return null;
  return { d: Number(v.slice(8, 10)), m: MESES[Number(v.slice(5, 7)) - 1] };
}

function singular(label: string, n: number): string {
  const l = label.toLowerCase();
  if (n !== 1) return l;
  return l.endsWith('es') && !l.endsWith('ntes') ? l.slice(0, -2) : l.endsWith('s') ? l.slice(0, -1) : l;
}

/**
 * Una línea con lo entendido, en el orden de la config, con los campos del MÍNIMO que
 * tienen valor: «Punta Cana, 15-20 nov, 2 adultos». Dos fechas seguidas se juntan en un rango.
 */
export function resumenEntendido(fields: ReadonlyArray<CampoEntendible>, valores: Record<string, unknown>): string {
  const partes: string[] = [];
  const campos = fields.filter(f => f.nivel === 'minimo' && !vacio(valores[f.slug]));
  for (let i = 0; i < campos.length; i++) {
    const f = campos[i];
    const v = valores[f.slug];
    if (f.tipo === 'fecha') {
      const a = partesFecha(String(v));
      const sig = campos[i + 1];
      const b = sig?.tipo === 'fecha' ? partesFecha(String(valores[sig.slug])) : null;
      if (a && b) {
        partes.push(a.m === b.m ? `${a.d}-${b.d} ${a.m}` : `${a.d} ${a.m}-${b.d} ${b.m}`);
        i++;
      } else if (a) {
        partes.push(`${a.d} ${a.m}`);
      }
      continue;
    }
    if (f.tipo === 'numero') {
      const n = parsearNumeroColombiano(v);
      if (n && n > 0) partes.push(`${n} ${singular(f.label ?? f.slug, n)}`);
      continue;
    }
    const op = (f.opciones ?? []).find(o => String(o.value) === String(v));
    partes.push(op?.label ?? String(v));
  }
  return partes.join(', ');
}

export const MAX_PREGUNTAS = 3;

/** La respuesta al comercial: lo entendido y, como máximo, tres preguntas del mínimo. */
export function mensajeAlComercial(p: { resumen: string; faltanMinimo: Faltante[]; enlace: string }): string {
  const entendi = p.resumen ? `Entendí: ${p.resumen}.` : 'Recibí la solicitud.';
  if (p.faltanMinimo.length === 0) {
    return `${entendi}\nYa está el mínimo para cotizar: ${p.enlace}`;
  }
  const preguntas = p.faltanMinimo.slice(0, MAX_PREGUNTAS).map((f, i) => `${i + 1}. ${f.pregunta}`);
  return [entendi, 'Para empezar a cotizar me falta:', ...preguntas].join('\n');
}

/** Los huecos, con la misma función que pinta las barras en ONE. */
export function huecos(fields: ReadonlyArray<CampoEntendible>, valores: Record<string, unknown>) {
  return calcularNiveles(fields, valores);
}

// ── El contacto: exacto o se pregunta ────────────────────────────────────────

export interface ContactoCandidato {
  id: string;
  nombre: string | null;
  telefono: string | null;
}

/** Los últimos 10 dígitos: el celular colombiano con o sin indicativo. `null` si hay menos de 7. */
export function digitosTelefono(t: string | null | undefined): string | null {
  const d = String(t ?? '').replace(/\D/g, '');
  if (d.length < 7) return null;
  return d.slice(-10);
}

export function normalizarNombre(n: string | null | undefined): string {
  return normalizarTexto(String(n ?? '')).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Lo que el comercial contestó, sin el teléfono que venga pegado. */
export function nombreDeLaRespuesta(clienteTexto: string | null | undefined): string {
  return String(clienteTexto ?? '').replace(/\+?[\d\s().-]{7,}/g, ' ').replace(/\s+/g, ' ').trim();
}

export type DecisionContacto =
  | { tipo: 'unico'; contacto: ContactoCandidato; por: 'telefono' | 'nombre' }
  | { tipo: 'preguntar'; motivo: 'ninguno' | 'varios'; opciones: ContactoCandidato[]; nombre: string };

export const MAX_OPCIONES_CONTACTO = 5;

/**
 * ¿A qué contacto va el negocio? Solo se une sola si hay UNO por teléfono, o UNO con el
 * nombre idéntico (sin tildes ni mayúsculas). Un parecido nunca une: se ofrece como opción
 * para que el comercial elija.
 *
 * @param candidatos contactos del workspace que la consulta trajo (por teléfono o por
 *                   alguna palabra del nombre). Aquí se decide cuáles cuentan.
 */
export function decidirContacto(p: {
  clienteTexto: string | null;
  extraido: { nombre: string | null; telefono: string | null };
  candidatos: ContactoCandidato[];
}): DecisionContacto {
  const nombre = nombreDeLaRespuesta(p.clienteTexto) || p.extraido.nombre || '';
  const tel = digitosTelefono(p.clienteTexto) ?? digitosTelefono(p.extraido.telefono);

  if (tel) {
    const porTel = p.candidatos.filter(c => digitosTelefono(c.telefono) === tel);
    if (porTel.length === 1) return { tipo: 'unico', contacto: porTel[0], por: 'telefono' };
    if (porTel.length > 1) {
      return { tipo: 'preguntar', motivo: 'varios', opciones: porTel.slice(0, MAX_OPCIONES_CONTACTO), nombre };
    }
  }

  const buscado = normalizarNombre(nombre);
  if (buscado) {
    const exactos = p.candidatos.filter(c => normalizarNombre(c.nombre) === buscado);
    if (exactos.length === 1) return { tipo: 'unico', contacto: exactos[0], por: 'nombre' };
    if (exactos.length > 1) {
      return { tipo: 'preguntar', motivo: 'varios', opciones: exactos.slice(0, MAX_OPCIONES_CONTACTO), nombre };
    }
    const palabras = buscado.split(' ').filter(w => w.length >= 2);
    const parecidos = p.candidatos.filter(c => {
      const suyas = new Set(normalizarNombre(c.nombre).split(' '));
      return palabras.length > 0 && palabras.every(w => suyas.has(w));
    });
    return { tipo: 'preguntar', motivo: 'ninguno', opciones: parecidos.slice(0, MAX_OPCIONES_CONTACTO), nombre };
  }
  return { tipo: 'preguntar', motivo: 'ninguno', opciones: [], nombre };
}

/** Palabras sueltas del nombre para traer candidatos de la base (la decisión es de `decidirContacto`). */
export function palabrasDeBusqueda(clienteTexto: string | null, extraidoNombre: string | null): string[] {
  const n = normalizarNombre(nombreDeLaRespuesta(clienteTexto) || extraidoNombre || '');
  return [...new Set(n.split(' ').filter(w => w.length >= 3))].slice(0, 4);
}

function finTelefono(t: string | null): string {
  const d = digitosTelefono(t);
  return d ? ` (tel. …${d.slice(-4)})` : '';
}

export function textoPreguntaContacto(d: Extract<DecisionContacto, { tipo: 'preguntar' }>): string {
  const quien = d.nombre ? `«${d.nombre}»` : 'el cliente';
  const cab = d.motivo === 'varios'
    ? `Hay ${d.opciones.length} contactos que podrían ser ${quien}. ¿Cuál es?`
    : d.opciones.length > 0
      ? `No encontré a ${quien} tal cual en el directorio. ¿Es alguno de estos?`
      : `No encontré a ${quien} en el directorio.`;
  const lista = d.opciones.map((c, i) => `${i + 1}. ${c.nombre ?? 'Sin nombre'}${finTelefono(c.telefono)}`);
  const pie = d.opciones.length > 0
    ? 'Responde con el número, o escribe NUEVO para crearlo.'
    : 'Escribe NUEVO para crearlo con ese nombre, o mándame el celular del cliente.';
  return [cab, ...lista, pie].join('\n');
}

export type RespuestaContacto =
  | { tipo: 'elegido'; contacto_id: string }
  | { tipo: 'nuevo' }
  | { tipo: 'telefono'; telefono: string }
  | { tipo: 'no_entendida' };

export function interpretarRespuestaContacto(texto: string, opciones: ContactoCandidato[]): RespuestaContacto {
  const t = normalizarTexto(texto);
  const m = /^(\d{1,2})\.?$/.exec(t);
  if (m) {
    const i = Number(m[1]) - 1;
    return i >= 0 && i < opciones.length ? { tipo: 'elegido', contacto_id: opciones[i].id } : { tipo: 'no_entendida' };
  }
  if (t === 'nuevo' || t === 'nueva' || t === 'crear' || t === 'crearlo') return { tipo: 'nuevo' };
  const tel = digitosTelefono(texto);
  if (tel && tel.length >= 10) return { tipo: 'telefono', telefono: tel };
  return { tipo: 'no_entendida' };
}
