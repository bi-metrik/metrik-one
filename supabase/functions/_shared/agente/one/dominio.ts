// ============================================================
// Núcleo conversacional — el dominio de ONE (modo agente en todo workspace), 2026-10-21
// ------------------------------------------------------------
// Mauricio, 2026-10-20: «necesito el modo agente en todo ONE, también para termotech». Lo que hace el bot de siempre
// (`handlers/registro/*`, `handlers/actividad.ts`, `handlers/consulta.ts`, `handlers/ayuda.ts`), con el modelo
// interpretando y decidiendo el destino, y el código protegiendo solo invariantes:
//   · nada se escribe sin el toque sobre un resumen que arma el código con datos reales (se acaba el autorregistro);
//   · el negocio existe: se resuelve por su código en la base (`wa_find_negocios`); un código que no está, no se propone;
//   · todo resumen que toca un negocio dice código · empresa — nombre;
//   · el monto es un número positivo; la categoría, una de las nueve; el soporte, una foto o un PDF que llegó en esta
//     conversación y que no se usó ya; el teléfono de un contacto nuevo, uno escrito por el equipo;
//   · un soporte que no cuadra con el monto no se adjunta callado (2026-10-21): el resumen dice lo que dice el archivo;
//   · el rol manda (los mismos permisos del bot de siempre: un operador registra gastos y actividades; un contador
//     consulta; solo lectura, sus números).
// No hay reglas que lean el texto de la persona: qué negocio nombró, cuánto dijo y qué categoría es lo decide el modelo,
// y la persona lo confirma en el resumen.
// La base la toca un `PuertoOne` (producción: `puerto-supabase.ts`; pruebas y arnés: `puerto-memoria.ts`).
// ============================================================

import { CATEGORIA_LABELS } from '../../types.ts';
import { formatCOP } from '../../wa-format.ts';
import { renderizar } from '../render.ts';
import type { ContextoDominio, DeclaracionHerramienta, Dominio, FilaConversacion, Hechos, LecturaAdjunto, MediaFila, Propuesta, RegistroConversacion, ResultadoHerramienta, Salida } from '../tipos.ts';
import type { ArchivoAdjunto, Lector } from './lectura-adjunto.ts';
import { esAdjuntoEntrante, preparadorDeAdjuntos } from '../adjuntos.ts';
import { BOT_ONE } from './reglamento.ts';

export { BOT_ONE };

export interface NegocioOne {
  id: string;
  codigo: string;
  nombre: string;
  empresa: string | null;
  contacto: string | null;
  etapa: string | null;
  /** Valor del negocio (aprobado o estimado). Solo lo ve quien puede ver plata. */
  valor?: number | null;
  coincidencia?: 'codigo' | 'exacta' | 'parecida';
}

export interface GastoOne {
  id: string;
  fecha: string;
  monto: number;
  categoria: string;
  descripcion: string;
  /** Código del negocio, o `null` = gasto de empresa. */
  negocio: string | null;
  soporte: boolean;
  /** Ya lo revisó contabilidad: el monto no se corrige por aquí. */
  revisado?: boolean;
}

export type SoporteGuardado = 'guardado' | 'fallo' | 'sin';

export interface PuertoOne {
  /** Negocios abiertos por código, nombre del negocio, empresa o contacto (`wa_find_negocios`). */
  buscarNegocios(texto: string, limite: number): Promise<NegocioOne[] | 'error'>;
  /** Los abiertos, los más recientes primero, con cuántos hay por etapa. */
  negociosAbiertos(etapa: string | null, limite: number): Promise<{ total: number; porEtapa: Record<string, number>; negocios: NegocioOne[] } | 'error'>;
  /** El negocio abierto con ese código exacto (normalizado: «i1-26-5» = «I1 26 5»). */
  negocioPorCodigo(codigo: string): Promise<NegocioOne | null | 'error'>;
  /** ¿Es un viaje con servicios por pagar? (esos pagos van por la pantalla de servicios del viaje, no como gasto suelto). */
  serviciosPorPagar(negocioId: string): Promise<boolean | 'error'>;
  /** El centro de costos como lo propone hoy el bot (`proponerCentroCostosWA`). */
  centroCostos(p: { negocioId: string | null; descripcion: string | null }): Promise<{ centro: string | null; origen: string | null }>;
  gastosRecientes(p: { desdeIso: string; negocioId: string | null; limite: number }): Promise<{ total: number; cantidad: number; gastos: GastoOne[] } | 'error'>;
  /** Un gasto del workspace por id. */
  gasto(id: string): Promise<GastoOne | null | 'error'>;
  /**
   * Los que SIGUEN en la base de estos ids (los gastos que la conversación dice que se registraron). Uno borrado en la
   * app no vuelve. Una sola consulta por turno.
   */
  gastosPorId(ids: string[]): Promise<GastoOne[] | 'error'>;
  /** Si ese teléfono ya es de un contacto, su nombre (`buscar_contacto_duplicado`). */
  contactoDuplicado(telefono: string): Promise<string | null | 'error'>;
  /**
   * Inserta el gasto como lo hace hoy el bot y, si trae soporte, lo deja como soporte: `ref` (el archivo ya subido al
   * llegar) o, si no hay, lo baja de Meta por `mediaId`. Lanza si no pudo escribir el gasto.
   */
  registrarGasto(p: {
    monto: number; categoria: string; descripcion: string | null; mensajeOriginal: string | null; negocioId: string | null;
    centro: string | null; origen: string | null; mediaId: string | null; ref?: string | null;
  }): Promise<{ id: string; soporte: SoporteGuardado }>;
  /** Deja el soporte (ya subido, `ref`; si no, lo baja de Meta) en el gasto. false = no se pudo (no se escribió nada). */
  adjuntarSoporte(gastoId: string, mediaId: string, ref?: string | null): Promise<boolean>;
  /**
   * Cambia el monto de un gasto que todavía no se revisó y, si viene, le deja el soporte. Lanza si no pudo (si el gasto
   * ya no existe o ya se revisó).
   */
  corregirGasto(p: { gastoId: string; monto: number; mediaId: string | null; ref?: string | null }): Promise<{ soporte: SoporteGuardado }>;
  /** Baja un archivo de Meta (foto o documento). null = no se pudo. */
  bajarAdjunto(mediaId: string): Promise<ArchivoAdjunto | null>;
  /** Sube el archivo a `gastos-soportes` al llegar (sin gasto todavía) y devuelve su referencia `one://`. null = no se pudo. */
  guardarAdjunto(filaId: string, archivo: ArchivoAdjunto): Promise<string | null>;
  /** Deja en la fila de la conversación lo preparado del archivo (`ref`, `lectura`). Nunca lanza. */
  anotarMedia(filaId: string, media: MediaFila): Promise<void>;
  registrarActividad(p: { negocioId: string; tipo: TipoActividad; texto: string }): Promise<void>;
  crearContacto(p: { nombre: string; telefono: string | null; cargo: string | null; decisor: boolean }): Promise<{ id: string }>;
}

export const ACCIONES_ONE = ['gasto', 'adjuntar_soporte', 'corregir_gasto', 'actividad', 'contacto_nuevo'];
export const TIPOS_ACTIVIDAD = ['llamada', 'reunion', 'correo', 'visita', 'mensaje', 'nota'] as const;
export type TipoActividad = typeof TIPOS_ACTIVIDAD[number];
export const EMOJI_ACTIVIDAD: Record<TipoActividad, string> = { llamada: '📞', reunion: '🤝', correo: '📧', visita: '🚗', mensaje: '💬', nota: '📝' };
const ETAPAS = ['venta', 'ejecucion', 'cobro', 'cierre'];

// ── Permisos por rol (los del bot de siempre: OPERATOR/CONTADOR/READ_ONLY_ALLOWED_INTENTS) ───────────────────────

export interface Permisos {
  escribir: boolean;
  contactos: boolean;
  negocios: boolean;
  plata: boolean;
  gastos: boolean;
}

/** Pura. owner/admin: todo. supervisor/operator (y colaboradores): gastos y actividades. contador: consultas. read_only: sus números. */
export function permisosDe(rol: string): Permisos {
  switch (rol) {
    case 'owner':
    case 'admin':
      return { escribir: true, contactos: true, negocios: true, plata: true, gastos: true };
    case 'supervisor':
    case 'operator':
      return { escribir: true, contactos: false, negocios: true, plata: false, gastos: false };
    case 'contador':
      return { escribir: false, contactos: false, negocios: true, plata: true, gastos: true };
    case 'read_only':
      return { escribir: false, contactos: false, negocios: false, plata: true, gastos: true };
    default:
      return { escribir: false, contactos: false, negocios: false, plata: false, gastos: false };
  }
}

// ── Cómo se nombra un negocio ────────────────────────────────────────────────

const corto = (s: string, max: number) => ([...s].length <= max ? s : `${[...s].slice(0, max - 1).join('')}…`);

/** «P1 26 5 · Pérez Construcciones — Remodelación cocina»: siempre código, empresa (o el contacto) y nombre. Pura. */
export function nombreNegocio(n: Pick<NegocioOne, 'codigo' | 'nombre' | 'empresa' | 'contacto'>, max = 90): string {
  const quien = n.empresa || n.contacto || 'sin empresa';
  return `${n.codigo} · ${quien} — ${corto(n.nombre || '(sin nombre)', max)}`;
}

function negocioParaModelo(n: NegocioOne, plata: boolean): Record<string, unknown> {
  return {
    codigo: n.codigo, empresa: n.empresa, nombre: n.nombre, contacto: n.contacto, etapa: n.etapa,
    ...(n.coincidencia ? { coincidencia: n.coincidencia } : {}),
    ...(plata && typeof n.valor === 'number' ? { valor: formatCOP(n.valor) } : {}),
  };
}

// ── Lo que dice la conversación (estructura, no texto) ───────────────────────

/** El número `#n` de una fila como lo vio el modelo («#5», «5», 5). Pura. */
export function numeroDeFila(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/^#/, '').trim());
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * Ids de las filas de foto o PDF que ya son soporte de un gasto escrito en esta conversación. `borrados`: gastos que ya no
 * están en la base: su soporte vuelve a quedar libre (para registrarlo de nuevo). Pura.
 */
function fotosUsadas(filas: FilaConversacion[], borrados: ReadonlySet<string> = new Set()): Set<string> {
  const s = new Set<string>();
  for (const f of filas) {
    if (f.traza?.ejecucion?.resultado !== 'ejecutada') continue;
    for (const e of f.traza.ejecucion.escrituras ?? []) {
      const gasto = e.tipo === 'gasto' ? e.id : e.gasto;
      if (typeof e.foto === 'string' && !(typeof gasto === 'string' && borrados.has(gasto))) s.add(e.foto);
    }
  }
  return s;
}

/** ¿La fila es un soporte que llegó (foto o documento, escrito o reenviado)? Pura. */
export const esSoporte = esAdjuntoEntrante;

export interface SoporteDeLaConversacion {
  /** Id de la fila (lo que queda en `escrituras.foto`). */
  fila: string;
  mediaId: string;
  /** El archivo ya subido al llegar (si se alcanzó). */
  ref: string | null;
  tipo: 'imagen' | 'documento';
  nombre: string | null;
  lectura: LecturaAdjunto | null;
  n: number;
}

/**
 * El soporte `#n`: una fila entrante con foto o PDF (escrita o reenviada) que no es ya soporte de otro gasto. Devuelve
 * lo que hace falta para adjuntarlo, o el error para el modelo. Pura.
 */
export function soporteDe(filas: FilaConversacion[], v: unknown, borrados: ReadonlySet<string> = new Set()): SoporteDeLaConversacion | { error: string } {
  const n = numeroDeFila(v);
  const f = n ? filas[n - 1] : undefined;
  if (!esSoporte(f)) {
    return { error: `«${String(v)}» no es una foto ni un PDF de esta conversación. El soporte es el #n de una línea «[foto de …]» o «[documento de …]».` };
  }
  if (fotosUsadas(filas, borrados).has(f.id)) return { error: `El #${n} ya es el soporte de otro gasto. Pregunta si hay otro soporte.` };
  return {
    fila: f.id, mediaId: f.media.id, ref: f.media.ref ?? null, tipo: f.media.tipo as 'imagen' | 'documento',
    nombre: f.media.nombre ?? null, lectura: f.media.lectura ?? null, n: n!,
  };
}

/** Compatibilidad: `fotoDe` era la versión de solo fotos (hoy acepta también un PDF). Pura. */
export function fotoDe(filas: FilaConversacion[], v: unknown): { fila: string; mediaId: string } | { error: string } {
  const r = soporteDe(filas, v);
  return 'error' in r ? r : { fila: r.fila, mediaId: r.mediaId };
}

/** La línea del soporte en un resumen: la foto por su número; el PDF por su nombre. Pura. */
export function lineaSoporte(s: Pick<SoporteDeLaConversacion, 'tipo' | 'nombre' | 'n'>): string {
  return s.tipo === 'documento' ? `📎 Soporte: ${corto(s.nombre || `el documento #${s.n}`, 80)}` : `📷 Con la foto #${s.n} como soporte`;
}

/** ¿El monto leído del soporte es otro? (diferencia de más de un peso). null = no se leyó monto. Pura. */
export function montoDistinto(lectura: LecturaAdjunto | null | undefined, monto: number): boolean | null {
  if (!lectura?.legible || lectura.monto === null) return null;
  return Math.abs(lectura.monto - monto) > 1;
}

const lineaDistinto = (l: LecturaAdjunto, monto: number) => `⚠️ El soporte dice ${formatCOP(l.monto!)}, no ${formatCOP(monto)}`;

/** Los soportes de esta conversación que todavía no son soporte de ningún gasto, con lo leído (para el Estado). Pura. */
export function fotosSinUsar(filas: FilaConversacion[], borrados: ReadonlySet<string> = new Set()): string {
  const usadas = fotosUsadas(filas, borrados);
  const n = filas.map((f, i) => {
    if (!esSoporte(f) || usadas.has(f.id)) return null;
    const l = f.media.lectura;
    const que = f.media.tipo === 'documento' ? `PDF${f.media.nombre ? ` «${corto(f.media.nombre, 40)}»` : ''}` : 'foto';
    const leido = l === undefined ? 'sin leer' : l?.legible && l.monto !== null ? `dice ${formatCOP(l.monto)}` : 'no se leyó el monto';
    return `#${i + 1} (${que}, ${leido})`;
  }).filter(Boolean);
  return n.length
    ? `Soportes (fotos o PDF) que todavía no son soporte de ningún gasto: ${n.join(', ')}. Cada uno es el soporte de UN gasto: va en \`soporte\` del gasto que propones. Si el soporte dice el monto, no lo preguntes: propón con ese monto.`
    : 'Soportes sin usar: ninguno.';
}

export interface GastoDeLaConversacion {
  ref: string;
  id: string;
  monto: number;
  negocio: string | null;
  etiqueta: string;
  soporte: boolean;
}

/** Los gastos que se registraron en esta conversación (G1, G2… en orden) y si ya tienen soporte. Pura. */
export function gastosDeLaConversacion(filas: FilaConversacion[]): GastoDeLaConversacion[] {
  const out: GastoDeLaConversacion[] = [];
  for (const f of filas) {
    const e = f.traza?.ejecucion;
    if (e?.resultado !== 'ejecutada') continue;
    for (const w of e.escrituras ?? []) {
      if (w.tipo === 'gasto' && typeof w.id === 'string') {
        out.push({ ref: `G${out.length + 1}`, id: w.id, monto: Number(w.monto), negocio: (w.negocio as string | null) ?? null, etiqueta: String(w.etiqueta ?? ''), soporte: w.soporte === true });
      }
      if (w.tipo === 'soporte' && typeof w.gasto === 'string') {
        const g = out.find((x) => x.id === w.gasto);
        if (g) g.soporte = true;
      }
      if (w.tipo === 'correccion' && typeof w.gasto === 'string') {
        const g = out.find((x) => x.id === w.gasto);
        if (g) {
          g.monto = Number(w.monto);
          if (w.soporte === true) g.soporte = true;
        }
      }
    }
  }
  return out;
}

/**
 * Los gastos de la conversación cruzados con lo que HOY hay en la base (2026-10-21, caso real: se borraron por SQL dos
 * gastos de prueba y horas después el bot dijo «hoy quedaron registrados dos gastos de Impervium», sacado del historial).
 * La traza dice que se registraron; la base dice si siguen. De los que siguen manda la base (monto y soporte: pudieron
 * cambiarlos en la app). `revisada: false` = no se pudo leer la base: quedan como dice la traza, con la advertencia. Pura.
 */
export function cruzarConLaBase(
  deAqui: GastoDeLaConversacion[],
  enBase: GastoOne[] | 'error',
): { vigentes: Array<GastoDeLaConversacion & { revisado?: boolean }>; borrados: GastoDeLaConversacion[]; revisada: boolean } {
  if (enBase === 'error') return { vigentes: deAqui, borrados: [], revisada: false };
  const porId = new Map(enBase.map((g) => [g.id, g]));
  const vigentes: Array<GastoDeLaConversacion & { revisado?: boolean }> = [];
  const borrados: GastoDeLaConversacion[] = [];
  for (const g of deAqui) {
    const b = porId.get(g.id);
    if (!b) borrados.push(g);
    else vigentes.push({ ...g, monto: b.monto, soporte: b.soporte || g.soporte, ...(b.revisado ? { revisado: true } : {}) });
  }
  return { vigentes, borrados, revisada: true };
}

/**
 * Los gastos de la conversación como registros para el núcleo (`../registros.ts`): G1, G2… con su estado en la base. Si
 * la base no se pudo leer, `'error'` (el núcleo dice que no pudo revisar). Pura.
 */
export function registrosDeGastos(c: ReturnType<typeof cruzarConLaBase>): RegistroConversacion[] | 'error' {
  if (!c.revisada) return c.vigentes.length ? 'error' : [];
  const que = (g: GastoDeLaConversacion & { revisado?: boolean }) =>
    `gasto de ${formatCOP(g.monto)} · ${g.etiqueta} · ${g.soporte ? 'con soporte' : 'sin soporte'}${g.revisado ? ' · ya revisado por contabilidad' : ''}`;
  return [
    ...c.vigentes.map((g) => ({ id: g.id, alias: g.ref, que: que(g), estado: 'vigente' as const, montos: [g.monto] })),
    ...c.borrados.map((g) => ({ id: g.id, alias: g.ref, que: `gasto de ${formatCOP(g.monto)} · ${g.etiqueta}`, estado: 'borrado' as const, montos: [g.monto] })),
  ].sort((a, b) => Number(a.alias.slice(1)) - Number(b.alias.slice(1)));
}

/** El último texto que escribió (o dictó, o puso de pie de foto) el equipo: es el `mensaje_original` del gasto. Pura. */
function ultimoTextoDelEquipo(filas: FilaConversacion[]): string | null {
  const f = [...filas].reverse().find((x) => x.direccion === 'entrante' && x.clase !== 'toque' && (x.texto ?? '').trim());
  return f?.texto?.trim() ?? null;
}

const digitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/**
 * ¿El gasto de empresa tiene de dónde salir? (2026-10-21: en el arnés el modelo lo puso por su cuenta cuando no
 * encontró el negocio, y una vez apuntó `empresa_dicho_en` a «Bebidas de 20000»). `#n` tiene que ser una respuesta de la
 * persona a la pregunta del destino que armó el código (`preguntar_destino`, con su opción «Gasto de empresa»): el toque
 * de esa opción, o un escrito/audio que llega DESPUÉS de esa lista (qué dice lo lee el modelo). Si la persona dijo «de
 * empresa» antes de cualquier lista, el bot pregunta el destino y ella toca la opción: un paso más, a cambio de que
 * nadie registre a empresa por suposición. Estructural: no lee el texto de la persona. Pura.
 */
export function empresaDicha(filas: FilaConversacion[], v: unknown): boolean {
  const n = numeroDeFila(v);
  const f = n ? filas[n - 1] : undefined;
  if (!f || f.direccion !== 'entrante' || f.clase === 'reenvio') return false;
  const lista = filas.slice(0, n! - 1).some((x) => x.direccion === 'saliente' && (x.opciones ?? []).some((o) => o.id.startsWith('ag|c|') && o.titulo === OPCION_EMPRESA));
  if (!lista) return false;
  if (f.clase === 'toque') return (f.texto ?? '').trim() === OPCION_EMPRESA;
  return ['escrito', 'audio', 'imagen'].includes(f.clase);
}

/** ¿El teléfono está escrito por el equipo en la conversación? (solo dígitos; el valor tiene que existir). Pura. */
export function telefonoEnLaConversacion(filas: FilaConversacion[], telefono: string): boolean {
  const t = digitos(telefono);
  if (t.length < 7) return false;
  return filas.some((f) => f.direccion === 'entrante' && digitos(f.texto).includes(t.slice(-7)));
}

/**
 * La última lista (o botones de conversación) que el bot mostró, con su orden: el modelo interpreta «1», «el 2» o un
 * título contra ella. Solo las opciones de conversación (`ag|c|`), no los botones de una propuesta. Pura.
 */
export function ultimaLista(filas: FilaConversacion[]): string {
  for (let i = filas.length - 1; i >= 0; i--) {
    const f = filas[i];
    if (f.direccion !== 'saliente' || !f.opciones?.length) continue;
    const ops = f.opciones.filter((o) => o.id.startsWith('ag|c|'));
    if (!ops.length) continue;
    const despues = filas.slice(i + 1).filter((x) => x.direccion === 'entrante').length;
    return `Última lista que mostraste (#${i + 1}, ${despues === 0 ? 'sin respuesta todavía' : `${despues} mensaje(s) de la persona después`}): ${ops.map((o, k) => `${k + 1}) ${o.titulo}${o.descripcion ? ` — ${o.descripcion}` : ''}`).join('; ')}.`;
  }
  return 'Última lista que mostraste: ninguna.';
}

// ── Las herramientas ─────────────────────────────────────────────────────────

export const LECTURAS_ONE: DeclaracionHerramienta[] = [
  {
    name: 'buscar_negocios',
    description: 'Busca negocios abiertos por código («I1 26 5», también escrito «i1-26-5» o «I1265»), por nombre del negocio, de la empresa (el cliente) o del contacto. Devuelve hasta 5 con código, empresa, nombre, etapa y `coincidencia` (codigo, exacta o parecida). Solo lectura.',
    parameters: { type: 'object', properties: { texto: { type: 'string', description: 'Lo que la persona dijo del negocio: el código, la empresa, el nombre o el contacto, sin palabras como «proyecto» u «obra».' } }, required: ['texto'] },
  },
  {
    name: 'negocios_abiertos',
    description: 'Los negocios abiertos, los más recientes primero: cuántos hay en total y por etapa, y la lista (código, empresa, nombre, etapa). Solo para CONSULTAS («qué negocios tengo», «cuántos en venta»). Para preguntar a qué negocio va un gasto o una actividad NO sirve: usa `preguntar_destino`. Solo lectura.',
    parameters: { type: 'object', properties: { etapa: { type: 'string', enum: ETAPAS, description: 'Opcional: solo los de esa etapa.' } } },
  },
  {
    name: 'ver_negocio',
    description: 'El detalle de un negocio por su código: empresa, nombre, contacto, etapa y, si la persona puede verlo, el valor y lo gastado este mes. Solo lectura.',
    parameters: { type: 'object', properties: { codigo: { type: 'string' } }, required: ['codigo'] },
  },
  {
    name: 'gastos_recientes',
    description: 'Los gastos registrados en los últimos días (de todo el workspace o de un negocio): total, cuántos y los últimos 10 con fecha, monto, categoría, descripción, negocio y si tienen soporte. Para «cuánto gasté hoy», «mis egresos», «movimientos». Solo lectura.',
    parameters: { type: 'object', properties: { dias: { type: 'number', description: '1 = hoy (por defecto 1, máximo 60).' }, codigo: { type: 'string', description: 'Opcional: el código del negocio.' } } },
  },
];

/**
 * Cierra el turno con la pregunta del destino armada por el CÓDIGO (2026-10-21): los negocios abiertos en su orden, con
 * código, empresa y nombre, y «Gasto de empresa» siempre al final. Medido en el arnés: cuando el modelo armaba la lista,
 * a veces ponía «Gasto de empresa» primero y un «1» (el primer negocio, como en el bot de siempre) terminaba en empresa.
 */
export const CIERRES_ONE: DeclaracionHerramienta[] = [
  {
    name: 'preguntar_destino',
    description: 'Cuando falta a qué negocio va un gasto o una actividad: el sistema manda la pregunta con la lista de negocios abiertos (código, empresa y nombre, en orden) y, para un gasto, «Gasto de empresa» al final. Cierra el turno. No armes tú esa lista con `responder`.',
    parameters: {
      type: 'object',
      properties: {
        para: { type: 'string', enum: ['gasto', 'actividad'] },
        texto: { type: 'string', description: 'La pregunta en una línea, con lo que ya sabes («¿A cuál negocio va el gasto de $47.600?»).' },
        reglas_usadas: { type: 'array', items: { type: 'string' } },
      },
      required: ['para', 'texto'],
    },
  },
];

export const OPCION_EMPRESA = 'Gasto de empresa';

/**
 * ¿La respuesta del modelo trae su propia lista para elegir el destino? (arnés con el modelo real, 2026-10-21: en vez de
 * `preguntar_destino`, el modelo armó la lista con `negocios_abiertos` y puso «Gasto de empresa» PRIMERO; el «1» de la
 * persona, que en el bot de siempre era el primer negocio, terminó como gasto de empresa). Esa lista solo la arma el
 * código. Devuelve el error para el modelo, o null. Pura.
 */
export function listaDeDestinoDelModelo(salida: Salida): string | null {
  if (!('opciones' in salida)) return null;
  const titulos = salida.opciones.map((o) => o.titulo.trim());
  // Elegir entre negocios que salieron de una búsqueda (dos de la misma empresa) sí lo pregunta el modelo; lo que no
  // puede es ofrecer «Gasto de empresa» en su propia lista.
  if (!titulos.some((t) => t.toLowerCase() === OPCION_EMPRESA.toLowerCase())) return null;
  return 'No armes tú la lista para elegir el negocio (ni la opción «Gasto de empresa»): llama `preguntar_destino` y el sistema manda la lista en su orden. Si la persona ya eligió, propón con lo que eligió.';
}

/** Las filas de foto o PDF que ya son el soporte de ESTE gasto (para no confundirlo con el de otro). Pura. */
function soportesDelGasto(filas: FilaConversacion[], gastoId: string): Set<string> {
  const s = new Set<string>();
  for (const f of filas) {
    if (f.traza?.ejecucion?.resultado !== 'ejecutada') continue;
    for (const e of f.traza.ejecucion.escrituras ?? []) {
      const gasto = e.tipo === 'gasto' ? e.id : e.gasto;
      if (gasto === gastoId && typeof e.foto === 'string') s.add(e.foto);
    }
  }
  return s;
}

const categorias = Object.keys(CATEGORIA_LABELS);

const DATOS_PROPONER_ONE: Record<string, unknown> = {
  monto: { type: 'number', description: 'gasto: el monto en pesos como número (47.600 → 47600; 27 mil → 27000). corregir_gasto: el monto nuevo.' },
  negocio: { type: 'string', description: 'gasto / actividad: el código del negocio tal como lo devolvió una herramienta («I1 26 5»). Vacío si es gasto de empresa.' },
  empresa: { type: 'boolean', description: 'gasto: true si es gasto de empresa (sin negocio). Solo si la persona lo dijo o lo eligió.' },
  empresa_dicho_en: { type: 'string', description: 'gasto de empresa: el #n del mensaje de la persona donde lo dijo o donde tocó «Gasto de empresa».' },
  categoria: { type: 'string', enum: categorias, description: 'gasto: la deduces del concepto; sin concepto, otros.' },
  descripcion: { type: 'string', description: 'gasto: el concepto con las palabras de la persona, corto, sin el monto ni el negocio. Vacío si no dijo concepto.' },
  soporte: { type: 'string', description: 'gasto / corregir_gasto: el #n de la foto o el PDF del recibo, si llegó uno. adjuntar_soporte: ese #n.' },
  gasto: { type: 'string', description: 'adjuntar_soporte / corregir_gasto: el gasto (G1, G2… del Estado, o el id que devolvió gastos_recientes para uno de otro momento).' },
  monto_distinto: { type: 'boolean', description: 'adjuntar_soporte: true solo si la persona ya dijo que ese soporte va con ese gasto aunque el monto leído sea otro.' },
  tipo: { type: 'string', enum: [...TIPOS_ACTIVIDAD], description: 'actividad: qué fue.' },
  texto: { type: 'string', description: 'actividad: lo que pasó, con las palabras de la persona.' },
  nombre: { type: 'string', description: 'contacto_nuevo: el nombre completo.' },
  telefono: { type: 'string', description: 'contacto_nuevo: el celular, solo si la persona lo escribió.' },
  cargo: { type: 'string', description: 'contacto_nuevo: el cargo o el rol, si lo dijo.' },
  decisor: { type: 'boolean', description: 'contacto_nuevo: true si es quien decide la compra (dueño, gerente, arquitecto a cargo).' },
};

type Resultado<T> = { ok: true; v: T } | { ok: false; error: string; candado: string };

const sinPermiso = (que: string): { ok: false; error: string; candado: string } =>
  ({ ok: false, error: `El rol de quien escribe no permite ${que} por aquí. Dilo en una línea (puede pedírselo a su administrador o hacerlo en la app).`, candado: 'rol' });

/** Lo que el bot dice tras registrar un gasto sin soporte (antes: «📷 Si tienes la foto del soporte, mándamela»). */
export const TEXTO_PEDIR_SOPORTE = '📎 Si tienes el soporte, mándamelo: foto o PDF.';

/** Ventana de los adjuntos: foto o PDF y su texto en mensajes separados se atienden juntos (el corte del dominio ONE). */
export const VENTANA_ADJUNTOS_ONE_MS = 5000;
/** Solo se preparan (bajan, suben y leen) los soportes de la última hora, y máximo estos por turno. */
const PREPARAR_DESDE_MS = 60 * 60 * 1000;
const PREPARAR_MAX = 4;

export function dominioOne(puerto: PuertoOne, o: { rol: string; ahora?: () => number; lector?: Lector | null }): Dominio {
  const permisos = permisosDe(o.rol);
  const ahora = o.ahora ?? (() => Date.now());
  // Baja, sube y lee los soportes recientes que todavía no se prepararon (`../adjuntos.ts`, común con la bandeja).
  const prepararTurno = preparadorDeAdjuntos(puerto, {
    lector: o.lector ?? null, ahora, desdeMs: PREPARAR_DESDE_MS, max: PREPARAR_MAX, omitir: (ctx) => fotosUsadas(ctx.conversacion),
  });

  // Los gastos de la conversación contra la base: una consulta por turno (el Estado y la propuesta la piden en el mismo).
  const cruces = new WeakMap<FilaConversacion[], Promise<ReturnType<typeof cruzarConLaBase>>>();
  function gastosVigentes(ctx: ContextoDominio): Promise<ReturnType<typeof cruzarConLaBase>> {
    let p = cruces.get(ctx.conversacion);
    if (!p) {
      const deAqui = gastosDeLaConversacion(ctx.conversacion);
      p = (deAqui.length ? puerto.gastosPorId(deAqui.map((g) => g.id)).catch(() => 'error' as const) : Promise.resolve([] as GastoOne[]))
        .then((enBase) => cruzarConLaBase(deAqui, enBase));
      cruces.set(ctx.conversacion, p);
    }
    return p;
  }

  /** Los gastos de la conversación que ya no están en la base (su soporte vuelve a quedar libre). */
  const borradosDe = async (ctx: ContextoDominio) => new Set((await gastosVigentes(ctx)).borrados.map((g) => g.id));

  /**
   * El gasto al que va un soporte o una corrección: uno de esta conversación (G1, G2…) o el id que devolvió
   * `gastos_recientes`, y que SIGUE en la base (uno borrado en la app no se toca ni se nombra como registrado).
   */
  async function gastoParaTocar(ref: string, ctx: ContextoDominio): Promise<Resultado<{ id: string; ref: string; monto: number; etiqueta: string; soporte: boolean; revisado: boolean }>> {
    const c = await gastosVigentes(ctx);
    const borrado = c.borrados.find((x) => x.ref.toLowerCase() === ref.toLowerCase() || x.id === ref);
    if (borrado) {
      return { ok: false, error: `${borrado.ref} (${formatCOP(borrado.monto)} · ${borrado.etiqueta}) ya no está en ONE: lo borraron después de registrarlo. No digas que está registrado. Si este dato es de un gasto, propón un gasto nuevo.`, candado: 'gasto_borrado' };
    }
    const deAqui = c.vigentes.find((x) => x.ref.toLowerCase() === ref.toLowerCase() || x.id === ref);
    if (deAqui) {
      // La base no se pudo leer en el cruce: no se propone sobre un gasto que quizá ya no existe.
      if (!c.revisada) return { ok: false, error: 'No pude revisar ese gasto ahora. Dilo así, sin decir que está registrado.', candado: 'gasto_no_leido' };
      return { ok: true, v: { id: deAqui.id, ref: deAqui.ref, monto: deAqui.monto, etiqueta: deAqui.etiqueta, soporte: deAqui.soporte, revisado: deAqui.revisado === true } };
    }
    if (/^[0-9a-f-]{36}$/i.test(ref)) {
      const leido = await puerto.gasto(ref);
      if (leido === 'error') return { ok: false, error: 'No pude revisar ese gasto ahora.', candado: 'gasto_no_leido' };
      if (!leido) return { ok: false, error: 'Ese gasto no está en ONE (no existe o lo borraron). No digas que está registrado.', candado: 'gasto_borrado' };
      return { ok: true, v: { id: leido.id, ref: leido.id, monto: leido.monto, etiqueta: leido.negocio ?? 'Gasto de empresa', soporte: leido.soporte, revisado: leido.revisado === true } };
    }
    const lista = c.vigentes.map((x) => `${x.ref} (${formatCOP(x.monto)}, ${x.negocio ?? 'empresa'})`).join(', ');
    return {
      ok: false,
      error: `No sé a qué gasto te refieres. ${lista ? `Los de esta conversación: ${lista}.` : 'En esta conversación no hay gastos registrados.'} Si es de otro momento, búscalo con gastos_recientes y usa su id.`,
      candado: 'gasto_desconocido',
    };
  }

  async function negocioReal(codigo: unknown): Promise<Resultado<NegocioOne>> {
    const c = String(codigo ?? '').trim();
    if (!c) return { ok: false, error: 'Falta el negocio: el código tal como lo devolvió buscar_negocios o negocios_abiertos.', candado: 'sin_negocio' };
    const n = await puerto.negocioPorCodigo(c);
    if (n === 'error') return { ok: false, error: 'No pude revisar el negocio ahora. Dilo así, sin decir que no existe.', candado: 'negocio_no_leido' };
    if (!n) return { ok: false, error: `No hay un negocio abierto con código «${c}». Búscalo con buscar_negocios (por empresa o nombre) y usa el código que devuelva.`, candado: 'negocio_inexistente' };
    return { ok: true, v: n };
  }

  async function leer(nombre: string, args: Record<string, unknown>): Promise<ResultadoHerramienta> {
    if (nombre === 'buscar_negocios') {
      if (!permisos.negocios) return { ok: false, datos: null, error: sinPermiso('consultar negocios').error };
      const texto = String(args.texto ?? '').trim();
      if (!texto) return { ok: false, datos: null, error: 'Falta el texto a buscar.' };
      const r = await puerto.buscarNegocios(texto, 5);
      if (r === 'error') return { ok: false, datos: null, error: 'No pude buscar ahora. Di que no pudiste revisar, no que no existe.' };
      return { ok: true, datos: { negocios: r.map((n) => negocioParaModelo(n, permisos.plata)), ...(r.length ? {} : { nota: 'Ninguno abierto con eso.' }) }, privado: { ids: r.map((n) => n.id) } };
    }
    if (nombre === 'negocios_abiertos') {
      if (!permisos.negocios) return { ok: false, datos: null, error: sinPermiso('consultar negocios').error };
      const etapa = ETAPAS.includes(String(args.etapa ?? '')) ? String(args.etapa) : null;
      const r = await puerto.negociosAbiertos(etapa, 10);
      if (r === 'error') return { ok: false, datos: null, error: 'No pude leer los negocios ahora. Di que no pudiste revisar.' };
      return { ok: true, datos: { total: r.total, por_etapa: r.porEtapa, negocios: r.negocios.map((n) => negocioParaModelo(n, permisos.plata)), ...(r.total > r.negocios.length ? { nota: `Se muestran ${r.negocios.length} de ${r.total}.` } : {}) } };
    }
    if (nombre === 'ver_negocio') {
      if (!permisos.negocios) return { ok: false, datos: null, error: sinPermiso('consultar negocios').error };
      const n = await negocioReal(args.codigo);
      if (!n.ok) return { ok: false, datos: null, error: n.error };
      let gastado: unknown;
      if (permisos.plata) {
        const inicioMes = new Date(ahora());
        const desde = new Date(Date.UTC(inicioMes.getUTCFullYear(), inicioMes.getUTCMonth(), 1, 5)).toISOString();
        const g = await puerto.gastosRecientes({ desdeIso: desde, negocioId: n.v.id, limite: 1 });
        if (g !== 'error') gastado = { este_mes: formatCOP(g.total), gastos: g.cantidad };
      }
      return { ok: true, datos: { ...negocioParaModelo(n.v, permisos.plata), ...(gastado ? { gastado } : {}) }, sobre: n.v.codigo };
    }
    if (nombre === 'gastos_recientes') {
      if (!permisos.gastos) return { ok: false, datos: null, error: sinPermiso('consultar los gastos').error };
      const dias = Math.min(60, Math.max(1, Math.round(Number(args.dias) || 1)));
      let negocioId: string | null = null;
      if (args.codigo) {
        const n = await negocioReal(args.codigo);
        if (!n.ok) return { ok: false, datos: null, error: n.error };
        negocioId = n.v.id;
      }
      // «Hoy» es desde la medianoche de Bogotá (UTC-5) de hace `dias - 1` días.
      const bogota = new Date(ahora() - 5 * 3600 * 1000);
      const desde = new Date(Date.UTC(bogota.getUTCFullYear(), bogota.getUTCMonth(), bogota.getUTCDate() - (dias - 1), 5)).toISOString();
      const r = await puerto.gastosRecientes({ desdeIso: desde, negocioId, limite: 10 });
      if (r === 'error') return { ok: false, datos: null, error: 'No pude leer los gastos ahora. Di que no pudiste revisar.' };
      return {
        ok: true,
        datos: {
          desde: desde.slice(0, 10), total: formatCOP(r.total), cantidad: r.cantidad,
          gastos: r.gastos.map((g) => ({ id: g.id, fecha: g.fecha, monto: formatCOP(g.monto), categoria: CATEGORIA_LABELS[g.categoria] ?? g.categoria, descripcion: g.descripcion, negocio: g.negocio ?? 'empresa', soporte: g.soporte })),
        },
      };
    }
    return { ok: false, datos: null, error: `No existe la herramienta «${nombre}».` };
  }

  async function proponerGasto(d: Record<string, unknown>, ctx: ContextoDominio): Promise<Resultado<Propuesta>> {
    // Un número (o solo dígitos): leer «47.600» o «27 mil» es del modelo (glo.monto), no del código.
    const monto = typeof d.monto === 'number' ? d.monto : /^\d+$/.test(String(d.monto ?? '').trim()) ? Number(d.monto) : NaN;
    if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'Falta el monto (un número mayor que cero). Pregúntalo si la persona no lo dijo.', candado: 'monto' };
    const categoria = String(d.categoria ?? '');
    if (!categorias.includes(categoria)) return { ok: false, error: `Categoría inválida. Usa una de: ${categorias.join(', ')}.`, candado: 'categoria' };
    const codigo = String(d.negocio ?? '').trim();
    const deEmpresa = d.empresa === true;
    if (!codigo && !deEmpresa) return { ok: false, error: 'Falta el destino: llama `preguntar_destino` (el sistema manda la lista). No lo supongas ni armes tú la lista.', candado: 'sin_destino' };
    if (codigo && deEmpresa) return { ok: false, error: 'Un gasto va a un negocio O es de empresa, no las dos. Si no está claro, pregunta.', candado: 'destino_doble' };
    if (deEmpresa && !empresaDicha(ctx.conversacion, d.empresa_dicho_en)) {
      return { ok: false, error: 'Gasto de empresa solo como respuesta de la persona a `preguntar_destino` (que toque «Gasto de empresa» o lo diga después de esa lista): pon en `empresa_dicho_en` el #n de esa respuesta. Si todavía no se le preguntó, llama `preguntar_destino`, aunque ya lo haya dicho.', candado: 'empresa_sin_respaldo' };
    }
    let negocio: NegocioOne | null = null;
    if (codigo) {
      const n = await negocioReal(codigo);
      if (!n.ok) return n;
      negocio = n.v;
      const viaje = await puerto.serviciosPorPagar(negocio.id);
      if (viaje === true) return { ok: false, error: `${nombreNegocio(negocio)} es un viaje con servicios por pagar: el pago a un proveedor del viaje se registra en la app, en los servicios del viaje. Dilo así.`, candado: 'servicio_viaje' };
    }
    let foto: SoporteDeLaConversacion | null = null;
    if (d.soporte !== undefined && d.soporte !== null && String(d.soporte).trim() !== '') {
      const f = soporteDe(ctx.conversacion, d.soporte, await borradosDe(ctx));
      if ('error' in f) return { ok: false, error: f.error, candado: 'foto' };
      foto = f;
    }
    const descripcion = String(d.descripcion ?? '').trim() || null;
    const cc = await puerto.centroCostos({ negocioId: negocio?.id ?? null, descripcion });
    const etiquetaCentro = cc.centro === 'directa_negocio' ? 'Negocio' : cc.centro === 'distribuible_one' ? 'ONE' : cc.centro === 'distribuible_clarity' ? 'Clarity' : cc.centro ? 'Mixto' : null;
    const destino = negocio ? `📁 ${nombreNegocio(negocio)}` : '🏢 Gasto de empresa (sin negocio)';
    const resumen = [
      `💰 Gasto de ${formatCOP(monto)} · ${CATEGORIA_LABELS[categoria] ?? categoria}`,
      destino,
      ...(descripcion ? [`📝 ${corto(descripcion, 200)}`] : []),
      foto ? lineaSoporte(foto) : '📎 Sin soporte todavía',
      // El soporte dice otro monto: se ve en el resumen, nunca se adjunta callado.
      ...(foto?.lectura && montoDistinto(foto.lectura, monto) ? [lineaDistinto(foto.lectura, monto)] : []),
      ...(etiquetaCentro ? [`🏷️ Centro: ${etiquetaCentro}`] : []),
      '¿Lo registro?',
    ].join('\n');
    return {
      ok: true,
      v: {
        accion: 'gasto',
        datos: {
          monto, categoria, descripcion, negocio_id: negocio?.id ?? null, negocio: negocio?.codigo ?? null,
          etiqueta: negocio ? nombreNegocio(negocio) : 'Gasto de empresa', foto: foto?.fila ?? null, media_id: foto?.mediaId ?? null,
          ...(foto ? { ref: foto.ref, tipo_soporte: foto.tipo } : {}),
          // `mensaje_original` NO va aquí: cambia con cada mensaje y la misma propuesta dejaría de ser «la misma»
          // (`propuesta_repetida`). Se toma al ejecutar.
          centro: cc.centro, origen: cc.origen,
        },
        resumen, ...(negocio ? { sobre: negocio.codigo } : {}), si: 'Registrar', no: 'No',
      },
    };
  }

  async function proponerSoporte(d: Record<string, unknown>, ctx: ContextoDominio): Promise<Resultado<Propuesta>> {
    const f = soporteDe(ctx.conversacion, d.soporte, await borradosDe(ctx));
    if ('error' in f) return { ok: false, error: f.error, candado: 'foto' };
    const r = await gastoParaTocar(String(d.gasto ?? '').trim(), ctx);
    if (!r.ok) return r;
    const g = r.v;
    if (g.soporte) return { ok: false, error: 'Ese gasto ya tiene soporte (cambiar el soporte de un gasto no se hace por aquí). Si este archivo es de otro gasto, propón ese gasto con este soporte.', candado: 'ya_tiene_soporte' };
    // El soporte dice otro monto (caso real: gasto de $27.000 y recibo de $6.880): no se adjunta callado.
    const distinto = montoDistinto(f.lectura, g.monto);
    if (distinto && d.monto_distinto !== true) {
      return {
        ok: false,
        error: `El soporte #${f.n} dice ${formatCOP(f.lectura!.monto!)} y ese gasto es de ${formatCOP(g.monto)}. No lo adjuntes callado: dilo y propón lo concreto según lo que diga la persona (corregir_gasto con el monto del soporte, o un gasto nuevo con este soporte si es otro gasto, p. ej. la ida y la vuelta). Si la persona ya dijo que va así, pon monto_distinto: true.`,
        candado: 'monto_distinto',
      };
    }
    const doc = f.tipo === 'documento';
    return {
      ok: true,
      v: {
        accion: 'adjuntar_soporte',
        datos: { gasto_id: g.id, foto: f.fila, media_id: f.mediaId, ref: f.ref, etiqueta: g.etiqueta, monto: g.monto },
        resumen: [
          `${doc ? `📎 ${corto(f.nombre || `El documento #${f.n}`, 80)}` : `📷 La foto #${f.n}`} como soporte del gasto de ${formatCOP(g.monto)} · ${g.etiqueta}`,
          ...(distinto ? [lineaDistinto(f.lectura!, g.monto)] : []),
          `¿${doc ? 'Lo' : 'La'} adjunto?`,
        ].join('\n'),
        si: 'Adjuntar', no: 'No',
      },
    };
  }

  /**
   * Cambiar el monto de un gasto (el soporte dice otro, o la persona lo corrige), con el soporte si viene: uno de esta
   * conversación o uno de `gastos_recientes`, que siga en la base y que contabilidad no haya revisado. El bot lo propone
   * él mismo en vez de mandar a «corregirlo en la app» (2026-10-21).
   */
  async function proponerCorreccion(d: Record<string, unknown>, ctx: ContextoDominio): Promise<Resultado<Propuesta>> {
    const r = await gastoParaTocar(String(d.gasto ?? '').trim(), ctx);
    if (!r.ok) return r;
    const g = r.v;
    if (g.revisado) return { ok: false, error: `Contabilidad ya revisó el gasto de ${formatCOP(g.monto)} · ${g.etiqueta}: ese monto ya no se cambia por aquí. Dilo en una línea (lo cambia quien administra la contabilidad, en la app).`, candado: 'gasto_revisado' };
    const monto = typeof d.monto === 'number' ? d.monto : /^\d+$/.test(String(d.monto ?? '').trim()) ? Number(d.monto) : NaN;
    if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'Falta el monto nuevo (un número mayor que cero).', candado: 'monto' };
    if (Math.abs(monto - g.monto) <= 1) return { ok: false, error: `El gasto ${g.ref} ya es de ${formatCOP(g.monto)}: no hay nada que corregir.`, candado: 'mismo_monto' };
    let f: SoporteDeLaConversacion | null = null;
    // El soporte que ya es de ESTE gasto no es un soporte nuevo: se corrige solo el monto (arnés 2026-10-21, s-choque-monto:
    // el modelo mandó el #1 del propio G1 y el candado de «ya es el soporte de otro gasto» trabó la corrección dos veces).
    const n = numeroDeFila(d.soporte);
    const propio = n !== null && soportesDelGasto(ctx.conversacion, g.id).has(ctx.conversacion[n - 1]?.id ?? '');
    if (!propio && d.soporte !== undefined && d.soporte !== null && String(d.soporte).trim() !== '') {
      const s2 = soporteDe(ctx.conversacion, d.soporte, await borradosDe(ctx));
      if ('error' in s2) return { ok: false, error: s2.error, candado: 'foto' };
      if (g.soporte) return { ok: false, error: `El gasto ${g.ref} ya tiene soporte: corrige solo el monto, o propón un gasto nuevo con este soporte.`, candado: 'ya_tiene_soporte' };
      f = s2;
    }
    return {
      ok: true,
      v: {
        accion: 'corregir_gasto',
        datos: { gasto_id: g.id, monto_antes: g.monto, monto, etiqueta: g.etiqueta, foto: f?.fila ?? null, media_id: f?.mediaId ?? null, ref: f?.ref ?? null },
        resumen: [
          `✏️ El gasto de ${formatCOP(g.monto)} · ${g.etiqueta} queda en ${formatCOP(monto)}`,
          ...(f ? [lineaSoporte(f)] : []),
          ...(f?.lectura && montoDistinto(f.lectura, monto) ? [lineaDistinto(f.lectura, monto)] : []),
          '¿Lo cambio?',
        ].join('\n'),
        si: 'Cambiar', no: 'No',
      },
    };
  }

  async function proponerActividad(d: Record<string, unknown>): Promise<Resultado<Propuesta>> {
    const texto = String(d.texto ?? '').trim();
    if (!texto) return { ok: false, error: 'Falta el texto de la actividad (lo que pasó, con las palabras de la persona).', candado: 'sin_texto' };
    const tipo = (TIPOS_ACTIVIDAD as readonly string[]).includes(String(d.tipo)) ? String(d.tipo) as TipoActividad : 'nota';
    const n = await negocioReal(d.negocio);
    if (!n.ok) return n;
    return {
      ok: true,
      v: {
        accion: 'actividad',
        datos: { negocio_id: n.v.id, negocio: n.v.codigo, etiqueta: nombreNegocio(n.v), tipo, texto },
        resumen: `${EMOJI_ACTIVIDAD[tipo]} Actividad en ${nombreNegocio(n.v)}:\n«${corto(texto, 400)}»\n¿La registro?`,
        sobre: n.v.codigo, si: 'Registrar', no: 'No',
      },
    };
  }

  async function proponerContacto(d: Record<string, unknown>, ctx: ContextoDominio): Promise<Resultado<Propuesta>> {
    const nombre = String(d.nombre ?? '').trim();
    if (!nombre) return { ok: false, error: 'Falta el nombre del contacto.', candado: 'sin_nombre' };
    const telefono = digitos(d.telefono) || null;
    if (telefono) {
      if (!telefonoEnLaConversacion(ctx.conversacion, telefono)) return { ok: false, error: 'Ese teléfono no está escrito en la conversación: usa el que escribió la persona, o ninguno.', candado: 'telefono_sin_respaldo' };
      const dup = await puerto.contactoDuplicado(telefono);
      if (dup === 'error') return { ok: false, error: 'No pude revisar si ese teléfono ya existe. No lo crees: dilo así.', candado: 'duplicado_no_leido' };
      if (dup) return { ok: false, error: `Ese teléfono ya es del contacto ${dup}. No se crea otro: dilo así (si son dos personas distintas, que lo registre en la app).`, candado: 'contacto_duplicado' };
    }
    const cargo = String(d.cargo ?? '').trim() || null;
    return {
      ok: true,
      v: {
        accion: 'contacto_nuevo',
        datos: { nombre, telefono, cargo, decisor: d.decisor === true },
        resumen: `👤 Contacto nuevo: ${[nombre, telefono, cargo].filter(Boolean).join(' · ')}\n¿Lo creo?`,
        si: 'Crear', no: 'No',
      },
    };
  }

  async function proponer(accion: string, datos: Record<string, unknown>, ctx: ContextoDominio): Promise<{ ok: true; propuesta: Propuesta } | { ok: false; error: string; candado: string }> {
    if (accion === 'contacto_nuevo' ? !permisos.contactos : !permisos.escribir) {
      return sinPermiso(accion === 'contacto_nuevo' ? 'crear contactos' : 'registrar');
    }
    const r = accion === 'gasto' ? await proponerGasto(datos, ctx)
      : accion === 'adjuntar_soporte' ? await proponerSoporte(datos, ctx)
      : accion === 'corregir_gasto' ? await proponerCorreccion(datos, ctx)
        : accion === 'actividad' ? await proponerActividad(datos)
          : accion === 'contacto_nuevo' ? await proponerContacto(datos, ctx)
            : { ok: false as const, error: `Acción desconocida. Usa una de: ${ACCIONES_ONE.join(', ')}.`, candado: 'accion_desconocida' };
    return r.ok ? { ok: true, propuesta: r.v } : r;
  }

  async function ejecutar(p: Propuesta, ctx: ContextoDominio): Promise<Hechos> {
    const d = p.datos;
    if (p.accion === 'gasto') {
      const r = await puerto.registrarGasto({
        monto: Number(d.monto), categoria: String(d.categoria), descripcion: (d.descripcion as string | null) ?? null,
        mensajeOriginal: ultimoTextoDelEquipo(ctx.conversacion), negocioId: (d.negocio_id as string | null) ?? null,
        centro: (d.centro as string | null) ?? null, origen: (d.origen as string | null) ?? null, mediaId: (d.media_id as string | null) ?? null,
        ref: (d.ref as string | null) ?? null,
      });
      const lineas = [
        `✅ Gasto de ${formatCOP(Number(d.monto))} registrado · ${String(d.etiqueta)}`,
        r.soporte === 'guardado' ? '📎 Con su soporte.' : r.soporte === 'fallo' ? '⚠️ No pude guardar el soporte: súbelo después desde la app.' : TEXTO_PEDIR_SOPORTE,
      ];
      return { lineas, escrituras: [{ tipo: 'gasto', id: r.id, monto: Number(d.monto), negocio: d.negocio ?? null, etiqueta: d.etiqueta, soporte: r.soporte === 'guardado', ...(r.soporte === 'guardado' ? { foto: d.foto } : {}) }] };
    }
    if (p.accion === 'adjuntar_soporte') {
      const ok = await puerto.adjuntarSoporte(String(d.gasto_id), String(d.media_id), (d.ref as string | null) ?? null);
      if (!ok) throw new Error('no se pudo guardar el soporte');
      return { lineas: [`📎 Soporte guardado en el gasto de ${formatCOP(Number(d.monto))} · ${String(d.etiqueta)}.`], escrituras: [{ tipo: 'soporte', gasto: d.gasto_id, foto: d.foto }] };
    }
    if (p.accion === 'corregir_gasto') {
      const r = await puerto.corregirGasto({ gastoId: String(d.gasto_id), monto: Number(d.monto), mediaId: (d.media_id as string | null) ?? null, ref: (d.ref as string | null) ?? null });
      const lineas = [
        `✅ El gasto · ${String(d.etiqueta)} quedó en ${formatCOP(Number(d.monto))} (antes ${formatCOP(Number(d.monto_antes))}).`,
        ...(d.media_id ? [r.soporte === 'guardado' ? '📎 Con su soporte.' : '⚠️ No pude guardar el soporte: súbelo después desde la app.'] : []),
      ];
      return {
        lineas,
        escrituras: [{ tipo: 'correccion', gasto: d.gasto_id, monto_antes: Number(d.monto_antes), monto: Number(d.monto), soporte: r.soporte === 'guardado', ...(r.soporte === 'guardado' ? { foto: d.foto } : {}) }],
      };
    }
    if (p.accion === 'actividad') {
      await puerto.registrarActividad({ negocioId: String(d.negocio_id), tipo: d.tipo as TipoActividad, texto: String(d.texto) });
      return { lineas: [`✅ ${EMOJI_ACTIVIDAD[d.tipo as TipoActividad] ?? '📝'} Actividad registrada en ${String(d.etiqueta)}.`], escrituras: [{ tipo: 'actividad', negocio: d.negocio, texto: d.texto }] };
    }
    if (p.accion === 'contacto_nuevo') {
      const r = await puerto.crearContacto({ nombre: String(d.nombre), telefono: (d.telefono as string | null) ?? null, cargo: (d.cargo as string | null) ?? null, decisor: d.decisor === true });
      return { lineas: [`✅ Contacto creado: ${String(d.nombre)}.`, 'Completa sus datos fiscales en la app para poder facturarle.'], escrituras: [{ tipo: 'contacto', id: r.id, nombre: d.nombre, telefono: d.telefono ?? null }] };
    }
    throw new Error(`acción desconocida: ${p.accion}`);
  }

  async function cerrar(nombre: string, args: Record<string, unknown>): Promise<{ ok: true; salidas: Salida[]; datos?: unknown } | { ok: false; error: string; candado: string }> {
    if (nombre !== 'preguntar_destino') return { ok: false, error: `No existe «${nombre}».`, candado: 'cierre_desconocido' };
    if (!permisos.negocios) return sinPermiso('consultar negocios');
    const r = await puerto.negociosAbiertos(null, 9);
    if (r === 'error') return { ok: false, error: 'No pude leer los negocios ahora. Dilo así.', candado: 'negocios_no_leidos' };
    const gasto = args.para !== 'actividad';
    if (!r.negocios.length) {
      return { ok: false, error: gasto ? 'No hay negocios abiertos: pregunta si es gasto de empresa.' : 'No hay negocios abiertos: dilo (la actividad va en un negocio).', candado: 'sin_negocios' };
    }
    const opciones = [
      ...r.negocios.map((n) => ({ titulo: n.codigo, descripcion: `${n.empresa || n.contacto || 'sin empresa'} — ${n.nombre}` })),
      ...(gasto ? [{ titulo: OPCION_EMPRESA }] : []),
    ];
    const pregunta = String(args.texto ?? '').trim().split('\n')[0].slice(0, 200) || '¿A cuál negocio va?';
    // Con 3 opciones o menos salen botones (sin descripción): el detalle de cada negocio va en el cuerpo.
    const cuerpo = opciones.length <= 3
      ? [pregunta, ...r.negocios.map((n) => `• ${nombreNegocio(n)}`)].join('\n')
      : pregunta;
    const render = renderizar(cuerpo, opciones, { turno: crypto.randomUUID().slice(0, 8), topeTexto: 1000, final: true });
    if (!render.ok) return { ok: false, error: render.error, candado: 'formato_meta' };
    return { ok: true, salidas: [render.salida], datos: { negocios: r.negocios.map((n) => nombreNegocio(n)), empresa: gasto } };
  }

  return {
    bot: BOT_ONE,
    prepararTurno,
    ventanaAdjuntosMs: VENTANA_ADJUNTOS_ONE_MS,
    // Tras un hecho, si quedan soportes sin usar (varias fotos o PDF seguidos) o se acaba de corregir un monto (la otra
    // parte puede ser otro gasto), el modelo tiene un turno para proponer lo siguiente.
    async trasEjecutar(p, h, _huella, ctx) {
      const usado = new Set((h.escrituras ?? []).map((w) => w.foto).filter((x): x is string => typeof x === 'string'));
      const usadas = fotosUsadas(ctx.conversacion);
      const quedan = ctx.conversacion.some((f) => esSoporte(f) && !usadas.has(f.id) && !usado.has(f.id) && f.media.lectura !== undefined);
      return p.accion === 'corregir_gasto' || (quedan && ['gasto', 'adjuntar_soporte'].includes(p.accion)) ? { lineas: h.lineas, seguir: true } : null;
    },
    // La base manda (2026-10-21): los gastos que la conversación dice que se registraron, revisados en este turno.
    registros: async (ctx) => registrosDeGastos(await gastosVigentes(ctx)),
    revisarRespuesta: (s) => listaDeDestinoDelModelo(s),
    cierres: CIERRES_ONE,
    cerrar: (n, a) => cerrar(n, a),
    reenvios: 'mensaje',
    propuestaVenceConRespuesta: true,
    lecturas: LECTURAS_ONE,
    acciones: ACCIONES_ONE,
    datosProponer: DATOS_PROPONER_ONE,
    leer: (n, a) => leer(n, a),
    proponer,
    ejecutar: (p, ctx) => ejecutar(p, ctx),
    async estado(ctx) {
      const p = permisos;
      const puede = [p.escribir ? 'registrar gastos y actividades' : null, p.contactos ? 'crear contactos' : null, p.negocios ? 'consultar negocios' : null, p.gastos ? 'consultar gastos' : null].filter(Boolean);
      return [
        `Su rol permite: ${puede.length ? puede.join(', ') : 'nada por este chat'}.`,
        ultimaLista(ctx.conversacion),
        // Los gastos de la conversación (vigentes y borrados) los pone el núcleo con `registros`, revisados en la base. Sin
        // ninguno, la línea de siempre (el Estado queda igual que antes para quien todavía no registró nada).
        fotosSinUsar(ctx.conversacion, await borradosDe(ctx)),
        ...(gastosDeLaConversacion(ctx.conversacion).length ? [] : ['Gastos registrados en esta conversación: ninguno.']),
      ];
    },
  };
}
