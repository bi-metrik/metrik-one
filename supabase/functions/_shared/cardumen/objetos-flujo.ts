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
  esEstadoObjetos,
  estadoInicialObjetos,
  guardarRespuestaDelPaso,
  guardarSesionObjetos,
  hayRegistroDelObjeto,
  idBotonChip,
  pasoPendiente,
  tramoDesde,
  urlDelObjeto,
  type EstadoObjetos,
  type EstudioObjetos,
  type PasoQueEspera,
  type RespuestaDelPaso,
  type SpecObjetos,
} from "./objetos.ts";
import {
  decidirContinuacionPost,
  leerEnvioDeObjeto,
  telefonoDeToken,
} from "./objetos-post.ts";

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

function etiqueta(paso: PasoQueEspera): string {
  if (paso.tipo === "reparto" && paso.titulo) return paso.titulo;
  return paso.id.replace(/_/g, " ");
}

/**
 * Manda el paso, con el texto del instrumento (`preludio`) que lo precede.
 *
 * `preludio` son los `bot` del guion, LITERALES y en orden, mas (si no hubo ninguno) el acuse
 * generico. Donde el paso es un reparto van DENTRO del cuerpo del boton: el cuerpo no es un
 * enunciado del instrumento, asi que ahi se pueden juntar y se ahorra un mensaje. Donde el
 * paso es un relato o una opcion unica van en un mensaje APARTE, porque el del paso tiene que
 * ser el enunciado literal y nada mas.
 *
 * Si hay texto del instrumento, ese REEMPLAZA al acuse generico: la frase del guion dice lo
 * mismo y mejor (la de adultos empieza, literalmente, con "Gracias.").
 */
async function mandarPaso(
  phone: string,
  estudio: string,
  spec: SpecObjetos,
  paso: PasoQueEspera,
  preludio: string[] = [],
): Promise<void> {
  const previo = preludio.filter((t) => t && t.trim()).join("\n\n");

  if (paso.tipo === "reparto") {
    const url = urlDelObjeto(spec.base_url, estudio, paso.id, phone);
    const cuerpo = previo ? `${previo}\n\n*${etiqueta(paso)}*` : `*${etiqueta(paso)}*`;
    await sendCtaUrl(phone, cuerpo, CTA, url, ctxCardumen(estudio, cuerpo));
    return;
  }

  // El texto del instrumento NO se pega al enunciado: va en su propio mensaje, antes.
  if (previo) await sendTextMessage(phone, previo, ctxCardumen(estudio, previo));

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
  // El tramo inicial: los `bot` de apertura del guion y el primer paso que espera respuesta.
  const tramo = tramoDesde(est.spec, estadoInicialObjetos(est.estudio));
  if (!tramo.paso) {
    console.error(`[cardumen-objetos] estudio '${est.estudio}' sin pasos que esperen respuesta: no se abre`);
    return;
  }
  await guardarSesionObjetos(supabase, phone, tramo.estado, false);
  // El encuadre va SOLO, en su propio mensaje: es el aviso de datos y no se diluye con el
  // texto del instrumento (que entra despues, en `mandarPaso`, como preludio).
  const enc = est.spec.encuadre ?? ENCUADRE_GENERICO;
  await sendTextMessage(phone, enc, ctxCardumen(est.estudio, enc));
  await mandarPaso(phone, est.estudio, est.spec, tramo.paso, tramo.textos);
  console.log(`[cardumen-objetos] abierta '${est.estudio}' para ${phone} en '${tramo.paso.id}'`);
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
  paso: PasoQueEspera,
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
    // Se reenvia el paso, NO el texto del instrumento que ya se dijo: repetirlo entero seria
    // ruido, y el enunciado del paso sigue saliendo literal.
    const acuse = decision.pendiente.tipo === "reparto" ? [NO_ENTENDIDO_REPARTO] : [];
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

  if (decision.tipo === "ya_atendido") {
    // El POST de la pagina ya avanzo este paso y ya mando el siguiente mensaje. El texto es
    // la salida de emergencia: si la via buena funciono, no tiene nada que hacer. Silencio a
    // proposito — un acuse aqui seria un mensaje de mas pegado al que el bot ya mando.
    console.log(`[cardumen-objetos] ${phone} texto de '${decision.paso.id}' ignorado: el POST ya lo atendio`);
    return;
  }

  if (decision.tipo === "fuera_de_secuencia") {
    // Link viejo reabierto: el registro vale, pero la secuencia NO retrocede.
    await registrarSiFalta(supabase, est.estudio, phone, decision.paso, { tipo: "reparto", reparto: decision.reparto });
    const acuse = decision.repetido ? "Ese ya lo tenía." : "Recibido.";
    await mandarPaso(phone, est.estudio, est.spec, decision.pendiente, [`${acuse} Seguimos con el que falta:`]);
    return;
  }

  await registrarSiFalta(supabase, est.estudio, phone, decision.paso, decision.respuesta);

  if (decision.tipo === "avanza") {
    await guardarSesionObjetos(supabase, phone, decision.estado, false);
    await mandarPaso(phone, est.estudio, est.spec, decision.siguiente, preludio(decision.textos, decision.siguiente));
    return;
  }

  // cierra. Los `bot` que queden van ANTES del cierre: un guion puede terminar con texto del
  // instrumento y ese tampoco se puede perder.
  await cerrar(supabase, phone, est, decision.estado, decision.textos);
  console.log(`[cardumen-objetos] ${phone} termino '${est.estudio}'`);
}

/**
 * Lo que va antes del paso: el texto del instrumento si lo hay, y si no el acuse generico.
 *
 * El acuse generico solo existe para los repartos (solo ahi hay un cuerpo que no es enunciado)
 * y es neutro a proposito: no nombra ni resume lo que la persona acaba de contar.
 */
function preludio(textos: string[], siguiente: PasoQueEspera): string[] {
  if (textos.length > 0) return textos;
  return siguiente.tipo === "reparto" ? ["Gracias — ahora una figura."] : [];
}

async function cerrar(
  supabase: Supa,
  phone: string,
  est: EstudioObjetos,
  estado: EstadoObjetos,
  textos: string[] = [],
): Promise<void> {
  await guardarSesionObjetos(supabase, phone, estado, true);
  const previo = textos.filter((t) => t && t.trim()).join("\n\n");
  if (previo) await sendTextMessage(phone, previo, ctxCardumen(est.estudio, previo));
  const t = est.spec.cierre ?? CIERRE_GENERICO;
  await sendTextMessage(phone, t, ctxCardumen(est.estudio, t));
}

// ---------------------------------------------------------------------------------------
// La via BUENA de regreso: el POST de la pagina continua la secuencia
// ---------------------------------------------------------------------------------------

/** Cuerpo ya validado que llega a `cardumen-ingesta`. */
export interface CuerpoDeIngesta {
  estudio: string;
  token: string | null;
  lang: string | null;
  payload: Record<string, unknown>;
}

/**
 * Guarda el paso suelto y continua la secuencia. Es TODO lo que `cardumen-ingesta` hace con
 * un envio del modo `objetos`, junto y aqui, para que vitest lo pueda ejercitar: el handler
 * de la funcion es un `Deno.serve` y desde node no se colecta.
 *
 * LA LLAVE DE NO-DUPLICADO ES `(estudio, token, objeto)`, no el id de sesion del payload. El
 * id de sesion de la pagina es un uuid nuevo en cada carga y el del camino del texto es
 * `wa-<telefono>-<paso>`: por esa llave los dos caminos de regreso NUNCA colisionan, y en el
 * orden texto→POST quedaban DOS filas del mismo reparto —una con el vector medido y otra con
 * el aproximado— sin forma de saber cual es cual. Con esta llave el POST ACTUALIZA la que ya
 * existe y el vector medido, que es el autoritativo, se queda con el lugar.
 *
 * Se guarda ANTES de continuar: un envio de WhatsApp que falla no puede costar el dato.
 */
export async function guardarPasoSueltoYContinuar(
  supabase: Supa,
  cuerpo: CuerpoDeIngesta,
  llave: { estudio: string; token: string; objeto: string },
): Promise<{ id: string | null; duplicado: boolean; continuacion: ResultadoPost | "error" } | null> {
  const { estudio, token, lang, payload } = cuerpo;

  const { data: previa, error: errPrevia } = await supabase
    .from("cardumen_respuestas")
    .select("id")
    .eq("estudio", llave.estudio)
    .eq("token", llave.token)
    .eq("payload->>objeto", llave.objeto)
    .limit(1)
    .maybeSingle();
  if (errPrevia) {
    // Se sigue adelante: este es el vector MEDIDO y perderlo es peor que arriesgar un
    // duplicado (que ademas queda evidente, con el mismo objeto dos veces).
    console.error("[cardumen-objetos] error buscando el paso suelto previo:", errPrevia.message);
  }

  let id: string | null = (previa?.id ?? null) as string | null;
  if (id) {
    const { error } = await supabase
      .from("cardumen_respuestas")
      .update({ payload, lang, token })
      .eq("id", id);
    if (error) {
      console.error("[cardumen-objetos] error actualizando el paso suelto:", error.message);
      return null;
    }
  } else {
    const { data: creada, error } = await supabase
      .from("cardumen_respuestas")
      .insert({ estudio, token, lang, payload })
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[cardumen-objetos] error guardando el paso suelto:", error.message);
      return null;
    }
    id = (creada?.id ?? null) as string | null;
  }

  // Continuar NUNCA puede tumbar el guardado: la fila ya esta escrita cuando se llega aqui.
  let continuacion: ResultadoPost | "error" = "error";
  try {
    continuacion = await continuarObjetosPorPost(supabase, cuerpo);
  } catch (e) {
    console.error("[cardumen-objetos] error continuando la secuencia:", e instanceof Error ? e.message : String(e));
  }
  return { id, duplicado: !!previa?.id, continuacion };
}

/** Lo que paso con un POST, para el log de `cardumen-ingesta`. Nunca lleva contenido. */
export type ResultadoPost =
  | "no_es_objeto"
  | "sin_token"
  | "sin_sesion_abierta"
  | "estudio_no_resuelve"
  | "sin_paso"
  | "no_corresponde"
  | "tope"
  | "avanzo"
  | "cerro";

/**
 * Continua la secuencia al recibir el POST de la pagina. La llama `cardumen-ingesta` DESPUES
 * de guardar la fila: perder el dato por un envio que falla seria el peor cambio posible.
 *
 * Aqui viven las invariantes I1 y I2 de `objetos-post.ts`, que son las que cierran el agujero
 * de un endpoint publico que ahora puede hacer hablar al bot:
 *
 *   I1. Sin sesion de objetos ABIERTA para ese telefono no se envia nada. Y la sesion se
 *       busca con `closed = false`: una entrevista terminada o expirada no se revive.
 *   I2. ⚠️ EL DESTINO ES `fila.phone`, NO el `token` del cuerpo. El token solo sirve de llave
 *       de busqueda; si no acierta una sesion viva, no hay a quien escribirle. Por eso el
 *       cuerpo de un POST no puede nombrar un destinatario y la ingesta no es un relay.
 *
 * El estudio tambien se carga desde `estado.study_id` (la sesion) y no desde el cuerpo: el
 * cuerpo solo se compara, en `decidirContinuacionPost`.
 */
export async function continuarObjetosPorPost(
  supabase: Supa,
  cuerpo: { estudio: string; token: string | null; payload: Record<string, unknown> },
): Promise<ResultadoPost> {
  const envio = leerEnvioDeObjeto(cuerpo.payload);
  if (!envio) return "no_es_objeto";

  const llave = telefonoDeToken(cuerpo.token);
  if (!llave) return "sin_token";

  const { data: fila, error } = await supabase
    .from("cardumen_chat_sessions")
    .select("phone, state, closed")
    .eq("phone", llave)
    .eq("closed", false)
    .maybeSingle();
  if (error) {
    console.error("[cardumen-objetos] error buscando la sesion del POST:", error.message);
    return "sin_sesion_abierta";
  }
  if (!fila || !esEstadoObjetos(fila.state)) return "sin_sesion_abierta";

  // I2, escrito donde se usa: el destino sale de la FILA.
  const destino: string = fila.phone;
  const estado: EstadoObjetos = fila.state;

  const est = await cargarEstudioObjetos(supabase, estado.study_id);
  if (!est) return "estudio_no_resuelve";

  const decision = decidirContinuacionPost(est.spec, estado, {
    estudio: cuerpo.estudio,
    objeto: envio.objeto,
    ahora: new Date(),
  });

  if (decision.tipo === "sin_paso") return "sin_paso";

  if (decision.tipo === "no_corresponde") {
    console.warn(
      `[cardumen-objetos] POST sin continuacion (${decision.motivo}): esperaba '${decision.pendiente.id}'`,
    );
    return "no_corresponde";
  }

  if (decision.tipo === "tope") {
    // Se guarda el conteo aunque no se envie: si no, cada intento rechazado reabriria la
    // ventana y el tope no acotaria nada.
    await guardarSesionObjetos(supabase, destino, decision.estado, false);
    console.warn(`[cardumen-objetos] POST por encima del tope de envios para ${destino}: no se envia`);
    return "tope";
  }

  if (decision.tipo === "avanza") {
    await guardarSesionObjetos(supabase, destino, decision.estado, false);
    await mandarPaso(destino, est.estudio, est.spec, decision.siguiente, preludio(decision.textos, decision.siguiente));
    console.log(`[cardumen-objetos] POST de '${decision.paso.id}' continuo a '${decision.siguiente.id}'`);
    return "avanzo";
  }

  await cerrar(supabase, destino, est, decision.estado, decision.textos);
  console.log(`[cardumen-objetos] POST de '${decision.paso.id}' cerro '${est.estudio}'`);
  return "cerro";
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
    pendiente.tipo === "reparto" ? ["¿Seguimos? Te quedó uno a medias:"] : [],
  );
  return true;
}
