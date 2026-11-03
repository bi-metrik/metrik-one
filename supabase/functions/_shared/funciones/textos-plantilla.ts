// ============================================================
// Funciones — QUÉ dicen los tres textos que salen de la ficha (P11, §1.8 del diseño de la etapa 2)
// ------------------------------------------------------------
// La plantilla, separada de la lógica (`textos.ts`). El orden, el tono y los emojis son los de los dos mensajes reales
// de Paula (`proyectos/sabor-experiencias/clarity/docs/entrada/2026-10-22_mensajes-reales-paula.md`): (1) la oferta y
// (2) la bienvenida al grupo de WhatsApp de la función. Aquí solo hay texto FIJO y el orden de las partes; los valores
// (fechas, precios, textos de la ficha y del lugar) llegan ya resueltos por la lógica, o como «[FALTA: …]».
//
// Lo que cambió frente a los mensajes reales, por decisión de Mauricio (P11, 2026-10-23):
//   · El pago va SOLO por el link de Bold, que llega por el chat: ni Nequi ni Daviplata ni su número.
//   · «Para reservar» sin «comprobante de pago» (Bold confirma solo).
//   · La línea del pago (oferta) y los pagos pendientes del grupo: los textos aprobados de §1.8 (23-oct).
//   · El párrafo de la puerta cerrada sin la frase temática de Jack («Recuerden… ¡Jack tiene todo preparado…») y la
//     recepción del lugar sin «nuestro pequeño rincón entre Halloween Town y Christmas Town»: esas frases con tema van
//     en el saludo temático de cada experiencia; lo del negocio queda sin tema (23-oct).
//   · La puerta cerrada termina en «para evitar interrupciones. 🚪», sin «durante la proyección. 🎬» (26-oct): Sabor también hace
//     catas de vino y clases de sushi, y la parte fija no puede asumir cine.
//   · La puerta cerrada sale solo si la experiencia la tiene marcada (26-oct, Mauricio y Paula: «aplica solo a las
//     películas… En los talleres no aplica»). La llegada 10 minutos antes sigue fija en todas.
//   · El mensaje directo va sin la intro (23-oct): gancho, qué incluye, precio y los horarios aparte.
//   · «paga el saldo 1 día antes» sale del plazo del saldo de la campaña («N días antes»).
//   · Con plazo 0 la línea del abono cambia entera (28-oct, Mauricio, P16): «El saldo lo pagas con el link hasta que
//     empiece la experiencia, o durante la experiencia, con nuestro equipo.» (un abono y varios).
//   · Pagos pendientes de la bienvenida, en todos los plazos (28-oct): «…por el chat de su reserva, o durante la
//     experiencia, con nuestro equipo.»
// Pura: sin red, sin reloj.
// ============================================================

/** Lo que la lógica le entrega a la plantilla de la oferta: cada parte ya escrita (o con su «[FALTA: …]»). */
export interface PartesOferta {
  titulo: string;
  gancho: string;
  /** `null` en el mensaje directo: va sin la intro (23-oct). */
  intro: string | null;
  /** Una línea por cosa incluida. */
  incluye: string[];
  /** Post: las funciones (día y hora, y su preventa debajo). Mensaje directo: solo el nombre de la campaña. */
  agenda: { tipo: 'funciones'; lineas: string[] } | { tipo: 'campana'; campana: string };
  /** Las líneas de precio que van bajo la agenda (preventa y boletería regular), si las hay. */
  precios: string[];
  /** «✨ Reserva con $100.000 por cupo…», o `null` si ninguna función se aparta con abono. */
  abono: string | null;
  direccion: string;
  emojis: string;
}

export const TEXTO_OFERTA = {
  incluye: '✨ INCLUYE:',
  agenda: '📅',
  preventa: (precio: string, hasta: string | null) => `🎟️ Preventa: ${precio} por persona${hasta ? ` (hasta el ${hasta})` : ''}`,
  preventaAlgunas: (precio: string, hasta: string | null) =>
    `🎟️ Preventa en algunos horarios: ${precio} por persona${hasta ? ` (hasta el ${hasta})` : ''}`,
  preventaVarias: '🎟️ Preventa en algunos horarios: te contamos el precio con cada horario.',
  regular: (precio: string) => `🎫 Boletería regular: ${precio}`,
  regularVarios: '🎫 Boletería regular: te contamos el precio con cada horario.',
  /** «1 día antes» o «N días antes»: el plazo del saldo de la campaña (1 o más días). */
  plazoSaldo: (dias: number) => (dias === 1 ? '1 día antes' : `${dias} días antes`),
  abono: (abono: string, plazo: string) => `✨ Reserva con ${abono} por cupo y paga el saldo ${plazo}.`,
  abonoVarios: (plazo: string) => `✨ Reserva con un abono por cupo y paga el saldo ${plazo}.`,
  /** Con plazo 0 (P16, Mauricio 28-oct): link hasta que empieza; ya en la experiencia, con el equipo (QR de Bold). */
  abonoHastaInicio: (abono: string) =>
    `✨ Reserva con ${abono} por cupo. El saldo lo pagas con el link hasta que empiece la experiencia, o durante la experiencia, con nuestro equipo.`,
  abonoVariosHastaInicio:
    '✨ Reserva con un abono por cupo. El saldo lo pagas con el link hasta que empiece la experiencia, o durante la experiencia, con nuestro equipo.',
  /** El mensaje directo no lista funciones (pesa 1.000 bytes como máximo): nombra la campaña y ofrece los horarios. */
  agendaDirecto: (campana: string) => `📅 ${campana}: te compartimos por este chat los horarios disponibles.`,
  direccion: (direccion: string) => `📍 ${direccion}`,
  paraReservar: '📝 Para reservar: nombre completo, cédula, celular y horario elegido.',
  /** Aprobado tal cual (23-oct), sin punto final. */
  pago: '💳 Te enviamos el link de pago por este chat',
  cierre: (emojis: string) => `${emojis} ¡Cupos limitados! Elige tu horario y prepárate para una experiencia inolvidable. ✨`,
};

/** La oferta (post de Instagram y mensaje directo), en el orden del mensaje real 1. */
export function plantillaOferta(p: PartesOferta): string {
  const t = TEXTO_OFERTA;
  return [
    p.titulo,
    p.gancho,
    p.intro,
    [t.incluye, ...p.incluye].join('\n'),
    (p.agenda.tipo === 'funciones' ? [t.agenda, '', ...p.agenda.lineas, ...p.precios] : [t.agendaDirecto(p.agenda.campana), ...p.precios]).join('\n'),
    p.abono,
    t.direccion(p.direccion),
    t.paraReservar,
    t.pago,
    t.cierre(p.emojis),
  ]
    .filter((x): x is string => x !== null)
    .join('\n\n');
}

/** Lo que la lógica le entrega a la plantilla de la bienvenida al grupo de WhatsApp de una función. */
export interface PartesBienvenida {
  saludo: string;
  /** «Sábado 24 de octubre», «1:00 p. m.», «12:50 p. m.» y «1:10 p. m.»: salen de la hora de la función. */
  dia: string;
  hora: string;
  llegada: string;
  inicio: string;
  direccion: string;
  piso: string;
  recepcion: string;
  parqueadero: string;
  relato: string;
  firma: string;
  /** Si va el párrafo de la puerta cerrada (la experiencia la tiene marcada). */
  puertaCerrada: boolean;
}

export const TEXTO_BIENVENIDA = {
  fecha: '📅 FECHA Y HORA',
  llegada: (h: string) => `🕐 LLEGADA: ${h}`,
  inicio: (h: string) => `✨ INICIAMOS: ${h} puntual.`,
  puerta: [
    '⏰ ¡MUY IMPORTANTE!',
    'Les recomendamos llegar puntualmente. Para disfrutar de la experiencia completa y conservar la magia de nuestra ' +
      'celebración, una vez iniciemos cerraremos la puerta de ingreso para evitar interrupciones. 🚪',
  ].join('\n\n'),
  lugar: '📍 LUGAR',
  parqueadero: '🚗 PARQUEADERO',
  alLlegar: [
    '📱 AL LLEGAR',
    'Si por alguna razón tienen dificultad para encontrar el lugar, pueden comunicarse al número con el que realizaron ' +
      'su reserva o al número de este grupo.',
  ].join('\n\n'),
  pagos: ['💰 PAGOS PENDIENTES', 'Recuerden pagar el saldo con el link de pago que les enviamos por el chat de su reserva, o durante la experiencia, con nuestro equipo.'].join('\n\n'),
  importante: [
    '🚫 IMPORTANTE',
    'Desde hoy este grupo quedará habilitado únicamente para anuncios de los administradores, para que ninguna ' +
      'información importante se pierda entre los mensajes.',
    'Si tienen cualquier duda, pueden escribirme directamente por DM. 💌',
  ].join('\n\n'),
  despedida: 'Con cariño,',
};

/** La bienvenida al grupo de WhatsApp de una función, en el orden del mensaje real 2. */
export function plantillaBienvenida(p: PartesBienvenida): string {
  const t = TEXTO_BIENVENIDA;
  return [
    p.saludo,
    `${t.fecha}\n${p.dia} | ${p.hora}`,
    `${t.llegada(p.llegada)}\n${t.inicio(p.inicio)}`,
    p.puertaCerrada ? t.puerta : null,
    `${t.lugar}\n${p.direccion} – ${p.piso}`,
    p.recepcion,
    `${t.parqueadero}\n\n${p.parqueadero}`,
    t.alLlegar,
    t.pagos,
    t.importante,
    p.relato,
    `${t.despedida}\n${p.firma}`,
  ]
    .filter((x): x is string => x !== null)
    .join('\n\n');
}
