// ============================================================
// Núcleo conversacional — los puertos en memoria (pruebas y arnés de medición)
// ------------------------------------------------------------
// Una base de juguete con la misma forma que la de verdad: la conversación (`wa_conversacion`, incluida la regla de la
// RPC de salientes), los candados (`tomar_candado`), el directorio, los viajes y lo que se escribió. Su estado final
// es la verdad contra la que el arnés califica (§3.8: «el estado final de la base»). Sin datos reales.
// ============================================================

import type { FichaCliente, Llave } from '../wa-cliente-reglas.ts';
import type { PuertoBandeja, ViajeAgente } from './bandeja/dominio.ts';
import type { Almacen, FilaConversacion, Mensajero, Salida, Traza } from './tipos.ts';

export interface ContactoMem { id: string; nombre: string; celular?: string | null; correo?: string | null; usuario?: string | null }
export interface ViajeMem { id: string; codigo: string; contactoId: string; nombre: string; destino: string | null; abierto: boolean; datos: Record<string, unknown> }

export class Reloj {
  constructor(public ms = Date.parse('2026-10-06T18:45:00Z')) {}
  ahora = () => this.ms;
  avanzar(ms: number) { this.ms += ms; }
}

let secuencia = 0;
export const nuevoId = () => `00000000-0000-4000-8000-${String(++secuencia).padStart(12, '0')}`;

export class AlmacenMemoria implements Almacen {
  filas: FilaConversacion[] = [];
  candados = new Map<string, number>();
  constructor(public reloj: Reloj) {}

  entrante(p: { workspaceId: string; phone: string; clase: FilaConversacion['clase']; texto: string | null; toqueId?: string; wamid?: string }): FilaConversacion {
    const f: FilaConversacion = {
      id: nuevoId(), workspace_id: p.workspaceId, phone: p.phone, direccion: 'entrante', clase: p.clase, texto: p.texto,
      toque_id: p.toqueId ?? null, wa_message_id: p.wamid ?? `wamid.in.${secuencia}`, turno_id: null, traza: null,
      created_at: new Date(this.reloj.ahora()).toISOString(),
    };
    this.filas.push(f);
    return f;
  }

  /** La regla de `wa_conversacion_registrar_saliente`: solo con un entrante en las últimas 24 h. */
  saliente(phone: string, wamid: string, s: Salida): void {
    const desde = this.reloj.ahora() - 24 * 3600 * 1000;
    const ent = [...this.filas].reverse().find((f) => f.phone === phone && f.direccion === 'entrante' && Date.parse(f.created_at) > desde);
    if (!ent) return;
    this.filas.push({
      id: nuevoId(), workspace_id: ent.workspace_id, phone, direccion: 'saliente', clase: 'bot',
      formato: s.tipo, texto: s.texto, opciones: 'opciones' in s ? s.opciones : null, wa_message_id: wamid, turno_id: null, traza: null,
      created_at: new Date(this.reloj.ahora()).toISOString(),
    });
  }

  async leer(workspaceId: string, phone: string, desdeIso: string): Promise<FilaConversacion[]> {
    return structuredClone(this.filas.filter((f) => f.workspace_id === workspaceId && f.phone === phone && f.created_at >= desdeIso));
  }

  async cerrarTurno(p: { turnoId: string; filas: string[]; filaTraza: string; traza: Traza; salientes: string[] }): Promise<void> {
    for (const f of this.filas) {
      if (p.filas.includes(f.id) || (f.wa_message_id && p.salientes.includes(f.wa_message_id))) f.turno_id = p.turnoId;
      if (f.id === p.filaTraza) f.traza = structuredClone(p.traza);
    }
  }

  async tomarCandado(clave: string, segundos: number): Promise<boolean> {
    const vence = this.candados.get(clave);
    if (vence !== undefined && vence > this.reloj.ahora()) return false;
    this.candados.set(clave, this.reloj.ahora() + segundos * 1000);
    return true;
  }

  async soltarCandado(clave: string): Promise<void> {
    this.candados.delete(clave);
  }

  trazas(): Traza[] {
    return this.filas.map((f) => f.traza).filter((t): t is Traza => !!t);
  }
}

export class MensajeroMemoria implements Mensajero {
  enviados: Array<{ phone: string; salida: Salida; intent: string; wamid: string; at: number }> = [];
  escribiendos: string[] = [];
  /** Reemplazable: simula un rechazo de Meta. */
  rechazar = false;
  constructor(public almacen: AlmacenMemoria) {}
  async escribiendo(waMessageId: string): Promise<void> { this.escribiendos.push(waMessageId); }
  async enviar(phone: string, salida: Salida, ctx: { workspaceId: string; intent: string }): Promise<string | null> {
    if (this.rechazar) return null;
    const wamid = `wamid.out.${this.enviados.length + 1}`;
    this.enviados.push({ phone, salida, intent: ctx.intent, wamid, at: performance.now() });
    this.almacen.saliente(phone, wamid, salida);
    return wamid;
  }
}

function normal(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9@. ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** El directorio, los viajes y lo escrito. La extracción es determinista (sin modelo): guarda los textos tal cual. */
export class PuertoMemoria implements PuertoBandeja {
  contactos: ContactoMem[] = [];
  viajes: ViajeMem[] = [];
  /** Lo que se escribió, en orden: la verdad del arnés. */
  escrituras: Array<Record<string, unknown>> = [];
  fallarBusqueda = false;
  private consecutivo = new Map<string, number>();
  constructor(p: { contactos?: ContactoMem[]; viajes?: ViajeMem[] } = {}) {
    this.contactos = structuredClone(p.contactos ?? []);
    this.viajes = structuredClone(p.viajes ?? []);
  }

  async linea() { return 'Viaje a medida'; }

  private ficha(c: ContactoMem): FichaCliente {
    const ns = this.viajes.filter((v) => v.contactoId === c.id);
    const cerrado = ns.filter((v) => !v.abierto).at(-1);
    return {
      id: c.id, nombre: c.nombre.toUpperCase(), cel4: c.celular ? c.celular.replace(/\D/g, '').slice(-4) : null, correo: !!c.correo, usuario: !!c.usuario,
      abiertos: ns.filter((v) => v.abierto).map((v) => ({ codigo: v.codigo, nombre: v.nombre })),
      cerrado: cerrado ? { codigo: cerrado.codigo, nombre: cerrado.nombre } : null,
    };
  }

  async porNombre(texto: string): Promise<FichaCliente[] | null> {
    if (this.fallarBusqueda) return null;
    const ws = normal(texto).split(' ').filter((w) => w.length >= 2 && !['de', 'la', 'el', 'cliente', 'para', 'un', 'una', 'viaje', 'nuevo'].includes(w));
    if (!ws.length) return [];
    return this.contactos.filter((c) => { const n = normal(c.nombre).split(' '); return ws.every((w) => n.some((x) => x.startsWith(w.slice(0, Math.max(3, w.length - 1))))); }).map((c) => this.ficha(c));
  }

  async porLlave(l: Llave): Promise<FichaCliente[] | null> {
    if (this.fallarBusqueda) return null;
    return this.contactos.filter((c) =>
      (l.celular && c.celular && c.celular.replace(/\D/g, '').slice(-10) === l.celular.slice(-10))
      || (l.correo && c.correo && c.correo.toLowerCase() === l.correo)
      || (l.usuario && c.usuario && c.usuario.toLowerCase() === l.usuario)).map((c) => this.ficha(c));
  }

  private faltas(v: ViajeMem) {
    const cotizar = ['fecha de salida', 'fecha de regreso', 'adultos', 'niños'].filter((k) => !(k in v.datos));
    if (!v.destino) cotizar.unshift('destino');
    return { cotizar, completo: [...cotizar, 'presupuesto', 'categoría de hotel', 'plan de alimentación'].filter((k) => !(k in v.datos)) };
  }

  async viaje(codigo: string): Promise<ViajeAgente | null | 'error'> {
    if (this.fallarBusqueda) return 'error';
    const v = this.viajes.find((x) => x.codigo === codigo);
    if (!v) return null;
    const c = this.contactos.find((x) => x.id === v.contactoId);
    const f = this.faltas(v);
    return { id: v.id, codigo: v.codigo, nombre: v.nombre, cliente: c?.nombre ?? null, destino: v.destino, abierto: v.abierto, faltaCotizar: f.cotizar, faltaCompleto: f.completo };
  }

  async crearViaje(p: { contactoId: string; destino: string | null }) {
    const c = this.contactos.find((x) => x.id === p.contactoId);
    if (!c) throw new Error('contacto inexistente');
    const letra = normal(c.nombre)[0].toUpperCase();
    const prefijo = this.viajes.find((v) => v.contactoId === c.id)?.codigo.split(' ')[0] ?? `${letra}${[...new Set(this.contactos.filter((x) => normal(x.nombre)[0] === normal(c.nombre)[0]).map((x) => x.id))].indexOf(c.id) + 1}`;
    const n = (this.consecutivo.get(prefijo) ?? this.viajes.filter((v) => v.codigo.startsWith(`${prefijo} 26 `)).length) + 1;
    this.consecutivo.set(prefijo, n);
    const v: ViajeMem = { id: nuevoId(), codigo: `${prefijo} 26 ${n}`, contactoId: c.id, nombre: p.destino ? p.destino.toUpperCase() : `Viaje de ${c.nombre}`, destino: p.destino, abierto: true, datos: {} };
    this.viajes.push(v);
    this.escrituras.push({ tipo: 'viaje', codigo: v.codigo, contactoId: c.id, destino: p.destino });
    return { id: v.id, codigo: v.codigo, nombre: v.nombre };
  }

  async prepararCarga(viajeId: string, textos: string[]) {
    const v = this.viajes.find((x) => x.id === viajeId)!;
    return { entendido: textos.map((t) => t.slice(0, 70)), falta: this.faltas(v).cotizar, plan: { textos } };
  }

  async cargar(viajeId: string, plan: unknown) {
    const v = this.viajes.find((x) => x.id === viajeId)!;
    const textos = (plan as { textos: string[] }).textos;
    v.datos.textos = [...((v.datos.textos as string[] | undefined) ?? []), ...textos];
    this.escrituras.push({ tipo: 'carga', codigo: v.codigo, textos });
    return { lineas: [`Cargué en ${v.codigo} ${textos.length === 1 ? 'el mensaje' : `los ${textos.length} mensajes`}.`] };
  }

  async crearCliente(nombre: string, llave: Llave) {
    if ((await this.porLlave(llave))?.length) return { ok: false as const, motivo: 'la llave ya es de alguien' };
    const c: ContactoMem = { id: nuevoId(), nombre: nombre.toUpperCase(), celular: llave.celular ?? null, correo: llave.correo ?? null, usuario: llave.usuario ?? null };
    this.contactos.push(c);
    this.escrituras.push({ tipo: 'cliente', id: c.id, nombre: c.nombre, llave });
    return { ok: true as const, id: c.id, nombre: c.nombre };
  }
}
