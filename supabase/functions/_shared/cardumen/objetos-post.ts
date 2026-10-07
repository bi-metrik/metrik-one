// Cardumen modo `objetos` — la via BUENA de regreso: el POST de la pagina continua la
// secuencia, y la contencion de seguridad que eso obliga.
//
// POR QUE EXISTE. Hasta el 2026-10-06 el regreso al chat dependia de que la persona tocara
// "Volver al chat y seguir", que abria un `wa.me` con el texto `Listo <objeto> 50-30-20`
// prellenado; el bot leia ese texto y avanzaba. Medido con un telefono real: desde el
// navegador interno de WhatsApp un `wa.me` NO devuelve a la conversacion, RELANZA la app. La
// persona queda en el chat de MeTRIK pero no donde salio, y el hilo se siente roto. Ahora la
// pagina le dice que cierre la ventana —el cierre nativo del navegador interno la deja
// exactamente donde estaba— y el bot continua solo al recibir el POST.
//
// ⚠️⚠️ EL RIESGO QUE ESTO ABRE, Y ES EL PUNTO ENTERO DE ESTE MODULO. `cardumen-ingesta` es
// un endpoint PUBLICO y SIN AUTENTICACION (`verify_jwt = false`): la pagina es HTML estatico
// en otro dominio y quien responde no tiene sesion de Supabase. Hasta este cambio, un POST
// falso solo escribia una fila de basura en `cardumen_respuestas`. Con la continuacion, un
// POST falso haria que el bot MANDE UN MENSAJE DE WHATSAPP, o sea que la ingesta se vuelve un
// vector de envio no autorizado (spam con el numero de MeTRIK, y con cargo de Meta).
//
// LAS CUATRO INVARIANTES QUE LO CONTIENEN. Cada una tiene su prueba en `objetos-post.test.ts`
// y cada una se verifico por mutacion (quitarla hace caer su caso):
//
//   I1. Solo se continua si hay una sesion de objetos ABIERTA para ese telefono. Sin sesion
//       abierta la fila se guarda y NO se envia nada. Un telefono que nunca le escribio al
//       bot no es alcanzable por esta via.
//   I2. EL DESTINO SALE DE LA SESION, NUNCA DEL CUERPO DEL POST. El `token` del POST se usa
//       para BUSCAR la fila de sesion; a quien se le escribe es a `cardumen_chat_sessions.phone`
//       de la fila encontrada. Es la invariante que cierra el agujero: el cuerpo no puede
//       nombrar un destinatario, solo puede acertar o no una sesion que ya existe.
//   I3. El `objeto` del POST tiene que ser EXACTAMENTE el paso pendiente de esa sesion, y el
//       `estudio` del POST el mismo de la sesion. Un objeto que no corresponde no envia nada:
//       asi un POST valido no se puede repetir N veces para mandar N mensajes.
//   I4. Tope de envios por telefono y por ventana de tiempo (ver `TOPE_ENVIOS_POST`).
//
// Lo que esto NO vuelve imposible queda dicho en el PR: quien conozca un telefono con sesion
// abierta Y acierte el id del paso pendiente puede empujar el avance de ESA sesion una vez
// por paso. El dano maximo es el que ya cabe en la secuencia (4 repartos en el instrumento
// mas largo), con el tope de I4 encima.

import {
  avanceDesdePaso,
  normalizarIdObjeto,
  pasoPendiente,
  type EstadoObjetos,
  type PasoQueEspera,
  type PasoReparto,
  type SpecObjetos,
} from "./objetos.ts";

/**
 * Tope de envios disparados por el POST, por telefono y por ventana.
 *
 * El numero sale del instrumento, no del dedo: el guion mas largo (adultos) tiene CUATRO
 * pasos de reparto (`quien_decidio`, `sentia_vs_esperaban`, `semana`, `preocupaciones`) y el
 * de ninos tres. O sea que una entrevista entera y honesta dispara como maximo cuatro envios
 * por esta via, repartidos en los minutos que la persona tarda en moverlos. Seis deja la
 * mitad de margen para un caso que no vimos y aun asi acota una inundacion a seis mensajes
 * cada diez minutos por telefono — que es menos de lo que cuesta una conversacion de servicio.
 *
 * Un reintento del MISMO objeto no gasta cupo: lo frena I3 antes de llegar aqui.
 */
export const TOPE_ENVIOS_POST = 6;

/** Ventana del tope de arriba. */
export const VENTANA_ENVIOS_POST_MS = 10 * 60 * 1000;

/** Marca con la que la pagina declara que el envio es de UN paso suelto, no del instrumento completo. */
export const MODO_OBJETO_SUELTO = "objeto_suelto";

/**
 * Lo que el POST dice que trae, o null si no es un envio de un paso suelto.
 *
 * Se exige `modo: 'objeto_suelto'` Y un `objeto` usable. Un envio del instrumento COMPLETO
 * (el que esta en evaluacion con la metodologa) no tiene ninguna de las dos cosas y por eso
 * no toca este camino: se guarda y nada mas, como siempre.
 */
export function leerEnvioDeObjeto(payload: Record<string, unknown>): { objeto: string } | null {
  if (payload.modo !== MODO_OBJETO_SUELTO) return null;
  const crudo = typeof payload.objeto === "string" ? payload.objeto : "";
  const objeto = normalizarIdObjeto(crudo);
  if (!objeto) return null;
  return { objeto };
}

/**
 * Telefono con el que buscar la sesion, a partir del `token` del cuerpo.
 *
 * NO es el destino del mensaje (eso lo decide I2): es solo la llave de busqueda. Se tolera un
 * `+` adelante porque el telefono viaja por la query de la pagina y de vuelta en el cuerpo, y
 * un `+` que se perdio o se gano no tiene por que romper el regreso. Lo que NO se toca es un
 * token que no parece un telefono (un BSUID de WhatsApp, `CO.1234...`): ahi los digitos no
 * son el identificador y limpiarlo lo destruiria.
 */
export function telefonoDeToken(token: string | null): string | null {
  const t = (token ?? "").trim();
  if (!t) return null;
  if (/^\+?\d{6,20}$/.test(t)) return t.replace(/^\+/, "");
  return t;
}

/**
 * Llave con la que un envio de paso suelto NO deja dos filas: `(estudio, token, objeto)`.
 *
 * POR QUE NO ALCANZA LA QUE YA HABIA. `cardumen-ingesta` desduplica por el id de sesion del
 * payload, y el id de sesion de la pagina es un uuid NUEVO en cada carga; el que escribe el
 * camino del texto es `wa-<telefono>-<paso>`. O sea que los dos caminos de regreso nunca
 * colisionan por esa llave y, en el orden texto→POST, el POST insertaba una SEGUNDA fila del
 * mismo reparto: dos vectores del mismo paso, uno medido y uno aproximado, sin que el
 * analisis pueda saber cual es cual. Con esta llave el POST ACTUALIZA la fila que ya existe,
 * y el vector medido —que es el autoritativo— se queda con el lugar.
 *
 * Sin `token` no hay llave: una pagina abierta sin `?p=` no se puede atribuir a nadie, asi
 * que cae en el camino viejo (id de sesion) y no continua ninguna secuencia.
 */
export function llaveDelPasoSuelto(
  cuerpo: { estudio: string; token: string | null; payload: Record<string, unknown> },
): { estudio: string; token: string; objeto: string } | null {
  const envio = leerEnvioDeObjeto(cuerpo.payload);
  if (!envio) return null;
  const token = (cuerpo.token ?? "").trim();
  if (!token) return null;
  return { estudio: cuerpo.estudio, token, objeto: envio.objeto };
}

/** Conteo de la ventana del tope, ya resuelto contra `ahora`. */
export interface CupoEnvios {
  permitido: boolean;
  /** Valor que hay que guardar en `estado.post_envios`. Satura: no crece sin limite. */
  envios: number;
  /** Valor que hay que guardar en `estado.post_ventana`. */
  ventana: string;
}

/**
 * Cuenta este envio contra el tope por telefono.
 *
 * La ventana es FIJA desde el primer envio, no deslizante: es lo que se puede guardar en dos
 * campos del estado sin inventar una tabla, y para acotar una inundacion alcanza. Un estado
 * sin ventana (o con una ventana vencida, o con basura en el campo) abre una nueva.
 *
 * El conteo se guarda TAMBIEN cuando el envio queda bloqueado: si no, cada intento rechazado
 * reabriria la ventana y el tope seria decorativo.
 */
export function contarEnvioPorPost(estado: EstadoObjetos, ahora: Date): CupoEnvios {
  const abierta = Date.parse(estado.post_ventana ?? "");
  const vigente = Number.isFinite(abierta) && ahora.getTime() - abierta < VENTANA_ENVIOS_POST_MS &&
    ahora.getTime() >= abierta;
  if (!vigente) {
    return { permitido: true, envios: 1, ventana: ahora.toISOString() };
  }
  const previos = Number.isInteger(estado.post_envios) && (estado.post_envios as number) > 0
    ? (estado.post_envios as number)
    : 0;
  const n = previos + 1;
  return {
    permitido: n <= TOPE_ENVIOS_POST,
    envios: Math.min(n, TOPE_ENVIOS_POST + 1),
    ventana: new Date(abierta).toISOString(),
  };
}

export type DecisionPost =
  /** La secuencia ya no espera nada: no se envia (la sesion deberia estar cerrada). */
  | { tipo: "sin_paso" }
  /**
   * I3. El objeto del POST no es el paso pendiente de esta sesion (o el estudio no es el de
   * la sesion). Se guarda la fila y NO se envia nada.
   */
  | { tipo: "no_corresponde"; motivo: "otro_estudio" | "ya_recibido" | "no_es_el_pendiente"; pendiente: PasoQueEspera }
  /** I4. El telefono paso el tope de la ventana. No se envia; el conteo si se guarda. */
  | { tipo: "tope"; estado: EstadoObjetos }
  /** Avanza: se dicen los `bot` que vengan y se manda el siguiente paso. */
  | { tipo: "avanza"; paso: PasoReparto; textos: string[]; siguiente: PasoQueEspera; estado: EstadoObjetos }
  /** Era el ultimo: se dicen los `bot` que queden y se cierra la sesion. */
  | { tipo: "cierra"; paso: PasoReparto; textos: string[]; estado: EstadoObjetos };

/**
 * Que hace el bot cuando le llega el POST de un paso suelto. Pura: no toca base ni red.
 *
 * Recibe el estudio del CUERPO y el estado de la SESION, y lo primero que hace es exigir que
 * coincidan. No es paranoia de mas: si no se comparara, una sesion abierta del estudio de
 * adultos serviria para empujar pasos nombrados con los ids del de ninos.
 */
export function decidirContinuacionPost(
  spec: SpecObjetos,
  estado: EstadoObjetos,
  entrada: { estudio: string; objeto: string; ahora: Date },
): DecisionPost {
  const pendiente = pasoPendiente(spec, estado);
  if (!pendiente) return { tipo: "sin_paso" };

  if (entrada.estudio !== estado.study_id) {
    return { tipo: "no_corresponde", motivo: "otro_estudio", pendiente };
  }
  // Un objeto ya recibido es el caso normal de un link viejo reabierto: la secuencia NO
  // retrocede y tampoco se reenvia el paso pendiente. Reenviarlo seria justo el boton que
  // convierte un POST repetible en N mensajes.
  if (estado.recibidos.includes(entrada.objeto)) {
    return { tipo: "no_corresponde", motivo: "ya_recibido", pendiente };
  }
  if (pendiente.tipo !== "reparto" || pendiente.id !== entrada.objeto) {
    return { tipo: "no_corresponde", motivo: "no_es_el_pendiente", pendiente };
  }

  const cupo = contarEnvioPorPost(estado, entrada.ahora);
  const conCupo = { ...estado, post_envios: cupo.envios, post_ventana: cupo.ventana };
  if (!cupo.permitido) return { tipo: "tope", estado: conCupo };

  const a = avanceDesdePaso(spec, conCupo, pendiente, true);
  return a.siguiente
    ? { tipo: "avanza", paso: pendiente, textos: a.textos, siguiente: a.siguiente, estado: a.estado }
    : { tipo: "cierra", paso: pendiente, textos: a.textos, estado: a.estado };
}
