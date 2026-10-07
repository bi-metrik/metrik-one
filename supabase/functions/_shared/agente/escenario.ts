// ============================================================
// Núcleo conversacional — armar una conversación en memoria (pruebas y arnés)
// ------------------------------------------------------------
// Un mundo (directorio y viajes inventados), el reglamento de prueba publicado y los puertos en memoria. `escribe`,
// `reenvia` y `toca` hacen lo que hace el webhook: guardan la fila y atienden lo pendiente con la cola.
// ============================================================

import { CONFIG_POR_DEFECTO } from './config.ts';
import type { ConfigAgente } from './config.ts';
import { atenderPendientes } from './cola.ts';
import type { DepsCola } from './cola.ts';
import { dominioBandeja } from './bandeja/dominio.ts';
import { REGLAMENTO_ANEXO_A } from './bandeja/reglamento-anexo-a.ts';
import { AlmacenMemoria, MensajeroMemoria, PuertoMemoria, Reloj, nuevoId } from './memoria.ts';
import type { ContactoMem, ExtractorMemoria, ViajeMem } from './memoria.ts';
import type { CampoEntendible } from '../wa-entendimiento-reglas.ts';
import { huellaDe } from './reglamento.ts';
import type { Ficha, FilaConversacion, Modelo, Reglamento, Salida, Traza } from './tipos.ts';

export const WS_PRUEBA = '00000000-0000-4000-8000-00000000a0a0';
export const TEL_PRUEBA = '573000009444';

export async function reglamentoDePrueba(fichas: Ficha[] = REGLAMENTO_ANEXO_A): Promise<Reglamento> {
  return { id: 'reglamento-prueba', version: 1, huella: await huellaDe(fichas), fichas };
}

export interface PasoRegistrado {
  clase: 'escrito' | 'reenvio' | 'toque';
  texto: string;
  salidas: Salida[];
  /** Desde que la fila entró (el webhook) hasta el primer envío. Nulo si no salió nada. */
  ms: number | null;
  /** Las trazas que dejó este paso. */
  trazas: Traza[];
}

export interface Escenario {
  pasos: PasoRegistrado[];
  /** Filas que ya estaban en la conversación (de un turno anterior al caso). */
  semilla(filas: Array<Partial<FilaConversacion> & Pick<FilaConversacion, 'direccion' | 'clase'>>): void;
  reloj: Reloj;
  almacen: AlmacenMemoria;
  mensajero: MensajeroMemoria;
  puerto: PuertoMemoria;
  deps: DepsCola;
  escribe(texto: string, o?: { despuesMs?: number }): Promise<Salida[]>;
  reenvia(texto: string, o?: { despuesMs?: number }): Promise<Salida[]>;
  /** Toca la opción cuyo título es (o contiene) `titulo` en el mensaje más reciente del bot que la tenga. */
  toca(titulo: string, o?: { despuesMs?: number; atras?: number }): Promise<Salida[]>;
  trazas(): Traza[];
}

export async function escenario(p: {
  modelo: Modelo;
  contactos?: ContactoMem[];
  viajes?: ViajeMem[];
  /** La config de los campos del viaje y la extracción guionada (ver `PuertoMemoria`). */
  campos?: CampoEntendible[];
  extraer?: ExtractorMemoria;
  config?: Partial<ConfigAgente>;
  reglamento?: Reglamento;
  /** Reloj monotónico real (arnés) o falso (pruebas). */
  reloj?: () => number;
}): Promise<Escenario> {
  const reloj = new Reloj();
  const almacen = new AlmacenMemoria(reloj);
  const mensajero = new MensajeroMemoria(almacen);
  const puerto = new PuertoMemoria({ contactos: p.contactos, viajes: p.viajes, campos: p.campos, extraer: p.extraer, ahora: reloj.ahora });
  const deps: DepsCola = {
    modelo: p.modelo,
    dominio: dominioBandeja(puerto),
    reglamento: p.reglamento ?? await reglamentoDePrueba(),
    config: { ...CONFIG_POR_DEFECTO, activo: true, ...p.config },
    ahoraMs: reloj.ahora,
    reloj: p.reloj ?? (() => reloj.ahora()),
    almacen, mensajero,
    workspaceId: WS_PRUEBA, phone: TEL_PRUEBA,
    remitente: { nombre: 'el comercial', rol: 'colaborador' },
    nuevoId,
  };
  const pasos: PasoRegistrado[] = [];
  const correr = async (clase: 'escrito' | 'reenvio' | 'toque', texto: string, toqueId?: string, despuesMs = 20_000) => {
    reloj.avanzar(despuesMs);
    const antes = mensajero.enviados.length;
    const trazasAntes = almacen.trazas().length;
    const t0 = performance.now();
    almacen.entrante({ workspaceId: WS_PRUEBA, phone: TEL_PRUEBA, clase, texto, toqueId });
    await atenderPendientes(deps);
    const nuevos = mensajero.enviados.slice(antes);
    pasos.push({ clase, texto, salidas: nuevos.map((e) => e.salida), ms: nuevos.length ? Math.round(nuevos[0].at - t0) : null, trazas: almacen.trazas().slice(trazasAntes) });
    return nuevos.map((e) => e.salida);
  };
  return {
    pasos,
    semilla(filas) {
      for (const f of filas) {
        reloj.avanzar(10_000);
        almacen.filas.push({
          id: nuevoId(), workspace_id: WS_PRUEBA, phone: TEL_PRUEBA, texto: null, turno_id: 'semilla', traza: null,
          created_at: new Date(reloj.ahora()).toISOString(), ...f,
        } as FilaConversacion);
      }
    },
    reloj, almacen, mensajero, puerto, deps,
    escribe: (t, o) => correr('escrito', t, undefined, o?.despuesMs),
    reenvia: (t, o) => correr('reenvio', t, undefined, o?.despuesMs ?? 3_000),
    toca: (titulo, o) => {
      // El mensaje más reciente que tenga esa opción (`atras`: saltarse los N más recientes que la tienen, para tocar un
      // botón viejo). Exacto primero: «No» no puede tocar «Anotar» porque «anotar» contiene «no» (arnés, 2026-10-06).
      const t = titulo.toLowerCase().trim();
      const buscar = (ops: Array<{ id: string; titulo: string }>) => ops.find((x) => x.titulo.toLowerCase() === t)
        ?? ops.find((x) => x.titulo.toLowerCase().startsWith(t))
        ?? ops.find((x) => x.titulo.toLowerCase().includes(t));
      const con = [...mensajero.enviados].reverse()
        .map((e) => ('opciones' in e.salida ? buscar(e.salida.opciones) : undefined))
        .filter((x): x is { id: string; titulo: string } => !!x);
      const op = con[o?.atras ?? 0];
      if (!op) throw new Error(`no hay una opción «${titulo}» en los mensajes del bot`);
      return correr('toque', op.titulo, op.id, o?.despuesMs ?? 5_000);
    },
    trazas: () => almacen.trazas(),
  };
}
