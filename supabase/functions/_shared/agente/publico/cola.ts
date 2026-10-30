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
import type { ContextoDominio, Dominio, Modelo, Reglamento, RolTraza, Salida } from '../tipos.ts';
import { componerDominio, fichasDelTurno } from '../componer.ts';
import { ESCALAMIENTO_CHATWOOT_HOY, MOTIVO_LLANO, dentroDeHorario, equipoDe, escalamientoDe, notaComun, registrarEscalamiento, resumenTraspaso, senalDelCodigo, turnosDe } from '../persona.ts';
import type { EscalamientoChatwoot, PuertoEscalamientos } from '../persona.ts';
import type { Composicion } from '../componer.ts';
import { fuentesDeComposicion } from '../pistas.ts';
import type { FuentePistaDelTurno } from '../pistas.ts';
import type { Catalogo } from '../funciones/catalogo.ts';
import type { FuncionPrendida } from '../funciones/tipos.ts';
import {
  RF_BIENVENIDA, autorizacionEnEspera, conAviso, estadoAutorizacion, salidaAutorizacion, eventoAutorizacion, huellaTexto, motivoAviso, respuestaA, textoFijo, versionDe,
} from './autorizacion.ts';
import type { ConfigPublico } from './config.ts';
import { PAUSA_ENTRE_MENSAJES_MS, PAUSA_TRAS_FOTO_MS } from './config.ts';
import { BOT_PUBLICO, PASAR_A_PERSONA, RESPUESTA_FIJA, RF_PERSONA_POR_QUE, dominioPublico, porQueYaSalio, volvioDePersona } from './dominio.ts';
import { enlacesFueraDeLista } from './enlaces.ts';
import { preciosSinHerramienta } from './precios.ts';
import { frasesDeSobreventa } from './sobreventa.ts';
import { HERRAMIENTAS_VENTAS, sistemaPublico } from './prompt.ts';
import { CIERRES_DEL_CODIGO_VENTAS, CONFIRMAR_COMPRA, ENLACES_VENTAS, RF_PAGO_CONFIRMADO, bloqueNotaVentas, claveConfirmacionPago, dominioVentas } from './ventas/dominio-ventas.ts';
import type { PuertosVentas } from './ventas/puertos-ventas.ts';
import { demasiadosProductos, fotosDelTurno } from './ventas/fotos-ventas.ts';
import type { FotoDelTurno } from './ventas/fotos-ventas.ts';
import { planDeEnvios } from './ventas/partir-ventas.ts';
import type { Envio } from './ventas/partir-ventas.ts';
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
  /**
   * Después de cerrar cada turno: el correo si se cayó el modelo (spec 2026-10-26, §4.1; `../caida.ts`). El turno ya
   * pasó a persona y quedó cerrado; esto no lo cambia ni lo frena.
   */
  alertaCaida?: (traza: TrazaPublica, turnoId: string) => Promise<void>;
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
  /**
   * Con roles (spec 2026-10-26): las funciones del rol del inbox (ya intersecadas con las prendidas). El dominio del
   * turno es el público recortado a ellas por el componedor; `reglamento` es entonces la versión del rol. Sin esto,
   * el dominio público entero, como siempre.
   */
  funciones?: Array<string | FuncionPrendida>;
  /** El catálogo para componer (en las pruebas, uno con funciones de prueba). Sin él, el del código. */
  catalogo?: Catalogo;
  /** El rol del turno, para la traza (§2.9). */
  rol?: RolTraza | null;
  /**
   * Dónde queda cada paso a persona (`asistente_escalamientos`, spec 2026-10-26 §4.2), a mejor esfuerzo. Sin esto (el
   * arnés), no se escribe nada y el paso sale igual.
   */
  escalamientos?: PuertoEscalamientos | null;
  /**
   * Con `config.dominio = 'ventas'` (Dimpro): el catálogo de Ferretería, la pasarela del workspace y los links guardados.
   * Sin esto, un workspace de ventas no atiende (falla del turno → persona).
   */
  ventas?: PuertosVentas;
}

/** ¿Este turno es del dominio de ventas? */
const esVentas = (d: Pick<DepsPublico, 'config'>) => d.config.dominio === 'ventas';

/** El dominio del asistente: el de experiencias (Sabor) o el de ventas (Dimpro). */
export function dominioDelAsistente(d: DepsPublico, vars: Record<string, string>): Dominio {
  if (esVentas(d)) {
    if (!d.ventas) throw new Error('dominio de ventas sin sus puertos (catálogo y pasarela)');
    return dominioVentas({
      reglamento: d.reglamento, ahoraMs: d.ahoraMs, vars, puertos: d.ventas, fallar: d.fallarHerramienta,
      unaVez: (clave) => d.almacen.tomarCandado(clave, 30 * 24 * 3600),
    });
  }
  return dominioPublico({ reglamento: d.reglamento, ahoraMs: d.ahoraMs, vars, fallar: d.fallarHerramienta });
}

const DIAS_DE_CONVERSACION = 30;
/** El id del motor del asistente público en el componedor (`../funciones/tipos.ts`). */
export const MOTOR_PUBLICO = 'publico';
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

/** Lo que hace la persona del equipo después de cada motivo (la última línea de la nota). */
export const SIGUIENTE_PASO: Record<MotivoPersona, string> = {
  reserva_lista: 'confirmar cupo y enviar el pago', restriccion: 'revisar la restricción para el menú', celebracion: 'coordinar la celebración',
  grupo: 'cotizar el grupo', pide_persona: 'atender lo que pide', queja: 'atender la queja', pago: 'revisar el pago (el asistente no lo vio)',
  no_entiende: 'retomar la conversación', menor: 'pedir que escriba un adulto', crisis: 'atender ya', abuso: 'revisar la conversación',
  duda_abierta: 'contestar la duda (la ficha y las reglas no la cubren)', datos: 'atender la solicitud de datos', falla: 'contestar: el asistente falló',
  pago_no_disponible: 'enviar el link de pago a mano: el asistente no pudo crearlo', despachar: 'despachar el pedido (el pago está aprobado en Bold)',
  fuera_de_zona: 'cotizar el flete y enviar el link de pago', cantidad: 'atender el pedido de más de 3 unidades', factura: 'revisar los datos de la factura',
  garantia: 'atender la garantía o el cambio', no_en_catalogo: 'contestar por el producto (no está en el catálogo)',
};

/**
 * La nota privada con formato fijo, armada por el código. Nunca el detalle de un dato sensible. Pura. La cabecera
 * (motivo, qué pidió, qué consultó, siguiente paso) es la común (`../persona.ts`, `notaComun`); el medio es el bloque
 * de este motor (`bloqueNotaPublico`), o el que aporten las funciones del rol (`bloques`, su gancho `notaPersona`).
 */
export function notaPersona(p: {
  motivo: MotivoPersona; pidio: string; filas: FilaPublica[]; reserva: Record<string, unknown> | null; herramientas: string[]; ahoraIso: string;
  bloques?: string[][]; fueraDeHorario?: EscalamientoChatwoot['horario'];
  /** El dominio de ventas pone su bloque (el pedido y el link) en vez del de la reserva de Sabor. */
  ventas?: boolean;
}): string {
  const medio = p.ventas ? bloqueNotaVentas({ filas: p.filas, compra: p.reserva }) : bloqueNotaPublico(p);
  return notaComun({
    motivo: p.motivo, pidio: p.pidio, bloques: p.bloques?.length ? p.bloques : [medio], consulto: p.herramientas,
    siguiente: SIGUIENTE_PASO[p.motivo], fueraDeHorario: p.fueraDeHorario ?? null,
  });
}

/**
 * El bloque del medio de la nota del motor público (Sabor): la reserva, la mesa que pidió, la autorización de datos y la
 * de alimentación. Es de Sabor: cuando su sesión parta este dominio en `clientes.*`, cada parte va al gancho
 * `notaPersona` de su función (p. ej. la reserva en `clientes.toma_datos`). Pura.
 */
export function bloqueNotaPublico(p: { filas: FilaPublica[]; reserva: Record<string, unknown> | null }): string[] {
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
  return [
    `Reserva: ${reserva}`,
    ...(preferencia ? [`Preferencia de mesa: ${preferencia} (por confirmar: la asigna el equipo)`] : []),
    `Autorización de datos: ${aut}`,
    ...(alimentacion ? [`Alimentación: ${alimentacion}`] : []),
  ];
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

/**
 * Publica los envíos de un turno de ventas en orden estricto (ronda 3): textos en `respuesta`, `parte_2`…; fotos en
 * `foto_1`… Cada uno espera al anterior; tras una foto, y entre mensajes, una pausa (Chatwoot manda cada mensaje a
 * Messenger en un trabajo aparte y una foto tarda más que un texto: sin la pausa, el texto siguiente podía adelantarla).
 * Una foto que falla se anota y se sigue (su texto ya salió); un texto que no sale corta lo que sigue. Nunca lanza.
 */
async function publicarEnvios(d: DepsPublico, turnoId: string, envios: Envio[], avisoPegado: string | null, conOpciones: Salida | null = null): Promise<{ salio: boolean; primero: number | null; errores: string[]; fotos: NonNullable<TrazaPublica['fotos']> }> {
  const errores: string[] = [];
  const fotos: NonNullable<TrazaPublica['fotos']> = [];
  let primero: number | null = null;
  let salio = false;
  let textos = 0;
  let nFotos = 0;
  const ultimoTexto = envios.map((e) => e.tipo).lastIndexOf('texto');
  for (const [i, e] of envios.entries()) {
    if (i > 0) await d.dormir(envios[i - 1].tipo === 'foto' && fotos.at(-1)?.ok ? PAUSA_TRAS_FOTO_MS : envios[i - 1].tipo === 'texto' ? PAUSA_ENTRE_MENSAJES_MS : 0);
    if (e.tipo === 'texto') {
      textos++;
      // Los botones del modelo, en el último texto (el de la pregunta).
      const s: Salida = i === ultimoTexto && conOpciones ? { ...conOpciones, texto: e.texto } : { tipo: 'texto', texto: e.texto };
      const p = await publicarEn(d, turnoId, textos === 1 ? 'respuesta' : `parte_${textos}`, textos === 1 && avisoPegado ? conAviso(avisoPegado, s) : s);
      if (!p.ok) { errores.push(`${textos === 1 ? 'respuesta' : `parte_${textos}`}: ${p.motivo}`); break; }
      if (textos === 1) { salio = true; primero = p.id; }
      continue;
    }
    nFotos++;
    fotos.push(await publicarUnaFoto(d, turnoId, `foto_${nFotos}`, e.foto, e.pie));
  }
  return { salio, primero, errores, fotos };
}

async function publicarUnaFoto(d: DepsPublico, turnoId: string, ranura: string, f: FotoDelTurno, pie: boolean): Promise<NonNullable<TrazaPublica['fotos']>[number]> {
  try {
    // En la conversación queda el pie (el modelo ve en el historial que la foto salió), no la URL.
    const id = await d.almacen.reservarSalida({ llave: d.llave, canal: d.canal, turnoId, ranura, salida: { tipo: 'texto', texto: `[Foto] ${f.texto}` } });
    if (!id) return { codigo: f.codigo, ok: false, motivo: 'ranura ya tomada' };
    const r = await d.mensajero.publicarFoto(d.llave, { url: f.url, texto: pie ? f.texto : '' });
    await d.almacen.marcarSalida(id, r.ok ? { estado: 'publicado', chatwootMessageId: r.id } : { estado: r.incierto ? 'incierto' : 'fallido' });
    return r.ok ? { codigo: f.codigo, ok: true } : { codigo: f.codigo, ok: false, motivo: r.motivo.slice(0, 160) };
  } catch (e) {
    return { codigo: f.codigo, ok: false, motivo: String(e).slice(0, 160) };
  }
}

/** Publica las fotos de un turno de ventas, cada una en su ranura (`foto_1`…), con su pie. Nunca lanza. */
async function publicarFotos(d: DepsPublico, turnoId: string, fotos: FotoDelTurno[]): Promise<NonNullable<TrazaPublica['fotos']>> {
  const out: NonNullable<TrazaPublica['fotos']> = [];
  for (const [i, f] of fotos.entries()) out.push(await publicarUnaFoto(d, turnoId, `foto_${i + 1}`, f, true));
  return out;
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
  reglamento: { id: d.reglamento.id, version: d.reglamento.version, huella: d.reglamento.huella }, ...(d.rol ? { rol: d.rol } : {}), canal: d.canal, ...extra,
});

function ctxDe(d: DepsPublico, filas: FilaPublica[]): ContextoDominio {
  const resultadosPrevios = filas.flatMap((f) => (f.traza?.herramientas ?? [])
    .filter((h) => h.ok && !['responder', 'proponer', PASAR_A_PERSONA, RESPUESTA_FIJA].includes(h.nombre))
    .map((h) => ({ herramienta: h.nombre, args: h.args, datos: h.datos, privado: h.privado })));
  return { workspaceId: d.llave.workspaceId, phone: llaveTexto(d.llave), remitente: REMITENTE, conversacion: filas, resultadosPrevios };
}

/** El dominio público entero y, con un rol, su composición (motor `publico`). Pura. */
function composicionPublica(d: DepsPublico, log?: (m: string) => void): { base: Dominio; c: Composicion | null } {
  const base = dominioDelAsistente(d, varsDe(d));
  if (!d.funciones) return { base, c: null };
  return {
    base,
    c: componerDominio({ motores: { [MOTOR_PUBLICO]: base }, funciones: d.funciones, ...(d.catalogo ? { catalogo: d.catalogo } : {}), ...(log ? { log } : {}) }),
  };
}

/**
 * Las funciones del rol que aportan pistas a la transcripción (spec 2026-10-26, §4.6): solo con
 * `transcripcion.pistas = true` y un rol. Apagado, `undefined`: el transcriptor recibe lo mismo que antes.
 */
export function fuentesDePistasDelTurno(d: DepsPublico): FuentePistaDelTurno[] | undefined {
  if (d.config.transcripcion?.pistas !== true || !d.funciones) return undefined;
  // Sin log: lo que el componedor deja fuera ya lo anota el turno del modelo.
  const { c } = composicionPublica(d, () => {});
  return c ? fuentesDeComposicion(c) : undefined;
}

/**
 * El dominio y el reglamento del turno: el público entero o, con un rol, recortado a sus funciones por el componedor
 * (motor `publico`). El reglamento del rol pierde las fichas de las funciones que no tiene.
 */
export function dominioYReglamento(d: DepsPublico): { dominio: Dominio; reglamento: Reglamento } {
  const { base, c } = composicionPublica(d);
  if (!c) return { dominio: base, reglamento: d.reglamento };
  // La huella se queda la de la versión publicada (la traza dice qué versión atendió; lo recortado es función de ella).
  return { dominio: c.dominio, reglamento: { ...d.reglamento, fichas: fichasDelTurno(d.reglamento.fichas, c, d.catalogo ? { catalogo: d.catalogo } : {}) } };
}

/**
 * Con un rol: lo que la ficha `rol.escalamiento` dice del paso a persona (equipo por motivo, horario, umbrales) y los
 * bloques de la nota que aportan sus funciones (gancho `notaPersona`). Sin rol, lo de siempre (el equipo de
 * `config_extra`, sin horario, el bloque de Sabor).
 */
function personaDelRol(d: DepsPublico): { escalamiento: EscalamientoChatwoot; bloques: (ctx: { motivo: string; pidio: string; filas: FilaPublica[]; reserva: Record<string, unknown> | null }) => string[][] } {
  if (!d.funciones) return { escalamiento: ESCALAMIENTO_CHATWOOT_HOY, bloques: () => [] };
  const base = dominioPublico({ reglamento: d.reglamento, ahoraMs: d.ahoraMs, vars: varsDe(d) });
  const c = componerDominio({ motores: { [MOTOR_PUBLICO]: base }, funciones: d.funciones, ...(d.catalogo ? { catalogo: d.catalogo } : {}), log: () => {} });
  return {
    escalamiento: escalamientoDe(d.reglamento, ESCALAMIENTO_CHATWOOT_HOY),
    bloques: (x) => c.funciones.filter((f) => f.notaPersona).map((f) => f.notaPersona!({ ...x, parametros: c.parametros[f.clave] ?? {} })),
  };
}

function depsTurno(d: DepsPublico, turnoMs: number): DepsTurno {
  const dr = dominioYReglamento(d);
  return {
    modelo: d.modelo,
    dominio: dr.dominio,
    reglamento: dr.reglamento,
    ...(d.rol ? { rol: d.rol } : {}),
    config: configNucleo(d.config, turnoMs),
    ahoraMs: d.ahoraMs,
    reloj: d.reloj,
    sistema: (r, c) => sistemaPublico(r, c, esVentas(d) ? { herramientas: HERRAMIENTAS_VENTAS } : {}),
    // Plata solo de herramienta: vuelve al modelo una vez para que corrija (Yuto, 2026-10-21). La guarda del final
    // (antes de publicar) queda igual: nunca sale un monto que no devolvió una herramienta.
    // Más los candados contra la sobreventa de §8.4 (confirmación, escasez, condiciones sumadas o no listadas).
    guardaTexto: (texto, herramientas) => [
      ...preciosSinHerramienta(texto, herramientas)
        .map((x) => `el monto ${x} no viene de ver_catalogo/ver_funciones; no lo repitas, usa el precio de la herramienta o di que no lo puedes confirmar`),
      ...frasesDeSobreventa(texto, herramientas),
      // Ventas: nunca más de 3 productos en una respuesta (venta consultiva, Mauricio 29-oct).
      ...(esVentas(d) ? demasiadosProductos(texto) : []),
    ],
  };
}

/** Lo que el turno del modelo dejó para el código (los cierres del dominio con su `privado`). Pura. */
export function efectosDelTurno(t: TrazaPublica): { persona: { motivo: MotivoPersona; pidio: string } | null; pide: 'general' | 'sensible' | null; enmascarar: boolean; preferencia: string | null; confirmar?: string | null } {
  let persona: { motivo: MotivoPersona; pidio: string } | null = null;
  let confirmar: string | null = null;
  let pide: 'general' | 'sensible' | null = null;
  let enmascarar = false;
  let preferencia: string | null = null;
  for (const h of t.herramientas ?? []) {
    if (!h.ok) continue;
    const pv = (h.privado ?? {}) as { persona?: { motivo: MotivoPersona; pidio: string }; pide_autorizacion?: 'general' | 'sensible'; enmascarar?: boolean; preferencia_mesa?: string; confirmar?: string };
    if (h.nombre === CONFIRMAR_COMPRA && typeof pv.confirmar === 'string') confirmar = pv.confirmar;
    // `pasar_a_persona` y, en ventas, `verificar_pago` (pago aprobado → despachar) o `generar_link_pago` sin pasarela.
    if (pv.persona) persona = pv.persona;
    if (h.nombre === RESPUESTA_FIJA) {
      if (pv.pide_autorizacion) pide = pv.pide_autorizacion;
      if (pv.enmascarar) enmascarar = true;
      if (pv.preferencia_mesa) preferencia = pv.preferencia_mesa;
    }
  }
  return { persona, pide, enmascarar, preferencia, ...(confirmar ? { confirmar } : {}) };
}

/**
 * Lo que la persona necesita saber cuando el turno de ventas se quedó sin llamados: el último pedido que se intentó
 * armar (con sus datos) y por qué no salió. Pura.
 */
export function pidioTrasTope(t: TrazaPublica): string {
  const ultimo = (t.herramientas ?? []).filter((h) => h.nombre === 'proponer').at(-1);
  if (!ultimo) return 'el asistente no logró responder en este turno; revisar el chat';
  const crudo = (ultimo.args as { datos?: unknown } | undefined)?.datos;
  const datos = typeof crudo === 'string' ? crudo : JSON.stringify(crudo ?? {});
  return `no logré armar el pedido; lo último que intenté: ${datos.slice(0, 400)} (motivo: ${String(ultimo.error ?? '?').slice(0, 160)})`;
}

/** El título del botón «sí» de la propuesta, escrito por el cliente (sin tildes, mayúsculas ni puntuación). Pura. */
export function esTituloDelSi(texto: string | null | undefined, titulo: string): boolean {
  const n = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const t = n(String(texto ?? ''));
  return !!t && t === n(titulo);
}

/**
 * Confirma una propuesta por su huella (el toque del botón, el «sí» escrito o, en ventas, `confirmar_compra` del modelo):
 * el núcleo la ejecuta una sola vez y el dominio dice si pasa a persona.
 */
async function confirmarPropuesta(d: DepsPublico, turnoId: string, filas: FilaPublica[], nuevos: FilaPublica[], t: { huella: string; si: boolean }, tipo: 'toque_propuesta' | 'si_escrito', extra: Partial<TrazaPublica> = {}): Promise<Resultado> {
  const dt = depsTurno(d, d.config.corteTotalMs);
  const rt = await toqueDePropuesta({ ...dt, almacen: d.almacen }, { turnoId, filas, nuevos, ctx: ctxDe(d, filas) }, t, tipo);
  const traza: TrazaPublica = { ...rt.traza, ...extra, canal: d.canal };
  const ej = rt.traza.ejecucion;
  const persona = ej?.resultado === 'ejecutada' && (ej.escrituras ?? []).some((e) => e.tipo === 'persona');
  const esc = persona ? (ej!.escrituras ?? []).find((e) => e.tipo === 'persona') : undefined;
  const reserva = esc ? (esc.datos as Record<string, unknown>) : null;
  // El motivo lo dice la escritura del dominio (Sabor: reserva_lista; ventas: pago_no_disponible).
  const motivoEsc = (esc?.motivo as MotivoPersona | undefined) ?? 'reserva_lista';
  const pidio = motivoEsc === 'reserva_lista' ? 'reservar (confirmó el resumen)' : `confirmó la compra; ${String((reserva as { error?: unknown } | null)?.error ?? 'sin link de pago')}`;
  return { salida: rt.salida, traza, reserva, persona: persona ? { motivo: motivoEsc, pidio } : null };
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
  if (des.tipo === 'respuesta' && esVentas(d) && des.r.traza.error === 'tope de llamados sin respuesta') {
    // Ventas (30-oct): el tope de llamados sin respuesta ya no sale como «¿Me lo escribes de nuevo?» (el cliente sí lo
    // había escrito; el error era del modelo). Pasa a una persona con lo último que se intentó proponer: la compra no se
    // pierde.
    const t: TrazaPublica = { ...(des.r.traza as TrazaPublica), ...base, respuesta_fija: 'rf.persona.falla' };
    return { salida: fija(d, 'rf.persona.falla'), traza: t, persona: { motivo: 'falla', pidio: pidioTrasTope(t) } };
  }
  if (des.tipo === 'respuesta') {
    const ef0 = efectosDelTurno(des.r.traza as TrazaPublica);
    // Ventas: el cliente aceptó con palabras el pedido vigente y el modelo llamó confirmar_compra → como el toque.
    if (ef0.confirmar) {
      const t0 = des.r.traza as TrazaPublica;
      return confirmarPropuesta(d, turnoId, filas, pend, { huella: ef0.confirmar, si: true }, 'si_escrito', {
        ...base, herramientas: t0.herramientas, uso: t0.uso, llamados: t0.llamados, ms_modelo: t0.ms_modelo, candados: t0.candados,
      });
    }
    // La mesa queda en el estado como PREFERENCIA (§8.4.2): en la traza del turno, nunca como asignación.
    const t: TrazaPublica = { ...des.r.traza, ...base, ...(ef0.preferencia ? { preferencia_mesa: ef0.preferencia } : {}) };
    const ef = ef0;
    const reserva = t.propuesta ? t.propuesta.datos : null;
    return { salida: des.r.salida, extras: des.r.extras, traza: t, persona: ef.persona, pide: ef.pide, enmascarar: ef.enmascarar, reserva, delModelo: !t.respuesta_fija && !ef.pide && !ef.persona && !ef.enmascarar && !(t.herramientas ?? []).some((h) => h.ok && (h.nombre === RESPUESTA_FIJA || h.nombre === PASAR_A_PERSONA || CIERRES_DEL_CODIGO_VENTAS.includes(h.nombre))) };
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
      const fuentesDePistas = fuentesDePistasDelTurno(d);
      for (const a of audios) {
        const t = await d.transcriptor.transcribir({ url: a.adjunto!.url!, extension: a.adjunto?.extension, ...(fuentesDePistas ? { fuentesDePistas } : {}) });
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
  // Ventas (30-oct): el título del botón escrito tal cual («Sí, enviar link») es el mismo toque, sin modelo.
  const escritoSi = (t: string | null | undefined) => esSiSolo(t) || (esVentas(d) && !!vig && esTituloDelSi(t, vig.si));
  if (solo && ((toque && toque.clase === 'propuesta') || (vig && solo.clase === 'escrito' && escritoSi(solo.texto)))) {
    const t = toque && toque.clase === 'propuesta' ? toque : { huella: vig!.huella, si: true };
    return confirmarPropuesta(d, turnoId, filas, [solo], t, toque ? 'toque_propuesta' : 'si_escrito');
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

const tituloNormal = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();

/**
 * Messenger por Chatwoot (30-oct, medido en vivo): el botón (`input_select`) sale como respuesta rápida y, al tocarlo,
 * llega como TEXTO con el título de la opción, sin `submitted_values` ni el id (toque_id null). Mauricio tocó «Sí, enviar
 * link» dos veces y el pedido nunca se confirmó. Invariante del código, no del modelo: en ese canal, un mensaje pendiente
 * cuyo texto es igual (sin mayúsculas, tildes, espacios ni signos) al título de una opción de la ÚLTIMA salida del bot con
 * opciones es el toque de esa opción (su id). Si el toque trae su id (`submitted_values`), manda el id. Lo que pase con
 * un botón viejo lo decide la lógica del toque, como con uno tocado. Solo en memoria (la fila guardada no cambia). Pura.
 */
export function toquesPorTitulo(filas: FilaPublica[], canal: Canal): FilaPublica[] {
  if (canal !== 'otro') return filas;
  let ultima: FilaPublica | null = null;
  const out = filas.map((f) => {
    if (f.direccion === 'saliente' && !(f.ranura ?? '').startsWith('nota') && (f.opciones ?? []).length) { ultima = f; return f; }
    if (f.direccion !== 'entrante' || f.turno_id || f.clase !== 'escrito' || f.toque_id || !f.texto || !ultima) return f;
    const t = tituloNormal(f.texto);
    const op = t ? (ultima as FilaPublica).opciones!.find((o) => tituloNormal(o.titulo) === t) : undefined;
    return op ? { ...f, clase: 'toque' as const, toque_id: op.id } : f;
  });
  return out;
}

/** Un turno: atiende lo pendiente. Devuelve false si no había nada. */
export async function unTurnoPublico(d: DepsPublico): Promise<boolean> {
  const desde = () => new Date(d.ahoraMs() - DIAS_DE_CONVERSACION * 24 * 3600 * 1000).toISOString();
  const leer = async () => toquesPorTitulo(await d.almacen.leer(d.llave, desde()), d.canal);
  let filas = await leer();
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
    filas = await leer();
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
    filas = await leer();
    pend = pendientesPublico(filas);
  }
  if (esperaAudio) tramos.transcripcion_ms = esperaAudio;

  let r: Resultado | null = null;
  let regenerado = 0;
  for (;;) {
    r = await decidir(d, turnoId, filas, pend, tramos);
    // 8a. ¿Entró otro mensaje mientras generaba? Se descarta el borrador y se regenera con todo (§3.4), hasta 2 veces.
    if (!r.salida || regenerado >= 2 || r.persona) break;
    const ahora = await leer();
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
    const fuera = enlacesFueraDeLista(texto, [d.config.terminosUrl, ...d.config.enlacesPermitidos, ...(esVentas(d) ? ENLACES_VENTAS : [])]);
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

  // Los botones que el modelo arma no pueden repetir los del pedido vigente (30-oct, Dimpro: el modelo sacó su propio
  // «Sí, enviar link / Corregir» con ids de conversación; tocados, no confirmaban nada). Esos títulos se quitan.
  if (salida && salida === r.salida && r.delModelo && 'opciones' in salida) {
    const vigP = propuestaVigente(filas);
    const choque = new Set(vigP ? [vigP.si, vigP.no].map(tituloNormal) : []);
    const quedan = salida.opciones.filter((o) => !choque.has(tituloNormal(o.titulo)));
    if (quedan.length !== salida.opciones.length) {
      traza.candados = [...(traza.candados ?? []), { candado: 'botones_de_la_propuesta', detalle: salida.opciones.map((o) => o.titulo).join(' | ') }];
      salida = quedan.length ? { ...salida, opciones: quedan } : { tipo: 'texto', texto: salida.texto };
    }
  }

  // Ventas: las fotos de los productos que nombró la respuesta del modelo (las decide el código; nunca bloquean).
  let fotos: FotoDelTurno[] = [];
  // Ronda 3 (30-oct): el texto del modelo se publica partido por producto, con su foto justo después (`partir-ventas.ts`).
  let textoVentas: string | null = null;
  let conOpciones: Salida | null = null;
  if (esVentas(d) && d.ventas && salida && salida === r.salida && r.delModelo && !persona && !traza.propuesta) {
    // Con botones del modelo (p. ej. «Inalámbrico | De cable») también se parte: los botones van en el último texto.
    if (salida.tipo !== 'enlace') { textoVentas = salida.texto; conOpciones = 'opciones' in salida ? salida : null; }
    try {
      fotos = fotosDelTurno({
        texto: salida.texto, herramientas: traza.herramientas, catalogo: await d.ventas.catalogo(), filas,
        pedido: pend.map((f) => f.texto ?? '').join(' '),
      });
    } catch (e) {
      console.error('[asistente-ventas] no se pudieron elegir las fotos:', String(e).slice(0, 120));
    }
  }

  // Con un rol, la señal del código (§4.2): dos «no pude» seguidos o tres correcciones de lo mismo pasan a persona
  // (en Chatwoot se pasa directo, sin ofrecer). Sin rol, Sabor sigue como siempre.
  const delRol = personaDelRol(d);
  let delCodigo: 'no_pude' | 'bucle' | null = null;
  if (d.funciones && !persona) {
    delCodigo = senalDelCodigo(turnosDe(filas), { ...traza, salida }, delRol.escalamiento.umbrales);
    if (delCodigo) persona = { motivo: 'no_entiende', pidio: `señal del código: ${MOTIVO_LLANO[delCodigo]}` };
  }

  // El aviso de bot y términos (§5.1): pegado a la primera respuesta que sale.
  const motivo = salida ? motivoAviso(filas, new Set(pend.map((f) => f.id)), d.ahoraMs(), d.config.pausaLargaHoras) : null;
  let avisoAparte: Salida | null = null;
  let avisoPegado: string | null = null;
  if (salida && motivo) {
    const textoAviso = textoFijo(d.reglamento, RF_BIENVENIDA, varsDe(d));
    traza.aviso = { clave: RF_BIENVENIDA, version: versionDe(d.reglamento, RF_BIENVENIDA), huella: await huellaTexto(textoAviso), motivo };
    const junto = conAviso(textoAviso, salida);
    // Botones: el cuerpo va hasta 1024 en WhatsApp. Si no cabe, el aviso sale aparte, antes (nunca se corta el resumen).
    if (junto.tipo !== 'texto' && [...junto.texto].length > 1024) avisoAparte = { tipo: 'texto', texto: textoAviso };
    else { salida = junto; avisoPegado = textoAviso; }
  }

  // 8c. Ventana del canal y que la conversación siga en pending.
  // Ventas: los textos del plan sin fotos (si no se parte, uno; con varios productos y sin fotos, también uno).
  let envios: Envio[] | null = textoVentas !== null ? planDeEnvios(textoVentas, []) : null;
  const textosDe = (es: Envio[] | null) => (es ? es.filter((e) => e.tipo === 'texto').length : 1);
  const cuantos = (salida ? textosDe(envios) : 0) + extras.length + (avisoAparte ? 1 : 0);
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
    // Las fotos solo si caben en la ventana junto con el texto (TikTok cuenta los mensajes seguidos); si no, no salen.
    // Con las fotos, el texto puede salir partido en más mensajes: cuentan todos.
    const conFotos = textoVentas !== null && fotos.length ? planDeEnvios(textoVentas, fotos) : null;
    const masTextos = conFotos ? textosDe(conFotos) - textosDe(envios) : 0;
    if (salida && fotos.length && !ventana({ canal: d.canal, anuncio7Dias: d.anuncio7Dias, filas, ahoraMs: d.ahoraMs(), cuantos: cuantos + fotos.length + masTextos }).abierta) {
      traza.fotos = fotos.map((f) => ({ codigo: f.codigo, ok: false, motivo: 'no caben en la ventana del canal' }));
      fotos = [];
    } else if (conFotos) envios = conFotos;
  }
  if (!salida) envios = null;

  // 9. Publicar.
  const tp = d.reloj();
  let publicadoAviso: number | null = null;
  const errores: string[] = [];
  if (avisoAparte) {
    const a = await publicarEn(d, turnoId, 'aviso', avisoAparte);
    if (a.ok) publicadoAviso = a.id; else errores.push(`aviso: ${a.motivo}`);
  }
  if (salida && envios && (envios.length > 1 || envios[0]?.tipo !== 'texto' || envios[0].texto !== textoVentas)) {
    // Ventas, en orden estricto: cada envío espera al anterior (y a la pausa tras una foto). El aviso de bot va pegado
    // al primer texto. Si un texto no sale, lo que sigue tampoco (no queda una foto sin su texto ni un hueco).
    const r9 = await publicarEnvios(d, turnoId, envios, avisoPegado, conOpciones);
    if (r9.salio) { if (!avisoAparte) publicadoAviso = r9.primero; }
    errores.push(...r9.errores);
    if (r9.fotos.length) traza.fotos = r9.fotos;
    for (const [i, x] of extras.entries()) {
      const e = await publicarEn(d, turnoId, `extra_${i + 1}`, x);
      if (!e.ok) errores.push(`extra: ${e.motivo}`);
    }
    if (r9.salio) {
      tramos.publicacion_ms = Math.round(d.reloj() - tp);
      tramos.interno_ms = Math.max(0, Math.round(d.ahoraMs() - Date.parse(ultima.created_at) - (tramos.rafaga_ms ?? 0)));
    }
  } else if (salida) {
    const p = await publicarEn(d, turnoId, 'respuesta', salida);
    if (p.ok) { if (!avisoAparte) publicadoAviso = p.id; } else errores.push(`respuesta: ${p.motivo}`);
    for (const [i, x] of extras.entries()) {
      const e = await publicarEn(d, turnoId, `extra_${i + 1}`, x);
      if (!e.ok) errores.push(`extra: ${e.motivo}`);
    }
    if (p.ok) {
      tramos.publicacion_ms = Math.round(d.reloj() - tp);
      tramos.interno_ms = Math.max(0, Math.round(d.ahoraMs() - Date.parse(ultima.created_at) - (tramos.rafaga_ms ?? 0)));
      // Las fotos, después del texto: si una falla, se anota y sigue (el texto ya salió).
      if (fotos.length) traza.fotos = await publicarFotos(d, turnoId, fotos);
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
    const esc = delRol.escalamiento;
    const fuera = !dentroDeHorario(esc.horario, d.ahoraMs()) ? esc.horario : null;
    const paso: PasoAPersona = {
      motivo: persona.motivo, etiqueta: ETIQUETA_MOTIVO[persona.motivo], equipo: equipoDe(esc, persona.motivo, d.config.equipos),
      nota: notaPersona({
        motivo: persona.motivo, pidio: persona.pidio, filas: filasNota, reserva, herramientas, ahoraIso: new Date(d.ahoraMs()).toISOString(),
        bloques: delRol.bloques({ motivo: persona.motivo, pidio: persona.pidio, filas: filasNota, reserva }), fueraDeHorario: fuera, ventas: esVentas(d),
      }),
    };
    traza.persona = paso;
    errores.push(...(await pasarAPersona(d, turnoId, paso)));
    // Fuera del horario de la ficha: si el reglamento trae qué decirle, sale aparte (el paso ya quedó hecho).
    const textoFuera = fuera ? textoFijo(d.reglamento, 'rf.persona.fuera_de_horario', varsDe(d)) : '';
    if (fuera && textoFuera && d.reglamento.fichas.some((f) => f.clave === 'rf.persona.fuera_de_horario')) {
      const e = await publicarEn(d, turnoId, 'fuera_de_horario', { tipo: 'texto', texto: textoFuera });
      if (!e.ok) errores.push(`extra: ${e.motivo}`);
    }
    // La fila de `asistente_escalamientos` (a mejor esfuerzo: si falla, el paso ya salió).
    const resumen = resumenTraspaso(persona.motivo, persona.pidio);
    const motivoFila = delCodigo ?? persona.motivo;
    traza.escalamiento = { modo: 'pasado', motivo: motivoFila, senal: delCodigo ? 'codigo' : 'modelo', resumen };
    await registrarEscalamiento(d.escalamientos, {
      workspace_id: d.llave.workspaceId, rol_clave: d.rol?.clave ?? BOT_PUBLICO, canal: 'chatwoot', conversacion: `cw:${llaveTexto(d.llave)}`,
      motivo: motivoFila, resumen, modo: 'pasado',
    });
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
  if (d.alertaCaida) await d.alertaCaida(traza, turnoId).catch((err) => console.error('[asistente] alerta de caída:', err));
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

/**
 * El pago de un link de ventas quedó aprobado (lo avisa el webhook de Bold del workspace, después de registrar la venta):
 * el asistente le confirma al cliente y pasa a persona con `despachar`. Una sola vez por link, con la misma clave que
 * `verificar_pago` (si el cliente ya dijo «ya pagué» y se confirmó, esto no repite nada). Al cliente solo se le escribe
 * si la conversación sigue con el bot (`pending`) y la ventana del canal está abierta; la nota, la etiqueta y el paso a
 * persona van siempre.
 */
export async function avisarPagoAprobado(d: DepsPublico, referencia: string): Promise<'hecho' | 'ya' | 'fallo'> {
  const clave = claveConfirmacionPago(d.llave.workspaceId, referencia);
  if (!(await d.almacen.tomarCandado(clave, 30 * 24 * 3600))) return 'ya';
  const desde = new Date(d.ahoraMs() - DIAS_DE_CONVERSACION * 24 * 3600 * 1000).toISOString();
  const filas = await d.almacen.leer(d.llave, desde);
  const turnoId = d.nuevoId();
  const traza: TrazaPublica = { ...sinTurno(d, { respuesta_fija: RF_PAGO_CONFIRMADO }), tipo: 'sin_turno' };
  const salida = fija(d, RF_PAGO_CONFIRMADO);
  const v = ventana({ canal: d.canal, anuncio7Dias: d.anuncio7Dias, filas, ahoraMs: d.ahoraMs(), cuantos: 1 });
  const estado = v.abierta ? await d.mensajero.estado(d.llave) : null;
  const errores: string[] = [];
  let filaTraza: string | null = null;
  if (v.abierta && (estado === null || estado === 'pending')) {
    const p = await publicarEn(d, turnoId, 'respuesta', salida);
    if (p.ok) traza.salida = salida; else errores.push(`respuesta: ${p.motivo}`);
  } else {
    traza.sin_publicar = !v.abierta ? `ventana: ${v.motivo}` : `la conversación está en «${estado}»: la tiene una persona`;
  }
  if (errores.length) {
    // Chatwoot no aceptó la confirmación: se suelta el candado para que «ya pagué» (o el próximo aviso) lo intente.
    await d.almacen.soltarCandado(clave);
    console.error(`[asistente] el aviso del pago ${referencia} no salió: ${errores.join('; ')}`);
    return 'fallo';
  }
  const pidio = `pagó el link ${referencia} (aviso de Bold; la venta ya quedó registrada en ONE)`;
  const paso: PasoAPersona = {
    motivo: 'despachar', etiqueta: ETIQUETA_MOTIVO.despachar, equipo: equipoDe(ESCALAMIENTO_CHATWOOT_HOY, 'despachar', d.config.equipos),
    nota: notaPersona({ motivo: 'despachar', pidio, filas, reserva: null, herramientas: [], ahoraIso: new Date(d.ahoraMs()).toISOString(), ventas: true }),
  };
  traza.persona = paso;
  const fallasPaso = await pasarAPersona(d, turnoId, paso);
  if (fallasPaso.includes('toggle_status') || fallasPaso.some((x) => x.startsWith('nota:'))) {
    // Sin la nota o sin abrir la conversación, el equipo no se entera: se suelta para reintentar.
    await d.almacen.soltarCandado(clave);
    console.error(`[asistente] el paso a persona del pago ${referencia} no salió: ${fallasPaso.join('; ')}`);
    return 'fallo';
  }
  errores.push(...fallasPaso);
  await registrarEscalamiento(d.escalamientos, {
    workspace_id: d.llave.workspaceId, rol_clave: d.rol?.clave ?? BOT_PUBLICO, canal: 'chatwoot', conversacion: `cw:${llaveTexto(d.llave)}`,
    motivo: 'despachar', resumen: resumenTraspaso('despachar', pidio), modo: 'pasado',
  });
  if (errores.length) traza.error = errores.join('; ');
  // La traza queda en la fila de lo que salió (o en la de la nota): así el turno siguiente sabe que ya pasó por `despachar`.
  const ultimas = await d.almacen.leer(d.llave, desde);
  filaTraza = ultimas.filter((f) => f.direccion === 'saliente' && f.turno_id === turnoId).at(-1)?.id ?? null;
  if (filaTraza) await d.almacen.cerrarTurno({ turnoId, filas: [], filaTraza, traza });
  return 'hecho';
}

export type { SalidaTurno };
