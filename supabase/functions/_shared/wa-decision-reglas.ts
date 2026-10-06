// ============================================================
// Bot híbrido de la bandeja — los puntos de decisión, sin I/O
// ------------------------------------------------------------
// Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-06-bot-hibrido.md
//
// Un PUNTO DE DECISIÓN es una pregunta del bot que espera que el comercial elija: qué viaje, qué cliente, cargar o
// descartar, si es la misma persona. Ahí el bot ya no adivina texto libre:
//   1. La pregunta sale como mensaje interactivo: hasta tres salidas con botones de respuesta (como #1034); elegir
//      viaje o cliente con un mensaje de lista. El id de cada botón y de cada fila lleva la huella de la pregunta.
//   2. El código lee solo lo que no tiene ambigüedad: el toque, un número dentro del rango de la lista vigente, un
//      código de viaje exacto de la lista, un «sí» o un «no» escritos solos y, donde se pide, la llave escrita sola.
//   3. Todo otro texto libre va al modelo con las opciones vigentes y sus ids. El modelo devuelve un id, «contenido»,
//      «pregunta» o «no sé» (y, donde se pide, el nombre copiado tal cual o «corrección»). El código valida el id.
//   4. Si el modelo no responde (timeout, error), el bot NO adivina: «No te entendí; toca una opción».
//
// Cada opción lleva su `canonico`: el texto exacto que el lector de hoy ya entiende sin adivinar («sí», «2»,
// «descartar», «nuevo Ana Ruiz», un código). Así la decisión entra por el mismo camino de siempre y el cron la lee
// igual. Crear un cliente nunca sale de un escrito: esas opciones son `soloToque`.
//
// Límites de Meta, leídos en la documentación oficial el 2026-10-06 (developers.facebook.com/docs/whatsapp/cloud-api/
// messages/interactive-reply-buttons-messages e interactive-list-messages):
//   · botones de respuesta: cuerpo ≤ 1024, hasta 3 botones, título ≤ 20, id ≤ 256;
//   · lista: cuerpo ≤ 4096 (aquí se usa 1024, como en los botones), texto del botón ≤ 20, hasta 10 filas en total,
//     título de fila ≤ 24, descripción ≤ 72, id de fila ≤ 200, título de sección ≤ 24.
// ============================================================

import { botonesSiNo, huella, TEXTO_TOQUE_SIN_PREGUNTA, TITULO_DESCARTAR, TITULO_NO_ES, TITULO_SI_ES } from './wa-botones-bandeja.ts';
import type { BotonBandeja } from './wa-botones-bandeja.ts';
import { nombreDeViaje, nombrePropio, normalizarNombre, normalizarTexto } from './wa-entendimiento-reglas.ts';
import type { ContactoCandidato } from './wa-entendimiento-reglas.ts';
import { codigoCompacto } from './wa-carga-reglas.ts';
import type { OpcionNegocio } from './wa-carga-reglas.ts';
import { datoDeLaFicha, llavesDelTexto, soloLlave, viajesDeLaFicha } from './wa-cliente-reglas.ts';
import type { FichaCliente, Llave } from './wa-cliente-reglas.ts';
import { botonesDelResumen, clientesPorResolver, gruposDelPlan, nombreDestino, numeracion, pendientes, unSoloCliente, viajesParecidos } from './wa-viajes-reglas.ts';
import type { PendienteDeLaCaja, PlanViajes, RespuestaConfirmarNuevo, ViajeAbierto } from './wa-viajes-reglas.ts';

// ── Los límites ──────────────────────────────────────────────────────────────

export const MAX_CUERPO_INTERACTIVO = 1024;
export const MAX_TITULO_BOTON_RESPUESTA = 20;
export const MAX_TEXTO_BOTON_LISTA = 20;
export const MAX_FILAS_LISTA = 10;
export const MAX_TITULO_FILA = 24;
export const MAX_DESCRIPCION_FILA = 72;
export const MAX_ID_FILA = 200;
/** Las filas de viajes de una lista: con «Viaje nuevo» y «Descartar» no se pasa de las 10 de Meta. */
export const MAX_VIAJES_EN_LISTA = 8;

/** Corta por caracteres visibles (un emoji no se parte por la mitad). */
export function recortar(t: string, max: number): string {
  const cs = [...String(t ?? '').replace(/\s+/g, ' ').trim()];
  return cs.length <= max ? cs.join('') : `${cs.slice(0, max - 1).join('')}…`;
}

// ── El punto ─────────────────────────────────────────────────────────────────

/** Dónde vive la pregunta: una entrega cerrada, un entendimiento («¿A qué viaje van?», confirmaciones), su contacto, o la caja abierta. */
export type OrigenPunto = 'entrega' | 'negocio' | 'contacto' | 'tanda';

export type TipoPunto =
  /** «¿A qué viaje van?» / «¿De qué viaje es el mensaje?» (con la lista de viajes). */
  | 'viaje'
  /** «¿De qué cliente es?» (la pregunta vieja, sin lista). */
  | 'cliente'
  /** El resumen del reparto (Cargar / Descartar) o el resumen corto de «me falta». */
  | 'resumen'
  /** «¿Seguro que van en …?», «¿Es una solicitud de viaje?», «¿Me las reenvías por separado?». */
  | 'confirmacion'
  /** «¿Creo el cliente nuevo «X»?». */
  | 'nuevo'
  /** «¿Es la misma persona?» (una ficha). */
  | 'misma'
  /** «¿Cuál contacto es?» / «¿Cuál X es?» (varias fichas). */
  | 'elegir_cliente'
  /** «¿Lo creo como cliente nuevo, con …?». */
  | 'crear'
  /** La llave (celular, correo o usuario). */
  | 'llave'
  /** El nombre del cliente (y su llave). */
  | 'nombre'
  /** La lista de un encabezado aproximado o ambiguo de la caja abierta. */
  | 'eleccion';

export interface OpcionDecision {
  /** Estable y corta, [a-z0-9_]: `v2`, `nuevo`, `des`, `si`, `no`, `crear`, `no_nuevo`, `c1`, `otra`, `x3`. */
  clave: string;
  titulo: string;
  descripcion?: string;
  /** Lo que el lector exacto de hoy entiende sin adivinar. */
  canonico: string;
  /** Su número en la lista: un «2» escrito solo la elige. */
  numero?: number;
  /** Su código de viaje: el código escrito tal cual la elige. */
  codigo?: string | null;
  /** Sale como botón o fila; las ocultas solo las ve el modelo (los demás viajes abiertos). */
  visible: boolean;
  /** «Viaje nuevo» con el nombre del cliente («es nuevo, de Marta Gómez»). */
  aceptaNombre?: boolean;
  /**
   * Crear un cliente: con el toque, o con un «sí» escrito solo (tan exacto como el toque). Lo que el modelo lee de un
   * escrito libre («sí, créalo de una») nunca crea: pide el toque.
   */
  soloToque?: boolean;
  /** El «sí» o el «no» escritos solos. */
  sentido?: 'si' | 'no';
  /** Lo que la opción señala: el viaje o la ficha del directorio (para la telemetría y las pruebas). */
  ref?: string;
}

export interface PuntoDecision {
  origen: OrigenPunto;
  /** La fila de la pregunta (entrega, entendimiento o tanda). */
  ref: string;
  tipo: TipoPunto;
  /** El viaje o la tanda de la pregunta («SAN ANDRÉS · Fermín Ocampo (F 26 1)»). */
  nombre: string;
  /** Lo que preguntó el bot (para el modelo). */
  pregunta: string;
  /** La pregunta en una línea, para volver a preguntar. */
  corta: string;
  opciones: OpcionDecision[];
  pide?: { nombre?: boolean; llave?: boolean; correccion?: boolean };
  /** Los botones de #1034 (resumen, confirmaciones, «¿Es la misma persona?»): se reusan tal cual. */
  botones?: BotonBandeja[];
  /** Hay más viajes que los de la lista: «Si no está, escríbeme el código o el nombre». */
  hayMas?: boolean;
  /** La huella de la pregunta: un toque con otra huella es viejo. */
  version: string;
  /** El nombre propuesto en «¿Creo el cliente nuevo «X»?» (repetirlo es el «sí» a crear: solo con el toque). */
  propuesto?: string | null;
  /** Los números de los mensajes del resumen, como los ve el comercial (una corrección solo puede nombrar esos). */
  numeros?: number[];
}

/**
 * La huella de un punto: cambia si cambia lo que el comercial VIO (otras filas, otro nombre propuesto). Las opciones
 * ocultas (los demás viajes abiertos) no cuentan: que se abra un viaje en otra parte no vuelve viejo un toque.
 */
export function versionDe(p: Omit<PuntoDecision, 'version'>): string {
  return huella({ t: p.tipo, r: p.ref, o: p.opciones.filter(o => o.visible).map(o => [o.clave, o.titulo, o.canonico]), n: p.propuesto ?? null });
}

export function conVersion(p: Omit<PuntoDecision, 'version'> & { version?: string }): PuntoDecision {
  return { ...p, version: p.version ?? versionDe(p) };
}

// ── Los ids de los toques ────────────────────────────────────────────────────

/** `bdj|d|<clave>|<ref>|<versión>`: un botón o una fila de un punto de decisión (los de #1034 siguen con r, p y t). */
export function idDecision(clave: string, ref: string, version: string): string {
  return ['bdj', 'd', clave, ref, version || '-'].join('|').slice(0, MAX_ID_FILA);
}

export interface ToqueDecision { clave: string; ref: string; version: string }

export function leerToqueDecision(id: string | null | undefined): ToqueDecision | null {
  const partes = String(id ?? '').split('|');
  if (partes.length !== 5 || partes[0] !== 'bdj' || partes[1] !== 'd') return null;
  const [, , clave, ref, version] = partes;
  if (!/^[a-z0-9_]{1,16}$/.test(clave) || !ref) return null;
  return { clave, ref, version };
}

// ── El mensaje interactivo ───────────────────────────────────────────────────

export interface FilaLista { id: string; title: string; description?: string }

export type Interactivo =
  | { tipo: 'botones'; botones: BotonBandeja[] }
  | { tipo: 'lista'; boton: string; filas: FilaLista[] }
  | { tipo: 'ninguno' };

export const TEXTO_BOTON_LISTA = 'Elegir';

/**
 * Cómo sale la pregunta: los botones de #1034 si los trae; si no, hasta tres salidas sin número como botones; con
 * número (viajes, clientes) o más de tres, una lista. Nunca más de 10 filas.
 */
export function interactivoDe(p: PuntoDecision): Interactivo {
  if (p.botones) return p.botones.length > 0 ? { tipo: 'botones', botones: p.botones } : { tipo: 'ninguno' };
  const vis = p.opciones.filter(o => o.visible);
  if (vis.length === 0) return { tipo: 'ninguno' };
  if (vis.length <= 3 && !vis.some(o => o.numero !== undefined)) {
    return { tipo: 'botones', botones: vis.map(o => ({ id: idDecision(o.clave, p.ref, p.version), title: recortar(o.titulo, MAX_TITULO_BOTON_RESPUESTA) })) };
  }
  const filas = vis.slice(0, MAX_FILAS_LISTA).map(o => ({
    id: idDecision(o.clave, p.ref, p.version),
    title: recortar(o.titulo, MAX_TITULO_FILA),
    ...(o.descripcion ? { description: recortar(o.descripcion, MAX_DESCRIPCION_FILA) } : {}),
  }));
  return { tipo: 'lista', boton: TEXTO_BOTON_LISTA, filas };
}

/** La línea que va con una lista recortada: los demás viajes también valen por su código o su nombre. */
export const TEXTO_SI_NO_ESTA = 'Si no está, escríbeme el código o el nombre.';

// ── Lo que el código lee sin adivinar ────────────────────────────────────────

export type LecturaExacta =
  | { tipo: 'opcion'; opcion: OpcionDecision }
  /** La llave escrita sola, donde se pide. */
  | { tipo: 'llave'; llave: Llave }
  /** Un número solo fuera del rango de la lista: se vuelve a preguntar (nunca es otra cosa). */
  | { tipo: 'fuera' }
  /** El código exacto de un viaje abierto que no es una opción: en la caja abierta es un encabezado. */
  | { tipo: 'codigo_ajeno' };

/**
 * Un «sí» escrito solo al resumen que todavía no se puede cargar (falta la llave, elegir el cliente o decidir un ⚠): no
 * hay «Cargar» que elegir, y no es otra cosa. El bot dice que todavía no carga y qué falta, sin pasar por el modelo.
 */
export function siSinCargar(texto: string, p: PuntoDecision): boolean {
  if (p.tipo !== 'resumen' || p.opciones.some(o => o.sentido === 'si')) return false;
  return normalizarTexto(String(texto ?? '')).replace(/[.!¡]+$/g, '').trim() === 'si';
}

/**
 * La respuesta a «¿Creo el cliente nuevo «X»?» tal como la manda el punto de decisión (bot híbrido): solo canónicos.
 *   · «sí»: crear (el toque de «Crear», o el «sí» escrito solo);
 *   · «descartar»; el número de la lista o un código: ese viaje (cancela el nuevo);
 *   · «nuevo X»: otro nombre (el que el modelo copió tal cual), que se vuelve a confirmar.
 * Lo demás no se entiende (se vuelve a preguntar). Aquí ya no se lee texto libre: se fueron las listas de reservas, de
 * verbos de alta, de cortesías y de frases que señalan un viaje (`interpretarConfirmacionNuevo`).
 */
export function leerConfirmacionNuevoCanonica(texto: string, opciones: ReadonlyArray<{ id: string; codigo?: string | null }>): RespuestaConfirmarNuevo {
  const t = String(texto ?? '').trim();
  const n = normalizarTexto(t).replace(/[.!¡]+$/g, '').trim();
  if (n === 'si') return { tipo: 'si' };
  if (n === 'descartar') return { tipo: 'descartar' };
  const k = /^(\d{1,2})$/.exec(n);
  if (k) {
    const o = opciones[Number(k[1]) - 1];
    return o ? { tipo: 'existente', negocio_id: o.id } : { tipo: 'no_entendida' };
  }
  if (formaDeCodigo(t)) {
    const c = codigoCompacto(t);
    const o = opciones.find(x => codigoCompacto(x.codigo) === c);
    return o ? { tipo: 'existente', negocio_id: o.id } : { tipo: 'codigo', codigo: c };
  }
  const nuevo = /^nuevo\s+(.+)$/i.exec(t);
  if (nuevo) return { tipo: 'nombre', nombre: nuevo[1].trim() };
  return { tipo: 'no_entendida' };
}

/** ¿Tiene la forma de un código de negocio («T1 26 14», «S1263»)? */
export function formaDeCodigo(texto: string): boolean {
  const c = codigoCompacto(texto);
  return /^[A-Z]{1,3}\d{3,}$/.test(c) && c.length <= 12 && /^[\sA-Za-z0-9-]+$/.test(String(texto ?? '').trim());
}

/**
 * Solo lo que no tiene ambigüedad, y siempre el mensaje ENTERO: un número de la lista («2», «2.»), un código de
 * viaje exacto, un «sí» o un «no» solos (en una pregunta que tiene esas salidas) y, donde se pide, la llave sola.
 * Todo lo demás (también «el 2», «sí, pero…», «sii», «dale») va al modelo. `null`: no es nada de eso.
 */
export function leerExacto(texto: string, p: PuntoDecision, codigosAbiertos: ReadonlyArray<string> = []): LecturaExacta | null {
  const t = String(texto ?? '').trim();
  if (!t) return null;
  const num = /^(\d{1,2})\s*[.)]?$/.exec(t);
  const numeradas = p.opciones.filter(o => o.numero !== undefined);
  if (num && numeradas.length > 0) {
    const o = numeradas.find(x => x.numero === Number(num[1]));
    return o ? { tipo: 'opcion', opcion: o } : { tipo: 'fuera' };
  }
  if (formaDeCodigo(t)) {
    const c = codigoCompacto(t);
    const o = p.opciones.find(x => x.codigo && codigoCompacto(x.codigo) === c);
    if (o) return { tipo: 'opcion', opcion: o };
    if (codigosAbiertos.some(x => codigoCompacto(x) === c)) return { tipo: 'codigo_ajeno' };
  }
  const sn = normalizarTexto(t).replace(/[.!¡]+$/g, '').trim();
  if (sn === 'si' || sn === 'no') {
    const o = p.opciones.find(x => x.sentido === sn);
    if (o) return { tipo: 'opcion', opcion: o };
  }
  if (p.pide?.llave) {
    const llave = soloLlave(t);
    if (llave) return { tipo: 'llave', llave };
  }
  return null;
}

// ── El modelo ────────────────────────────────────────────────────────────────

export const TIPOS_DE_RESPUESTA = ['opcion', 'nombre', 'llave', 'correccion', 'contenido', 'pregunta', 'no_se'] as const;

export function esquemaDecision(): Record<string, unknown> {
  return {
    type: 'OBJECT',
    properties: {
      tipo: { type: 'STRING', enum: [...TIPOS_DE_RESPUESTA] },
      opcion: { type: 'STRING' },
      nombre: { type: 'STRING' },
      cambios: {
        type: 'ARRAY',
        items: { type: 'OBJECT', properties: { mensajes: { type: 'ARRAY', items: { type: 'INTEGER' } }, destino: { type: 'STRING' }, nombre: { type: 'STRING' } } },
      },
    },
    required: ['tipo'],
  };
}

export function instruccionesDecision(): string {
  return [
    'Eres el lector de respuestas del bot de WhatsApp de una agencia de viajes. El bot le hizo al comercial UNA pregunta',
    'con opciones, y el comercial escribió un mensaje. Di qué es ese mensaje. Devuelve solo el JSON.',
    '',
    'tipo:',
    '- "opcion": elige una de las opciones, sin condiciones ni reservas. Pon en "opcion" su id tal cual.',
    '  Un «sí, pero …», «sí cuando …», «sí, menos …», «espérame» o una pregunta NO eligen: son "no_se".',
    '- "nombre": solo si la pregunta pide el nombre del cliente y el mensaje lo da. Copia el nombre TAL CUAL está escrito,',
    '  sin la fórmula que lo presenta («el cliente es», «se llama», «para»). Nunca un nombre que no esté escrito.',
    '- "llave": solo si la pregunta pide el celular, el correo o el usuario del cliente y el mensaje lo da (aunque traiga más',
    '  palabras). El código lo copia del mensaje; tú no lo escribas.',
    '- "correccion": solo si se permite: el comercial corrige el resumen (mueve, quita, descarta o deja mensajes por su número).',
    '  Pon en "cambios" cada cambio: "mensajes" (los números que nombra) y "destino": el id de un viaje de las opciones,',
    '  "descartar" (quitarlo), "dejar" (dejarlo donde está) o "nuevo" con el nombre del cliente en "nombre", copiado tal cual.',
    '- "contenido": no contesta la pregunta: es un dato del viaje o algo del cliente (fechas, personas, ciudades, pedidos).',
    '- "pregunta": le pregunta algo al bot.',
    '- "no_se": no está claro, mezcla cosas, tiene una condición o dudas. Ante la duda, "no_se".',
    '',
    'Si elige «viaje nuevo» y además da el nombre del cliente, pon "opcion" con ese id y el nombre en "nombre", copiado tal cual.',
    'Nunca inventes un id ni un nombre. Nunca elijas por descarte.',
  ].join('\n');
}

/** Lo que ve el modelo: la pregunta, las opciones con sus ids, lo que se permite y el mensaje. */
export function contextoDecision(p: PuntoDecision, texto: string): string {
  const ops = p.opciones.map(o => `- ${o.clave}: ${o.titulo}${o.descripcion ? ` (${o.descripcion})` : ''}${o.numero !== undefined ? ` [número ${o.numero}]` : ''}`);
  const permite = [
    ...(p.pide?.correccion && p.numeros?.length ? [`Mensajes del resumen: ${p.numeros.join(', ')}.`] : []),
    p.pide?.nombre ? 'Se permite "nombre": la pregunta pide el nombre del cliente.' : 'No se permite "nombre".',
    p.pide?.llave ? 'Se permite "llave": la pregunta pide el celular, el correo o el usuario del cliente.' : 'No se permite "llave".',
    p.pide?.correccion ? 'Se permite "correccion": es el resumen del reparto.' : 'No se permite "correccion".',
  ];
  return [
    `Pregunta del bot: ${recortar(p.pregunta, 900)}`,
    '',
    'Opciones (id: lo que dice):',
    ...ops,
    '',
    ...permite,
    '',
    `Mensaje del comercial: ${texto}`,
  ].join('\n');
}

export type Veredicto =
  | { tipo: 'opcion'; opcion: OpcionDecision; nombre?: string }
  /** El modelo eligió crear un cliente: solo con el toque. */
  | { tipo: 'solo_toque'; opcion: OpcionDecision }
  | { tipo: 'nombre'; nombre: string }
  /** La llave que trae el escrito, como la lee el código (`llavesDelTexto`): celular, correo o usuario. */
  | { tipo: 'llave'; canonico: string }
  /** La corrección del resumen, ya escrita como la lee el código de hoy («corregir: el 2 es de T1 26 9; descartar el 3»). */
  | { tipo: 'correccion'; canonico: string }
  | { tipo: 'contenido' }
  | { tipo: 'pregunta' }
  | { tipo: 'no_se'; motivo: string };

/**
 * El nombre que dio el modelo, solo si está escrito en el mensaje (palabras seguidas, sin tildes ni mayúsculas que
 * cuenten), con 1 a 4 palabras y sin dígitos. Devuelve el tramo del mensaje tal cual, o `null`.
 */
export function nombreLiteral(nombre: unknown, texto: string): string | null {
  const n = String(nombre ?? '').trim();
  if (!n) return null;
  const quiere = normalizarNombre(n).split(' ').filter(Boolean);
  // Una palabra que es solo números no es parte de un nombre (es el celular, una edad, una fecha).
  if (quiere.length === 0 || quiere.length > 4 || quiere.some(w => /^\d+$/.test(w))) return null;
  const crudas = String(texto ?? '').split(/\s+/).filter(Boolean);
  const norm = crudas.map(w => normalizarNombre(w));
  for (let i = 0; i + quiere.length <= norm.length; i++) {
    if (quiere.every((w, j) => norm[i + j] === w)) {
      return crudas.slice(i, i + quiere.length).join(' ').replace(/^[«"'(¿¡]+|[»"'),.;:!?]+$/g, '').trim();
    }
  }
  return null;
}

/** Valida lo que devolvió el modelo contra las opciones vigentes. Lo que no cuadra es «no sé». */
export function validarDecision(json: unknown, p: PuntoDecision, texto: string): Veredicto {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const tipo = String(j.tipo ?? '');
  if (tipo === 'contenido') return { tipo: 'contenido' };
  if (tipo === 'pregunta') return { tipo: 'pregunta' };
  if (tipo === 'correccion') {
    if (!p.pide?.correccion) return { tipo: 'no_se', motivo: 'correccion_no_permitida' };
    const canonico = correccionCanonica(j.cambios, p, texto);
    return canonico ? { tipo: 'correccion', canonico } : { tipo: 'no_se', motivo: 'correccion_invalida' };
  }
  if (tipo === 'llave') {
    if (!p.pide?.llave) return { tipo: 'no_se', motivo: 'llave_no_permitida' };
    // La llave la lee el código del mensaje (dígitos, correo o usuario): el modelo solo dice que el escrito la trae.
    const canonico = conLlaveDelTexto('', texto).trim();
    return canonico ? { tipo: 'llave', canonico } : { tipo: 'no_se', motivo: 'llave_no_escrita' };
  }
  if (tipo === 'nombre') {
    if (!p.pide?.nombre) return { tipo: 'no_se', motivo: 'nombre_no_permitido' };
    const nombre = nombreLiteral(j.nombre, texto);
    if (!nombre) return { tipo: 'no_se', motivo: 'nombre_no_escrito' };
    // Repetir el nombre propuesto es el «sí» a crearlo: solo con el toque.
    if (p.propuesto && normalizarNombre(nombre) === normalizarNombre(p.propuesto)) {
      const crear = p.opciones.find(o => o.soloToque);
      if (crear) return { tipo: 'solo_toque', opcion: crear };
    }
    return { tipo: 'nombre', nombre };
  }
  if (tipo === 'opcion') {
    const o = p.opciones.find(x => x.clave === String(j.opcion ?? ''));
    if (!o) return { tipo: 'no_se', motivo: 'id_inventado' };
    if (o.soloToque) return { tipo: 'solo_toque', opcion: o };
    if (o.aceptaNombre && j.nombre) {
      const nombre = nombreLiteral(j.nombre, texto);
      if (!nombre) return { tipo: 'no_se', motivo: 'nombre_no_escrito' };
      return { tipo: 'opcion', opcion: o, nombre };
    }
    return { tipo: 'opcion', opcion: o };
  }
  return { tipo: 'no_se', motivo: tipo === 'no_se' ? 'modelo_no_sabe' : 'tipo_desconocido' };
}

/**
 * Los cambios de una corrección, validados contra lo vigente y escritos como los lee el lector del resumen de hoy
 * (`interpretarRespuestaPlan`): cada número tiene que estar en el resumen; el destino, ser un viaje de las opciones (por su
 * código), «descartar», «dejar» o «nuevo» con un nombre escrito tal cual. Si uno no cuadra, ninguno: `null`.
 */
export function correccionCanonica(cambios: unknown, p: PuntoDecision, texto: string): string | null {
  if (!Array.isArray(cambios) || cambios.length === 0) return null;
  const partes: string[] = [];
  for (const c of cambios as Array<Record<string, unknown>>) {
    const ns = Array.isArray(c?.mensajes) ? (c.mensajes as unknown[]).map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
    if (ns.length === 0 || ns.length !== (c.mensajes as unknown[]).length) return null;
    if (p.numeros && ns.some(n => !p.numeros!.includes(n))) return null;
    const lista = ns.length === 1 ? `el ${ns[0]}` : `los ${ns.slice(0, -1).join(', ')} y ${ns[ns.length - 1]}`;
    const destino = String(c.destino ?? '');
    if (destino === 'descartar') { partes.push(`descartar ${lista}`); continue; }
    if (destino === 'dejar') { partes.push(`dejar ${lista}`); continue; }
    if (destino === 'nuevo') {
      const nombre = nombreLiteral(c.nombre, texto);
      if (!nombre) return null;
      partes.push(`${lista} ${ns.length === 1 ? 'es' : 'son'} de nuevo ${nombre}`);
      continue;
    }
    // Otro viaje de este mismo resumen (por su número de grupo), o un viaje abierto (por su código).
    const g = /^g(\d+)$/.exec(destino) ? p.opciones.find(x => x.clave === destino) : null;
    if (g) { partes.push(`${lista} ${ns.length === 1 ? 'es' : 'son'} ${g.canonico}`); continue; }
    const o = p.opciones.find(x => x.clave === destino && x.codigo);
    if (!o) return null;
    partes.push(`${lista} ${ns.length === 1 ? 'es' : 'son'} de ${o.codigo}`);
  }
  return `corregir: ${partes.join('; ')}`;
}

/**
 * Lo que entra por el camino de siempre: el canónico de la opción, con el nombre si lo trae («nuevo Ana Ruiz»). Si el
 * escrito traía también la llave del cliente (celular, correo o usuario), va detrás, tal cual la lee el código
 * (`llavesDelTexto`): sin ella, «nuevo Ana Ruiz 300 555 1234» perdería el celular.
 */
export function canonicoDe(o: OpcionDecision, nombre?: string | null, texto?: string): string {
  return o.aceptaNombre && nombre ? conLlaveDelTexto(`${o.canonico} ${nombre}`, texto) : o.canonico;
}

/** El canónico con la llave que trae el escrito, escrita como la lee `llavesDelTexto`. */
export function conLlaveDelTexto(canonico: string, texto?: string | null): string {
  const l = texto ? llavesDelTexto(texto) : null;
  if (!l) return canonico;
  const partes = [l.celular ?? null, l.correo ?? null, l.usuario ? `@${l.usuario}` : null].filter(Boolean);
  return partes.length ? `${canonico} ${partes.join(' ')}` : canonico;
}

// ── Los textos ───────────────────────────────────────────────────────────────

/** Timeout o error del modelo en un punto de decisión: el bot no adivina. */
export const TEXTO_NO_TE_ENTENDI = 'No te entendí; toca una opción.';
/** Lo que se dice al volver a preguntar (una vez, en corto). */
export function textoVolverAPreguntar(p: PuntoDecision, motivo: 'no_se' | 'fuera' | 'modelo' | 'solo_toque' | 'pregunta' | 'viejo' | 'todavia'): string {
  const q = `${p.nombre ? `${p.nombre} · ` : ''}${p.corta}`;
  if (motivo === 'todavia') return `Todavía no lo cargo. ${q}`;
  if (motivo === 'modelo') return `${TEXTO_NO_TE_ENTENDI}\n${q}`;
  if (motivo === 'fuera') return `Ese número no está en la lista. ${q}`;
  if (motivo === 'solo_toque') return `${p.tipo === 'resumen' ? 'Para cargarlo y crear el cliente, toca el botón.' : 'Para crear el cliente, toca «Crear».'} No he creado nada.\n${q}`;
  if (motivo === 'pregunta') return `Eso te lo contesto después. Primero: ${q}`;
  if (motivo === 'viejo') return `${TEXTO_TOQUE_SIN_PREGUNTA}\n${q}`;
  return `No me quedó claro. ${q}`;
}

// ── Los puntos de cada pregunta ──────────────────────────────────────────────

export interface ViajeDeLista { id: string; codigo: string | null; cliente?: string | null; destino?: string | null; nombre?: string | null }

/** Una fila de viaje: «2. SAN ANDRÉS DIC» y debajo «Fermín Ocampo · F 26 1». */
function opcionDeViaje(v: ViajeDeLista, k: number, clave: string, canonico: string, visible: boolean): OpcionDecision {
  const titulo = v.nombre?.trim() ? v.nombre.trim() : (nombrePropio(v.cliente) || v.codigo || 'Viaje');
  const desc = [v.nombre?.trim() ? nombrePropio(v.cliente) : (v.destino ?? ''), v.codigo ?? ''].filter(Boolean).join(' · ');
  return { clave, titulo: visible ? `${k}. ${titulo}` : titulo, ...(desc ? { descripcion: desc } : {}), canonico, numero: visible ? k : undefined, codigo: v.codigo, visible, ref: v.id };
}

/** Los viajes abiertos que no están en la lista: solo el modelo los ve (y su código escrito tal cual vale). */
function ocultos(otros: ReadonlyArray<ViajeDeLista>, enLista: ReadonlyArray<ViajeDeLista>): OpcionDecision[] {
  const ya = new Set(enLista.map(v => v.id));
  // La clave lleva el código («xt12611»): estable aunque se abran o cierren otros viajes.
  return otros.filter(v => !ya.has(v.id) && v.codigo).slice(0, 40)
    .map((v, j) => ({ ...opcionDeViaje(v, j + 1, `x${codigoCompacto(v.codigo).toLowerCase()}`.slice(0, 16), String(v.codigo), false), numero: undefined }));
}

/**
 * «¿A qué viaje van?» con la lista de la entrega (`negocio_opciones`): los viajes (el número de la lista es su
 * canónico), «Viaje nuevo» (con el nombre, si lo da) y «Descartar».
 */
export function puntoViaje(p: {
  origen: 'entrega' | 'negocio'; ref: string; nombre: string; pregunta: string;
  opciones: ReadonlyArray<ViajeDeLista>; otros?: ReadonlyArray<ViajeDeLista>;
}): PuntoDecision {
  const lista = p.opciones.slice(0, MAX_VIAJES_EN_LISTA);
  const opciones: OpcionDecision[] = [
    ...lista.map((v, i) => opcionDeViaje(v, i + 1, `v${i + 1}`, String(i + 1), true)),
    { clave: 'nuevo', titulo: 'Viaje nuevo', descripcion: 'Un viaje que todavía no existe', canonico: 'nuevo', visible: true, aceptaNombre: true },
    { clave: 'des', titulo: 'Descartar', descripcion: 'No es de ningún viaje', canonico: 'descartar', visible: true },
    ...ocultos(p.otros ?? [], lista),
  ];
  return conVersion({
    origen: p.origen, ref: p.ref, tipo: 'viaje', nombre: p.nombre, pregunta: p.pregunta, corta: '¿De qué viaje son?', opciones,
    pide: { nombre: false }, hayMas: (p.otros ?? []).some(v => !lista.some(x => x.id === v.id)),
  });
}

/** «¿De qué cliente es?» (la pregunta vieja, sin lista de viajes): el nombre, o descartar. */
export function puntoCliente(p: { ref: string; nombre: string; pregunta: string }): PuntoDecision {
  return conVersion({
    origen: 'entrega', ref: p.ref, tipo: 'cliente', nombre: p.nombre, pregunta: p.pregunta, corta: '¿De qué cliente es?',
    opciones: [{ clave: 'des', titulo: 'Descartar', canonico: 'descartar', visible: true }], pide: { nombre: true, llave: true },
  });
}

/** Una ficha del directorio como fila: «1. Paola Rincón» y debajo «cel. …4410 · un viaje abierto». */
export interface FichaDeLista { id: string; nombre: string; dato?: string | null }

function opcionesDeFichas(fichas: ReadonlyArray<FichaDeLista>, canonicoOtra: string): OpcionDecision[] {
  return [
    ...fichas.slice(0, MAX_VIAJES_EN_LISTA).map((f, i) => ({
      clave: `c${i + 1}`, titulo: `${i + 1}. ${nombrePropio(f.nombre) || 'Sin nombre'}`, ...(f.dato ? { descripcion: f.dato } : {}),
      canonico: String(i + 1), numero: i + 1, visible: true, ref: f.id,
    })),
    { clave: 'otra', titulo: 'Otra persona', descripcion: 'No es ninguno de estos', canonico: canonicoOtra, visible: true },
  ];
}

/**
 * El resumen del reparto (o el corto de «me falta»): los botones de #1034 tal cual. Si falta elegir el cliente de un
 * viaje nuevo entre parecidos, sale como lista. `creaCliente`: el «sí» crearía un cliente (solo con el toque).
 */
export function puntoResumen(p: {
  origen: 'entrega' | 'negocio'; ref: string; nombre: string; pregunta: string; botones: BotonBandeja[]; version: string;
  creaCliente: boolean; falta?: { tipo: 'llave' | 'elegir' | 'confirmar' | 'nombre' | 'error'; fichas?: FichaDeLista[] } | null;
  /** Hay mensajes marcados con ⚠ por decidir (el resumen no trae «Cargar»). */
  porDecidir?: boolean;
  /** Los viajes abiertos (destinos de una corrección: solo los ve el modelo) y los números de los mensajes. */
  viajes?: ReadonlyArray<ViajeDeLista>;
  numeros?: number[];
  /** Los viajes de ESTE resumen (por su número de grupo): «el 4 es del 2», o el cliente nuevo que ya está en él. */
  grupos?: ReadonlyArray<{ k: number; titulo: string; ref: string }>;
}): PuntoDecision {
  const titulo = (accion: string) => p.botones.find(b => b.id.split('|')[2] === accion)?.title;
  const opciones: OpcionDecision[] = [];
  const si = titulo('si');
  // «No pude revisar el directorio … Responde sí en un momento y lo intento de nuevo»: el «sí» reintenta (no carga).
  if (!si && p.falta?.tipo === 'error') opciones.push({ clave: 'si', titulo: 'Reintentar', canonico: 'sí', visible: false, sentido: 'si' });
  if (si) opciones.push({ clave: 'si', titulo: si, canonico: p.falta?.tipo === 'confirmar' ? 'es la misma' : 'sí', visible: true, sentido: 'si', ...(p.creaCliente && p.falta?.tipo !== 'confirmar' ? { soloToque: true } : {}) });
  const no = titulo('no');
  if (no) opciones.push({ clave: 'no', titulo: no, canonico: 'no', visible: true, sentido: 'no' });
  if (p.falta?.tipo === 'elegir') opciones.push(...opcionesDeFichas(p.falta.fichas ?? [], 'es otra persona'));
  opciones.push({ clave: 'des', titulo: TITULO_DESCARTAR, canonico: 'descartar', visible: true });
  opciones.push(...(p.grupos ?? []).map(g => ({ clave: `g${g.k}`, titulo: `Viaje ${g.k} del resumen: ${g.titulo}`, canonico: `del ${g.k}`, visible: false, ref: g.ref })));
  opciones.push(...ocultos(p.viajes ?? [], []));
  const lista = p.falta?.tipo === 'elegir';
  return {
    origen: p.origen, ref: p.ref, tipo: 'resumen', nombre: p.nombre, pregunta: p.pregunta,
    corta: p.porDecidir ? 'Primero dime qué hago con lo marcado con ⚠ («el 2 es de …», «quita el 2»).'
      : lista ? '¿Cuál es el cliente, o es otra persona?' : p.falta?.tipo === 'llave' ? '¿Me pasas su celular o su correo?'
      : p.falta?.tipo === 'nombre' ? '¿Cómo se llama el cliente?' : '¿Lo cargo así?',
    opciones, pide: { correccion: true, llave: p.falta?.tipo === 'llave' || p.falta?.tipo === 'nombre', nombre: p.falta?.tipo === 'nombre' },
    ...(lista ? {} : { botones: p.botones }), version: p.version, ...(p.numeros ? { numeros: p.numeros } : {}),
  };
}

/** Las confirmaciones del entendimiento, con sus botones de #1034. */
export function puntoConfirmacion(p: {
  ref: string; nombre: string; pregunta: string; corta: string; c: 'cruce' | 'sin_solicitud' | 'dos_viajes'; botones: BotonBandeja[];
}): PuntoDecision {
  const opciones: OpcionDecision[] = [];
  if (p.c !== 'dos_viajes') opciones.push({ clave: 'si', titulo: p.botones[0]?.title ?? 'Sí', canonico: 'sí', visible: true, sentido: 'si' });
  // «No van ahí»: en el cruce, la lista de viajes otra vez; «no es una solicitud»: descartar.
  if (p.c === 'cruce') opciones.push({ clave: 'no', titulo: 'Es otro viaje', canonico: 'no', visible: false, sentido: 'no' });
  if (p.c === 'sin_solicitud') opciones.push({ clave: 'no', titulo: 'No es una solicitud', canonico: 'descartar', visible: false, sentido: 'no' });
  opciones.push({ clave: 'des', titulo: TITULO_DESCARTAR, canonico: 'descartar', visible: true });
  return conVersion({ origen: 'negocio', ref: p.ref, tipo: 'confirmacion', nombre: p.nombre, pregunta: p.pregunta, corta: p.corta, opciones, botones: p.botones });
}

/** Lo que entra por el camino de siempre cuando el comercial dice que NO es un cliente nuevo: vuelve la lista de viajes. */
export const CANONICO_NO_ES_NUEVO = 'no es nuevo';

/**
 * «¿Creo el cliente nuevo «X»?» (punto 5 del brief): [Crear] [No es nuevo] [Descartar]. Si el guardián encontró
 * viajes parecidos, salen en una lista con «Crear». Crear, solo con el toque.
 */
export function puntoNuevo(p: {
  ref: string; nombre: string; pregunta: string; propuesto: string;
  parecidos: ReadonlyArray<{ viaje: ViajeDeLista; numero: number | null }>; opciones: ReadonlyArray<ViajeDeLista>; otros?: ReadonlyArray<ViajeDeLista>;
}): PuntoDecision {
  const pars = p.parecidos.slice(0, 3);
  const enLista = p.opciones.slice(0, MAX_VIAJES_EN_LISTA);
  const opciones: OpcionDecision[] = [
    { clave: 'crear', titulo: 'Crear', descripcion: `Cliente nuevo: ${recortar(nombrePropio(p.propuesto), 50)}`, canonico: 'sí', visible: true, soloToque: true, sentido: 'si' },
    ...pars.map((x, i) => ({
      ...opcionDeViaje(x.viaje, i + 1, `p${i + 1}`, x.numero !== null ? String(x.numero) : String(x.viaje.codigo ?? ''), true),
      titulo: `Es ${nombreDeViaje({ cliente: x.viaje.cliente, codigo: null }) || x.viaje.codigo || 'ese viaje'}`,
      // Su número en la lista de «¿A qué viaje van?» sigue valiendo escrito solo.
      numero: x.numero ?? undefined,
    })).filter(o => o.canonico),
    { clave: 'no_nuevo', titulo: 'No es nuevo', descripcion: 'Elegir el viaje que ya existe', canonico: CANONICO_NO_ES_NUEVO, visible: true },
    { clave: 'des', titulo: TITULO_DESCARTAR, canonico: 'descartar', visible: true },
    // Los viajes de la lista y los demás abiertos: el modelo los puede elegir; su número o su código escritos valen.
    ...enLista.filter(v => !pars.some(x => x.viaje.id === v.id)).map(v => {
      const k = p.opciones.indexOf(v) + 1;
      return { ...opcionDeViaje(v, k, `v${k}`, String(k), false), numero: k };
    }),
    ...ocultos(p.otros ?? [], [...enLista, ...pars.map(x => x.viaje)]),
  ];
  return conVersion({
    origen: 'negocio', ref: p.ref, tipo: 'nuevo', nombre: p.nombre, pregunta: p.pregunta,
    corta: `¿Creo el cliente nuevo «${recortar(p.propuesto, 40)}»?`, opciones, pide: { nombre: true, llave: true }, propuesto: p.propuesto,
  });
}

/** Las preguntas del contacto de un viaje nuevo (`esperando_contacto`). */
export function puntoContacto(p: {
  ref: string; nombre: string; pregunta: string; pide: 'crear' | 'llave' | 'nombre' | 'misma' | 'elegir';
  fichas: ReadonlyArray<FichaDeLista>; botones?: BotonBandeja[];
}): PuntoDecision {
  const des: OpcionDecision = { clave: 'des', titulo: TITULO_DESCARTAR, canonico: 'descartar', visible: true };
  const base = { origen: 'contacto' as const, ref: p.ref, nombre: p.nombre, pregunta: p.pregunta };
  if (p.pide === 'misma') {
    return conVersion({
      ...base, tipo: 'misma', corta: '¿Es la misma persona?',
      opciones: [
        { clave: 'si', titulo: p.botones?.[0]?.title ?? 'Sí, es la misma', canonico: 'sí', visible: true, sentido: 'si' },
        { clave: 'no', titulo: p.botones?.[1]?.title ?? 'No, es otra', canonico: 'no', visible: true, sentido: 'no' },
        { ...des, visible: false },
      ],
      pide: { llave: true }, ...(p.botones ? { botones: p.botones } : {}),
    });
  }
  if (p.pide === 'elegir') {
    return conVersion({ ...base, tipo: 'elegir_cliente', corta: '¿Cuál contacto es, o es otra persona?', opciones: [...opcionesDeFichas(p.fichas, 'es otra persona'), des], pide: { llave: true } });
  }
  if (p.pide === 'crear') {
    return conVersion({
      ...base, tipo: 'crear', corta: '¿Lo creo como cliente nuevo?',
      opciones: [{ clave: 'crear', titulo: 'Crear', canonico: 'sí', visible: true, soloToque: true, sentido: 'si' }, des], pide: { llave: true, nombre: true },
    });
  }
  if (p.pide === 'llave') return conVersion({ ...base, tipo: 'llave', corta: '¿Me pasas su celular o su correo?', opciones: [des], pide: { llave: true } });
  return conVersion({ ...base, tipo: 'nombre', corta: '¿Cómo se llama el cliente?', opciones: [des], pide: { nombre: true, llave: true } });
}

/** Lo que espera la caja abierta, como punto de decisión. */
export function puntoTanda(p: {
  ref: string; nombre: string; pregunta: string;
  pendiente:
    | { tipo: 'eleccion'; texto: string; candidatos: ReadonlyArray<ViajeDeLista>; unSoloCliente: boolean }
    | { tipo: 'misma'; botones?: BotonBandeja[] }
    | { tipo: 'elegir'; fichas: ReadonlyArray<FichaDeLista> }
    | { tipo: 'llave' }
    | { tipo: 'nombre' };
}): PuntoDecision {
  const des: OpcionDecision = { clave: 'des', titulo: TITULO_DESCARTAR, canonico: 'descartar', visible: true };
  const base = { origen: 'tanda' as const, ref: p.ref, nombre: p.nombre, pregunta: p.pregunta };
  const q = p.pendiente;
  if (q.tipo === 'eleccion') {
    const cands = q.candidatos.slice(0, MAX_VIAJES_EN_LISTA);
    return conVersion({
      ...base, tipo: 'eleccion', corta: `¿De qué viaje es «${recortar(q.texto, 40)}»?`,
      opciones: [
        ...cands.map((v, i) => opcionDeViaje(v, i + 1, `e${i + 1}`, String(i + 1), true)),
        { clave: 'nuevo', titulo: 'Viaje nuevo', descripcion: q.unSoloCliente ? 'Otro viaje del mismo cliente' : 'Un viaje que todavía no existe', canonico: 'nuevo', visible: true, aceptaNombre: !q.unSoloCliente },
        des,
      ],
    });
  }
  if (q.tipo === 'misma') {
    return conVersion({
      ...base, tipo: 'misma', corta: '¿Es la misma persona?',
      opciones: [
        { clave: 'si', titulo: q.botones?.[0]?.title ?? 'Sí, es la misma', canonico: 'sí', visible: true, sentido: 'si' },
        { clave: 'no', titulo: q.botones?.[1]?.title ?? 'No, es otra', canonico: 'no', visible: true, sentido: 'no' },
        { ...des, visible: false },
      ],
      pide: { llave: true }, ...(q.botones ? { botones: q.botones } : {}),
    });
  }
  if (q.tipo === 'elegir') return conVersion({ ...base, tipo: 'elegir_cliente', corta: '¿Cuál es, o es otra persona?', opciones: [...opcionesDeFichas(q.fichas, 'es otra persona'), des], pide: { llave: true } });
  if (q.tipo === 'llave') return conVersion({ ...base, tipo: 'llave', corta: '¿Me pasas su celular o su correo?', opciones: [des], pide: { llave: true } });
  return conVersion({ ...base, tipo: 'nombre', corta: '¿Para qué cliente es?', opciones: [des], pide: { nombre: true, llave: true } });
}

// ── Los puntos de cada pregunta, con los datos como los guarda la bandeja ────────

/** Una ficha del directorio como fila de lista. */
function filaDeFicha(f: FichaCliente): FichaDeLista {
  return { id: f.id, nombre: f.nombre, dato: `${datoDeLaFicha(f)} · ${viajesDeLaFicha(f)}` };
}
function filaDeCandidato(c: ContactoCandidato): FichaDeLista {
  const cel4 = c.cel4 ?? (String(c.telefono ?? '').replace(/\D/g, '').slice(-4) || null);
  return { id: c.id, nombre: c.nombre ?? '', dato: cel4 ? `cel. …${cel4}` : null };
}

/** ¿El «sí» a este reparto crearía un cliente? (Un viaje nuevo sin un contacto que ya exista.) */
export function creaCliente(plan: PlanViajes): boolean {
  return gruposDelPlan(plan).some(g => g.destino.tipo === 'nuevo' && !g.destino.contacto);
}

/** El punto del resumen de una entrega (los botones de #1034; con «¿Cuál es?» de un viaje nuevo, la lista). */
export function puntoDelResumen(
  entregaId: string, plan: PlanViajes, nombre: string, origen: 'entrega' | 'negocio' = 'entrega', viajes: ReadonlyArray<ViajeAbierto> = [],
): PuntoDecision {
  const botones = botonesDelResumen(plan, entregaId);
  const falta = clientesPorResolver(plan)[0]?.destino ?? null;
  const { visible } = numeracion(plan);
  return puntoResumen({
    origen, ref: entregaId, nombre, pregunta: `${nombre} · El resumen del reparto: ¿lo cargo así?`, botones, viajes,
    numeros: plan.mensajes.filter(m => !m.descartado).map(m => visible(m.n)),
    grupos: gruposDelPlan(plan).map(g => ({ k: g.k, titulo: nombreDestino(g.destino), ref: g.destino.tipo === 'existente' ? g.destino.negocio_id : `nuevo:${g.destino.cliente ?? ''}` })),
    version: botones[0]?.id.split('|')[4] ?? '-', creaCliente: creaCliente(plan), porDecidir: pendientes(plan).length > 0,
    falta: falta?.falta ? { tipo: falta.falta, fichas: (falta.opciones ?? []).map(filaDeFicha) } : null,
  });
}

/** El punto de «¿Creo el cliente nuevo «X»?», con los parecidos como los muestra la confirmación. */
export function puntoDelNuevo(entId: string, nombre: string, propuesto: string, opciones: ReadonlyArray<OpcionNegocio>, viajes: ReadonlyArray<ViajeAbierto>): PuntoDecision {
  const parecidos = viajesParecidos(propuesto, viajes).map(v => {
    const i = opciones.findIndex(o => o.id === v.id);
    return { viaje: v, numero: i >= 0 ? i + 1 : null };
  });
  return puntoNuevo({ ref: entId, nombre, pregunta: `${nombre} · ¿Creo el cliente nuevo «${propuesto}»?`, propuesto, parecidos, opciones, otros: viajes });
}

/** El punto de la pregunta del contacto. `pide` sale de lo que se preguntó (`cliente.pregunta`) y de las opciones. */
export function puntoDelContacto(
  entId: string, nombre: string, pregunta: string | null | undefined, opciones: ReadonlyArray<ContactoCandidato>, nombreDado: string, botones?: BotonBandeja[],
): PuntoDecision {
  const pide = pregunta === 'llave_de_otro' ? 'misma'
    : pregunta === 'elegir' ? 'elegir'
    : pregunta === 'crear' ? 'crear'
    : pregunta === 'llave' ? 'llave'
    : opciones.length === 1 ? 'misma'
    : opciones.length > 1 ? 'elegir'
    : nombreDado.trim() ? 'llave' : 'nombre';
  const bs = pide === 'misma' ? botones ?? botonesSiNo('p', entId, { si: TITULO_SI_ES, no: TITULO_NO_ES }) : undefined;
  return puntoContacto({ ref: entId, nombre, pregunta: `${nombre} · ${pregunta ?? ''}`.trim(), pide, fichas: opciones.map(filaDeCandidato), botones: bs });
}

/** El punto de «¿A qué viaje van?» de una entrega o de un entendimiento. */
export function puntoDelViaje(origen: 'entrega' | 'negocio', ref: string, nombre: string, opciones: ReadonlyArray<OpcionNegocio>, viajes: ReadonlyArray<ViajeAbierto>): PuntoDecision {
  return puntoViaje({ origen, ref, nombre, pregunta: `${nombre} · ¿A qué viaje van?`, opciones, otros: viajes });
}

/** Lo que espera la caja abierta como punto (lo usan la lectura y el acuse que hace la pregunta). */
export function puntoDeLaCaja(tandaId: string, p: PendienteDeLaCaja): PuntoDecision | null {
  const base = { ref: tandaId, nombre: '' };
  if (p.tipo === 'eleccion') {
    return puntoTanda({ ...base, pregunta: `¿De qué viaje es «${p.texto}»?`, pendiente: { tipo: 'eleccion', texto: p.texto, candidatos: p.candidatos, unSoloCliente: !!unSoloCliente(p.candidatos) } });
  }
  if (p.tipo === 'nombre') return puntoTanda({ ...base, pregunta: '¿Para qué cliente es el viaje nuevo?', pendiente: { tipo: 'nombre' } });
  const r = p.resolucion;
  if (r.tipo === 'llave_de_otro') {
    return puntoTanda({ ...base, pregunta: `El dato ya es de ${r.ficha.nombre}. ¿Es la misma persona?`, pendiente: { tipo: 'misma', botones: botonesSiNo('t', tandaId, { si: TITULO_SI_ES, no: TITULO_NO_ES }) } });
  }
  if (r.tipo === 'elegir') return puntoTanda({ ...base, pregunta: `¿Cuál ${p.nombre ?? ''} es, o es otra persona?`, pendiente: { tipo: 'elegir', fichas: r.opciones.map(filaDeFicha) } });
  if (r.tipo === 'pedir_llave') return puntoTanda({ ...base, pregunta: `¿Me pasas el celular o el correo de ${p.nombre ?? 'el cliente'}?`, pendiente: { tipo: 'llave' } });
  if (r.tipo === 'sin_nombre') return puntoTanda({ ...base, pregunta: '¿Cómo se llama el cliente?', pendiente: { tipo: 'nombre' } });
  return null;
}

