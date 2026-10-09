// ============================================================
// Núcleo conversacional — el dominio de la bandeja de solicitudes (Trappvel primero)
// ------------------------------------------------------------
// Las dos lecturas (`buscar`, `ver_viaje`) y los cinco ejecutores de `proponer` (`viaje_nuevo`, `cargar_tanda`,
// `anotar_en_viaje`, `crear_cliente`, `descartar`), con sus candados en código (§3.5):
//   · cliente nuevo: llave escrita en la conversación + guardián (llave de otro, parecidos por nombre); crear exige [Crear];
//   · escribir solo en un viaje nombrado: su código está en un escrito del comercial, en una opción que él tocó, o es el
//     viaje que se acaba de abrir con su toque;
//   · lo reenviado es dato: un reenvío nunca nombra un viaje para escribir ni dicta el texto a anotar;
//   · la búsqueda que falla dice «no pude revisar», nunca «no existe».
// La base la toca un `PuertoBandeja` (producción: `puerto-supabase.ts`; pruebas y arnés: `memoria.ts`).
// ============================================================

import { llavesDelTexto, tieneLlave } from '../../wa-cliente-reglas.ts';
import type { FichaCliente, Llave } from '../../wa-cliente-reglas.ts';
import { normal } from '../verificador.ts';
import { propuestaVigente } from '../nucleo.ts';
import { escritosDelViaje, mismoEntendido, nombramientos } from './carga.ts';
import { salidasLinkAutorizacion, type AutorizacionAgente } from './autorizacion.ts';
import type { ContextoDominio, DeclaracionHerramienta, Dominio, FilaConversacion, Hechos, Propuesta, ResultadoHerramienta } from '../tipos.ts';

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
}

/** Lo que devuelve `prepararCarga`: lo que cambiaría, lo que faltaría, la duda de la extracción y el plan del toque. */
export interface CargaPreparada { entendido: string[]; falta: string[]; duda?: string; plan: unknown }

export interface PuertoBandeja {
  /** Nombre de la línea donde abre viajes («Viaje a medida»). */
  linea(): Promise<string>;
  porNombre(texto: string): Promise<FichaCliente[] | null>;
  porLlave(llave: Llave): Promise<FichaCliente[] | null>;
  /** `null`: no hay viaje con ese código. `'error'`: no se pudo consultar. */
  viaje(codigo: string): Promise<ViajeAgente | null | 'error'>;
  crearViaje(p: { contactoId: string; destino: string | null }): Promise<{ id: string; codigo: string; nombre: string }>;
  /**
   * La extracción de hoy, sin escribir: lo que cambiaría y lo que faltaría. `plan` es lo que se escribe con el toque.
   * `previo`: el plan de la propuesta pendiente del mismo viaje, que se une (lo nuevo gana solo en el mismo campo).
   */
  prepararCarga(viajeId: string, textos: string[], previo?: unknown): Promise<CargaPreparada>;
  /** `escritos`: lo que quedó escrito, por etiqueta y legible (`registradoDe`). */
  cargar(viajeId: string, plan: unknown): Promise<{ lineas: string[]; escritos?: Record<string, string> }>;
  crearCliente(nombre: string, llave: Llave): Promise<{ ok: true; id: string; nombre: string } | { ok: false; motivo: string }>;
  /**
   * La autorización de datos del contacto: si ya autorizó (y cuándo), o el link vigente (lo reusa o lo crea). `'error'`:
   * no se pudo revisar. No escribe nada en el contacto: a lo sumo crea el enlace pendiente.
   */
  autorizacion(contactoId: string): Promise<AutorizacionAgente | 'error'>;
}

export const BOT_BANDEJA = 'bandeja-solicitudes';
export const ACCIONES = ['viaje_nuevo', 'cargar_tanda', 'anotar_en_viaje', 'crear_cliente', 'descartar'];
const RE_CODIGO = /\b[A-ZÑ]\d{0,2} \d{2} \d{1,4}\b/gu;

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
 */
export function viajesNombrados(filas: FilaConversacion[]): string[] {
  return [...new Set(nombramientos(filas, opcionNombrada).map((x) => x.clave).filter((c) => !c.startsWith('nuevo:')))];
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
 * La fila del mensaje `#n` que el modelo dice que abrió el pedido del viaje (`desde`): tiene que ser un escrito del equipo
 * en la conversación. El número es el de la ventana que vio el modelo; se guarda el id, que no se corre. Pura.
 */
export function filaDesde(filas: FilaConversacion[], desde: unknown): { id: string } | null | 'invalida' {
  if (desde === undefined || desde === null || desde === '') return null;
  const n = Number(String(desde).replace(/^#/, '').trim());
  const f = Number.isInteger(n) && n >= 1 ? filas[n - 1] : undefined;
  return f && delEquipo(f) ? { id: f.id } : 'invalida';
}

/** ¿El dato está escrito en la conversación (del equipo o reenviado), no solo dicho por el bot? */
function enLaConversacion(filas: FilaConversacion[], dato: string): boolean {
  const d = normal(dato).trim();
  return !!d && filas.filter(noBot).some((f) => normal(f.texto ?? '').includes(d));
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
  cliente: { type: 'string', description: 'viaje_nuevo: la ref de la ficha tal como la devolvió buscar.' },
  destino: { type: 'string', description: 'viaje_nuevo: el destino, si lo dijeron.' },
  desde: { type: 'integer', description: 'viaje_nuevo: el número (#n) del mensaje del comercial donde empezó a pedir este viaje, si fue antes de este turno. El sistema lee desde ahí lo que dijo del viaje.' },
  viaje: { type: 'string', description: 'cargar_tanda / anotar_en_viaje: el código del viaje.' },
  texto: { type: 'string', description: 'anotar_en_viaje: opcional. El sistema lee TODO lo que el comercial escribió de ese viaje en la conversación (también lo de antes de abrirlo) y lo une con la propuesta pendiente.' },
  nombre: { type: 'string', description: 'crear_cliente: el nombre como lo escribieron.' },
  llave: { type: 'string', description: 'crear_cliente: el celular, correo o usuario tal como lo escribieron.' },
  distinto_de_parecidos: { type: 'boolean', description: 'crear_cliente: true solo si ya mostraste los parecidos y el comercial dijo que es otra persona.' },
};

// ── El dominio ───────────────────────────────────────────────────────────────

/**
 * La propuesta de cargar o anotar: el resumen con lo que cambiaría y lo que seguiría faltando. Si la extracción tiene una
 * duda (Mauricio, 2026-10-07: «no se invente esas cifras, puede preguntar»), va arriba, en la misma burbuja: lo demás
 * sigue anotable con el toque y la respuesta del comercial se lee en el turno siguiente como cualquier dato. Va dentro
 * del resumen para que nunca la corte el tope de Meta (`salidaPropuesta` corta lo de arriba, no el resumen). Pura.
 */
export function propuestaDeCarga(
  accion: 'cargar_tanda' | 'anotar_en_viaje',
  v: { id: string; codigo: string; nombre: string },
  prep: CargaPreparada,
  mensajes: string[],
): Propuesta {
  const verbo = accion === 'cargar_tanda' ? `¿Cargo esto en ${v.codigo} · ${v.nombre}?` : `¿Lo anoto en ${v.codigo} · ${v.nombre}?`;
  const resumen = [
    ...(prep.duda ? [prep.duda] : []),
    verbo,
    ...(prep.entendido.length ? prep.entendido.map((l) => `• ${l}`) : ['• (no encontré datos del viaje en esto)']),
    prep.falta.length ? `Para cotizar faltaría: ${prep.falta.join(', ')}.` : 'Con esto queda el mínimo para cotizar.',
  ].join('\n');
  return {
    accion, sobre: v.codigo, datos: { viajeId: v.id, codigo: v.codigo, mensajes, plan: prep.plan, entendido: prep.entendido, ...(prep.duda ? { duda: prep.duda } : {}) }, resumen,
    si: accion === 'cargar_tanda' ? 'Cargar' : 'Anotar', no: 'No',
  };
}

export function dominioBandeja(puerto: PuertoBandeja): Dominio {
  const leer = async (nombre: string, args: Record<string, unknown>): Promise<ResultadoHerramienta> => {
    if (nombre === 'buscar') {
      const texto = String(args.texto ?? '').trim();
      if (!texto) return { ok: false, datos: null, error: 'Dime qué buscar: un nombre, un código, un celular o un correo.' };
      const llave = llavesDelTexto(texto);
      const codigos = [...texto.toUpperCase().matchAll(RE_CODIGO)].map((m) => m[0]);
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
      const codigo = String(args.codigo ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
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

  /** El viaje para escribir: nombrado en la conversación y abierto. */
  const viajeParaEscribir = async (ctx: ContextoDominio, codigoDado: unknown): Promise<{ ok: true; v: ViajeAgente } | { ok: false; error: string; candado: string }> => {
    const codigo = String(codigoDado ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!codigo) return { ok: false, error: 'Falta el código del viaje.', candado: 'viaje_nombrado' };
    if (!viajesNombrados(ctx.conversacion).includes(codigo)) {
      return { ok: false, error: `El comercial no nombró ${codigo} en esta conversación. Pregúntale a qué viaje va (puedes mostrarle opciones) o propón un viaje nuevo.`, candado: 'viaje_nombrado' };
    }
    const v = await puerto.viaje(codigo);
    if (v === 'error') return { ok: false, error: 'No pude revisar ese viaje ahora.', candado: 'lectura_fallida' };
    if (!v) return { ok: false, error: `No hay un viaje con el código ${codigo}.`, candado: 'viaje_inexistente' };
    if (!v.abierto) return { ok: false, error: `${codigo} ya no está abierto.`, candado: 'viaje_cerrado' };
    return { ok: true, v };
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
      if (desde === 'invalida') return { ok: false, error: '`desde` tiene que ser el número (#n) de un mensaje escrito por el comercial en la conversación, o vacío.', candado: 'desde_invalido' };
      // La línea solo la nombra este resumen: leerla antes de cada acción eran cuatro consultas en serie delante de la
      // extracción de `anotar_en_viaje` y `cargar_tanda` (medido en vivo, 2026-10-09).
      const linea = await puerto.linea();
      const resumen = `¿Abro este viaje?\n${ficha.ficha.ref}${destino ? ` · ${destino}` : ''} · ${linea}`;
      return { ok: true, propuesta: { accion, datos: { contactoId: ficha.id, cliente: ficha.ficha.nombre, destino, ...(desde ? { desdeFila: desde.id } : {}) }, resumen, si: 'Sí, ábrelo', no: 'No' } };
    }
    if (accion === 'cargar_tanda' || accion === 'anotar_en_viaje') {
      const r = await viajeParaEscribir(ctx, datos.viaje);
      if (!r.ok) return r;
      if (accion === 'cargar_tanda') {
        const t = tanda(ctx.conversacion);
        if (!t.length) return { ok: false, error: 'No hay mensajes reenviados sin cargar. Si el comercial escribió el dato, usa anotar_en_viaje.', candado: 'tanda_vacia' };
        const prep = await puerto.prepararCarga(r.v.id, t.map((f) => f.texto ?? '').filter(Boolean));
        return { ok: true, propuesta: propuestaDeCarga(accion, r.v, prep, t.map((f) => f.id)) };
      }
      // anotar_en_viaje: lo que el comercial escribió de ESE viaje en la conversación, no solo el texto del modelo
      // (en vivo, «salen desde Bogotá» se anotaba sin la fecha ni los pasajeros dichos un mensaje antes).
      let textos = escritosDelViaje(ctx.conversacion, r.v.codigo, opcionNombrada);
      if (!textos.length) {
        const texto = String(datos.texto ?? '').trim();
        if (!texto || !enEscritoDelEquipo(ctx.conversacion, texto)) {
          return { ok: false, error: 'Lo que se anota tiene que ser lo que el comercial escribió (no un reenvío ni una frase tuya).', candado: 'texto_sin_respaldo' };
        }
        textos = [texto];
      }
      // Una pendiente de anotar en el mismo viaje se une, no se pisa.
      const vig = propuestaVigente(ctx.conversacion);
      const pendiente = vig?.accion === 'anotar_en_viaje' && vig.datos.viajeId === r.v.id ? vig : null;
      const prep = await puerto.prepararCarga(r.v.id, textos, pendiente?.datos.plan);
      // La duda cuenta: si el comercial la contestó y no cambió nada más, la propuesta nueva ya no la trae.
      if (pendiente && mismoEntendido([...prep.entendido, ...(prep.duda ? [prep.duda] : [])], [...((pendiente.datos.entendido as string[] | undefined) ?? []), ...(typeof pendiente.datos.duda === 'string' ? [pendiente.datos.duda] : [])])) {
        // Nada nuevo frente a la pendiente: es la misma (el núcleo la reenvía con sus botones, misma huella).
        return { ok: true, propuesta: { accion, sobre: r.v.codigo, datos: pendiente.datos, resumen: pendiente.resumen, si: pendiente.si, no: pendiente.no } };
      }
      if (!prep.entendido.length && prep.duda) {
        return { ok: false, error: `En lo que el comercial escribió de ${r.v.codigo} no hay datos nuevos para anotar, pero hay algo que no quedó claro. No propongas anotar: pregúntale con \`responder\`, tal cual: ${prep.duda}`, candado: 'solo_duda' };
      }
      if (!prep.entendido.length) {
        return { ok: false, error: `En lo que el comercial escribió de ${r.v.codigo} no hay datos nuevos: lo que dijo ya está en el viaje. No propongas anotar: contéstale con \`responder\` (usa ver_viaje si te pregunta qué tiene o qué falta).`, candado: 'sin_datos_nuevos' };
      }
      return { ok: true, propuesta: propuestaDeCarga(accion, r.v, prep, []) };
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
    if (accion === 'descartar') {
      const t = tanda(ctx.conversacion);
      if (!t.length) return { ok: false, error: 'No hay nada reenviado pendiente para descartar.', candado: 'tanda_vacia' };
      return { ok: true, propuesta: { accion, datos: { mensajes: t.map((f) => f.id) }, resumen: `¿Descarto ${t.length === 1 ? 'el mensaje' : `los ${t.length} mensajes`} que me pasaste sin cargar?`, si: 'Descartar', no: 'No' } };
    }
    return { ok: false, error: `Acción desconocida: ${accion}.`, candado: 'accion_desconocida' };
  };

  const ejecutar = async (p: Propuesta, _ctx: ContextoDominio): Promise<Hechos> => {
    const d = p.datos;
    if (p.accion === 'viaje_nuevo') {
      const v = await puerto.crearViaje({ contactoId: String(d.contactoId), destino: (d.destino as string | null) ?? null });
      const det = await puerto.viaje(v.codigo);
      const falta = det && det !== 'error' ? det.faltaCotizar : [];
      return {
        lineas: [
          `Abrí ${v.codigo}${d.destino ? ` · ${d.destino}` : ''} para ${d.cliente}.`,
          ...(falta.length ? [`Para cotizar falta: ${falta.join(', ')}.`] : []),
          'Reenvíame lo que te escribió y lo cargo ahí.',
        ],
        nombrados: [v.codigo],
        escrituras: [{ tipo: 'viaje', id: v.id, codigo: v.codigo, nombre: v.nombre, contactoId: d.contactoId, destino: d.destino ?? null }],
      };
    }
    if (p.accion === 'cargar_tanda' || p.accion === 'anotar_en_viaje') {
      const r = await puerto.cargar(String(d.viajeId), d.plan);
      return {
        lineas: r.lineas,
        consumidos: (d.mensajes as string[] | undefined) ?? [],
        escrituras: [{ tipo: p.accion === 'cargar_tanda' ? 'carga' : 'anotacion', viajeId: d.viajeId, codigo: d.codigo, mensajes: d.mensajes ?? [], ...(r.escritos ? { escritos: r.escritos } : {}) }],
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
    const textos = escritosDelViaje(ctx.conversacion, v.codigo, opcionNombrada, { [`nuevo:${huella}`]: v.codigo });
    if (!textos.length) return null;
    const abri = h.lineas[0];
    let prep: CargaPreparada;
    try {
      prep = await puerto.prepararCarga(v.id, textos);
    } catch {
      return { lineas: [abri, 'No alcancé a leer lo que me escribiste de este viaje: dime «anótalo» y lo vuelvo a leer.'] };
    }
    if (!prep.entendido.length) return prep.duda ? { lineas: [abri, prep.duda] } : null;
    return { lineas: [abri], propuesta: propuestaDeCarga('anotar_en_viaje', { id: v.id, codigo: v.codigo, nombre: v.nombre ?? '' }, prep, []) };
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

  return {
    bot: BOT_BANDEJA,
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
    estado(ctx) {
      const t = tanda(ctx.conversacion);
      const nombrados = viajesNombrados(ctx.conversacion);
      return [
        `Tanda abierta: ${t.length ? `${t.length} mensaje${t.length === 1 ? '' : 's'} reenviado${t.length === 1 ? '' : 's'} sin cargar` : 'ninguna'}.`,
        `Viajes nombrados en esta conversación: ${nombrados.length ? nombrados.join(', ') : 'ninguno'}.`,
        // En vivo (2026-10-07) el bot buscó a la comercial como si fuera la clienta.
        `${ctx.remitente.nombre} es del equipo, no es un cliente: no lo busques ni lo propongas como cliente.`,
      ];
    },
  };
}
