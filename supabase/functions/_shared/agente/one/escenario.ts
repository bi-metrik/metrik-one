// ============================================================
// Dominio ONE — una conversación en memoria (pruebas y arnés)
// ------------------------------------------------------------
// Como `../escenario.ts`, pero con el dominio ONE y su puerto en memoria. `escribe`, `foto`, `dicta`, `toca` y `elige`
// hacen lo que hace el webhook: guardan la fila y atienden lo pendiente con la cola.
// ============================================================

import { CONFIG_POR_DEFECTO } from '../config.ts';
import type { ConfigAgente } from '../config.ts';
import { atenderPendientes } from '../cola.ts';
import type { DepsCola } from '../cola.ts';
import { AlmacenMemoria, MensajeroMemoria, Reloj, nuevoId } from '../memoria.ts';
import type { FilaConversacion, Modelo, Reglamento, Salida, Traza } from '../tipos.ts';
import { dominioOne } from './dominio.ts';
import { PuertoOneMemoria } from './puerto-memoria.ts';
import type { GastoMem, NegocioMem } from './puerto-memoria.ts';
import { reglamentoOne } from './reglamento.ts';

export const WS_ONE_PRUEBA = '00000000-0000-4000-8000-0000000000e1';
export const TEL_ONE_PRUEBA = '573000001234';

export interface PasoOne {
  clase: 'escrito' | 'imagen' | 'toque' | 'audio';
  texto: string;
  salidas: Salida[];
  ms: number | null;
  trazas: Traza[];
}

export interface EscenarioOne {
  pasos: PasoOne[];
  reloj: Reloj;
  almacen: AlmacenMemoria;
  mensajero: MensajeroMemoria;
  puerto: PuertoOneMemoria;
  deps: DepsCola;
  semilla(filas: Array<Partial<FilaConversacion> & Pick<FilaConversacion, 'direccion' | 'clase'>>): void;
  escribe(texto: string, o?: { despuesMs?: number }): Promise<Salida[]>;
  /** Una foto (el recibo), con o sin pie de foto. */
  foto(pie?: string, o?: { despuesMs?: number; mediaId?: string }): Promise<Salida[]>;
  dicta(texto: string, o?: { despuesMs?: number }): Promise<Salida[]>;
  /** Toca la opción con ese título (exacto, luego prefijo, luego contiene) en el mensaje más reciente del bot que la tenga. */
  toca(titulo: string, o?: { despuesMs?: number }): Promise<Salida[]>;
  /** La opción n (1 = la primera) del último mensaje del bot con opciones de conversación; si no hay, escribe «n». */
  elige(n: number, o?: { despuesMs?: number }): Promise<{ salidas: Salida[]; como: string }>;
  trazas(): Traza[];
}

export async function escenarioOne(p: {
  modelo: Modelo;
  negocios?: NegocioMem[];
  gastos?: GastoMem[];
  contactos?: Array<{ id: string; nombre: string; telefono: string | null }>;
  rol?: string;
  remitente?: { nombre: string; rol: string };
  config?: Partial<ConfigAgente>;
  reglamento?: Reglamento;
  reloj?: () => number;
}): Promise<EscenarioOne> {
  const reloj = new Reloj(Date.parse('2026-10-21T15:00:00Z'));
  const almacen = new AlmacenMemoria(reloj);
  const mensajero = new MensajeroMemoria(almacen);
  const puerto = new PuertoOneMemoria({ negocios: p.negocios, gastos: p.gastos, contactos: p.contactos });
  const rol = p.rol ?? 'owner';
  const deps: DepsCola = {
    modelo: p.modelo,
    dominio: dominioOne(puerto, { rol, ahora: reloj.ahora }),
    reglamento: p.reglamento ?? await reglamentoOne('Empresa de Prueba'),
    config: { ...CONFIG_POR_DEFECTO, activo: true, ...p.config },
    ahoraMs: reloj.ahora,
    reloj: p.reloj ?? (() => reloj.ahora()),
    almacen, mensajero,
    workspaceId: WS_ONE_PRUEBA, phone: TEL_ONE_PRUEBA,
    remitente: p.remitente ?? { nombre: 'Ana Dueña', rol },
    nuevoId,
    // La ventana de los adjuntos espera en el reloj de la prueba, no en el de verdad.
    dormir: async (ms: number) => { reloj.avanzar(ms); },
  };
  const pasos: PasoOne[] = [];
  let fotos = 0;
  const correr = async (clase: PasoOne['clase'], texto: string, extra: { toqueId?: string; media?: FilaConversacion['media'] } = {}, despuesMs = 20_000) => {
    reloj.avanzar(despuesMs);
    const antes = mensajero.enviados.length;
    const trazasAntes = almacen.trazas().length;
    const t0 = performance.now();
    almacen.entrante({ workspaceId: WS_ONE_PRUEBA, phone: TEL_ONE_PRUEBA, clase, texto: texto || null, toqueId: extra.toqueId, media: extra.media });
    await atenderPendientes(deps);
    const nuevos = mensajero.enviados.slice(antes);
    pasos.push({ clase, texto, salidas: nuevos.map((e) => e.salida), ms: nuevos.length ? Math.round(nuevos[0].at - t0) : null, trazas: almacen.trazas().slice(trazasAntes) });
    return nuevos.map((e) => e.salida);
  };
  const buscar = (ops: Array<{ id: string; titulo: string }>, titulo: string) => {
    const t = titulo.toLowerCase().trim();
    return ops.find((x) => x.titulo.toLowerCase() === t) ?? ops.find((x) => x.titulo.toLowerCase().startsWith(t)) ?? ops.find((x) => x.titulo.toLowerCase().includes(t));
  };
  return {
    pasos, reloj, almacen, mensajero, puerto, deps,
    semilla(filas) {
      for (const f of filas) {
        reloj.avanzar(10_000);
        almacen.filas.push({ id: nuevoId(), workspace_id: WS_ONE_PRUEBA, phone: TEL_ONE_PRUEBA, texto: null, turno_id: 'semilla', traza: null, created_at: new Date(reloj.ahora()).toISOString(), ...f } as FilaConversacion);
      }
    },
    escribe: (t, o) => correr('escrito', t, {}, o?.despuesMs),
    foto: (pie = '', o) => correr('imagen', pie, { media: { tipo: 'imagen', id: o?.mediaId ?? `media-${++fotos}` } }, o?.despuesMs ?? 10_000),
    dicta: (t, o) => correr('audio', t, {}, o?.despuesMs),
    toca: (titulo, o) => {
      const con = [...mensajero.enviados].reverse().map((e) => ('opciones' in e.salida ? buscar(e.salida.opciones, titulo) : undefined)).filter((x): x is { id: string; titulo: string } => !!x);
      if (!con[0]) throw new Error(`no hay una opción «${titulo}» en los mensajes del bot`);
      return correr('toque', con[0].titulo, { toqueId: con[0].id }, o?.despuesMs ?? 5_000);
    },
    async elige(n, o) {
      const ultimo = mensajero.enviados.at(-1)?.salida;
      const op = ultimo && 'opciones' in ultimo && ultimo.opciones[n - 1] && !ultimo.opciones[n - 1].id.startsWith('ag|p|') ? ultimo.opciones[n - 1] : null;
      if (op) return { salidas: await correr('toque', op.titulo, { toqueId: op.id }, o?.despuesMs ?? 5_000), como: `[toque: ${op.titulo}]` };
      return { salidas: await correr('escrito', String(n), {}, o?.despuesMs ?? 5_000), como: `«${n}»` };
    },
    trazas: () => almacen.trazas(),
  };
}
