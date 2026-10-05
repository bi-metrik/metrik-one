// Cardumen modo `objetos` — los envios de WhatsApp de la entrevista.
//
// Aparte de `objetos.ts` porque este modulo importa `wa-respond.ts` y `wa-transcribe.ts`,
// que leen `Deno.env` al cargar y por eso no se pueden colectar desde vitest. Aqui NO vive
// ninguna decision: todo lo que se puede equivocar (parseo, lectura de opciones, avance,
// url) esta en `objetos.ts` y tiene pruebas.
//
// Mensajes CORTOS y con la accion ARRIBA (regla de MeTRIK para WhatsApp).
//
// LOS ENUNCIADOS SE MANDAN LITERALES. Un paso de relato o de opcion unica se envia con el
// texto del spec y NADA mas pegado: ni saludo, ni acuse, ni reformulacion. Si el enunciado
// cambiara entre participantes, las respuestas dejarian de ser comparables. El acuse, cuando
// hace falta, va en el cuerpo del boton del paso de reparto, que no es un enunciado.

import { sendButtons, sendCtaUrl, sendNumberedMenu, sendTextMessage } from "../wa-respond.ts";
import { transcribeAudio } from "../wa-transcribe.ts";
import { ctxCardumen } from "./telemetria.ts";
import {
  cargarEstudioObjetos,
  decidirObjetos,
  estadoInicialObjetos,
  guardarRespuestaDelPaso,
  guardarSesionObjetos,
  hayRegistroDelObjeto,
  idBotonChip,
  pasoPendiente,
  urlDelObjeto,
  type EstadoObjetos,
  type EstudioObjetos,
  type PasoObjetos,
  type RespuestaDelPaso,
  type SpecObjetos,
} from "./objetos.ts";

// El cliente de Supabase llega sin tipos generados (esto corre en Deno, no en Next):
// mismo alias que el resto de los modulos de Cardumen.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = any;

const CTA = "Abrir";

/**
 * Tope de botones interactivos de WhatsApp. `sendButtons` recorta a 3 EN SILENCIO, asi que
 * un paso con cuatro o cinco opciones perderia opciones sin que nadie se enterara (el
 * instrumento de adultos tiene uno de 4 y el de ninos uno de 5). Arriba de 3 se manda la
 * lista numerada, que es la misma salida que ya eligio Navigate para sus 12 sectores.
 */
const MAX_BOTONES = 3;

/** Lo que se le dice a quien manda algo que no corresponde. Sin jerga y sin error tecnico. */
const NO_ENTENDIDO_REPARTO = "Toca el botón y repártelo ahí; cuando termines me vuelve el mensaje solo.";

/** UNA sola repregunta, y neutra: no repite ni interpreta lo que la persona dijo. */
const REPREGUNTA = "¿Me cuentas un poco más? Con una frase más me alcanza.";

const ENCUADRE_GENERICO =
  "🐟 *Cardumen*\n\nSon unas preguntas cortas. No hay respuestas correctas.";

const CIERRE_GENERICO = "Listo, eso era todo. Gracias: lo que contaste ya forma parte del cardumen.";

function etiqueta(paso: PasoObjetos): string {
  if (paso.tipo === "reparto" && paso.titulo) return paso.titulo;
  return paso.id.replace(/_/g, " ");
}

/**
 * Manda el paso.
 *
 * `acuse` solo se usa en los pasos de reparto, donde el cuerpo del boton no es un enunciado
 * del instrumento. En relato y opcion unica el mensaje es el enunciado LITERAL y nada mas.
 */
async function mandarPaso(
  phone: string,
  estudio: string,
  spec: SpecObjetos,
  paso: PasoObjetos,
  acuse?: string | null,
): Promise<void> {
  if (paso.tipo === "reparto") {
    const url = urlDelObjeto(spec.base_url, estudio, paso.id, phone);
    const cuerpo = acuse ? `${acuse}\n\n*${etiqueta(paso)}*` : `*${etiqueta(paso)}*`;
    await sendCtaUrl(phone, cuerpo, CTA, url, ctxCardumen(estudio, cuerpo));
    return;
  }

  if (paso.tipo === "chips") {
    if (paso.opciones.length <= MAX_BOTONES) {
      const botones = paso.opciones.map((op, i) => ({ id: idBotonChip(paso.id, i), title: op }));
      await sendButtons(phone, paso.pregunta, botones, ctxCardumen(estudio, paso.pregunta));
    } else {
      await sendNumberedMenu(phone, paso.pregunta, paso.opciones, ctxCardumen(estudio, paso.pregunta));
    }
    return;
  }

  // relato: el enunciado, literal, solo.
  await sendTextMessage(phone, paso.pregunta, ctxCardumen(estudio, paso.pregunta));
}

/** Abre la entrevista: encuadre (con el aviso de datos) y el primer paso. */
export async function startObjetos(
  supabase: Supa,
  phone: string,
  est: EstudioObjetos,
  _waMessageId?: string,
): Promise<void> {
  const estado = estadoInicialObjetos(est.estudio);
  const primero = pasoPendiente(est.spec, estado);
  if (!primero) {
    console.error(`[cardumen-objetos] estudio '${est.estudio}' sin pasos: no se abre`);
    return;
  }
  await guardarSesionObjetos(supabase, phone, estado, false);
  // El encuadre va en su PROPIO mensaje: el del paso tiene que ser el enunciado literal.
  const enc = est.spec.encuadre ?? ENCUADRE_GENERICO;
  await sendTextMessage(phone, enc, ctxCardumen(est.estudio, enc));
  await mandarPaso(phone, est.estudio, est.spec, primero, null);
  console.log(`[cardumen-objetos] abierta '${est.estudio}' para ${phone} en '${primero.id}'`);
}

/**
 * Registra la respuesta SOLO si no hay fila para (estudio, participante, paso).
 *
 * En los repartos esto es lo que impide pisar el vector MEDIDO con el aproximado del texto.
 * En los pasos narrativos es la idempotencia: un mensaje reenviado no deja dos filas.
 */
async function registrarSiFalta(
  supabase: Supa,
  estudio: string,
  phone: string,
  paso: PasoObjetos,
  respuesta: RespuestaDelPaso,
): Promise<void> {
  if (await hayRegistroDelObjeto(supabase, estudio, phone, paso.id)) return;
  await guardarRespuestaDelPaso(supabase, estudio, phone, paso, respuesta);
  if (respuesta.tipo === "reparto") {
    console.log(`[cardumen-objetos] ${phone} paso '${paso.id}': vector del TEXTO (el POST no llego)`);
  }
}

export interface MensajeObjetos {
  texto: string;
  /** Id del audio de Meta. Solo se transcribe si el paso pendiente es un relato. */
  audioId?: string | null;
  botonId?: string | null;
}

/** Atiende un mensaje dentro de una entrevista abierta. */
export async function continueObjetos(
  supabase: Supa,
  phone: string,
  estado: EstadoObjetos,
  mensaje: MensajeObjetos,
): Promise<void> {
  const est = await cargarEstudioObjetos(supabase, estado.study_id);
  if (!est) {
    // El estudio se apago o la fila cambio de modo a mitad de la entrevista. Se cierra en vez
    // de dejar a la persona mandando mensajes a un bot que no le responde.
    await guardarSesionObjetos(supabase, phone, estado, true);
    const t = "Por ahora cerramos aquí. Gracias por lo que ya contaste.";
    await sendTextMessage(phone, t, ctxCardumen(estado.study_id, t));
    console.warn(`[cardumen-objetos] sesion de ${phone} cerrada: estudio '${estado.study_id}' no resuelve`);
    return;
  }

  let texto = mensaje.texto || "";
  let deAudio = false;

  // Voz igual que texto, pero SOLO donde la voz es la respuesta: mucha gente va a contar la
  // historia hablando. En un paso de reparto no hay nada que transcribir (la respuesta llega
  // por el enlace de vuelta), y transcribir ahi seria gastar una llamada para nada.
  const pendiente = pasoPendiente(est.spec, estado);
  if (!texto.trim() && mensaje.audioId && pendiente?.tipo === "relato") {
    const r = await transcribeAudio(mensaje.audioId);
    if (!r.text) {
      const t = "No alcancé a entender el audio. ¿Me lo puedes escribir o repetir?";
      await sendTextMessage(phone, t, ctxCardumen(est.estudio, t));
      return;
    }
    texto = r.text;
    deAudio = true;
  }

  const decision = decidirObjetos(est.spec, estado, { texto, botonId: mensaje.botonId, deAudio });
  if (!decision) {
    // Secuencia agotada con la sesion abierta (spec acortado despues de empezar).
    await cerrar(supabase, phone, est, estado);
    return;
  }

  if (decision.tipo === "no_entendido") {
    const acuse = decision.pendiente.tipo === "reparto" ? NO_ENTENDIDO_REPARTO : null;
    await mandarPaso(phone, est.estudio, est.spec, decision.pendiente, acuse);
    return;
  }

  if (decision.tipo === "repregunta") {
    // Se marca el estado ANTES de preguntar: si el envio falla, no se vuelve a repreguntar.
    // Atrapar a alguien en un bucle pidiendole mas es peor que aceptar una respuesta corta.
    await guardarSesionObjetos(supabase, phone, decision.estado, false);
    await sendTextMessage(phone, REPREGUNTA, ctxCardumen(est.estudio, REPREGUNTA));
    return;
  }

  if (decision.tipo === "fuera_de_secuencia") {
    // Link viejo reabierto: el registro vale, pero la secuencia NO retrocede.
    await registrarSiFalta(supabase, est.estudio, phone, decision.paso, { tipo: "reparto", reparto: decision.reparto });
    const acuse = decision.repetido ? "Ese ya lo tenía." : "Recibido.";
    await mandarPaso(phone, est.estudio, est.spec, decision.pendiente, `${acuse} Seguimos con el que falta:`);
    return;
  }

  await registrarSiFalta(supabase, est.estudio, phone, decision.paso, decision.respuesta);

  if (decision.tipo === "avanza") {
    await guardarSesionObjetos(supabase, phone, decision.estado, false);
    await mandarPaso(phone, est.estudio, est.spec, decision.siguiente, acusePara(decision.siguiente));
    return;
  }

  // cierra
  await cerrar(supabase, phone, est, decision.estado);
  console.log(`[cardumen-objetos] ${phone} termino '${est.estudio}'`);
}

/**
 * Acuse del paso que SIGUE. Solo existe para los repartos, porque solo ahi hay un cuerpo que
 * no es enunciado del instrumento. Es neutro a proposito: no nombra ni resume lo que la
 * persona acaba de contar.
 */
function acusePara(siguiente: PasoObjetos): string | null {
  return siguiente.tipo === "reparto" ? "Gracias — ahora una figura." : null;
}

async function cerrar(
  supabase: Supa,
  phone: string,
  est: EstudioObjetos,
  estado: EstadoObjetos,
): Promise<void> {
  await guardarSesionObjetos(supabase, phone, estado, true);
  const t = est.spec.cierre ?? CIERRE_GENERICO;
  await sendTextMessage(phone, t, ctxCardumen(est.estudio, t));
}

/**
 * Recordatorio del paso pendiente (lo llama `cardumen-cron`).
 *
 * UN solo recordatorio: lo garantiza `reminded_at`, la misma columna y la misma ventana
 * (2-24h de inactividad) que ya usa el recordatorio del chat. No se inventa otro mecanismo.
 *
 * El recordatorio es el paso mismo, reenviado. Si es un relato o una opcion unica, lo que se
 * reenvia es el enunciado LITERAL: un "¿seguimos?" pegado adelante lo volveria otro texto.
 */
export async function recordatorioObjetos(
  supabase: Supa,
  phone: string,
  estado: EstadoObjetos,
): Promise<boolean> {
  const est = await cargarEstudioObjetos(supabase, estado.study_id);
  if (!est) return false;
  const pendiente = pasoPendiente(est.spec, estado);
  if (!pendiente) return false;
  await mandarPaso(
    phone,
    est.estudio,
    est.spec,
    pendiente,
    pendiente.tipo === "reparto" ? "¿Seguimos? Te quedó uno a medias:" : null,
  );
  return true;
}
