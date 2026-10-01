// ============================================================
// Guardianes de la bandeja de WhatsApp — lo que el modelo NO decide (sin I/O)
// ------------------------------------------------------------
// Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-01-varios-viajes-y-guardianes.md,
// parte 2. Evidencia: qa/bandeja-wa/resultado-2026-10-01-main.md (fallas N1 a N9).
//
// `validarSalida` (wa-entendimiento-reglas.ts) filtra campo por campo. Aquí va lo que mira la
// entrega entera, en este orden (`entenderEntrega`):
//
//   N3 · quién habla: cada mensaje es cliente, comercial, tercero o ruido. SOLO lo del cliente
//        llena campos; la promoción de otra agencia y el pie de foto de un pago no llenan nada.
//        El modelo clasifica y el código corrige lo que se ve sin modelo (pie de pago, promoción
//        con precio «desde»).
//   N7 · la historia es EXTRACTIVA: citas del cliente copiadas tal cual y verificadas contra lo
//        que el cliente reenvió. Ni una valoración del comercial ni una paráfrasis pueden entrar.
//   N1 · pasajeros: una edad cuenta una sola vez y con los cortes de la config; una edad de adulto
//        no es niño («mi bebé de 18»); un total sin desglose no se reparte; la suma de categorías
//        no pasa el total declarado; dos totales distintos dejan los conteos vacíos.
//   N4 · ¿hay solicitud? Sin un mensaje del cliente con un dato, no se crea un negocio.
//   N5 · ¿hay DOS solicitudes? Si el modelo ve dos viajes distintos (con frases distintas que sí
//        están en los mensajes), no se mezclan.
// ============================================================

import { parsearNumeroColombiano } from './niveles-solicitud.ts';
import {
  CLASES_MENSAJE,
  DIAS_EN_LETRAS,
  fraseNombraNumero,
  leerEdades,
  normalizarTexto,
  validarSalida,
  type CampoEntendible,
  type ClaseMensaje,
  type SalidaEntendida,
  type Sugerido,
} from './wa-entendimiento-reglas.ts';

/** Un mensaje de la entrega, numerado en el orden en que llegó (1, 2, 3…). */
export interface MensajeEntrega {
  n: number;
  cuerpo: string;
  reenviado: boolean;
  tipo: string;
  /** `cuerpo_origen`: texto, pie_de_foto, transcripcion… */
  origen: string | null;
}

/** Los cortes de edad de la config (`bandeja_solicitudes.edad_infante_menor_de` / `edad_adulto_desde`). */
export interface Cortes {
  infanteMenorDe: number;
  adultoDesde: number;
}

export const CORTES_POR_DEFECTO: Cortes = { infanteMenorDe: 2, adultoDesde: 12 };

const SEPARADOR = '\n---\n';

/** Los mensajes como los lee el modelo: numerados y con quién los mandó. */
export function textoParaModelo(mensajes: ReadonlyArray<MensajeEntrega>): string {
  return mensajes
    .filter(m => m.cuerpo.trim() !== '')
    .map(m => {
      const como = m.reenviado ? 'reenviado' : 'escrito por el comercial';
      const extra = m.origen === 'transcripcion' ? ', nota de voz' : m.origen === 'pie_de_foto' ? ', pie de foto' : '';
      return `[${m.n}] (${como}${extra}) ${m.cuerpo.trim()}`;
    })
    .join('\n');
}

/** El texto de unos mensajes, separados como los separa la bandeja (lo lee `mensajeDeLaFrase`). */
export function textoDe(mensajes: ReadonlyArray<MensajeEntrega>): string {
  return mensajes.map(m => m.cuerpo.trim()).filter(Boolean).join(SEPARADOR);
}

// ── N3 · quién habla ─────────────────────────────────────────────────────────

/**
 * Una nota del comercial sobre el cliente: habla de él en tercera persona o lo valora. Se mira
 * solo en lo ESCRITO por el comercial (no reenviado): ahí es donde caben los juicios (B5).
 */
const RE_NOTA_COMERCIAL = /\b(ojo|esta senora|este senor|esta clienta|este cliente|la clienta|el cliente es|la senora es|el senor es|tacan\w*|pesad[oa]|groser[oa]|conflictiv[oa]|se queja|quejon\w*|cansona?|intens[oa]|dificil de|exigente|mala paga|no paga)\b/;

/**
 * ¿Es una nota del comercial sobre el cliente (un juicio)? Solo lo escrito por el comercial. Esa
 * nota no se guarda y su texto no vuelve a salir en ningún mensaje del bot (QA de #971 v4).
 */
export function esNotaDelComercial(cuerpo: string, reenviado: boolean): boolean {
  if (reenviado) return false;
  return RE_NOTA_COMERCIAL.test(` ${normalizarTexto(cuerpo).replace(/[^a-z0-9$ ]/g, ' ').replace(/\s+/g, ' ')} `);
}

const RE_PAGO = /\b(abono|abone|pago|pague|consignacion|consigne|transferencia|transferi|comprobante|recibo|soporte de pago)\b/;
const RE_PROMOCION = /\b(desde \$|desde usd|precio por persona|plan(es)? desde|salidas? (los |el )?\d{1,2}( y \d{1,2})?( de \w+)?,|cupos limitados|aplican (condiciones|restricciones)|promo(cion)?\b)/;

/**
 * La clase de cada mensaje. La del modelo, corregida por lo que se ve sin modelo:
 *   · sin texto → ruido;
 *   · un pie de foto que habla de un pago → tercero (B7: «abono reserva Cartagena»);
 *   · un precio «desde $…», salidas con fecha fija o «aplican condiciones» → tercero (B6);
 *   · un escrito del comercial que habla del cliente en tercera persona o lo valora → comercial (B5);
 *   · «ruido» del modelo sobre un mensaje que sostiene un valor → cliente (C5);
 *   · «comercial» del modelo sin juicio → cliente: el comercial que relata la solicitud aporta (A2).
 * Sin clase del modelo (salida vieja), el mensaje cuenta como del cliente salvo esas correcciones.
 */
export function clasesDeMensajes(raw: unknown, mensajes: ReadonlyArray<MensajeEntrega>): Record<number, ClaseMensaje> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { mensajes?: unknown };
  const delModelo = new Map<number, ClaseMensaje>();
  if (Array.isArray(r.mensajes)) {
    for (const x of r.mensajes as Array<{ n?: unknown; clase?: unknown }>) {
      const n = Number(x?.n);
      if (Number.isInteger(n) && (CLASES_MENSAJE as readonly string[]).includes(String(x?.clase))) delModelo.set(n, x.clase as ClaseMensaje);
    }
  }
  // Las frases que el modelo citó como sustento: un mensaje que sostiene un valor no es ruido.
  const valores = ((raw && typeof raw === 'object' ? raw : {}) as { valores?: Record<string, { frase?: unknown }> }).valores ?? {};
  const frases = Object.values(valores)
    .map(v => (typeof v?.frase === 'string' ? normalizarTexto(v.frase) : ''))
    .filter(f => f.length >= 4);
  const out: Record<number, ClaseMensaje> = {};
  for (const m of mensajes) {
    const t = ` ${normalizarTexto(m.cuerpo).replace(/[^a-z0-9$ ]/g, ' ').replace(/\s+/g, ' ')} `;
    const crudo = ` ${normalizarTexto(m.cuerpo)} `;
    const modelo = delModelo.get(m.n);
    if (!m.cuerpo.trim()) out[m.n] = 'ruido';
    else if (m.origen === 'pie_de_foto' && RE_PAGO.test(t)) out[m.n] = 'tercero';
    else if (RE_PROMOCION.test(crudo)) out[m.n] = 'tercero';
    else if (!m.reenviado && RE_NOTA_COMERCIAL.test(t)) out[m.n] = 'comercial';
    else if (modelo === 'tercero') out[m.n] = 'tercero';
    // «Ruido» del modelo solo si el mensaje no sostiene ningún valor (C5: «pta cana» era ruido).
    else if (modelo === 'ruido') out[m.n] = frases.some(f => crudo.includes(f)) ? 'cliente' : 'ruido';
    // «Comercial» solo lo decide el código (juicios sobre el cliente). Cuando el comercial RELATA la
    // solicitud («tengo dos pasajeros para…», A2), eso es contenido de la solicitud.
    else out[m.n] = 'cliente';
  }
  return out;
}

// ── N1 · pasajeros ───────────────────────────────────────────────────────────

const CONTEOS = ['adultos', 'ninos', 'infantes'] as const;
const PALABRAS_DE_CATEGORIA = /^(adult|nin|bebe|infant|menor|hij|pelad|peque|chiquit|nene)/;

function numeroDe(w: string): number | null {
  if (/^\d{1,3}$/.test(w)) return Number(w);
  if (w in DIAS_EN_LETRAS && w !== 'primero') return DIAS_EN_LETRAS[w];
  return null;
}

/**
 * Los totales que el cliente declara: «somos 4», «seríamos cinco», «6 personas», «en total 3».
 * «somos 2 adultos» NO es un total (es un desglose).
 */
export function totalesDeclarados(texto: string): number[] {
  const tokens = normalizarTexto(texto).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    if (/^(somos|seriamos|seremos|vamos|viajamos|viajariamos|iriamos)$/.test(w) || (w === 'total' && tokens[i - 1] === 'en')) {
      const n = numeroDe(tokens[i + 1] ?? '');
      if (n !== null && n > 0 && !PALABRAS_DE_CATEGORIA.test(tokens[i + 2] ?? '')) out.add(n);
    }
    const n = numeroDe(w);
    if (n !== null && n > 0 && /^(personas|pasajeros|viajeros)$/.test(tokens[i + 1] ?? '')) out.add(n);
  }
  return [...out];
}

/**
 * Los números de grupo de CADA mensaje: lo que va después de «somos», «seríamos», «vamos»… («somos
 * 4», «somos 4 adultos», «seríamos cinco»). Dos mensajes con números distintos son dos voces (D3:
 * la mamá dice 4 y el papá 5): ninguno de los dos se elige callado.
 */
export function numerosDeGrupoPorMensaje(fuente: string): number[][] {
  return fuente.split(SEPARADOR).map(msg => {
    const tokens = normalizarTexto(msg).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    const out: number[] = [];
    tokens.forEach((w, i) => {
      if (!/^(somos|seriamos|seremos|vamos|viajamos|viajariamos|iriamos)$/.test(w)) return;
      const n = numeroDe(tokens[i + 1] ?? '');
      if (n !== null && n > 0) out.push(n);
    });
    return out;
  });
}

/** Alguien más que se suma al viaje: «mi hermana también va», «se nos suma mi suegra». */
const RE_SE_SUMA = /\b(mi|su|sus|mis)\s+(hermana|hermano|mama|papa|madre|padre|suegra|suegro|amiga|amigo|tia|tio|prima|primo|cunada|cunado|abuela|abuelo|novia|novio|pareja)\b[^.]{0,40}\b(tambien|se suma|se une|viene|vienen|va con|van con)\b|\bse (nos )?(suma|une|unen|suman)\b/;

function quitar(s: SalidaEntendida, slug: string, motivo: string) {
  if (!s.sugeridos[slug]) return;
  delete s.sugeridos[slug];
  s.descartados.push({ slug, motivo });
}

/**
 * N1 · el conteo de pasajeros. Trabaja sobre una copia de la salida ya validada y solo toca
 * adultos, niños, infantes y edades (los slugs del bloque de viaje). Lo que no puede decidir lo
 * deja VACÍO con su motivo: el bot lo pregunta.
 */
export function guardianPasajeros(
  entrada: SalidaEntendida,
  fuente: string,
  cortes: Cortes = CORTES_POR_DEFECTO,
  conocidos: Record<string, unknown> = {},
  /**
   * Las edades que dio el modelo, aunque otra regla las haya descartado (sin niños sabidos,
   * `edades_menores` no pasa su `pedir_si`): una edad de adulto sigue siendo una pista (C9).
   */
  edadesDelModelo?: Sugerido,
): SalidaEntendida {
  const s: SalidaEntendida = { ...entrada, sugeridos: { ...entrada.sugeridos }, descartados: [...entrada.descartados] };
  const num = (slug: string): number | null => {
    const v = s.sugeridos[slug]?.valor;
    return v === undefined ? null : parsearNumeroColombiano(v);
  };

  // 1. Un conteo cuya frase es un total con otro número no se reparte: «Somos 4 con los niños»
  //    no da 2 adultos y 2 niños (C11). La frase tiene que decir el número que se pone.
  for (const slug of CONTEOS) {
    const x = s.sugeridos[slug];
    if (!x || x.deduccion || Number(x.valor) === 0) continue;
    const totales = totalesDeclarados(x.frase);
    if (totales.length > 0 && !fraseNombraNumero(x.frase, Number(x.valor))) {
      quitar(s, slug, `un total sin desglose no se reparte: «${x.frase}» dice ${totales.join(' / ')}, no ${x.valor}`);
    }
  }

  // 2. Dos voces (D3): mensajes distintos con números de grupo distintos → nada callado.
  const porMensaje = numerosDeGrupoPorMensaje(fuente).map(ns => [...new Set(ns)]).filter(ns => ns.length > 0);
  const distintos = [...new Set(porMensaje.flat())];
  if (porMensaje.length > 1 && distintos.length > 1) {
    for (const slug of CONTEOS) {
      if (s.sugeridos[slug] && !s.sugeridos[slug].deduccion) quitar(s, slug, `los mensajes dicen números distintos: ${distintos.join(' y ')}`);
    }
  }

  // 2b. Alguien se suma en OTRO mensaje que el de los adultos («Vamos 2 adultos» y luego «mi
  //     hermana también va», D4): el conteo de adultos ya no es seguro y se pregunta.
  const adultosSug = s.sugeridos.adultos;
  if (adultosSug && !adultosSug.deduccion) {
    const msgs = fuente.split(SEPARADOR);
    const deAdultos = msgs.find(m => normalizarTexto(m).includes(normalizarTexto(adultosSug.frase)));
    const otro = msgs.find(m => m !== deAdultos && RE_SE_SUMA.test(` ${normalizarTexto(m).replace(/[^a-z0-9 ]/g, ' ')} `));
    if (otro) quitar(s, 'adultos', `alguien más se suma en otro mensaje: «${otro.trim().slice(0, 60)}»`);
  }
  const totales = totalesDeclarados(fuente);

  // 3. Las edades cuentan una sola vez y con los cortes de la config.
  const edadesSug = s.sugeridos.edades_menores ?? edadesDelModelo;
  const edades = edadesSug ? leerEdades(edadesSug.valor) : null;
  if (edadesSug && edades) {
    const deAdulto = edades.filter(e => e >= cortes.adultoDesde);
    const menores = edades.filter(e => e < cortes.adultoDesde);
    const infantesPorEdad = menores.filter(e => e < cortes.infanteMenorDe).length;
    const ninosPorEdad = menores.length - infantesPorEdad;
    const contadosComoMenores = (num('ninos') ?? 0) + (num('infantes') ?? 0);
    const regla = (txt: string): Sugerido => ({ valor: 0, frase: edadesSug.frase, deduccion: txt });
    const cortesTxt = `infante menor de ${cortes.infanteMenorDe}, adulto desde ${cortes.adultoDesde}`;

    if (deAdulto.length > 0) {
      // «Mi bebé, que ya tiene 18 añitos» (C9): esa persona es adulta.
      const adultos = num('adultos');
      if (contadosComoMenores === edades.length && adultos !== null && !s.sugeridos.adultos.deduccion) {
        s.sugeridos.adultos = { ...regla(`Edad ${deAdulto.join(', ')}: adulto (${cortesTxt}); ${adultos} + ${deAdulto.length}`), valor: adultos + deAdulto.length };
        s.sugeridos.ninos = { ...regla(`Edades ${edades.join(', ')}: ${ninosPorEdad} niño(s) (${cortesTxt})`), valor: ninosPorEdad };
        s.sugeridos.infantes = { ...regla(`Edades ${edades.join(', ')}: ${infantesPorEdad} infante(s) (${cortesTxt})`), valor: infantesPorEdad };
        if (menores.length > 0) s.sugeridos.edades_menores = { ...edadesSug, valor: menores.join(', ') };
        else quitar(s, 'edades_menores', `${deAdulto.join(', ')} es edad de adulto, no de menor`);
      } else {
        const motivo = `hay una edad de adulto (${deAdulto.join(', ')}) entre las de los menores`;
        quitar(s, 'ninos', motivo);
        quitar(s, 'infantes', motivo);
        // Las edades se quedan (son lo que dijo el cliente), salvo que TODAS sean de adulto.
        if (menores.length === 0) quitar(s, 'edades_menores', motivo);
        if (contadosComoMenores === 0) quitar(s, 'adultos', `${motivo} y no se sabe si está contada`);
      }
    } else if (s.sugeridos.ninos || s.sugeridos.infantes) {
      if (contadosComoMenores === edades.length) {
        // Mismo total: manda la edad. «2 y 12» no son 2 niños más 1 infante.
        if (num('ninos') !== ninosPorEdad && s.sugeridos.ninos !== undefined) s.sugeridos.ninos = { ...regla(`Edades ${edades.join(', ')} (${cortesTxt})`), valor: ninosPorEdad };
        if (num('infantes') !== infantesPorEdad && s.sugeridos.infantes !== undefined) s.sugeridos.infantes = { ...regla(`Edades ${edades.join(', ')} (${cortesTxt})`), valor: infantesPorEdad };
      } else {
        // C10: «Los niños tienen 2 y 12» y el modelo dio 2 niños + 1 infante (3 ≠ 2 edades).
        const motivo = `las edades (${edades.join(', ')}) no cuadran con niños + infantes (${contadosComoMenores})`;
        quitar(s, 'ninos', motivo);
        quitar(s, 'infantes', motivo);
      }
    }
  }

  // 4. La suma de categorías no puede pasar el total declarado.
  if (totales.length === 1) {
    const valor = (slug: string) => num(slug) ?? parsearNumeroColombiano(conocidos[slug]) ?? 0;
    const suma = CONTEOS.reduce((a, slug) => a + valor(slug), 0);
    if (suma > totales[0]) {
      for (const slug of CONTEOS) {
        if (s.sugeridos[slug] && !s.sugeridos[slug].deduccion) quitar(s, slug, `adultos + niños + infantes (${suma}) pasa el total que dijo el cliente (${totales[0]})`);
      }
    }
  }
  return s;
}

/** Las edades que devolvió el modelo, solo si su frase está en lo que dijo el cliente. */
function edadesConFrase(raw: unknown, fuente: string): Sugerido | undefined {
  const it = ((raw as { valores?: Record<string, { valor?: unknown; frase?: unknown }> } | null)?.valores ?? {}).edades_menores;
  const valor = typeof it?.valor === 'string' ? it.valor.trim() : '';
  const frase = typeof it?.frase === 'string' ? it.frase.trim() : '';
  if (!valor || !frase || valor === 'por_definir' || !normalizarTexto(fuente).includes(normalizarTexto(frase))) return undefined;
  return { valor, frase };
}

// ── N5 · dos solicitudes en una tanda ────────────────────────────────────────

export interface Solicitud {
  cliente: string | null;
  destino: string | null;
  frase: string;
}

/**
 * Las solicitudes DISTINTAS que el modelo vio, verificadas: cada frase tiene que estar en los
 * mensajes, y dos solicitudes solo son distintas si sus frases son distintas (una no contiene a
 * la otra) y difieren en el cliente o en el destino. «Punta Cana o Curazao» en UNA frase es un
 * solo viaje con dos candidatos (D6), no dos viajes. Devuelve [] si hay una o ninguna.
 */
export function solicitudesDistintas(raw: unknown, texto: string): Solicitud[] {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { solicitudes?: unknown };
  if (!Array.isArray(r.solicitudes)) return [];
  const fuente = normalizarTexto(texto);
  const limpio = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const validas: Solicitud[] = [];
  for (const x of r.solicitudes as Array<Record<string, unknown>>) {
    const frase = limpio(x?.frase);
    if (!frase || !fuente.includes(normalizarTexto(frase))) continue;
    const nueva = { cliente: limpio(x?.cliente), destino: limpio(x?.destino), frase };
    const nf = normalizarTexto(frase);
    const repetida = validas.some(v => {
      const vf = normalizarTexto(v.frase);
      if (vf.includes(nf) || nf.includes(vf)) return true;
      const difiere = (a: string | null, b: string | null) => !!a && !!b && !normalizarTexto(a).includes(normalizarTexto(b)) && !normalizarTexto(b).includes(normalizarTexto(a));
      return !difiere(v.cliente, nueva.cliente) && !difiere(v.destino, nueva.destino);
    });
    if (!repetida) validas.push(nueva);
  }
  return validas.length >= 2 ? validas : [];
}

/** «Carolina: Punta Cana · Luisa: San Andrés». */
export function lineaSolicitudes(ss: ReadonlyArray<Solicitud>): string {
  return ss.map(s => [s.cliente, s.destino].filter(Boolean).join(': ') || `«${s.frase.slice(0, 40)}»`).join(' · ');
}

/** Lo que el bot dice cuando ve dos solicitudes en una tanda (N5). */
export function textoDosViajes(ss: ReadonlyArray<Solicitud>): string {
  return `Veo dos solicitudes distintas en estos mensajes (${lineaSolicitudes(ss)}). No las mezclo en un viaje.\nResponde DESCARTAR y vuelve a reenviarlas, cada una después de un encabezado con el nombre o el código del cliente («Carolina», «T1 26 9», «nuevo Luisa»).`;
}

// ── N4 · ¿hay solicitud? ─────────────────────────────────────────────────────

/** Lo que el bot dice cuando no ve una solicitud de viaje (N4). */
export function textoSinSolicitud(n: number): string {
  return `No vi una solicitud de viaje en ${n === 1 ? 'este mensaje' : `estos ${n} mensajes`}. No creé nada.\nResponde DESCARTAR para dejarlos así, o SÍ si de verdad es un viaje y lo creo igual.`;
}

/** Hay solicitud si algún mensaje es del cliente y de él salió al menos un dato. */
export function haySolicitud(salida: SalidaEntendida, clases: Record<number, ClaseMensaje>): boolean {
  return Object.values(clases).includes('cliente') && Object.keys(salida.sugeridos).length > 0;
}

// ── Todo junto ───────────────────────────────────────────────────────────────

export interface Entendida {
  salida: SalidaEntendida;
  clases: Record<number, ClaseMensaje>;
  /** Dos o más solicitudes distintas (N5); [] si es una sola. */
  solicitudes: Solicitud[];
  /** N4: si es `false`, no se crea un negocio. */
  haySolicitud: boolean;
  /** Lo que el cliente dijo (lo que sostiene los valores). */
  fuente: string;
  /**
   * El nombre con el que alguien SE PRESENTA en un mensaje del cliente («soy Andrés Gil», «habla
   * Luisa»). Es lo único que N6 compara contra el cliente del negocio: no el «cliente» que extrae
   * el modelo, que puede ser el código del viaje o el apodo de la comercial («Tati»).
   */
  sePresenta: string | null;
}

const RE_PRESENTA = /(?:^|[\s,.;:¡!¿?])(?:soy|habla|te habla|le habla|me llamo|mi nombre es|de parte de|te escribe)\s+(?:la\s+|el\s+)?([A-ZÁÉÍÓÚÑ][a-záéíóúñü]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñü]+)?)/;

/** El primer nombre (con apellido, si viene) con el que alguien se presenta en estos mensajes. */
export function nombreQueSePresenta(mensajes: ReadonlyArray<MensajeEntrega>): string | null {
  for (const m of mensajes) {
    const r = RE_PRESENTA.exec(m.cuerpo);
    if (r) return r[1];
  }
  return null;
}

/**
 * Lo que la ejecución corre con la salida del modelo de UNA entrega (o un segmento): clases,
 * validación campo por campo sobre lo del cliente, historia extractiva, pasajeros, solicitudes.
 */
export function entenderEntrega(
  raw: unknown,
  fields: ReadonlyArray<CampoEntendible>,
  mensajes: ReadonlyArray<MensajeEntrega>,
  opts: { hoyISO?: string; conocidos?: Record<string, unknown>; cortes?: Cortes } = {},
): Entendida {
  const clases = clasesDeMensajes(raw, mensajes);
  const delCliente = mensajes.filter(m => clases[m.n] === 'cliente');
  const fuente = textoDe(delCliente);
  // Se cita solo lo que el cliente dijo con sus palabras: reenviado. Una nota del comercial,
  // aunque relate la solicitud, no es citable (ahí es donde caben los juicios: B5).
  const citables = textoDe(delCliente.filter(m => m.reenviado));
  const validada = validarSalida(raw, fields, fuente, { hoyISO: opts.hoyISO, conocidos: opts.conocidos, citables });
  const salida = guardianPasajeros(validada, fuente, opts.cortes ?? CORTES_POR_DEFECTO, opts.conocidos ?? {}, edadesConFrase(raw, fuente));
  return {
    salida,
    clases,
    solicitudes: solicitudesDistintas(raw, textoDe(mensajes)),
    haySolicitud: haySolicitud(salida, clases),
    fuente,
    sePresenta: nombreQueSePresenta(delCliente),
  };
}
