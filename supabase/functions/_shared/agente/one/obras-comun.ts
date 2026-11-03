// ============================================================
// Dominio ONE en modo obras — lo común a gestión y operarios (2026-10-21)
// ------------------------------------------------------------
// Diseño: proyectos/imperviun/proyecto-360/docs/diseno/asistente-whatsapp.md (§2 a §5, §6.2).
// Un workspace con `bot_conversacional.obras = true` registra por WhatsApp pagos con su pantallazo (número de
// transacción y fecha leídos), ingresos ligados a la obra y a la factura, facturas emitidas, y las llegadas de los
// operarios a la obra; y consulta el cierre de cada obra y la asistencia. Nada de un cliente en el código: obras,
// rubros, operarios y facturas salen de la base del workspace.
// La base la toca un `PuertoObras` (producción: `puerto-obras-supabase.ts`; pruebas y arnés: `puerto-obras-memoria.ts`).
// ============================================================

import type { PuertoOne, SoporteGuardado } from './dominio.ts';

/** Una obra activa: negocio abierto en ejecución o cobro, sin pausa. */
export interface ObraOne {
  id: string;
  codigo: string;
  nombre: string;
  /** El nombre para un botón (C21, ≤ 20). */
  nombre_corto: string | null;
  empresa: string | null;
  etapa: string | null;
}

export interface RubroOne {
  id: string;
  nombre: string;
  descripcion: string | null;
  ejemplos: string | null;
  /** La categoría fiscal de siempre a la que va el gasto. */
  categoria: string;
}

export interface FacturaOne {
  id: string;
  numero: string;
  fecha: string;
  monto: number;
  negocio_id: string | null;
  obra: string | null;
  recibido: number;
  estado: 'abierta' | 'pagada';
}

/** Un pago (gasto), un ingreso (cobro) o una factura ya registrados. */
export interface RegistroOne {
  tipo: 'pago' | 'ingreso' | 'factura';
  id: string;
  fecha: string;
  monto: number;
  negocio_id: string | null;
  /** El nombre de la obra (o null = de empresa / sin obra). */
  obra: string | null;
  rubro_id?: string | null;
  rubro?: string | null;
  categoria?: string | null;
  factura_id?: string | null;
  factura?: string | null;
  numero?: string | null;
  descripcion?: string | null;
  revisado?: boolean;
}

export interface CierreObraOne {
  negocio_id: string;
  codigo: string;
  nombre: string;
  nombre_corto: string | null;
  estado: string | null;
  vendido: number;
  por_rubro: Array<{ rubro: string; total: number }>;
  gastos_total: number;
  mano_obra: number;
  jornadas: number;
  jornadas_sin_valor: number;
  utilidad: number;
  facturado: number;
  cobrado: number;
  retenido: number;
  por_cobrar: number;
}

export interface LlegadaOne {
  id: string;
  collaborator_id: string;
  persona: string;
  negocio_id: string;
  obra: string;
  fecha: string;
  /** ISO, la hora del mensaje en el servidor. */
  hora: string;
}

export interface OperarioOne { id: string; nombre: string }

export interface PuertoObras extends PuertoOne {
  obrasActivas(): Promise<ObraOne[] | 'error'>;
  /** La obra ACTIVA con ese código (normalizado). */
  obraPorCodigo(codigo: string): Promise<ObraOne | null | 'error'>;
  /** Los rubros activos del workspace, en su orden. Vacío = categorías fijas. */
  rubros(): Promise<RubroOne[] | 'error'>;
  /** Pagos e ingresos ya registrados con ese número de transacción. */
  pagosConNumero(numero: string): Promise<RegistroOne[] | 'error'>;
  /** Pagos e ingresos ya registrados con esa misma imagen. */
  pagosConHuella(huella: string): Promise<RegistroOne[] | 'error'>;
  /** Facturas abiertas (de una obra, o todas). */
  facturasAbiertas(negocioId: string | null): Promise<FacturaOne[] | 'error'>;
  facturasConNumero(numero: string): Promise<FacturaOne[] | 'error'>;
  registrarPago(p: {
    monto: number; fecha: string; categoria: string; rubroId: string | null; descripcion: string | null; negocioId: string | null;
    numero: string | null; repetido: boolean; huella: string | null; mediaId: string | null; ref: string | null;
    propuestaHuella: string; mensajeOriginal: string | null;
  }): Promise<{ id: string; soporte: SoporteGuardado }>;
  registrarIngreso(p: {
    monto: number; fecha: string; negocioId: string; facturaId: string | null; numero: string | null; repetido: boolean;
    huella: string | null; mediaId: string | null; ref: string | null; propuestaHuella: string; mensajeOriginal: string | null;
  }): Promise<{ id: string; soporte: SoporteGuardado }>;
  registrarFactura(p: {
    numero: string; fecha: string; monto: number; negocioId: string; repetido: boolean; mediaId: string | null; ref: string | null; propuestaHuella: string;
  }): Promise<{ id: string; soporte: SoporteGuardado }>;
  buscarRegistros(p: { tipo: RegistroOne['tipo']; monto: number | null; desde: string; negocioId: string | null; limite: number }): Promise<RegistroOne[] | 'error'>;
  registro(tipo: RegistroOne['tipo'], id: string): Promise<RegistroOne | null | 'error'>;
  /** Cambia los campos dados de un registro. Lanza si no pudo (un pago ya revisado se corrige en la app). */
  corregirRegistro(p: { tipo: RegistroOne['tipo']; id: string; cambios: { negocioId?: string | null; rubroId?: string | null; categoria?: string; fecha?: string; monto?: number; facturaId?: string | null } }): Promise<void>;
  cierreObra(negocioId: string): Promise<CierreObraOne | null | 'error'>;
  cierresActivos(): Promise<CierreObraOne[] | 'error'>;
  /** Llegadas entre dos días de Bogotá (inclusive), de una obra o de una persona si vienen. */
  llegadas(p: { desde: string; hasta: string; negocioId?: string | null; collaboratorId?: string | null }): Promise<LlegadaOne[] | 'error'>;
  /** Los colaboradores activos de tipo operario. */
  operarios(): Promise<OperarioOne[] | 'error'>;
  /** Mensajes del mes que llegaron al modelo (`bot_mensajes_mes`). */
  mensajesDelMes(mes: string): Promise<{ total: number; gestion: number; operario: number } | 'error'>;
  registrarLlegada(p: { collaboratorId: string; negocioId: string; fecha: string; hora: string; waMessageId: string | null; propuestaHuella: string }): Promise<{ id: string }>;
  cambiarLlegada(p: { llegadaId: string; negocioId: string; hora: string }): Promise<void>;
}

// ── Fechas y horas de Bogotá ─────────────────────────────────────────────────

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** El día de Bogotá (AAAA-MM-DD) de un instante. Pura. */
export function diaBogota(ms: number): string {
  return new Date(ms - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** «20-oct». Pura. */
export function fechaCorta(dia: string): string {
  const [, m, d] = dia.split('-').map(Number);
  return `${d}-${MESES_CORTOS[(m ?? 1) - 1] ?? ''}`;
}

/** «7:12 a. m.» en hora de Bogotá. Pura. */
export function horaBogota(iso: string): string {
  const d = new Date(Date.parse(iso) - 5 * 3600 * 1000);
  const h = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/** ¿Es un día real AAAA-MM-DD? Pura. */
export function esDia(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
}

/** El nombre de la obra en un botón o una línea corta. Pura. */
export function obraCorta(o: Pick<ObraOne, 'nombre' | 'nombre_corto'>): string {
  const n = (o.nombre_corto || o.nombre || '').trim();
  return [...n].length <= 20 ? n : `${[...n].slice(0, 19).join('')}…`;
}

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** El rubro con ese nombre (sin tildes ni mayúsculas). Pura. */
export function rubroPorNombre(rubros: RubroOne[], v: unknown): RubroOne | null {
  const t = normal(String(v ?? ''));
  return t ? rubros.find((r) => normal(r.nombre) === t) ?? null : null;
}

/** Los días de una lista de llegadas: total, por obra (días con una sola obra) y repartidos (dos obras). Pura. */
export function diasDe(llegadas: Array<Pick<LlegadaOne, 'fecha' | 'obra' | 'collaborator_id'>>): { dias: number; por_obra: Array<{ obra: string; dias: number }>; repartidos: number } {
  const porDia = new Map<string, Set<string>>();
  for (const l of llegadas) {
    const k = `${l.collaborator_id}|${l.fecha}`;
    const s = porDia.get(k) ?? new Set<string>();
    s.add(l.obra);
    porDia.set(k, s);
  }
  const porObra = new Map<string, number>();
  let repartidos = 0;
  for (const obras of porDia.values()) {
    if (obras.size >= 2) { repartidos++; continue; }
    const o = [...obras][0];
    porObra.set(o, (porObra.get(o) ?? 0) + 1);
  }
  return { dias: porDia.size, por_obra: [...porObra.entries()].sort((a, b) => b[1] - a[1]).map(([obra, dias]) => ({ obra, dias })), repartidos };
}

/** El primer mensaje del operario o de la persona que no es un toque, desde el final (su hora es la de la llegada). Pura. */
export function ultimoMensaje<T extends { direccion: string; clase: string; created_at: string; wa_message_id?: string | null }>(filas: T[]): T | null {
  return [...filas].reverse().find((f) => f.direccion === 'entrante' && f.clase !== 'toque') ?? null;
}
