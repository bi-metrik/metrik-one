// ============================================================
// Núcleo conversacional — el dominio de la bandeja de solicitudes (Trappvel primero)
// ------------------------------------------------------------
// Las dos lecturas (`buscar`, `ver_viaje`) y los seis ejecutores de `proponer` (`viaje_nuevo`, `cargar_tanda`,
// `anotar_en_viaje`, `crear_cliente`, `descartar`, `perfil_contacto`), con sus candados en código (§3.5):
//   · cliente nuevo: llave escrita en la conversación + guardián (llave de otro, parecidos por nombre); crear exige [Crear];
//   · escribir solo en un viaje nombrado: su código está en un escrito del comercial, en una opción que él tocó, o es el
//     viaje que se acaba de abrir con su toque;
//   · lo reenviado es dato: un reenvío nunca nombra un viaje para escribir ni dicta el texto a anotar;
//   · la búsqueda que falla dice «no pude revisar», nunca «no existe»;
//   · el perfil del contacto (2026-10-12): sin autorización vigente no se guarda nada; lo sensible, los juicios y los
//     nombres de menores (las marcas del modelo) no entran; lo explícito exige [Guardar] y lo que trae una carga entra
//     como sugerido con el mismo toque;
//   · un viaje nuevo nace con quien lo lleva (2026-10-16, Trappvel): sin responsable elegido no hay propuesta, y el
//     elegido tiene que ser del equipo comercial activo del workspace. Quién es lo interpreta el modelo («la llevo yo»,
//     «Ale», un audio); el código solo valida a quién nombró y lo vuelve a validar al escribir.
// La base la toca un `PuertoBandeja` (producción: `puerto-supabase.ts`; pruebas y arnés: `memoria.ts`).
// ============================================================

import { llavesDelTexto, tieneLlave } from '../../wa-cliente-reglas.ts';
import type { FichaCliente, Llave } from '../../wa-cliente-reglas.ts';
import { normal } from '../verificador.ts';
import { propuestaVigente } from '../nucleo.ts';
import { adjuntosDe, cargaDelViaje, filasDelViaje, mismoEntendido, nombramientos, partirCarga, pedidoDeTanda, preguntasPrevias, textoParaCarga } from './carga.ts';
import type { AdjuntoCarga, OpcionesCarga } from './carga.ts';
import { esAdjuntoEntrante, preparadorDeAdjuntos, sinLectura } from '../adjuntos.ts';
import type { PuertoAdjuntos } from '../adjuntos.ts';
import type { Lector } from '../one/lectura-adjunto.ts';
import { codigosCanonicos, resolverCodigo, resolverSueltos } from './codigo.ts';
import { salidasLinkAutorizacion, type AutorizacionAgente } from './autorizacion.ts';
import {
  DIMENSIONES_PERFIL, ETIQUETA_DIMENSION, esquemaHecho, lineaHecho, planGuardado, separarHechos, textoComparable,
} from '../../perfil-contacto.ts';
import type { HechoExistente, HechoFuera, HechoPerfil, OrigenPerfil } from '../../perfil-contacto.ts';
import type { PlanCarga } from './carga.ts';
import type { ContextoDominio, DeclaracionHerramienta, Dominio, FilaConversacion, Hechos, Propuesta, RegistroConversacion, ResultadoHerramienta } from '../tipos.ts';

export interface ViajeAgente {
  id: string;
  codigo: string;
  nombre: string;
  cliente: string | null;
  destino: string | null;
  abierto: boolean;
  faltaCotizar: string[];
  faltaCompleto: string[];
  /** Hay una carga en vuelo sobre este viaje. */
  enVuelo?: boolean;
  /** Lo que el viaje tiene, por etiqueta y legible (`registradoDe`): respalda «está registrada…». */
  registrado?: Record<string, string>;
  /** El contacto del viaje (a su perfil va lo de la persona que traiga una carga). */
  contactoId?: string | null;
}

/** Un hecho del perfil con la fila de la conversación de donde salió (`origen_ref`). */
export type HechoConOrigen = HechoPerfil & { origenRef: string };

/** Lo que devuelve `prepararCarga`: lo que cambiaría, lo que faltaría, la duda de la extracción y el plan del toque. */
export interface CargaPreparada { entendido: string[]; falta: string[]; duda?: string; dudaCampo?: string; plan: unknown }

/** Una persona que puede llevar un viaje: staff ACTIVO del workspace con área comercial. */
export interface MiembroEquipo {
  /** `staff.id`. */
  id: string;
  nombre: string;
  /** Es quien está escribiendo («la llevo yo»). */
  esQuienEscribe: boolean;
}

export interface PuertoBandeja {
  /** Nombre de la línea donde abre viajes («Viaje a medida»). */
  linea(): Promise<string>;
  /**
   * Quiénes pueden llevar un viaje: el staff activo del workspace con área comercial, sin el staff de prueba
   * (`config_extra.staff_de_prueba`) salvo que quien escribe sea de prueba. `'error'`: no se pudo leer.
   */
  equipoComercial(): Promise<MiembroEquipo[] | 'error'>;
  porNombre(texto: string): Promise<FichaCliente[] | null>;
  porLlave(llave: Llave): Promise<FichaCliente[] | null>;
  /** `null`: no hay viaje con ese código. `'error'`: no se pudo consultar. */
  viaje(codigo: string): Promise<ViajeAgente | null | 'error'>;
  /**
   * Cuáles de estos códigos (con espacios) existen en el workspace: resuelve un código escrito sin espacios («m1261»)
   * contra los que hay, sin adivinar. `'error'`: no se pudo consultar.
   */
  codigosExistentes(candidatos: string[]): Promise<string[] | 'error'>;
  /** Abre el viaje con su responsable. Lanza si `responsableId` ya no es del equipo comercial (se valida al escribir). */
  crearViaje(p: { contactoId: string; destino: string | null; responsableId: string }): Promise<{ id: string; codigo: string; nombre: string }>;
  /**
   * La extracción de hoy, sin escribir: lo que cambiaría y lo que faltaría. `plan` es lo que se escribe con el toque.
   * `previo`: el plan de la propuesta pendiente del mismo viaje, que se une (lo nuevo gana solo en el mismo campo).
   * `o`: quién dijo cada texto, lo ya preguntado del viaje y lo escrito al pedir una tanda (`OpcionesCarga`).
   */
  prepararCarga(viajeId: string, textos: string[], previo?: unknown, o?: OpcionesCarga): Promise<CargaPreparada>;
  /** `escritos`: lo que quedó escrito, por etiqueta y legible (`registradoDe`). */
  cargar(viajeId: string, plan: unknown): Promise<{ lineas: string[]; escritos?: Record<string, string> }>;
  crearCliente(nombre: string, llave: Llave): Promise<{ ok: true; id: string; nombre: string } | { ok: false; motivo: string }>;
  /**
   * La autorización de datos del contacto: si ya autorizó (y cuándo), o el link vigente (lo reusa o lo crea). `'error'`:
   * no se pudo revisar. No escribe nada en el contacto: a lo sumo crea el enlace pendiente.
   */
  autorizacion(contactoId: string): Promise<AutorizacionAgente | 'error'>;
  /**
   * ¿El contacto tiene la autorización de datos VIGENTE (`vigente.generales` de `autorizacion_datos_estado`, la misma regla
   * del gate)? Solo lee: no crea enlaces. `'error'`: no se pudo revisar.
   */
  autorizado(contactoId: string): Promise<boolean | 'error'>;
  /** Lo que el perfil del contacto ya tiene (todos los estados). `'error'`: no se pudo revisar. */
  perfilDe(contactoId: string): Promise<HechoExistente[] | 'error'>;
  /**
   * Escribe en el perfil (`planGuardado` contra lo que ya tiene): `confirmado` inserta o confirma el sugerido igual;
   * `sugerido` solo inserta lo nuevo (lo descartado no vuelve). Lanza si no pudo.
   */
  guardarPerfil(p: { contactoId: string; hechos: HechoConOrigen[]; estado: 'sugerido' | 'confirmado'; origenTipo: OrigenPerfil }): Promise<{ guardados: HechoConOrigen[]; yaEstaban: HechoConOrigen[] }>;
  /**
   * Los adjuntos (foto o PDF, 2026-10-21): bajar de Meta, subir al llegar y anotar en la fila (`../adjuntos.ts`). Sin
   * ellos (o sin lector) la bandeja no lee archivos, como antes.
   */
  adjuntos?: PuertoAdjuntos;
  /**
   * Deja los archivos como soporte del viaje: una línea por archivo en la actividad del negocio, con su referencia
   * `one://` (se abre desde la actividad). Lanza si no pudo.
   */
  soportesEnViaje?(viajeId: string, adjuntos: AdjuntoCarga[]): Promise<void>;
}

export const BOT_BANDEJA = 'bandeja-solicitudes';
export const ACCIONES = ['viaje_nuevo', 'cargar_tanda', 'anotar_en_viaje', 'crear_cliente', 'descartar', 'perfil_contacto'];

// ── Lo que dice la conversación ──────────────────────────────────────────────

const delEquipo = (f: FilaConversacion) => f.direccion === 'entrante' && f.clase !== 'reenvio';
const noBot = (f: FilaConversacion) => f.direccion === 'entrante';

/** Los reenvíos que todavía no se cargaron ni se descartaron (la tanda). */
export function tanda(filas: FilaConversacion[]): FilaConversacion[] {
  const consumidos = new Set(filas.flatMap((f) => (f.traza?.ejecucion?.resultado === 'ejecutada' ? f.traza.ejecucion.consumidos ?? [] : [])));
  return filas.filter((f) => f.direccion === 'entrante' && f.clase === 'reenvio' && !consumidos.has(f.id));
}

const palabrasDe = (s: string) => new Set(normal(s).split(/[^a-z0-9ñ]+/u).filter((w) => w.length >= 4));

/**
 * La opción que el comercial nombró al contestar una lista o unos botones del bot ESCRIBIENDO: su número («1», «el 2»)
 * o una palabra que solo esa opción tiene («el de san andrés»). Es el candado, no una lectura: si es ambiguo, nada.
 */
export function opcionNombrada(opciones: ReadonlyArray<{ titulo: string; descripcion?: string }>, texto: string): number | null {
  const t = normal(texto).trim();
  const num = /^(?:el |la |opcion |opción )?(\d{1,2})\.?$/u.exec(t);
  if (num) {
    const k = Number(num[1]);
    return k >= 1 && k <= opciones.length ? k - 1 : null;
  }
  const dichas = palabrasDe(texto);
  const de = opciones.map((o) => palabrasDe(`${o.titulo} ${o.descripcion ?? ''}`));
  const candidatas = de.map((ws, i) => ({ i, propias: [...ws].filter((w) => dichas.has(w) && de.every((otra, j) => j === i || !otra.has(w))) }))
    .filter((x) => x.propias.length > 0);
  return candidatas.length === 1 ? candidatas[0].i : null;
}

/**
 * Los viajes que el comercial nombró: códigos en sus escritos o en lo que tocó, la opción que eligió escribiendo
 * (número o palabra propia de esa opción, en el mensaje que sigue a las opciones) y los que abrió con su toque.
 * `sueltos`: los códigos que escribió sin espacios, ya resueltos contra la base (`resolverSueltos`).
 */
export function viajesNombrados(filas: FilaConversacion[], sueltos: Record<string, string> = {}): string[] {
  return [...new Set(nombramientos(filas, opcionNombrada, {}, sueltos).map((x) => x.clave).filter((c) => !c.startsWith('nuevo:')))];
}

/** ¿El texto está en un escrito del equipo? (para anotar: nada sale del modelo ni de un reenvío). */
function enEscritoDelEquipo(filas: FilaConversacion[], texto: string): boolean {
  const t = normal(texto).replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const palabras = t.split(' ').filter((w) => w.length >= 3);
  return filas.filter(delEquipo).some((f) => {
    const e = normal(f.texto ?? '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ');
    if (e.includes(t)) return true;
    // Una paráfrasis corta del mismo escrito: casi todas sus palabras están en él.
    return palabras.length > 0 && palabras.filter((w) => e.includes(w)).length / palabras.length >= 0.8;
  });
}

/**
 * La fila del mensaje `#n` que el modelo dice que abrió el pedido del viaje (`desde`): un mensaje que entró a la
 * conversación, escrito por el equipo o reenviado del cliente (2026-10-28: el pedido empezó con un reenvío y el candado
 * lo rechazaba). El número es el de la ventana que vio el modelo; se guarda el id, que no se corre. Pura.
 */
export function filaDesde(filas: FilaConversacion[], desde: unknown): { id: string } | null | 'invalida' {
  if (desde === undefined || desde === null || desde === '') return null;
  const n = Number(String(desde).replace(/^#/, '').trim());
  const f = Number.isInteger(n) && n >= 1 ? filas[n - 1] : undefined;
  return f && noBot(f) ? { id: f.id } : 'invalida';
}

/** ¿El dato está escrito en la conversación (del equipo o reenviado), no solo dicho por el bot? */
function enLaConversacion(filas: FilaConversacion[], dato: string): boolean {
  const d = normal(dato).trim();
  return !!d && filas.filter(noBot).some((f) => normal(f.texto ?? '').includes(d));
}

/**
 * La fila (la última) donde está escrita esta frase, entre las que cumplen `cual`: es el `origen_ref` de un hecho del
 * perfil. Compara el texto sin tildes ni mayúsculas; no interpreta. Pura.
 */
export function filaDeLaFrase(filas: FilaConversacion[], frase: string, cual: (f: FilaConversacion) => boolean = noBot): string | null {
  const t = textoComparable(frase);
  if (!t) return null;
  return [...filas].reverse().find((f) => cual(f) && textoComparable(f.texto ?? '').includes(t))?.id ?? null;
}

// ── Las fichas ───────────────────────────────────────────────────────────────

export interface FichaAgente {
  ref: string;
  nombre: string;
  dato: string;
  viajes_abiertos: Array<{ codigo: string | null; nombre: string | null }>;
  ultimo_cerrado: { codigo: string | null; nombre: string | null } | null;
}

function titulo(s: string): string {
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
}

function datoDe(f: FichaCliente): string {
  if (f.cel4) return `cel. …${f.cel4}`;
  if (f.correo) return 'con correo';
  if (f.usuario) return 'con usuario de WhatsApp';
  return 'sin celular ni correo';
}

export function fichaAgente(f: FichaCliente): FichaAgente {
  const nombre = titulo(f.nombre);
  return {
    ref: `${nombre} (${datoDe(f)})`,
    nombre,
    dato: datoDe(f),
    viajes_abiertos: f.abiertos.slice(0, 6),
    ultimo_cerrado: f.cerrado ?? null,
  };
}

type Vista = { ficha: FichaAgente; id: string };

/** Las fichas que el modelo vio en esta conversación (de los `privado` de sus `buscar`) y los clientes creados. */
function fichasVistas(ctx: ContextoDominio): Vista[] {
  const vistas: Vista[] = [];
  for (const r of ctx.resultadosPrevios) {
    const p = r.privado as { fichas?: Vista[] } | undefined;
    for (const v of p?.fichas ?? []) vistas.push(v);
  }
  for (const f of ctx.conversacion) {
    for (const e of f.traza?.ejecucion?.resultado === 'ejecutada' ? f.traza.ejecucion.escrituras ?? [] : []) {
      if (e.tipo === 'cliente' && typeof e.id === 'string' && e.ficha) vistas.push({ id: e.id, ficha: e.ficha as FichaAgente });
    }
  }
  return vistas;
}

/** La ficha a la que se refiere el modelo: por su ref, por los 4 dígitos o por el nombre si es uno solo. */
export function resolverFicha(ctx: ContextoDominio, ref: string): Vista | null | 'varias' {
  const vistas = fichasVistas(ctx);
  const unicas = [...new Map(vistas.map((v) => [v.id, v])).values()];
  const r = normal(ref).trim();
  if (!r) return null;
  const exacta = unicas.filter((v) => normal(v.ficha.ref) === r);
  if (exacta.length === 1) return exacta[0];
  const dig = ref.replace(/\D/g, '');
  if (dig.length >= 4) {
    const porCel = unicas.filter((v) => v.ficha.dato.endsWith(dig.slice(-4)));
    if (porCel.length === 1) return porCel[0];
  }
  const porNombre = unicas.filter((v) => normal(v.ficha.nombre) === r || r.startsWith(`${normal(v.ficha.nombre)} `));
  if (porNombre.length === 1) return porNombre[0];
  if (porNombre.length > 1) return 'varias';
  return null;
}

// ── Quién lleva el viaje ─────────────────────────────────────────────────────

/**
 * La persona del equipo que nombró el modelo: por su id, por su nombre exacto (sin tildes ni mayúsculas) o por su nombre
 * seguido de una aclaración entre paréntesis («Tatiana Ruiz (quien escribe)»). No interpreta lo que dijo el comercial:
 * eso lo hizo el modelo; esto solo comprueba que su elección es una persona de la lista. Pura.
 */
export function resolverResponsable(equipo: ReadonlyArray<MiembroEquipo>, ref: string): MiembroEquipo | null | 'varias' {
  const r = normal(ref).trim();
  if (!r) return null;
  const porId = equipo.filter((m) => m.id === ref.trim());
  if (porId.length === 1) return porId[0];
  const iguales = equipo.filter((m) => normal(m.nombre) === r || r.startsWith(`${normal(m.nombre)} (`));
  if (iguales.length === 1) return iguales[0];
  return iguales.length > 1 ? 'varias' : null;
}

/** El equipo como lo ven el modelo y el comercial: los nombres, en una línea. Pura. */
export function nombresDelEquipo(equipo: ReadonlyArray<MiembroEquipo>): string {
  return equipo.map((m) => m.nombre).join(' · ');
}

/**
 * ¿Quedó sin contestar la pregunta de quién lleva el viaje? Sí, si después de la última propuesta o apertura de un viaje
 * nuevo el bot preguntó: un candado `falta_responsable` (o el de alguien fuera del equipo), o un mensaje del bot cuyas
 * opciones son personas del equipo (al menos dos, o la única que hay). No lee lo que escribió el comercial: mira las
 * trazas y las opciones que mandó el bot, contra la lista del equipo. Pura.
 */
export function responsablePendiente(filas: ReadonlyArray<FilaConversacion>, equipo: ReadonlyArray<MiembroEquipo> = []): boolean {
  const nombres = new Set(equipo.map((m) => normal(m.nombre)));
  const minimo = Math.min(2, nombres.size);
  let pendiente = false;
  for (const f of filas) {
    if (f.direccion === 'saliente' && minimo > 0 && (f.opciones ?? []).filter((o) => nombres.has(normal(o.titulo))).length >= minimo) pendiente = true;
    const t = f.traza;
    if (!t) continue;
    if (t.propuesta?.accion === 'viaje_nuevo' || (t.ejecucion?.accion === 'viaje_nuevo' && t.ejecucion.resultado === 'ejecutada')) pendiente = false;
    if (t.candados?.some((c) => c.candado === 'falta_responsable' || c.candado === 'responsable_fuera_del_equipo')) pendiente = true;
  }
  return pendiente;
}

// ── Las declaraciones ────────────────────────────────────────────────────────

export const LECTURAS: DeclaracionHerramienta[] = [
  {
    name: 'buscar',
    description: 'Busca clientes y viajes en todo el directorio por nombre, código de viaje, celular o correo. Devuelve fichas con su dato (cel. …9444), sus viajes abiertos y su último viaje cerrado. Solo lectura.',
    parameters: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
  },
  {
    name: 'ver_viaje',
    description: 'El detalle de un viaje por su código («M1 26 6»): cliente, destino, si está abierto, lo que tiene registrado, qué le falta para cotizar y para quedar completo. Solo lectura.',
    parameters: { type: 'object', properties: { codigo: { type: 'string' } }, required: ['codigo'] },
  },
];

/**
 * Cierra el turno: el sistema manda el link real y el mensaje para reenviar (o dice que ya autorizó). El pedido lo
 * reconoce el modelo; el código solo exige la ficha vista por `buscar`, como `viaje_nuevo`.
 */
export const CIERRES: DeclaracionHerramienta[] = [
  {
    name: 'link_autorizacion',
    description: 'Solo cuando el comercial pide el link de autorización de tratamiento de datos de un cliente, o pregunta si ese cliente ya autorizó. No sirve para consultar viajes (para eso, ver_viaje). Primero `buscar` al cliente; luego llama esto con la ref de su ficha. El sistema contesta solo: si ya autorizó, lo dice con la fecha; si no, manda la instrucción y, aparte, el mensaje con el link para que el comercial lo reenvíe. Cierra el turno: no redactes el link ni el mensaje, y nunca le escribas al cliente.',
    parameters: { type: 'object', properties: { cliente: { type: 'string', description: 'La ref de la ficha tal como la devolvió buscar.' }, reglas_usadas: { type: 'array', items: { type: 'string' } } }, required: ['cliente'] },
  },
];

const DATOS_PROPONER = {
  cliente: { type: 'string', description: 'viaje_nuevo / perfil_contacto: la ref de la ficha tal como la devolvió buscar.' },
  hechos: {
    type: 'array',
    items: esquemaHecho(),
    description: [
      'perfil_contacto: lo que el comercial quiere que se recuerde de una PERSONA para atenderla mejor en sus próximos viajes,',
      'sin un viaje de por medio («recuerda que a … le gusta …», «… siempre viaja con …»). Un elemento por hecho.',
      `dimension: ${DIMENSIONES_PERFIL.map((d) => `${d} = ${ETIQUETA_DIMENSION[d]}`).join('; ')}.`,
      'De los menores solo cuántos y de qué edades, sin nombres. Marca con clase lo que no es un dato: sensible (salud,',
      'creencias, vida íntima) o juicio (una opinión sobre la persona); el sistema no los guarda y te dice qué contestar.',
    ].join(' '),
  },
  destino: { type: 'string', description: 'viaje_nuevo: el destino, si lo dijeron.' },
  responsable: {
    type: 'string',
    description: [
      'viaje_nuevo: OBLIGATORIO. Quién lleva (ejecuta) este viaje: el nombre tal como sale en «Equipo comercial» del Estado.',
      'Lo elige el comercial, no tú: si para este viaje no lo ha dicho, antes de proponer pregúntale «¿Quién lleva este viaje?»',
      'con `responder` y el equipo comercial en `opciones`. Entiende cómo lo diga: «la llevo yo» o «yo» es quien escribe; un',
      'apodo o solo el nombre es la persona de la lista que corresponde. Si puede ser más de una persona, o nombra a alguien que',
      'no está en la lista, pregunta otra vez con las opciones; nunca escojas tú ni asumas que es quien escribe.',
    ].join(' '),
  },
  dicho_en: {
    type: 'integer',
    description: 'viaje_nuevo: OBLIGATORIO con `responsable`. El número (#n) del mensaje, audio o toque del comercial donde dijo quién lleva este viaje: uno que nombra a la persona, dice «yo» o toca su nombre. Pedir el viaje no es decir quién lo lleva. Si no hay ninguno, no lo dijo: pregúntale.',
  },
  desde: { type: 'integer', description: 'viaje_nuevo: el número (#n) del mensaje (escrito o reenviado) donde empezó el pedido de este viaje, si fue antes de este turno. El sistema lee desde ahí lo que se dijo del viaje.' },
  viaje: { type: 'string', description: 'cargar_tanda / anotar_en_viaje: el código del viaje.' },
  texto: { type: 'string', description: 'anotar_en_viaje: opcional. El sistema lee TODO lo que el comercial escribió de ese viaje en la conversación (también lo de antes de abrirlo) y lo une con la propuesta pendiente.' },
  nombre: { type: 'string', description: 'crear_cliente: el nombre como lo escribieron.' },
  llave: { type: 'string', description: 'crear_cliente: el celular, correo o usuario tal como lo escribieron.' },
  distinto_de_parecidos: { type: 'boolean', description: 'crear_cliente: true solo si ya mostraste los parecidos y el comercial dijo que es otra persona.' },
};

// ── El perfil ────────────────────────────────────────────────────────────────

/**
 * Lo que no va al perfil, dicho en una línea por motivo (va en el resumen o es lo que el modelo contesta). Lo sensible va
 * en un viaje, como requisito especial, si hay uno abierto (la casilla 2 del texto: «solo para mi viaje»); un juicio no se
 * guarda en ningún lado. El motivo lo marcó el modelo; esto solo lo dice. Pura.
 */
export function lineasFuera(fuera: ReadonlyArray<HechoFuera>, ficha: Pick<FichaAgente, 'viajes_abiertos'>): string[] {
  const out: string[] = [];
  const citar = (fs: HechoFuera[]) => fs.map((f) => `«${f.texto}»`).join(', ');
  const sensibles = fuera.filter((f) => f.motivo === 'sensible');
  const juicios = fuera.filter((f) => f.motivo === 'juicio');
  if (sensibles.length) {
    const codigos = ficha.viajes_abiertos.map((v) => v.codigo).filter((c): c is string => !!c);
    const donde = codigos.length
      ? `va en el viaje, como requisito especial (${codigos.length === 1 ? codigos[0] : `tiene abiertos ${codigos.join(', ')}`}): dime y lo anoto ahí.`
      : 'solo se anota en un viaje, como requisito especial, y no tiene viajes abiertos.';
    out.push(`${citar(sensibles)} no va al perfil (es de salud o creencias): ${donde}`);
  }
  if (juicios.length) out.push(`${citar(juicios)} no lo guardo: es una opinión sobre la persona, no un dato.`);
  return out;
}

// ── Los adjuntos (foto o PDF, 2026-10-21) ────────────────────────────────────

/** Cómo se nombra un archivo en un resumen: el PDF por su nombre; la foto, «la foto». Pura. */
export function nombreAdjunto(a: Pick<AdjuntoCarga, 'tipo' | 'nombre'>): string {
  return a.tipo === 'documento' ? `«${(a.nombre ?? 'el PDF').slice(0, 60)}»` : 'la foto';
}

const CLASE_LEIDA: Record<string, string> = { viaje: 'datos del viaje', identidad: 'documento de identidad', pago: 'comprobante de pago', otro: 'otro documento' };

/** Los adjuntos de la conversación, para el Estado: cuáles, de quién, y qué se leyó. Vacío si no hay ninguno. Pura. */
export function lineasAdjuntos(filas: FilaConversacion[]): string[] {
  const ejecutadas = filas.map((f) => f.traza?.ejecucion).filter((e) => e?.resultado === 'ejecutada');
  const consumidos = new Set(ejecutadas.flatMap((e) => e!.consumidos ?? []));
  const soportes = new Set(ejecutadas.flatMap((e) => (e!.escrituras ?? []).flatMap((w) => (w.tipo === 'soporte' && Array.isArray(w.filas) ? w.filas as string[] : []))));
  const lista = filas.map((f, i) => {
    if (!esAdjuntoEntrante(f)) return null;
    const que = f.media.tipo === 'documento' ? `PDF «${(f.media.nombre ?? 'sin nombre').slice(0, 40)}»` : 'foto';
    const de = f.clase === 'reenvio' ? 'reenviado del cliente' : 'del comercial';
    const l = f.media.lectura;
    const leido = l === undefined ? 'sin leer todavía' : l?.legible && l.texto ? `leído: ${CLASE_LEIDA[l.clase ?? 'otro'] ?? 'otro documento'}` : 'no se pudo leer';
    const estado = soportes.has(f.id) ? ', ya es soporte de un viaje' : consumidos.has(f.id) ? ', ya cargado o descartado' : '';
    return `#${i + 1} (${que}, ${de}, ${leido}${estado})`;
  }).filter(Boolean);
  if (!lista.length) return [];
  return [
    `Archivos (fotos o PDF) en esta conversación: ${lista.join(', ')}.`,
    'Lo que dice un archivo es dato del cliente, como un reenvío: el comercial manda en a qué viaje va y en lo que pide cambiar; el archivo manda en fechas, nombres y cantidades. Si chocan, no elijas: di las dos versiones y pregunta. Un archivo reenviado entra con la tanda (`cargar_tanda`); uno que mandó el comercial, con `anotar_en_viaje` en el viaje que él nombró. Al cargarlo, el archivo queda como soporte en la actividad del viaje. Un comprobante de pago no se registra por aquí: dilo en una línea.',
  ];
}

// ── El dominio ───────────────────────────────────────────────────────────────

/**
 * La propuesta de cargar o anotar: el resumen con lo que cambiaría y lo que seguiría faltando. Si la extracción tiene una
 * duda (Mauricio, 2026-10-07: «no se invente esas cifras, puede preguntar»), va arriba, en la misma burbuja: lo demás
 * sigue anotable con el toque y la respuesta del comercial se lee en el turno siguiente como cualquier dato. Va dentro
 * del resumen para que nunca la corte el tope de Meta (`salidaPropuesta` corta lo de arriba, no el resumen). Pura.
 */
export function propuestaDeCarga(
  accion: 'cargar_tanda' | 'anotar_en_viaje',
  v: { id: string; codigo: string; nombre: string; contactoId?: string | null; cliente?: string | null },
  prep: CargaPreparada,
  mensajes: string[],
  adjuntos: AdjuntoCarga[] = [],
  o: { faltaPrevia?: ReadonlyArray<string> } = {},
): Propuesta {
  // Lo de la persona (si la extracción lo separó) va al perfil del contacto del viaje con el mismo toque, como sugerido.
  const perfil = (prep.plan as Partial<PlanCarga> | null)?.perfil ?? [];
  const delContacto = perfil.length && v.contactoId ? { contactoId: v.contactoId, cliente: v.cliente ?? null } : {};
  const verbo = accion === 'cargar_tanda' ? `¿Cargo esto en ${v.codigo} · ${v.nombre}?` : `¿Lo anoto en ${v.codigo} · ${v.nombre}?`;
  // Lo que se confirma va arriba y corto (2026-10-28: cada propuesta abría con la frase citada, la pregunta y la lista de
  // faltantes, y lo que había que tocar quedaba abajo). Lo que falta solo se dice si cambió desde la propuesta anterior.
  const faltaLinea = prep.falta.length ? `Falta para cotizar: ${prep.falta.join(', ')}.` : 'Con esto queda el mínimo para cotizar.';
  const resumen = [
    verbo,
    ...(prep.entendido.length ? prep.entendido.map((l) => `• ${l}`) : ['• (no encontré datos del viaje en esto)']),
    ...(prep.duda ? [prep.duda] : []),
    ...(o.faltaPrevia !== undefined && mismoEntendido(o.faltaPrevia, prep.falta) && prep.falta.length ? [] : [faltaLinea]),
    // El archivo queda como soporte del viaje con el mismo toque (2026-10-21).
    ...(adjuntos.length ? [`📎 Queda como soporte del viaje: ${adjuntos.map(nombreAdjunto).join(', ')}.`] : []),
  ].join('\n');
  return {
    accion, sobre: v.codigo,
    datos: {
      viajeId: v.id, codigo: v.codigo, mensajes, plan: prep.plan, entendido: prep.entendido, falta: prep.falta,
      ...(prep.duda ? { duda: prep.duda, ...(prep.dudaCampo ? { dudaCampo: prep.dudaCampo } : {}) } : {}), ...delContacto, ...(adjuntos.length ? { adjuntos } : {}),
    },
    resumen,
    si: accion === 'cargar_tanda' ? 'Cargar' : 'Anotar', no: 'No',
  };
}

/** Ventana de los adjuntos de la bandeja: la foto o el PDF del comercial y su texto se atienden juntos (como en ONE). */
export const VENTANA_ADJUNTOS_BANDEJA_MS = 5000;
/** Se preparan los adjuntos de la ventana de la conversación (24 h: una tanda puede cargarse horas después), hasta 6. */
const PREPARAR_DESDE_MS = 24 * 3600 * 1000;
const PREPARAR_MAX = 6;

export function dominioBandeja(puerto: PuertoBandeja, o: { lector?: Lector | null; ahora?: () => number } = {}): Dominio {
  const existentes = (c: string[]) => puerto.codigosExistentes(c);
  // Leer adjuntos es opt-in: con el lector y el puerto de adjuntos. Sin ellos, la bandeja queda como antes.
  const prepararTurno = o.lector && puerto.adjuntos
    ? preparadorDeAdjuntos(puerto.adjuntos, {
      lector: o.lector, ahora: o.ahora ?? (() => Date.now()), desdeMs: PREPARAR_DESDE_MS, max: PREPARAR_MAX,
      vacia: (motivo) => ({ ...sinLectura(motivo), clase: 'otro', texto: null }),
    })
    : null;
  const leer = async (nombre: string, args: Record<string, unknown>): Promise<ResultadoHerramienta> => {
    if (nombre === 'buscar') {
      const texto = String(args.texto ?? '').trim();
      if (!texto) return { ok: false, datos: null, error: 'Dime qué buscar: un nombre, un código, un celular o un correo.' };
      const llave = llavesDelTexto(texto);
      const sueltos = await resolverSueltos([texto], existentes);
      const codigos = [...new Set([...codigosCanonicos(texto), ...Object.values(sueltos)])];
      const sinLlave = texto.replace(/[\w.+-]+@[\w.-]+/g, ' ').replace(/\+?\d[\d\s().-]{5,}\d/g, ' ').trim();
      const [porLlave, porNombre, viajes] = await Promise.all([
        llave ? puerto.porLlave(llave) : Promise.resolve([] as FichaCliente[]),
        sinLlave && !codigos.length ? puerto.porNombre(sinLlave) : Promise.resolve([] as FichaCliente[]),
        Promise.all(codigos.map((c) => puerto.viaje(c))),
      ]);
      if (porLlave === null || porNombre === null || viajes.includes('error')) {
        return { ok: false, datos: null, error: 'No pude revisar el directorio ahora. No digas que no existe: di que no pudiste revisar.' };
      }
      const todas = [...new Map([...porLlave, ...porNombre].map((f) => [f.id, f])).values()].slice(0, 10);
      const fichas = todas.map(fichaAgente);
      const encontrados = (viajes.filter((v) => v && v !== 'error') as ViajeAgente[]).map((v) => ({ codigo: v.codigo, nombre: v.nombre, cliente: v.cliente, abierto: v.abierto }));
      return {
        ok: true,
        datos: { fichas, viajes: encontrados, por: llave ? 'llave' : codigos.length ? 'codigo' : 'nombre', ...(fichas.length === 0 && encontrados.length === 0 ? { nota: 'Nadie con eso en el directorio.' } : {}) },
        privado: { fichas: todas.map((f, i) => ({ id: f.id, ficha: fichas[i] })) },
      };
    }
    if (nombre === 'ver_viaje') {
      const r = await codigoDe(args.codigo);
      if (!r.ok) return r.error === 'lectura' ? { ok: false, datos: null, error: 'No pude revisar ese viaje ahora. No digas que no existe.' } : { ok: true, datos: { nota: r.error } };
      const codigo = r.codigo;
      const v = await puerto.viaje(codigo);
      if (v === 'error') return { ok: false, datos: null, error: 'No pude revisar ese viaje ahora. No digas que no existe.' };
      if (!v) return { ok: true, datos: { nota: `No hay un viaje con el código ${codigo}.` } };
      return {
        ok: true,
        sobre: v.codigo,
        datos: {
          codigo: v.codigo, nombre: v.nombre, cliente: v.cliente, destino: v.destino, abierto: v.abierto,
          ...(v.registrado ? { registrado: v.registrado } : {}),
          falta_para_cotizar: v.faltaCotizar, falta_para_completo: v.faltaCompleto,
          ...(v.enVuelo ? { nota: 'Hay una carga en vuelo sobre este viaje: dilo y contesta cuando termine.' } : {}),
        },
      };
    }
    return { ok: false, datos: null, error: `No existe la herramienta «${nombre}».` };
  };

  /** Los códigos que el equipo escribió sin espacios en la conversación, resueltos contra la base (sin sueltos, nada). */
  const sueltosDe = (ctx: ContextoDominio) => resolverSueltos(ctx.conversacion.filter(delEquipo).map((f) => f.texto ?? ''), existentes);

  /** El código que dio el modelo, con espacios: tal cual si ya los trae, o la única lectura que existe («m1261»). */
  const codigoDe = async (dado: unknown): Promise<{ ok: true; codigo: string } | { ok: false; error: string }> => {
    const texto = String(dado ?? '').trim();
    const r = await resolverCodigo(texto, existentes);
    if (r === 'error') return { ok: false, error: 'lectura' };
    if (r && 'codigo' in r) return { ok: true, codigo: r.codigo };
    if (r) return { ok: false, error: `«${texto}» puede ser ${r.varios.join(' o ')}. Pregúntale al comercial cuál, con opciones.` };
    return { ok: true, codigo: texto.toUpperCase().replace(/\s+/g, ' ') };
  };

  /** El viaje para escribir: nombrado en la conversación y abierto. */
  const viajeParaEscribir = async (ctx: ContextoDominio, codigoDado: unknown): Promise<{ ok: true; v: ViajeAgente } | { ok: false; error: string; candado: string }> => {
    if (!String(codigoDado ?? '').trim()) return { ok: false, error: 'Falta el código del viaje.', candado: 'viaje_nombrado' };
    const [rc, sueltos] = await Promise.all([codigoDe(codigoDado), sueltosDe(ctx)]);
    if (!rc.ok) return rc.error === 'lectura' ? { ok: false, error: 'No pude revisar ese viaje ahora.', candado: 'lectura_fallida' } : { ok: false, error: rc.error, candado: 'codigo_ambiguo' };
    const codigo = rc.codigo;
    if (!viajesNombrados(ctx.conversacion, sueltos).includes(codigo)) {
      return { ok: false, error: `El comercial no nombró ${codigo} en esta conversación. Pregúntale a qué viaje va (puedes mostrarle opciones) o propón un viaje nuevo.`, candado: 'viaje_nombrado' };
    }
    const v = await puerto.viaje(codigo);
    if (v === 'error') return { ok: false, error: 'No pude revisar ese viaje ahora.', candado: 'lectura_fallida' };
    if (!v) return { ok: false, error: `No hay un viaje con el código ${codigo}.`, candado: 'viaje_inexistente' };
    if (!v.abierto) return { ok: false, error: `${codigo} ya no está abierto.`, candado: 'viaje_cerrado' };
    return { ok: true, v };
  };

  /** El equipo comercial, leído una vez por turno (el estado y la propuesta lo piden en el mismo turno). */
  let equipo: Promise<MiembroEquipo[] | 'error'> | null = null;
  const equipoComercial = () => (equipo ??= puerto.equipoComercial());

  /**
   * Quién lleva el viaje nuevo: el que nombró el modelo, si es del equipo comercial. Sin él, el candado le dice al modelo
   * que pregunte con las opciones; el código no escoge (Mauricio, 2026-10-16: «preguntar siempre obligatoriamente quién va
   * a ser el responsable de la ejecución»).
   */
  const responsableDe = async (dado: unknown, dichoEn: unknown, ctx: ContextoDominio): Promise<{ ok: true; m: MiembroEquipo } | { ok: false; error: string; candado: string }> => {
    const eq = await equipoComercial();
    if (eq === 'error') return { ok: false, error: 'No pude revisar quién es del equipo comercial ahora: no se abre el viaje. Dilo así e intenta en un momento.', candado: 'lectura_fallida' };
    if (!eq.length) {
      return { ok: false, error: 'No hay nadie activo con área comercial en el equipo, y un viaje no se abre sin quién lo lleve. Dilo así: alguien tiene que darle el área comercial a una persona en ONE.', candado: 'sin_equipo_comercial' };
    }
    const lista = nombresDelEquipo(eq);
    const ref = String(dado ?? '').trim();
    if (!ref) {
      return { ok: false, error: `Falta quién lleva este viaje. No propongas todavía: pregúntale a ${ctx.remitente.nombre} con \`responder\`, «¿Quién lleva este viaje?», con estas opciones: ${lista}. No lo elijas tú.`, candado: 'falta_responsable' };
    }
    const m = resolverResponsable(eq, ref);
    if (m === 'varias') return { ok: false, error: `«${ref}» puede ser más de una persona del equipo. Pregunta cuál, con las opciones: ${lista}.`, candado: 'responsable_fuera_del_equipo' };
    if (!m) return { ok: false, error: `«${ref}» no está en el equipo comercial (${lista}). Dile que esa persona no puede llevar el viaje y pregúntale quién lo lleva, con esas opciones.`, candado: 'responsable_fuera_del_equipo' };
    // La elección tiene que señalar DÓNDE la dijo el comercial (QA real, 2026-10-16: el respaldo propuso a quien escribe
    // sin que nadie lo dijera). El código no lee ese mensaje: solo exige que exista y sea del equipo, como `desde`.
    const dicho = filaDesde(ctx.conversacion, dichoEn);
    if (!dicho || dicho === 'invalida') {
      return { ok: false, error: `\`dicho_en\` tiene que ser el número (#n) del mensaje, audio o toque del comercial donde dijo quién lleva este viaje. Si no lo ha dicho, no propongas: pregúntale con \`responder\`, «¿Quién lleva este viaje?», con estas opciones: ${lista}.`, candado: 'falta_responsable' };
    }
    return { ok: true, m };
  };

  /**
   * `perfil_contacto`: lo que el comercial pide recordar de una persona. El modelo decide que es eso y marca cada hecho
   * (dato, sensible, juicio, nombra a un menor); el código solo obedece las marcas y protege las invariantes:
   *   · el contacto salió de `buscar` en esta conversación (es del workspace);
   *   · la frase de cada hecho está en un escrito del equipo (no sale del modelo ni de un reenvío);
   *   · sensible, juicio y nombres de menores no se guardan (y el modelo sabe qué contestar);
   *   · sin autorización vigente no se propone nada (y se ofrece el link);
   *   · no se escribe sin el toque de [Guardar] (el ejecutor vuelve a revisar la autorización).
   */
  const proponerPerfil = async (datos: Record<string, unknown>, ctx: ContextoDominio): Promise<Awaited<ReturnType<Dominio['proponer']>>> => {
    const ref = String(datos.cliente ?? '').trim();
    const ficha = resolverFicha(ctx, ref);
    if (ficha === 'varias') return { ok: false, error: `Hay varias fichas que coinciden con «${ref}». Pregúntale al comercial cuál, con opciones, y usa la ref exacta.`, candado: 'cliente_ambiguo' };
    if (!ficha) return { ok: false, error: 'Esa persona no salió de una búsqueda en esta conversación. Primero `buscar` y usa la ref de su ficha; si no existe, pregunta si la creas (crear_cliente, con su llave).', candado: 'cliente_sin_buscar' };
    const nombre = ficha.ficha.nombre.toUpperCase();
    const { guardables, fuera } = separarHechos(datos.hechos, ctx.conversacion.filter(delEquipo).map((f) => f.texto ?? ''));
    const de = (m: HechoFuera['motivo']) => fuera.filter((f) => f.motivo === m);
    if (de('nombra_menores').length) {
      return { ok: false, error: `De los menores solo va el patrón (cuántos y de qué edades), sin nombres: vuelve a proponer sin el nombre (${de('nombra_menores').map((f) => `«${f.texto}»`).join(', ')}).`, candado: 'menor_con_nombre' };
    }
    const malos = [...de('sin_respaldo'), ...de('forma')];
    if (malos.length) {
      return { ok: false, error: `Cada hecho necesita su dimensión y la frase EXACTA que escribió el comercial (no un reenvío ni una frase tuya). Corrige: ${malos.map((f) => `«${f.texto}»${f.detalle ? ` (${f.detalle})` : ''}`).join(', ')}.`, candado: 'texto_sin_respaldo' };
    }
    const noVan = lineasFuera(fuera, ficha.ficha);
    if (!guardables.length) {
      if (!noVan.length) return { ok: false, error: 'No hay nada que guardar: pregúntale al comercial qué quiere que recuerde de la persona.', candado: 'perfil_vacio' };
      return { ok: false, error: `No se guarda nada en el perfil de ${nombre}. Contesta con \`responder\`, en una o dos líneas, sin sermón: ${noVan.join(' ')}`, candado: 'perfil_no_guardable' };
    }
    const aut = await puerto.autorizado(ficha.id);
    if (aut === 'error') return { ok: false, error: 'No pude revisar la autorización de datos ahora: no se guarda nada. Dilo así, sin inventar.', candado: 'lectura_fallida' };
    if (!aut) {
      return {
        ok: false,
        error: `Sin autorización de datos vigente no se guarda nada en el perfil. Contesta con \`responder\`, tal cual: «${nombre} todavía no autoriza el uso de sus datos; no lo guardo. ¿Te paso su link?», con las opciones «Sí, pásamelo» y «No». Si dice que sí, \`link_autorizacion\` con la ref de su ficha.`,
        candado: 'sin_autorizacion',
      };
    }
    const existentes = await puerto.perfilDe(ficha.id);
    if (existentes === 'error') return { ok: false, error: 'No pude revisar el perfil ahora: no se guarda nada. Dilo así.', candado: 'lectura_fallida' };
    const plan = planGuardado(guardables, existentes, 'confirmado');
    const nuevos = [...plan.insertar, ...plan.confirmar.map((x) => x.hecho)];
    if (!nuevos.length) {
      return { ok: false, error: `Eso ya está en el perfil de ${nombre} (${plan.yaEstaban.map((h) => h.texto).join('; ')}). Dilo en una línea; no propongas guardarlo otra vez.`, candado: 'ya_en_perfil' };
    }
    const resumen = [
      nuevos.length === 1 ? `Guardo en el perfil de ${nombre}: ${lineaHecho(nuevos[0])}` : `Guardo en el perfil de ${nombre}:`,
      ...(nuevos.length > 1 ? nuevos.map((h) => `• ${lineaHecho(h)}`) : []),
      ...(plan.yaEstaban.length ? [`Ya estaba: ${plan.yaEstaban.map((h) => h.texto).join('; ')}.`] : []),
      ...noVan,
    ].join('\n');
    const hechos: HechoConOrigen[] = nuevos.map((h) => ({
      dimension: h.dimension, texto: h.texto, frase: h.frase, origenRef: filaDeLaFrase(ctx.conversacion, h.frase, delEquipo) ?? 'wa_conversacion',
    }));
    return { ok: true, propuesta: { accion: 'perfil_contacto', datos: { contactoId: ficha.id, cliente: nombre, hechos }, resumen, si: 'Guardar', no: 'Corregir' } };
  };

  const proponer: Dominio['proponer'] = async (accion, datos, ctx) => {
    if (accion === 'viaje_nuevo') {
      const ref = String(datos.cliente ?? '').trim();
      const ficha = resolverFicha(ctx, ref);
      if (ficha === 'varias') return { ok: false, error: `Hay varias fichas que coinciden con «${ref}». Usa la ref exacta de la que eligió el comercial.`, candado: 'cliente_ambiguo' };
      if (!ficha) return { ok: false, error: 'Ese cliente no salió de una búsqueda en esta conversación. Primero `buscar` y usa la ref de su ficha; si no existe, `crear_cliente`.', candado: 'cliente_sin_buscar' };
      const destino = String(datos.destino ?? '').trim() || null;
      if (destino && !enLaConversacion(ctx.conversacion, destino)) {
        return { ok: false, error: `«${destino}» no está escrito en la conversación. Usa el destino como lo escribieron, o déjalo vacío.`, candado: 'dato_sin_respaldo' };
      }
      const desde = filaDesde(ctx.conversacion, datos.desde);
      if (desde === 'invalida') return { ok: false, error: '`desde` tiene que ser el número (#n) de un mensaje que entró a la conversación (escrito o reenviado), o vacío.', candado: 'desde_invalido' };
      const quien = await responsableDe(datos.responsable, datos.dicho_en, ctx);
      if (!quien.ok) return quien;
      // La línea solo la nombra este resumen: leerla antes de cada acción eran cuatro consultas en serie delante de la
      // extracción de `anotar_en_viaje` y `cargar_tanda` (medido en vivo, 2026-10-09).
      const linea = await puerto.linea();
      const resumen = `¿Abro este viaje?\n${ficha.ficha.ref}${destino ? ` · ${destino}` : ''} · ${linea}\n${quien.m.esQuienEscribe ? `Lo llevas tú (${quien.m.nombre})` : `Lo lleva: ${quien.m.nombre}`}`;
      return {
        ok: true,
        propuesta: {
          accion,
          datos: {
            contactoId: ficha.id, cliente: ficha.ficha.nombre, destino, responsableId: quien.m.id, responsable: quien.m.nombre,
            ...(quien.m.esQuienEscribe ? { suyo: true } : {}), ...(desde ? { desdeFila: desde.id } : {}),
          },
          resumen, si: 'Sí, ábrelo', no: 'No',
        },
      };
    }
    if (accion === 'cargar_tanda' || accion === 'anotar_en_viaje') {
      const r = await viajeParaEscribir(ctx, datos.viaje);
      if (!r.ok) return r;
      if (accion === 'cargar_tanda') {
        const t = tanda(ctx.conversacion);
        if (!t.length) return { ok: false, error: 'No hay mensajes reenviados sin cargar. Si el comercial escribió el dato, usa anotar_en_viaje.', candado: 'tanda_vacia' };
        // Una foto o un PDF de la tanda entra con lo que dice el archivo (si se leyó) y queda de soporte con el toque.
        // Lo que escribió al pedirla («cárgalo en el G1 26 7, pero salen el 10») va aparte: manda si choca con la tanda.
        const pedido = pedidoDeTanda(ctx.conversacion, t, r.v.codigo, opcionNombrada, await sueltosDe(ctx));
        const prep = await puerto.prepararCarga(r.v.id, t.map(textoParaCarga).filter(Boolean), undefined, { preguntas: preguntasPrevias(ctx.conversacion, r.v.id), ...(pedido.length ? { pedido } : {}) });
        return { ok: true, propuesta: propuestaDeCarga(accion, r.v, prep, t.map((f) => f.id), puerto.soportesEnViaje ? adjuntosDe(t) : []) };
      }
      // anotar_en_viaje: lo que el comercial escribió de ESE viaje en la conversación, no solo el texto del modelo
      // (en vivo, «salen desde Bogotá» se anotaba sin la fecha ni los pasajeros dichos un mensaje antes).
      // Y los reenvíos de la tanda que son de ese viaje (los de antes de abrirlo, 2026-10-28), cada texto con su autor.
      const sueltos = await sueltosDe(ctx);
      const t = tanda(ctx.conversacion);
      const carga = cargaDelViaje(ctx.conversacion, t, r.v.codigo, opcionNombrada, {}, sueltos);
      let textos = carga.textos;
      // La foto o el PDF que el comercial mandó de ESE viaje queda de soporte con el toque (y el reenviado de la tanda).
      const adjuntos = puerto.soportesEnViaje
        ? adjuntosDe([...filasDelViaje(ctx.conversacion, r.v.codigo, opcionNombrada, {}, sueltos), ...t.filter((f) => carga.mensajes.includes(f.id))])
        : [];
      if (!textos.length) {
        const texto = String(datos.texto ?? '').trim();
        if (!texto || !enEscritoDelEquipo(ctx.conversacion, texto)) {
          return { ok: false, error: 'Lo que se anota tiene que ser lo que el comercial escribió (no un reenvío ni una frase tuya).', candado: 'texto_sin_respaldo' };
        }
        textos = [{ texto, reenviado: false }];
      }
      // Una pendiente de anotar en el mismo viaje se une, no se pisa.
      const vig = propuestaVigente(ctx.conversacion);
      const pendiente = vig?.accion === 'anotar_en_viaje' && vig.datos.viajeId === r.v.id ? vig : null;
      const partes = partirCarga(textos);
      const prep = await puerto.prepararCarga(r.v.id, partes.textos, pendiente?.datos.plan, { reenviados: partes.reenviados, preguntas: preguntasPrevias(ctx.conversacion, r.v.id) });
      // La duda cuenta: si el comercial la contestó y no cambió nada más, la propuesta nueva ya no la trae.
      if (pendiente && mismoEntendido([...prep.entendido, ...(prep.duda ? [prep.duda] : [])], [...((pendiente.datos.entendido as string[] | undefined) ?? []), ...(typeof pendiente.datos.duda === 'string' ? [pendiente.datos.duda] : [])])) {
        // Nada nuevo frente a la pendiente: es la misma (el núcleo la reenvía con sus botones, misma huella).
        return { ok: true, propuesta: { accion, sobre: r.v.codigo, datos: pendiente.datos, resumen: pendiente.resumen, si: pendiente.si, no: pendiente.no } };
      }
      // Nada nuevo en lo que ESCRIBIÓ, pero hay reenvíos sin cargar: «cárgalo en el G1 26 7» habla de la tanda, y la
      // duda o el «ya está» de lo escrito no aplican (arnés del 2026-10-29, mano derecha: con la orden sola, la extracción
      // preguntaba «¿qué significa G1 26 7?» o el modelo decía que lo del PDF «quedó registrado»). Lo dice el estado, no
      // una palabra: el modelo decide si el pedido es la tanda.
      const pendientes = !prep.entendido.length ? tanda(ctx.conversacion) : [];
      if (pendientes.length) {
        return {
          ok: false,
          error: `Lo que el comercial escribió de ${r.v.codigo} no trae datos del viaje, y hay ${pendientes.length === 1 ? '1 mensaje reenviado' : `${pendientes.length} mensajes reenviados`} sin cargar (la tanda: ${pendientes.map((f) => `#${f.id}`).join(', ')}). Si lo que pide es cargar eso en ${r.v.codigo}, propón \`cargar_tanda\` en ese viaje; nada quedó escrito todavía.`,
          candado: prep.duda ? 'solo_duda' : 'sin_datos_nuevos',
        };
      }
      if (!prep.entendido.length && prep.duda) {
        return { ok: false, error: `En lo que el comercial escribió de ${r.v.codigo} no hay datos nuevos para anotar, pero hay algo que no quedó claro. No propongas anotar: pregúntale con \`responder\`, tal cual: ${prep.duda}`, candado: 'solo_duda' };
      }
      if (!prep.entendido.length) {
        return { ok: false, error: `En lo que el comercial escribió de ${r.v.codigo} no hay datos nuevos: lo que dijo ya está en el viaje. No propongas anotar: contéstale con \`responder\` (usa ver_viaje si te pregunta qué tiene o qué falta).`, candado: 'sin_datos_nuevos' };
      }
      const faltaPrevia = Array.isArray(pendiente?.datos.falta) ? pendiente.datos.falta as string[] : undefined;
      return { ok: true, propuesta: propuestaDeCarga(accion, r.v, prep, carga.mensajes, adjuntos, { faltaPrevia }) };
    }
    if (accion === 'crear_cliente') {
      const nombre = String(datos.nombre ?? '').trim();
      if (!nombre || !enLaConversacion(ctx.conversacion, nombre)) return { ok: false, error: 'El nombre tiene que estar escrito en la conversación, como lo escribieron.', candado: 'dato_sin_respaldo' };
      const llave = llavesDelTexto(String(datos.llave ?? ''));
      const textoConversacion = ctx.conversacion.filter(noBot).map((f) => f.texto ?? '').join('\n');
      const enConv = llave && (
        (llave.celular && textoConversacion.replace(/\D/g, '').includes(llave.celular.slice(-7)))
        || (llave.correo && normal(textoConversacion).includes(llave.correo))
        || (llave.usuario && normal(textoConversacion).includes(llave.usuario))
      );
      if (!tieneLlave(llave) || !enConv) {
        return { ok: false, error: 'falta_llave: un cliente nuevo necesita su celular, correo o usuario escrito en la conversación. Pídeselo al comercial.', candado: 'falta_llave' };
      }
      const [duenos, parecidos] = await Promise.all([puerto.porLlave(llave), puerto.porNombre(nombre)]);
      if (duenos === null || parecidos === null) return { ok: false, error: 'No pude revisar el directorio: no se crea nada. Intenta de nuevo en un momento.', candado: 'guardian_fallo' };
      if (duenos.length) {
        const f = duenos.map(fichaAgente);
        return { ok: false, error: `llave_de_otro: esa llave ya es de ${f.map((x) => x.ref).join(' y ')}. Pregunta si es la misma persona.`, candado: 'llave_de_otro' };
      }
      const yaMostrados = ctx.conversacion.some((x) => x.traza?.candados?.some((c) => c.candado === 'parecidos'));
      if (parecidos.length && !(datos.distinto_de_parecidos === true && yaMostrados)) {
        const f = parecidos.slice(0, 9).map(fichaAgente);
        return { ok: false, error: `parecidos: hay fichas parecidas: ${f.map((x) => x.ref).join('; ')}. Muéstralas como opciones (más «Es otra persona») y pregunta si es una de ellas. Si dice que es otra, vuelve a proponer con distinto_de_parecidos: true.`, candado: 'parecidos' };
      }
      const dato = llave.celular ? `cel. …${llave.celular.slice(-4)}` : llave.correo ? llave.correo : `@${llave.usuario}`;
      return { ok: true, propuesta: { accion, datos: { nombre, llave }, resumen: `¿Creo este cliente?\n${titulo(nombre)} · ${dato}`, si: 'Crear', no: 'No es nuevo' } };
    }
    if (accion === 'perfil_contacto') return proponerPerfil(datos, ctx);
    if (accion === 'descartar') {
      const t = tanda(ctx.conversacion);
      if (!t.length) return { ok: false, error: 'No hay nada reenviado pendiente para descartar.', candado: 'tanda_vacia' };
      return { ok: true, propuesta: { accion, datos: { mensajes: t.map((f) => f.id) }, resumen: `¿Descarto ${t.length === 1 ? 'el mensaje' : `los ${t.length} mensajes`} que me pasaste sin cargar?`, si: 'Descartar', no: 'No' } };
    }
    return { ok: false, error: `Acción desconocida: ${accion}.`, candado: 'accion_desconocida' };
  };

  const perfilDeLaCarga = async (p: Propuesta, ctx: ContextoDominio): Promise<{ lineas: string[]; escrituras: Array<Record<string, unknown>> }> => {
    const d = p.datos;
    const perfil = (d.plan as Partial<PlanCarga> | null)?.perfil ?? [];
    const contactoId = typeof d.contactoId === 'string' ? d.contactoId : null;
    if (!perfil.length || !contactoId) return { lineas: [], escrituras: [] };
    const quien = typeof d.cliente === 'string' && d.cliente ? d.cliente : 'el cliente';
    try {
      const aut = await puerto.autorizado(contactoId);
      if (aut === 'error') return { lineas: ['No pude revisar la autorización de datos: lo de la persona no lo guardé en su perfil.'], escrituras: [] };
      if (!aut) return { lineas: [`Lo de la persona no lo guardé en su perfil: ${quien} todavía no autoriza el uso de sus datos.`], escrituras: [] };
      const hechos: HechoConOrigen[] = perfil.map((h) => ({ ...h, origenRef: filaDeLaFrase(ctx.conversacion, h.frase) ?? `negocio:${String(d.viajeId)}` }));
      const r = await puerto.guardarPerfil({ contactoId, hechos, estado: 'sugerido', origenTipo: 'bot_conversacion' });
      return {
        lineas: r.guardados.length ? [`Dejé en el perfil de ${quien}, por confirmar en ONE: ${r.guardados.map((h) => h.texto).join('; ')}.`] : [],
        escrituras: r.guardados.map((h) => ({ tipo: 'perfil', contactoId, estado: 'sugerido', dimension: h.dimension, texto: h.texto })),
      };
    } catch (err) {
      console.error('[agente] perfil de la carga:', err);
      return { lineas: ['Lo de la persona no alcancé a guardarlo en su perfil; lo del viaje sí quedó.'], escrituras: [] };
    }
  };

  /** Los archivos de la carga quedan de soporte en la actividad del viaje. Si falla, lo del viaje ya quedó: se dice. */
  const soporteDeLaCarga = async (p: Propuesta): Promise<{ lineas: string[]; escrituras: Array<Record<string, unknown>> }> => {
    const adjuntos = (p.datos.adjuntos as AdjuntoCarga[] | undefined) ?? [];
    if (!adjuntos.length || !puerto.soportesEnViaje) return { lineas: [], escrituras: [] };
    try {
      await puerto.soportesEnViaje(String(p.datos.viajeId), adjuntos);
      return {
        lineas: [`📎 Dejé ${adjuntos.map(nombreAdjunto).join(', ')} como soporte en la actividad del viaje.`],
        escrituras: [{ tipo: 'soporte', viajeId: p.datos.viajeId, filas: adjuntos.map((a) => a.fila), refs: adjuntos.map((a) => a.ref) }],
      };
    } catch (err) {
      console.error('[agente] soporte de la carga:', err);
      return { lineas: ['⚠️ No alcancé a dejar el archivo como soporte en el viaje; lo del viaje sí quedó.'], escrituras: [] };
    }
  };

  const ejecutar = async (p: Propuesta, ctx: ContextoDominio): Promise<Hechos> => {
    const d = p.datos;
    if (p.accion === 'viaje_nuevo') {
      // Una propuesta sin responsable (armada antes de esta regla) no se ejecuta: hay que volver a proponerla.
      if (typeof d.responsableId !== 'string' || !d.responsableId) throw new Error('el viaje no tiene quién lo lleve: vuelve a proponerlo');
      const v = await puerto.crearViaje({ contactoId: String(d.contactoId), destino: (d.destino as string | null) ?? null, responsableId: d.responsableId });
      const det = await puerto.viaje(v.codigo);
      const falta = det && det !== 'error' ? det.faltaCotizar : [];
      return {
        lineas: [
          `Abrí ${v.codigo}${d.destino ? ` · ${d.destino}` : ''} para ${d.cliente}. ${d.suyo ? 'Lo llevas tú.' : `Lo lleva ${d.responsable}.`}`,
          ...(falta.length ? [`Para cotizar falta: ${falta.join(', ')}.`] : []),
          'Reenvíame lo que te escribió y lo cargo ahí.',
        ],
        nombrados: [v.codigo],
        escrituras: [{ tipo: 'viaje', id: v.id, codigo: v.codigo, nombre: v.nombre, contactoId: d.contactoId, destino: d.destino ?? null, responsableId: d.responsableId }],
      };
    }
    if (p.accion === 'cargar_tanda' || p.accion === 'anotar_en_viaje') {
      const r = await puerto.cargar(String(d.viajeId), d.plan);
      // Lo de la persona va a su perfil como SUGERIDO con este mismo toque (no cuenta hasta que alguien lo confirme en ONE),
      // y solo con la autorización vigente. Si falla, lo del viaje ya quedó: se dice y no se deshace.
      const perfil = await perfilDeLaCarga(p, ctx);
      const soporte = await soporteDeLaCarga(p);
      return {
        lineas: [...r.lineas, ...perfil.lineas, ...soporte.lineas],
        consumidos: (d.mensajes as string[] | undefined) ?? [],
        escrituras: [
          { tipo: p.accion === 'cargar_tanda' ? 'carga' : 'anotacion', viajeId: d.viajeId, codigo: d.codigo, mensajes: d.mensajes ?? [], ...(r.escritos ? { escritos: r.escritos } : {}) },
          ...perfil.escrituras,
          ...soporte.escrituras,
        ],
      };
    }
    if (p.accion === 'perfil_contacto') {
      const contactoId = String(d.contactoId);
      // Se vuelve a revisar al tocar: entre la propuesta y el toque la autorización pudo caerse.
      if ((await puerto.autorizado(contactoId)) !== true) throw new Error('sin autorización de datos vigente: no se guardó nada');
      const r = await puerto.guardarPerfil({ contactoId, hechos: (d.hechos as HechoConOrigen[]) ?? [], estado: 'confirmado', origenTipo: 'bot_explicito' });
      return {
        lineas: [
          ...(r.guardados.length ? [`Guardé en el perfil de ${d.cliente}: ${r.guardados.map((h) => h.texto).join('; ')}.`] : []),
          ...(r.yaEstaban.length ? [`Ya estaba en su perfil: ${r.yaEstaban.map((h) => h.texto).join('; ')}.`] : []),
        ],
        escrituras: r.guardados.map((h) => ({ tipo: 'perfil', contactoId, estado: 'confirmado', dimension: h.dimension, texto: h.texto })),
      };
    }
    if (p.accion === 'crear_cliente') {
      const r = await puerto.crearCliente(String(d.nombre), d.llave as Llave);
      if (!r.ok) throw new Error(r.motivo);
      const llave = d.llave as Llave;
      const ficha: FichaAgente = fichaAgente({ id: r.id, nombre: r.nombre, cel4: llave.celular ? llave.celular.slice(-4) : null, correo: !!llave.correo, usuario: !!llave.usuario, abiertos: [], cerrado: null });
      return { lineas: [`Creé a ${ficha.ref}.`], escrituras: [{ tipo: 'cliente', id: r.id, nombre: r.nombre, ficha }] };
    }
    if (p.accion === 'descartar') {
      const ids = (d.mensajes as string[]) ?? [];
      return { lineas: [`Descarté ${ids.length === 1 ? 'el mensaje' : `los ${ids.length} mensajes`}.`], consumidos: ids, escrituras: [{ tipo: 'descarte', mensajes: ids }] };
    }
    throw new Error(`acción desconocida ${p.accion}`);
  };

  /**
   * Tras abrir un viaje: lo que el comercial ya dijo de él (en el mensaje en que pidió abrirlo o mientras el botón
   * esperaba) sale de una vez como propuesta de anotar. No se escribe sin su toque; el «Abrí…» no pide lo ya dicho.
   */
  const trasEjecutar: NonNullable<Dominio['trasEjecutar']> = async (p, h, huella, ctx) => {
    // Tras crear un cliente, el modelo decide si quedó una solicitud suya sin atender (Tatiana, 2026-10-07: pidió la
    // cotización, el bot pidió el cliente, lo creó y ahí se quedó).
    if (p.accion === 'crear_cliente') return { lineas: h.lineas, seguir: true };
    if (p.accion !== 'viaje_nuevo') return null;
    const v = h.escrituras?.find((x) => x.tipo === 'viaje') as { id: string; codigo: string; nombre?: string } | undefined;
    if (!v) return null;
    const alias = { [`nuevo:${huella}`]: v.codigo };
    const sueltos = await sueltosDe(ctx);
    // Lo escrito del viaje y lo reenviado antes de abrirlo (2026-10-28: el «Abrí…» pedía reenviar lo que ya estaba).
    const t = tanda(ctx.conversacion);
    const carga = cargaDelViaje(ctx.conversacion, t, v.codigo, opcionNombrada, alias, sueltos);
    if (!carga.textos.length) return null;
    const adjuntos = puerto.soportesEnViaje
      ? adjuntosDe([...filasDelViaje(ctx.conversacion, v.codigo, opcionNombrada, alias, sueltos), ...t.filter((f) => carga.mensajes.includes(f.id))])
      : [];
    const abri = h.lineas[0];
    let prep: CargaPreparada;
    try {
      const partes = partirCarga(carga.textos);
      prep = await puerto.prepararCarga(v.id, partes.textos, undefined, { reenviados: partes.reenviados });
    } catch {
      return { lineas: [abri, 'No alcancé a leer lo que me escribiste de este viaje: dime «anótalo» y lo vuelvo a leer.'] };
    }
    if (!prep.entendido.length) return prep.duda ? { lineas: [abri, prep.duda] } : null;
    const delContacto = { contactoId: (p.datos.contactoId as string | undefined) ?? null, cliente: (p.datos.cliente as string | undefined) ?? null };
    return { lineas: [abri], propuesta: propuestaDeCarga('anotar_en_viaje', { id: v.id, codigo: v.codigo, nombre: v.nombre ?? '', ...delContacto }, prep, carga.mensajes, adjuntos) };
  };

  const cerrar: NonNullable<Dominio['cerrar']> = async (nombre, args, ctx) => {
    if (nombre !== 'link_autorizacion') return { ok: false, error: `No existe la herramienta «${nombre}».`, candado: 'herramienta_desconocida' };
    const ref = String(args.cliente ?? '').trim();
    const ficha = resolverFicha(ctx, ref);
    if (ficha === 'varias') return { ok: false, error: `Hay varias fichas que coinciden con «${ref}». Pregunta cuál con opciones y usa la ref exacta.`, candado: 'cliente_ambiguo' };
    if (!ficha) return { ok: false, error: 'Ese cliente no salió de una búsqueda en esta conversación. Primero `buscar` y usa la ref de su ficha.', candado: 'cliente_sin_buscar' };
    const a = await puerto.autorizacion(ficha.id);
    if (a === 'error') return { ok: false, error: 'No pude revisar la autorización ahora. Dilo así: no inventes el link ni digas que autorizó.', candado: 'lectura_fallida' };
    const salidas = salidasLinkAutorizacion({ cliente: ficha.ficha.nombre, comercial: ctx.remitente.nombre, a, ahoraIso: new Date().toISOString() });
    return {
      ok: true,
      salidas,
      datos: a.estado === 'pendiente' ? { cliente: ficha.ficha.nombre, estado: a.estado, link: a.url } : { cliente: ficha.ficha.nombre, ...a },
      privado: { contactoId: ficha.id },
    };
  };

  /**
   * La base manda (2026-10-21): los viajes que se abrieron en esta conversación, revisados en la base en este turno (uno
   * borrado o cerrado en la app ya no se nombra como abierto). Los demás registros (cargas, clientes) cuelgan de un viaje
   * o se buscan con `buscar`, que ya lee la base.
   */
  const registros = async (ctx: ContextoDominio): Promise<RegistroConversacion[] | 'error'> => {
    const abiertos = new Map<string, { id: string; codigo: string }>();
    for (const f of ctx.conversacion) {
      const e = f.traza?.ejecucion;
      if (e?.resultado !== 'ejecutada') continue;
      for (const w of e.escrituras ?? []) if (w.tipo === 'viaje' && typeof w.id === 'string' && typeof w.codigo === 'string') abiertos.set(w.id, { id: w.id, codigo: w.codigo });
    }
    if (!abiertos.size) return [];
    const out: RegistroConversacion[] = [];
    for (const a of abiertos.values()) {
      const v = await puerto.viaje(a.codigo);
      if (v === 'error') return 'error';
      if (!v || v.id !== a.id) out.push({ id: a.id, alias: a.codigo, que: `viaje ${a.codigo} abierto aquí`, estado: 'borrado' });
      else out.push({ id: a.id, alias: a.codigo, que: `viaje ${v.codigo} · ${v.cliente ?? 'sin cliente'}${v.destino ? ` · ${v.destino}` : ''}${v.abierto ? '' : ' · ya cerrado'}`, estado: 'vigente' });
    }
    return out;
  };

  return {
    bot: BOT_BANDEJA,
    registros,
    ...(prepararTurno ? { prepararTurno, ventanaAdjuntosMs: VENTANA_ADJUNTOS_BANDEJA_MS } : {}),
    lecturas: LECTURAS,
    acciones: ACCIONES,
    datosProponer: DATOS_PROPONER,
    leer: (n, a) => leer(n, a),
    proponer,
    ejecutar,
    trasEjecutar,
    cierres: CIERRES,
    cerrar,
    sigueVigente(p, ctx) {
      if (p.accion !== 'cargar_tanda' && p.accion !== 'descartar') return true;
      const ahora = tanda(ctx.conversacion).map((f) => f.id).join(',');
      return ahora === ((p.datos.mensajes as string[] | undefined) ?? []).join(',');
    },
    async estado(ctx) {
      const t = tanda(ctx.conversacion);
      const [nombrados, eq] = await Promise.all([sueltosDe(ctx).then((s) => viajesNombrados(ctx.conversacion, s)), equipoComercial()]);
      const yo = eq === 'error' ? undefined : eq.find((m) => m.esQuienEscribe);
      const lineasEquipo = eq === 'error' || !eq.length ? [] : [
        `Equipo comercial (quién puede llevar un viaje nuevo): ${nombresDelEquipo(eq)}. ${yo ? `Si quien te escribe dice «yo», es ${yo.nombre}.` : 'Quien te escribe no es del equipo comercial: no puede llevar el viaje.'}`,
        ...(responsablePendiente(ctx.conversacion, eq) ? ['Pendiente: preguntaste quién lleva el viaje nuevo. Si en los mensajes nuevos lo eligió (tocó un nombre, lo escribió o lo dijo en un audio), propón el viaje con esa persona. Si te habla de otra cosa, contéstala y en el mismo mensaje vuelve a preguntar quién lo lleva, con el equipo en `opciones` (salvo que te diga que ya no lo abras).'] : []),
      ];
      return [
        ...lineasEquipo,
        `Tanda abierta: ${t.length ? `${t.length} mensaje${t.length === 1 ? '' : 's'} reenviado${t.length === 1 ? '' : 's'} sin cargar` : 'ninguna'}.`,
        `Viajes nombrados en esta conversación: ${nombrados.length ? nombrados.join(', ') : 'ninguno'}.`,
        // Solo con archivos en la conversación (sin ellos el Estado es el de siempre).
        ...(prepararTurno ? lineasAdjuntos(ctx.conversacion) : []),
        // En vivo (2026-10-07) el bot buscó a la comercial como si fuera la clienta.
        `${ctx.remitente.nombre} es del equipo, no es un cliente: no lo busques ni lo propongas como cliente.`,
      ];
    },
  };
}
