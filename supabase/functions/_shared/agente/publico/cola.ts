// ============================================================
// Asistente público — la cola por conversación de Chatwoot (§2 pasos 5 a 11)
// ------------------------------------------------------------
// Corre en segundo plano (`EdgeRuntime.waitUntil`), después de que el webhook guardó el mensaje y respondió 200. Un
// candado por conversación (cuenta + id, no teléfono: en IG y TikTok no hay) hace que un solo proceso la atienda; el que
// lo tiene atiende todo lo pendiente y, al soltarlo, vuelve a mirar.
//
// Por turno, en este orden (lo que es código no pasa por el modelo):
//   0. interruptor `bot.encendido = false` → no contesta (§6.3).
//   1. ráfaga: espera `rafaga_ms` de silencio y junta lo seguido (§3.4).
//   2. anti-spam, turnos con IA por conversación y presupuesto del día (§11).
//   3. audio: TikTok → respuesta fija; WhatsApp/Instagram → transcripción (Gemini); si falla, respuesta fija (§4.2).
//   4. respuesta a una autorización en espera («sí»/«no» solo o el botón): la registra el código con su prueba (§5).
//   5. toque o «sí» sobre la propuesta de reserva vigente → el núcleo la confirma → paso a persona `reserva_lista`.
//   6. «persona» escrito solo, sin modelo (§6.4): la primera vez, `rf.persona_por_que` (una sola por conversación); si ya
//      salió, o si la conversación volvió de una persona, paso a persona `pide_persona`.
//   7. turno del modelo con el reintento con aviso (`reintento.ts`); el aviso de bot va pegado a la primera respuesta.
//   8. antes de publicar: links en la lista blanca, ¿entró otro mensaje mientras generaba? (se regenera con todo),
//      ventana del canal (§9) y que la conversación siga en `pending` (si la tomó una persona, no se publica).
//   9. publica (`generado` → `publicado`), hace el paso a persona (nota, etiqueta, equipo, `open`), guarda la prueba de
//      consentimientos, enmascara lo sensible y cierra el turno con su traza y sus tiempos por tramo.
// ============================================================

import { CONFIG_POR_DEFECTO } from '../config.ts';
import type { ConfigAgente } from '../config.ts';
import { esSiSolo, propuestaVigente, toqueDePropuesta, turnoDelModelo } from '../nucleo.ts';
import type { DepsTurno, SalidaTurno } from '../nucleo.ts';
import { leerToque, cortarEnPalabra } from '../render.ts';
import type { PrecioModelo } from '../uso.ts';
import type { ContextoDominio, Modelo, Reglamento, Salida } from '../tipos.ts';
import {
  RF_BIENVENIDA, autorizacionEnEspera, conAviso, estadoAutorizacion, salidaAutorizacion, eventoAutorizacion, huellaTexto, motivoAviso, respuestaA, textoFijo, versionDe,
} from './autorizacion.ts';
import type { ConfigPublico } from './config.ts';
import { PASAR_A_PERSONA, RESPUESTA_FIJA, RF_PERSONA_POR_QUE, dominioPublico, porQueYaSalio, volvioDePersona } from './dominio.ts';
import { enlacesFueraDeLista } from './enlaces.ts';
import { preciosSinHerramienta } from './precios.ts';
import { frasesDeSobreventa } from './sobreventa.ts';
import { sistemaPublico } from './prompt.ts';
import type { AlmacenPublico, AvisosInternos, MensajeroChatwoot, Transcriptor } from './puertos.ts';
import { turnoConReintento } from './reintento.ts';
import { gastoDelDia, inicioDiaBogota, mensajesUltimaHora, textoAvisoPresupuesto, turnosConIA, umbralesAlcanzados } from './topes.ts';
import type { Canal, EventoAutorizacion, FilaPublica, LlaveConversacion, MotivoPersona, PasoAPersona, Tramos, TrazaPublica } from './tipos.ts';
import { ETIQUETA_MOTIVO, llaveTexto } from './tipos.ts';
import { ventana } from './ventana.ts';

export interface DepsPublico {
  modelo: Modelo;
  reglamento: Reglamento;
  config: ConfigPublico;
  almacen: AlmacenPublico;
  mensajero: MensajeroChatwoot;
  transcriptor: Transcriptor;
  avisos?: AvisosInternos;
  llave: LlaveConversacion;
  canal: Canal;
  anuncio7Dias?: boolean;
  /** Para los avisos internos. */
  workspaceNombre: string;
  precios: PrecioModelo[];
  ahoraMs: () => number;
  reloj: () => number;
  nuevoId: () => string;
  dormir: (ms: number) => Promise<void>;
  /** Arnés de operación: una herramienta caída. */
  fallarHerramienta?: () => boolean;
}

const DIAS_DE_CONVERSACION = 30;
const REMITENTE = { nombre: 'el cliente', rol: 'cliente' };

export function clavesPublico(l: LlaveConversacion) {
  return { cola: `chatwoot:cola:${l.workspaceId}:${llaveTexto(l)}` };
}

/** El núcleo con la configuración del asistente público. Pura. */
export function configNucleo(c: ConfigPublico, turnoMs: number): ConfigAgente {
  return {
    ...CONFIG_POR_DEFECTO,
    activo: true,
    principal: { modelo: c.modelo.modelo, razonamiento: null, temperatura: null, maxSalida: c.modelo.maxSalida },
    respaldo: null,
    respaldoEstricto: false,
    topes: { llamados: c.topes.llamados, entradaTokens: 12000, texto: c.topes.texto, turnoMs, ventanaHoras: 24 * DIAS_DE_CONVERSACION },
    reglamentoId: c.reglamentoId,
  };
}

export const pendientesPublico = (filas: FilaPublica[]) => filas.filter((f) => f.direccion === 'entrante' && !f.turno_id);

const varsDe = (d: DepsPublico): Record<string, string> => {
  const p = d.reglamento.fichas.find((f) => f.tipo === 'perfil')?.valores ?? {};
  return { link: d.config.terminosUrl, nombre: typeof p.nombre === 'string' ? p.nombre : 'el asistente virtual' };
};

const fija = (d: DepsPublico, clave: string): Salida => ({ tipo: 'texto', texto: textoFijo(d.reglamento, clave, varsDe(d)) });

/** ¿El interruptor del reglamento está apagado? Sin la ficha, encendido. Pura. */
export function botApagado(r: Reglamento): boolean {
  return r.fichas.find((f) => f.clave === 'bot.encendido')?.valores?.encendido === false;
}

const esPalabraSola = (t: string | null | undefined, w: string) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '') === w;

// ── La nota del paso a persona (§6.2.1) ──────────────────────────────────────

/** La nota privada con formato fijo, armada por el código. Nunca el detalle de un dato sensible. Pura. */
export function notaPersona(p: {
  motivo: MotivoPersona; pidio: string; filas: FilaPublica[]; reserva: Record<string, unknown> | null; herramientas: string[]; ahoraIso: string;
}): string {
  const g = estadoAutorizacion(p.filas, 'general');
  const s = estadoAutorizacion(p.filas, 'sensible');
  const aut = g.estado === 'si'
    ? `sí (${g.evento.mensaje_texto ? `«${g.evento.mensaje_texto.slice(0, 20)}»` : 'botón'}, ${g.at.slice(0, 16).replace('T', ' ')} UTC, versión ${g.evento.texto_version})`
    : g.estado === 'no' ? 'dijo que no: no se tomaron datos' : g.estado === 'pedida' ? 'pedida, sin respuesta' : 'no pedida';
  const alimentacion = s.estado === 'si' ? 'tiene una consulta de alimentación, autorizada: revisar en el chat'
    : s.estado === 'no' || s.estado === 'pedida' ? 'tiene una consulta de alimentación pendiente, sin autorización' : null;
  const r = p.reserva;
  const reserva = r
    ? `${r.experiencia ?? '?'} · función ${r.funcion ?? '?'} (${r.inicio ?? '?'}) · ${r.personas ?? '?'} personas · ${r.nombre ?? '?'} · C.C. ${r.cedula ?? '?'} · Tel. ${r.telefono ?? '?'}`
    : 'sin datos tomados';
  // La mesa que pidió es preferencia: la asigna el equipo (§8.4.2). Vale la de la reserva o la última anotada.
  const preferencia = (r?.preferencia_mesa as string | undefined) ?? p.filas.map((f) => (f.traza as TrazaPublica | null)?.preferencia_mesa).filter(Boolean).at(-1) ?? null;
  const siguiente: Record<MotivoPersona, string> = {
    reserva_lista: 'confirmar cupo y enviar el pago', restriccion: 'revisar la restricción para el menú', celebracion: 'coordinar la celebración',
    grupo: 'cotizar el grupo', pide_persona: 'atender lo que pide', queja: 'atender la queja', pago: 'revisar el pago (el asistente no lo vio)',
    no_entiende: 'retomar la conversación', menor: 'pedir que escriba un adulto', crisis: 'atender ya', abuso: 'revisar la conversación',
    duda_abierta: 'contestar la duda (la ficha y las reglas no la cubren)', datos: 'atender la solicitud de datos', falla: 'contestar: el asistente falló',
  };
  return [
    `[Asistente] Paso a persona · motivo: ${p.motivo}`,
    `Pidió: ${p.pidio || '(ver el chat)'}`,
    `Reserva: ${reserva}`,
    ...(preferencia ? [`Preferencia de mesa: ${preferencia} (por confirmar: la asigna el equipo)`] : []),
    `Autorización de datos: ${aut}`,
    ...(alimentacion ? [`Alimentación: ${alimentacion}`] : []),
    ...(p.herramientas.length ? [`Consultó: ${[...new Set(p.herramientas)].join(', ')}`] : []),
    `Siguiente paso: ${siguiente[p.motivo]}`,
  ].join('\n');
}

// ── Publicar ─────────────────────────────────────────────────────────────────

async function publicarEn(d: DepsPublico, turnoId: string, ranura: string, s: Salida): Promise<{ ok: boolean; id: number | null; motivo?: string }> {
  const id = await d.almacen.reservarSalida({ llave: d.llave, canal: d.canal, turnoId, ranura, salida: s });
  if (!id) return { ok: false, id: null, motivo: 'ranura ya tomada' };
  const r = await d.mensajero.publicar(d.llave, s);
  if (r.ok) {
    await d.almacen.marcarSalida(id, { estado: 'publicado', chatwootMessageId: r.id });
    return { ok: true, id: r.id };
  }
  // Ante la duda no se reintenta a ciegas (§3.3): queda `incierto` para mirarlo.
  await d.almacen.marcarSalida(id, { estado: r.incierto ? 'incierto' : 'fallido' });
  return { ok: false, id: null, motivo: r.motivo };
}

async function pasarAPersona(d: DepsPublico, turnoId: string, p: PasoAPersona): Promise<string[]> {
  const errores: string[] = [];
  const nota = await d.almacen.reservarSalida({ llave: d.llave, canal: d.canal, turnoId, ranura: 'nota_persona', salida: { tipo: 'texto', texto: p.nota }, nota: true });
  if (nota) {
    const r = await d.mensajero.nota(d.llave, p.nota);
    await d.almacen.marcarSalida(nota, r.ok ? { estado: 'publicado', chatwootMessageId: r.id } : { estado: r.incierto ? 'incierto' : 'fallido' });
    if (!r.ok) errores.push(`nota: ${r.motivo}`);
  }
  if (!(await d.mensajero.etiquetar(d.llave, [p.etiqueta]))) errores.push('etiqueta');
  if (p.equipo !== null && !(await d.mensajero.asignarEquipo(d.llave, p.equipo))) errores.push('equipo');
  if (!(await d.mensajero.abrir(d.llave))) errores.push('toggle_status');
  return errores;
}

// ── El turno ─────────────────────────────────────────────────────────────────

interface Resultado {
  salida: Salida | null;
  extras?: Salida[];
  traza: TrazaPublica;
  persona?: { motivo: MotivoPersona; pidio: string } | null;
  reserva?: Record<string, unknown> | null;
  enmascarar?: boolean;
  autorizacion?: EventoAutorizacion | null;
  pide?: 'general' | 'sensible' | null;
  /** Lo generó el modelo (pasa por la lista blanca de links). */
  delModelo?: boolean;
}

const sinTurno = (d: DepsPublico, extra: Partial<TrazaPublica> = {}): TrazaPublica => ({
  tipo: 'sin_turno', bot: dominioPublico({ reglamento: d.reglamento, ahoraMs: d.ahoraMs, vars: {} }).bot,
  reglamento: { id: d.reglamento.id, version: d.reglamento.version, huella: d.reglamento.huella }, canal: d.canal, ...extra,
});

function ctxDe(d: DepsPublico, filas: FilaPublica[]): ContextoDominio {
  const resultadosPrevios = filas.flatMap((f) => (f.traza?.herramientas ?? [])
    .filter((h) => h.ok && !['responder', 'proponer', PASAR_A_PERSONA, RESPUESTA_FIJA].includes(h.nombre))
    .map((h) => ({ herramienta: h.nombre, args: h.args, datos: h.datos, privado: h.privado })));
  return { workspaceId: d.llave.workspaceId, phone: llaveTexto(d.llave), remitente: REMITENTE, conversacion: filas, resultadosPrevios };
}

function depsTurno(d: DepsPublico, turnoMs: number): DepsTurno {
  return {
    modelo: d.modelo,
    dominio: dominioPublico({ reglamento: d.reglamento, ahoraMs: d.ahoraMs, vars: varsDe(d), fallar: d.fallarHerramienta }),
    reglamento: d.reglamento,
    config: configNucleo(d.config, turnoMs),
    ahoraMs: d.ahoraMs,
    reloj: d.reloj,
    sistema: (r, c) => sistemaPublico(r, c),
    // Plata solo de herramienta: vuelve al modelo una vez para que corrija (Yuto, 2026-10-21). La guarda del final
    // (antes de publicar) queda igual: nunca sale un monto que no devolvió una herramienta.
    // Más los candados contra la sobreventa de §8.4 (confirmación, escasez, condiciones sumadas o no listadas).
    guardaTexto: (texto, herramientas) => [
      ...preciosSinHerramienta(texto, herramientas)
        .map((x) => `el monto ${x} no viene de ver_catalogo/ver_funciones; no lo repitas, usa el precio de la herramienta o di que no lo puedes confirmar`),
      ...frasesDeSobreventa(texto, herramientas),
    ],
  };
}

/** Lo que el turno del modelo dejó para el código (los cierres del dominio con su `privado`). Pura. */
export function efectosDelTurno(t: TrazaPublica): { persona: { motivo: MotivoPersona; pidio: string } | null; pide: 'general' | 'sensible' | null; enmascarar: boolean; preferencia: string | null } {
  let persona: { motivo: MotivoPersona; pidio: string } | null = null;
  let pide: 'general' | 'sensible' | null = null;
  let enmascarar = false;
  let preferencia: string | null = null;
  for (const h of t.herramientas ?? []) {
    if (!h.ok) continue;
    const pv = (h.privado ?? {}) as { persona?: { motivo: MotivoPersona; pidio: string }; pide_autorizacion?: 'general' | 'sensible'; enmascarar?: boolean; preferencia_mesa?: string };
    if (h.nombre === PASAR_A_PERSONA && pv.persona) persona = pv.persona;
    if (h.nombre === RESPUESTA_FIJA) {
      if (pv.pide_autorizacion) pide = pv.pide_autorizacion;
      if (pv.enmascarar) enmascarar = true;
      if (pv.preferencia_mesa) preferencia = pv.preferencia_mesa;
    }
  }
  return { persona, pide, enmascarar, preferencia };
}

/** El turno del modelo con el reintento con aviso. */
async function turnoModelo(d: DepsPublico, turnoId: string, filas: FilaPublica[], pend: FilaPublica[], tramos: Tramos, extra: Partial<TrazaPublica>): Promise<Resultado> {
  const res = await turnoConReintento({
    corte1Ms: d.config.corte1Ms,
    corteTotalMs: d.config.corteTotalMs,
    reloj: d.reloj,
    intentar: (_n, presupuesto) => {
      const copia = structuredClone(filas);
      return turnoDelModelo(depsTurno(d, presupuesto), { turnoId, filas: copia, nuevos: copia.filter((f) => pend.some((p) => p.id === f.id)), ctx: ctxDe(d, copia) });
    },
    avisar: async () => {
      const v = ventana({ canal: d.canal, anuncio7Dias: d.anuncio7Dias, filas, ahoraMs: d.ahoraMs(), cuantos: 2 });
      if (!v.abierta) return;
      await publicarEn(d, turnoId, 'aviso_demora', fija(d, 'rf.demora'));
    },
  });
  tramos.intentos = res.intentos;
  const base = { canal: d.canal, demora: res.demora, ...extra };
  const des = res.desenlace;
  if (des.tipo === 'respuesta') {
    const ef0 = efectosDelTurno(des.r.traza as TrazaPublica);
    // La mesa queda en el estado como PREFERENCIA (§8.4.2): en la traza del turno, nunca como asignación.
    const t: TrazaPublica = { ...des.r.traza, ...base, ...(ef0.preferencia ? { preferencia_mesa: ef0.preferencia } : {}) };
    const ef = ef0;
    const reserva = t.propuesta ? t.propuesta.datos : null;
    return { salida: des.r.salida, extras: des.r.extras, traza: t, persona: ef.persona, pide: ef.pide, enmascarar: ef.enmascarar, reserva, delModelo: !t.respuesta_fija && !ef.pide && !ef.persona && !ef.enmascarar && !(t.herramientas ?? []).some((h) => h.ok && (h.nombre === RESPUESTA_FIJA || h.nombre === PASAR_A_PERSONA)) };
  }
  // Rechazo o falla: respuesta fija y persona (falla). La traza del intento queda (cuenta en el uso del día).
  const ultimo = des.tipo === 'rechazo' ? des.r : des.ultimo;
  const t: TrazaPublica = {
    ...(ultimo?.traza ?? sinTurno(d)), tipo: ultimo ? 'modelo' : 'sin_turno', ...base,
    respuesta_fija: 'rf.persona.falla', error: des.tipo === 'rechazo' ? 'modelo: refusal' : `falla: ${des.motivo}`,
  };
  return { salida: fija(d, 'rf.persona.falla'), traza: t, persona: { motivo: 'falla', pidio: des.tipo === 'rechazo' ? 'el modelo rechazó responder' : `el modelo no respondió (${des.motivo})` } };
}

/** Decide el turno (sin publicar). */
async function decidir(d: DepsPublico, turnoId: string, filas: FilaPublica[], pend: FilaPublica[], tramos: Tramos): Promise<Resultado> {
  const r = d.reglamento;
  const c = d.config;
  const ultima = pend.at(-1)!;

  // 2. Topes.
  if (mensajesUltimaHora(filas, d.ahoraMs()) > c.topes.mensajesPorHora) {
    return { salida: null, traza: sinTurno(d, { topes: ['anti_spam'], sin_publicar: 'anti-spam: más de lo permitido por hora' }) };
  }
  if (turnosConIA(filas) >= c.topes.turnosPorConversacion) {
    return { salida: fija(d, 'rf.persona.falla'), traza: sinTurno(d, { topes: ['turnos_por_conversacion'], respuesta_fija: 'rf.persona.falla' }), persona: { motivo: 'falla', pidio: `la conversación llegó a ${c.topes.turnosPorConversacion} turnos con IA` } };
  }
  if (c.presupuestoDiarioUsd !== null) {
    const trazas = await d.almacen.trazasDelModelo(d.llave.workspaceId, inicioDiaBogota(d.ahoraMs()));
    const gasto = trazas ? gastoDelDia(trazas, d.precios) : null;
    if (gasto !== null) {
      const dia = inicioDiaBogota(d.ahoraMs()).slice(0, 10);
      for (const u of umbralesAlcanzados(gasto, c.presupuestoDiarioUsd)) {
        if (await d.almacen.tomarCandado(`chatwoot:presupuesto:${d.llave.workspaceId}:${dia}:${u}`, 36 * 3600)) {
          await d.avisos?.avisar(textoAvisoPresupuesto({ workspace: d.workspaceNombre, umbral: u, gasto, presupuesto: c.presupuestoDiarioUsd })).catch(() => {});
        }
      }
      if (gasto >= c.presupuestoDiarioUsd) {
        return { salida: fija(d, 'rf.persona.falla'), traza: sinTurno(d, { topes: ['presupuesto_diario'], respuesta_fija: 'rf.persona.falla' }), persona: { motivo: 'falla', pidio: 'corte por presupuesto diario' } };
      }
    }
  }

  // 3. Audios.
  const audios = pend.filter((f) => f.clase === 'audio' && !f.texto);
  if (audios.length) {
    if (d.canal === 'tiktok' || audios.some((a) => a.adjunto?.no_soportado || !a.adjunto?.url)) {
      if (pend.every((f) => f.clase === 'audio' && !f.texto)) {
        const clave = d.canal === 'tiktok' ? 'rf.audio_tiktok' : 'rf.audio_fallo';
        return { salida: fija(d, clave), traza: sinTurno(d, { respuesta_fija: clave }) };
      }
    } else {
      const t0 = d.reloj();
      let fallidos = 0;
      for (const a of audios) {
        const t = await d.transcriptor.transcribir({ url: a.adjunto!.url!, extension: a.adjunto?.extension });
        if (t.texto) {
          await d.almacen.completarTexto(a.id, t.texto);
          a.texto = t.texto;
          const enFilas = filas.find((f) => f.id === a.id);
          if (enFilas) enFilas.texto = t.texto;
        } else fallidos++;
      }
      tramos.transcripcion_ms = (tramos.transcripcion_ms ?? 0) + Math.round(d.reloj() - t0);
      if (fallidos && pend.every((f) => f.clase !== 'audio' ? false : !f.texto)) {
        return { salida: fija(d, 'rf.audio_fallo'), traza: sinTurno(d, { respuesta_fija: 'rf.audio_fallo' }) };
      }
    }
  }

  const solo = pend.length === 1 ? ultima : null;

  // 4. Respuesta a una autorización en espera (solo el botón o «sí»/«no» escrito solo, como único mensaje).
  const espera = autorizacionEnEspera(filas);
  if (espera && solo) {
    const resp = respuestaA(espera, solo);
    if (resp) {
      const evento = await eventoAutorizacion({ r, tipo: espera, respuesta: resp, fila: solo, vars: varsDe(d), ahoraIso: new Date(d.ahoraMs()).toISOString() });
      if (espera === 'sensible') {
        if (resp === 'si') {
          return { salida: fija(d, 'rf.persona.restriccion'), traza: sinTurno(d, { autorizacion: evento, respuesta_fija: 'rf.persona.restriccion' }), autorizacion: evento, persona: { motivo: 'restriccion', pidio: 'consulta de alimentación (autorizada)' } };
        }
        return { salida: fija(d, 'rf.sensible_no'), traza: sinTurno(d, { autorizacion: evento, respuesta_fija: 'rf.sensible_no' }), autorizacion: evento };
      }
      if (resp === 'no') return { salida: fija(d, 'rf.autorizacion_no'), traza: sinTurno(d, { autorizacion: evento, respuesta_fija: 'rf.autorizacion_no' }), autorizacion: evento };
      // «Sí» a la general: queda registrada en este turno y el modelo sigue (pide el nombre).
      const conSi = filas.map((f) => (f.id === solo.id ? { ...f, traza: { ...(f.traza ?? sinTurno(d)), autorizacion: evento } as TrazaPublica } : f));
      const m = await turnoModelo(d, turnoId, conSi, pend, tramos, { autorizacion: evento });
      return { ...m, autorizacion: evento, traza: { ...m.traza, autorizacion: evento } };
    }
  }

  // 5. Toque o «sí» sobre la propuesta de reserva vigente (el núcleo, sin modelo).
  const toque = solo && solo.clase === 'toque' ? leerToque(solo.toque_id) : null;
  const vig = propuestaVigente(filas);
  if (solo && ((toque && toque.clase === 'propuesta') || (vig && solo.clase === 'escrito' && esSiSolo(solo.texto)))) {
    const t = toque && toque.clase === 'propuesta' ? toque : { huella: vig!.huella, si: true };
    const dt = depsTurno(d, c.corteTotalMs);
    const rt = await toqueDePropuesta({ ...dt, almacen: d.almacen }, { turnoId, filas, nuevos: [solo], ctx: ctxDe(d, filas) }, t, toque ? 'toque_propuesta' : 'si_escrito');
    const traza: TrazaPublica = { ...rt.traza, canal: d.canal };
    const ej = rt.traza.ejecucion;
    const persona = ej?.resultado === 'ejecutada' && (ej.escrituras ?? []).some((e) => e.tipo === 'persona');
    const reserva = persona ? ((ej!.escrituras ?? []).find((e) => e.tipo === 'persona')?.datos as Record<string, unknown>) : null;
    return { salida: rt.salida, traza, reserva, persona: persona ? { motivo: 'reserva_lista', pidio: 'reservar (confirmó el resumen)' } : null };
  }

  // 6. «persona» escrito solo (el aviso de bot lo ofrece): sin modelo. Una pregunta por qué, una sola vez en la
  // conversación (§6.4.1 y §6.4.4); a quien vuelve de una persona no se le pregunta (§6.4.5).
  if (solo && esPalabraSola(solo.texto, 'persona')) {
    const volvio = volvioDePersona(filas);
    if (!volvio && !porQueYaSalio(filas)) {
      return { salida: fija(d, RF_PERSONA_POR_QUE), traza: sinTurno(d, { respuesta_fija: RF_PERSONA_POR_QUE }) };
    }
    const pidio = volvio ? 'escribió «persona» (ya lo había atendido una persona)' : 'escribió «persona» otra vez, tras la pregunta de para qué';
    return { salida: fija(d, 'rf.persona'), traza: sinTurno(d, { respuesta_fija: 'rf.persona' }), persona: { motivo: 'pide_persona', pidio } };
  }

  // 7. El modelo.
  return await turnoModelo(d, turnoId, filas, pend, tramos, {});
}

/** Un turno: atiende lo pendiente. Devuelve false si no había nada. */
export async function unTurnoPublico(d: DepsPublico): Promise<boolean> {
  const desde = () => new Date(d.ahoraMs() - DIAS_DE_CONVERSACION * 24 * 3600 * 1000).toISOString();
  let filas = await d.almacen.leer(d.llave, desde());
  let pend = pendientesPublico(filas);
  if (!pend.length) return false;
  const turnoId = d.nuevoId();
  const tramos: Tramos = {};

  // 0. Interruptor.
  if (botApagado(d.reglamento)) {
    await d.almacen.cerrarTurno({ turnoId, filas: pend.map((f) => f.id), filaTraza: pend.at(-1)!.id, traza: sinTurno(d, { sin_publicar: 'interruptor: bot.encendido = false' }) });
    return true;
  }

  // 1. Ráfaga: silencio de `rafaga_ms` desde el último mensaje (máximo 4 esperas).
  let rafaga = 0;
  for (let i = 0; i < 4 && d.config.rafagaMs > 0; i++) {
    const falta = d.config.rafagaMs - (d.ahoraMs() - Date.parse(pend.at(-1)!.created_at));
    if (falta <= 0) break;
    await d.dormir(falta);
    rafaga += falta;
    filas = await d.almacen.leer(d.llave, desde());
    pend = pendientesPublico(filas);
  }
  tramos.rafaga_ms = Math.round(rafaga);

  // Un audio que llegó sin URL (`message_created` antes de que Chatwoot tenga el archivo): se espera su
  // `message_updated` hasta 8 s. TikTok no entrega audios (§4.2): ahí no se espera.
  let esperaAudio = 0;
  const sinUrl = () => pend.some((f) => f.clase === 'audio' && !f.texto && !f.adjunto?.url && !f.adjunto?.no_soportado);
  while (d.canal !== 'tiktok' && sinUrl() && esperaAudio < 8000) {
    await d.dormir(1000);
    esperaAudio += 1000;
    filas = await d.almacen.leer(d.llave, desde());
    pend = pendientesPublico(filas);
  }
  if (esperaAudio) tramos.transcripcion_ms = esperaAudio;

  let r: Resultado | null = null;
  let regenerado = 0;
  for (;;) {
    r = await decidir(d, turnoId, filas, pend, tramos);
    // 8a. ¿Entró otro mensaje mientras generaba? Se descarta el borrador y se regenera con todo (§3.4), hasta 2 veces.
    if (!r.salida || regenerado >= 2 || r.persona) break;
    const ahora = await d.almacen.leer(d.llave, desde());
    const nuevos = pendientesPublico(ahora).filter((f) => !pend.some((p) => p.id === f.id));
    if (!nuevos.length) break;
    regenerado++;
    filas = ahora;
    pend = pendientesPublico(ahora);
  }
  const traza: TrazaPublica = { ...r.traza, canal: d.canal, tramos, ...(regenerado ? { regenerado } : {}) };
  const ultima = pend.at(-1)!;
  tramos.recepcion_ms = ultima.ms_webhook ?? null;

  // 8b. Links fuera de la lista blanca: la respuesta del modelo no sale.
  let salida = r.salida;
  let persona = r.persona ?? null;
  if (salida && r.delModelo) {
    const texto = [salida.texto, ...(r.extras ?? []).map((x) => x.texto)].join('\n');
    const fuera = enlacesFueraDeLista(texto, [d.config.terminosUrl, ...d.config.enlacesPermitidos]);
    // 8b'. Plata solo de herramienta (el catálogo) o del resumen del código, nunca de lo que dijo el cliente.
    const deHerramienta = [...filas, ...pend].flatMap((f) => (f.traza?.herramientas ?? []).map((h) => JSON.stringify(h.datos ?? '')))
      .concat((traza.herramientas ?? []).map((h) => JSON.stringify(h.datos ?? '')), traza.propuesta?.resumen ?? '');
    const plata = preciosSinHerramienta(traza.propuesta ? salida.texto.replace(traza.propuesta.resumen, '') : texto, deHerramienta);
    if (fuera.length || plata.length) {
      if (fuera.length) traza.enlaces_rechazados = fuera;
      traza.candados = [
        ...(traza.candados ?? []),
        ...(fuera.length ? [{ candado: 'link_fuera_de_lista', detalle: fuera.join(' ') }] : []),
        ...(plata.length ? [{ candado: 'precio_sin_herramienta', detalle: plata.join(' ') }] : []),
      ];
      salida = fija(d, 'rf.modelo_caido');
      traza.respuesta_fija = 'rf.modelo_caido';
    }
  }
  // 8b''. El modelo no pide la autorización con sus palabras: el texto legal es fijo (§5.2). Visto en la corrida real
  // (2026-10-21): «¿autorizas que tomemos tus datos…? [Sí | No]» escrito por el modelo, sin link ni versión; el «no» que
  // siguió no quedó como prueba. Si su respuesta habla de autorizar y no hay un «sí» registrado, sale la fija.
  let pide = r.pide ?? null;
  if (salida && r.delModelo && salida === r.salida && /autoriz/.test(salida.texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
    && estadoAutorizacion(filas, 'general').estado !== 'si') {
    traza.candados = [...(traza.candados ?? []), { candado: 'autorizacion_improvisada', detalle: salida.texto.slice(0, 200) }];
    salida = salidaAutorizacion(d.reglamento, 'general', varsDe(d));
    traza.respuesta_fija = 'rf.autorizacion';
    pide = 'general';
  }
  const extras = salida === r.salida ? (r.extras ?? []) : [];

  // El aviso de bot y términos (§5.1): pegado a la primera respuesta que sale.
  const motivo = salida ? motivoAviso(filas, new Set(pend.map((f) => f.id)), d.ahoraMs(), d.config.pausaLargaHoras) : null;
  let avisoAparte: Salida | null = null;
  if (salida && motivo) {
    const textoAviso = textoFijo(d.reglamento, RF_BIENVENIDA, varsDe(d));
    traza.aviso = { clave: RF_BIENVENIDA, version: versionDe(d.reglamento, RF_BIENVENIDA), huella: await huellaTexto(textoAviso), motivo };
    const junto = conAviso(textoAviso, salida);
    // Botones: el cuerpo va hasta 1024 en WhatsApp. Si no cabe, el aviso sale aparte, antes (nunca se corta el resumen).
    if (junto.tipo !== 'texto' && [...junto.texto].length > 1024) avisoAparte = { tipo: 'texto', texto: textoAviso };
    else salida = junto;
  }

  // 8c. Ventana del canal y que la conversación siga en pending.
  const cuantos = (salida ? 1 : 0) + extras.length + (avisoAparte ? 1 : 0);
  if (salida) {
    const v = ventana({ canal: d.canal, anuncio7Dias: d.anuncio7Dias, filas, ahoraMs: d.ahoraMs(), cuantos });
    const estado = v.abierta ? await d.mensajero.estado(d.llave) : null;
    if (!v.abierta || (estado !== null && estado !== 'pending')) {
      traza.sin_publicar = !v.abierta ? `ventana: ${v.motivo}` : `la conversación está en «${estado}»: la tiene una persona`;
      if (!v.abierta) {
        const nota = `[Asistente] No publiqué por la ventana del canal (${v.motivo}). Lo que iba a decir: ${cortarEnPalabra(salida.texto, 500)}`;
        const id = await d.almacen.reservarSalida({ llave: d.llave, canal: d.canal, turnoId, ranura: 'nota_ventana', salida: { tipo: 'texto', texto: nota }, nota: true });
        if (id) {
          const rn = await d.mensajero.nota(d.llave, nota);
          await d.almacen.marcarSalida(id, rn.ok ? { estado: 'publicado', chatwootMessageId: rn.id } : { estado: rn.incierto ? 'incierto' : 'fallido' });
        }
      }
      salida = null;
      persona = !v.abierta ? persona : null;
      avisoAparte = null;
    }
  }

  // 9. Publicar.
  const tp = d.reloj();
  let publicadoAviso: number | null = null;
  const errores: string[] = [];
  if (avisoAparte) {
    const a = await publicarEn(d, turnoId, 'aviso', avisoAparte);
    if (a.ok) publicadoAviso = a.id; else errores.push(`aviso: ${a.motivo}`);
  }
  if (salida) {
    const p = await publicarEn(d, turnoId, 'respuesta', salida);
    if (p.ok) { if (!avisoAparte) publicadoAviso = p.id; } else errores.push(`respuesta: ${p.motivo}`);
    for (const [i, x] of extras.entries()) {
      const e = await publicarEn(d, turnoId, `extra_${i + 1}`, x);
      if (!e.ok) errores.push(`extra: ${e.motivo}`);
    }
    if (p.ok) {
      tramos.publicacion_ms = Math.round(d.reloj() - tp);
      tramos.interno_ms = Math.max(0, Math.round(d.ahoraMs() - Date.parse(ultima.created_at) - (tramos.rafaga_ms ?? 0)));
    }
  }
  traza.salida = salida;
  if (extras.length && salida) traza.salidas_extra = extras;
  if (pide && salida) traza.pide_autorizacion = pide;

  // Paso a persona.
  if (persona) {
    const herramientas = filas.concat(pend).flatMap((f) => (f.traza?.herramientas ?? []).map((h) => h.nombre)).concat((traza.herramientas ?? []).map((h) => h.nombre))
      .filter((h) => !['responder', PASAR_A_PERSONA, RESPUESTA_FIJA].includes(h));
    const filasNota = r.autorizacion ? filas.map((f) => (f.id === ultima.id ? { ...f, traza: { ...(f.traza ?? sinTurno(d)), autorizacion: r!.autorizacion } as TrazaPublica } : f)) : filas;
    const reserva = r.reserva ?? (propuestaVigente(filas)?.datos ?? null);
    const paso: PasoAPersona = {
      motivo: persona.motivo, etiqueta: ETIQUETA_MOTIVO[persona.motivo], equipo: d.config.equipos[persona.motivo] ?? null,
      nota: notaPersona({ motivo: persona.motivo, pidio: persona.pidio, filas: filasNota, reserva, herramientas, ahoraIso: new Date(d.ahoraMs()).toISOString() }),
    };
    traza.persona = paso;
    errores.push(...(await pasarAPersona(d, turnoId, paso)));
  }

  // Prueba: aviso y autorizaciones.
  if (traza.aviso && publicadoAviso !== null) {
    await d.almacen.registrarConsentimiento({ llave: d.llave, canal: d.canal, tipo: 'aviso', respuesta: 'informado', textoClave: traza.aviso.clave, textoVersion: traza.aviso.version, textoHuella: traza.aviso.huella, mensajeTexto: null, chatwootMessageId: publicadoAviso });
  } else if (traza.aviso) {
    traza.aviso = null;
  }
  const ev = r.autorizacion;
  if (ev) {
    await d.almacen.registrarConsentimiento({ llave: d.llave, canal: d.canal, tipo: ev.tipo, respuesta: ev.respuesta, textoClave: ev.texto_clave, textoVersion: ev.texto_version, textoHuella: ev.texto_huella, mensajeTexto: ev.mensaje_texto, chatwootMessageId: ev.mensaje_id ? Number(ev.mensaje_id) || null : null });
    traza.autorizacion = ev;
  }

  // Enmascarar el dato sensible o de tarjeta en nuestra base (§5.3).
  if (r.enmascarar) {
    await d.almacen.enmascarar(pend.map((f) => f.id));
    traza.enmascarados = pend.map((f) => f.id);
  }
  if (errores.length) traza.error = [traza.error, ...errores].filter(Boolean).join('; ');

  await d.almacen.cerrarTurno({ turnoId, filas: pend.map((f) => f.id), filaTraza: ultima.id, traza });
  return true;
}

/** Atiende todo lo pendiente de la conversación, con su candado. Devuelve cuántos turnos corrió este proceso. */
export async function atenderConversacion(d: DepsPublico): Promise<number> {
  const { cola } = clavesPublico(d.llave);
  let turnos = 0;
  for (let vuelta = 0; vuelta < 5; vuelta++) {
    if (!(await d.almacen.tomarCandado(cola, Math.ceil(d.config.corteTotalMs / 1000) + Math.ceil(d.config.rafagaMs / 1000) * 4 + 60))) return turnos;
    try {
      for (let i = 0; i < 10 && await unTurnoPublico(d); i++) turnos++;
    } finally {
      await d.almacen.soltarCandado(cola);
    }
    const desde = new Date(d.ahoraMs() - DIAS_DE_CONVERSACION * 24 * 3600 * 1000).toISOString();
    if (!pendientesPublico(await d.almacen.leer(d.llave, desde)).length) return turnos;
  }
  return turnos;
}

export type { SalidaTurno };
