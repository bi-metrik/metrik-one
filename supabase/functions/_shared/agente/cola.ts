// ============================================================
// Núcleo conversacional — la cola por remitente y «escribiendo…» (§3.6)
// ------------------------------------------------------------
// Cada mensaje ya quedó en `wa_conversacion` cuando llega aquí (lo escribe el webhook). Un candado por remitente
// (`tomar_candado`) hace que un solo proceso atienda sus mensajes, en orden: el que lo tiene atiende TODO lo pendiente
// (las filas entrantes sin `turno_id`) y, al soltarlo, vuelve a mirar por si llegó algo en el medio. El que no lo
// consigue se va: su mensaje lo atiende el que lo tiene.
//
// Por turno:
//   · reenvíos → entran a la tanda por código, sin modelo ni «escribiendo…»; al primero de una ráfaga, el acuse fijo;
//   · toque de una propuesta (o «sí» escrito solo con una vigente) → lo ejecuta el código, sin modelo; si el dominio pide
//     seguir (crear un cliente), el modelo tiene un turno después del hecho y sale un solo mensaje;
//   · escritos, toques de conversación y audios del equipo → turno del modelo, con «escribiendo…» desde el segundo 0
//     (se vuelve a encender antes de que Meta lo apague a los 25 s).
// ============================================================

import type { ConfigAgente } from './config.ts';
import type { DepsTurno, SalidaTurno } from './nucleo.ts';
import { esSiSolo, seguirTrasToque, toqueDePropuesta, turnoDelModelo, propuestaVigente } from './nucleo.ts';
import { leerToque } from './render.ts';
import { respuestaFija } from './reglamento.ts';
import type { Almacen, ContextoDominio, FilaConversacion, Mensajero, Traza } from './tipos.ts';

export interface DepsCola extends DepsTurno {
  almacen: Almacen;
  mensajero: Mensajero;
  workspaceId: string;
  phone: string;
  remitente: { nombre: string; rol: string };
  nuevoId: () => string;
  /** Después de cada turno del modelo (el cupo de uso justo). No bloquea la respuesta. */
  despuesDelTurno?: (traza: Traza) => Promise<void>;
  /** Espera (reemplazable en pruebas). */
  dormir?: (ms: number) => Promise<void>;
}

const VENTANA_RAFAGA_MS = 10 * 60 * 1000;

export function clavesCola(ws: string, phone: string) {
  return { cola: `agente:cola:${ws}:${phone}`, acuse: `agente:acuse:${ws}:${phone}` };
}

/** Las entrantes sin atender, en orden. */
export function pendientes(filas: FilaConversacion[]): FilaConversacion[] {
  return filas.filter((f) => f.direccion === 'entrante' && !f.turno_id);
}

/** ¿Este reenvío abre una ráfaga? (lo anterior atendido no fue un reenvío reciente). Pura. */
export function abreRafaga(filas: FilaConversacion[], primero: FilaConversacion): boolean {
  const antes = filas.filter((f) => f.created_at < primero.created_at || (f.created_at === primero.created_at && f.id !== primero.id && f.turno_id));
  const previa = antes.filter((f) => f.direccion === 'entrante').at(-1);
  if (!previa || previa.clase !== 'reenvio') return true;
  return Date.parse(primero.created_at) - Date.parse(previa.created_at) > VENTANA_RAFAGA_MS;
}

function contexto(d: DepsCola, filas: FilaConversacion[]): ContextoDominio {
  const resultadosPrevios = filas.flatMap((f) => (f.traza?.herramientas ?? [])
    .filter((h) => h.ok && h.nombre !== 'responder' && h.nombre !== 'proponer')
    .map((h) => ({ herramienta: h.nombre, args: h.args, datos: h.datos, privado: h.privado })));
  return { workspaceId: d.workspaceId, phone: d.phone, remitente: d.remitente, conversacion: filas, resultadosPrevios };
}

async function enviarYCerrar(d: DepsCola, turnoId: string, atendidas: FilaConversacion[], r: SalidaTurno, intent: string): Promise<void> {
  const salientes: string[] = [];
  if (r.salida) {
    const wamid = await d.mensajero.enviar(d.phone, r.salida, { workspaceId: d.workspaceId, intent });
    if (wamid) salientes.push(wamid);
    else r.traza.error = [r.traza.error, 'Meta rechazó el envío'].filter(Boolean).join('; ');
  }
  // Los que siguen (el mensaje para reenviar tal cual): cada uno aparte, para que se pueda reenviar solo.
  for (const extra of r.extras ?? []) {
    const wamid = await d.mensajero.enviar(d.phone, extra, { workspaceId: d.workspaceId, intent });
    if (wamid) salientes.push(wamid);
    else r.traza.error = [r.traza.error, 'Meta rechazó un mensaje extra'].filter(Boolean).join('; ');
  }
  // Desde que llegó el último mensaje atendido (la fila nace en el webhook) hasta que salió la respuesta.
  const ultima = atendidas.at(-1)!;
  r.traza.ms_turno = Math.max(0, d.ahoraMs() - Date.parse(ultima.created_at));
  const tb = d.reloj();
  await d.almacen.cerrarTurno({ turnoId, filas: atendidas.map((f) => f.id), filaTraza: ultima.id, traza: r.traza, salientes });
  r.traza.ms_base = Math.round(d.reloj() - tb);
}

/**
 * Corre `fn` con «escribiendo…» encendido y re-encendido antes de que Meta lo apague (25 s). El encendido va en paralelo
 * con `fn` (es una llamada a Meta de unos cientos de ms que no cambia lo que el turno decide), pero se espera antes de
 * devolver: así el «escribiendo…» nunca llega a Meta después de la respuesta y no se queda prendido sobre ella.
 */
async function conEscribiendo<T>(d: DepsCola, wamid: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  if (!wamid) return await fn();
  const encendido = d.mensajero.escribiendo(wamid).catch(() => {});
  const reencender = setInterval(() => { void d.mensajero.escribiendo(wamid).catch(() => {}); }, d.config.reencenderMs);
  try {
    return await fn();
  } finally {
    clearInterval(reencender);
    await encendido;
  }
}

/**
 * El toque (o el «sí» escrito) ejecutado y, si el dominio pide seguir, el turno del modelo que sigue al hecho. Una sola
 * salida. El cupo cuenta el turno del modelo.
 */
async function toqueYSeguir(d: DepsCola, e: Parameters<typeof toqueDePropuesta>[1], t: { huella: string; si: boolean }, tipo: 'toque_propuesta' | 'si_escrito'): Promise<SalidaTurno> {
  const wamid = e.nuevos.at(-1)?.wa_message_id;
  return await conEscribiendo(d, wamid, async () => {
    const r = await toqueDePropuesta(d, e, t, tipo);
    if (!r.seguir) return r;
    const s = await seguirTrasToque(d, e, r);
    if (d.despuesDelTurno && s.traza.tipo === 'modelo') await d.despuesDelTurno(s.traza).catch((err) => console.error('[agente] después del turno:', err));
    return s;
  });
}

/** Un turno: atiende lo pendiente más viejo. Devuelve false si no había nada. */
export async function unTurno(d: DepsCola): Promise<boolean> {
  const c: ConfigAgente = d.config;
  const desde = new Date(d.ahoraMs() - c.topes.ventanaHoras * 3600 * 1000).toISOString();
  const filas = await d.almacen.leer(d.workspaceId, d.phone, desde);
  const pend = pendientes(filas);
  if (!pend.length) return false;
  const turnoId = d.nuevoId();
  const ctx = contexto(d, filas);

  // 1) Un toque de una propuesta: código, sin modelo. Va solo (lo que llegó después espera su turno).
  const toque = pend.find((f) => f.clase === 'toque' && leerToque(f.toque_id)?.clase === 'propuesta');
  if (toque) {
    const antes = pend.slice(0, pend.indexOf(toque) + 1).filter((f) => f === toque || f.clase === 'reenvio');
    const t = leerToque(toque.toque_id) as { clase: 'propuesta'; huella: string; si: boolean };
    const r = await toqueYSeguir(d, { turnoId, filas, nuevos: [toque], ctx }, t, 'toque_propuesta');
    await enviarYCerrar(d, turnoId, antes, r, 'agente.toque');
    return true;
  }

  const delEquipo = pend.filter((f) => f.clase !== 'reenvio');
  // 2) Solo reenvíos: a la tanda, con el acuse al primero de la ráfaga (un candado evita dos acuses a la vez).
  if (!delEquipo.length) {
    const abre = abreRafaga(filas, pend[0]);
    const acuse = abre && await d.almacen.tomarCandado(clavesCola(d.workspaceId, d.phone).acuse, 60);
    const r: SalidaTurno = {
      salida: acuse ? { tipo: 'texto', texto: respuestaFija(d.reglamento, 'rf.acuse_reenvio') } : null,
      traza: { tipo: 'reenvio', bot: d.dominio.bot, respuesta_fija: acuse ? 'rf.acuse_reenvio' : null },
    };
    await enviarYCerrar(d, turnoId, pend, r, 'agente.reenvio');
    return true;
  }

  // 3) «sí» escrito solo con una propuesta vigente: código.
  const vig = propuestaVigente(filas);
  if (vig && delEquipo.length === 1 && delEquipo[0].clase === 'escrito' && esSiSolo(delEquipo[0].texto)) {
    const r = await toqueYSeguir(d, { turnoId, filas, nuevos: delEquipo, ctx }, { huella: vig.huella, si: true }, 'si_escrito');
    await enviarYCerrar(d, turnoId, pend, r, 'agente.si');
    return true;
  }

  // 4) Turno del modelo, con «escribiendo…» desde ya y re-encendido antes de los 25 s.
  const r = await conEscribiendo(d, delEquipo.at(-1)!.wa_message_id, () => turnoDelModelo(d, { turnoId, filas, nuevos: pend, ctx }));
  await enviarYCerrar(d, turnoId, pend, r, 'agente.turno');
  if (d.despuesDelTurno) await d.despuesDelTurno(r.traza).catch((err) => console.error('[agente] después del turno:', err));
  return true;
}

/**
 * Atiende todo lo pendiente del remitente, con su candado. Devuelve cuántos turnos corrió este proceso.
 * Si otro proceso tiene el candado, sale sin hacer nada: ese proceso atiende también este mensaje.
 */
export async function atenderPendientes(d: DepsCola): Promise<number> {
  const { cola } = clavesCola(d.workspaceId, d.phone);
  let turnos = 0;
  for (let vuelta = 0; vuelta < 5; vuelta++) {
    if (!(await d.almacen.tomarCandado(cola, Math.ceil(d.config.topes.turnoMs / 1000) + 40))) return turnos;
    try {
      for (let i = 0; i < 10 && await unTurno(d); i++) turnos++;
    } finally {
      await d.almacen.soltarCandado(cola);
    }
    // Lo que llegó entre el último turno y el soltar el candado: si nadie lo tomó, se atiende aquí.
    const desde = new Date(d.ahoraMs() - d.config.topes.ventanaHoras * 3600 * 1000).toISOString();
    if (!pendientes(await d.almacen.leer(d.workspaceId, d.phone, desde)).length) return turnos;
  }
  return turnos;
}
