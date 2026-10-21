// ============================================================
// Asistente público — armar una conversación de Chatwoot en memoria (pruebas y arnés)
// ------------------------------------------------------------
// El reglamento semilla de Sabor (con su catálogo [EJEMPLO]), los puertos en memoria y la cola de verdad. `escribe`,
// `toca` y `audio` hacen lo que hace el webhook: guardan la fila (como `recibir`) y atienden lo pendiente con la cola.
// Sin datos reales.
// ============================================================

import { huellaDe } from '../reglamento.ts';
import type { Ficha, Modelo, Reglamento, Salida } from '../tipos.ts';
import { atenderConversacion } from './cola.ts';
import type { DepsPublico } from './cola.ts';
import { CONFIG_PUBLICO_POR_DEFECTO } from './config.ts';
import type { ConfigPublico } from './config.ts';
import { AlmacenPublicoMemoria, ChatwootMemoria, RelojPublico, TranscriptorMemoria, nuevoIdPublico } from './memoria.ts';
import { REGLAMENTO_SABOR } from './reglamento-sabor.ts';
import type { Canal, FilaPublica, LlaveConversacion, TrazaPublica } from './tipos.ts';

export const WS_PUBLICO = '00000000-0000-4000-9000-00000000a5a5';

export async function reglamentoSabor(fichas: Ficha[] = REGLAMENTO_SABOR): Promise<Reglamento> {
  return { id: 'reglamento-sabor-prueba', version: 1, huella: await huellaDe(fichas), fichas };
}

export interface PasoPublico {
  clase: FilaPublica['clase'];
  texto: string;
  /** Lo publicado en Chatwoot por este paso (sin notas). */
  salidas: Salida[];
  trazas: TrazaPublica[];
}

export interface EscenarioPublico {
  llave: LlaveConversacion;
  canal: Canal;
  reloj: RelojPublico;
  almacen: AlmacenPublicoMemoria;
  chatwoot: ChatwootMemoria;
  transcriptor: TranscriptorMemoria;
  deps: DepsPublico;
  pasos: PasoPublico[];
  /** Escribe un mensaje (o varios seguidos, que llegan como ráfaga) y lo atiende. */
  escribe(texto: string | string[], o?: { despuesMs?: number }): Promise<Salida[]>;
  /** Toca la opción del último mensaje del bot que la tenga (por título exacto, o que empiece así). */
  toca(titulo: string, o?: { despuesMs?: number }): Promise<Salida[]>;
  /** Una nota de voz: `transcripcion` es lo que devolverá el transcriptor (null = falla). */
  audio(transcripcion: string | null, o?: { despuesMs?: number; noSoportado?: boolean }): Promise<Salida[]>;
  /** Solo guarda un mensaje (sin atender). */
  guardar(texto: string): FilaPublica;
  atender(): Promise<Salida[]>;
  trazas(): TrazaPublica[];
}

export async function escenarioPublico(p: {
  modelo: Modelo;
  canal?: Canal;
  config?: Partial<ConfigPublico>;
  reglamento?: Reglamento;
  /** Reloj real además del falso (el arnés mide la latencia). */
  vivo?: boolean;
  fallarHerramienta?: () => boolean;
  precios?: DepsPublico['precios'];
  conversacionId?: number;
}): Promise<EscenarioPublico> {
  const reloj = new RelojPublico(undefined, p.vivo ?? false);
  const almacen = new AlmacenPublicoMemoria(reloj, WS_PUBLICO);
  const chatwoot = new ChatwootMemoria();
  const transcriptor = new TranscriptorMemoria();
  const canal = p.canal ?? 'instagram';
  const llave: LlaveConversacion = { workspaceId: WS_PUBLICO, cuentaId: 77, conversacionId: p.conversacionId ?? 9001 };
  const avisos: string[] = [];
  const config: ConfigPublico = {
    ...CONFIG_PUBLICO_POR_DEFECTO, activo: true, cuentaId: 77, inboxes: [{ id: 5, canal, anuncio7Dias: false }],
    corte1Ms: 400, corteTotalMs: 2000, rafagaMs: 2500, ...p.config,
  };
  const deps: DepsPublico & { avisosEnviados: string[] } = {
    modelo: p.modelo,
    reglamento: p.reglamento ?? await reglamentoSabor(),
    config,
    almacen, mensajero: chatwoot, transcriptor,
    avisos: { avisar: async (t) => { avisos.push(t); } },
    avisosEnviados: avisos,
    llave, canal, anuncio7Dias: false, workspaceNombre: 'sabor-prueba',
    precios: p.precios ?? [],
    ahoraMs: reloj.ahora,
    reloj: () => performance.now(),
    nuevoId: nuevoIdPublico,
    dormir: async (ms) => { reloj.avanzar(ms); },
    fallarHerramienta: p.fallarHerramienta,
  };
  const pasos: PasoPublico[] = [];
  let mensajeId = 100;
  const atender = async (clase: FilaPublica['clase'], texto: string): Promise<Salida[]> => {
    const antes = chatwoot.publicados.length;
    const trazasAntes = new Set(almacen.trazas());
    await atenderConversacion(deps);
    const salidas = chatwoot.publicados.slice(antes).map((x) => x.salida);
    pasos.push({ clase, texto, salidas, trazas: almacen.trazas().filter((t) => !trazasAntes.has(t)) });
    return salidas;
  };
  const entrante = (clase: FilaPublica['clase'], texto: string | null, extra: { toqueId?: string; adjunto?: FilaPublica['adjunto'] } = {}) =>
    almacen.entrante({ llave, canal, clase, texto, mensajeId: ++mensajeId, ...extra });
  return {
    llave, canal, reloj, almacen, chatwoot, transcriptor, deps, pasos,
    async escribe(texto, o) {
      const textos = Array.isArray(texto) ? texto : [texto];
      reloj.avanzar(o?.despuesMs ?? 20_000);
      for (const [i, t] of textos.entries()) {
        if (i) reloj.avanzar(700);
        entrante('escrito', t);
      }
      return await atender('escrito', textos.join(' | '));
    },
    async toca(titulo, o) {
      const t = titulo.toLowerCase();
      const op = [...chatwoot.publicados].reverse().map((x) => ('opciones' in x.salida ? x.salida.opciones : []))
        .map((ops) => ops.find((y) => y.titulo.toLowerCase() === t) ?? ops.find((y) => y.titulo.toLowerCase().startsWith(t)))
        .find((x) => !!x);
      if (!op) throw new Error(`no hay una opción «${titulo}» en los mensajes del bot`);
      reloj.avanzar(o?.despuesMs ?? 5_000);
      entrante('toque', op.titulo, { toqueId: op.id });
      return await atender('toque', op.titulo);
    },
    async audio(transcripcion, o) {
      reloj.avanzar(o?.despuesMs ?? 20_000);
      const url = `https://chatwoot.invalid/audio/${++mensajeId}.ogg`;
      if (transcripcion) transcriptor.textos.set(url, transcripcion);
      entrante('audio', null, { adjunto: o?.noSoportado ? { tipo: 'no_soportado', url: null, no_soportado: true } : { tipo: 'audio', url, extension: 'ogg' } });
      return await atender('audio', transcripcion ?? '(audio)');
    },
    guardar: (texto) => entrante('escrito', texto),
    atender: () => atender('escrito', '(atender)'),
    trazas: () => almacen.trazas(),
  };
}
