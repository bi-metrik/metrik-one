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
// ============================================================

import { calcularNiveles, parsearNumeroColombiano, type CampoConNivel, type Faltante } from './niveles-solicitud.ts';

export const POR_DEFINIR = 'por_definir';

/** Tipos de campo que el modelo puede llenar. El resto no captura un dato del cliente. */
const TIPOS_ENTENDIBLES = new Set(['texto', 'numero', 'fecha', 'select', 'radio']);

export interface CampoEntendible extends CampoConNivel {
  ayuda?: string;
  opciones?: Array<{ value: string; label?: string }>;
  suma_de?: string[];
}

/** Los campos que el modelo puede llenar: los que capturan un dato y no son derivados. */
export function camposEntendibles(fields: ReadonlyArray<CampoEntendible>): CampoEntendible[] {
  return fields.filter(f =>
    typeof f.slug === 'string'
    && !f.slug.startsWith('_')
    && TIPOS_ENTENDIBLES.has(f.tipo)
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
  if (f.tipo === 'fecha') return 'una fecha AAAA-MM-DD';
  const op = f.opciones ?? [];
  if (op.length > 0) return `una de: ${op.map(o => `${o.value} (${o.label ?? o.value})`).join(', ')}`;
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
    '   - Un rango de fechas («del 15 al 20 de noviembre») da la salida y el regreso.',
    '   - «Dos personas» sin más detalle son dos adultos; los niños solo cuentan si el mensaje los nombra.',
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

function textoONull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Lo que el modelo devolvió, filtrado contra la config y contra el mensaje. Un valor sale
 * como sugerido solo si: no es «por definir», cabe en el tipo del campo (y en sus opciones),
 * y trae una frase que de verdad está en los mensajes.
 */
export function validarSalida(
  raw: unknown,
  fields: ReadonlyArray<CampoEntendible>,
  textoFuente: string,
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
      out.sugeridos[f.slug] = { valor: v, frase };
    } else if (valoresDeOpciones(f).length > 0) {
      if (!valoresDeOpciones(f).includes(v)) {
        out.descartados.push({ slug: f.slug, motivo: `fuera de las opciones: ${v}` });
        continue;
      }
      out.sugeridos[f.slug] = { valor: v, frase };
    } else {
      out.sugeridos[f.slug] = { valor: v, frase };
    }
  }
  return out;
}

// ── Escribir en el bloque sin pisar a una persona ────────────────────────────

/** La marca que deja un valor sugerido en `negocio_bloques.data._sugeridos[slug]`. */
export interface MarcaSugerido {
  fuente: 'whatsapp';
  entrega_id: string;
  frase: string;
  en: string;
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
    marcas[f.slug] = { fuente: 'whatsapp', entrega_id: meta.entrega_id, frase: s.frase, en: meta.en };
    escritos.push(f.slug);
  }
  if (escritos.length > 0) out[CLAVE_SUGERIDOS] = marcas;
  return { data: out, escritos, respetados };
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
