// ============================================================
// Asistente público — los puertos en memoria (pruebas y arnés)
// ------------------------------------------------------------
// Una base de juguete con la misma forma que `chatwoot_conversacion` y `chatwoot_consentimientos`, y un Chatwoot de
// juguete que guarda lo publicado, las notas, etiquetas, equipos y el estado. Su estado final es la verdad contra la que
// califica el arnés. Sin datos reales.
// ============================================================

import type { Salida } from '../tipos.ts';
import type { AlmacenPublico, Consentimiento, MensajeroChatwoot, ResultadoPublicar, Transcriptor } from './puertos.ts';
import type { Canal, FilaPublica, LlaveConversacion, TrazaPublica } from './tipos.ts';
import { llaveTexto } from './tipos.ts';

let secuencia = 0;
export const nuevoIdPublico = () => `00000000-0000-4000-9000-${String(++secuencia).padStart(12, '0')}`;

/**
 * La hora de pared de las pruebas. `vivo`: además corre con el tiempo real (el arnés mide la latencia interna con la
 * hora de las filas); `avanzar` salta sin esperar (la ráfaga, los pasos entre mensajes).
 */
export class RelojPublico {
  private t0 = performance.now();
  constructor(public ms = Date.parse('2026-10-23T15:00:00Z'), public vivo = false) {}
  ahora = () => this.ms + (this.vivo ? performance.now() - this.t0 : 0);
  avanzar(ms: number) { this.ms += ms; }
}

export class AlmacenPublicoMemoria implements AlmacenPublico {
  filas: FilaPublica[] = [];
  notas: FilaPublica[] = [];
  consentimientos: Array<Consentimiento & { at: string }> = [];
  candados = new Map<string, number>();
  /** Simula la base caída al leer el gasto. */
  sinUso = false;
  constructor(public reloj: RelojPublico, public workspaceId: string) {}

  private iso() { return new Date(this.reloj.ahora()).toISOString(); }

  entrante(p: { llave: LlaveConversacion; canal: Canal; clase: FilaPublica['clase']; texto: string | null; toqueId?: string | null; mensajeId?: number; adjunto?: FilaPublica['adjunto']; msWebhook?: number }): FilaPublica {
    const f: FilaPublica = {
      id: nuevoIdPublico(), workspace_id: p.llave.workspaceId, phone: llaveTexto(p.llave), direccion: 'entrante', clase: p.clase, texto: p.texto,
      toque_id: p.toqueId ?? null, wa_message_id: String(p.mensajeId ?? 1000 + secuencia), turno_id: null, traza: null, canal: p.canal,
      adjunto: p.adjunto ?? null, ms_webhook: p.msWebhook ?? 40, created_at: this.iso(),
    };
    this.filas.push(f);
    return f;
  }

  async leer(l: LlaveConversacion, desdeIso: string): Promise<FilaPublica[]> {
    return structuredClone(this.filas.filter((f) => f.workspace_id === l.workspaceId && f.phone === llaveTexto(l) && f.created_at >= desdeIso));
  }

  async cerrarTurno(p: { turnoId: string; filas: string[]; filaTraza: string; traza: TrazaPublica }): Promise<void> {
    for (const f of this.filas) {
      if (p.filas.includes(f.id)) f.turno_id = p.turnoId;
      if (f.id === p.filaTraza) f.traza = structuredClone(p.traza);
    }
  }

  async completarTexto(id: string, texto: string): Promise<void> {
    const f = this.filas.find((x) => x.id === id);
    if (f) f.texto = texto;
  }

  async enmascarar(ids: string[]): Promise<void> {
    for (const f of this.filas) if (ids.includes(f.id)) { f.texto = '[mensaje con un dato protegido: enmascarado]'; f.enmascarado = true; }
  }

  async reservarSalida(p: { llave: LlaveConversacion; canal: Canal; turnoId: string; ranura: string; salida: Salida; nota?: boolean }): Promise<string | null> {
    if ([...this.filas, ...this.notas].some((f) => f.direccion === 'saliente' && f.turno_id === p.turnoId && f.ranura === p.ranura)) return null;
    const f: FilaPublica = {
      id: nuevoIdPublico(), workspace_id: p.llave.workspaceId, phone: llaveTexto(p.llave), direccion: 'saliente', clase: 'bot',
      formato: p.salida.tipo, texto: p.salida.texto, opciones: 'opciones' in p.salida ? p.salida.opciones : null, turno_id: p.turnoId, ranura: p.ranura,
      estado: 'generado', traza: null, canal: p.canal, created_at: this.iso(),
    };
    // Las notas privadas no son parte de la conversación que lee el modelo (en la base: `clase = 'nota'`, fuera de `leer`).
    (p.nota ? this.notas : this.filas).push(f);
    return f.id;
  }

  async marcarSalida(id: string, r: { estado: 'publicado' | 'fallido' | 'incierto'; chatwootMessageId?: number | null }): Promise<void> {
    const f = [...this.filas, ...this.notas].find((x) => x.id === id);
    if (f) { f.estado = r.estado; if (r.chatwootMessageId) f.wa_message_id = String(r.chatwootMessageId); }
  }

  async registrarConsentimiento(c: Consentimiento): Promise<void> {
    this.consentimientos.push({ ...structuredClone(c), at: this.iso() });
  }

  async trazasDelModelo(workspaceId: string, desdeIso: string): Promise<TrazaPublica[] | null> {
    if (this.sinUso) return null;
    return this.filas.filter((f) => f.workspace_id === workspaceId && f.created_at >= desdeIso && f.traza?.tipo === 'modelo').map((f) => f.traza as TrazaPublica);
  }

  async tomarCandado(clave: string, segundos: number): Promise<boolean> {
    const vence = this.candados.get(clave);
    if (vence !== undefined && vence > this.reloj.ahora()) return false;
    this.candados.set(clave, this.reloj.ahora() + segundos * 1000);
    return true;
  }

  async soltarCandado(clave: string): Promise<void> { this.candados.delete(clave); }

  trazas(): TrazaPublica[] {
    return this.filas.map((f) => f.traza).filter((t): t is TrazaPublica => !!t);
  }
}

export class ChatwootMemoria implements MensajeroChatwoot {
  publicados: Array<{ conv: string; salida: Salida; id: number; at: number }> = [];
  notas: Array<{ conv: string; texto: string }> = [];
  etiquetas = new Map<string, Set<string>>();
  equipos = new Map<string, number>();
  estados = new Map<string, string>();
  /** Las fotos adjuntas publicadas (dominio de ventas). */
  fotos: Array<{ conv: string; url: string; texto: string; id: number }> = [];
  /** Las URLs cuya foto falla al publicarse (simula la descarga o la subida caídas). */
  fotosQueFallan = new Set<string>();
  /** Simula una caída de Chatwoot al publicar. */
  fallar: 'no' | 'rechazo' | 'incierto' = 'no';
  private n = 5000;

  async estado(l: LlaveConversacion): Promise<string | null> { return this.estados.get(llaveTexto(l)) ?? 'pending'; }

  async publicar(l: LlaveConversacion, s: Salida): Promise<ResultadoPublicar> {
    if (this.fallar === 'rechazo') return { ok: false, incierto: false, motivo: 'http 422' };
    if (this.fallar === 'incierto') return { ok: false, incierto: true, motivo: 'corte' };
    const id = ++this.n;
    this.publicados.push({ conv: llaveTexto(l), salida: structuredClone(s), id, at: performance.now() });
    return { ok: true, id };
  }

  async publicarFoto(l: LlaveConversacion, foto: { url: string; texto: string }): Promise<ResultadoPublicar> {
    if (this.fotosQueFallan.has(foto.url)) return { ok: false, incierto: false, motivo: 'foto: http 404 (simulada)' };
    const id = ++this.n;
    this.fotos.push({ conv: llaveTexto(l), url: foto.url, texto: foto.texto, id });
    return { ok: true, id };
  }

  async nota(l: LlaveConversacion, texto: string): Promise<ResultadoPublicar> {
    this.notas.push({ conv: llaveTexto(l), texto });
    return { ok: true, id: ++this.n };
  }

  async etiquetar(l: LlaveConversacion, etiquetas: string[]): Promise<boolean> {
    const k = llaveTexto(l);
    const s = this.etiquetas.get(k) ?? new Set<string>();
    for (const e of etiquetas) s.add(e);
    this.etiquetas.set(k, s);
    return true;
  }

  async asignarEquipo(l: LlaveConversacion, equipo: number): Promise<boolean> { this.equipos.set(llaveTexto(l), equipo); return true; }

  async abrir(l: LlaveConversacion): Promise<boolean> { this.estados.set(llaveTexto(l), 'open'); return true; }
}

/** Transcripción guionada: devuelve el texto que se le dio para esa URL (o falla). */
export class TranscriptorMemoria implements Transcriptor {
  textos = new Map<string, string | null>();
  llamadas: string[] = [];
  /** Lo que recibió cada llamada (las fuentes de pistas, si llegaron). */
  pedidos: Array<Parameters<Transcriptor['transcribir']>[0]> = [];
  async transcribir(a: Parameters<Transcriptor['transcribir']>[0]): Promise<{ texto: string | null; error?: string }> {
    this.llamadas.push(a.url);
    this.pedidos.push(a);
    const t = this.textos.get(a.url);
    return t ? { texto: t } : { texto: null, error: 'GEMINI_RESULT: (vacío, simulado)' };
  }
}
