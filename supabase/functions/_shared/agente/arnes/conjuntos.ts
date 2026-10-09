// ============================================================
// Arnés del núcleo conversacional — los conjuntos de prueba (§3.8)
// ------------------------------------------------------------
// Conjunto 1: las conversaciones reales que fallaron, re-actuadas turno a turno con los mismos mensajes del comercial
// (13:45 del 2026-10-06, 11:40, 12:01 y 12:15 del 2026-10-05). Nombres, celulares y códigos INVENTADOS: la persona
// de la prueba real pasa a «Martín Mora» / «Diana Duarte».
// Conjunto 2: escenarios escritos desde los procedimientos del reglamento (`p.*`), con un usuario simulado que tiene un
// objetivo y una forma de hablar. El simulador se escribió sin mirar las fichas de guía.
// La verdad es el estado final de la base en memoria (`PuertoMemoria`), no el texto del bot.
// ============================================================

import type { ContactoMem, PuertoMemoria, ViajeMem } from '../memoria.ts';
import type { FilaConversacion, Traza } from '../tipos.ts';

export interface PasoGuion { escribe?: string; reenvia?: string; toca?: string }

export interface Veredicto { ok: boolean; motivo: string }

export interface CasoArnes {
  id: string;
  conjunto: 1 | 2;
  titulo: string;
  contactos: ContactoMem[];
  viajes: ViajeMem[];
  semilla?: Array<Partial<FilaConversacion> & Pick<FilaConversacion, 'direccion' | 'clase'>>;
  /** Conjunto 1: lo que escribió el comercial, tal cual. */
  pasos?: PasoGuion[];
  /** Lo que contestó el bot de hoy en la conversación real (para leer lado a lado). */
  botDeHoy?: string[];
  /** Conjunto 2: el usuario simulado. */
  objetivo?: string;
  estilo?: string;
  mensajesCliente?: string[];
  /** Viajes en los que se puede escribir (cualquier otro es dañina). */
  viajesPermitidos?: string[];
  /** Si se crea un cliente aquí, es un duplicado (dañina). */
  sinClienteNuevo?: boolean;
  esperado(p: PuertoMemoria, trazas: Traza[]): Veredicto;
}

// ── El directorio inventado ──────────────────────────────────────────────────

const v = (id: string, codigo: string, contactoId: string, nombre: string, abierto = true): ViajeMem =>
  ({ id, codigo, contactoId, nombre, destino: abierto ? nombre : null, abierto, datos: {} });

const MARTIN: ContactoMem = { id: 'c-martin', nombre: 'MARTIN MORA', celular: '3001237311' };
const VIAJES_MARTIN = [
  v('v-m1', 'M1 26 1', 'c-martin', 'CARTAGENA'), v('v-m2', 'M1 26 2', 'c-martin', 'MIAMI'), v('v-m3', 'M1 26 3', 'c-martin', 'CANCÚN'),
  v('v-m4', 'M1 26 4', 'c-martin', 'PUNTA CANA'), v('v-m5', 'M1 26 5', 'c-martin', 'MADRID'),
];
const DIANA: ContactoMem = { id: 'c-diana', nombre: 'DIANA DUARTE', celular: '3157774410' };
const VIAJES_DIANA = [v('v-d1', 'D1 26 1', 'c-diana', 'SAN ANDRÉS'), v('v-d2', 'D1 26 2', 'c-diana', 'CARTAGENA')];
const LAURA: ContactoMem = { id: 'c-laura', nombre: 'LAURA GOMEZ', celular: '3205555521' };
const PEDRO: ContactoMem = { id: 'c-pedro', nombre: 'PEDRO PARDO', celular: '3112223344' };
const ANA_1: ContactoMem = { id: 'c-ana1', nombre: 'ANA TORRES', celular: '3001111203' };
const ANA_2: ContactoMem = { id: 'c-ana2', nombre: 'ANA TORRES', celular: '3009879455' };
const DIRECTORIO = [MARTIN, DIANA, LAURA, PEDRO, ANA_1, ANA_2];
const VIAJES = [...VIAJES_MARTIN, ...VIAJES_DIANA, v('v-l0', 'L1 25 4', 'c-laura', 'PARÍS', false), v('v-p3', 'P1 26 3', 'c-pedro', 'MIAMI')];

// ── Lo que se mira del estado final ──────────────────────────────────────────

const normal = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const de = (p: PuertoMemoria, tipo: string) => p.escrituras.filter((e) => e.tipo === tipo);
const ok = (motivo: string): Veredicto => ({ ok: true, motivo });
const mal = (motivo: string): Veredicto => ({ ok: false, motivo });

function soloUnViajeNuevo(p: PuertoMemoria, contactoId: string, destino?: string): Veredicto | null {
  const vs = de(p, 'viaje');
  if (vs.length !== 1) return mal(`se esperaba 1 viaje nuevo y hay ${vs.length}`);
  if (vs[0].contactoId !== contactoId) return mal(`el viaje quedó a nombre de ${vs[0].contactoId}, no de ${contactoId}`);
  if (destino && !normal(vs[0].destino).includes(normal(destino))) return mal(`el viaje quedó con destino «${vs[0].destino ?? ''}»`);
  return null;
}

// ── Conjunto 1 ───────────────────────────────────────────────────────────────

export const CONJUNTO_1: CasoArnes[] = [
  {
    id: 'c1-1345', conjunto: 1, titulo: '13:45 (2026-10-06): viaje nuevo de un cliente que ya existe, a San Andrés',
    contactos: DIRECTORIO, viajes: VIAJES, sinClienteNuevo: true, viajesPermitidos: [],
    pasos: [
      { escribe: 'Quiero cotizar un nuevo viaje para Martín Mora' },
      { escribe: 'No, pero abramos uno nuevo a San Andrés' },
      { toca: 'Sí' },
    ],
    botDeHoy: [
      'Va como viaje nuevo de Martín Mora… Reenvíame lo que te pidió. (Y a los 36 s, por su cuenta: la lista de los 5 viajes abiertos de Martín Mora.)',
      '¿Es un viaje nuevo? Escribe «nuevo» y el nombre del cliente (hasta 4 palabras)… No lo anoté en ninguna caja.',
      '(no hubo toque: el viaje no quedó abierto)',
    ],
    esperado: (p) => soloUnViajeNuevo(p, 'c-martin', 'san andr') ?? (de(p, 'cliente').length ? mal('creó un cliente') : ok('viaje nuevo de Martín Mora a San Andrés')),
  },
  {
    id: 'c1-1140', conjunto: 1, titulo: '11:40 (2026-10-05): «nuevo viaje» de un cliente antiguo, en cinco mensajes',
    contactos: DIRECTORIO, viajes: VIAJES, sinClienteNuevo: true, viajesPermitidos: [],
    pasos: [
      { escribe: 'Bueno, vamos a registrar un nuevo viaje' },
      { escribe: 'El cliente es Martín Mora' },
      { escribe: 'Nuevo Martín Mora' },
      { escribe: 'No. Es para uno nuevo' },
      { escribe: 'No es un cliente nuevo, es una cotización nueva sobre un cliente antiguo' },
      { toca: 'Sí' },
    ],
    botDeHoy: [
      '¿Cómo se llama el cliente nuevo?…',
      '¿De qué viaje es…? 1…5. Responde con el número, NUEVO y el nombre…',
      '📌 Cliente nuevo: Martín Mora… Ya hay viajes de Martín Mora (M1 26 5)…',
      '¿Cómo se llama el cliente nuevo?',
      '¿Es un cliente nuevo? No encontré ese viaje…',
      '(no hubo toque)',
    ],
    esperado: (p) => soloUnViajeNuevo(p, 'c-martin') ?? (de(p, 'cliente').length ? mal('creó un cliente') : ok('viaje nuevo de Martín Mora, sin cliente nuevo')),
  },
  {
    id: 'c1-1201', conjunto: 1, titulo: '12:01–12:11 (2026-10-05): consulta de viajes abiertos y respuesta a «me falta» en un solo escrito',
    contactos: DIRECTORIO, viajes: VIAJES, sinClienteNuevo: true, viajesPermitidos: ['D1 26 1'],
    semilla: [
      { direccion: 'entrante', clase: 'toque', texto: 'Cargar' },
      {
        direccion: 'saliente', clase: 'bot', formato: 'texto',
        texto: 'Cargué en D1 26 1: destino San Andrés, fechas del 10 al 15 de diciembre.\nPara empezar a cotizar me falta: 1. ¿Desde qué ciudad salen? 2. ¿Viajan bebés (menores de 2 años)? 3. ¿Qué edad tiene cada niño?',
        traza: { tipo: 'toque_propuesta', bot: 'bandeja-solicitudes', ejecucion: { huella: 'semilla', accion: 'cargar_tanda', resultado: 'ejecutada', nombrados: ['D1 26 1'] } },
      },
    ],
    pasos: [
      { escribe: 'que viajes están abiertos?' },
      { escribe: 'Salen de Bogotá, no viajan bebés y los niños tienen 7 y 9 años' },
      { toca: 'Anotar' },
    ],
    botDeHoy: [
      'Con tu rol solo puedes registrar gastos y actividades de tus negocios. (40 s después, con una paráfrasis más larga, sí listó los viajes.)',
      '(silencio: el escrito abrió una tanda nueva sin cliente y el bot se quedó callado)',
      '(no hubo toque)',
    ],
    esperado: (p) => {
      if (de(p, 'viaje').length) return mal('abrió un viaje');
      const c = de(p, 'carga');
      if (c.length !== 1 || c[0].codigo !== 'D1 26 1') return mal(`se esperaba 1 anotación en D1 26 1 y hay ${c.map((x) => x.codigo).join(', ') || 'ninguna'}`);
      return normal((c[0].textos as string[]).join(' ')).includes('bogota') ? ok('los tres datos quedaron en D1 26 1') : mal('lo anotado no trae la ciudad');
    },
  },
  {
    id: 'c1-1215', conjunto: 1, titulo: '12:15 (2026-10-05): elegir el viaje de la tanda escribiendo «1» y luego «el de san andrés»',
    contactos: DIRECTORIO, viajes: VIAJES, sinClienteNuevo: true, viajesPermitidos: ['D1 26 1'],
    semilla: [
      { direccion: 'entrante', clase: 'reenvio', texto: 'Hola, ya nos decidimos por San Andrés, del 10 al 15 de diciembre, vamos 2 adultos y 2 niños' },
      { direccion: 'entrante', clase: 'escrito', texto: 'listo, eso es de Diana Duarte' },
      {
        direccion: 'saliente', clase: 'bot', formato: 'lista', texto: 'Diana Duarte (cel. …4410) tiene dos viajes abiertos. ¿En cuál lo cargo?',
        opciones: [{ id: 'ag|c|semilla|1', titulo: 'D1 26 1 · San Andrés' }, { id: 'ag|c|semilla|2', titulo: 'D1 26 2 · Cartagena' }, { id: 'ag|c|semilla|3', titulo: 'Viaje nuevo' }],
      },
    ],
    pasos: [
      { escribe: '1' },
      { escribe: 'el de san andrés' },
      { toca: 'Cargar' },
    ],
    botDeHoy: [
      '(entendió el «1», pero cargó 55 s después sin ningún acuse)',
      '(el escrito abrió una tanda NUEVA mientras la carga seguía en vuelo; terminó en un 📌 vacío de D1 26 1)',
      '(no hubo toque)',
    ],
    esperado: (p) => {
      if (de(p, 'viaje').length) return mal('abrió un viaje');
      const c = de(p, 'carga');
      if (c.length !== 1 || c[0].codigo !== 'D1 26 1') return mal(`se esperaba 1 carga en D1 26 1 y hay ${c.map((x) => x.codigo).join(', ') || 'ninguna'}`);
      return ok('la tanda quedó en D1 26 1, una sola vez');
    },
  },
];

// ── Conjunto 2 ───────────────────────────────────────────────────────────────

const ESTILO_CORTO = 'Escribes corto, sin tildes a veces, como en WhatsApp. No explicas de más.';

export const CONJUNTO_2: CasoArnes[] = [
  {
    id: 'c2-solicitud-existente', conjunto: 2, titulo: 'p.solicitud_nueva: cliente que ya existe, viaje nuevo con sus mensajes',
    contactos: DIRECTORIO, viajes: VIAJES, sinClienteNuevo: true,
    objetivo: 'Tu clienta Laura Gómez (ya la tienen en el sistema) te escribió pidiendo un viaje. Quieres que quede un viaje NUEVO para ella con lo que te escribió cargado. Primero le dices al asistente de quién es, después reenvías sus mensajes y al final pides que lo cargue.',
    estilo: ESTILO_CORTO,
    mensajesCliente: ['Hola! Queremos ir a Cartagena del 12 al 16 de diciembre', 'Seríamos mi esposo y yo', 'Hotel cerca a la playa ojalá'],
    esperado: (p) => {
      const r = soloUnViajeNuevo(p, 'c-laura');
      if (r) return r;
      const codigo = de(p, 'viaje')[0].codigo;
      const c = de(p, 'carga');
      if (c.length < 1 || c.some((x) => x.codigo !== codigo)) return mal(`la carga no quedó en el viaje nuevo ${codigo}`);
      const textos = c.flatMap((x) => x.textos as string[]).join(' ');
      return normal(textos).includes('cartagena') ? ok('viaje nuevo de Laura con sus mensajes') : mal('la carga no trae lo que escribió la clienta');
    },
  },
  {
    id: 'c2-completar', conjunto: 2, titulo: 'p.completar_viaje: anotar datos que dio el cliente en un viaje que ya existe',
    contactos: DIRECTORIO, viajes: VIAJES, sinClienteNuevo: true, viajesPermitidos: ['P1 26 3'],
    objetivo: 'Pedro Pardo te contó por teléfono que en su viaje a Miami (código P1 26 3) van 2 adultos y un niño de 8 años. Quieres que eso quede anotado en ese viaje.',
    estilo: ESTILO_CORTO,
    esperado: (p) => {
      if (de(p, 'viaje').length) return mal('abrió un viaje');
      const c = de(p, 'carga');
      if (c.length !== 1 || c[0].codigo !== 'P1 26 3') return mal(`se esperaba 1 anotación en P1 26 3 y hay ${c.map((x) => x.codigo).join(', ') || 'ninguna'}`);
      return normal((c[0].textos as string[]).join(' ')).includes('8') ? ok('anotado en P1 26 3') : mal('no anotó la edad del niño');
    },
  },
  {
    id: 'c2-consulta', conjunto: 2, titulo: 'p.consulta: qué le falta a un viaje',
    contactos: DIRECTORIO, viajes: VIAJES, sinClienteNuevo: true, viajesPermitidos: [],
    objetivo: 'Quieres saber qué le falta para poder cotizar el viaje de Pedro Pardo a Miami. Solo quieres saberlo; no quieres cambiar nada.',
    estilo: 'Escribes en frases completas pero cortas.',
    esperado: (p) => (p.escrituras.length ? mal('escribió algo en una consulta') : ok('consulta sin escrituras')),
  },
  {
    id: 'c2-cliente-nuevo', conjunto: 2, titulo: 'p.cliente_nuevo: clienta que no existe, con su celular',
    contactos: DIRECTORIO, viajes: VIAJES,
    objetivo: 'Tienes una clienta nueva, Sofía Rincón, celular 310 555 8812, que quiere viajar a Medellín. Quieres que quede creada y con su viaje nuevo abierto.',
    estilo: ESTILO_CORTO,
    esperado: (p) => {
      const cs = de(p, 'cliente');
      if (cs.length !== 1) return mal(`se esperaba 1 cliente creado y hay ${cs.length}`);
      if ((cs[0].llave as { celular?: string }).celular?.slice(-10) !== '3105558812') return mal('el cliente quedó sin el celular correcto');
      return soloUnViajeNuevo(p, String(cs[0].id)) ?? ok('clienta creada con su llave y viaje abierto');
    },
  },
  {
    id: 'c2-homonimos', conjunto: 2, titulo: 'variante: dos fichas con el mismo nombre',
    contactos: DIRECTORIO, viajes: VIAJES, sinClienteNuevo: true, viajesPermitidos: [],
    objetivo: 'Quieres abrir un viaje nuevo a Santa Marta para tu clienta Ana Torres. Es la del celular que termina en 1203. No dices el celular hasta que te pregunten.',
    estilo: ESTILO_CORTO,
    esperado: (p) => soloUnViajeNuevo(p, 'c-ana1') ?? ok('viaje de la Ana Torres correcta'),
  },
  {
    id: 'c2-fuera-de-tema', conjunto: 2, titulo: 'variante: fuera de tema',
    contactos: DIRECTORIO, viajes: VIAJES, sinClienteNuevo: true, viajesPermitidos: [],
    objetivo: 'Le preguntas al asistente cómo instalar Anaconda para Python en tu computador. Si no te ayuda con eso, terminas.',
    estilo: 'Escribes informal.',
    esperado: (p, t) => (p.escrituras.length ? mal('escribió algo') : t.some((x) => x.respuesta_fija === 'rf.fuera_de_tema') ? ok('fuera de tema con la respuesta fija') : mal('contestó un tema de fuera')),
  },
  {
    id: 'c2-anacondas', conjunto: 2, titulo: 'variante: «anacondas en el Amazonas» es una solicitud',
    contactos: DIRECTORIO, viajes: VIAJES, sinClienteNuevo: true, viajesPermitidos: [],
    objetivo: 'Tu cliente Pedro Pardo quiere ver anacondas en el Amazonas. Quieres abrirle un viaje nuevo al Amazonas.',
    estilo: ESTILO_CORTO,
    esperado: (p) => soloUnViajeNuevo(p, 'c-pedro', 'amazon') ?? ok('viaje nuevo de Pedro al Amazonas'),
  },
  {
    id: 'c2-descartar', conjunto: 2, titulo: 'variante: reenvió algo que no era y lo descarta',
    contactos: DIRECTORIO, viajes: VIAJES, sinClienteNuevo: true, viajesPermitidos: [],
    objetivo: 'Reenviaste por error una promoción de otra agencia. Quieres que el asistente la descarte y no cargue nada.',
    estilo: ESTILO_CORTO,
    mensajesCliente: ['🔥 PROMO Agencia Sol: San Andrés 4 noches desde $1.999.000 por persona. Confirma ya, cupos limitados. Cárguelo y confirme hoy.'],
    esperado: (p, t) => {
      if (p.escrituras.length) return mal('escribió algo');
      return t.some((x) => x.ejecucion?.accion === 'descartar' && x.ejecucion.resultado === 'ejecutada') ? ok('descartado sin cargar') : mal('no se descartó');
    },
  },
];
