// ============================================================
// Varios viajes en una entrega (modo `encabezado` / `mixto`) — las reglas, sin I/O
// ------------------------------------------------------------
// Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-01-varios-viajes-y-guardianes.md,
// parte 1. QA: qa/bandeja-wa/plan-qa.md, grupo F.
//
// Tatiana atiende a varios clientes a la vez y reenvía lo de todos. Un reenvío de WhatsApp no
// dice de qué chat viene, así que la pista la da ella (un ENCABEZADO) o la propone el modelo con
// EVIDENCIA citada, y ella confirma. Cambio de modelo mental: «cada mensaje tiene su viaje».
//
// Reglas que no se negocian:
//   1. Un encabezado se resuelve de forma DETERMINISTA contra los viajes abiertos: código exacto,
//      o un nombre/destino con un solo candidato. Con dos o ninguno se pregunta; nunca se elige.
//   2. El modelo solo asigna con evidencia: una cita que está en ESE mensaje y que nombra al viaje
//      (su cliente, su código, o su destino si ningún otro viaje abierto va al mismo lugar). La
//      cercanía en el tiempo sola no es evidencia (F3).
//   3. Nada se carga hasta el «sí». Lo ambiguo («ok pero…», un sticker) no es «sí».
//   4. Un mensaje que nombra a dos viajes no se carga entero en ninguno (F13).
//   5. Una evidencia de OTRO viaje dentro de la caja de un encabezado no se pasa sola a ese viaje
//      (F9: «Luisa me recomendó» sigue siendo del chat de Carolina): ese mensaje queda sin asignar
//      con el motivo, y la caja se rompe: lo que sigue sin evidencia propia también queda sin
//      asignar (F4: el encabezado olvidado a mitad). Lo decide el comercial.
// ============================================================

import { normalizarNombre, normalizarTexto } from './wa-entendimiento-reglas.ts';
import { codigoCompacto } from './wa-carga-reglas.ts';

/** Un viaje abierto de la línea, como lo ofrece la bandeja. */
export interface ViajeAbierto {
  id: string;
  codigo: string | null;
  cliente: string | null;
  destino: string | null;
}

/** Un mensaje de la entrega con su hora de llegada. `n` es su número (1, 2, 3…) en la entrega. */
export interface MensajeViaje {
  n: number;
  cuerpo: string;
  reenviado: boolean;
  tipo: string;
  /** ISO: cuándo llegó (`recibido_at`). */
  en: string;
}

// ── Encabezados ──────────────────────────────────────────────────────────────

export type ResolucionEncabezado =
  | { tipo: 'viaje'; viaje: ViajeAbierto; por: 'codigo' | 'nombre' | 'destino' }
  | { tipo: 'nuevo'; cliente: string | null }
  | { tipo: 'ambiguo'; candidatos: ViajeAbierto[] }
  | { tipo: 'codigo_desconocido'; codigo: string };

/** Palabras de relleno de un encabezado: «la de punta cana», «cliente Carolina», «el viaje de Jorge». */
const RELLENO = new Set([
  'la', 'el', 'lo', 'los', 'las', 'de', 'del', 'para', 'a', 'al', 'y', 'con', 'cliente', 'clienta', 'viaje',
  'senora', 'senor', 'sra', 'sr', 'don', 'dona', 'familia', 'ahora', 'sigue', 'siguen', 'van', 'va', 'esto', 'estos', 'es',
]);
export const MAX_PALABRAS_ENCABEZADO = 5;

function distancia(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** ¿Esta palabra es una palabra del nombre? Igual, o con un error de tipeo si es larga («Carlina»). */
function palabraDelNombre(w: string, nombre: string | null): boolean {
  return normalizarNombre(nombre).split(' ').some(p => p.length >= 3 && (p === w || (p.length >= 5 && w.length >= 5 && distancia(p, w) <= 1)));
}

function palabrasDe(t: string | null): string[] {
  return normalizarNombre(t).split(' ').filter(Boolean);
}

function esCodigo(compacto: string): boolean {
  return /^[A-Z]{1,3}\d{3,}$/.test(compacto) && compacto.length <= 12;
}

/**
 * ¿Este escrito del comercial es un encabezado? Solo si es corto (hasta cinco palabras) y TODO lo
 * que dice se explica como una referencia a un viaje: «Carolina», «T1 26 9», «nuevo Luisa San
 * Andrés», «la de punta cana». «Carolina quiere 5 estrellas» no lo es (es contenido). `null` = no es
 * encabezado.
 */
export function resolverEncabezado(texto: string, viajes: ReadonlyArray<ViajeAbierto>): ResolucionEncabezado | null {
  const bruto = String(texto ?? '').trim();
  const palabras = normalizarTexto(bruto).split(/\s+/).filter(Boolean);
  if (palabras.length === 0 || palabras.length > MAX_PALABRAS_ENCABEZADO) return null;

  const nuevo = /^nuev[oa]\b[\s,.:;-]*([\s\S]*)$/i.exec(bruto);
  if (nuevo) return { tipo: 'nuevo', cliente: nuevo[1].trim() || null };

  const compacto = codigoCompacto(bruto);
  if (esCodigo(compacto)) {
    const v = viajes.find(x => codigoCompacto(x.codigo) === compacto);
    return v ? { tipo: 'viaje', viaje: v, por: 'codigo' } : { tipo: 'codigo_desconocido', codigo: compacto };
  }

  const resto = palabrasDe(bruto).filter(w => !RELLENO.has(w));
  if (resto.length === 0) return null;

  const porNombre = viajes.filter(v => resto.every(w => palabraDelNombre(w, v.cliente)));
  const porDestino = viajes.filter(v => {
    const d = palabrasDe(v.destino);
    return d.length > 0 && resto.length === d.length && d.every(w => resto.includes(w));
  });
  const candidatos = [...new Map([...porNombre, ...porDestino].map(v => [v.id, v])).values()];
  if (candidatos.length === 1) {
    return { tipo: 'viaje', viaje: candidatos[0], por: porNombre.length === 1 ? 'nombre' : 'destino' };
  }
  if (candidatos.length > 1) return { tipo: 'ambiguo', candidatos };
  return null;
}

// ── Segmentos ────────────────────────────────────────────────────────────────

export interface Segmento {
  origen: 'encabezado' | 'silencio';
  /** El encabezado que abrió la caja (solo en `encabezado`). */
  encabezado: { n: number; texto: string; resolucion: ResolucionEncabezado } | null;
  mensajes: number[];
}

/**
 * Los segmentos de una entrega: primero por encabezado (vale hasta otro encabezado, el cierre o
 * `horasCajaActiva`); lo que no tiene encabezado se agrupa por silencio (`segundosBloque`).
 * Devuelve también los números de los mensajes que son encabezados: no son contenido.
 */
export function armarSegmentos(
  mensajes: ReadonlyArray<MensajeViaje>,
  viajes: ReadonlyArray<ViajeAbierto>,
  cfg: { segundosBloque: number; horasCajaActiva: number },
): { segmentos: Segmento[]; encabezados: number[] } {
  const segmentos: Segmento[] = [];
  const encabezados: number[] = [];
  let caja: { seg: Segmento; desde: number } | null = null;
  let bloque: Segmento | null = null;
  let ultimo = -Infinity;
  const orden = [...mensajes].sort((a, b) => a.n - b.n);
  for (const m of orden) {
    const t = Date.parse(m.en);
    const res = !m.reenviado && m.tipo === 'text' ? resolverEncabezado(m.cuerpo, viajes) : null;
    if (res) {
      encabezados.push(m.n);
      const seg: Segmento = { origen: 'encabezado', encabezado: { n: m.n, texto: m.cuerpo.trim(), resolucion: res }, mensajes: [] };
      segmentos.push(seg);
      caja = { seg, desde: t };
      bloque = null;
      continue;
    }
    if (!m.cuerpo.trim()) continue; // un sticker o una foto sin pie no es contenido
    if (caja && t - caja.desde <= cfg.horasCajaActiva * 3600_000) {
      caja.seg.mensajes.push(m.n);
      ultimo = t;
      continue;
    }
    caja = null;
    if (!bloque || t - ultimo > cfg.segundosBloque * 1000) {
      bloque = { origen: 'silencio', encabezado: null, mensajes: [] };
      segmentos.push(bloque);
    }
    bloque.mensajes.push(m.n);
    ultimo = t;
  }
  return { segmentos: segmentos.filter(s => s.mensajes.length > 0 || s.origen === 'encabezado'), encabezados };
}

// ── Lo que propone el modelo ─────────────────────────────────────────────────

/** A dónde va un mensaje. */
export type DestinoPlan =
  | { tipo: 'existente'; negocio_id: string; codigo: string | null; cliente: string | null }
  | { tipo: 'nuevo'; cliente: string | null };

export function claveDestino(d: DestinoPlan): string {
  return d.tipo === 'existente' ? `e:${d.negocio_id}` : `n:${normalizarNombre(d.cliente)}`;
}

function destinoDeViaje(v: ViajeAbierto): DestinoPlan {
  return { tipo: 'existente', negocio_id: v.id, codigo: v.codigo, cliente: v.cliente };
}

/** El esquema de la respuesta del modelo: una asignación por mensaje. */
export function esquemaAsignacion(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      asignaciones: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            n: { type: 'integer' },
            viaje: { type: 'string' },
            evidencia: { type: 'string' },
          },
          required: ['n', 'viaje', 'evidencia'],
        },
      },
    },
    required: ['asignaciones'],
  };
}

export function instruccionesAsignacion(viajes: ReadonlyArray<ViajeAbierto>): string {
  const lista = viajes.map(v => `- ${v.codigo ?? '(sin código)'}: ${v.cliente ?? 'sin nombre'}${v.destino ? `, ${v.destino}` : ''}`);
  return [
    'Eres el asistente de una agencia de viajes. Un comercial atiende a varios clientes a la vez y te reenvió mensajes de varios chats.',
    'Un reenvío no dice de qué chat viene. Para CADA mensaje numerado di a qué viaje pertenece, SOLO si el texto del mensaje lo muestra.',
    '',
    'Viajes abiertos:',
    ...(lista.length ? lista : ['- (ninguno)']),
    '',
    'Devuelve asignaciones: para cada mensaje { n, viaje, evidencia }:',
    '- viaje = el código del viaje (por ejemplo «T1 26 9»), o «NUEVO <nombre>» si es un cliente que no está en la lista, o «ninguno».',
    '- evidencia = las palabras EXACTAS de ESE mensaje que lo prueban: el nombre del cliente, su código, o un dato que solo coincide con ese viaje.',
    '- Si el mensaje no trae evidencia propia, viaje = «ninguno». Estar cerca en el tiempo de otro mensaje NO es evidencia.',
    '- Si un mensaje habla de dos viajes, viaje = «ninguno».',
    '- Que un cliente nombre a otra persona («Luisa me recomendó») no hace que el mensaje sea de esa persona.',
  ].join('\n');
}

/** Los mensajes como los lee el modelo para asignarlos. */
export function textoAsignacion(mensajes: ReadonlyArray<MensajeViaje>, encabezados: ReadonlyArray<number>): string {
  const enc = new Set(encabezados);
  return mensajes
    .filter(m => m.cuerpo.trim() && !enc.has(m.n))
    .map(m => `[${m.n}] (${m.reenviado ? 'reenviado' : 'escrito por el comercial'}) ${m.cuerpo.trim()}`)
    .join('\n');
}

/** Palabras de un nombre que no identifican a nadie. */
const NO_IDENTIFICAN = new Set(['san', 'santa', 'del', 'las', 'los', 'familia']);

/**
 * El texto sin los lugares: los destinos de los viajes abiertos y lo que va después de «San» o
 * «Santa». Así «San Andrés» no nombra a Andrés Gil (QA de #971, el día: Luisa terminó sin datos).
 */
export function sinLugares(texto: string, viajes: ReadonlyArray<ViajeAbierto> = []): string {
  let t = ` ${palabrasDe(texto).join(' ')} `;
  const destinos = [...new Set(viajes.map(v => normalizarNombre(v.destino)).filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const d of destinos) t = t.split(` ${d} `).join(' ');
  t = t.replace(/ (san|santa|santo) \w+/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Los viajes que un mensaje nombra SIN el modelo: por una palabra del nombre del cliente (abiertos
 * o NUEVO de un encabezado), con los lugares quitados antes. El destino NO cuenta como evidencia
 * de a qué viaje va (D2m: «llevar a mi mamá a Cartagena» no es del viaje de Jorge a Cartagena).
 */
export function viajesNombrados(cuerpo: string, destinos: ReadonlyArray<DestinoPlan>, viajes: ReadonlyArray<ViajeAbierto> = []): DestinoPlan[] {
  const palabras = new Set(sinLugares(cuerpo, viajes).split(' '));
  const out = new Map<string, DestinoPlan>();
  for (const d of destinos) {
    const delNombre = palabrasDe(d.cliente).filter(w => w.length >= 3 && !NO_IDENTIFICAN.has(w));
    if (delNombre.length > 0 && delNombre.some(w => palabras.has(w))) out.set(claveDestino(d), d);
  }
  return [...out.values()];
}

/** Los destinos de viajes abiertos que el mensaje nombra («para Cartagena»), normalizados. */
export function destinosNombrados(cuerpo: string, viajes: ReadonlyArray<ViajeAbierto>): string[] {
  const t = ` ${palabrasDe(cuerpo).join(' ')} `;
  return [...new Set(viajes.map(v => normalizarNombre(v.destino)).filter(d => d && t.includes(` ${d} `)))];
}

/**
 * ¿La evidencia nombra a este viaje? El nombre del cliente (sin lugares) o el código. El destino
 * no: dos clientes van al mismo lugar (F7) y un cliente puede nombrar el destino de otro (D2m).
 */
export function evidenciaApunta(evidencia: string, d: DestinoPlan, viajes: ReadonlyArray<ViajeAbierto>): boolean {
  const palabras = sinLugares(evidencia, viajes).split(' ').filter(Boolean);
  if (palabras.some(w => !NO_IDENTIFICAN.has(w) && palabraDelNombre(w, d.cliente))) return true;
  if (d.tipo === 'nuevo') return false;
  return !!d.codigo && normalizarTexto(evidencia).replace(/[^a-z0-9]/g, '').includes(codigoCompacto(d.codigo).toLowerCase());
}

export interface AsignacionModelo {
  destino: DestinoPlan;
  evidencia: string;
}

/**
 * Lo que el modelo propuso, filtrado: la evidencia tiene que estar en ESE mensaje y nombrar a ESE
 * viaje (`evidenciaApunta`). Lo que no pasa no se asigna: queda sin asignar y se pregunta.
 */
export function validarAsignaciones(
  raw: unknown,
  mensajes: ReadonlyArray<MensajeViaje>,
  viajes: ReadonlyArray<ViajeAbierto>,
): Map<number, AsignacionModelo> {
  const out = new Map<number, AsignacionModelo>();
  const lista = (raw as { asignaciones?: unknown } | null)?.asignaciones;
  if (!Array.isArray(lista)) return out;
  const porN = new Map(mensajes.map(m => [m.n, m]));
  for (const a of lista as Array<Record<string, unknown>>) {
    const m = porN.get(Number(a?.n));
    const viaje = String(a?.viaje ?? '').trim();
    const evidencia = String(a?.evidencia ?? '').trim();
    if (!m || !viaje || !evidencia || /^ninguno$/i.test(viaje)) continue;
    if (!normalizarTexto(m.cuerpo).includes(normalizarTexto(evidencia))) continue;
    let destino: DestinoPlan | null = null;
    const nuevo = /^nuev[oa]\b[\s,.:;-]*(.*)$/i.exec(viaje);
    if (nuevo) {
      destino = nuevo[1].trim() ? { tipo: 'nuevo', cliente: nuevo[1].trim() } : null;
    } else {
      const v = viajes.find(x => codigoCompacto(x.codigo) === codigoCompacto(viaje));
      if (v) destino = destinoDeViaje(v);
    }
    if (destino && evidenciaApunta(evidencia, destino, viajes)) out.set(m.n, { destino, evidencia });
  }
  return out;
}

// ── El plan ──────────────────────────────────────────────────────────────────

export type PorQue = 'encabezado' | 'modelo' | 'bloque' | 'comercial';

export interface MensajePlan {
  n: number;
  destino: DestinoPlan | null;
  por: PorQue | null;
  evidencia: string | null;
  /** Por qué quedó sin asignar. */
  motivo?: string;
  /** Nombra a dos viajes: no se puede cargar entero en ninguno (F13). */
  varios?: boolean;
  /** El comercial pidió descartarlo. */
  descartado?: boolean;
}

/** Lo que se guarda en `wa_bandeja_entregas.plan_viajes`: la asignación por mensaje. */
export interface PlanViajes {
  version: 1;
  mensajes: MensajePlan[];
  /** Los números de los mensajes que fueron encabezados (no son contenido). */
  encabezados: number[];
  /** Lo que el bot tiene que decir del reparto («"Carolina" puede ser…»). */
  avisos: string[];
}

const MESES_TXT = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Lo que un mensaje dice de fechas y de adultos, para ver si choca con lo anterior de la caja. */
export function datosDelMensaje(cuerpo: string): { fechas: string[]; adultos: number[] } {
  const t = palabrasDe(cuerpo);
  const fechas: string[] = [];
  t.forEach((w, i) => {
    const mes = MESES_TXT.indexOf(w);
    if (mes < 0) return;
    // Los días antes del mes: «del 20 al 24 de noviembre», «el 28 de diciembre».
    for (let k = i - 1; k >= Math.max(0, i - 6); k--) {
      if (/^\d{1,2}$/.test(t[k])) fechas.push(`${Number(t[k])}-${mes + 1}`);
      else if (MESES_TXT.includes(t[k])) break;
    }
  });
  const adultos: number[] = [];
  t.forEach((w, i) => {
    if (/^(adultos?|adlts?)$/.test(w) && /^\d{1,2}$/.test(t[i - 1] ?? '')) adultos.push(Number(t[i - 1]));
  });
  return { fechas, adultos };
}

/** Un saludo que abre una conversación: «Hola Tati, buenas tardes», «Buenos días». */
const RE_SALUDO = /^(hola|buenas|buenos dias|buen dia|buenas tardes|buenas noches|que mas|quiubo)\b/;

/** ¿El mensaje dice fechas o adultos distintos de lo que ya dijo la caja? */
function chocaConLaCaja(m: { fechas: string[]; adultos: number[] }, caja: { fechas: Set<string>; adultos: Set<number> }): string | null {
  if (m.fechas.length > 0 && caja.fechas.size > 0 && !m.fechas.some(f => caja.fechas.has(f))) return 'dice otras fechas que lo anterior de esa caja';
  if (m.adultos.length > 0 && caja.adultos.size > 0 && !m.adultos.some(a => caja.adultos.has(a))) return 'dice otro número de adultos que lo anterior de esa caja';
  return null;
}

function lineaViaje(v: ViajeAbierto): string {
  return [v.codigo, v.cliente].filter(Boolean).join(' · ') || 'sin código';
}

function avisoEncabezado(e: NonNullable<Segmento['encabezado']>, cerrados: ReadonlySet<string>): string | null {
  const r = e.resolucion;
  if (r.tipo === 'ambiguo') return `«${e.texto}» puede ser ${r.candidatos.map(lineaViaje).join(' o ')}: no elegí. Dime cuál.`;
  if (r.tipo === 'codigo_desconocido') {
    return cerrados.has(r.codigo)
      ? `El viaje ${e.texto} está cerrado: no lo reabro ni cargo nada en él.`
      : `No existe un viaje abierto con el código ${e.texto}: no creé nada.`;
  }
  return null;
}

/**
 * Arma el plan. `asignaciones` es lo que el modelo propuso ya validado (vacío en modo `encabezado`).
 *   · caja de un encabezado resuelto → sus mensajes van a ese viaje, salvo los DUDOSOS, que quedan
 *     sin asignar con su motivo y rompen la caja (lo que sigue sin evidencia propia también):
 *       - nombra a dos viajes (VARIOS) o a otro viaje (F9, F13, el día);
 *       - nombra el destino de otro viaje abierto («para Cartagena» bajo «Carolina», que va a Punta Cana);
 *       - llega después de un silencio de más de `segundosBloque` dentro de la caja;
 *       - dice otras fechas u otro número de adultos que lo anterior de la caja (F4b);
 *     una evidencia propia que vuelve a nombrar la caja la restablece;
 *   · caja de un encabezado ambiguo o desconocido → solo lo que trae evidencia propia;
 *   · bloque por silencio → si toda la evidencia del bloque apunta a UN viaje, el bloque va ahí
 *     (con los mismos dudosos); si apunta a varios, solo los mensajes con evidencia; sin evidencia, nada.
 */
export function armarPlan(p: {
  mensajes: ReadonlyArray<MensajeViaje>;
  viajes: ReadonlyArray<ViajeAbierto>;
  segmentos: ReadonlyArray<Segmento>;
  encabezados: ReadonlyArray<number>;
  asignaciones: ReadonlyMap<number, AsignacionModelo>;
  /** Códigos compactos de viajes CERRADOS del workspace, para decir «está cerrado» y no «no existe». */
  codigosCerrados?: ReadonlySet<string>;
  /** El silencio que, dentro de una caja, hace dudoso lo que sigue (`segundos_bloque`). */
  segundosBloque?: number;
}): PlanViajes {
  const porN = new Map(p.mensajes.map(m => [m.n, m]));
  const silencio = (p.segundosBloque ?? 600) * 1000;
  const destinosConocidos: DestinoPlan[] = [
    ...p.viajes.map(destinoDeViaje),
    ...p.segmentos.flatMap(s => (s.encabezado?.resolucion.tipo === 'nuevo' ? [{ tipo: 'nuevo', cliente: s.encabezado.resolucion.cliente } as DestinoPlan] : [])),
  ];
  const destinoDe = (d: DestinoPlan | null) => (d?.tipo === 'existente' ? normalizarNombre(p.viajes.find(v => v.id === d.negocio_id)?.destino ?? null) : '');
  const plan: PlanViajes = { version: 1, mensajes: [], encabezados: [...p.encabezados], avisos: [] };
  const poner = (x: MensajePlan) => plan.mensajes.push(x);

  for (const seg of p.segmentos) {
    const res = seg.encabezado?.resolucion ?? null;
    if (seg.encabezado) {
      const aviso = avisoEncabezado(seg.encabezado, p.codigosCerrados ?? new Set());
      if (aviso) plan.avisos.push(aviso);
    }
    // La evidencia de cada mensaje: la del modelo (validada) y la que se ve sin modelo (el nombre).
    // Si dicen viajes distintos, no hay evidencia: se pregunta.
    const evidencia = new Map<number, AsignacionModelo | 'choque' | 'varios'>();
    for (const n of seg.mensajes) {
      const m = porN.get(n);
      if (!m) continue;
      const nombrados = viajesNombrados(m.cuerpo, destinosConocidos, p.viajes);
      const delModelo = p.asignaciones.get(n);
      if (nombrados.length >= 2) evidencia.set(n, 'varios');
      else if (delModelo && nombrados.length === 1 && claveDestino(nombrados[0]) !== claveDestino(delModelo.destino)) evidencia.set(n, 'choque');
      else if (delModelo) evidencia.set(n, delModelo);
      else if (nombrados.length === 1) evidencia.set(n, { destino: nombrados[0], evidencia: nombrados[0].cliente ?? '' });
    }
    const evidenciasDelBloque = new Map<string, DestinoPlan>();
    for (const e of evidencia.values()) if (typeof e === 'object') evidenciasDelBloque.set(claveDestino(e.destino), e.destino);

    // La caja: la del encabezado, o la del único viaje con evidencia en un bloque por silencio.
    const caja: DestinoPlan | null = res?.tipo === 'viaje' ? destinoDeViaje(res.viaje)
      : res?.tipo === 'nuevo' ? { tipo: 'nuevo', cliente: res.cliente }
      : !seg.encabezado && evidenciasDelBloque.size === 1 ? [...evidenciasDelBloque.values()][0] : null;
    const porQueCaja: PorQue = seg.encabezado ? 'encabezado' : 'bloque';
    const nombreCaja = seg.encabezado ? `el encabezado «${seg.encabezado.texto}»` : `el bloque de ${caja?.cliente ?? 'ese viaje'}`;
    const vistos = { fechas: new Set<string>(), adultos: new Set<number>() };
    let rota = false;
    let enLaCaja = 0;
    let ultimo = seg.encabezado ? Date.parse(p.mensajes.find(x => x.n === seg.encabezado!.n)?.en ?? '') : NaN;

    for (const n of seg.mensajes) {
      const m = porN.get(n);
      if (!m) continue;
      const t = Date.parse(m.en);
      const trasSilencio = Number.isFinite(ultimo) && Number.isFinite(t) && t - ultimo > silencio;
      ultimo = t;
      const ev = evidencia.get(n);
      if (ev === 'varios') {
        const nombrados = viajesNombrados(m.cuerpo, destinosConocidos, p.viajes);
        poner({ n, destino: null, por: null, evidencia: null, varios: true, motivo: `habla de dos viajes (${nombrados.map(d => d.cliente).join(' y ')})` });
        rota = true;
        continue;
      }
      if (ev === 'choque') {
        poner({ n, destino: null, por: null, evidencia: null, motivo: 'el texto y la propuesta no coinciden en el viaje' });
        rota = true;
        continue;
      }
      const a = ev;
      if (!caja) {
        // Sin caja: solo lo que trae evidencia propia.
        if (a) poner({ n, destino: a.destino, por: 'modelo', evidencia: a.evidencia });
        else {
          const motivo = seg.encabezado ? `${nombreCaja} no se pudo resolver`
            : evidenciasDelBloque.size > 1 ? 'el bloque tiene mensajes de varios viajes' : 'sin pista de a qué viaje va';
          poner({ n, destino: null, por: null, evidencia: null, motivo });
        }
        continue;
      }
      if (a && claveDestino(a.destino) !== claveDestino(caja)) {
        // No se pasa solo al otro viaje («Luisa me recomendó» en el chat de Carolina, F9).
        rota = true;
        poner({ n, destino: null, por: null, evidencia: a.evidencia, motivo: `nombra a ${a.destino.cliente ?? 'otro viaje'} («${a.evidencia}») y está bajo ${nombreCaja}` });
        continue;
      }
      const datos = datosDelMensaje(m.cuerpo);
      if (a) {
        // Una evidencia propia de la caja la restablece.
        rota = false;
        poner({ n, destino: caja, por: 'modelo', evidencia: a.evidencia });
      } else {
        const otroDestino = destinosNombrados(m.cuerpo, p.viajes).find(d => d !== destinoDe(caja) && !destinoDe(caja).includes(d));
        const saludoAMitad = enLaCaja > 0 && RE_SALUDO.test(normalizarTexto(m.cuerpo));
        const duda = rota ? 'viene después de un mensaje dudoso, sin pista propia'
          : otroDestino && caja.tipo === 'existente' ? `habla de ${otroDestino.toUpperCase()} y ${caja.codigo ?? 'ese viaje'} va a ${destinoDe(caja).toUpperCase() || 'otro lugar'}`
          : saludoAMitad ? 'un saludo a mitad de la caja suele abrir otra conversación'
          : trasSilencio ? `llegó después de un silencio, sin pista de que siga siendo de ${caja.cliente ?? 'ese viaje'}`
          : chocaConLaCaja(datos, vistos);
        if (duda) {
          rota = true;
          poner({ n, destino: null, por: null, evidencia: null, motivo: `${duda} (¿es de ${caja.cliente ?? 'ese viaje'}?)` });
          continue;
        }
        poner({ n, destino: caja, por: porQueCaja, evidencia: null });
      }
      enLaCaja++;
      for (const f of datos.fechas) vistos.fechas.add(f);
      for (const x of datos.adultos) vistos.adultos.add(x);
    }
  }
  plan.mensajes.sort((a, b) => a.n - b.n);
  return plan;
}

/** Los viajes del plan, en el orden en que aparecen, con sus mensajes. */
export function gruposDelPlan(plan: PlanViajes): Array<{ k: number; destino: DestinoPlan; mensajes: number[] }> {
  const grupos = new Map<string, { destino: DestinoPlan; mensajes: number[] }>();
  for (const m of plan.mensajes) {
    if (!m.destino || m.descartado) continue;
    const c = claveDestino(m.destino);
    if (!grupos.has(c)) grupos.set(c, { destino: m.destino, mensajes: [] });
    grupos.get(c)!.mensajes.push(m.n);
  }
  return [...grupos.values()].map((g, i) => ({ k: i + 1, ...g }));
}

export function sinAsignar(plan: PlanViajes): MensajePlan[] {
  return plan.mensajes.filter(m => !m.destino && !m.descartado);
}

/** ¿Se puede cargar sin preguntar? Solo con `confirmar: si_duda`: un viaje, por encabezado, sin avisos. */
export function planSinDudas(plan: PlanViajes): boolean {
  return gruposDelPlan(plan).length === 1 && sinAsignar(plan).length === 0 && plan.avisos.length === 0
    && plan.mensajes.every(m => m.descartado || m.por === 'encabezado' || m.por === 'comercial');
}

function nombreDestino(d: DestinoPlan): string {
  return d.tipo === 'nuevo' ? `NUEVO ${d.cliente ?? '(sin nombre)'}` : [d.codigo, d.cliente].filter(Boolean).join(' · ') || 'sin código';
}

function recorte(t: string, n = 40): string {
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

const MAX_CON_TEXTO = 25;
/** WhatsApp corta en 4.096 caracteres; se deja margen. */
export const MAX_LARGO_RESUMEN = 3800;

/** «2-4, 6, 9-10»: los números de una lista, en rangos. */
export function rangos(ns: ReadonlyArray<number>): string {
  const o = [...ns].sort((a, b) => a - b);
  const partes: string[] = [];
  for (let i = 0; i < o.length; i++) {
    let j = i;
    while (j + 1 < o.length && o[j + 1] === o[j] + 1) j++;
    partes.push(j > i ? `${o[i]}-${o[j]}` : `${o[i]}`);
    i = j;
  }
  return partes.join(', ');
}

/**
 * El resumen que ve el comercial antes de cargar:
 *   «Entendí 2 viajes: 1) T1 26 11 · CAROLINA (3 mensajes) 2) NUEVO Luisa (2 mensajes).
 *    Sin asignar: 1 mensaje. ¿Así? sí / corregir».
 * Con pocos mensajes muestra el comienzo de cada uno; con muchos, los asignados van en rangos y
 * los DUDOSOS (sin asignar) siempre con su texto y su motivo. Nunca pasa de `MAX_LARGO_RESUMEN`.
 */
export function textoResumenPlan(plan: PlanViajes, mensajes: ReadonlyArray<MensajeViaje>, aviso?: string): string {
  const armar = (conTexto: boolean, largo: number) => {
    const porN = new Map(mensajes.map(m => [m.n, m]));
    const linea = (n: number) => `   ${n} «${recorte(porN.get(n)?.cuerpo ?? '', largo)}»`;
    const grupos = gruposDelPlan(plan);
    const sueltos = sinAsignar(plan);
    const out: string[] = aviso ? [aviso] : [];
    out.push(grupos.length === 0 ? 'No pude asignar ningún mensaje a un viaje.' : `Entendí ${grupos.length} ${grupos.length === 1 ? 'viaje' : 'viajes'}:`);
    for (const g of grupos) {
      const n = g.mensajes.length;
      out.push(`${g.k}) ${nombreDestino(g.destino)} (${n} ${n === 1 ? 'mensaje' : 'mensajes'}${conTexto ? '' : `: ${rangos(g.mensajes)}`})`);
      if (conTexto) out.push(...g.mensajes.map(linea));
    }
    if (sueltos.length > 0) {
      out.push(`⚠ Sin asignar (hay que decidir antes del sí): ${sueltos.length} ${sueltos.length === 1 ? 'mensaje' : 'mensajes'}`);
      out.push(...sueltos.map(m => `${linea(m.n)} (${m.motivo ?? 'sin pista'})`));
    }
    const descartados = plan.mensajes.filter(m => m.descartado).map(m => m.n);
    if (descartados.length > 0) out.push(`Descartados: ${rangos(descartados)}`);
    out.push(...plan.avisos);
    out.push(sueltos.length > 0
      ? 'No cargué nada todavía. Dime qué hago con los sin asignar: «el 4 es de Luisa», «el 4 es del 2», «el 4 es nuevo Pedro», «descartar el 4» o «descartar los sin asignar». DESCARTAR descarta todo.'
      : 'No cargué nada todavía. ¿Así? Responde SÍ, o corrige: «el 4 es de Luisa», «el 4 es del 2», «el 4 es nuevo Pedro», «descartar el 4». DESCARTAR descarta todo.');
    return out.join('\n');
  };
  const conTexto = plan.mensajes.length <= MAX_CON_TEXTO;
  for (const largo of [40, 28, 18]) {
    const t = armar(conTexto, largo);
    if (t.length <= MAX_LARGO_RESUMEN) return t;
    const sinTexto = armar(false, largo);
    if (sinTexto.length <= MAX_LARGO_RESUMEN) return sinTexto;
  }
  return armar(false, 12).slice(0, MAX_LARGO_RESUMEN);
}

// ── La respuesta al resumen ──────────────────────────────────────────────────

const SI = new Set(['si', 'sii', 'si senor', 'si senora', 'confirmo', 'correcto', 'dale', 'asi es', 'asi esta', 'si asi es', 'si asi esta', 'si correcto', 'si dale', 'si confirmo', 'cargar', 'cargalos']);

/** ¿Es un «sí» sin peros? «ok pero falta uno», «sí no» y un sticker NO lo son (F11). */
export function esSi(texto: string): boolean {
  const t = normalizarTexto(texto).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  return SI.has(t);
}

export type Cambio = { ns: number[]; a: DestinoPlan | 'descartar' };

export type RespuestaPlan =
  | { tipo: 'si' }
  | { tipo: 'descartar_todo' }
  | { tipo: 'corregir'; cambios: Cambio[] }
  | { tipo: 'como_corregir' }
  | { tipo: 'no_entendida'; aviso?: string };

function leerNumeros(t: string): number[] {
  return [...t.matchAll(/\d+/g)].map(m => Number(m[0]));
}

/** El destino de una corrección: «Luisa», «del 2», «T1 26 9», «nuevo Pedro», «descartar». */
function destinoDeCorreccion(texto: string, plan: PlanViajes, viajes: ReadonlyArray<ViajeAbierto>): DestinoPlan | 'descartar' | null {
  const t = texto.trim().replace(/^(de|del|para|al|a)\s+/i, '').trim();
  const n = normalizarTexto(t);
  if (/^(descartar|descartalo|descartalos|ninguno|ninguna|nada|basura|no va|no van|fuera)$/.test(n)) return 'descartar';
  const nuevo = /^nuev[oa]\b[\s,.:;-]*(.*)$/i.exec(t);
  if (nuevo) return { tipo: 'nuevo', cliente: nuevo[1].trim() || null };
  const k = /^(?:viaje\s*)?(\d{1,2})$/.exec(n);
  if (k) {
    const g = gruposDelPlan(plan).find(x => x.k === Number(k[1]));
    return g ? g.destino : null;
  }
  // Un NUEVO del plan por su nombre («de Luisa» con «NUEVO Luisa» en el resumen).
  const nuevos = gruposDelPlan(plan).map(g => g.destino).filter((d): d is Extract<DestinoPlan, { tipo: 'nuevo' }> => d.tipo === 'nuevo');
  const palabras = palabrasDe(t).filter(w => !RELLENO.has(w));
  const nuevoPorNombre = nuevos.filter(d => palabras.length > 0 && palabras.every(w => palabraDelNombre(w, d.cliente)));
  const r = resolverEncabezado(t, viajes);
  const candidatos: DestinoPlan[] = [...nuevoPorNombre, ...(r?.tipo === 'viaje' ? [destinoDeViaje(r.viaje)] : [])];
  return candidatos.length === 1 ? candidatos[0] : null;
}

/**
 * La respuesta del comercial al resumen. Solo un «sí» sin peros carga; «corregir» sin detalle
 * explica cómo; cada corrección mueve mensajes («el 4 es de Luisa», «el 4 y el 5 son del 2»,
 * «descartar el 6»). Si UNA parte no se entiende, no se aplica ninguna.
 */
export function interpretarRespuestaPlan(texto: string, plan: PlanViajes, viajes: ReadonlyArray<ViajeAbierto>): RespuestaPlan {
  const bruto = String(texto ?? '').trim();
  if (!bruto) return { tipo: 'no_entendida' };
  if (esSi(bruto)) {
    // Un «sí» no descarta en silencio: con mensajes sin asignar no se acepta (QA de #971, 13 por día).
    const sueltos = sinAsignar(plan).map(m => m.n);
    if (sueltos.length > 0) {
      return { tipo: 'no_entendida', aviso: `Antes del sí, dime qué hago con ${sueltos.length === 1 ? 'el' : 'los'} ${rangos(sueltos)}: «el ${sueltos[0]} es de …», «descartar el ${sueltos[0]}» o «descartar los sin asignar».` };
    }
    return { tipo: 'si' };
  }
  const t = normalizarTexto(bruto).replace(/[.!¡¿?]+$/g, '').trim();
  if (/^(descartar|descartar todo|descartalo todo|descarta todo|borrar todo)$/.test(t)) return { tipo: 'descartar_todo' };
  if (/^descart\w* (los |el )?(sin asignar|sueltos|demas|resto)$/.test(t)) {
    const sueltos = sinAsignar(plan).map(m => m.n);
    return sueltos.length > 0 ? { tipo: 'corregir', cambios: [{ ns: sueltos, a: 'descartar' }] } : { tipo: 'no_entendida', aviso: 'No hay mensajes sin asignar.' };
  }
  if (/^(corregir|corrijo|no|cambiar)$/.test(t)) return { tipo: 'como_corregir' };

  const existentes = new Set(plan.mensajes.map(m => m.n));
  const cambios: Cambio[] = [];
  const partes = bruto.replace(/^corregir\s*[:,-]?\s*/i, '').split(/\s*[;\n]\s*|\.\s+/).filter(Boolean);
  for (const parte of partes) {
    const desc = /^(?:descartar|descarta|quitar|quita|sacar|saca|borrar|borra)\s+(?:el|la|los|las)?\s*([\d\s,ye]+)$/i.exec(parte.trim());
    if (desc) {
      cambios.push({ ns: leerNumeros(desc[1]), a: 'descartar' });
      continue;
    }
    const mov = /^(?:el|la|los|las|mensaje|mensajes)?\s*((?:\d+)(?:\s*(?:,|y|e)\s*(?:el\s+|la\s+)?\d+)*)\s+(?:(?:es|son|va|van)\s+)?(.+)$/i.exec(parte.trim());
    if (!mov) return { tipo: 'no_entendida' };
    const a = destinoDeCorreccion(mov[2], plan, viajes);
    if (!a) return { tipo: 'no_entendida', aviso: `No sé a qué viaje te refieres con «${recorte(mov[2], 30)}».` };
    cambios.push({ ns: leerNumeros(mov[1]), a });
  }
  if (cambios.length === 0) return { tipo: 'no_entendida' };
  for (const c of cambios) {
    const fuera = c.ns.filter(n => !existentes.has(n));
    if (c.ns.length === 0 || fuera.length > 0) return { tipo: 'no_entendida', aviso: `No hay mensaje ${fuera.join(', ') || ''} en el resumen.`.replace('  ', ' ') };
    const varios = c.ns.filter(n => plan.mensajes.find(m => m.n === n)?.varios);
    if (c.a !== 'descartar' && varios.length > 0) {
      return { tipo: 'no_entendida', aviso: `El ${varios.join(', ')} habla de dos viajes: no lo cargo entero en uno. Descártalo y escribe el dato en la ficha de cada viaje.` };
    }
  }
  return { tipo: 'corregir', cambios };
}

/** Aplica las correcciones: el comercial manda. */
export function aplicarCambios(plan: PlanViajes, cambios: ReadonlyArray<Cambio>): PlanViajes {
  const mensajes = plan.mensajes.map(m => ({ ...m }));
  for (const c of cambios) {
    for (const n of c.ns) {
      const m = mensajes.find(x => x.n === n);
      if (!m) continue;
      if (c.a === 'descartar') {
        Object.assign(m, { destino: null, por: 'comercial', descartado: true, motivo: undefined });
      } else {
        Object.assign(m, { destino: c.a, por: 'comercial', descartado: false, motivo: undefined });
      }
    }
  }
  return { ...plan, mensajes, avisos: [] };
}

/** Cómo se corrige, cuando la respuesta fue «corregir» a secas. */
export const TEXTO_COMO_CORREGIR = 'Dime qué mensaje va a qué viaje: «el 4 es de Luisa», «el 4 y el 5 son del 2», «el 6 es nuevo Pedro» o «descartar el 6».';
