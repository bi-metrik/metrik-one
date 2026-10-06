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
  /**
   * Otras formas en que el cliente nombra la opción («mi esposo y yo» para «Pareja»). Una opción
   * solo se carga si la frase la NOMBRA (su etiqueta, su valor o uno de estos): el modelo no la
   * deduce (QA de #971 v2: Cartagena salía «internacional» sin que nadie lo dijera).
   */
  sinonimos?: string[];
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
      // N3: quién habla en cada mensaje. Solo lo del cliente llena campos (`wa-guardianes.ts`).
      mensajes: {
        type: 'array',
        items: {
          type: 'object',
          properties: { n: { type: 'integer' }, clase: { type: 'string', enum: [...CLASES_MENSAJE] } },
          required: ['n', 'clase'],
        },
      },
      // N7: la historia es extractiva. El modelo copia frases del cliente; el código arma el texto.
      citas: { type: 'array', items: { type: 'string' } },
      // N5: cada solicitud de viaje distinta que aparece (otro cliente u otro viaje del mismo).
      solicitudes: {
        type: 'array',
        items: {
          type: 'object',
          properties: { cliente: { type: 'string' }, destino: { type: 'string' }, frase: { type: 'string' } },
          required: ['frase'],
        },
      },
      cliente: {
        type: 'object',
        properties: { nombre: { type: 'string' }, telefono: { type: 'string' }, email: { type: 'string' } },
      },
      valores: { type: 'object', properties, required: campos.map(f => f.slug) },
    },
    required: ['mensajes', 'citas', 'solicitudes', 'valores'],
  };
}

/** Quién habla en un mensaje de la entrega (N3). */
export const CLASES_MENSAJE = ['cliente', 'comercial', 'tercero', 'ruido'] as const;
export type ClaseMensaje = (typeof CLASES_MENSAJE)[number];

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
    '   - Las citas son solo de estos mensajes.',
  ];
  return [
    'Eres el asistente de una agencia. Un comercial te reenvió por WhatsApp lo que habló con un cliente',
    '(textos, transcripciones de notas de voz). Tu trabajo es entender la solicitud, no inventarla.',
    'Los mensajes vienen numerados: «[3] (reenviado) …» o «[4] (escrito por el comercial) …».',
    '',
    `Hoy es ${hoyISO} (Bogotá). Si una fecha no dice el año, es la próxima vez que ocurra desde hoy.`,
    '',
    'Devuelve:',
    '1. mensajes: para CADA mensaje, { n, clase }:',
    '   - cliente: lo que pide o cuenta el cliente sobre SU viaje (también si el comercial lo relata: «tengo dos pasajeros para…»);',
    '   - comercial: notas u opiniones del comercial sobre el cliente o sobre la venta («ojo, esta señora…»);',
    '   - tercero: lo que no dice el cliente de su viaje: una promoción o un plan de otra agencia, un comprobante o un abono de pago, un proveedor;',
    '   - ruido: saludos, risas, stickers, despedidas, temas personales.',
    '2. citas: hasta 8 frases COPIADAS tal cual de mensajes del cliente que cuenten lo que quiere. Nada de resúmenes ni opiniones.',
    '3. solicitudes: una por cada viaje DISTINTO que se pide en los mensajes (otro cliente, u otro viaje del mismo cliente con',
    '   otro destino o en otra fecha), con el cliente, el destino y la frase exacta que lo pide. Si todo es un solo viaje, una sola.',
    '4. cliente: nombre, teléfono y correo del cliente si los mensajes los dicen; si no, déjalos vacíos.',
    '5. valores: para CADA campo de la lista, { valor, frase }. Solo de mensajes del cliente.',
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
    '   - Si el cliente nombra varias ciudades o lugares («Madrid, París y Roma»), el destino los lleva todos tal como los dijo,',
    '     no la región que los agrupa.',
    '   - Un total sin desglose («somos 4 con los niños») no se reparte: deja adultos y niños en "por_definir".',
    '   - Cuenta a todos los que el mensaje dice que viajan, también los que se suman («mi hermana también va con sus 2 hijos»).',
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
  /** `email`: el correo del cliente, solo si está escrito tal cual en los mensajes (diseño 2026-10-05). */
  cliente: { nombre: string | null; telefono: string | null; email?: string | null };
  sugeridos: Record<string, Sugerido>;
  /**
   * Lo que un guardián tiró. `pregunta`: la que el bot hace en el acto, antes de las del mínimo (C9:
   * «Dijeron "mi bebé de 18": ¿viaja como bebé en brazos o con su propio cupo?»).
   */
  descartados: Array<{ slug: string; motivo: string; pregunta?: string }>;
}

function fechaValida(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// ── Guardián 1: un mes o una ventana no es una fecha ─────────────────────────

/** Los días del mes escritos con letras, como los deja una transcripción de audio. */
export const DIAS_EN_LETRAS: Record<string, number> = {
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
  if (!fraseDiceElAnio(frase)) {
    // El AÑO lo pone el código, no el modelo (QA de #971, R1: «salimos el 28 de diciembre» salía
    // 2027-12-28 en una carga a un negocio existente): la próxima vez que ocurre ese día y mes.
    const proxima = proximaOcurrencia(v.slice(5), hoyISO);
    if (!proxima) return { motivo: `fecha imposible: ${v}` };
    f = proxima;
  } else if (f < hoyISO) {
    return { motivo: `fecha pasada: ${v}` };
  }
  if (f > sumarMeses(hoyISO, MESES_MAXIMOS)) return { motivo: `a más de ${MESES_MAXIMOS} meses: ${f}` };
  return { valor: f };
}

/** ¿La frase dice el año («2027», «del 2026»)? Si no, el año lo infiere el código. */
export function fraseDiceElAnio(frase: string): boolean {
  return /(?<!\d)(19|20)\d{2}(?!\d)/.test(frase);
}

/** La próxima vez que ocurre `MM-DD` desde hoy (hoy cuenta). `null` si no existe (29-feb sin bisiesto cerca). */
export function proximaOcurrencia(mesDia: string, hoyISO: string, desde = hoyISO): string | null {
  const anio = Number(desde.slice(0, 4));
  for (const a of [anio, anio + 1, anio + 2, anio + 3, anio + 4]) {
    const c = `${a}-${mesDia}`;
    if (fechaValida(c) && c >= desde) return c;
  }
  return null;
}

/**
 * El regreso sin año va con la salida: mismo año, o el siguiente si su MES es anterior al de la
 * salida («del 28 de diciembre al 3 de enero» → 2026-12-28 / 2027-01-03). En el mismo mes y antes
 * del día de salida no se mueve: queda antes y se descarta (es un error, no otro año).
 */
export function regresoConLaSalida(regreso: string, salida: string): string | null {
  const anio = Number(salida.slice(0, 4)) + (regreso.slice(5, 7) < salida.slice(5, 7) ? 1 : 0);
  const c = `${anio}-${regreso.slice(5)}`;
  return fechaValida(c) ? c : null;
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

const PALABRAS_DE_OPCION_VACIAS = new Set(['con', 'sin', 'solo', 'para', 'los', 'las', 'del', 'que', 'por', 'entre', 'menos', 'mas']);

function palabrasDeOpcion(o: OpcionCampo): string[] {
  return [...new Set([o.label, String(o.value).replace(/_/g, ' ')]
    .flatMap(x => normalizarTexto(String(x ?? '')).replace(/[^a-z0-9 ]/g, ' ').split(' '))
    .filter(w => w.length >= 4 && !PALABRAS_DE_OPCION_VACIAS.has(w)))];
}

/**
 * ¿La frase NOMBRA esta opción? Con una palabra propia de su etiqueta o su valor (las que todas
 * las opciones comparten no cuentan), con un número de su etiqueta («cuatro» para «4 estrellas»)
 * o con uno de sus `sinonimos` de la config. «Cartagena» no nombra «Internacional»: esa opción la
 * deduciría el modelo, y eso no se carga.
 */
export function fraseNombraOpcion(f: CampoEntendible, o: OpcionCampo, frase: string): boolean {
  const t = ` ${normalizarTexto(frase).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if ((o.sinonimos ?? []).some(x => t.includes(` ${normalizarTexto(x).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `))) return true;
  const numeros = [...normalizarTexto(String(o.label ?? o.value)).matchAll(/\d+/g)].map(m => Number(m[0]));
  if (numeros.some(n => fraseNombraNumero(frase, n))) return true;
  const concretas = (f.opciones ?? []).filter(x => x.no_definido !== true);
  const comunes = new Set(palabrasDeOpcion(concretas[0] ?? o).filter(w => concretas.every(x => palabrasDeOpcion(x).includes(w))));
  const propias = palabrasDeOpcion(o).filter(w => !comunes.has(w) || concretas.length < 2);
  // Singular o plural: «2 maletas grandes» nombra «Maleta de bodega» (prueba en vivo v2, N5: el equipaje se perdía).
  return (propias.length > 0 ? propias : palabrasDeOpcion(o)).some(w => t.includes(` ${w} `) || t.includes(` ${w}s `) || t.includes(` ${w}es `));
}

// ── Rangos de dinero: el código elige la opción con la cifra ─────────────────

export interface RangoOpcion { value: string; min: number; max: number; label?: string }

/**
 * Los rangos de un campo cuyas opciones concretas son TODAS rangos en millones («Menos de $3
 * millones», «Entre $3 y $5 millones», «Hasta 8M», «8M a 12M», «Más de $20 millones»). `null` si
 * alguna no lo es: el campo no es de dinero y no se toca. Sale de las etiquetas de la config, no de
 * una lista. El borde lo dice la etiqueta: «entre», «a», «hasta» y «desde» lo INCLUYEN; «menos de»
 * y «más de» no (prueba en vivo del 2026-10-01, error 7).
 */
export function rangosDeDinero(f: CampoEntendible): RangoOpcion[] | null {
  const concretas = (f.opciones ?? []).filter(o => o.no_definido !== true);
  if (concretas.length < 2) return null;
  const out: RangoOpcion[] = [];
  const N = '(\\d+(?:[.,]\\d+)?)\\s*(?:m\\b)?';
  for (const o of concretas) {
    const label = String(o.label ?? '');
    const t = normalizarTexto(label).replace(/\$/g, '');
    if (!/millon|\d\s*m\b/.test(t)) return null;
    const n = (x: string) => Number(x.replace(',', '.'));
    const r = (min: number, max: number) => out.push({ value: String(o.value), min, max, label });
    let m = new RegExp(`entre\\s+${N}\\s+y\\s+${N}`).exec(t);
    if (m) { r(n(m[1]), n(m[2])); continue; }
    m = new RegExp(`menos de\\s+${N}`).exec(t);
    if (m) { r(-Infinity, n(m[1]) - 1e-9); continue; }
    m = new RegExp(`hasta\\s+${N}`).exec(t);
    if (m) { r(-Infinity, n(m[1])); continue; }
    m = new RegExp(`mas de\\s+${N}`).exec(t);
    if (m) { r(n(m[1]) + 1e-9, Infinity); continue; }
    m = new RegExp(`desde\\s+${N}`).exec(t) ?? new RegExp(`${N}\\s*(?:millones|millon)?\\s+(?:o|y) mas`).exec(t);
    if (m) { r(n(m[1]), Infinity); continue; }
    m = new RegExp(`(?:de\\s+)?${N}\\s*(?:millones|millon)?\\s*(?:a|-)\\s*${N}`).exec(t);
    if (m) { r(n(m[1]), n(m[2])); continue; }
    return null;
  }
  return out;
}

/**
 * Las cifras en millones de pesos de un texto: «unos 10 millones», «quince millones», «$2.5M»,
 * «10.000.000». `ambiguo` si es por persona o en otra moneda (dólares, euros).
 */
export function cifrasEnMillones(texto: string): number[] | 'ambiguo' {
  const t = normalizarTexto(texto);
  if (/(por persona|por cabeza|cada uno|cada una|c\/u|dolar|usd|us\$|euro|eur\b)/.test(t)) return 'ambiguo';
  const out: number[] = [];
  // «entre 4 y 10 millones»: las dos cifras cuentan.
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:y|a|-)\s*\d+(?:[.,]\d+)?\s*(?:millones|millon|mill|m\b)/g)) out.push(Number(m[1].replace(',', '.')));
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:millones|millon|mill|m\b)/g)) out.push(Number(m[1].replace(',', '.')));
  for (const m of t.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d{3}){2,})(?![\d.])/g)) out.push(Number(m[1].replace(/\./g, '')) / 1e6);
  for (const m of t.matchAll(/([a-z]+)\s+millones/g)) if (m[1] in DIAS_EN_LETRAS && m[1] !== 'primero') out.push(DIAS_EN_LETRAS[m[1]]);
  if (/\bun millon\b/.test(t)) out.push(1);
  return out;
}

/**
 * La opción cuyo rango contiene la cifra. En el borde de dos rangos gana el que INCLUYE esa cifra
 * según su etiqueta («Hasta 8M» y no «Más de 8M»; «8M a 12M» y no «Menos de 8M»). Si las dos
 * etiquetas la incluyen («Entre $5 y $8» y «Entre $8 y $12»), es `borde`: no se elige y el bot
 * pregunta el campo aunque sea deseable (prueba en vivo del 2026-10-01, error 7: «8 millones en
 * total» se descartaba sin preguntar). Sin cifra, o con cifras en rangos distintos, nada.
 */
export function opcionPorCifra(
  rangos: ReadonlyArray<RangoOpcion>, texto: string,
): { valor: string } | { motivo: string; borde?: { cifra: number; entre: string[] } } {
  const cifras = cifrasEnMillones(texto);
  if (cifras === 'ambiguo') return { motivo: 'la cifra es por persona o en otra moneda: no se elige el rango' };
  if (cifras.length === 0) return { motivo: 'sin una cifra que ubique el rango' };
  const opciones = new Set<string>();
  for (const c of cifras) {
    const caben = rangos.filter(r => c >= r.min && c <= r.max);
    if (caben.length === 0) return { motivo: `la cifra ${c} millones no cabe en ningún rango` };
    if (caben.length > 1) {
      return { motivo: `la cifra ${c} millones queda en el borde de dos rangos`, borde: { cifra: c, entre: caben.map(r => r.label ?? r.value) } };
    }
    opciones.add(caben[0].value);
  }
  return opciones.size === 1 ? { valor: [...opciones][0] } : { motivo: 'las cifras caen en rangos distintos' };
}

/** La pregunta del campo cuando la cifra quedó en el borde de dos rangos. */
export function preguntaDelBorde(f: CampoEntendible, borde: { cifra: number; entre: string[] }): string {
  const q = typeof f.pregunta === 'string' && f.pregunta.trim() ? f.pregunta.trim() : `¿${f.label ?? f.slug}?`;
  const cifra = String(borde.cifra).replace('.', ',');
  return `${q} (dijeron ${cifra} millones: queda justo entre «${borde.entre.join('» y «')}»)`;
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

/** Personas adultas por su relación con quien habla: «mi esposo», «mi suegra», «mi amiga». */
const RELACIONES_ADULTAS = new Set([
  'esposo', 'esposa', 'novio', 'novia', 'pareja', 'marido', 'mujer', 'companero', 'companera',
  'mama', 'papa', 'madre', 'padre', 'suegra', 'suegro', 'hermana', 'hermano', 'amiga', 'amigo',
  'prima', 'primo', 'tia', 'tio', 'abuela', 'abuelo', 'cunada', 'cunado', 'socia', 'socio', 'jefe', 'jefa', 'colega',
]);

/**
 * ¿Cuántos adultos enumera la frase como grupo cerrado, sin menores? «mi esposo y yo» = 2,
 * «mi esposa, mi suegra y yo» = 3, «vamos los dos» = 2. `null` si no es una enumeración cerrada
 * (falta el «yo», hay un «mis …» o una relación que no es adulta).
 */
export function adultosEnumerados(frase: string): number | null {
  const t = ` ${normalizarTexto(frase).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if (RE_MENOR.test(t)) return null;
  if (/ (los|las|nosotros|nosotras) (dos|2) /.test(t)) return 2;
  if (/ mis /.test(t) || !/ yo /.test(t)) return null;
  const rels = [...t.matchAll(/ mi (\w+)/g)].map(m => m[1]);
  if (rels.length === 0 || !rels.every(r => RELACIONES_ADULTAS.has(r))) return null;
  return rels.length + 1;
}

/**
 * ¿La frase cierra que no viajan menores? Tres formas, y nada más (prueba en vivo del 2026-10-01,
 * error 4: «somos 4», «somos 2 adultos» y «somos 3 adultos» llenaban niños = 0 e infantes = 0):
 *   · una negación pegada al menor: «sin niños», «ningún bebé», «no van niños»;
 *   · «solo adultos», «solo nosotros»;
 *   · una enumeración cerrada de adultos igual a los adultos: «mi esposo y yo», «mi novia y yo»,
 *     «vamos los dos» (QA de #969 v2, A4).
 * «Somos N» o «N adultos» NO cierran menores: dicen cuántos son, no que no haya niños. Tampoco
 * «somos 4 con los niños» ni «los dos niños». El 0 solo sale de aquí o de `deducirCeros` (todas las
 * edades dadas y ninguna menor de 2). QA de #969, C11.
 */
export function fraseCierraMenores(frase: string, adultos: number | null): boolean {
  const t = ` ${normalizarTexto(frase).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if (/ (sin|ningun\w*|cero|no (van|viajan|vienen|llevamos|hay)) (los |las |mis |nuestros |nuestras )?(nin|hij|beb|menor|infant|nene|peque|pelad|chiquit)/.test(t)) return true;
  if (/ solo(mente)? (adultos|nosotros|nosotras|los dos|las dos)\b/.test(t)) return true;
  if (adultos === null || RE_MENOR.test(t)) return false;
  return adultosEnumerados(frase) === adultos;
}

/** ¿Algún mensaje nombra a un menor? Sin ninguno, una enumeración cerrada de adultos deduce 0. */
export function nombraMenores(texto: string): boolean {
  return RE_MENOR.test(` ${normalizarTexto(texto).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `);
}

// ── Lugares: cómo se escriben ────────────────────────────────────────────────

/**
 * Cómo se escriben los lugares que el cliente suele escribir pegados o con otra letra
 * («puntacana», «curasao», «san andres»). La llave es el lugar sin tildes, espacios ni mayúsculas.
 * Lo que no esté aquí sale con mayúscula inicial en cada palabra (prueba en vivo del 2026-10-01:
 * el destino quedaba «PUNTACANA Y CURASAO» y el negocio «DIEGO PRUEBA2 · puntacana y curasao»).
 */
const LUGARES: Record<string, string> = Object.fromEntries([
  'Punta Cana', 'Curazao', 'San Andrés', 'Providencia', 'Santa Marta', 'Cartagena', 'Medellín', 'Bogotá', 'Cali', 'Barranquilla',
  'Cancún', 'Bariloche', 'Panamá', 'Aruba', 'Miami', 'Orlando', 'Nueva York', 'Las Vegas', 'México', 'Perú', 'Cusco',
  'Machu Picchu', 'Río de Janeiro', 'Buenos Aires', 'Costa Rica', 'Puerto Rico', 'República Dominicana', 'Eje Cafetero',
  'Capurganá', 'Guatapé', 'Villa de Leyva', 'Nuquí', 'Islas del Rosario', 'Barú', 'Leticia', 'Armenia', 'Pereira', 'Manizales',
  'Europa', 'Madrid', 'París', 'Roma', 'Londres', 'Ámsterdam', 'Lisboa', 'Barcelona', 'Estambul', 'Dubái', 'Japón',
].flatMap(l => [[normalizarTexto(l).replace(/[^a-z]/g, ''), l]]).concat([
  ['curasao', 'Curazao'], ['cuzco', 'Cusco'], ['newyork', 'Nueva York'], ['ny', 'Nueva York'], ['ctg', 'Cartagena'],
  ['sai', 'San Andrés'], ['dubai', 'Dubái'], ['amsterdam', 'Ámsterdam'],
]));

const CONECTORES = new Set(['y', 'e', 'o', 'de', 'del', 'la', 'las', 'los', 'el']);

/** «puntacana y curasao» → «Punta Cana y Curazao»; «MADRID, PARIS y roma» → «Madrid, París y Roma». */
export function normalizarLugar(texto: string): string {
  const partes = String(texto ?? '').trim().replace(/\s+/g, ' ').split(/(\s*[,:;/]\s*|\s+-\s+|\s+(?:y|e|o)\s+)/i);
  return partes.map((p, i) => {
    if (i % 2 === 1) return p.toLocaleLowerCase('es-CO');
    const llave = normalizarTexto(p).replace(/[^a-z]/g, '');
    if (LUGARES[llave]) return LUGARES[llave];
    const todoIgual = p === p.toLocaleLowerCase('es-CO') || p === p.toLocaleUpperCase('es-CO');
    if (!todoIgual) return p;
    return p.toLocaleLowerCase('es-CO').split(' ')
      .map((w, k) => (k > 0 && CONECTORES.has(w) ? w : w.charAt(0).toLocaleUpperCase('es-CO') + w.slice(1)))
      .join(' ');
  }).join('');
}

const SLUGS_DE_LUGAR = new Set(['destino', 'ciudad_origen']);

// ── Destino: varias ciudades se conservan todas ──────────────────────────────

const PALABRA_PROPIA = "[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñü'.-]+(?: (?:de |del |la |las |los |el )?[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñü'.-]+)*";
const RE_LISTA_LUGARES = new RegExp(`(${PALABRA_PROPIA}(?:, ${PALABRA_PROPIA})*,? (?:y|e) ${PALABRA_PROPIA})`, 'g');

/**
 * Los lugares que el cliente enumera DESPUÉS del destino en el mismo mensaje: «Europa 20 días en
 * mayo: Madrid, París y Roma» → ['Madrid', 'París', 'Roma']. Solo nombres propios escritos con
 * mayúscula, en una lista con «y» al final, y en el mismo mensaje que nombra el destino: así un
 * «Pedro y Juan» suelto no se vuelve destino. QA de #969 v2, A4: el destino quedaba EUROPA y las
 * ciudades no quedaban en ningún campo.
 */
export function lugaresDespuesDelDestino(destino: string, mensaje: string): string[] {
  const nd = normalizarTexto(destino);
  const i = normalizarTexto(mensaje).indexOf(nd);
  if (!nd || i < 0) return [];
  const resto = mensaje.slice(i + destino.length);
  for (const m of resto.matchAll(RE_LISTA_LUGARES)) {
    const items = m[1].split(/, | y | e /).map(x => x.replace(/,$/, '').trim()).filter(Boolean);
    if (items.length >= 2 && !items.some(x => normalizarTexto(x) === nd)) return items;
  }
  return [];
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

/** Cuántas citas lleva la historia, como máximo, y su largo. */
export const MAX_CITAS = 8;
const MAX_LARGO_CITA = 240;

/**
 * La historia extractiva (N7, encargo 2026-10-01): las citas que el modelo copió, SOLO si cada una
 * aparece tal cual (normalizada) en lo que el cliente dijo con sus palabras. Sin duplicados,
 * máximo ocho, cada una entre comillas. Una valoración del comercial no puede colarse: sus
 * mensajes no son citables, y una paráfrasis no aparece en ningún mensaje.
 */
export function historiaDeCitas(citas: unknown, citables: string): string {
  if (!Array.isArray(citas) || !citables.trim()) return '';
  const fuente = normalizarTexto(citables);
  const vistas: string[] = [];
  const out: string[] = [];
  for (const c of citas) {
    if (typeof c !== 'string') continue;
    const limpia = c.trim().replace(/^[«"“]+|[»"”]+$/g, '').trim();
    const n = normalizarTexto(limpia);
    if (n.length < 4 || limpia.length > MAX_LARGO_CITA || !fuente.includes(n)) continue;
    if (vistas.some(v => v.includes(n))) continue;
    vistas.push(n);
    out.push(`«${limpia}»`);
    if (out.length >= MAX_CITAS) break;
  }
  return out.length === 0 ? '' : `El cliente dijo:\n${out.join('\n')}`;
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
  opts: {
    hoyISO?: string;
    conocidos?: Record<string, unknown>;
    /**
     * Texto de donde se pueden CITAR frases para la historia (N7): solo lo que el cliente dijo
     * con sus palabras (reenviado y clasificado como cliente). Sin él, la historia queda vacía.
     */
    citables?: string;
  } = {},
): SalidaEntendida {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cli = (r.cliente && typeof r.cliente === 'object' ? r.cliente : {}) as Record<string, unknown>;
  const valores = (r.valores && typeof r.valores === 'object' ? r.valores : {}) as Record<string, unknown>;
  const fuente = normalizarTexto(textoFuente);

  const out: SalidaEntendida = {
    // N7: la historia NO es prosa del modelo. Se arma con citas textuales del cliente que
    // aparecen en lo citable; una paráfrasis («tiende a ser crítica») no puede entrar.
    historia: historiaDeCitas(r.citas, opts.citables ?? ''),
    // Un nombre o un teléfono que no está en los mensajes no es del cliente: el modelo puede copiar
    // un marcador del prompt («(no lo dijo)», «Viaje T1 26 11») (QA de #971, E2a y N6).
    cliente: {
      nombre: estaEnElTexto(textoONull(cli.nombre), fuente), telefono: telefonoEnElTexto(textoONull(cli.telefono), textoFuente),
      email: correoEnElTexto(textoONull(cli.email), textoFuente),
    },
    sugeridos: {},
    descartados: [],
  };

  const preferencias: string[] = [];
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
      const opcion = (f.opciones ?? []).find(o => String(o.value) === v)!;
      // Rangos de dinero: el rango lo elige el código con la cifra, no el modelo (QA de #971 v2,
      // «unos 10 millones» → «Entre $12 y $20 millones» 10/10).
      const rangos = rangosDeDinero(f);
      if (rangos && opcion.no_definido !== true) {
        const elegido = opcionPorCifra(rangos, mensajeDeLaFrase(frase, textoFuente));
        if ('motivo' in elegido) {
          // En el borde se pregunta, aunque el campo sea deseable; si el negocio ya lo tiene, no.
          const pregunta = elegido.borde && vacio(opts.conocidos?.[f.slug]) ? preguntaDelBorde(f, elegido.borde) : undefined;
          out.descartados.push({ slug: f.slug, motivo: elegido.motivo, ...(pregunta ? { pregunta } : {}) });
          continue;
        }
        out.sugeridos[f.slug] = { valor: elegido.valor, frase };
        continue;
      }
      if (opcion.no_definido !== true && !rangos && !fraseNombraOpcion(f, opcion, frase)) {
        out.descartados.push({ slug: f.slug, motivo: `«${opcion.label ?? v}» deducida sin una frase que la nombre: «${frase}»` });
        continue;
      }
      if (opcion.no_definido === true) {
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
      // Un valor que es una OPCIÓN de otro campo de la config no es un valor de este: «playa» es
      // un tipo de viaje, no un destino (QA de #971, A3). La lista sale de la config, no del código.
      const deOtro = opcionDeOtroCampo(v, f, fields);
      if (deOtro) {
        out.descartados.push({ slug: f.slug, motivo: `«${v}» es una opción de «${deOtro.label ?? deOtro.slug}», no un valor de ${f.label ?? f.slug}` });
        preferencias.push(frase);
        continue;
      }
      // Si el cliente enumera ciudades después del destino, el destino las conserva todas.
      if (f.slug === SLUG_DESTINO) {
        const lugares = lugaresDespuesDelDestino(v, mensajeDeLaFrase(frase, textoFuente));
        if (lugares.length > 0) {
          out.sugeridos[f.slug] = { valor: normalizarLugar(`${v}: ${lugares.slice(0, -1).join(', ')} y ${lugares[lugares.length - 1]}`), frase };
          continue;
        }
      }
      out.sugeridos[f.slug] = { valor: SLUGS_DE_LUGAR.has(f.slug) ? normalizarLugar(v) : v, frase };
    }
  }

  // La preferencia que no era un valor («un destino de playa») va a requisitos con su frase.
  const slugs = new Set(camposEntendibles(fields).map(f => f.slug));
  if (preferencias.length > 0 && slugs.has(SLUG_REQUISITOS) && !out.sugeridos[SLUG_REQUISITOS]) {
    out.sugeridos[SLUG_REQUISITOS] = { valor: preferencias.join('; '), frase: preferencias[0], deduccion: 'Preferencia del cliente que no es un valor del campo: se anota como requisito' };
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

  // Una enumeración cerrada de adultos («mi esposo y yo») sin un solo menor nombrado en los
  // mensajes deduce 0 niños y 0 infantes, con la regla anotada (QA de #969 v2, A4).
  const adultos = out.sugeridos.adultos;
  if (adultos && !nombraMenores(textoFuente) && fraseCierraMenores(adultos.frase, Number(adultos.valor))) {
    const slugs = new Set(camposEntendibles(fields).map(f => f.slug));
    for (const slug of SLUGS_MENORES) {
      if (!slugs.has(slug) || out.sugeridos[slug]) continue;
      out.sugeridos[slug] = { valor: 0, frase: adultos.frase, deduccion: `«${adultos.frase}»: viajan ${adultos.valor} adultos y ningún mensaje nombra menores` };
      out.descartados = out.descartados.filter(d => d.slug !== slug);
    }
  }

  // Un campo que solo aplica si viajan menores (misma condición `pedir_si` que pinta la barra,
  // la de `edades_menores`) se descarta si no se sabe que viajen: el permiso de salida de los
  // menores no se llena en un viaje sin niños (QA de #969, A4).
  const conocidosYNuevos: Record<string, unknown> = { ...(opts.conocidos ?? {}) };
  for (const [k, s] of Object.entries(out.sugeridos)) conocidosYNuevos[k] = s.valor;
  for (const f of camposEntendibles(fields)) {
    if (!out.sugeridos[f.slug] || !dependeDeMenores(f)) continue;
    const p = leerPedirSi(f.pedir_si);
    const deMenores = 'error' in p ? [] : p.condiciones.filter(c =>
      (typeof c.field === 'string' && SLUGS_MENORES.includes(c.field)) || (Array.isArray(c.suma_de) && c.suma_de.some(x => SLUGS_MENORES.includes(x))));
    if (!deMenores.every(c => cumplePedirSi(c, conocidosYNuevos))) {
      delete out.sugeridos[f.slug];
      out.descartados.push({ slug: f.slug, motivo: 'solo aplica si viajan menores, y no se sabe que viajen' });
    }
  }

  // El regreso sin año va con la salida: mismo año, o el siguiente si su mes es anterior.
  const salida = out.sugeridos[SLUG_SALIDA]?.valor ?? opts.conocidos?.[SLUG_SALIDA];
  const reg0 = out.sugeridos[SLUG_REGRESO];
  if (reg0 && typeof salida === 'string' && fechaValida(salida) && !fraseDiceElAnio(reg0.frase)) {
    const conSalida = regresoConLaSalida(String(reg0.valor), salida);
    if (conSalida) out.sugeridos[SLUG_REGRESO] = { ...reg0, valor: conSalida };
  }
  // El regreso no puede quedar antes de la salida (la de este mensaje o la que ya estaba).
  const regreso = out.sugeridos[SLUG_REGRESO];
  if (regreso && typeof salida === 'string' && fechaValida(salida) && String(regreso.valor) < salida) {
    delete out.sugeridos[SLUG_REGRESO];
    out.descartados.push({ slug: SLUG_REGRESO, motivo: `el regreso (${regreso.valor}) queda antes de la salida (${salida})` });
  }
  return out;
}

/** La convención del bloque de viaje para las dos fechas. Sin ellas, la comparación no corre. */
const SLUG_DESTINO = 'destino';
const SLUG_REQUISITOS = 'requisitos_especiales';

/** El campo `select`/`radio` (otro que `f`) que tiene `v` entre sus opciones, por valor o etiqueta. */
export function opcionDeOtroCampo(v: string, f: CampoEntendible, fields: ReadonlyArray<CampoEntendible>): CampoEntendible | null {
  const n = normalizarTexto(v).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  // Solo palabras: un número («5» años) no es la opción «5 estrellas» de otro campo.
  if (!n || !/[a-z]/.test(n)) return null;
  return fields.find(o => o.slug !== f.slug && (o.opciones ?? []).some(op =>
    !op.no_definido && [op.value, op.label].some(x => x && normalizarTexto(String(x)).replace(/[^a-z0-9 ]/g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim() === n))) ?? null;
}

/**
 * ¿Este «nombre de cliente» es en realidad un lugar? Si coincide con el destino entendido o con un
 * destino conocido (de los viajes abiertos), no es un nombre: el bot pregunta el nombre (QA de #971
 * v2, D2m: se creó el contacto «PUNTA CANA»).
 */
export function nombreEsLugar(nombre: string | null | undefined, lugares: ReadonlyArray<unknown>): boolean {
  const n = normalizarTexto(String(nombre ?? '')).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return false;
  return lugares.some(l => {
    const x = normalizarTexto(String(l ?? '')).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    return !!x && (x === n || x.split(/ o | y |: |, /).includes(n) || ` ${x} `.includes(` ${n} `));
  });
}

/** El texto, si todas sus palabras están en el mensaje; si no, null. */
function estaEnElTexto(v: string | null, fuenteNormalizada: string): string | null {
  if (!v) return null;
  const palabras = normalizarTexto(v).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(w => w.length >= 2);
  const del = new Set(fuenteNormalizada.replace(/[^a-z0-9 ]/g, ' ').split(' '));
  return palabras.length > 0 && palabras.every(w => del.has(w)) ? v : null;
}

/** El correo, si está escrito tal cual (sin mayúsculas) en los mensajes; en minúsculas. */
function correoEnElTexto(v: string | null, texto: string): string | null {
  const c = String(v ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(c) && texto.toLowerCase().includes(c) ? c : null;
}

/** El teléfono, si sus dígitos están en el mensaje. */
function telefonoEnElTexto(v: string | null, texto: string): string | null {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 7 && texto.replace(/\D/g, '').includes(d.slice(-7)) ? v : null;
}
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
/**
 * Un infante es menor de 2 años («¿Viajan bebés menores de 2 años?»). Es el ÚNICO corte de edad
 * del entendimiento: la categoría de infante en el avión es universal. Niño y adulto no se
 * deciden por edad; los define operaciones en la cotización (decisión de Mauricio, QA de #971 v5).
 */
export const EDAD_INFANTE = 2;

/**
 * Las edades en años de un texto como «9, 4», «9 AÑOS Y 4 AÑOS» o «9, 6 y 1». `null` si
 * habla de meses («8 meses») o no trae ningún número: ahí no se deduce nada.
 */
export function leerEdades(texto: unknown): number[] | null {
  // «1 y medio» y «1,5» son año y medio (prueba en vivo del 2026-10-01: «7, 1.5» se leía como una sola edad).
  const t = normalizarTexto(String(texto ?? '')).replace(/(\d{1,2}) y medio/g, '$1.5').replace(/(\d{1,2}),5(?!\d)/g, '$1.5');
  if (!t || /\bmes(es)?\b/.test(t)) return null;
  const edades = [...t.matchAll(/(?<![\d.,])(\d{1,2}(?:\.5)?)(?![\d.,]\d|\d)/g)].map(m => Number(m[1]));
  return edades.length > 0 ? edades : null;
}

/** Una edad como se le dice a una persona: «1,5», «7». */
function edadLegible(e: number): string {
  return String(e).replace('.', ',');
}

function enLista(xs: ReadonlyArray<string>): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`;
}

/**
 * Las edades con su etiqueta, para el «Entendí»: «niño: 7 años; bebé: 1,5 años». Solo separa por el
 * corte de infante (menor de 2), que es el único que decide el bot. `null` si no se pueden leer.
 */
export function edadesLegibles(v: unknown): string | null {
  const edades = leerEdades(v);
  if (!edades) return null;
  const grupo = (xs: number[], uno: string, varios: string) => {
    if (xs.length === 0) return null;
    const anios = xs.length === 1 && xs[0] === 1 ? 'año' : 'años';
    return `${xs.length === 1 ? uno : varios}: ${enLista(xs.map(edadLegible))} ${anios}`;
  };
  return [grupo(edades.filter(e => e >= EDAD_INFANTE), 'niño', 'niños'), grupo(edades.filter(e => e < EDAD_INFANTE), 'bebé', 'bebés')]
    .filter(Boolean).join('; ');
}

/**
 * Lo que se deduce sin el modelo para que el mínimo pueda cerrarse. Una sola regla: si
 * infantes está vacío, hay `n` niños y las edades dadas son exactamente `n`, todas de 2 años o
 * más, infantes = 0. «Somos 4» sin edades no deduce nada; una edad menor de 2, tampoco.
 *
 * @param valores lo que queda en el negocio (lo que ya tenía más lo que llega), por slug.
 * @returns sugeridos con `deduccion` y frase vacía, solo para campos vacíos.
 */
export function deducirCeros(
  fields: ReadonlyArray<CampoEntendible>,
  valores: Record<string, unknown>,
): Record<string, Sugerido> {
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
export function conDeducciones(
  fields: ReadonlyArray<CampoEntendible>,
  sugeridos: Record<string, Sugerido>,
): Record<string, Sugerido> {
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

/**
 * `suma_de` recalculado. MISMA regla que `src/lib/negocios/campo-suma.ts` (paridad probada en
 * `wa-suma-paridad.test.ts`): la suma solo cuando TODAS las fuentes tienen número; con alguna
 * vacía, el campo queda vacío (prueba en vivo del 2026-10-01: Diego quedó con 5 pasajeros porque
 * se sumó solo lo conocido, y eran 7); sin ninguna fuente, no se toca.
 */
export function aplicarSumas(fields: ReadonlyArray<CampoEntendible>, valores: Record<string, unknown>): Record<string, unknown> {
  let r = valores;
  for (const f of fields) {
    if (!Array.isArray(f.suma_de) || f.suma_de.length === 0) continue;
    const nums = f.suma_de.map(s => parsearNumeroColombiano(valores[s]));
    if (nums.every(n => n === null)) continue;
    if (nums.some(n => n === null)) {
      if (!vacio(r[f.slug])) r = { ...r, [f.slug]: '' };
      continue;
    }
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
    // Las edades con su etiqueta: «niño: 7 años; bebé: 1,5 años», no «7, 1.5» (prueba en vivo).
    if (f.slug === SLUG_EDADES) {
      partes.push(edadesLegibles(v) ?? `${(f.label ?? f.slug).toLowerCase()}: ${String(v)}`);
      continue;
    }
    const op = (f.opciones ?? []).find(o => String(o.value) === String(v));
    const texto = op?.label ?? String(v);
    // Un texto sin una sola letra («7, 1.5») no se entiende suelto: va con su etiqueta.
    partes.push(/\p{L}/u.test(texto) ? texto : `${(f.label ?? f.slug).toLowerCase()}: ${texto}`);
  }
  return partes.join(', ');
}

// ── El nombre de un viaje nuevo ──────────────────────────────────────────────

const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * Lo que el texto del cliente dice del viaje sin ser un campo: el mes («en diciembre») y la
 * duración («2 noches», «20 días»). Lo usa el nombre del viaje nuevo y la pregunta de la fecha.
 */
export function pistasDelTexto(texto: string): { mes: number | null; duracion: string | null } {
  const t = ` ${normalizarTexto(texto).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ')} `.replace(/ setiembre /g, ' septiembre ');
  const mes = MESES_LARGOS.findIndex(m => t.includes(` ${m} `));
  const noches = / (\d{1,2}) noches? /.exec(t);
  const dias = / (\d{1,2}) dias? /.exec(t);
  return { mes: mes >= 0 ? mes : null, duracion: noches ? `${Number(noches[1])}N` : dias ? `${Number(dias[1])}D` : null };
}

/**
 * El nombre de un negocio creado desde la bandeja, con la convención de Trappvel: destino y mes o
 * duración en mayúscula — «CARTAGENA DIC 12-16», «SAN ANDRÉS DIC», «ARMENIA 2N». Sin destino es
 * PROVISIONAL («Viaje de Laura Prueba») y se cambia solo cuando llega el destino, si nadie lo
 * editó a mano (la marca vive en `negocios.metadata.nombre_auto`).
 */
export function nombreViajeNuevo(p: {
  destino?: unknown; salida?: unknown; regreso?: unknown; mes?: number | null; duracion?: string | null; cliente?: string | null;
}): { nombre: string; provisional: boolean } {
  const destino = typeof p.destino === 'string' && p.destino.trim() ? normalizarLugar(p.destino).toLocaleUpperCase('es-CO') : '';
  if (!destino) {
    const quien = nombrePropio(p.cliente);
    return { nombre: quien ? `Viaje de ${quien}` : 'Viaje por WhatsApp', provisional: true };
  }
  const mesCorto = (iso: string) => MESES[Number(iso.slice(5, 7)) - 1].toUpperCase();
  const dia = (iso: string) => Number(iso.slice(8, 10));
  const salida = typeof p.salida === 'string' && fechaValida(p.salida) ? p.salida : null;
  const regreso = typeof p.regreso === 'string' && fechaValida(p.regreso) ? p.regreso : null;
  let cuando = '';
  if (salida && regreso) {
    cuando = mesCorto(salida) === mesCorto(regreso)
      ? `${mesCorto(salida)} ${dia(salida)}-${dia(regreso)}`
      : `${mesCorto(salida)} ${dia(salida)}-${mesCorto(regreso)} ${dia(regreso)}`;
  } else if (salida) {
    cuando = `${mesCorto(salida)} ${dia(salida)}`;
  } else {
    cuando = [p.mes !== null && p.mes !== undefined ? MESES[p.mes].toUpperCase() : '', p.duracion ?? ''].filter(Boolean).join(' ');
  }
  return { nombre: [destino, cuando].filter(Boolean).join(' '), provisional: false };
}

/** La pregunta de la salida recuerda el mes que dijeron: «¿Qué día salen? (dijeron diciembre)» (error 12). */
export function conMesEnLaPregunta<T extends { slug?: string; pregunta: string }>(faltan: ReadonlyArray<T>, mes: number | null): T[] {
  if (mes === null) return [...faltan];
  return faltan.map(f => (f.slug === SLUG_SALIDA ? { ...f, pregunta: `${f.pregunta} (dijeron ${MESES_LARGOS[mes]})` } : f));
}

export const MAX_PREGUNTAS = 3;

/** La respuesta al comercial: lo entendido y, como máximo, tres preguntas del mínimo. */
/**
 * Las preguntas que van al comercial: primero las de los campos del mínimo que un guardián
 * DESCARTÓ (el bot no puede callarse lo que tiró: QA de #969 v2, A4), luego las demás, hasta
 * `max`. Si los descartados son más que `max`, van todos.
 */
export function preguntasDelMinimo<T extends { slug?: string }>(faltan: ReadonlyArray<T>, prioridad: ReadonlyArray<string> = [], max = MAX_PREGUNTAS): T[] {
  // Si se tiró un conteo de pasajeros, se preguntan los tres: «somos 4 con los niños» pide el desglose.
  const conteos = ['adultos', 'ninos', 'infantes'];
  const prio = new Set(prioridad.some(p => conteos.includes(p)) ? [...prioridad, ...conteos] : prioridad);
  const primero = faltan.filter(f => f.slug !== undefined && prio.has(f.slug));
  const resto = faltan.filter(f => !(f.slug !== undefined && prio.has(f.slug)));
  return [...primero, ...resto].slice(0, Math.max(max, primero.length));
}

export function mensajeAlComercial(p: {
  resumen: string; faltanMinimo: Faltante[]; enlace: string; descartados?: ReadonlyArray<string>;
  /** Preguntas de un guardián (C9) que van antes de las del mínimo, aunque el mínimo esté completo. */
  preguntasAntes?: ReadonlyArray<string>;
  /** La línea de avance de la carga («T1 26 11 · Carolina — Mínimo 7/9 (78 %) · Completo 12/20 (60 %)»). */
  avance?: string | null;
}): string {
  const entendi = p.resumen ? `Entendí: ${p.resumen}.` : 'Recibí la solicitud.';
  const cabeza = [entendi, ...(p.avance ? [p.avance] : [])];
  const antes = p.preguntasAntes ?? [];
  if (p.faltanMinimo.length === 0) {
    return [...cabeza, ...(antes.length ? ['Antes de cotizar:', ...antes.map((q, i) => `${i + 1}. ${q}`)] : []), `Ya está el mínimo para cotizar: ${p.enlace}`].join('\n');
  }
  const preguntas = [...antes, ...preguntasDelMinimo(p.faltanMinimo, p.descartados).map(f => f.pregunta)].map((q, i) => `${i + 1}. ${q}`);
  return [...cabeza, 'Para empezar a cotizar me falta:', ...preguntas].join('\n');
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
  /** Los 4 últimos dígitos, si el candidato viene del directorio sin el celular completo. */
  cel4?: string | null;
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

// ── Cómo se nombra un viaje ──────────────────────────────────────────────────

/** «MARTA GÓMEZ» → «Marta Gómez». Solo si viene todo en mayúscula; lo demás se respeta. */
export function nombrePropio(t: string | null | undefined): string {
  const s = String(t ?? '').trim().replace(/\s+/g, ' ');
  if (!s || s !== s.toLocaleUpperCase('es-CO') || !/\p{L}/u.test(s)) return s;
  const menores = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
  return s.toLocaleLowerCase('es-CO').split(' ')
    .map((w, i) => (i > 0 && menores.has(w) ? w : w.charAt(0).toLocaleUpperCase('es-CO') + w.slice(1)))
    .join(' ');
}

/**
 * Como se le nombra un viaje al comercial (prueba en vivo del 2026-10-01, parte B): el NOMBRE del
 * negocio, el cliente y el código entre paréntesis — «Europa 2 días · Carolina Ruiz (M1 26 5)». Los
 * comerciales recuerdan el viaje por el nombre, no por el código. Si el nombre ya trae al cliente
 * (nombres viejos «DIEGO PRUEBA · Punta Cana»), el cliente no se repite. Es el formato de 📌,
 * «¿Cambias a…?», «¿A qué viaje van?», el resumen, la carga, los avisos y las preguntas en cola.
 */
export function nombreDeViaje(v: { nombre?: string | null; cliente?: string | null; codigo?: string | null }): string {
  const limpio = (x: string | null | undefined) => String(x ?? '').trim().replace(/\s+/g, ' ');
  const nombre = limpio(v.nombre);
  const cliente = nombrePropio(v.cliente);
  const yaLoTrae = !!nombre && !!cliente && normalizarNombre(nombre).includes(normalizarNombre(cliente));
  const cabeza = [nombre, yaLoTrae ? '' : cliente].filter(Boolean).join(' · ');
  const codigo = limpio(v.codigo);
  if (!cabeza) return codigo || 'sin código';
  return codigo ? `${cabeza} (${codigo})` : cabeza;
}

/** Lo que el comercial contestó, sin el teléfono que venga pegado. */
export function nombreDeLaRespuesta(clienteTexto: string | null | undefined): string {
  // Sin el «2» de «Prueba2»: el número no empieza pegado a una letra.
  return String(clienteTexto ?? '').replace(/(?<![\p{L}\d])\+?\d[\d\s().-]{6,}/gu, ' ').replace(/\s+/g, ' ').trim();
}

export type DecisionContacto =
  | { tipo: 'unico'; contacto: ContactoCandidato; por: 'telefono' | 'nombre' }
  /** `mismo`: el comercial pidió NUEVO y ya hay UN contacto con ese nombre exacto: ¿es el mismo? */
  /**
   * `llave`: no está en el directorio y no hay celular ni correo: se pide uno (decisión de Mauricio del 2026-10-05).
   * `llave_de_otro`: la llave dada ya es de UNA persona con otro nombre: ¿es la misma? (nunca se crea con ella).
   */
  | { tipo: 'preguntar'; motivo: 'ninguno' | 'varios' | 'mismo' | 'llave' | 'llave_de_otro'; opciones: ContactoCandidato[]; nombre: string };

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

function finTelefono(t: string | null, cel4?: string | null): string {
  const d = digitosTelefono(t);
  return d ? ` (cel. …${d.slice(-4)})` : cel4 ? ` (cel. …${cel4})` : '';
}

/**
 * Lo que dice un «nuevo …». `cliente`: el nombre del cliente del viaje nuevo, tal como se escribió (nunca
 * dice si el cliente es nuevo: eso lo resuelve el código buscándolo, §3.1). `viaje`: la frase nombra un viaje
 * nuevo («nuevo viaje», «nueva cotización», «uno nuevo»). `mismo`: habla del cliente que ya está en la
 * conversación («es para uno nuevo», «una cotización nueva sobre un cliente antiguo», «del mismo cliente»).
 */
export interface LecturaNuevo {
  cliente: string | null;
  viaje?: boolean;
  mismo?: boolean;
}

/** Lo que nombra un viaje nuevo junto a «nuevo/nueva/otro»: «nuevo viaje», «cotización nueva», «otra solicitud». */
const OBJETO_VIAJE: ReadonlySet<string> = new Set(['viaje', 'viajes', 'cotizacion', 'cotizaciones', 'solicitud', 'reserva', 'negocio', 'plan', 'paquete', 'pedido']);
const NUEVO_ADJ: ReadonlySet<string> = new Set(['nuevo', 'nueva', 'nuevos', 'nuevas']);
/**
 * Lo que puede ir ANTES de «nuevo viaje» sin decir nada más: «bueno, vamos a registrar un …», «no es un cliente
 * nuevo, es una …», «quiero cotizar otro …». Una palabra fuera de aquí («Paola nueva cotización») y la frase no
 * es un «nuevo»: sigue como siempre.
 */
const ANTES_DE_VIAJE_NUEVO: ReadonlySet<string> = new Set([
  'bueno', 'ok', 'okey', 'listo', 'vale', 'dale', 'entonces', 'ahora', 'pues', 'vamos', 'voy', 'va', 'a', 'hay', 'que', 'quiero', 'necesito',
  'toca', 'registrar', 'registra', 'registremos', 'crear', 'crea', 'creemos', 'abrir', 'abre', 'abramos', 'montar', 'monta', 'montemos', 'cotizar',
  'cotiza', 'cotizame', 'cotizemos', 'cotizemos', 'hacer', 'haz', 'hagamos', 'ingresar', 'ingresa', 'meter', 'mete', 'empezar', 'empecemos', 'arrancar',
  'arranquemos', 'iniciar', 'no', 'si', 'es', 'era', 'seria', 'para', 'por', 'favor', 'porfa', 'de', 'un', 'una', 'el', 'la', 'otro', 'otra', 'ya',
  'sigue', 'siguiente', 'tengo', 'te', 'paso', 'mando', 'me', 'hola', 'buenas', 'buenos', 'dias', 'tardes', 'noches', 'cliente', 'clienta', 'nuevo',
  'nueva', 'y', 'pero', 'mejor', 'solo', 'eso', 'esto', 'ojo', 'aqui', 'este', 'esta', 'les', 'le', 'nos', 'tenemos', 'ese', 'esa', 'mismo', 'misma',
  'antiguo', 'antigua', 'existente', 'conocido', 'conocida',
  // Décimo control (hallazgo 10): la perífrasis de obligación o de pedido delante del verbo («debemos crear…», «tocaría
  // abrir…», «puedes montar…»).
  'debemos', 'debo', 'deberiamos', 'deberia', 'tocaria', 'tendriamos', 'tendria', 'necesitamos', 'puedes', 'podrias', 'puede', 'podria',
  'podemos', 'favor', 'urgente',
]);
/** «abre», «ábrele», «abrirle», «monta», «móntale», «crea», «créale», «arma», «ármale», «hazle»: abrir un viaje. */
const VERBO_DE_ABRIR = /^(?:abr|mont|cre|arm|haz|hacer|hag)[a-z]*$/;
/** «empecemos», «empieza», «arranquemos», «iniciemos»: con «uno» y a quién, un viaje nuevo (décimo control). */
const VERBO_DE_EMPEZAR = /^(?:empez|empiez|empec|empiec|arranc|arranqu|inici|comenz|comienz|comenc)[a-z]*$/;
/** Lo que va entre «nuevo viaje» y el nombre: «de», «para», «a nombre de», «del cliente», «se llama». */
const ANTES_DEL_NOMBRE: ReadonlySet<string> = new Set(['a', 'de', 'del', 'para', 'nombre', 'sobre', 'el', 'la', 'cliente', 'clienta', 'se', 'llama', 'llamado', 'llamada', 'es', 'un', 'una',
  'senor', 'senora', 'sr', 'sra', 'don', 'dona']);
const CONECTOR_DEL_NOMBRE: ReadonlySet<string> = new Set(['de', 'del', 'para', 'nombre', 'sobre', 'cliente', 'clienta', 'llama', 'es']);
/** «sobre un cliente antiguo», «del mismo cliente», «para el que ya tenemos»: el cliente es el de la conversación. */
const CLIENTE_DE_ANTES = /^(?:(?:un|una|el|la|ese|esa|este|esta)\s+)?(?:client[ea]\s+)?(?:antigu[oa]|existente|viej[oa]|mism[oa]|de antes|conocid[oa]|recurrente|habitual|que ya (?:existe|tenemos|esta|teniamos)|ya existente)(?:\s+client[ea])?$/;

/**
 * Un viaje nuevo dicho con sus palabras. `undefined`: la frase no nombra un viaje nuevo (se lee como siempre).
 * `null`: lo nombra pero trae algo más que no es un nombre («nueva cotización con hotel 4 estrellas»): no es un
 * encabezado, es contenido. Si no, `{ viaje: true, cliente, mismo }`.
 */
export function leerViajeNuevo(texto: string): LecturaNuevo | null | undefined {
  const tokens = String(texto ?? '').split(/[\s,.:;!¡¿?()"«»“”]+/).filter(Boolean);
  const n = tokens.map(t => normalizarNombre(t));
  let i = -1;
  let largo = 2;
  let pronombre = false;
  let verbo = -1;
  let dativo = false;
  for (let k = 0; k < n.length - 1 && i < 0; k++) {
    const a = n[k];
    const b = n[k + 1];
    if ((NUEVO_ADJ.has(a) && OBJETO_VIAJE.has(b)) || (OBJETO_VIAJE.has(a) && NUEVO_ADJ.has(b)) || ((a === 'otro' || a === 'otra') && OBJETO_VIAJE.has(b))) i = k;
    // Noveno control (hallazgo 9): «ábrele un viaje a …», «móntale una cotización a …», «créale un viaje»: el verbo de
    // abrir o montar con «un viaje» es un viaje nuevo, aunque no diga «nuevo».
    else if (VERBO_DE_ABRIR.test(a) && (b === 'un' || b === 'una') && OBJETO_VIAJE.has(n[k + 2] ?? '') && !NUEVO_ADJ.has(n[k + 3] ?? '')) {
      i = k + 1;
      verbo = k;
      dativo = /(?:le|les)$/.test(a);
    }
    // Décimo control (hallazgo 10): un verbo de abrir o de empezar con el pronombre «uno» y a quién («empecemos uno para
    // Ana Ruiz», «ábrele uno a Ana Ruiz»): un viaje nuevo.
    else if ((VERBO_DE_ABRIR.test(a) || VERBO_DE_EMPEZAR.test(a)) && (b === 'uno' || b === 'una') && ['para', 'a', 'de', 'del'].includes(n[k + 2] ?? '')) {
      i = k + 1;
      largo = 1;
      verbo = k;
      dativo = /(?:le|les)$/.test(a);
    }
    // «uno nuevo», «una nueva» solos: el pronombre de un viaje del que ya se habla («es para uno nuevo»).
    else if ((a === 'uno' || a === 'una') && NUEVO_ADJ.has(b) && !OBJETO_VIAJE.has(n[k + 2] ?? '')) { i = k; pronombre = true; }
  }
  if (i < 0) return undefined;
  if (!n.slice(0, verbo >= 0 ? verbo : i).every(w => ANTES_DE_VIAJE_NUEVO.has(w))) return undefined;
  // «ese mismo cliente, pero otro viaje», «la clienta antigua quiere una cotización nueva»: lo de antes dice que el
  // cliente es el de la conversación (pero no «no es un cliente nuevo», que solo niega).
  if (/\b(?:mism[oa]|antigu[oa]|existente|conocid[oa])\b/.test(n.slice(0, i).join(' '))) pronombre = true;
  // «nuevo viaje nuevo», «cotización nueva de viaje»: lo repetido del objeto no cuenta como nombre.
  while (i + largo < n.length && (OBJETO_VIAJE.has(n[i + largo]) || NUEVO_ADJ.has(n[i + largo]))) largo++;
  const despues = tokens.slice(i + largo);
  const nd = n.slice(i + largo);
  if (despues.length === 0) return { cliente: null, viaje: true, ...(pronombre ? { mismo: true } : {}) };
  let j = 0;
  let conector = false;
  let tras = 0;
  // Con el pronombre de a quién («ábrele un viaje a Ana Ruiz»), la «a» introduce a la persona.
  while (j < nd.length && ANTES_DEL_NOMBRE.has(nd[j])) { if (CONECTOR_DEL_NOMBRE.has(nd[j]) || (dativo && nd[j] === 'a')) { conector = true; tras = j + 1; } j++; }
  // El tope del nombre cuenta desde el último «de/para/cliente»: «para la familia de cinco personas» no es un
  // nombre (control de Vera, I3), «del cliente Juan Pablo Ortega Zuleta» sí.
  if (conector && nd.length - tras > MAX_PALABRAS_NOMBRE_NUEVO) return null;
  const resto = nd.slice(j).join(' ');
  if (CLIENTE_DE_ANTES.test(nd.join(' ')) || CLIENTE_DE_ANTES.test(resto) || /^(?:(?:es|ya es)\s+)?client[ea]$/.test(resto) && nd.includes('ya')) {
    return { cliente: null, viaje: true, mismo: true };
  }
  if (!conector || j >= nd.length) return null;
  const nombre = despues.slice(j).join(' ').trim();
  return calificarNombreNuevo(nombre) === 'largo' ? null : { cliente: nombre, viaje: true };
}

/**
 * «Nuevo» en cualquier forma (prueba en vivo de Trappvel, 2026-10-02): «nuevo X», «cliente nuevo X»,
 * «nuevo cliente X», «es nuevo X», «nueva clienta X», «cliente nueva X», «es una clienta nueva X» →
 * `{ cliente: 'X' }`. Sin nombre («nuevo», «cliente nuevo») y el cambio de cliente sin nombre («otro
 * cliente», «otra clienta», «cambio de cliente») → `{ cliente: null }`: el bot pide el nombre.
 * `null`: no es un «nuevo». Antes solo se reconocía `^nuevo` al comienzo y «cliente nuevo Daniel
 * Pérez» caía en la coincidencia aproximada con el viaje de otra persona del mismo apellido.
 */
export function leerNuevo(texto: string): LecturaNuevo | null {
  const bruto = String(texto ?? '').trim().replace(/[.!¡]+$/g, '').trim();
  // «Nuevo» quiere decir VIAJE nuevo (diseño de cliente y conversación, 2026-10-05, §3.1): «vamos a registrar
  // un nuevo viaje», «nueva cotización para Ana Gómez», «es para uno nuevo». Si la frase nombra un viaje
  // nuevo, manda ella: lo que sigue sin «de/para» no es un nombre (es contenido), y nunca cae en la lectura
  // de abajo, que tomaba «cotización hotel» por el nombre de una clienta.
  const viaje = leerViajeNuevo(bruto);
  if (viaje !== undefined) return viaje;
  const m =/^(?:es\s+)?(?:(?:un|una)\s+)?(?:client[ea]\s+nuev[oa]|nuev[oa](?:\s+client[ea])?)(?=$|[\s,.:;-])[\s,.:;-]*([\s\S]*)$/i.exec(bruto);
  // «nueva, se llama Laura Prueba»: el nombre es lo que sigue a «se llama» (control de Vera, ND2).
  // Noveno control (hallazgo 1): también la preposición que lo introduce («nuevo para Ana Ruiz», «nueva a nombre de …»).
  if (m) {
    return { cliente: m[1].trim().replace(/^(?:(?:que\s+)?se\s+llama|llamad[oa]|de\s+nombre|(?:va\s+)?a\s+nombre\s+de|para|del?)[\s,.:;-]+/i, '').trim() || null };
  }
  if (/^(?:(?:es\s+)?(?:otr[oa]|un[oa]?\s+otr[oa])\s+client[ea]|cambi(?:o|ar|amos)\s+(?:de\s+)?client[ea])$/.test(normalizarTexto(bruto))) return { cliente: null };
  return null;
}

/**
 * Cuántas palabras puede tener el nombre de un cliente nuevo («nuevo Ana María Gómez Ruiz»). Una sola
 * constante para el encabezado (`resolverEncabezado`), la respuesta a «¿A qué viaje van?»
 * (`interpretarRespuestaNegocio`) y el intérprete (V8). Por encima del tope nunca se crea un cliente:
 * «nueva cotización con hotel 4 estrellas» no es la clienta «cotización con hotel 4 estrellas»
 * (control sellado de Vera, 2026-10-02, I3).
 */
export const MAX_PALABRAS_NOMBRE_NUEVO = 4;

/** ¿El nombre de un «nuevo …» cabe en el tope? Sin nombre («nuevo», «otro cliente»), sí: el bot lo pide. */
export function nombreNuevoCabe(cliente: string | null | undefined): boolean {
  return !cliente || normalizarNombre(cliente).split(' ').filter(Boolean).length <= MAX_PALABRAS_NOMBRE_NUEVO;
}

/**
 * Lo que va después de «nuevo/nueva»:
 *   · `sin_nombre`: «nuevo», «cliente nuevo». El bot pide el nombre (como siempre).
 *   · `largo`: más de `MAX_PALABRAS_NOMBRE_NUEVO` palabras. Nunca es un cliente.
 *   · `duda`: solo números («nuevo 3005551234»). No es un nombre: se pide.
 *   · `nombre`: es el nombre PROPUESTO. No crea a nadie todavía: el cliente se crea solo con el «sí»
 *     del comercial a un texto que muestra ese nombre tal cual (la confirmación de la lista, o el
 *     resumen del reparto, que dice «Cliente nuevo: X»).
 *
 * Sin vocabulario (decisión de Mauricio, 2026-10-03, tras el tercer control sellado de Vera): el código
 * ya no adivina si algo «parece un nombre» con una lista cerrada de palabras. Tres controles seguidos
 * la rompieron con vocabulario nuevo, y además dejaba en duda para siempre a empresas («Colegio …») y
 * apellidos comunes que estaban en la lista. Lo que no es un nombre lo frena el «sí»: el comercial ve
 * «¿Creo el cliente nuevo «paquete playero»?» y corrige.
 *
 * Una sola regla para la respuesta a «¿A qué viaje van?», el encabezado, el atajo del intérprete y la
 * corrección del resumen («el 3 es de nuevo …»).
 */
export type CalificacionNombreNuevo = 'sin_nombre' | 'nombre' | 'duda' | 'largo';

export function calificarNombreNuevo(cliente: string | null | undefined): CalificacionNombreNuevo {
  const bruto = String(cliente ?? '').trim();
  const todas = normalizarNombre(bruto).split(' ').filter(Boolean);
  if (todas.length === 0) return 'sin_nombre';
  // El celular, el correo o el usuario que acompañan al nombre («nuevo Marta Gómez 300 555 1234») no son el nombre
  // ni cuentan para el tope (2026-10-05: son la llave del cliente); sin nada más, duda.
  const sinLlave = nombreDeLaRespuesta(bruto).replace(/[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/g, ' ').replace(/@[A-Za-z0-9._]{3,30}/g, ' ');
  const ps = normalizarNombre(sinLlave).split(' ').filter(Boolean);
  if (ps.length > MAX_PALABRAS_NOMBRE_NUEVO) return 'largo';
  return ps.length === 0 || ps.every(w => /^\d+$/.test(w)) ? 'duda' : 'nombre';
}

/** Lo que el bot contesta cuando lo que sigue a «nuevo» no es un nombre (solo números): pregunta, nunca crea. */
export function textoNombreNuevoEnDuda(propuesto: string): string {
  const p = String(propuesto ?? '').trim().slice(0, 40);
  return `¿Para qué cliente es el viaje nuevo? Con «${p}» no sé quién es.\n`
    + 'Escribe «nuevo» y su nombre (por ejemplo «nuevo Marta Gómez»), «nuevo» solo para tomarlo de los mensajes, o dime el viaje si es uno que ya existe.';
}

/** «otro cliente Daniel Pérez», «cambio de cliente: Lina»: lo que viene después del cambio, o `null`. */
export function restoTrasOtroCliente(texto: string): string | null {
  const m = /^(?:otr[oa]\s+client[ea]|cambi(?:o|ar|amos)\s+(?:de\s+)?client[ea])[\s,.:;-]+([\s\S]+)$/i.exec(String(texto ?? '').trim());
  return m ? m[1].trim() || null : null;
}

export function textoPreguntaContacto(d: Extract<DecisionContacto, { tipo: 'preguntar' }>): string {
  // N9: sin nombre no hay a quién buscar ni a quién crear. Se pide el nombre, nunca un error mudo.
  if (!d.nombre && d.opciones.length === 0) return TEXTO_PIDE_NOMBRE;
  const quien = d.nombre ? d.nombre : 'el cliente';
  const linea = (c: ContactoCandidato) => `${nombrePropio(c.nombre) || 'Sin nombre'}${finTelefono(c.telefono, c.cel4)}`;
  // Decisión de Mauricio del 2026-10-05: sin celular ni correo no se crea. Una sola pregunta, sin comandos.
  if (d.motivo === 'llave' || (d.motivo === 'ninguno' && d.opciones.length === 0)) {
    return `No tengo a ${quien} en el directorio. ¿Me pasas su celular o su correo? Sin uno de los dos no lo creo.`;
  }
  if (d.motivo === 'llave_de_otro') {
    return `Ese celular o correo ya lo tenemos a nombre de ${linea(d.opciones[0])}. ¿Es la misma persona?`;
  }
  if (d.motivo === 'mismo') {
    return `Ya tenemos a ${linea(d.opciones[0])}. ¿Es la misma persona?`;
  }
  const cab = d.motivo === 'varios'
    ? `Tengo ${d.opciones.length} contactos que pueden ser ${quien}. ¿Cuál es, o es otra persona?`
    : `No tengo a ${quien} tal cual. ¿Es alguno de estos, o es otra persona?`;
  const lista = d.opciones.map((c, i) => `${i + 1}. ${linea(c)}`);
  return [cab, ...lista, 'Si es otra persona, pásame su celular o su correo.'].join('\n');
}

/** N9 · NUEVO sin nombre: el bot lo pide en vez de terminar en un error mudo (E2a). */
export const TEXTO_PIDE_NOMBRE = '¿Para qué cliente es? No veo su nombre en los mensajes; escríbeme su nombre, o su celular o correo.';

export type RespuestaContacto =
  | { tipo: 'elegido'; contacto_id: string }
  /** `nombre`: lo que escribió después de NUEVO («NUEVO Marta Gómez»), o null. */
  | { tipo: 'nuevo'; nombre: string | null }
  | { tipo: 'telefono'; telefono: string }
  /** Un correo o un usuario de WhatsApp/Instagram escrito solo. */
  | { tipo: 'llave'; correo: string | null; usuario: string | null }
  /** «es otra persona», «ninguno»: no es ninguno de los que mostró el bot. */
  | { tipo: 'otra' }
  | { tipo: 'no_entendida' };

export function interpretarRespuestaContacto(texto: string, opciones: ContactoCandidato[]): RespuestaContacto {
  const t = normalizarTexto(texto);
  const m = /^(\d{1,2})\.?$/.exec(t);
  if (m) {
    const i = Number(m[1]) - 1;
    return i >= 0 && i < opciones.length ? { tipo: 'elegido', contacto_id: opciones[i].id } : { tipo: 'no_entendida' };
  }
  if (t === 'crear' || t === 'crearlo') return { tipo: 'nuevo', nombre: null };
  // «nuevo», «cliente nuevo Marta Gómez», «nueva clienta Marta» (`leerNuevo`). Un nombre con dígitos no.
  const nuevo = leerNuevo(texto);
  if (nuevo && !nuevo.cliente) return { tipo: 'nuevo', nombre: null };
  // Un nombre no lleva una palabra que es solo números (eso es el celular); «Prueba5» sí puede ser un nombre de prueba.
  if (nuevo?.cliente && nuevo.cliente.trim().length >= 2 && !/(^|\s)\d+(\s|$)/.test(nuevo.cliente.trim())) return { tipo: 'nuevo', nombre: nuevo.cliente };
  const tel = digitosTelefono(texto);
  if (tel && tel.length >= 10) return { tipo: 'telefono', telefono: tel };
  const correo = /^(?:(?:su\s+)?(?:correo|email|mail)\s*(?:es)?\s*:?\s*)?([^\s@]+@[^\s@]+\.[a-z]{2,})\.?$/i.exec(String(texto ?? '').trim())?.[1];
  if (correo) return { tipo: 'llave', correo: correo.toLowerCase(), usuario: null };
  const usuario = /^(?:(?:su\s+)?(?:usuario|instagram|ig|insta|whatsapp)\s*(?:es)?\s*:?\s*)?@([A-Za-z0-9._]{3,30})$/i.exec(String(texto ?? '').trim())?.[1];
  if (usuario) return { tipo: 'llave', correo: null, usuario: usuario.toLowerCase() };
  if (/\b(?:otra persona|es otr[oa]|ningun[oa]?|nadie|no es ninguno)\b/.test(t)) return { tipo: 'otra' };
  return { tipo: 'no_entendida' };
}
