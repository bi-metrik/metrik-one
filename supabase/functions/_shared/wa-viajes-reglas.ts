// ============================================================
// Varios viajes en una entrega (modo `encabezado`) — las reglas, sin I/O
// ------------------------------------------------------------
// Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-01-varios-viajes-y-guardianes.md,
// parte 1, con la decisión de Mauricio del 2026-10-01 tras el QA de #971: MANDA EL ENCABEZADO.
//
// Tatiana atiende a varios clientes a la vez y reenvía lo de todos. Un reenvío de WhatsApp no
// dice de qué chat viene: la pista la da ella con un ENCABEZADO («Carolina», «T1 26 9», «nuevo
// Luisa») y el código asigna, sin modelo.
//
// Reglas que no se negocian:
//   1. Un encabezado se resuelve de forma DETERMINISTA contra los viajes abiertos: código exacto,
//      o un nombre/destino con un solo candidato. Con dos o ninguno se pregunta; nunca se elige.
//   2. Un encabezado resuelto fija el viaje de todo lo que sigue, hasta el siguiente encabezado, el
//      cierre o el vencimiento de la caja (`horas_caja_activa`).
//   3. Sin encabezados, la tanda entera es UN viaje y se pregunta «¿A qué viaje van?», como siempre.
//   4. Lo único que se infiere es marcar SOSPECHOSOS dentro de una caja; el comercial decide
//      «dejar» o «mover a…». Nada se carga hasta el «sí», y el «sí» no vale con algo por decidir.
//   5. Un mensaje que nombra a dos viajes no se carga entero en ninguno (F13): solo se descarta.
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
  | { tipo: 'codigo_desconocido'; codigo: string }
  /** Parece un encabezado (corto, escrito) pero no se resuelve: corta la caja (QA de #971 v3). */
  | { tipo: 'no_reconocido' };

/** Palabras de relleno de un encabezado: «la de punta cana», «cliente Carolina», «el viaje de Jorge». */
const RELLENO = new Set([
  'la', 'el', 'lo', 'los', 'las', 'de', 'del', 'para', 'a', 'al', 'y', 'con', 'cliente', 'clienta', 'viaje',
  'senora', 'senor', 'sra', 'sr', 'don', 'dona', 'familia', 'ahora', 'sigue', 'siguen', 'van', 'va', 'esto', 'estos', 'es',
]);
export const MAX_PALABRAS_ENCABEZADO = 5;

/**
 * Distancia de edición con transposición de dos letras vecinas como UN error (Damerau, variante
 * OSA): «Lusia» está a 1 de «Luisa», igual que «Carlina» de «Carolina» y «Jorje» de «Jorge».
 */
export function distancia(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Qué tan lejos está esta palabra del nombre: 0 igual, 1 un error de tipeo (palabras de 5+), Infinity si no. */
function distanciaAlNombre(w: string, nombre: string | null): number {
  let mejor = Infinity;
  for (const p of normalizarNombre(nombre).split(' ')) {
    if (p.length < 3) continue;
    if (p === w) return 0;
    if (p.length >= 5 && w.length >= 5 && distancia(p, w) <= 1) mejor = 1;
  }
  return mejor;
}

/** ¿Esta palabra es una palabra del nombre? Igual, o con un error de tipeo si es larga («Carlina»). */
function palabraDelNombre(w: string, nombre: string | null): boolean {
  return distanciaAlNombre(w, nombre) <= 1;
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

  // Por nombre: los candidatos a la MENOR distancia. Si quedan dos a la misma, se pregunta.
  const distancias = viajes.map(v => ({ v, d: Math.max(...resto.map(w => distanciaAlNombre(w, v.cliente))) }));
  const minima = Math.min(...distancias.map(x => x.d));
  const porNombre = Number.isFinite(minima) ? distancias.filter(x => x.d === minima).map(x => x.v) : [];
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


// ── Segmentos: solo por encabezado ───────────────────────────────────────────

export interface Segmento {
  /** `encabezado`: la caja de un encabezado. `sin_encabezado`: lo que llegó antes del primero o con la caja vencida. */
  origen: 'encabezado' | 'sin_encabezado';
  encabezado: { n: number; texto: string; resolucion: ResolucionEncabezado } | null;
  mensajes: number[];
}

/**
 * Los segmentos de una entrega: cada encabezado abre una caja que vale hasta el siguiente
 * encabezado, el cierre o `horasCajaActiva`. Lo que llega sin caja (antes del primer encabezado o
 * con la caja vencida) va a un segmento `sin_encabezado`: no se adivina de quién es. No se
 * segmenta por silencios ni por contenido (decisión de Mauricio, 2026-10-01: manda el encabezado).
 */
export function armarSegmentos(
  mensajes: ReadonlyArray<MensajeViaje>,
  viajes: ReadonlyArray<ViajeAbierto>,
  cfg: { horasCajaActiva: number },
): { segmentos: Segmento[]; encabezados: number[] } {
  const segmentos: Segmento[] = [];
  const encabezados: number[] = [];
  let caja: { seg: Segmento; desde: number } | null = null;
  let suelto: Segmento | null = null;
  for (const m of [...mensajes].sort((a, b) => a.n - b.n)) {
    const t = Date.parse(m.en);
    const escrito = !m.reenviado && m.tipo === 'text';
    const res = escrito ? (resolverEncabezado(m.cuerpo, viajes) ?? (pareceEncabezado(m.cuerpo) ? { tipo: 'no_reconocido' } as ResolucionEncabezado : null)) : null;
    if (res) {
      encabezados.push(m.n);
      const seg: Segmento = { origen: 'encabezado', encabezado: { n: m.n, texto: m.cuerpo.trim(), resolucion: res }, mensajes: [] };
      segmentos.push(seg);
      caja = { seg, desde: t };
      suelto = null;
      continue;
    }
    if (!m.cuerpo.trim()) continue; // un sticker o una foto sin pie no es contenido
    if (caja && !(t - caja.desde > cfg.horasCajaActiva * 3600_000)) {
      caja.seg.mensajes.push(m.n);
      continue;
    }
    caja = null;
    if (!suelto) {
      suelto = { origen: 'sin_encabezado', encabezado: null, mensajes: [] };
      segmentos.push(suelto);
    }
    suelto.mensajes.push(m.n);
  }
  return { segmentos, encabezados };
}

/** ¿La entrega tiene al menos un encabezado resuelto? Sin ninguno, la tanda entera es UN viaje y se pregunta como siempre. */
export function tieneEncabezados(segmentos: ReadonlyArray<Segmento>): boolean {
  return segmentos.some(s => s.encabezado !== null && s.encabezado.resolucion.tipo !== 'no_reconocido');
}

/** Palabras cortas que el comercial escribe y que NO son un nombre: no cortan la caja. */
const NO_ENCABEZADO = new Set([
  'ok', 'okey', 'oki', 'listo', 'si', 'no', 'gracias', 'dale', 'bueno', 'perfecto', 'claro', 'vale', 'jaja', 'jajaja',
  'ya', 'eso', 'esto', 'aja', 'hola', 'buenas', 'chao', 'genial', 'super', 'excelente', 'pendiente', 'espera', 'un', 'momento',
]);

/**
 * ¿Un escrito del comercial PARECE un encabezado aunque no se resuelva? Una o dos palabras, sin
 * números ni signos de pregunta ni palabras de conversación («ok», «gracias»), o algo con forma de
 * código. Si parece y no se resuelve, corta la caja: lo que sigue no hereda el viaje anterior
 * (QA de #971 v3: «Lusia» dejaba los mensajes de Luisa en la caja de Carolina).
 */
export function pareceEncabezado(texto: string): boolean {
  const bruto = String(texto ?? '').trim();
  if (!bruto || /[?¿]/.test(bruto)) return false;
  if (esCodigo(codigoCompacto(bruto))) return true;
  const palabras = palabrasDe(bruto);
  if (palabras.length === 0 || palabras.length > 2 || palabras.some(w => /\d/.test(w) || w.length < 3)) return false;
  return !palabras.some(w => NO_ENCABEZADO.has(w) || /^(ja)+$/.test(w));
}

// ── Destinos del plan ────────────────────────────────────────────────────────

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

// ── Lo que se ve sin modelo: nombres, lugares, presentaciones ────────────────

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

/** Los viajes (abiertos o NUEVO de un encabezado) que un mensaje nombra por el nombre del cliente, sin lugares. */
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

const RELACIONES = '(esposa|esposo|mama|mamá|papa|papá|madre|padre|hija|hijo|hermana|hermano|novia|novio|pareja|suegra|suegro|mujer|marido|asistente|secretaria|nuera|yerno|cunada|cunado|prima|primo|tia|tio|abuela|abuelo)';

/** ¿El mensaje dice que quien escribe es familiar (o asistente) del titular? «la esposa de Jorge». */
export function esFamiliarDe(cuerpo: string, titular: string | null): boolean {
  const t = ` ${palabrasDe(cuerpo).join(' ')} `;
  return palabrasDe(titular).filter(w => w.length >= 3).some(w => new RegExp(` ${RELACIONES} de ${w} `).test(t));
}

const RE_TERCERO = /(desde \$|precio por persona|aplican (condiciones|restricciones)|cupos limitados|\babono\b|\bcomprobante\b|\bconsignaci)/;
const RUIDO = new Set(['gracias', 'ok', 'okey', 'listo', 'dale', 'chao', 'buenas', 'noches', 'bueno', 'perfecto', 'si']);

/** ¿Es una promoción, un pago o ruido (lo que la bandeja clasifica como tercero o ruido sin modelo)? */
export function noEsDelCliente(cuerpo: string): boolean {
  const t = normalizarTexto(cuerpo);
  const palabras = palabrasDe(cuerpo);
  if (palabras.length === 0 || RE_TERCERO.test(t)) return true;
  return palabras.every(w => RUIDO.has(w) || /^(ja|je)+$/.test(w));
}

const RE_PRESENTACION = /(?:^|[\s,.;:¡!¿?])(?:soy|habla|te habla|me llamo|mi nombre es|de parte de|te escribe)\s+(?:la\s+|el\s+)?([A-ZÁÉÍÓÚÑa-záéíóúñü]+)/i;

/** El nombre con el que el mensaje se presenta («soy Andrés», «habla Luisa»), normalizado; `null` si no se presenta. */
export function seQuienSePresenta(cuerpo: string): string | null {
  const r = RE_PRESENTACION.exec(cuerpo);
  return r ? normalizarNombre(r[1]) : null;
}

// ── El plan ──────────────────────────────────────────────────────────────────

export type PorQue = 'encabezado' | 'comercial';

export interface MensajePlan {
  n: number;
  /** El viaje de su caja (o el que eligió el comercial). `null`: sin caja, o habla de dos viajes. */
  destino: DestinoPlan | null;
  por: PorQue | null;
  /** Por qué quedó sin caja, o por qué es sospechoso. */
  motivo?: string;
  /** Sospechoso dentro de una caja: se carga en `destino` solo si el comercial dice «dejar». */
  sospecha?: boolean;
  /** Nombra a dos viajes: no se puede cargar entero en ninguno (F13); solo se descarta. */
  varios?: boolean;
  /** El comercial pidió descartarlo. */
  descartado?: boolean;
}

/** Lo que se guarda en `wa_bandeja_entregas.plan_viajes`: la asignación por mensaje. */
export interface PlanViajes {
  version: 2;
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

function chocaConLaCaja(m: { fechas: string[]; adultos: number[] }, caja: { fechas: Set<string>; adultos: Set<number> }): string | null {
  // Un rango contra otro rango: una fecha suelta puede ser la salida o el regreso, no choca.
  if (m.fechas.length >= 2 && caja.fechas.size >= 2 && !m.fechas.some(f => caja.fechas.has(f))) return 'dice otras fechas que lo anterior de esta caja';
  if (m.adultos.length > 0 && caja.adultos.size > 0 && !m.adultos.some(a => caja.adultos.has(a))) return 'dice otro número de adultos que lo anterior de esta caja';
  return null;
}

function lineaViaje(v: ViajeAbierto): string {
  return [v.codigo, v.cliente].filter(Boolean).join(' · ') || 'sin código';
}

function avisoEncabezado(e: NonNullable<Segmento['encabezado']>, cerrados: ReadonlySet<string>): string | null {
  const r = e.resolucion;
  if (r.tipo === 'ambiguo') return `«${e.texto}» puede ser ${r.candidatos.map(lineaViaje).join(' o ')}: no elegí. Dime cuál.`;
  if (r.tipo === 'no_reconocido') return `No reconocí el encabezado «${e.texto}»: lo que sigue no lo cargo en el viaje anterior. Dime de qué viaje es.`;
  if (r.tipo === 'codigo_desconocido') {
    return cerrados.has(r.codigo)
      ? `El viaje ${e.texto} está cerrado: no lo reabro ni cargo nada en él.`
      : `No existe un viaje abierto con el código ${e.texto}: no creé nada.`;
  }
  return null;
}

/**
 * Arma el plan. MANDA EL ENCABEZADO: un encabezado resuelto fija el viaje de todo lo que sigue,
 * hasta el siguiente encabezado, el cierre o el vencimiento de la caja. Sin modelo.
 *
 * Lo único que se infiere es marcar SOSPECHOSOS dentro de una caja (quedan en la caja, pero no se
 * cargan hasta que el comercial diga «dejar» o «mover a…»):
 *   · nombra a dos viajes (además queda `varios`: solo se puede descartar);
 *   · nombra el destino de otro viaje abierto («para Cartagena» bajo «Carolina», que va a Punta Cana);
 *   · se presenta como otra persona («soy Andrés» bajo «Carolina»);
 *   · saluda a mitad de la caja;
 *   · dice otras fechas u otro número de adultos que lo anterior de la caja;
 *   · sigue a uno de esos (la conversación pudo cambiar) hasta que un mensaje vuelva a nombrar al cliente.
 * Lo que no tiene caja (antes del primer encabezado, caja vencida, encabezado ambiguo o
 * desconocido) queda sin asignar: el comercial dice a qué viaje va o lo descarta.
 */
export function armarPlan(p: {
  mensajes: ReadonlyArray<MensajeViaje>;
  viajes: ReadonlyArray<ViajeAbierto>;
  segmentos: ReadonlyArray<Segmento>;
  encabezados: ReadonlyArray<number>;
  /** Códigos compactos de viajes CERRADOS del workspace, para decir «está cerrado» y no «no existe». */
  codigosCerrados?: ReadonlySet<string>;
}): PlanViajes {
  const porN = new Map(p.mensajes.map(m => [m.n, m]));
  const destinosConocidos: DestinoPlan[] = [
    ...p.viajes.map(destinoDeViaje),
    ...p.segmentos.flatMap(s => (s.encabezado?.resolucion.tipo === 'nuevo' ? [{ tipo: 'nuevo', cliente: s.encabezado.resolucion.cliente } as DestinoPlan] : [])),
  ];
  const destinoDe = (d: DestinoPlan) => (d.tipo === 'existente' ? normalizarNombre(p.viajes.find(v => v.id === d.negocio_id)?.destino ?? null) : '');
  const plan: PlanViajes = { version: 2, mensajes: [], encabezados: [...p.encabezados], avisos: [] };

  for (const seg of p.segmentos) {
    const res = seg.encabezado?.resolucion ?? null;
    if (seg.encabezado) {
      const aviso = avisoEncabezado(seg.encabezado, p.codigosCerrados ?? new Set());
      if (aviso) plan.avisos.push(aviso);
    }
    const caja: DestinoPlan | null = res?.tipo === 'viaje' ? destinoDeViaje(res.viaje)
      : res?.tipo === 'nuevo' ? { tipo: 'nuevo', cliente: res.cliente } : null;
    const nombreCaja = caja?.cliente ?? 'ese viaje';
    const vistos = { fechas: new Set<string>(), adultos: new Set<number>() };
    let tras = false;
    let enLaCaja = 0;

    for (const n of seg.mensajes) {
      const m = porN.get(n);
      if (!m) continue;
      const nombrados = viajesNombrados(m.cuerpo, destinosConocidos, p.viajes);
      if (!caja) {
        const motivo = seg.encabezado ? `el encabezado «${seg.encabezado.texto}» no se pudo resolver` : 'llegó sin encabezado';
        plan.mensajes.push({ n, destino: null, por: null, motivo, ...(nombrados.length >= 2 ? { varios: true } : {}) });
        continue;
      }
      const presenta = seQuienSePresenta(m.cuerpo);
      // «habla Marta, la esposa de Jorge» bajo «Jorge»: un familiar del titular no es otra persona.
      const presentaLaCaja = !!presenta && (palabrasDe(caja.cliente).includes(presenta) || esFamiliarDe(m.cuerpo, caja.cliente));
      // «Soy Andrés Gil, me pasó tu número Luisa» bajo «nuevo Andrés Gil»: nombra a dos, pero se
      // presenta como el cliente de la caja. No es un mensaje de dos viajes.
      if (nombrados.length >= 2 && !presentaLaCaja) {
        plan.mensajes.push({ n, destino: null, por: null, varios: true, sospecha: true, motivo: `habla de dos viajes (${nombrados.map(d => d.cliente).join(' y ')})` });
        tras = true;
        enLaCaja++;
        continue;
      }
      const datos = datosDelMensaje(m.cuerpo);
      const nombraLaCaja = presentaLaCaja || (nombrados.length === 1 && claveDestino(nombrados[0]) === claveDestino(caja));
      const otroDestino = destinosNombrados(m.cuerpo, p.viajes).find(d => caja.tipo === 'existente' && d !== destinoDe(caja) && !destinoDe(caja).includes(d));
      const motivo = otroDestino ? `habla de ${otroDestino.toUpperCase()} y ${caja.tipo === 'existente' ? caja.codigo : 'esta caja'} va a ${destinoDe(caja).toUpperCase() || 'otro lugar'}`
        : presenta && !presentaLaCaja ? `se presenta como ${presenta.toUpperCase()}`
        : enLaCaja > 0 && RE_SALUDO.test(normalizarTexto(m.cuerpo)) && !nombraLaCaja ? 'saluda a mitad de la caja: puede ser otra conversación'
        : chocaConLaCaja(datos, vistos)
          ?? (tras && !nombraLaCaja ? 'sigue a un mensaje sospechoso' : null);
      if (nombraLaCaja && !motivo) tras = false;
      // Un mensaje que no es del cliente (una promoción, un pago, ruido) no contagia a los que siguen.
      if (motivo && !noEsDelCliente(m.cuerpo)) tras = true;
      plan.mensajes.push(motivo
        ? { n, destino: caja, por: 'encabezado', sospecha: true, motivo: `${motivo} (¿es de ${nombreCaja}?)` }
        : { n, destino: caja, por: 'encabezado' });
      if (!motivo) {
        for (const f of datos.fechas) vistos.fechas.add(f);
        for (const x of datos.adultos) vistos.adultos.add(x);
      }
      enLaCaja++;
    }
  }
  plan.mensajes.sort((a, b) => a.n - b.n);
  return plan;
}

/** Los viajes del plan, en el orden en que aparecen, con sus mensajes (los sospechosos incluidos, marcados aparte). */
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

/** Lo que el comercial tiene que decidir antes del «sí»: sin caja, sospechosos y los de dos viajes. */
export function pendientes(plan: PlanViajes): MensajePlan[] {
  return plan.mensajes.filter(m => !m.descartado && (!m.destino || m.sospecha));
}

/** Lo que quedó sin viaje (sin caja o de dos viajes). */
export function sinAsignar(plan: PlanViajes): MensajePlan[] {
  return plan.mensajes.filter(m => !m.destino && !m.descartado);
}

/** ¿Se puede cargar sin preguntar? Solo con `confirmar: si_duda` y nada pendiente ni avisos. */
export function planSinDudas(plan: PlanViajes): boolean {
  return pendientes(plan).length === 0 && plan.avisos.length === 0 && gruposDelPlan(plan).length > 0;
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
 * El resumen antes de cargar, en uno o más mensajes de hasta `MAX_LARGO_RESUMEN` caracteres.
 * Cada mensaje CARGADO de cada caja va en su propia línea con sus primeras palabras (no solo el
 * rango): un encabezado olvidado, seguido de mensajes sin fechas ni adultos ni destino, cae en la
 * caja anterior sin que el código lo pueda ver; así Tatiana lo ve antes del «sí» (QA de #971 v3,
 * R2). Lo que hay que decidir va aparte, con su texto y su motivo. Si no cabe en un mensaje, se
 * parte por líneas; el cierre con las instrucciones va siempre en el último.
 */
export function partesResumenPlan(plan: PlanViajes, mensajes: ReadonlyArray<MensajeViaje>, aviso?: string): string[] {
  const porN = new Map(mensajes.map(m => [m.n, m]));
  const linea = (n: number, largo: number) => `   ${n} «${recorte(porN.get(n)?.cuerpo ?? '', largo)}»`;
  const grupos = gruposDelPlan(plan);
  const porDecidir = pendientes(plan);
  const largo = plan.mensajes.length <= MAX_CON_TEXTO ? 40 : 30;
  const lineas: string[] = aviso ? [aviso] : [];
  lineas.push(grupos.length === 0 ? 'No hay mensajes con un viaje asignado.' : `Entendí ${grupos.length} ${grupos.length === 1 ? 'viaje' : 'viajes'}:`);
  for (const g of grupos) {
    const n = g.mensajes.length;
    lineas.push(`${g.k}) ${nombreDestino(g.destino)} (${n} ${n === 1 ? 'mensaje' : 'mensajes'})`);
    lineas.push(...g.mensajes.map(n2 => `${linea(n2, largo)}${plan.mensajes.find(x => x.n === n2)?.sospecha ? ' ⚠' : ''}`));
  }
  if (porDecidir.length > 0) {
    lineas.push(`⚠ Para decidir antes del sí: ${porDecidir.length} ${porDecidir.length === 1 ? 'mensaje' : 'mensajes'}`);
    lineas.push(...porDecidir.map(m => `${linea(m.n, 40)} (${m.motivo ?? 'sin viaje'})`));
  }
  const descartados = plan.mensajes.filter(m => m.descartado).map(m => m.n);
  if (descartados.length > 0) lineas.push(`Descartados: ${rangos(descartados)}`);
  lineas.push(...plan.avisos);
  lineas.push(porDecidir.length > 0
    ? 'No cargué nada todavía. Para cada uno: «dejar el 4» (o «dejar todos»), «el 4 es de Luisa» / «el 4 es del 2» / «el 4 es nuevo Pedro» para moverlo, o «descartar el 4». Después, SÍ. DESCARTAR descarta todo.'
    : 'No cargué nada todavía. Revisa que cada mensaje esté en su viaje. ¿Así? Responde SÍ, o corrige: «el 4 es de Luisa», «descartar el 4». DESCARTAR descarta todo.');

  const partes: string[] = [];
  let actual = '';
  for (const l of lineas) {
    const candidato = actual ? `${actual}\n${l}` : l;
    if (candidato.length > MAX_LARGO_RESUMEN && actual) {
      partes.push(actual);
      actual = l;
    } else {
      actual = candidato;
    }
  }
  if (actual) partes.push(actual);
  if (partes.length > 1) return partes.map((p, k) => `(${k + 1}/${partes.length}) ${p}`.slice(0, MAX_LARGO_RESUMEN));
  return partes;
}

/** El resumen en un solo texto (las partes unidas). Para enviarlo, usar `partesResumenPlan`. */
export function textoResumenPlan(plan: PlanViajes, mensajes: ReadonlyArray<MensajeViaje>, aviso?: string): string {
  return partesResumenPlan(plan, mensajes, aviso).join('\n');
}

// ── La respuesta al resumen ──────────────────────────────────────────────────

const SI = new Set(['si', 'sii', 'si senor', 'si senora', 'confirmo', 'correcto', 'dale', 'asi es', 'asi esta', 'si asi es', 'si asi esta', 'si correcto', 'si dale', 'si confirmo', 'cargar', 'cargalos']);

/** ¿Es un «sí» sin peros? «ok pero falta uno», «sí no» y un sticker NO lo son (F11). */
export function esSi(texto: string): boolean {
  const t = normalizarTexto(texto).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  return SI.has(t);
}

export type Cambio = { ns: number[]; a: DestinoPlan | 'descartar' | 'dejar' };

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
  const nuevos = gruposDelPlan(plan).map(g => g.destino).filter((d): d is Extract<DestinoPlan, { tipo: 'nuevo' }> => d.tipo === 'nuevo');
  const palabras = palabrasDe(t).filter(w => !RELLENO.has(w));
  const nuevoPorNombre = nuevos.filter(d => palabras.length > 0 && palabras.every(w => palabraDelNombre(w, d.cliente)));
  const r = resolverEncabezado(t, viajes);
  const candidatos: DestinoPlan[] = [...nuevoPorNombre, ...(r?.tipo === 'viaje' ? [destinoDeViaje(r.viaje)] : [])];
  return candidatos.length === 1 ? candidatos[0] : null;
}

/**
 * La respuesta del comercial al resumen. Solo un «sí» sin peros carga, y solo cuando no queda nada
 * por decidir. Las decisiones: «dejar el 4» / «dejar todos» (el sospechoso se queda en su caja),
 * «el 4 es de Luisa» / «mover el 4 a Luisa» (otro viaje), «descartar el 4» / «descartar los
 * pendientes». Si UNA parte no se entiende, no se aplica ninguna.
 */
export function interpretarRespuestaPlan(texto: string, plan: PlanViajes, viajes: ReadonlyArray<ViajeAbierto>): RespuestaPlan {
  const bruto = String(texto ?? '').trim();
  if (!bruto) return { tipo: 'no_entendida' };
  const porDecidir = pendientes(plan);
  if (esSi(bruto)) {
    if (porDecidir.length > 0) {
      const ns = porDecidir.map(m => m.n);
      return { tipo: 'no_entendida', aviso: `Antes del sí, decide ${ns.length === 1 ? 'el' : 'los'} ${rangos(ns)}: «dejar el ${ns[0]}», «el ${ns[0]} es de …» o «descartar el ${ns[0]}».` };
    }
    return { tipo: 'si' };
  }
  const t = normalizarTexto(bruto).replace(/[.!¡¿?]+$/g, '').trim();
  if (/^(descartar|descartar todo|descartalo todo|descarta todo|borrar todo)$/.test(t)) return { tipo: 'descartar_todo' };
  if (/^(corregir|corrijo|no|cambiar)$/.test(t)) return { tipo: 'como_corregir' };
  if (/^dejar (todos|todo|los sospechosos|los demas)$/.test(t)) {
    const ns = porDecidir.filter(m => m.sospecha && m.destino && !m.varios).map(m => m.n);
    return ns.length > 0 ? { tipo: 'corregir', cambios: [{ ns, a: 'dejar' }] } : { tipo: 'no_entendida', aviso: 'No hay sospechosos para dejar.' };
  }
  if (/^descart\w* (los |el )?(sin asignar|sueltos|demas|resto|pendientes|sospechosos)$/.test(t)) {
    const ns = porDecidir.map(m => m.n);
    return ns.length > 0 ? { tipo: 'corregir', cambios: [{ ns, a: 'descartar' }] } : { tipo: 'no_entendida', aviso: 'No hay nada pendiente.' };
  }

  const existentes = new Set(plan.mensajes.map(m => m.n));
  const cambios: Cambio[] = [];
  const partes = bruto.replace(/^corregir\s*[:,-]?\s*/i, '').split(/\s*[;\n]\s*|\.\s+/).filter(Boolean);
  for (const parte of partes) {
    const p = parte.trim();
    const desc = /^(?:descartar|descarta|quitar|quita|sacar|saca|borrar|borra)\s+(?:el|la|los|las)?\s*([\d\s,ye]+)$/i.exec(p);
    if (desc) { cambios.push({ ns: leerNumeros(desc[1]), a: 'descartar' }); continue; }
    const dejar = /^(?:dejar|deja|dejalo|dejalos)\s+(?:el|la|los|las)?\s*([\d\s,ye]+)$/i.exec(p);
    if (dejar) { cambios.push({ ns: leerNumeros(dejar[1]), a: 'dejar' }); continue; }
    const mover = /^(?:mover|mueve|pasar|pasa)\s+(?:el|la|los|las)?\s*((?:\d+)(?:\s*(?:,|y|e)\s*(?:el\s+|la\s+)?\d+)*)\s+(?:a|al|para)\s+(.+)$/i.exec(p)
      ?? /^(?:el|la|los|las|mensaje|mensajes)?\s*((?:\d+)(?:\s*(?:,|y|e)\s*(?:el\s+|la\s+)?\d+)*)\s+(?:(?:es|son|va|van)\s+)?(.+)$/i.exec(p);
    if (!mover) return { tipo: 'no_entendida' };
    const a = destinoDeCorreccion(mover[2], plan, viajes);
    if (!a) return { tipo: 'no_entendida', aviso: `No sé a qué viaje te refieres con «${recorte(mover[2], 30)}».` };
    cambios.push({ ns: leerNumeros(mover[1]), a });
  }
  if (cambios.length === 0) return { tipo: 'no_entendida' };
  for (const c of cambios) {
    const fuera = c.ns.filter(n => !existentes.has(n));
    if (c.ns.length === 0 || fuera.length > 0) return { tipo: 'no_entendida', aviso: `No hay mensaje ${fuera.join(', ')} en el resumen.` };
    const varios = c.ns.filter(n => plan.mensajes.find(m => m.n === n)?.varios);
    if (c.a !== 'descartar' && varios.length > 0) {
      return { tipo: 'no_entendida', aviso: `El ${varios.join(', ')} habla de dos viajes: no lo cargo entero en uno. Descártalo y escribe el dato en la ficha de cada viaje.` };
    }
    const sinCaja = c.ns.filter(n => !plan.mensajes.find(m => m.n === n)?.destino);
    if (c.a === 'dejar' && sinCaja.length > 0) return { tipo: 'no_entendida', aviso: `El ${sinCaja.join(', ')} no tiene caja: dime a qué viaje va o descártalo.` };
  }
  return { tipo: 'corregir', cambios };
}

/** Aplica las decisiones: el comercial manda. */
export function aplicarCambios(plan: PlanViajes, cambios: ReadonlyArray<Cambio>): PlanViajes {
  const mensajes = plan.mensajes.map(m => ({ ...m }));
  for (const c of cambios) {
    for (const n of c.ns) {
      const m = mensajes.find(x => x.n === n);
      if (!m) continue;
      if (c.a === 'descartar') Object.assign(m, { destino: null, por: 'comercial', descartado: true, sospecha: false });
      else if (c.a === 'dejar') Object.assign(m, { por: 'comercial', sospecha: false, motivo: undefined });
      else Object.assign(m, { destino: c.a, por: 'comercial', descartado: false, sospecha: false, motivo: undefined });
    }
  }
  return { ...plan, mensajes, avisos: [] };
}

/** Cómo se decide, cuando la respuesta fue «corregir» a secas. */
export const TEXTO_COMO_CORREGIR = 'Dime qué hago con cada uno: «dejar el 4» (o «dejar todos»), «el 4 es de Luisa» o «el 4 es del 2» para moverlo, «el 6 es nuevo Pedro», o «descartar el 6».';
