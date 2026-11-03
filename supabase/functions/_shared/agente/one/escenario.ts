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
import type { FilaConversacion, Modelo, Reglamento, RolTraza, Salida, Traza } from '../tipos.ts';
import { dominioOne } from './dominio.ts';
import { componerOne, funcionesDelCargo, reglamentoOneDelTurno } from './cargos.ts';
import type { Composicion } from '../componer.ts';
import type { FuncionPrendida } from '../funciones/tipos.ts';
import { rolDeCargo } from '../roles.ts';
import { PuertoOneMemoria } from './puerto-memoria.ts';
import type { GastoMem, NegocioMem } from './puerto-memoria.ts';
import { reglamentoOne } from './reglamento.ts';
import { ESCALAMIENTO_METRIK, dominioPersona, escalamientoDe } from '../persona.ts';
import type { FilaEscalamiento, PuertoEscalamientos } from '../persona.ts';
import type { ArchivoAdjunto, Lector } from './lectura-adjunto.ts';

export const WS_ONE_PRUEBA = '00000000-0000-4000-8000-0000000000e1';
export const TEL_ONE_PRUEBA = '573000001234';

export interface PasoOne {
  clase: 'escrito' | 'imagen' | 'toque' | 'audio' | 'documento';
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
  /** Lo que armó el componedor (las herramientas del cargo o del rol). Sin componer, null. */
  composicion: Composicion | null;
  /** Las filas de `asistente_escalamientos` que dejó la conversación (§4.2). */
  escalamientos: FilaEscalamiento[];
  semilla(filas: Array<Partial<FilaConversacion> & Pick<FilaConversacion, 'direccion' | 'clase'>>): void;
  escribe(texto: string, o?: { despuesMs?: number }): Promise<Salida[]>;
  /** Una foto (el recibo), con o sin pie de foto. `archivo`: los bytes que «están en Meta» (para el lector). */
  foto(pie?: string, o?: { despuesMs?: number; mediaId?: string; archivo?: ArchivoAdjunto }): Promise<Salida[]>;
  /** Un documento (el PDF del recibo), con su nombre y, si lo trae, su pie. */
  documento(nombre: string, pie?: string, o?: { despuesMs?: number; mediaId?: string; archivo?: ArchivoAdjunto }): Promise<Salida[]>;
  /**
   * Varios mensajes que llegan casi juntos (la ventana de los adjuntos): todos quedan guardados y se atiende una vez.
   * `despuesMs` de cada uno es lo que pasa antes de que llegue.
   */
  juntos(mensajes: Array<{ escribe?: string; foto?: string; documento?: string; pie?: string; archivo?: ArchivoAdjunto; despuesMs?: number }>): Promise<Salida[]>;
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
  /** El lector de soportes (en pruebas, uno guionado; en el arnés, el real). Sin él, los soportes no se leen. */
  lector?: Lector | null;
  /**
   * Las funciones del turno (un rol de la base, ya intersecadas con las prendidas). Sin ellas, las del cargo (`rol`,
   * `cargos.ts`), como en producción sin roles.
   */
  funciones?: Array<string | FuncionPrendida>;
  /** El rol para la traza (con `funciones`). */
  rolTraza?: RolTraza;
  /** El dominio ONE entero, sin componer (para probar el motor y sus candados de permiso). */
  sinComponer?: boolean;
  /** Sin el paso a una persona (`comun.persona`), como antes de §4.2. Por defecto va, como en producción. */
  sinPersona?: boolean;
  /** Dónde se escriben las filas de `asistente_escalamientos` (en pruebas, uno que falla). Por defecto, en memoria. */
  escalamientos?: PuertoEscalamientos;
}): Promise<EscenarioOne> {
  const reloj = new Reloj(Date.parse('2026-10-21T15:00:00Z'));
  const almacen = new AlmacenMemoria(reloj);
  const mensajero = new MensajeroMemoria(almacen);
  const puerto = new PuertoOneMemoria({ negocios: p.negocios, gastos: p.gastos, contactos: p.contactos });
  // Lo que el dominio anota de un soporte (referencia, lectura) queda en la fila, como en `wa_conversacion`.
  puerto.alAnotar = (filaId, media) => {
    const f = almacen.filas.find((x) => x.id === filaId);
    if (f) f.media = structuredClone(media);
  };
  const rol = p.rol ?? 'owner';
  const funciones = p.funciones ?? funcionesDelCargo(rol);
  const claves = funciones.map((f) => (typeof f === 'string' ? f : f.funcion));
  const base = p.reglamento ?? await reglamentoOne('Empresa de Prueba');
  // Como en producción (`wa-agente.ts`): el motor ONE con los permisos de las funciones, recortado por el componedor.
  const motor = dominioOne(puerto, { rol, ahora: reloj.ahora, lector: p.lector ?? null, empresa: 'Empresa de Prueba', ...(p.sinComponer ? {} : { funciones: claves }) });
  // El paso a una persona (§4.2): la ficha `rol.escalamiento` del reglamento, o el WhatsApp de MeTRIK.
  const escalamiento = escalamientoDe(base, ESCALAMIENTO_METRIK, () => {});
  const persona = p.sinComponer || p.sinPersona ? null : dominioPersona({ config: escalamiento, empresa: 'Empresa de Prueba', base: motor });
  const composicion = p.sinComponer ? null : componerOne(motor, funciones, () => {}, persona);
  const escalamientos: FilaEscalamiento[] = [];
  const puertoEsc: PuertoEscalamientos = p.escalamientos ?? { registrar: async (f) => { escalamientos.push(f); } };
  const deps: DepsCola = {
    modelo: p.modelo,
    dominio: composicion ? composicion.dominio : motor,
    reglamento: composicion ? await reglamentoOneDelTurno(base, composicion) : base,
    ...(composicion ? { rol: p.rolTraza ?? rolDeCargo(rol, claves) } : {}),
    config: { ...CONFIG_POR_DEFECTO, activo: true, ...p.config },
    ahoraMs: reloj.ahora,
    reloj: p.reloj ?? (() => reloj.ahora()),
    almacen, mensajero,
    workspaceId: WS_ONE_PRUEBA, phone: TEL_ONE_PRUEBA,
    remitente: p.remitente ?? { nombre: 'Ana Dueña', rol },
    nuevoId,
    // La ventana de los adjuntos espera en el reloj de la prueba, no en el de verdad.
    dormir: async (ms: number) => { reloj.avanzar(ms); },
    ...(persona ? {
      persona: { config: escalamiento, empresa: 'Empresa de Prueba', rolClave: (p.rolTraza ?? rolDeCargo(rol, claves)).clave, canal: 'wa_one' as const, escalamientos: puertoEsc },
    } : {}),
  };
  const pasos: PasoOne[] = [];
  let fotos = 0;
  const correr = async (clase: PasoOne['clase'], texto: string, extra: { toqueId?: string; media?: FilaConversacion['media'] } = {}, despuesMs = 20_000) => {
    reloj.avanzar(despuesMs);
    const antes = mensajero.enviados.length;
    const trazasAntes = almacen.trazas().length;
    const t0 = performance.now();
    almacen.entrante({ workspaceId: WS_ONE_PRUEBA, phone: TEL_ONE_PRUEBA, clase: clase === 'documento' ? 'otro' : clase, texto: texto || null, toqueId: extra.toqueId, media: extra.media });
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
    pasos, reloj, almacen, mensajero, puerto, deps, composicion, escalamientos,
    semilla(filas) {
      for (const f of filas) {
        reloj.avanzar(10_000);
        almacen.filas.push({ id: nuevoId(), workspace_id: WS_ONE_PRUEBA, phone: TEL_ONE_PRUEBA, texto: null, turno_id: 'semilla', traza: null, created_at: new Date(reloj.ahora()).toISOString(), ...f } as FilaConversacion);
      }
    },
    escribe: (t, o) => correr('escrito', t, {}, o?.despuesMs),
    foto: (pie = '', o) => {
      const id = o?.mediaId ?? `media-${++fotos}`;
      if (o?.archivo) puerto.archivos.set(id, o.archivo);
      return correr('imagen', pie, { media: { tipo: 'imagen', id } }, o?.despuesMs ?? 10_000);
    },
    documento: (nombre, pie = '', o) => {
      const id = o?.mediaId ?? `media-${++fotos}`;
      if (o?.archivo) puerto.archivos.set(id, o.archivo);
      return correr('documento', pie, { media: { tipo: 'documento', id, mime: o?.archivo?.mime ?? 'application/pdf', nombre } }, o?.despuesMs ?? 10_000);
    },
    async juntos(mensajes) {
      const antes = mensajero.enviados.length;
      const trazasAntes = almacen.trazas().length;
      const t0 = performance.now();
      for (const m of mensajes) {
        reloj.avanzar(m.despuesMs ?? 1_000);
        if (m.escribe !== undefined) {
          almacen.entrante({ workspaceId: WS_ONE_PRUEBA, phone: TEL_ONE_PRUEBA, clase: 'escrito', texto: m.escribe });
          continue;
        }
        const id = `media-${++fotos}`;
        if (m.archivo) puerto.archivos.set(id, m.archivo);
        const media = m.documento !== undefined
          ? { tipo: 'documento', id, mime: m.archivo?.mime ?? 'application/pdf', nombre: m.documento }
          : { tipo: 'imagen', id };
        almacen.entrante({ workspaceId: WS_ONE_PRUEBA, phone: TEL_ONE_PRUEBA, clase: m.documento !== undefined ? 'otro' : 'imagen', texto: (m.pie ?? m.foto ?? '') || null, media });
      }
      await atenderPendientes(deps);
      const nuevos = mensajero.enviados.slice(antes);
      pasos.push({ clase: 'escrito', texto: mensajes.map((m) => m.escribe ?? m.pie ?? m.foto ?? m.documento ?? '').join(' + '), salidas: nuevos.map((e) => e.salida), ms: nuevos.length ? Math.round(nuevos[0].at - t0) : null, trazas: almacen.trazas().slice(trazasAntes) });
      return nuevos.map((e) => e.salida);
    },
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
