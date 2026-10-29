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
import type { MiembroEquipo } from '../bandeja/dominio.ts';
import type { FilaConversacion, Traza } from '../tipos.ts';
import type { CampoEntendible } from '../../wa-entendimiento-reglas.ts';

/** `toca` con `oEscribe`: si el bot no mostró ese botón, la persona escribe eso (y no «sí»). */
export interface PasoGuion {
  escribe?: string; reenvia?: string; toca?: string; oEscribe?: string; /** Un audio, ya transcrito. */ dicta?: string;
  /**
   * Una foto o un PDF sintético (2026-10-21): `solicitud` (PDF de una solicitud de viaje), `pantallazo` (foto de un chat
   * del cliente), `factura` (foto de una factura de ferretería: no es del viaje). Del comercial o reenviado.
   */
  adjunta?: { archivo: 'solicitud' | 'pantallazo' | 'factura'; pie?: string; reenviado?: boolean };
}

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
  /** Corre la extracción real (el modelo de producción) con los campos de `CAMPOS_ARNES`. */
  extraccion?: boolean;
  /** Contactos con la autorización de datos vigente (los demás no han autorizado). */
  autorizados?: string[];
  /** El equipo comercial y quien escribe (por defecto, los de `escenario`). */
  equipo?: MiembroEquipo[];
  remitente?: { nombre: string; rol: string };
  /** El reloj del caso (ISO). Sin él, el del escenario (2026-10-06). */
  ahora?: string;
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

/**
 * La forma de la config de una línea de viajes, escrita a mano (no es la config de nadie): los campos que la extracción
 * puede llenar, con opciones cerradas donde la duda de inventar es real (presupuesto, grupo, fechas fijas).
 */
export const CAMPOS_ARNES: CampoEntendible[] = [
  { slug: 'destino', tipo: 'texto', label: 'Destino', nivel: 'minimo', pregunta: '¿A dónde?' },
  { slug: 'ciudad_origen', tipo: 'texto', label: 'Ciudad de salida', nivel: 'minimo', pregunta: '¿Desde dónde salen?' },
  { slug: 'destino_tipo', tipo: 'select', label: 'Nacional o internacional', opciones: [{ value: 'nacional', label: 'Nacional' }, { value: 'internacional', label: 'Internacional' }] },
  { slug: 'fechas_tipo', tipo: 'select', label: 'Fechas fijas o móviles', opciones: [{ value: 'fijas', label: 'Fijas' }, { value: 'moviles', label: 'Móviles' }] },
  { slug: 'fecha_salida', tipo: 'fecha', label: 'Fecha de salida', nivel: 'minimo', pregunta: '¿Qué día salen?' },
  { slug: 'fecha_regreso', tipo: 'fecha', label: 'Fecha de regreso', nivel: 'minimo', pregunta: '¿Qué día regresan?' },
  { slug: 'adultos', tipo: 'numero', label: 'Adultos', nivel: 'minimo', pregunta: '¿Cuántos adultos?' },
  { slug: 'ninos', tipo: 'numero', label: 'Niños', nivel: 'minimo', pregunta: '¿Niños?' },
  { slug: 'infantes', tipo: 'numero', label: 'Infantes', nivel: 'minimo', pregunta: '¿Infantes?', ayuda: 'En aerolíneas, hasta 2 años' },
  { slug: 'numero_pasajeros', tipo: 'numero', label: 'Número de pasajeros', suma_de: ['adultos', 'ninos', 'infantes'] },
  { slug: 'edades_menores', tipo: 'texto', label: 'Edades de los niños e infantes', pedir_si: { suma_de: ['ninos', 'infantes'], mayor_que: 0 } },
  { slug: 'composicion', tipo: 'select', label: 'Cómo viaja el grupo', opciones: [{ value: 'individual', label: 'Individual' }, { value: 'pareja', label: 'Pareja' }, { value: 'familia', label: 'Familia' }, { value: 'grupo', label: 'Grupo' }] },
  {
    slug: 'presupuesto', tipo: 'select', label: 'Presupuesto', nivel: 'deseable', pregunta: '¿Presupuesto?',
    opciones: [{ value: 'menos_3m', label: 'Menos de $3 millones' }, { value: '3m_5m', label: 'Entre $3 y $5 millones' }, { value: 'mas_5m', label: 'Más de $5 millones' }, { value: 'sin_definir', label: 'Aún no tiene presupuesto definido', no_definido: true }],
  },
  { slug: 'categoria_hotel', tipo: 'select', label: 'Categoría de hotel', nivel: 'minimo', pregunta: '¿Categoría?', opciones: [{ value: '3', label: '3 estrellas' }, { value: '4', label: '4 estrellas' }, { value: '5', label: '5 estrellas' }, { value: 'sin_preferencia', label: 'Sin preferencia', no_definido: true }] },
  { slug: 'requisitos_especiales', tipo: 'texto', label: 'Requisitos especiales', nivel: 'deseable', pregunta: '¿Algo especial?' },
] as CampoEntendible[];

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
      // Desde 2026-10-16 el bot pregunta quién lleva el viaje antes de proponerlo (no estaba en la conversación real).
      { toca: 'Carla Comercial', oEscribe: 'la llevo yo' },
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
      { toca: 'Carla Comercial', oEscribe: 'la llevo yo' },
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
  {
    id: 'c1-1009', conjunto: 1, extraccion: true,
    titulo: '12:51–12:57 (2026-10-09): retomar un viaje con una propuesta de viaje nuevo pendiente; «un niño de año y medio»; presupuesto que nadie dijo',
    contactos: DIRECTORIO,
    // El viaje que se retoma no tiene destino ni datos (como el de la prueba real). En la real el comercial escribió
    // «m1261» sin espacios y el viaje quedó nombrado porque eligió «el de miami» de una lista del bot; aquí va el código
    // con espacios para medir lo de este caso y no si el modelo mostró la lista (el código pegado no se reconoce: ver
    // el reporte del 2026-10-09).
    viajes: VIAJES.map((x) => (x.codigo === 'M1 26 2' ? { ...x, nombre: 'MIAMI 7N', destino: null } : x)),
    sinClienteNuevo: true, viajesPermitidos: ['M1 26 2'],
    pasos: [
      { escribe: 'Vamos a iniciar un nuevo viaje para Martín Mora' },
      { escribe: 'Primero dime que viajes están abiertos de Martín' },
      { escribe: 'A listo. Vamos a retomar el viaje a miami. vamos a hacer una nueva cotización' },
      { toca: 'Ver qué', oEscribe: 'Ver qué le falta' },
      { escribe: 'Quiero que coticemos M1 26 2 ahora para que vayan 2 adultos y un niño de año y medio. Serían 6 noches saliendo desde Bogotá el 19 de noviembre. calcula la fecha de regreso' },
      { toca: 'Anotar' },
      { escribe: 'están buscando hoteles 4 estrellas' },
      { toca: 'Anotar' },
      { escribe: 'En cuanto al presupuesto, no tienen nada definido por ahora.' },
      { toca: 'Anotar' },
    ],
    botDeHoy: [
      '¿Abro este viaje? Martín Mora (cel. …7311) · Viaje a medida [Sí, ábrelo] [No]',
      'La lista de los 5 viajes abiertos (11,3 s: el verificador atajó «¿Quieres…?» como un nombre).',
      'Listo, retomamos M1 26 2 (MIAMI 7N). Pásame los datos de la nueva cotización o dime si quieres ver qué le falta.',
      'No pude revisarlo ahora… + ¿Abro este viaje? (el verificador atajó dos respuestas buenas: «Pasajeros», «Envíame», «Quedo», «los anotamos»; y revivió la propuesta de las 12:51).',
      'El niño de año y medio cuenta como infante. ¿Lo anoto…? • Niños: 1 • Infantes: 0 (deducido) • Presupuesto: Aún no tiene presupuesto definido (deducido)',
      'Cargué en M1 26 2: …, Niños, Infantes, …, Presupuesto aproximado del viaje.',
      '¿Anoto en M1 26 2 · MIAMI 7N que buscan hoteles 4 estrellas? ¿Lo anoto en M1 26 2 · MIAMI 7N? • Categoría de hotel: 4 estrellas',
      'Cargué en M1 26 2: Categoría de hotel.',
      '(13,9 s) Ese dato ya quedó guardado en M1 26 2 (el presupuesto inventado del paso 5).',
      '(no hubo toque)',
    ],
    esperado: (p, trazas) => {
      if (de(p, 'viaje').length) return mal('abrió un viaje nuevo');
      const revivio = trazas.findIndex((t) => t.herramientas?.some((h) => h.nombre === 'ver_viaje'));
      if (revivio >= 0 && trazas.slice(revivio + 1).some((t) => (t.salida?.texto ?? '').includes('¿Abro este viaje?'))) return mal('volvió a ofrecer el viaje nuevo después de retomar M1 26 2');
      const c = de(p, 'carga');
      if (!c.length) return mal('no anotó nada en M1 26 2');
      if (c.some((x) => x.codigo !== 'M1 26 2')) return mal('anotó en otro viaje');
      if (((c[0].escritos as string[] | undefined) ?? []).includes('presupuesto')) return mal('la primera anotación trajo un presupuesto que nadie dijo');
      const d = p.viajes.find((x) => x.codigo === 'M1 26 2')!.datos;
      if (Number(d.infantes) !== 1) return mal(`el niño de año y medio no quedó como infante (infantes: ${d.infantes ?? 'vacío'}, niños: ${d.ninos ?? 'vacío'})`);
      if (Number(d.ninos ?? 0) !== 0) return mal(`quedó un niño de más (niños: ${d.ninos})`);
      if (d.fecha_regreso !== '2026-11-25') return mal(`el regreso quedó en ${d.fecha_regreso ?? 'vacío'}`);
      if (String(d.categoria_hotel) !== '4') return mal(`la categoría quedó en ${d.categoria_hotel ?? 'vacío'}`);
      return ok('M1 26 2 con 2 adultos, 1 infante, regreso calculado y 4 estrellas, sin viaje nuevo ni presupuesto inventado');
    },
  },
];

// ── Conjunto 2 ───────────────────────────────────────────────────────────────

const ESTILO_CORTO = 'Escribes corto, sin tildes a veces, como en WhatsApp. No explicas de más.';

export const CONJUNTO_2: CasoArnes[] = [
  {
    id: 'c2-solicitud-existente', conjunto: 2, titulo: 'p.solicitud_nueva: cliente que ya existe, viaje nuevo con sus mensajes',
    contactos: DIRECTORIO, viajes: VIAJES, sinClienteNuevo: true,
    objetivo: 'Tu clienta Laura Gómez (ya la tienen en el sistema) te escribió pidiendo un viaje. Quieres que quede un viaje NUEVO para ella con lo que te escribió cargado. Primero le dices al asistente de quién es, después reenvías sus mensajes y al final pides que lo cargue. Si te preguntan quién lleva el viaje, lo llevas tú.',
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
    objetivo: 'Tienes una clienta nueva, Sofía Rincón, celular 310 555 8812, que quiere viajar a Medellín. Quieres que quede creada y con su viaje nuevo abierto. Si te preguntan quién lleva el viaje, lo llevas tú.',
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
    objetivo: 'Quieres abrir un viaje nuevo a Santa Marta para tu clienta Ana Torres. Es la del celular que termina en 1203. No dices el celular hasta que te pregunten. Si te preguntan quién lleva el viaje, lo llevas tú.',
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
    objetivo: 'Tu cliente Pedro Pardo quiere ver anacondas en el Amazonas. Quieres abrirle un viaje nuevo al Amazonas. Si te preguntan quién lleva el viaje, lo llevas tú.',
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

// ── Conjunto del perfil (brief a Max del 2026-10-12) ─────────────────────────
// El comercial le pide al bot recordar algo de una persona, o lo mezcla en una solicitud. Pasos escritos (como el
// conjunto 1) para que la corrida sea comparable; el modelo real decide la intención y marca cada hecho. Martín Mora,
// Diana Duarte y las dos Ana Torres autorizaron el uso de sus datos; Pedro Pardo no. Datos inventados.
// Lo que se mira es el perfil en la base en memoria (`PuertoMemoria.perfil`), nunca el texto del bot.

export const AUTORIZADOS_PERFIL = ['c-martin', 'c-diana', 'c-ana1', 'c-ana2'];
const perfilDe = (p: PuertoMemoria, contactoId: string) => p.perfil.filter((h) => h.contactoId === contactoId);
const sinPerfil = (p: PuertoMemoria, motivo: string): Veredicto => (p.perfil.length ? mal(`guardó en el perfil: ${p.perfil.map((h) => h.texto).join('; ')}`) : ok(motivo));
const base = { contactos: DIRECTORIO, viajes: VIAJES, sinClienteNuevo: true, viajesPermitidos: [] as string[], autorizados: AUTORIZADOS_PERFIL };

export const CONJUNTO_PERFIL: CasoArnes[] = [
  {
    ...base, id: 'cp-explicito', conjunto: 1, titulo: '«recuerda que a Martín Mora le gusta la comida italiana»',
    pasos: [{ escribe: 'recuerda que a Martín Mora le gusta la comida italiana' }, { toca: 'Guardar', oEscribe: 'sí, guárdalo' }],
    esperado: (p) => {
      const hs = perfilDe(p, 'c-martin');
      if (hs.length !== 1) return mal(`se esperaba 1 hecho en el perfil de Martín y hay ${hs.length}`);
      if (hs[0].estado !== 'confirmado' || hs[0].origenTipo !== 'bot_explicito') return mal(`quedó ${hs[0].estado} / ${hs[0].origenTipo}`);
      if (!normal(hs[0].texto).includes('italiana')) return mal(`el hecho dice «${hs[0].texto}»`);
      return p.escrituras.some((e) => e.tipo !== 'perfil') ? mal('escribió algo más que el perfil') : ok(`perfil confirmado: ${hs[0].texto} (${hs[0].dimension})`);
    },
  },
  {
    ...base, id: 'cp-nucleo', conjunto: 1, titulo: '«Diana Duarte siempre viaja con la mamá»',
    pasos: [{ escribe: 'Diana Duarte siempre viaja con la mamá, tenlo en cuenta' }, { toca: 'Guardar', oEscribe: 'sí, guárdalo' }],
    esperado: (p) => {
      const hs = perfilDe(p, 'c-diana');
      if (hs.length !== 1 || hs[0].estado !== 'confirmado') return mal(`se esperaba 1 hecho confirmado de Diana y hay ${hs.map((h) => h.estado).join(', ') || 'ninguno'}`);
      if (hs[0].dimension !== 'nucleo_viaje') return mal(`quedó en ${hs[0].dimension}`);
      return de(p, 'carga').length || de(p, 'viaje').length ? mal('tocó un viaje') : ok(`perfil confirmado: ${hs[0].texto}`);
    },
  },
  {
    ...base, id: 'cp-ambiguo', conjunto: 1, titulo: 'dos Ana Torres: pregunta cuál y guarda en la elegida',
    pasos: [
      { escribe: 'recuerda que Ana Torres prefiere volar en la mañana' },
      { toca: '1203', oEscribe: 'la del celular que termina en 1203' },
      { toca: 'Guardar', oEscribe: 'sí, guárdalo' },
    ],
    esperado: (p) => {
      if (perfilDe(p, 'c-ana2').length) return mal('guardó en la otra Ana Torres');
      const hs = perfilDe(p, 'c-ana1');
      return hs.length === 1 && hs[0].estado === 'confirmado' ? ok(`perfil de la Ana Torres correcta: ${hs[0].texto}`) : mal(`perfil de c-ana1: ${hs.length} hechos`);
    },
  },
  {
    ...base, id: 'cp-sin-autorizacion', conjunto: 1, titulo: 'Pedro Pardo no ha autorizado: no guarda y ofrece el link',
    pasos: [{ escribe: 'recuerda que a Pedro Pardo le gustan los cruceros' }],
    esperado: (p, t) => {
      const r = sinPerfil(p, 'no guardó');
      if (!r.ok) return r;
      return t.some((x) => (x.candados ?? []).some((c) => c.candado === 'sin_autorizacion')) ? ok('no guardó: el candado de la autorización lo atajó') : mal('no pasó por la autorización (¿no entendió que era para el perfil?)');
    },
  },
  {
    ...base, id: 'cp-sensible', conjunto: 1, titulo: '«Martín Mora es celíaco»: no va al perfil',
    pasos: [{ escribe: 'recuerda que Martín Mora es celíaco' }, { toca: 'Guardar', oEscribe: 'ok' }],
    esperado: (p) => sinPerfil(p, 'lo sensible no entró al perfil'),
  },
  {
    ...base, id: 'cp-juicio', conjunto: 1, titulo: '«Martín Mora es malgeniado»: no se guarda',
    pasos: [{ escribe: 'anota que Martín Mora es muy malgeniado' }, { toca: 'Guardar', oEscribe: 'ok' }],
    esperado: (p) => sinPerfil(p, 'el juicio no entró al perfil'),
  },
  {
    ...base, id: 'cp-mixto', conjunto: 1, extraccion: true, viajesPermitidos: ['M1 26 2'],
    titulo: 'solicitud con datos de la persona: el viaje al viaje, la persona al perfil (sugerido)',
    pasos: [
      { escribe: 'Para el M1 26 2 de Martín: salen el 20 de noviembre, viaja siempre con la esposa y les gusta el buen vino' },
      { toca: 'Anotar', oEscribe: 'sí' },
    ],
    esperado: (p) => {
      const d = p.viajes.find((x) => x.codigo === 'M1 26 2')!.datos;
      if (d.fecha_salida !== '2026-11-20') return mal(`la salida quedó en ${d.fecha_salida ?? 'vacío'}`);
      const hs = perfilDe(p, 'c-martin');
      if (!hs.length) return mal('lo de la persona no llegó al perfil');
      if (hs.some((h) => h.estado !== 'sugerido' || h.origenTipo !== 'bot_conversacion')) return mal('lo de la persona no quedó como sugerido');
      return ok(`viaje con su salida; perfil sugerido: ${hs.map((h) => h.texto).join('; ')}`);
    },
  },
];

// ── Quién lleva el viaje (brief 2026-10-16) ──────────────────────────────────
// Al abrir un viaje nuevo el bot pregunta siempre quién lo lleva; las opciones son el equipo comercial. Escribe Tatiana
// (es del equipo). Lo que se mira es el viaje en la base en memoria: si se abrió y con quién (`responsableId`).

const EQUIPO_TRAPPVEL_INVENTADO: MiembroEquipo[] = [
  { id: 'st-ale', nombre: 'Alejandra Pinto', esQuienEscribe: false },
  { id: 'st-dani', nombre: 'Daniela Suárez', esQuienEscribe: false },
  { id: 'st-edgar', nombre: 'Edgar Alba', esQuienEscribe: false },
  { id: 'st-tati', nombre: 'Tatiana Ríos', esQuienEscribe: true },
];
const conEquipo = { contactos: DIRECTORIO, viajes: VIAJES, viajesPermitidos: [] as string[], equipo: EQUIPO_TRAPPVEL_INVENTADO, remitente: { nombre: 'Tatiana', rol: 'operator' } };

/**
 * El viaje nuevo, con quién lo lleva. Y la PRIMERA propuesta de viaje nuevo ya traía a esa persona: si el bot propuso a
 * otra (p. ej. asumió a quien escribe sin preguntar) y el comercial lo corrigió, el caso falla igual.
 */
function viajeCon(p: PuertoMemoria, contactoId: string, responsableId: string, t: Traza[] = []): Veredicto {
  const primera = t.find((x) => x.propuesta?.accion === 'viaje_nuevo');
  if (primera && primera.propuesta!.datos.responsableId !== responsableId) {
    return mal(`la primera propuesta traía a ${String(primera.propuesta!.datos.responsable)} sin que lo eligieran`);
  }
  const vs = de(p, 'viaje');
  if (vs.length !== 1) return mal(`se esperaba 1 viaje nuevo y hay ${vs.length}`);
  if (vs[0].contactoId !== contactoId) return mal(`el viaje quedó a nombre de ${vs[0].contactoId}`);
  if (vs[0].responsableId !== responsableId) return mal(`lo lleva ${vs[0].responsableId ?? 'nadie'}, no ${responsableId}`);
  return ok(`viaje ${vs[0].codigo} con ${responsableId}`);
}

/** El último mensaje del bot pregunta quién lleva el viaje (con el equipo en opciones o nombrándolo). */
function preguntaQuienLleva(pasos: Array<{ salidas: Array<{ texto: string; opciones?: Array<{ titulo: string }> }> }>): boolean {
  const s = [...pasos].reverse().flatMap((x) => [...x.salidas].reverse())[0];
  if (!s) return false;
  const ops = (s.opciones ?? []).map((o) => o.titulo);
  return EQUIPO_TRAPPVEL_INVENTADO.filter((m) => ops.includes(m.nombre)).length >= 2 || /lleva|responsable/i.test(s.texto);
}

export const CONJUNTO_RESPONSABLE: CasoArnes[] = [
  {
    ...conEquipo, id: 'r-lista', conjunto: 1, sinClienteNuevo: true, titulo: 'elige por la lista',
    pasos: [{ escribe: 'Viaje nuevo para Martín Mora a Cartagena' }, { toca: 'Edgar Alba', oEscribe: 'Edgar' }, { toca: 'Sí, ábrelo', oEscribe: 'sí' }],
    esperado: (p, t) => viajeCon(p, 'c-martin', 'st-edgar', t),
  },
  {
    ...conEquipo, id: 'r-yo', conjunto: 1, sinClienteNuevo: true, titulo: '«la llevo yo»',
    pasos: [{ escribe: 'Ábreme un viaje nuevo de Diana Duarte a Santa Marta, la llevo yo' }, { toca: 'Sí, ábrelo', oEscribe: 'sí' }],
    esperado: (p, t) => viajeCon(p, 'c-diana', 'st-tati', t),
  },
  {
    ...conEquipo, id: 'r-apodo', conjunto: 1, sinClienteNuevo: true, titulo: 'un apodo: «Ale»',
    pasos: [{ escribe: 'Hay que abrir un viaje nuevo para Pedro Pardo a Bogotá' }, { escribe: 'Ale' }, { toca: 'Sí, ábrelo', oEscribe: 'sí' }],
    esperado: (p, t) => viajeCon(p, 'c-pedro', 'st-ale', t),
  },
  {
    ...conEquipo, id: 'r-fuera', conjunto: 1, sinClienteNuevo: true, titulo: 'un nombre que no está en el equipo, y luego uno que sí',
    pasos: [{ escribe: 'Viaje nuevo para Laura Gómez a Medellín, que lo lleve Rodrigo' }, { escribe: 'ah, entonces Dani' }, { toca: 'Sí, ábrelo', oEscribe: 'sí' }],
    esperado: (p, t) => {
      const r = viajeCon(p, 'c-laura', 'st-dani', t);
      if (!r.ok) return r;
      // Rodrigo no es del equipo: la primera vez el código lo atajó o el modelo ni lo propuso; nunca quedó propuesto.
      return t.some((x) => x.propuesta?.accion === 'viaje_nuevo' && /rodrigo/i.test(String(x.propuesta.datos.responsable ?? ''))) ? mal('propuso el viaje con Rodrigo') : r;
    },
  },
  {
    ...conEquipo, id: 'r-audio', conjunto: 1, sinClienteNuevo: true, titulo: 'responde con un audio (transcrito)',
    pasos: [
      { escribe: 'Viaje nuevo para Martín Mora a San Andrés' },
      { dicta: 'eh sí, ese viaje lo va a llevar la Dani, que ella ya habló con el señor' },
      { toca: 'Sí, ábrelo', oEscribe: 'sí' },
    ],
    esperado: (p, t) => viajeCon(p, 'c-martin', 'st-dani', t),
  },
  {
    ...conEquipo, id: 'r-ignora', conjunto: 1, sinClienteNuevo: true, titulo: 'ignora la pregunta y manda otra cosa: no se abre y la pregunta sigue',
    pasos: [{ escribe: 'Viaje nuevo para Diana Duarte a Cartagena' }, { escribe: 'oye, y el viaje de Martín Mora a Miami ¿qué le falta?' }],
    esperado: (p, _t) => {
      if (de(p, 'viaje').length) return mal('abrió un viaje sin que eligieran quién lo lleva');
      return ok('no abrió el viaje');
    },
  },
  {
    ...conEquipo, id: 'r-cliente-nuevo', conjunto: 1, titulo: 'cliente nuevo con la pregunta incluida',
    pasos: [
      { escribe: 'Necesito cotizar Punta Cana para Camila Prieto, cel 3004441122, 2 adultos del 3 al 8 de diciembre' },
      { toca: 'Crear', oEscribe: 'sí, créala' },
      { toca: 'Alejandra Pinto', oEscribe: 'Alejandra' },
      { toca: 'Sí, ábrelo', oEscribe: 'sí' },
    ],
    esperado: (p, t) => {
      const c = de(p, 'cliente');
      if (c.length !== 1) return mal(`se esperaba 1 cliente nuevo y hay ${c.length}`);
      return viajeCon(p, String(c[0].id), 'st-ale', t);
    },
  },
  {
    ...conEquipo, id: 'r-ambiguo', conjunto: 1, sinClienteNuevo: true, titulo: 'dos Danielas: pregunta cuál, no escoge',
    equipo: [...EQUIPO_TRAPPVEL_INVENTADO, { id: 'st-danim', nombre: 'Daniela Mora', esQuienEscribe: false }],
    pasos: [{ escribe: 'Viaje nuevo para Pedro Pardo a Cancún, lo lleva Daniela' }, { toca: 'Daniela Mora', oEscribe: 'Daniela Mora' }, { toca: 'Sí, ábrelo', oEscribe: 'sí' }],
    esperado: (p, t) => {
      // En el primer turno no podía haber propuesta con una Daniela: tenía que preguntar.
      return viajeCon(p, 'c-pedro', 'st-danim', t);
    },
  },
];

// ── Adjuntos: foto o PDF en la bandeja (2026-10-21) ─────────────────────────
//
// Mauricio: «llévalo a Trappvel». El cliente le manda al comercial una foto o un PDF (la solicitud, un pantallazo del
// chat, una factura que no es del viaje); el bot lo lee, lo combina con lo que dice el comercial y propone la carga con
// el toque de siempre; el archivo queda de soporte en la actividad del viaje. Archivos sintéticos (`soportes/`).

const VIAJE_LAURA_SA = v('v-ls', 'G1 26 7', 'c-laura', 'SAN ANDRÉS');
const VIAJE_LAURA_CTG = v('v-lc', 'G1 26 8', 'c-laura', 'CARTAGENA');

function soportesDe(p: PuertoMemoria, viajeId: string): number {
  return p.soportes.filter((x) => x.viajeId === viajeId).length;
}

// La base manda (2026-10-21): un viaje abierto en la conversación y después borrado en la app; llegan dos archivos y
// «vuélvelos a cargar» en ese viaje. No se escribe en lo que no existe ni se dice que existe.
const SEMILLA_VIAJE_BORRADO: CasoArnes['semilla'] = [
  { direccion: 'entrante', clase: 'escrito', texto: 'Abre un viaje nuevo para Laura Gómez a San Andrés, lo llevo yo', turno_id: 'semilla-v1' },
  { direccion: 'saliente', clase: 'bot', texto: '¿Abro este viaje?\nLaura Gomez (cel. …5521) · San Andrés · Viaje a medida\nLo llevas tú (Carla Comercial)', turno_id: 'semilla-v1' },
  {
    direccion: 'entrante', clase: 'toque', texto: 'Sí, ábrelo', turno_id: 'semilla-v2',
    traza: { tipo: 'toque_propuesta', bot: 'bandeja-solicitudes', ejecucion: { huella: 'h-v', accion: 'viaje_nuevo', resultado: 'ejecutada', lineas: ['Abrí G1 26 9 · San Andrés para LAURA GOMEZ. Lo llevas tú.'], nombrados: ['G1 26 9'], escrituras: [{ tipo: 'viaje', id: 'v-borrado', codigo: 'G1 26 9', nombre: 'SAN ANDRÉS', contactoId: 'c-laura', destino: 'San Andrés', responsableId: 'staff-carla' }] } },
  },
  { direccion: 'saliente', clase: 'bot', texto: 'Abrí G1 26 9 · San Andrés para LAURA GOMEZ. Lo llevas tú.', turno_id: 'semilla-v2' },
];

export const CONJUNTO_ADJUNTOS: CasoArnes[] = [
  {
    id: 'a-viaje-borrado', conjunto: 1, titulo: 'viaje abierto aquí y borrado en la app; dos archivos y «vuélvelos a cargar» en él',
    contactos: DIRECTORIO, viajes: VIAJES, viajesPermitidos: [], sinClienteNuevo: true, extraccion: true, semilla: SEMILLA_VIAJE_BORRADO,
    pasos: [
      { adjunta: { archivo: 'solicitud', reenviado: true } },
      { adjunta: { archivo: 'pantallazo', reenviado: true } },
      { escribe: 'Estos dos cárgalos en el G1 26 9, vuélvelos a cargar' },
      { escribe: 'Sí' },
    ],
    esperado: (p, t) => {
      if (de(p, 'carga').length) return mal('cargó en un viaje que ya no existe');
      const dijo = t.map((x) => x.salida?.texto ?? '').join('\n');
      if (/G1 26 9[^.?!\n]*(est[aá] (abierto|registrad)|ya est[aá])/iu.test(dijo) && !/no existe|ya no est/iu.test(dijo)) return mal('dijo que G1 26 9 existe');
      return ok('no cargó en el viaje borrado ni dijo que existe');
    },
  },
  {
    id: 'a-pdf-tanda', conjunto: 1, titulo: 'PDF de la solicitud reenviado y «cárgalo»: datos del PDF y el PDF de soporte',
    contactos: DIRECTORIO, viajes: [...VIAJES, VIAJE_LAURA_SA], viajesPermitidos: ['G1 26 7'], sinClienteNuevo: true, extraccion: true,
    pasos: [
      { adjunta: { archivo: 'solicitud', reenviado: true } },
      { escribe: 'cárgalo en el G1 26 7 de Laura' },
      { toca: 'Cargar', oEscribe: 'sí' },
    ],
    esperado: (p) => {
      const v = p.viajes.find((x) => x.id === 'v-ls')!;
      if (!de(p, 'carga').some((e) => e.codigo === 'G1 26 7')) return mal('no cargó en G1 26 7');
      if (v.datos.fecha_salida !== '2027-01-08') return mal(`fecha de salida «${String(v.datos.fecha_salida ?? '')}» (el PDF dice 2027-01-08)`);
      if (soportesDe(p, 'v-ls') !== 1) return mal('el PDF no quedó de soporte en el viaje');
      return ok('cargó lo del PDF y dejó el PDF de soporte');
    },
  },
  {
    id: 'a-foto-anotar', conjunto: 1, titulo: 'pantallazo propio con el código en el pie: anotar con lo leído y la foto de soporte',
    contactos: DIRECTORIO, viajes: [...VIAJES, VIAJE_LAURA_CTG], viajesPermitidos: ['G1 26 8'], sinClienteNuevo: true, extraccion: true,
    pasos: [
      { adjunta: { archivo: 'pantallazo', pie: 'esto me mandó Laura para el G1 26 8' } },
      { toca: 'Anotar', oEscribe: 'sí' },
    ],
    esperado: (p) => {
      const v = p.viajes.find((x) => x.id === 'v-lc')!;
      if (!de(p, 'carga').some((e) => e.codigo === 'G1 26 8')) return mal('no anotó en G1 26 8');
      if (v.datos.fecha_salida !== '2026-12-12') return mal(`fecha de salida «${String(v.datos.fecha_salida ?? '')}» (la foto dice 12 de diciembre de 2026)`);
      if (soportesDe(p, 'v-lc') !== 1) return mal('la foto no quedó de soporte en el viaje');
      return ok('anotó lo de la foto y dejó la foto de soporte');
    },
  },
  {
    id: 'a-choque', conjunto: 1, titulo: 'el comercial dice otra fecha que el PDF: no elige callado',
    contactos: DIRECTORIO, viajes: [...VIAJES, VIAJE_LAURA_SA], viajesPermitidos: ['G1 26 7'], sinClienteNuevo: true, extraccion: true,
    pasos: [
      { adjunta: { archivo: 'solicitud', reenviado: true } },
      { escribe: 'cárgalo en el G1 26 7, pero me dijo que salen el 10 de enero' },
      { toca: 'Cargar', oEscribe: 'sí' },
    ],
    esperado: (p, t) => {
      const v = p.viajes.find((x) => x.id === 'v-ls')!;
      const pregunto = t.some((x) => typeof x.propuesta?.datos?.duda === 'string') || t.some((x) => x.tipo === 'modelo' && !x.propuesta && /\?/.test(x.salida?.texto ?? ''));
      // El comercial manda en lo que pide cambiar: si quedó el 10, es su corrección. Si quedó el 8 sin preguntar, eligió el documento callado.
      if (v.datos.fecha_salida === '2027-01-08' && !pregunto) return mal('dejó la fecha del PDF sin decir que el comercial dijo otra');
      return ok(`fecha de salida «${String(v.datos.fecha_salida ?? 'por definir')}»${pregunto ? ', con la duda dicha' : ''}`);
    },
  },
  {
    id: 'a-factura', conjunto: 1, titulo: 'una factura de ferretería reenviada con la tanda: no se vuelve dato del viaje',
    contactos: DIRECTORIO, viajes: [...VIAJES, VIAJE_LAURA_SA], viajesPermitidos: ['G1 26 7'], sinClienteNuevo: true, extraccion: true,
    pasos: [
      { reenvia: 'Hola, somos 2 adultos para San Andrés del 3 al 7 de febrero' },
      { adjunta: { archivo: 'factura', reenviado: true } },
      { escribe: 'cárgalo en el G1 26 7' },
      { toca: 'Cargar', oEscribe: 'sí' },
    ],
    esperado: (p) => {
      const v = p.viajes.find((x) => x.id === 'v-ls')!;
      if (v.datos.presupuesto && v.datos.presupuesto !== 'sin_definir') return mal(`la factura se volvió presupuesto: ${String(v.datos.presupuesto)}`);
      if (/brocha|rodillo|pintura|ferreter/i.test(String(v.datos.requisitos_especiales ?? ''))) return mal('la factura quedó en los requisitos del viaje');
      if (v.datos.adultos !== 2) return mal(`adultos «${String(v.datos.adultos ?? '')}» (el mensaje dice 2)`);
      return ok('cargó lo del mensaje; la factura no se volvió dato del viaje');
    },
  },
];

export { preguntaQuienLleva };
/** Para los casos de los roles (`conjuntos-roles.ts`): el mismo directorio, viajes y equipo inventados. */
export { DIRECTORIO, VIAJES, viajeCon };
