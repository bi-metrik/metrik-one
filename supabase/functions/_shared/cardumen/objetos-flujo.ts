// Cardumen modo `objetos` — los envios de WhatsApp de la secuencia.
//
// Aparte de `objetos.ts` porque este modulo importa `wa-respond.ts`, que lee `Deno.env` al
// cargar y por eso no se puede colectar desde vitest. Aqui NO vive ninguna decision: todo lo
// que se puede equivocar (parseo, avance, url) esta en `objetos.ts` y tiene pruebas.
//
// Mensajes CORTOS y con la accion ARRIBA (regla de MeTRIK para WhatsApp), y siempre por
// `sendCtaUrl`: un link de texto plano saca a la persona de la app, el CTA abre el navegador
// interno y la deja a un toque de volver al chat.

import { sendCtaUrl, sendTextMessage } from "../wa-respond.ts";
import { ctxCardumen } from "./telemetria.ts";
import {
  cargarEstudioObjetos,
  decidirObjetos,
  estadoInicialObjetos,
  guardarSesionObjetos,
  guardarVectorDeTexto,
  hayRegistroDelObjeto,
  objetoPendiente,
  urlDelObjeto,
  type EstadoObjetos,
  type EstudioObjetos,
  type ObjetoDelSpec,
  type RepartoLeido,
  type SpecObjetos,
} from "./objetos.ts";

// El cliente de Supabase llega sin tipos generados (esto corre en Deno, no en Next):
// mismo alias que el resto de los modulos de Cardumen.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = any;

const CTA = "Abrir";

/** Lo que se le dice a quien manda algo que no es un reparto. Sin jerga y sin error tecnico. */
const NO_ENTENDIDO = "Toca el botón y repártelo ahí; cuando termines me vuelve el mensaje solo.";

const ENCUADRE_GENERICO =
  "🐟 *Cardumen*\n\nToca el botón: se abre una figura y la repartes con el dedo.";

const CIERRE_GENERICO = "Listo, eso era todo. Gracias: tus repartos ya forman parte del cardumen.";

function etiqueta(objeto: ObjetoDelSpec): string {
  return objeto.titulo ?? objeto.id.replace(/_/g, " ");
}

/** Mensaje con el boton del paso. `encabezado` va arriba porque es lo que la persona lee. */
async function mandarPaso(
  phone: string,
  estudio: string,
  spec: SpecObjetos,
  objeto: ObjetoDelSpec,
  encabezado: string,
): Promise<void> {
  const url = urlDelObjeto(spec.base_url, estudio, objeto.id, phone);
  const cuerpo = `${encabezado}\n\n*${etiqueta(objeto)}*`;
  await sendCtaUrl(phone, cuerpo, CTA, url, ctxCardumen(estudio, cuerpo));
}

/** Abre la secuencia: encuadre (con el aviso de datos) y el boton del primer objeto. */
export async function startObjetos(
  supabase: Supa,
  phone: string,
  est: EstudioObjetos,
  _waMessageId?: string,
): Promise<void> {
  const estado = estadoInicialObjetos(est.estudio);
  const primero = objetoPendiente(est.spec, estado);
  if (!primero) {
    console.error(`[cardumen-objetos] estudio '${est.estudio}' sin objetos: no se abre`);
    return;
  }
  await guardarSesionObjetos(supabase, phone, estado, false);
  await mandarPaso(phone, est.estudio, est.spec, primero, est.spec.encuadre ?? ENCUADRE_GENERICO);
  console.log(`[cardumen-objetos] abierta '${est.estudio}' para ${phone} en '${primero.id}'`);
}

/**
 * Registra el reparto SOLO si no hay fila para (estudio, participante, objeto). El vector
 * autoritativo es el del POST de la pagina; este es el respaldo marcado para cuando ese POST
 * se cayo. Ver `guardarVectorDeTexto`.
 */
async function registrarSiFalta(
  supabase: Supa,
  estudio: string,
  phone: string,
  objeto: ObjetoDelSpec,
  reparto: RepartoLeido,
): Promise<void> {
  if (await hayRegistroDelObjeto(supabase, estudio, phone, objeto.id)) return;
  await guardarVectorDeTexto(supabase, estudio, phone, objeto, reparto);
  console.log(`[cardumen-objetos] ${phone} objeto '${objeto.id}': vector del TEXTO (el POST no llego)`);
}

/** Atiende un mensaje dentro de una secuencia abierta. */
export async function continueObjetos(
  supabase: Supa,
  phone: string,
  estado: EstadoObjetos,
  texto: string,
): Promise<void> {
  const est = await cargarEstudioObjetos(supabase, estado.study_id);
  if (!est) {
    // El estudio se apago o la fila cambio de modo a mitad de la secuencia. Se cierra en vez
    // de dejar a la persona mandando mensajes a un bot que no le responde.
    await guardarSesionObjetos(supabase, phone, estado, true);
    const t = "Por ahora cerramos aquí. Gracias por lo que ya repartiste.";
    await sendTextMessage(phone, t, ctxCardumen(estado.study_id, t));
    console.warn(`[cardumen-objetos] sesion de ${phone} cerrada: estudio '${estado.study_id}' no resuelve`);
    return;
  }

  const decision = decidirObjetos(est.spec, estado, texto);
  if (!decision) {
    // Secuencia agotada con la sesion abierta (spec acortado despues de empezar).
    await guardarSesionObjetos(supabase, phone, estado, true);
    const t = est.spec.cierre ?? CIERRE_GENERICO;
    await sendTextMessage(phone, t, ctxCardumen(est.estudio, t));
    return;
  }

  if (decision.tipo === "no_entendido") {
    await mandarPaso(phone, est.estudio, est.spec, decision.pendiente, NO_ENTENDIDO);
    return;
  }

  await registrarSiFalta(supabase, est.estudio, phone, decision.objeto, decision.reparto);

  if (decision.tipo === "fuera_de_secuencia") {
    // Link viejo reabierto: el registro vale, pero la secuencia NO retrocede.
    const cab = decision.repetido
      ? "Ese ya lo tenía. Seguimos con el que falta:"
      : "Recibido. Nos faltaba este:";
    await mandarPaso(phone, est.estudio, est.spec, decision.pendiente, cab);
    return;
  }

  if (decision.tipo === "avanza") {
    await guardarSesionObjetos(supabase, phone, decision.estado, false);
    await mandarPaso(phone, est.estudio, est.spec, decision.siguiente, "Recibido. Sigue:");
    return;
  }

  // cierra
  await guardarSesionObjetos(supabase, phone, decision.estado, true);
  const t = est.spec.cierre ?? CIERRE_GENERICO;
  await sendTextMessage(phone, t, ctxCardumen(est.estudio, t));
  console.log(`[cardumen-objetos] ${phone} termino '${est.estudio}'`);
}

/**
 * Recordatorio del paso pendiente (lo llama `cardumen-cron`).
 *
 * UN solo recordatorio: lo garantiza `reminded_at`, la misma columna y la misma ventana
 * (2-24h de inactividad) que ya usa el recordatorio del chat. No se inventa otro mecanismo.
 */
export async function recordatorioObjetos(
  supabase: Supa,
  phone: string,
  estado: EstadoObjetos,
): Promise<boolean> {
  const est = await cargarEstudioObjetos(supabase, estado.study_id);
  if (!est) return false;
  const pendiente = objetoPendiente(est.spec, estado);
  if (!pendiente) return false;
  await mandarPaso(
    phone,
    est.estudio,
    est.spec,
    pendiente,
    "¿Seguimos? Te quedó uno a medias:",
  );
  return true;
}
