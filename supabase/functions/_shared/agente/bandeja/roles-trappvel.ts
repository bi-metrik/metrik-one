// ============================================================
// Los dos roles de Trappvel por el número de Agus (`wa_one`), aprobados por Mauricio el 2026-10-29
// ------------------------------------------------------------
//   · `mano_derecha` (el dueño): todo lo de viajes + las funciones de ONE conectadas (gastos con soporte, pagos
//     recibidos, actividades, consulta de negocios y de gastos, ver cifras). Sin `equipo.contactos`: el cliente se crea
//     con `crear_cliente` de viajes (dos formas de crear lo mismo confunden).
//   · `asesor_viajes` (las asesoras comerciales): lo de viajes.
//   · El paso a una persona de los dos: `wa_link` al WhatsApp de MeTRIK («alguien de MeTRIK»).
// Las fichas de cada rol salen de aquí (una sola fuente): las del reglamento de la bandeja que hoy atiende (`base`) más
// lo del rol. El arnés (`arnes/correr.ts --rol <clave>`) corre con estas mismas fichas y su banco trae su
// `huellaPublicable`; el SQL de publicación (`roles-trappvel-sql.ts`) las escribe tal cual en `bot_parametros`. Quién
// tiene qué rol NO vive aquí: llega al generador en un JSON fuera del repo (ver `docs/asistentes/roles-trappvel.md`).
//
// La base: el reglamento de la bandeja que tiene el código (`conPerfil(REGLAMENTO_ANEXO_A)`, el mismo del arnés). Si el
// publicado en producción es otro (la agencia lo pudo ajustar), el SQL se niega a publicar (compara su huella) y se vuelve a
// generar con `--fichas-base <json>` (las fichas publicadas, exportadas con el SELECT que trae el SQL): así el rol nunca
// le cambia a la bandeja un texto que ya estaba aprobado.
// ============================================================

import { fichasOne } from '../one/reglamento.ts';
import { ESCALAMIENTO_METRIK } from '../persona.ts';
import type { Ficha } from '../tipos.ts';
import { REGLAMENTO_ANEXO_A } from './reglamento-anexo-a.ts';
import { conPerfil } from './reglamento-perfil.ts';

export const WS_TRAPPVEL = 'cdd87e5d-5a55-4f6c-a563-7a6ba7800cdc';
export type ClaveRolTrappvel = 'mano_derecha' | 'asesor_viajes';
export const ROLES_TRAPPVEL: ClaveRolTrappvel[] = ['mano_derecha', 'asesor_viajes'];

const FUENTE = 'Roles de Trappvel, aprobados por Mauricio el 2026-10-29';

export const FUNCIONES_VIAJES_ROL = ['equipo.viajes_consulta', 'equipo.viajes_registro', 'equipo.clientes_viaje', 'equipo.autorizacion_datos'];
export const FUNCIONES_ONE_MANO_DERECHA = ['equipo.gastos', 'equipo.ingresos', 'equipo.actividades', 'equipo.consulta_negocio', 'equipo.consulta_gastos', 'equipo.ver_plata'];

/** Las funciones de cada rol (las de `rol.funciones`), sin las comunes que pone el componedor salvo `comun.persona`. */
export const FUNCIONES_ROL: Record<ClaveRolTrappvel, string[]> = {
  mano_derecha: [...FUNCIONES_VIAJES_ROL, ...FUNCIONES_ONE_MANO_DERECHA, 'comun.persona'],
  asesor_viajes: [...FUNCIONES_VIAJES_ROL, 'comun.persona'],
};

/** Las funciones que la empresa tiene que tener prendidas (todas las de los dos roles, sin comunes). */
export const FUNCIONES_PRENDER: string[] = [...FUNCIONES_VIAJES_ROL, ...FUNCIONES_ONE_MANO_DERECHA];

/** La base: el reglamento de la bandeja que tiene el código (el del arnés). */
export const fichasBaseBandeja = (): Ficha[] => conPerfil(REGLAMENTO_ANEXO_A);

const g = (clave: string, carga: Ficha['carga'], cuando: string | null, hacer: string, herramientas: string[] | null = null): Ficha =>
  ({ clave, tipo: 'guia', carga, cuando, hacer, herramientas, fuente: FUENTE });

// ── Lo común a los dos roles ─────────────────────────────────────────────────

const ESCALAMIENTO: Ficha = {
  clave: 'rol.escalamiento', tipo: 'alcance', carga: 'siempre',
  hacer: 'Si pide hablar con una persona, o no logras ayudarle, pásalo con `pasar_a_persona`.',
  valores: { modo: 'wa_link', numero: ESCALAMIENTO_METRIK.numero, atiende: 'alguien de MeTRIK', boton: 'Escribir a MeTRIK', umbral_no_pude: 2, umbral_correcciones: 3 },
  fuente: FUENTE,
};

const SALUDO: Ficha = {
  clave: 'rol.saludo', tipo: 'estilo', carga: 'siempre',
  // «Y preséntate con tu nombre» (Trappi, Mauricio 2026-10-30): sin eso no se presentaba (md-saludo 0/3). Reescrita entera
  // («Al empezar la conversación, saluda… No te vuelvas a presentar…») tumbaba cp-mixto (1/3): se agrega, no se reescribe.
  hacer: 'Saluda corto y por su nombre solo al empezar la conversación, y preséntate con tu nombre; después ve directo a lo que pide. No te presentes en cada mensaje ni cierres con fórmulas.',
  valores: { presentarse: 'primer_contacto' },
  fuente: FUENTE,
};

/** Lo de Mauricio el 29-oct: «que registrar un viaje se sienta natural, no un formulario». */
const NATURAL = g('g.natural', 'siempre', null,
  'Esto es una conversación, no un formulario: los datos del viaje los deduces del contexto (reenvíos, audios, pantallazos, lo ya dicho) y pides solo lo que falta para el siguiente paso, una cosa a la vez; lo que falte para cotizar se completa después con lo que vaya llegando, no lo pidas en serie. Quién lleva un viaje nuevo no es un dato del viaje: nunca sale de quién lo pide ni de quién te escribe; si no lo dijeron, pregúntalo antes de proponer.');

const funcionesFicha = (clave: ClaveRolTrappvel): Ficha => ({
  clave: 'rol.funciones', tipo: 'alcance', carga: 'siempre', hacer: 'Funciones del rol.',
  valores: { funciones: FUNCIONES_ROL[clave] }, fuente: FUENTE,
});

// ── La asesora de viajes ─────────────────────────────────────────────────────

// «Si dice "yo" o "la llevo yo", es suya» ya lo dice el Estado de la bandeja («Si quien te escribe dice «yo», es …»).
// Una ficha propia que lo repetía empujaba al modelo a ponerla por defecto (arnés del 29-oct, r-apodo y r-lista): no va.
const ASESORA: Ficha[] = [];

// ── La mano derecha (el dueño) ───────────────────────────────────────────────

/** Las fichas de ONE que se cambian para la agencia (misma clave). */
function oneParaLaAgencia(f: Ficha): Ficha | null {
  switch (f.clave) {
    // La de crear contactos no va (el rol no la tiene). Las que choca con la bandeja se quitan en `fichasDelRol`.
    case 'g.contacto':
      return null;
    case 'g.una_pregunta':
      // La de la bandeja se queda; esta es la de los gastos.
      return { ...f, clave: 'g.una_pregunta_gasto', cuando: 'te falta algo para proponer un gasto o un ingreso', hacer: 'pregunta UNA cosa, la que falta. Nunca preguntes el concepto, la categoría ni si un número es el monto: un número solo, después de hablar de un gasto, es el monto. Al pedir el monto no des ejemplos con cifras' };
    case 'alc.app':
      return { ...f, cuando: 'piden facturas, crear planes de cobro, pagos que no son de una cuota programada, cambios de etapa, horas, cartera, cerrar viajes, borrar un gasto, cotizar o cambiarle a un gasto algo distinto del monto y el soporte (el monto de un gasto sin revisar sí: `corregir_gasto`; el soporte que le falta: `adjuntar_soporte`)' };
    case 'glo.negocio':
      return { ...f, hacer: 'negocio = en la agencia, cada viaje es un negocio de ONE con el MISMO código («M1 26 5»). Un gasto, un pago recibido o una actividad «del viaje M1 26 5» van a ese negocio; `buscar_negocios`, `ver_negocio` y `negocios_abiertos` también ven los viajes.' };
    // Las de los archivos de ONE dan por hecho que todo archivo es el soporte de un gasto; en la agencia casi siempre es lo
    // que mandó un cliente (la solicitud, un pantallazo). Con el «cuando» de ONE, en el arnés del 2026-10-29 el modelo
    // trataba la solicitud en PDF como soporte (`anotar_en_viaje` con el texto del archivo en vez de `cargar_tanda`) y
    // una factura reenviada con la tanda frenaba la carga del viaje. Aquí aplican solo al recibo de algo que se pagó o al
    // comprobante de un dinero que entró; qué es cada archivo lo decide el modelo por el contexto (`g.viaje_o_gasto`).
    case 'g.soporte':
      return { ...f, cuando: 'llega una foto o un PDF que es el recibo o la factura de algo que se pagó, o el comprobante de un dinero que entró, o la persona habla del soporte de un gasto (lo que mandó un cliente para su viaje no es soporte de un gasto)' };
    case 'g.varios_soportes':
      return { ...f, cuando: 'llegan varios recibos o facturas seguidos para registrar como gastos' };
    case 'g.foto_sola':
      return { ...f, cuando: 'llega una foto o un PDF sin texto, sin «lo que dice el archivo», que no es de un viaje y sin ningún gasto en curso ni registrado sin soporte' };
    case 'g.adjunto_leido':
      return { ...f, cuando: 'hay «lo que dice el archivo» en el soporte de un gasto o de un ingreso' };
    case 'g.nombrar_negocio':
      return { ...f, cuando: 'nombras un negocio al proponer o consultar un gasto, un ingreso o una actividad' };
    case 'g.ayuda':
      return { ...f, hacer: 'en 3 o 4 líneas: abrir viajes y cargarles lo que te pasan los clientes (reenvíos, audios, fotos), consultar cómo va un viaje, crear clientes, registrar gastos con su soporte (foto o PDF, que tú lees), registrar el pago de una cuota que recibió un viaje, anotar actividades y consultar negocios, gastos y cifras. Sin cifras de ejemplo. Tema `ayuda`' };
    default:
      return f;
  }
}

const MANO_DERECHA_PROPIAS: Ficha[] = [
  // «Si no lo dijo, pregunta quién lo lleva» ya lo dice `g.natural`: repetido aquí, el modelo preguntaba quién lleva el
  // viaje antes de crear al cliente nuevo y no lo creaba con «sí, créala» (arnés del 2026-10-29, r-cliente-nuevo).
  g('g.rol_dueno', 'siempre', null,
    'Quien te escribe es el dueño de la agencia: trato directo, sin rodeos. Puede abrir un viaje para cualquiera del equipo comercial: si dice «yo» o «lo llevo yo», lo lleva él (si está en el equipo comercial); si nombra a alguien, esa persona.'),
  // «de la plata» salió del texto el 2026-10-30 (léxico vetado). Medido con Haiku, md-yo: «o un gasto o ingreso» 2/9,
  // «o de un gasto o un pago» 8/9, «o de un gasto» 9/9 (md-gasto-viaje 9/9). Cada palabra de esta ficha mueve casos.
  g('g.viaje_o_gasto', 'siempre', 'llega algo que puede ser de un viaje o de un gasto (una foto, un PDF, un audio, un reenvío)',
    'decide por el contexto, no preguntes por costumbre: un pedido o datos de un cliente (destino, fechas, pasajeros, lo que quiere) van al viaje (`anotar_en_viaje`, `cargar_tanda`, `viaje_nuevo`); un recibo o una factura de algo que se pagó es un gasto (`proponer(gasto)`); un comprobante de dinero que entró es un ingreso. Una llamada, una reunión o una nota de gestión va como actividad del negocio, no como dato del viaje. Si piden cargar una tanda en un viaje y entre lo reenviado viene un recibo que no es del viaje, no frenes la carga por eso: propón `cargar_tanda` con lo del viaje y di en una línea que ese recibo no parece del viaje y que, si quiere, lo registras como gasto después. Si de verdad no se sabe, pregunta en una línea si es para el viaje o un gasto.'),
];

/** El perfil y los temas de la mano derecha: los de la bandeja (con sus valores) más lo de ONE. */
function cabezaManoDerecha(base: Ficha[]): Ficha[] {
  const perfil = base.find((f) => f.clave === 'perfil');
  const temas = base.find((f) => f.clave === 'alc.temas');
  const out: Ficha[] = [];
  if (perfil) out.push({ ...perfil, hacer: `${perfil.hacer.replace(/\.\s*$/, '')}. Además, con el dueño: registrar gastos con su soporte (foto o PDF), los pagos que recibe un viaje, las actividades de un negocio, y consultar negocios, gastos y cifras.`, fuente: FUENTE });
  if (temas) {
    const previos = Array.isArray(temas.valores?.temas) ? (temas.valores!.temas as unknown[]).map(String) : [];
    const nuevos = ['gasto', 'ingreso', 'actividad', 'negocios', 'ayuda'].filter((t) => !previos.includes(t));
    out.push({
      ...temas,
      hacer: `${temas.hacer.replace(/\.\s*$/, '')}. Con el dueño también: gastos (registrarlos, su soporte, consultarlos), ingresos (el pago que un cliente hizo de una cuota de su viaje), actividades de un negocio, el estado de los negocios y sus cifras, y la ayuda de qué puedes hacer.`,
      valores: { ...(temas.valores ?? {}), temas: [...previos, ...nuevos] },
      fuente: FUENTE,
    });
  }
  return out;
}

/**
 * Las fichas del rol: la base (la bandeja de hoy) con lo del rol. La mano derecha además lleva lo de ONE (sin lo que
 * choca) y no lleva `alc.plata` («esta bandeja no consulta cartera, gastos…»: él sí). Pura; mismas fichas para la misma base.
 */
export function fichasDelRol(clave: ClaveRolTrappvel, base: Ficha[] = fichasBaseBandeja()): Ficha[] {
  const propias = [funcionesFicha(clave), ESCALAMIENTO, SALUDO, NATURAL];
  if (clave === 'asesor_viajes') return unir(base, [...propias, ...ASESORA]);
  const cabeza = cabezaManoDerecha(base);
  const cambiadas = new Set(cabeza.map((f) => f.clave));
  const deBase = base.filter((f) => f.clave !== 'alc.plata').map((f) => (cambiadas.has(f.clave) ? cabeza.find((c) => c.clave === f.clave)! : f));
  // Una ficha de ONE con la misma clave que una de la bandeja no va: manda la de la bandeja (sus respuestas fijas, sus
  // invariantes). `rf.no_hice_nada`, que la bandeja no trae, sale del núcleo («Listo, no hice nada.»), como hoy.
  const enBase = new Set(deBase.map((f) => f.clave));
  const deOne = fichasOne('Trappvel').map(oneParaLaAgencia)
    .filter((f): f is Ficha => !!f && !enBase.has(f.clave) && !f.clave.startsWith('rf.'))
    .map((f) => ({ ...f, fuente: f.fuente || 'Reglamento de ONE (one/reglamento.ts)' }));
  return unir(deBase, [...deOne, ...MANO_DERECHA_PROPIAS, ...propias]);
}

/** Agrega fichas nuevas; una clave repetida es un error de código (lanza). Pura. */
function unir(base: Ficha[], nuevas: Ficha[]): Ficha[] {
  const claves = new Set(base.map((f) => f.clave));
  for (const f of nuevas) {
    if (claves.has(f.clave)) throw new Error(`ficha repetida en el rol: ${f.clave}`);
    claves.add(f.clave);
  }
  return [...base, ...nuevas];
}
