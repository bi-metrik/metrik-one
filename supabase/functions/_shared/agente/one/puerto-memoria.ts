// ============================================================
// Dominio ONE — el puerto en memoria (pruebas y arnés), con la misma forma que `puerto-supabase.ts`
// ------------------------------------------------------------
// Negocios, gastos y contactos de juguete; lo que se escribe queda en `escrituras` (la verdad contra la que califica el
// arnés). La búsqueda imita `wa_find_negocios`: código normalizado manda; si no, todas las palabras en el nombre, la
// empresa o el contacto. Sin datos reales.
// ============================================================

import type { GastoOne, NegocioOne, PuertoOne, SoporteGuardado, TipoActividad } from './dominio.ts';
import type { ArchivoAdjunto } from './lectura-adjunto.ts';
import type { MediaFila } from '../tipos.ts';

export interface NegocioMem extends NegocioOne {
  /** Un viaje con servicios por pagar (el pago va por la pantalla de servicios). */
  viajeConServicios?: boolean;
}
export interface GastoMem extends GastoOne { negocioId: string | null }

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const llave = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const VACIAS = new Set(['al', 'el', 'la', 'las', 'los', 'lo', 'de', 'del', 'en', 'para', 'por', 'con', 'un', 'una', 'es', 'ese', 'esa', 'este', 'esta', 'va', 'proyecto', 'negocio', 'cliente', 'empresa', 'obra']);

export class PuertoOneMemoria implements PuertoOne {
  negocios: NegocioMem[];
  gastos: GastoMem[] = [];
  contactos: Array<{ id: string; nombre: string; telefono: string | null }> = [];
  escrituras: Array<Record<string, unknown>> = [];
  /** Media ids que Meta «no deja bajar» (para probar la falla del soporte). */
  mediaRota = new Set<string>();
  /** Para simular que la base no responde. */
  caida = false;
  /** Los archivos que «están en Meta», por media id (un PDF sintético, una foto). Sin entrada: una foto de juguete. */
  archivos = new Map<string, ArchivoAdjunto>();
  /** Lo que se subió a `gastos-soportes` al llegar (ref → media id) y lo anotado en cada fila. */
  subidos = new Map<string, string>();
  anotados = new Map<string, MediaFila>();
  /** Gastos ya revisados (no se corrigen por aquí). */
  revisados = new Set<string>();
  private n = 0;

  constructor(p: { negocios?: NegocioMem[]; contactos?: Array<{ id: string; nombre: string; telefono: string | null }>; gastos?: GastoMem[] } = {}) {
    this.negocios = p.negocios ?? [];
    this.contactos = p.contactos ?? [];
    this.gastos = p.gastos ?? [];
  }

  private id(prefijo: string) { return `${prefijo}-${++this.n}`; }

  async buscarNegocios(texto: string, limite: number): Promise<NegocioOne[] | 'error'> {
    if (this.caida) return 'error';
    const k = llave(texto);
    if (/\d/.test(k)) {
      const c = this.negocios.find((n) => llave(n.codigo) === k);
      if (c) return [{ ...c, coincidencia: 'codigo' }];
    }
    const palabras = normal(texto).split(' ').filter((w) => w.length >= 2 && !VACIAS.has(w));
    if (!palabras.length) return [];
    const exactas = this.negocios.filter((n) => {
      const t = ` ${normal(`${n.nombre} ${n.empresa ?? ''} ${n.contacto ?? ''}`)} `;
      return palabras.every((w) => t.includes(` ${w} `));
    });
    return exactas.slice(0, limite).map((n) => ({ ...n, coincidencia: 'exacta' as const }));
  }

  async negociosAbiertos(etapa: string | null, limite: number) {
    if (this.caida) return 'error' as const;
    const todos = this.negocios.filter((n) => !etapa || n.etapa === etapa);
    const porEtapa: Record<string, number> = {};
    for (const n of this.negocios) porEtapa[n.etapa ?? 'venta'] = (porEtapa[n.etapa ?? 'venta'] ?? 0) + 1;
    return { total: todos.length, porEtapa, negocios: todos.slice(0, limite) };
  }

  async negocioPorCodigo(codigo: string): Promise<NegocioOne | null | 'error'> {
    if (this.caida) return 'error';
    return this.negocios.find((n) => llave(n.codigo) === llave(codigo)) ?? null;
  }

  async serviciosPorPagar(negocioId: string): Promise<boolean | 'error'> {
    return this.negocios.find((n) => n.id === negocioId)?.viajeConServicios === true;
  }

  async centroCostos(p: { negocioId: string | null }) {
    return p.negocioId ? { centro: 'directa_negocio', origen: 'sugerido' } : { centro: null, origen: null };
  }

  async gastosRecientes(p: { desdeIso: string; negocioId: string | null; limite: number }) {
    if (this.caida) return 'error' as const;
    const gs = this.gastos.filter((g) => g.fecha >= p.desdeIso.slice(0, 10) && (!p.negocioId || g.negocioId === p.negocioId));
    return { total: gs.reduce((s, g) => s + g.monto, 0), cantidad: gs.length, gastos: gs.slice(-p.limite).reverse() };
  }

  async gasto(id: string): Promise<GastoOne | null | 'error'> {
    return this.gastos.find((g) => g.id === id) ?? null;
  }

  async contactoDuplicado(telefono: string): Promise<string | null | 'error'> {
    const t = telefono.replace(/\D/g, '').slice(-10);
    return this.contactos.find((c) => (c.telefono ?? '').replace(/\D/g, '').slice(-10) === t)?.nombre ?? null;
  }

  private soporteDe(mediaId: string | null, ref?: string | null): SoporteGuardado {
    if (ref) return 'guardado';
    return mediaId ? (this.mediaRota.has(mediaId) ? 'fallo' : 'guardado') : 'sin';
  }

  async bajarAdjunto(mediaId: string): Promise<ArchivoAdjunto | null> {
    if (this.mediaRota.has(mediaId)) return null;
    return this.archivos.get(mediaId) ?? { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: 'image/jpeg', nombre: null };
  }

  async guardarAdjunto(filaId: string, archivo: ArchivoAdjunto): Promise<string | null> {
    const ref = `one://gastos-soportes/ws/whatsapp/${filaId}.${archivo.mime === 'application/pdf' ? 'pdf' : 'jpg'}`;
    this.subidos.set(ref, filaId);
    return ref;
  }

  async anotarMedia(filaId: string, media: MediaFila): Promise<void> {
    this.anotados.set(filaId, media);
  }

  async corregirGasto(p: Parameters<PuertoOne['corregirGasto']>[0]): Promise<{ soporte: SoporteGuardado }> {
    const g = this.gastos.find((x) => x.id === p.gastoId);
    if (!g || this.revisados.has(p.gastoId)) throw new Error('el gasto no existe o ya se revisó');
    const soporte = this.soporteDe(p.mediaId, p.ref);
    const antes = g.monto;
    g.monto = p.monto;
    if (soporte === 'guardado') g.soporte = true;
    this.escrituras.push({ tipo: 'correccion', gasto: p.gastoId, monto_antes: antes, monto: p.monto, soporte: soporte === 'guardado' });
    return { soporte };
  }

  async registrarGasto(p: Parameters<PuertoOne['registrarGasto']>[0]): Promise<{ id: string; soporte: SoporteGuardado }> {
    const id = this.id('gasto');
    const soporte = this.soporteDe(p.mediaId, p.ref);
    const neg = this.negocios.find((n) => n.id === p.negocioId) ?? null;
    this.gastos.push({ id, fecha: '2026-10-21', monto: p.monto, categoria: p.categoria, descripcion: p.descripcion ?? '', negocio: neg?.codigo ?? null, negocioId: p.negocioId, soporte: soporte === 'guardado' });
    this.escrituras.push({ tipo: 'gasto', id, monto: p.monto, negocio: neg?.codigo ?? null, categoria: p.categoria, descripcion: p.descripcion, soporte: soporte === 'guardado', centro: p.centro });
    return { id, soporte };
  }

  async adjuntarSoporte(gastoId: string, mediaId: string, ref?: string | null): Promise<boolean> {
    if (!ref && this.mediaRota.has(mediaId)) return false;
    const g = this.gastos.find((x) => x.id === gastoId);
    if (!g) return false;
    g.soporte = true;
    this.escrituras.push({ tipo: 'soporte', gasto: gastoId });
    return true;
  }

  async registrarActividad(p: { negocioId: string; tipo: TipoActividad; texto: string }): Promise<void> {
    const neg = this.negocios.find((n) => n.id === p.negocioId);
    this.escrituras.push({ tipo: 'actividad', negocio: neg?.codigo ?? null, actividad: p.tipo, texto: p.texto });
  }

  async crearContacto(p: { nombre: string; telefono: string | null; cargo: string | null; decisor: boolean }): Promise<{ id: string }> {
    const id = this.id('contacto');
    this.contactos.push({ id, nombre: p.nombre, telefono: p.telefono });
    this.escrituras.push({ tipo: 'contacto', id, nombre: p.nombre, telefono: p.telefono });
    return { id };
  }
}
