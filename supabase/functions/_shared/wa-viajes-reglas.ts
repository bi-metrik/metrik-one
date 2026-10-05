// ============================================================
// Varios viajes en una entrega (modo `encabezado`) — las reglas, sin I/O
// ------------------------------------------------------------
// Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-01-varios-viajes-y-guardianes.md,
// parte 1, con la decisión de Mauricio del 2026-10-01 tras el QA de #971: MANDA EL ENCABEZADO.
//
// Tatiana atiende a varios clientes a la vez y reenvía lo de todos. Un reenvío de WhatsApp no
// dice de qué chat viene: la pista la da ella con un ENCABEZADO («Carolina», «T1 26 9», «nuevo
// Luisa») y el código asigna, sin modelo.
//
// Reglas que no se negocian:
//   1. Un encabezado se resuelve de forma DETERMINISTA contra los viajes abiertos: código exacto,
//      o un nombre/destino con un solo candidato. Con dos o ninguno se pregunta; nunca se elige.
//   2. Un encabezado resuelto fija el viaje de todo lo que sigue, hasta el siguiente encabezado, el
//      cierre o el vencimiento de la caja (`horas_caja_activa`).
//   3. Sin encabezados, la tanda entera es UN viaje y se pregunta «¿A qué viaje van?», como siempre.
//   4. Lo único que se infiere es marcar SOSPECHOSOS dentro de una caja; el comercial decide
//      «dejar» o «mover a…». Nada se carga hasta el «sí», y el «sí» no vale con algo por decidir.
//   5. Un mensaje que nombra a dos viajes no se carga entero en ninguno (F13): solo se descarta.
// ============================================================

import { calificarNombreNuevo, leerNuevo, leerViajeNuevo, nombreDeViaje, nombrePropio, normalizarNombre, normalizarTexto, restoTrasOtroCliente } from './wa-entendimiento-reglas.ts';
import {
  datoDeLaFicha, leerEleccionCliente, leerEsLaMisma, resolverConDirectorio, separarNombreYLlave, soloLlave, textoLlave, tieneLlave,
  TEXTO_PIDE_CLIENTE, viajesDeLaFicha,
} from './wa-cliente-reglas.ts';
import type { Directorio, FichaCliente, Llave, ResolucionCliente } from './wa-cliente-reglas.ts';
export { nombreDeViaje, nombrePropio } from './wa-entendimiento-reglas.ts';
import { codigoCompacto, interpretarRespuestaNegocio } from './wa-carga-reglas.ts';
import { esNotaDelComercial } from './wa-guardianes.ts';

/** Un viaje abierto de la línea, como lo ofrece la bandeja. */
export interface ViajeAbierto {
  id: string;
  codigo: string | null;
  cliente: string | null;
  destino: string | null;
  /**
   * El nombre del negocio, como lo recuerda el comercial («Europa 2 días», «ARMENIA 2N»). Sirve de
   * encabezado y es lo primero que se muestra (`nombreDeViaje`). Opcional: los planes guardados
   * antes del 2026-10-01 no lo traen.
   */
  nombre?: string | null;
}

/** Un mensaje de la entrega con su hora de llegada. `n` es su número (1, 2, 3…) en la entrega. */
export interface MensajeViaje {
  n: number;
  cuerpo: string;
  reenviado: boolean;
  tipo: string;
  /** ISO: cuándo lo mandó el comercial (`momentoDelMensaje`: la hora de Meta, o la de llegada). */
  en: string;
  /**
   * Lo que decidió el intérprete conversacional sobre este escrito (`wa_bandeja_mensajes.interpretacion`).
   * `armarSegmentos` la usa PRIMERO; ausente o nula, el mensaje se lee como siempre (por su texto).
   */
  interpretacion?: InterpretacionDelMensaje | null;
}

/** Lo que `armarSegmentos` lee de `wa_bandeja_mensajes.interpretacion` (lo escribe `wa-interprete.ts`). */
export interface InterpretacionDelMensaje {
  accion: string;
  viaje_id?: string | null;
  nuevo?: string | null;
  candidatos?: string[] | null;
  con_contenido?: boolean | null;
  /** La llave escrita en el mensaje, si el intérprete abrió un viaje nuevo con ella. */
  llave?: Llave | null;
}

// ── Encabezados ──────────────────────────────────────────────────────────────

export type ResolucionEncabezado =
  /** Coincidencia EXACTA (código, nombre o nombre + apellido): cambia la caja sola y se avisa con «📌». */
  | { tipo: 'viaje'; viaje: ViajeAbierto; por: 'codigo' | 'nombre' | 'negocio' }
  /**
   * Coincidencia APROXIMADA («Lusia», «Jorje»), solo el apellido («Gómez») o el destino («la de
   * punta cana»): no cambia la caja sola. El bot pregunta en el acto con la lista NUMERADA (aunque
   * haya un solo candidato), NUEVO y DESCARTAR, y lo que sigue queda sin asignar hasta que el
   * comercial elija (Trappvel, 2026-10-02: el «¿Cambias a…? sí/no» se fue; un «sí» a esa pregunta
   * metió en el viaje de otra clienta lo que era de un cliente nuevo).
   */
  | { tipo: 'aproximado'; viaje: ViajeAbierto; por: 'nombre' | 'apellido' | 'destino' | 'negocio' }
  /**
   * `cliente: null`: el bot pide el nombre. `en_duda`: lo que siguió a «nuevo» y no es un nombre (solo
   * números): no es el nombre, solo se cita al pedirlo (`calificarNombreNuevo`). `parecidos`: viajes
   * abiertos cuyo cliente comparte un nombre o un apellido con el propuesto (`viajesParecidos`); el acuse
   * y el resumen lo dicen. El cliente se crea solo con el «sí» al resumen.
   */
  | {
    tipo: 'nuevo'; cliente: string | null; en_duda?: string; parecidos?: ViajeAbierto[];
    /** La llave que vino con el nombre («nuevo Ana Gómez 300 555 1234») o sola («nuevo 3005551234»). */
    llave?: Llave | null;
    /**
     * Habla del cliente que ya está en la conversación («es para uno nuevo», «una cotización nueva sobre un
     * cliente antiguo»): `armarSegmentos` le pone el cliente de la caja anterior (diseño 2026-10-05, D1).
     */
    mismo?: boolean;
  }
  | { tipo: 'ambiguo'; candidatos: ViajeAbierto[] }
  | { tipo: 'codigo_desconocido'; codigo: string }
  /** Parece un encabezado (corto, escrito) pero no se resuelve: corta la caja (QA de #971 v3). */
  | { tipo: 'no_reconocido' };

/** Palabras de relleno de un encabezado: «la de punta cana», «cliente Carolina», «el viaje de Jorge». */
const RELLENO = new Set([
  'la', 'el', 'lo', 'los', 'las', 'de', 'del', 'para', 'a', 'al', 'y', 'con', 'cliente', 'clienta', 'viaje',
  'senora', 'senor', 'sra', 'sr', 'don', 'dona', 'familia', 'ahora', 'sigue', 'siguen', 'van', 'va', 'esto', 'estos', 'es',
]);
export const MAX_PALABRAS_ENCABEZADO = 5;

/**
 * Distancia de edición con transposición de dos letras vecinas como UN error (Damerau, variante
 * OSA): «Lusia» está a 1 de «Luisa», igual que «Carlina» de «Carolina» y «Jorje» de «Jorge».
 */
export function distancia(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Qué tan lejos está esta palabra del nombre: 0 igual, 1 un error de tipeo (palabras de 5+), Infinity si no. */
function distanciaAlNombre(w: string, nombre: string | null): number {
  let mejor = Infinity;
  for (const p of normalizarNombre(nombre).split(' ')) {
    if (p.length < 3) continue;
    if (p === w) return 0;
    if (p.length >= 5 && w.length >= 5 && distancia(p, w) <= 1) mejor = 1;
  }
  return mejor;
}

/**
 * La distancia de un escrito al cliente de un viaje: la peor de sus palabras (0 = todas están en
 * el nombre, 1 = alguna con un error de tipeo del MISMO nombre). Una palabra que no está en el nombre
 * ni a un error de tipeo deja al viaje fuera (Infinity): «Daniel Pérez» NO es candidato del viaje de
 * «Lina Pérez» ni siquiera aproximado, porque el mismo apellido es lo normal en Colombia (Trappvel,
 * 2026-10-02). Antes, «apellido exacto y otro nombre de pila» contaba como 2 y se preguntaba
 * «¿Cambias a…?» con un solo candidato.
 */
function distanciaAlCliente(resto: ReadonlyArray<string>, cliente: string | null): number {
  return Math.max(...resto.map(w => distanciaAlNombre(w, cliente)));
}

/** El nombre del negocio sin espacios ni signos: «ARMENIA 2N» y «Armenia 2 n» son el mismo. */
function nombreCompacto(t: string | null | undefined): string {
  return normalizarNombre(t).replace(/ /g, '');
}

/** ¿Esta palabra es una palabra del nombre? Igual, o con un error de tipeo si es larga («Carlina»). */
function palabraDelNombre(w: string, nombre: string | null): boolean {
  return distanciaAlNombre(w, nombre) <= 1;
}

function palabrasDe(t: string | null): string[] {
  return normalizarNombre(t).split(' ').filter(Boolean);
}

function esCodigo(compacto: string): boolean {
  return /^[A-Z]{1,3}\d{3,}$/.test(compacto) && compacto.length <= 12;
}

/**
 * Palabras que un comercial escribe todo el día y que NUNCA son un encabezado, aunque un cliente
 * se apellide así («Bueno», «Claro», «Vale», «Mañana») o se parezca («gracias» y Gracia, «mira» y
 * Lina, «otro» y Otero). Un escrito hecho SOLO de estas palabras (y relleno) no resuelve, no
 * pregunta y no corta la caja. Para nombrar a un cliente así basta su código o nombre + apellido
 * (QA de #971 v5: con 80 apellidos comunes, 7 escritos cortos movían la caja).
 */
export const PALABRAS_COMUNES: ReadonlySet<string> = new Set([
  // acuses y cortesías
  'gracias', 'mil', 'muchas', 'muchisimas', 'ok', 'okey', 'okay', 'oki', 'listo', 'lista', 'listos', 'ya', 'si', 'sii', 'no',
  'dale', 'claro', 'perfecto', 'perfecta', 'bueno', 'buena', 'buenas', 'buenos', 'buen', 'vale', 'genial', 'super', 'excelente',
  'una', 'gusto', 'orden', 'hola', 'holi', 'chao', 'chau', 'adios', 'saludos', 'bendiciones', 'dia', 'dias', 'tardes', 'noches', 'noche',
  'tarde', 'mano', 'hermano', 'amiga', 'amigo', 'jefe', 'jefa', 'mija', 'mijo', 'porfa', 'favor', 'please', 'pls', 'jaja', 'jajaja',
  'entendido', 'entendida', 'anotado', 'anotada', 'recibido', 'recibida', 'enviado', 'enviada', 'confirmado', 'confirmada', 'confirmo',
  'cotizado', 'cotizada', 'pagado', 'pagada', 'reservado', 'reservada', 'hecho', 'hecha', 'correcto', 'correcta', 'exacto', 'exacta',
  'cierto', 'vamos', 'listico', 'ojo', 'mira', 'mire', 'oye', 'oiga', 'pilas', 'urgente', 'importante', 'nota', 'pendiente', 'pendientes',
  // tiempo y orden
  'espera', 'espere', 'esperame', 'momento', 'momentico', 'un', 'ahorita', 'ahora', 'casi', 'luego', 'despues', 'antes', 'manana',
  'hoy', 'ayer', 'pronto', 'tambien', 'igual', 'mismo', 'misma', 'este', 'esta', 'ese', 'esa', 'eso', 'otro', 'otra', 'otros', 'otras',
  'mas', 'menos', 'falta', 'faltan', 'todo', 'todos', 'nada', 'aqui', 'aca', 'alla', 'sigo', 'seguimos', 'continuo', 'continua', 'fin',
  'cliente', 'clientes', 'mensaje', 'mensajes', 'audio', 'audios', 'foto', 'fotos', 'cotizacion', 'reserva', 'pago',
  // registro coloquial (QA de #971 v6)
  'chevere', 'bacano', 'bacana', 'sale', 'revisa', 'revisar', 'revisalo', 'revisala', 'adelante', 'quedo', 'quedamos', 'okis', 'oka', 'okk',
  'pues', 'bien', 'mal', 'hagale', 'hagamosle', 'dele', 'melo', 'listico', 'parce', 'parcero', 'sumerce', 'vea', 'venga', 'epa', 'uy', 'uff',
  'ufff', 'ah', 'eh', 'aja', 'mmm', 'mm', 'jum', 'jejeje', 'jajajaja', 'buenisimo', 'buenisima', 'super', 'muy', 'todo', 'nada', 'nadita',
  'pena', 'disculpa', 'disculpe', 'perdon', 'tranqui', 'tranquila', 'tranquilo', 'cuento', 'cuenta', 'mandame', 'mando', 'envio', 'esperame',
  'segundo', 'minuto', 'minutico', 'dame', 'camino', 'siguiente', 'seguimos', 'continuo', 'ahi', 'tal', 'cual', 'eso', 'asi', 'que', 'pa',
  'confirmadisimo', 'listos', 'rapido', 'rapidito', 'toca', 'regalame', 'colaborame', 'porfis', 'entonces', 'verdad', 'obvio', 'claro',
]);


/**
 * ¿Esta palabra nombra a alguien del equipo? Una palabra de su nombre completo, o un apodo que es el
 * comienzo (3 letras o más) de su primer nombre: «Tati» de Tatiana, «Mau» de Mauricio (QA de #971 v6).
 */
function palabraDelEquipo(w: string, equipo: ReadonlyArray<string>): boolean {
  return equipo.some(n => {
    const del = palabrasDe(n);
    return del.includes(w) || (w.length >= 3 && !!del[0] && del[0].startsWith(w));
  });
}

/** ¿Es el primer nombre completo de alguien del equipo («tatiana» de Tatiana Quiroga)? */
function primerNombreDelEquipo(w: string, equipo: ReadonlyArray<string>): boolean {
  return equipo.some(n => palabrasDe(n)[0] === w);
}

/**
 * ¿Es un acuse o una risa, sin nada de una solicitud? «ok gracias», «jajaja», «😂😂», un sticker. Con
 * la bandeja encendida todo lo escrito entra a la bandeja: una tanda hecha SOLO de esto no se le
 * pregunta al comercial («¿A qué viaje van?» por un «ok gracias» sería ruido del bot).
 */
export function esRuidoEscrito(cuerpo: string | null | undefined): boolean {
  return esRisa(cuerpo) || palabrasDe(String(cuerpo ?? '')).every(w => PALABRAS_COMUNES.has(w) || /^(ja|je|ji|ha)+j?$/.test(w));
}

/**
 * ¿Es un mensaje que no va al resumen? Una risa o emojis, o un acuse ESCRITO por el comercial («si»,
 * «no», «ok gracias»). Un reenvío nunca: lo que dijo el cliente se muestra aunque sea «ok».
 */
export function esRuidoDelComercial(m: Pick<MensajeViaje, 'cuerpo' | 'reenviado' | 'tipo'>): boolean {
  if (esRisa(m.cuerpo)) return true;
  if (m.reenviado || m.tipo !== 'text' || !String(m.cuerpo ?? '').trim()) return false;
  return esSiNoCorto(m.cuerpo) || palabrasDe(m.cuerpo).every(w => ACUSES_ESCRITOS.has(w) || /^(ja|je|ji|ha)+j?$/.test(w));
}

/** Acuses y cortesías que el comercial escribe sin decir nada de la solicitud. */
const ACUSES_ESCRITOS: ReadonlySet<string> = new Set([
  'ok', 'okey', 'okay', 'oki', 'okis', 'listo', 'dale', 'si', 'sii', 'no', 'gracias', 'mil', 'muchas', 'perfecto', 'perfecta', 'bueno',
  'vale', 'genial', 'super', 'chevere', 'entendido', 'anotado', 'recibido', 'claro', 'buenisimo',
]);

/** ¿Es solo una risa o solo emojis? «jajaja», «Jejeje», «😂😂». Un «ok» o un «sí» no: pueden ser respuesta. */
export function esRisa(cuerpo: string | null | undefined): boolean {
  return String(cuerpo ?? '').trim() !== '' && palabrasDe(String(cuerpo)).every(w => /^(ja|je|ji|ha)+j?$/.test(w));
}

/** ¿Todo el escrito es de palabras comunes y nombres del equipo? «gracias Tati», «súper bien». No es encabezado. */
function sinEfecto(palabras: ReadonlyArray<string>, equipo: ReadonlyArray<string>): boolean {
  return palabras.length > 0 && palabras.every(w => PALABRAS_COMUNES.has(w) || palabraDelEquipo(w, equipo));
}

/** Las palabras del nombre sin el relleno; la primera es el nombre de pila. */
function palabrasDelCliente(v: ViajeAbierto): string[] {
  return palabrasDe(v.cliente).filter(w => !RELLENO.has(w) && w.length >= 2);
}

/**
 * ¿Este escrito del comercial es un encabezado? Solo si es corto (hasta cinco palabras) y TODO lo
 * que dice se explica como una referencia a un viaje: «Carolina», «T1 26 9», «nuevo Luisa San
 * Andrés», «la de punta cana». «Carolina quiere 5 estrellas» no lo es (es contenido). `null` = no es
 * encabezado.
 *
 * Solo una coincidencia EXACTA cambia la caja en silencio (`viaje`): el código, o el nombre de
 * pila con o sin apellidos, con un solo candidato. Lo demás que apunta a un único viaje es
 * `aproximado` y se pregunta: un error de tipeo («Lusia»), solo el apellido («Gómez») o el destino.
 * Los nombres del equipo y las palabras comunes nunca son encabezado (QA de #971 v5).
 *
 * @param equipo nombres de quienes escriben al bot en el workspace (staff y colaboradores).
 */
export function resolverEncabezado(
  texto: string, viajes: ReadonlyArray<ViajeAbierto>, equipo: ReadonlyArray<string> = [],
): ResolucionEncabezado | null {
  const bruto = String(texto ?? '').trim();
  // Una pregunta («Luisa?») no es un encabezado: va al bot (regla 4b de `decidirRuta`).
  if (/[?¿]/.test(bruto)) return null;
  const palabras = normalizarTexto(bruto).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return null;

  // «Nuevo» en cualquier forma: «nuevo X», «cliente nuevo X», «nueva clienta X», «es nuevo X». Sin
  // nombre, o «otro cliente» a secas: el bot pide el nombre (`TEXTO_PIDE_NOMBRE_NUEVO`). Con la regla del
  // nombre (`calificarNombreNuevo`): solo números no es un nombre y el bot lo pide; un texto más largo
  // que el tope no es encabezado. Lo demás es el nombre PROPUESTO: abre su caja, y el cliente se crea
  // solo con el «sí» al resumen, que lo muestra tal cual («Cliente nuevo: X»).
  // «Nuevo» quiere decir VIAJE nuevo (2026-10-05): el cliente lo resuelve el código buscándolo
  // (`wa-cliente-reglas.ts`). La llave que venga con el nombre se separa; un número solo es una llave, no un nombre.
  if (leerViajeNuevo(bruto) === null) return null;
  const nuevo = leerNuevo(bruto);
  if (nuevo) {
    const c = calificarNombreNuevo(nuevo.cliente);
    if (c === 'largo') return null;
    const { nombre, llave } = separarNombreYLlave(nuevo.cliente);
    const conLlave = llave ? { llave } : {};
    const mismo = nuevo.mismo ? { mismo: true } : {};
    if (c === 'duda') return llave ? { tipo: 'nuevo', cliente: null, ...conLlave, ...mismo } : { tipo: 'nuevo', cliente: null, en_duda: nuevo.cliente ?? '', ...mismo };
    return { ...conParecidos(nombre || null, viajes), ...conLlave, ...mismo } as ResolucionEncabezado;
  }
  if (palabras.length > MAX_PALABRAS_ENCABEZADO) return null;
  // «otro cliente Lina Pérez»: lo que sigue es el encabezado. Si no nombra un viaje abierto y es un
  // nombre, es un cliente nuevo; si no, se pide el nombre (nunca queda en la caja anterior).
  const trasOtro = restoTrasOtroCliente(bruto);
  if (trasOtro) {
    const r = resolverEncabezado(trasOtro, viajes, equipo);
    if (r && r.tipo !== 'no_reconocido') return r;
    return conParecidos(esNombreNuevo(trasOtro, equipo), viajes);
  }

  const compacto = codigoCompacto(bruto);
  if (esCodigo(compacto)) {
    const v = viajes.find(x => codigoCompacto(x.codigo) === compacto);
    return v ? { tipo: 'viaje', viaje: v, por: 'codigo' } : { tipo: 'codigo_desconocido', codigo: compacto };
  }

  const resto = palabrasDe(bruto).filter(w => !RELLENO.has(w));
  if (resto.length === 0 || resto.every(w => PALABRAS_COMUNES.has(w))) return null;
  // El primer nombre COMPLETO de alguien del equipo («Tatiana») es una firma: nunca es encabezado.
  if (resto.every(w => PALABRAS_COMUNES.has(w) || primerNombreDelEquipo(w, equipo))) return null;

  // Exacta: cada palabra está tal cual en el nombre, y una de ellas es el nombre de pila. Gana sobre
  // un apodo del equipo: con una Mariana en el equipo, «María» sigue nombrando a la clienta María
  // (QA de #971 v6, ajuste del coordinador).
  const porCliente = viajes.filter(v => {
    const del = palabrasDelCliente(v);
    return del.length > 0 && resto.includes(del[0]) && resto.every(w => del.includes(w));
  });
  // El NOMBRE del negocio, tal cual (sin tildes, mayúsculas ni espacios): «Europa 2 días», «ARMENIA
  // 2N». Es como los comerciales recuerdan un viaje (prueba en vivo del 2026-10-01, parte B). Un
  // nombre repetido no elige: pregunta cuál, con cliente y código.
  const h = nombreCompacto(bruto);
  const porNegocio = viajes.filter(v => !!v.nombre && nombreCompacto(v.nombre) === h);
  const exactos = [...new Map([...porNegocio, ...porCliente].map(v => [v.id, v])).values()];
  if (exactos.length === 1) return { tipo: 'viaje', viaje: exactos[0], por: porNegocio.length === 1 ? 'negocio' : 'nombre' };
  if (exactos.length > 1) return { tipo: 'ambiguo', candidatos: exactos };
  // Sin un cliente exacto, el resto del nombre del equipo y sus apodos («Tati», «Mau») no son encabezado.
  if (sinEfecto(resto, equipo)) return null;

  // Aproximada: los candidatos a la MENOR distancia (0 = solo apellidos; 1 = un error de tipeo;
  // 2 = el apellido exacto y otro nombre de pila).
  const distancias = viajes.map(v => ({ v, d: distanciaAlCliente(resto, v.cliente) }));
  const minima = Math.min(...distancias.map(x => x.d));
  const porNombre = Number.isFinite(minima) ? distancias.filter(x => x.d === minima).map(x => x.v) : [];
  const porDestino = viajes.filter(v => {
    const d = palabrasDe(v.destino);
    return d.length > 0 && resto.length === d.length && d.every(w => resto.includes(w));
  });
  // El nombre del negocio con un error de tipeo o dos («Europa 2 dia»): solo nombres largos.
  const porNegocioCerca = h.length >= 8 && /[a-z]{4}/.test(h)
    ? viajes.filter(v => !!v.nombre && distancia(nombreCompacto(v.nombre), h) <= 2)
    : [];
  const candidatos = [...new Map([...porNombre, ...porDestino, ...porNegocioCerca].map(v => [v.id, v])).values()];
  if (candidatos.length === 1) {
    // `apellido`: todas sus palabras están en el nombre, pero no el nombre de pila («Gómez»).
    const por = porNombre.length === 1 ? (minima === 1 ? 'nombre' : 'apellido') : porDestino.length === 1 ? 'destino' : 'negocio';
    return { tipo: 'aproximado', viaje: candidatos[0], por };
  }
  if (candidatos.length > 1) return { tipo: 'ambiguo', candidatos };
  return null;
}

/** Los viajes por los que pregunta un encabezado que no es exacto (uno o varios). Vacío si no pregunta. */
export function candidatosDelEncabezado(r: ResolucionEncabezado | null | undefined): ViajeAbierto[] {
  if (r?.tipo === 'aproximado') return [r.viaje];
  if (r?.tipo === 'ambiguo') return [...r.candidatos];
  return [];
}

/**
 * Lo que el bot responde EN EL ACTO a un encabezado del comercial (QA de #971 v5). `null`: nada.
 * Exacto → «📌». Aproximado o ambiguo → la pregunta NUMERADA, con NUEVO y DESCARTAR, aunque haya un
 * solo candidato (Trappvel, 2026-10-02: nunca «¿Cambias a…? sí/no»).
 */
export function respuestaAlEncabezado(r: ResolucionEncabezado | null, texto = ''): string | null {
  if (r?.tipo === 'viaje') return `📌 ${lineaCaja(r.viaje)}`;
  if (r?.tipo === 'nuevo') return r.cliente ? textoAcuseNuevo(r.cliente, r.parecidos ?? []) : r.en_duda ? textoPideNombreEnDuda(r.en_duda) : TEXTO_PIDE_NOMBRE_NUEVO;
  const candidatos = candidatosDelEncabezado(r);
  return candidatos.length > 0 ? textoPreguntaEncabezado(texto, candidatos) : null;
}

/**
 * «¿De qué viaje es «Pérez»?» con la lista numerada, NUEVO y DESCARTAR. La respuesta es el número
 * (o el código, que es otro encabezado), «NUEVO nombre» o DESCARTAR.
 */
export function textoPreguntaEncabezado(texto: string, candidatos: ReadonlyArray<ViajeAbierto>): string {
  // Todos del mismo cliente («Mauricio Moreno» con 5 viajes abiertos, D1): la pregunta es si va en uno de esos o
  // es un viaje nuevo. La lista numerada solo con 4 o más, y acepta también el nombre del viaje.
  const mismo = unSoloCliente(candidatos);
  if (mismo) {
    const nombre = nombrePropio(mismo);
    const viaje = (v: ViajeAbierto) => nombreDeViaje({ nombre: v.nombre, codigo: v.codigo }) || nombreDeViaje(v);
    return candidatos.length >= 4
      ? [`${nombre} tiene ${candidatos.length} viajes abiertos. ¿Va en uno de esos o es un viaje nuevo?`,
        ...candidatos.map((v, i) => `${i + 1}. ${viaje(v)}`)].join('\n')
      : `${nombre} tiene ${candidatos.length} viajes abiertos: ${enumerar(candidatos.map(viaje))}. ¿Va en uno de esos o es un viaje nuevo?`;
  }
  return [
    `¿De qué viaje es «${String(texto).trim()}»? Hasta que me digas, no asigno lo que sigue.`,
    ...candidatos.map((v, i) => `${i + 1}. ${lineaCaja(v)}`),
    'Responde el número; si es un viaje nuevo, «nuevo» y el nombre del cliente; o «descartar».',
  ].join('\n');
}

/** La misma pregunta en una línea, para volver a mostrarla cuando llega contenido antes de la respuesta. */
export function textoPreguntaEncabezadoCorta(texto: string, candidatos: ReadonlyArray<ViajeAbierto>): string {
  return `Antes: ¿de qué viaje es «${String(texto).trim()}»? ${candidatos.map((v, i) => `${i + 1}. ${lineaCaja(v)}`).join(' · ')}. Lo que mandes queda sin asignar hasta que me digas.`;
}

/** La elección de la lista del encabezado: «2», «2.», «el 2», «la 2». `null` si no es un número. */
export function leerEleccion(texto: string): number | null {
  const m = /^(?:el|la|opcion|numero)?\s*(\d{1,2})\s*[.)]?$/.exec(normalizarTexto(String(texto ?? '')).replace(/[!¡]+$/g, '').trim());
  return m ? Number(m[1]) : null;
}

const ORDINALES: Readonly<Record<string, number>> = {
  primero: 1, primera: 1, primer: 1, segundo: 2, segunda: 2, tercero: 3, tercera: 3, tercer: 3, cuarto: 4, cuarta: 4, quinto: 5, quinta: 5,
};
const CARDINALES: Readonly<Record<string, number>> = { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };

/**
 * La opción de una lista numerada, escrita como número u ordinal: lo de `leerEleccion` («2», «el 2», «opción
 * 2») y además «el segundo», «la primera», «2do», «opción dos», «el viaje 3», «la segunda opción». `null` si
 * no es eso. Un número en palabras necesita el artículo o «opción» («la dos»; «dos» solo, no). Lo usa la
 * confirmación de cliente nuevo, en el código de hoy y en el atajo del intérprete por igual (quinto control
 * de Vera, 2026-10-04): un número u ordinal nunca es un nombre.
 */
export function leerOpcionEscrita(texto: string): number | null {
  const k = leerEleccion(texto);
  if (k !== null) return k;
  const t = normalizarNombre(texto).replace(/^(?:(?:es|era|seria|va|van)\s+)?(?:(?:para|pa|en|a)\s+)?/, '');
  const m = /^(?:(el|la|lo|al|del)\s+)?(?:(opcion|numero|viaje)\s+)?([a-z0-9]+)(?:\s+(?:opcion|viaje))?$/.exec(t);
  if (!m) return null;
  const [, art, sust, w] = m;
  const conPrefijo = !!(art || sust);
  if (/^\d{1,2}$/.test(w)) return conPrefijo ? Number(w) : null;
  const ord = /^(\d)(?:o|a|ro|ra|do|da|er|ero|era|to|ta)$/.exec(w);
  if (ord) return Number(ord[1]);
  if (ORDINALES[w]) return ORDINALES[w];
  if (CARDINALES[w] && conPrefijo) return CARDINALES[w];
  return null;
}

/** «Europa 2 días · Carolina Ruiz (T1 26 11)»: como se nombra una caja al comercial (`nombreDeViaje`). */
export function lineaCaja(v: ViajeAbierto): string {
  return nombreDeViaje(v);
}

/** Lo que el bot pide en el acto tras un «nuevo» sin nombre o un «otro cliente» (como N9). */
/**
 * Lo que el bot pide en el acto tras «nuevo viaje» sin cliente o un «otro cliente» (D1, 2026-10-05): ya no
 * «¿cómo se llama el cliente nuevo?», que daba por hecho que el cliente era nuevo.
 */
export const TEXTO_PIDE_NOMBRE_NUEVO = TEXTO_PIDE_CLIENTE;

/** Tras «nuevo» con algo que no es un nombre ni una llave («nuevo 123»): el bot pregunta de quién es. */
export function textoPideNombreEnDuda(propuesto: string): string {
  return `¿Para qué cliente es el viaje nuevo? «${String(propuesto).trim().slice(0, 40)}» no es un nombre ni un celular.`;
}

// ── Cliente nuevo: nada se crea sin un «sí» ─────────────────────────────────
//
// Decisión de Mauricio (2026-10-03, tercer control sellado de Vera): el código no adivina si lo que sigue
// a «nuevo» es un nombre. Ningún cliente se crea sin un «sí» explícito del comercial a un texto que
// muestra el nombre tal cual se va a crear:
//   · con encabezados, el resumen del reparto («Cliente nuevo: X — 2 mensajes … ¿Así? Responde SÍ»);
//   · sin ellos, una pregunta aparte tras «¿A qué viaje van?» (`textoConfirmarNuevo`).
// Si el nombre se parece al cliente de un viaje abierto, la confirmación lo dice (`viajesParecidos`).

/** Lo más que se nombra de viajes parecidos en una confirmación. */
const MAX_PARECIDOS = 3;

/**
 * Los viajes abiertos cuyo cliente comparte con el nombre propuesto su nombre de pila, otro de sus
 * nombres o un apellido. Así también cae «tiíta Ana María» (un diminutivo de parentesco y parte del
 * nombre de Ana María Gómez). No decide nada: solo hace que la confirmación diga «Ya hay un viaje de …».
 *
 * El error de tipeo (una letra, en palabras de cinco o más) solo cuenta entre APELLIDOS: entre nombres
 * de pila es otra persona casi siempre (Mario/María, Daniel/Daniela, Diana/Dayana), y con esa regla el
 * aviso salía en el 37 % de los nombres comunes (cuarto control de Vera, 2026-10-03). Un nombre de pila
 * es la primera palabra; con cuatro palabras o más, las dos primeras («Ana María Gómez Ruiz»).
 */
export function viajesParecidos(nombre: string | null | undefined, viajes: ReadonlyArray<ViajeAbierto>): ViajeAbierto[] {
  const propias = conPila(palabrasDe(nombre ?? '').filter(w => w.length >= 3 && !NO_IDENTIFICAN.has(w)));
  if (propias.length === 0) return [];
  return viajes.filter(v => conPila(palabrasDe(v.cliente).filter(w => w.length >= 3 && !NO_IDENTIFICAN.has(w)))
    .some(c => propias.some(w => w.w === c.w || (!w.pila && !c.pila && w.w.length >= 5 && c.w.length >= 5 && distancia(w.w, c.w) <= 1))));
}

/** Cada palabra de un nombre, marcada si es nombre de pila (la primera; las dos primeras con cuatro o más). */
function conPila(ws: ReadonlyArray<string>): Array<{ w: string; pila: boolean }> {
  const n = ws.length >= 4 ? 2 : 1;
  return ws.map((w, i) => ({ w, pila: i < n }));
}

/** `{ tipo: 'nuevo' }` con sus parecidos (solo si los hay). */
function conParecidos(cliente: string | null, viajes: ReadonlyArray<ViajeAbierto>): ResolucionEncabezado {
  const parecidos = cliente ? viajesParecidos(cliente, viajes) : [];
  return parecidos.length > 0 ? { tipo: 'nuevo', cliente, parecidos } : { tipo: 'nuevo', cliente };
}

/** «Ana María Gómez (T1 26 4)»: el cliente y el código de un viaje. */
function clienteYCodigo(v: ViajeAbierto): string {
  return nombreDeViaje({ cliente: v.cliente, codigo: v.codigo });
}

/** «A», «A y B», «A, B y C» (o con «o»: las alternativas). */
function enumerar(xs: ReadonlyArray<string>, y = 'y'): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} ${y} ${xs[xs.length - 1]}`;
}

/** Cómo se elige un viaje parecido: su número en la lista que ya vio el comercial, o su código. */
function referenciaDe(v: ViajeAbierto, numero: number | null): string {
  return numero !== null ? String(numero) : (v.codigo?.trim() || nombrePropio(v.cliente) || 'su código');
}

/**
 * El acuse en el acto de un «nuevo X» (encabezado, nombre tras «¿Cómo se llama?» o el intérprete): la
 * caja se abre con ese nombre, pero el cliente se crea solo con el «sí» al resumen. Si el nombre se
 * parece al cliente de un viaje abierto, lo dice y cómo pasarse a ese viaje.
 */
export function textoAcuseNuevo(nombre: string, parecidos: ReadonlyArray<ViajeAbierto> = [], conContenido = false): string {
  // Sin el directorio a la vista (el bot lo consulta al responder: `wa-cliente.ts`), el acuse no dice si ya es cliente.
  return [`Va como viaje nuevo de ${String(nombre).trim()}${conContenido ? '; ya anoté lo que dijiste' : ''}. Antes del resumen reviso si ya es cliente.`,
    ...lineasDeParecidos(parecidos)].join('\n');
}

/**
 * «Ya hay un viaje de Lina Pérez (L1 26 1): si es para ese, escribe L1 26 1.»: los viajes abiertos cuyo cliente se
 * parece al nombre del viaje nuevo, para que el comercial vea si quería uno de esos (cuarto control de Vera).
 */
export function lineasDeParecidos(parecidos: ReadonlyArray<ViajeAbierto>): string[] {
  const ps = parecidos.slice(0, MAX_PARECIDOS);
  if (ps.length === 1) return [`Ya hay un viaje de ${clienteYCodigo(ps[0])}: si es para ese, escribe ${referenciaDe(ps[0], null)}.`];
  if (ps.length > 1) return [`Ya hay viajes de ${enumerar(ps.map(clienteYCodigo))}: si es para uno de esos, escribe su código.`];
  return [];
}

/**
 * La confirmación aparte, donde no hay resumen (la respuesta a «¿A qué viaje van?»):
 * «¿Creo el cliente nuevo «X»? Responde SÍ, o escribe el nombre correcto, o el número del viaje». Con
 * viajes parecidos: «Ya hay un viaje de <cliente> (<código>). ¿Es para ese (responde N) o es un cliente
 * nuevo (responde SÍ)?». `numero`: la posición del viaje en la lista que ya vio el comercial (si está);
 * sin ella, el código. `conLista`: el comercial tiene a la vista la lista numerada.
 */
export function textoConfirmarNuevo(p: {
  nombre: string;
  parecidos?: ReadonlyArray<{ viaje: ViajeAbierto; numero: number | null }>;
  conLista: boolean;
  aviso?: string | null;
  /** Lo que dijo el directorio de ese nombre (diseño 2026-10-05): si ya es cliente, o qué falta para crearlo. */
  cliente?: string | null;
}): string {
  const nombre = String(p.nombre).trim().slice(0, 60);
  const ps = (p.parecidos ?? []).slice(0, MAX_PARECIDOS);
  const l: string[] = p.aviso ? [p.aviso] : [];
  if (p.cliente) {
    // Con el directorio, la pregunta es por el VIAJE nuevo y el cliente se muestra como es. Si el nombre se parece
    // al cliente de un viaje abierto, se dice cómo ir a ese viaje.
    l.push(`¿Va como viaje nuevo de ${nombre}? ${p.cliente}`);
    if (ps.length === 1) l.push(`Ya hay un viaje de ${clienteYCodigo(ps[0].viaje)}: si es para ese, responde ${referenciaDe(ps[0].viaje, ps[0].numero)}.`);
    else if (ps.length > 1) l.push(`Ya hay viajes de ${enumerar(ps.map(x => clienteYCodigo(x.viaje)))}: si es para uno de esos, responde ${enumerar(ps.map(x => referenciaDe(x.viaje, x.numero)), 'o')}.`);
    l.push(`Responde sí, o el ${p.conLista ? 'número' : 'código'} del viaje si es uno que ya existe. No he creado ni cargado nada.`);
    return l.join('\n');
  }
  if (ps.length === 0) {
    l.push(`¿Creo el cliente nuevo «${nombre}»? Responde «sí», el nombre correcto, o el ${p.conLista ? 'número' : 'código'} del viaje.`);
  } else {
    l.push(`¿Creo el cliente nuevo «${nombre}»?`);
    l.push(ps.length === 1
      ? `Ya hay un viaje de ${clienteYCodigo(ps[0].viaje)}: si es para ese, responde ${referenciaDe(ps[0].viaje, ps[0].numero)}; si es un cliente nuevo, «sí»; o escríbeme el nombre correcto.`
      : `Ya hay viajes de ${enumerar(ps.map(x => clienteYCodigo(x.viaje)))}: si es para uno de esos, responde ${enumerar(ps.map(x => referenciaDe(x.viaje, x.numero)), 'o')}; si es un cliente nuevo, «sí»; o escríbeme el nombre correcto.`);
  }
  l.push('No he creado ni cargado nada.');
  return l.join('\n');
}

export type RespuestaConfirmarNuevo =
  | { tipo: 'si' }
  /** Lo que escribió en vez del «sí»: el nombre correcto. Reemplaza al propuesto y se vuelve a confirmar. */
  | { tipo: 'nombre'; nombre: string }
  /** El número de la lista o el código de un viaje: cancela el nuevo. */
  | { tipo: 'existente'; negocio_id: string }
  | { tipo: 'codigo'; codigo: string }
  | { tipo: 'descartar' }
  | { tipo: 'no_entendida' };

/**
 * La respuesta a «¿Creo el cliente nuevo «X»?». Solo un «sí» sin peros (o NUEVO / «créalo») crea; un
 * número de la lista o un código cancela el nuevo; un nombre (con o sin NUEVO delante) reemplaza al
 * propuesto y vuelve a preguntar. El nombre exacto de un cliente con viaje abierto NO elige su viaje: es
 * otro nombre propuesto, y la confirmación siguiente dice «Ya hay un viaje de …».
 */
/**
 * Una opción de la lista que vio el comercial en la confirmación. Con el cliente y el destino (los trae
 * `negocio_opciones`), una frase que señala el viaje («el de Cartagena», «ese mismo») se puede resolver.
 */
export interface OpcionConfirmarNuevo {
  id: string;
  codigo: string | null;
  cliente?: string | null;
  destino?: string | null;
  nombre?: string | null;
}

export function interpretarConfirmacionNuevo(
  texto: string, opciones: ReadonlyArray<OpcionConfirmarNuevo>, propuesto?: string | null,
  /**
   * Los viajes abiertos, en el orden en que los leyó la confirmación (`viajesAbiertosDeLaBandeja`): con ellos,
   * una frase que señala un viaje resuelve también contra los que nombró el aviso «Ya hay un viaje de …» y no
   * están en la lista (sexto control de Vera, 2026-10-04). Sin ellos, solo contra la lista.
   */
  viajes: ReadonlyArray<ViajeAbierto> = [],
): RespuestaConfirmarNuevo {
  const r = leerConfirmacionNuevo(texto, opciones, propuesto ?? null, viajes);
  // Repetir el mismo nombre que muestra la pregunta («¿Creo el cliente nuevo «Laura Prueba»?» → «Laura
  // Prueba», o «NUEVO Laura Prueba») es un «sí» a ese texto (cuarto control de Vera, 2026-10-03). Se decide
  // sobre el texto COMPLETO, y un texto con una negación nunca llega aquí como nombre (quinto control).
  if (r.tipo === 'nombre' && propuesto && normalizarNombre(r.nombre) === normalizarNombre(propuesto)) return { tipo: 'si' };
  return r;
}

/** Una negación en cualquier parte: con ella, la respuesta nunca es un «sí» ni un nombre (quinto control de Vera). */
const NIEGA_EN_CONFIRMACION = /\b(?:no|nop|nope|nel|negativo|ni|tampoco|nunca|jamas)\b/;
/**
 * Los verbos de alta que cuentan como «sí» en una respuesta completa: «crear» (quinto control) y, desde el sexto,
 * «registrar», «abrir», «ingresar», «agregar», «montar», «dar de alta» (que llega aquí como «crea»), «proceder»
 * y «hacerlo». Formas cerradas: el imperativo, el infinitivo y con el pronombre pegado.
 */
const VERBOS_CREAR: ReadonlySet<string> = new Set([
  'crea', 'crealo', 'creala', 'crear', 'crearlo', 'crearla', 'creelo', 'creela', 'creemoslo', 'creemosla', 'cree', 'creale', 'creele',
  ...formasDeAlta('registr'), ...formasDeAlta('ingres'), ...formasDeAlta('agreg'), ...formasDeAlta('mont'),
  'abre', 'abrelo', 'abrela', 'abrele', 'abra', 'abralo', 'abrala', 'abrale', 'abrir', 'abrirlo', 'abrirla', 'abrirle', 'abramoslo', 'abramosla',
  'procede', 'proceda', 'procedamos', 'proceder', 'hazlo', 'hagalo', 'hagamoslo', 'hacerlo',
]);
/** «registra», «regístralo», «registre», «regístrelo», «registrar», «registrarlo», «registrémoslo»… de un verbo en -ar. */
function formasDeAlta(raiz: string): string[] {
  const agregue = raiz.endsWith('g') ? `${raiz}u` : raiz;
  return [`${raiz}a`, `${raiz}alo`, `${raiz}ala`, `${raiz}ale`, `${raiz}ar`, `${raiz}arlo`, `${raiz}arla`, `${raiz}arle`,
    `${agregue}e`, `${agregue}elo`, `${agregue}ela`, `${agregue}ele`, `${agregue}emoslo`, `${agregue}emosla`];
}
/**
 * Lo que puede acompañar al «sí» o al verbo sin cambiar la respuesta. Nada más: un texto con otra palabra no es
 * este «sí». «viaje», «negocio» y «ficha» solo con un verbo de alta al lado («sí, ábrele el viaje»).
 */
const ACOMPANA_CREAR: ReadonlySet<string> = new Set(['el', 'la', 'lo', 'a', 'al', 'cliente', 'clienta', 'nuevo', 'nueva', 'por', 'favor', 'porfa',
  'porfis', 'plis', 'please', 'gracias', 'mil', 'ya', 'asi', 'de', 'una', 'entonces', 'pues', 'senor', 'senora', 'tal', 'cual', 'y', 'que', 'me', 'nos', 'usted']);
const OBJETO_DEL_ALTA: ReadonlySet<string> = new Set(['viaje', 'negocio', 'ficha', 'contacto']);
/**
 * El «sí» firme de la confirmación, además del de `esSi`: «adelante», «hágale», «procede» dicen lo mismo que «dale»
 * (sexto control). Un «ok», un «listo» o un «perfecto» solos siguen sin bastar (F11).
 */
const SI_FIRME: ReadonlySet<string> = new Set(['si', 'sii', 'siii', 'sip', 'sep', 'simon', 'claro', 'correcto', 'exacto', 'afirmativo', 'confirmo',
  'confirmado', 'obvio', 'yes', 'dale', 'hagale', 'hagamosle', 'adelante', 'de_una']);
/** Cortesías de varias palabras que no cambian la respuesta: se quitan antes de mirar palabra por palabra. */
const CORTESIA_FRASES: ReadonlyArray<string> = [
  'si es tan amable', 'si me hace el favor', 'si me haces el favor', 'hagame el favor de', 'hagame el favor', 'hagame el favorcito',
  'me hace el favor de', 'me hace el favor', 'me haces el favor', 'me hace el favorcito', 'hazme el favor', 'haga el favor', 'hagame un favor',
  'por favor', 'de una vez', 'mil gracias', 'muchas gracias', 'con gusto',
];
/** «dale de alta», «denle de alta», «darlo de alta»: el verbo de alta en dos palabras. */
const DAR_DE_ALTA = /\b(?:dale|dele|denle|darle|darlo|darla|de|dar|demos)\s+de\s+alta\b/g;
/** «cliente nuevo», «es una clienta nueva», «nuevo cliente»: lo que dice que el nombre es nuevo (regla 1 del sexto control). */
const CLIENTE_NUEVO = /\b(?:es\s+)?(?:(?:un|una)\s+)?(?:client[ea]\s+nuev[oa]|nuev[oa]\s+client[ea])\b/g;
/** Señalan un viaje («ese», «el mismo»): con un «sí» al lado, la respuesta es ambigua y se vuelve a preguntar. */
const DEICTICOS: ReadonlySet<string> = new Set(['ese', 'esa', 'este', 'esta', 'eso', 'esto', 'aquel', 'aquella', 'mismo', 'misma', 'ahi', 'alli']);
/** Lo que acompaña a una frase que señala un viaje sin nombrar nada («es para ese», «el de …», «al mismo viaje», «el que va a …»). */
const RELLENO_SENALA: ReadonlySet<string> = new Set(['es', 'era', 'seria', 'va', 'van', 'para', 'pa', 'en', 'a', 'al', 'del', 'de', 'el', 'la',
  'lo', 'los', 'las', 'viaje', 'reserva', 'que', 'por', 'favor', 'porfa', 'sale', 'salen', 'viaja', 'viajan', 'hacia', 'rumbo', 'destino', 'con',
  'ya', 'entonces', 'pues']);
/** Con estas, una frase que señala un viaje dice lo contrario o es otra cosa: no se resuelve. */
const CONTRADICE_SENALA = /\b(?:otr[oa]s?|nuev[oa]s?|distint[oa]s?|diferentes?|ningun[oa]?|crea\w*)\b/;
/** Lo que dice «es otra persona»: con eso, lo que sigue no es el nombre (salvo «… se llama X»). */
const OTRA_PERSONA: ReadonlySet<string> = new Set(['otro', 'otra', 'otros', 'otras', 'distinto', 'distinta', 'diferente', 'diferentes']);
/**
 * Lo que va antes de señalar («me refiero al segundo», «quise decir el de Cartagena», «o sea, la 2»): se quita
 * para leer el número u ordinal, o el viaje que señala (sexto control de Vera).
 */
const INTRO_SENALA = /^(?:(?:(?:me|te|nos|se)\s+refier[eo]n?|hablo|hablaba|quise\s+decir|quiero\s+decir|o\s+sea|osea|digo|perdon|mejor|en\s+realidad|realmente|ah)\s+)+(?:(?:a|de)\s+(?=(?:el|la|los|las|lo)\b))?/;
/** Lo que va después y no cambia lo que se señala («la segunda por favor», «el 2 de la lista»). */
const COLA_SENALA = /\s+(?:por\s+favor|porfa|porfis|gracias|de\s+(?:la|esa|esta)\s+lista|de\s+los\s+que\s+(?:me\s+)?(?:mandaste|pusiste|diste))$/;
/** «sácalo», «bótalo», «quítalo», «bórralo»: descartar, como «descartar» (sexto control). */
const DESCARTA_CONFIRMACION = /^(?:(?:sac|bot|quit|borr|elimin)(?:a|e)(?:lo|la|los|las)?|saquelo|saquela|botelo|botela)(?:\s+(?:todo|eso|de\s+una|por\s+favor|porfa|mejor|entonces|pues))*$/;

/**
 * El «sí» de una respuesta completa (quinto y sexto control de Vera). Se quitan las cortesías de varias palabras,
 * «cliente nuevo/nueva» y el nombre propuesto ENTERO; lo que queda tiene que ser todo de palabras permitidas
 * (un «sí» firme, un verbo de alta o cortesía), y decir que sí:
 *   · con un verbo de alta («sí, créalo», «hágame el favor y lo registra», «ábralo»);
 *   · un «sí» firme con el nombre propuesto o con «cliente nuevo» («sí, Sara Mejía», «sí, es cliente nueva»), o
 *     el nombre propuesto con «cliente nuevo» («Sara Mejía, cliente nueva»);
 *   · un «sí» firme con otra afirmación («sí, adelante», «sí señor, de una»).
 * Una palabra de más («sí créalo, falta el pasaporte», «sí, Sara Mejía Ruiz») ya no es este «sí». La negación,
 * los deícticos y la pregunta los mira quien llama.
 */
function esSiCompleto(t: string, propuesto: string | null): boolean {
  let s = ` ${t} `;
  for (const f of CORTESIA_FRASES) s = s.split(` ${f} `).join(' ');
  s = s.replace(DAR_DE_ALTA, ' crea ');
  const sinClienteNuevo = s.replace(CLIENTE_NUEVO, ' ');
  const clienteNuevo = sinClienteNuevo !== s;
  s = sinClienteNuevo;
  s = s.replace(/\bde una\b/g, 'de_una');
  const nombre = normalizarNombre(propuesto);
  const conNombre = !!nombre && ` ${s.replace(/\s+/g, ' ').trim()} `.includes(` ${nombre} `);
  if (conNombre) s = ` ${s.replace(/\s+/g, ' ').trim()} `.replace(` ${nombre} `, ' ');
  const ws = s.split(' ').filter(Boolean);
  const verbo = ws.some(w => VERBOS_CREAR.has(w));
  const permitida = (w: string) => VERBOS_CREAR.has(w) || SI_FIRME.has(w) || AFIRMA.has(w) || ACOMPANA_CREAR.has(w) || (verbo && OBJETO_DEL_ALTA.has(w));
  if (!ws.every(permitida)) return false;
  const firme = ws.some(w => SI_FIRME.has(w));
  if (verbo) return true;
  if (conNombre && (firme || clienteNuevo)) return true;
  if (clienteNuevo && firme) return true;
  // «sí, adelante»: todo es afirmación, y al menos una es un «sí» firme (un «ok» o un «listo» solos no, F11).
  return ws.length > 0 && firme && ws.every(w => SI_FIRME.has(w) || ACOMPANA_CREAR.has(w) || (AFIRMA.has(w) && !ACUSES.has(w)));
}

/**
 * Palabras que dicen algo de la respuesta y nunca son un nombre (sexto control de Vera, hallazgo 5): pedir
 * esperar, revisar, avisar, mandar… Una lista cerrada de raíces de verbos de oficina con sus formas comunes
 * («espérame», «déjeme», «ya miro», «te confirmo», «sácalo»). Solo se usa para decir que una respuesta hecha
 * TODA de estas palabras no es un nombre: un nombre con una de ellas sigue siendo un nombre.
 */
const RAICES_RESPUESTA = ['esper', 'aguant', 'dej', 'permit', 'regal', 'colabor', 'confirm', 'revis', 'verific', 'pregunt', 'averigu', 'mir',
  'consult', 'chequ', 'valid', 'avis', 'mand', 'envi', 'pas', 'sac', 'bot', 'quit', 'borr', 'elimin', 'cambi', 'corrig', 'correg', 'carg', 'cre',
  'registr', 'abr', 'agreg', 'anot', 'guard', 'escrib', 'respond', 'contest', 'busc', 'llam', 'termin', 'segu', 'continu', 'ocup', 'aclar', 'arregl'];
const TERMINACIONES_RESPUESTA = ['a', 'e', 'o', 'as', 'es', 'an', 'en', 'ar', 'er', 'ir', 'amos', 'emos', 'imos', 'ando', 'iendo', 'ado', 'ido',
  'alo', 'ala', 'alos', 'alas', 'elo', 'ela', 'ame', 'eme', 'ale', 'ele', 'arlo', 'arla', 'erlo', 'irlo', 'ate', 'ete', 'enlo', 'anlo', 'amelo', 'emelo'];
const VERBO_DE_RESPUESTA = new RegExp(`^(?:${RAICES_RESPUESTA.join('|')})(?:${TERMINACIONES_RESPUESTA.join('|')})$`);
const VERBOS_SUELTOS: ReadonlySet<string> = new Set(['voy', 'vamos', 'ya', 'veo', 'vea', 've', 'ver', 'digo', 'dime', 'diga', 'digame', 'dame', 'deme',
  'dale', 'dele', 'hago', 'hace', 'haz', 'tengo', 'tiene', 'tienes', 'sabe', 'puedo', 'vemos', 'veamos', 'hablamos', 'hablemos', 'puede', 'quiero', 'quiere', 'aviso', 'creo']);
/** Palabras que no nombran a nadie: pronombres, artículos y conectores. */
const FUNCION: ReadonlySet<string> = new Set(['me', 'te', 'le', 'lo', 'la', 'les', 'los', 'las', 'nos', 'se', 'yo', 'tu', 'usted', 'ud', 'el', 'ella',
  'mi', 'su', 'un', 'una', 'unos', 'y', 'o', 'u', 'que', 'aun', 'todavia', 'tan', 'tanto', 'solo', 'porque', 'pq', 'cuando', 'como', 'con', 'sin',
  'por', 'para', 'de', 'del', 'al', 'a', 'en', 'rato', 'poco', 'ratico', 'tantico', 'ahoritica', 'apenas', 'bien', 'vez', 'favor']);
/** «ratico», «ahorita», «jefecito», «poquito»: el diminutivo de una palabra que no nombra. «Anita» no (es un nombre). */
function diminutivoComun(w: string): boolean {
  const m = /^(\w{2,}?)(?:ecit[oa]s?|cit[oa]s?|it[oa]s?|ic[oa]s?|itic[oa]s?)$/.exec(w);
  if (!m) return false;
  const base = m[1].replace(/qu$/, 'c');
  return [base, `${base}o`, `${base}a`, `${base}e`].some(b => PALABRAS_COMUNES.has(b) || FUNCION.has(b) || ACUSES_ESCRITOS.has(b));
}
/** ¿Esta palabra puede ser parte de un nombre? No, si es común, un acuse, un sí, relleno, un verbo de respuesta, un diminutivo de algo de eso. */
function palabraQueNoNombra(w: string): boolean {
  return PALABRAS_COMUNES.has(w) || ACUSES_ESCRITOS.has(w) || AFIRMA.has(w) || SI_FIRME.has(w) || RELLENO.has(w) || RELLENO_SENALA.has(w)
    || DEICTICOS.has(w) || VERBOS_CREAR.has(w) || VERBOS_SUELTOS.has(w) || FUNCION.has(w) || VERBO_DE_RESPUESTA.test(w) || diminutivoComun(w)
    || /^(ja|je|ji|ha)+j?$/.test(w);
}

/**
 * ¿Lo que quedó como nombre en la confirmación NO es un nombre? (Sexto control de Vera, hallazgo 5: con el
 * interruptor apagado, un acuse, «espérame», «sácalo» o «es otra …» se volvían el nombre propuesto.) No lo es si:
 *   · lo dice «otro/otra/distinto» o una palabra que señala («ese», «aquel»): habla de un viaje o de una persona,
 *     no la nombra;
 *   · empieza por un verbo de respuesta («mándame …», «espera …»): es una instrucción;
 *   · TODAS sus palabras son comunes, acuses, verbos de respuesta, relleno o diminutivos de eso.
 * Un nombre con una palabra común («Andrés Bueno») sigue siendo un nombre.
 */
export function noEsNombreEnConfirmacion(escrito: string): boolean {
  const ws = palabrasDe(escrito);
  if (ws.length === 0) return true;
  if (ws.some(w => OTRA_PERSONA.has(w) || DEICTICOS.has(w))) return true;
  // Empieza por un verbo de respuesta («mándame …», «revisa …», «espera …»): es una instrucción, no un nombre.
  if (VERBO_DE_RESPUESTA.test(ws[0]) || VERBOS_SUELTOS.has(ws[0])) return true;
  return ws.every(palabraQueNoNombra);
}

/**
 * Una frase que SEÑALA un viaje que nombró el aviso «Ya hay un viaje de …» («el de Cartagena», «ese mismo»,
 * «me refiero al que va a Cartagena», o el destino solo): ese viaje, si queda uno solo.
 *   · Los viajes del aviso: los de la lista que se parecen al nombre propuesto y, con `viajes`, también los que
 *     el aviso nombró por su código porque no estaban en la lista (sexto control de Vera), en el mismo orden y
 *     con el mismo tope que la confirmación (`MAX_PARECIDOS`).
 *   · Sin nombrar nada («ese», «el mismo»): vale si el aviso nombra un solo viaje.
 *   · Con el destino (o el nombre del viaje) escrito: vale si es de un solo viaje del aviso. Las demás palabras
 *     tienen que ser de señalar («el que va a …») o del cliente de ESE viaje; el destino solo, sin palabras de
 *     señalar, tiene que estar entero («Punta Cana», no «Cana»).
 * El nombre del cliente solo no elige su viaje (como hoy); una palabra de más, una negación o un «otro»/«nuevo»
 * dejan `null`: se vuelve a preguntar.
 */
function viajeSenalado(t: string, opciones: ReadonlyArray<OpcionConfirmarNuevo>, propuesto: string | null, viajes: ReadonlyArray<ViajeAbierto>): string | null {
  if (!propuesto || CONTRADICE_SENALA.test(t) || NIEGA_EN_CONFIRMACION.test(t)) return null;
  const conCliente = opciones.filter(o => o.cliente).map(o => ({ id: o.id, codigo: o.codigo, cliente: o.cliente ?? null, destino: o.destino ?? null, nombre: o.nombre ?? null }));
  const base = viajes.length > 0 ? [...viajes, ...conCliente.filter(o => !viajes.some(v => v.id === o.id))] : conCliente;
  const avisados = viajesParecidos(propuesto, base).slice(0, MAX_PARECIDOS);
  if (avisados.length === 0) return null;
  const ws = t.split(' ').filter(Boolean);
  const delViaje = (o: ViajeAbierto) => palabrasDe(`${o.destino ?? ''} ${o.nombre ?? ''}`).filter(w => !PALABRAS_COMUNES.has(w));
  const delCliente = (o: ViajeAbierto) => palabrasDe(o.cliente).filter(w => !RELLENO.has(w));
  const resto = ws.filter(w => !DEICTICOS.has(w) && !RELLENO_SENALA.has(w));
  if (resto.length === 0) return ws.some(w => DEICTICOS.has(w)) && avisados.length === 1 ? avisados[0].id : null;
  const senala = resto.length < ws.length;
  // «el de San Andrés»: las palabras que quedan son del destino (o del nombre) de ese viaje, con al menos una
  // que dice algo (4 letras o más); las del cliente de ese mismo viaje pueden acompañar, nunca elegir solas.
  const nombrados = avisados.filter(o => {
    const dv = delViaje(o);
    const delDestino = resto.filter(w => dv.includes(w));
    if (!delDestino.some(w => w.length >= 4)) return false;
    if (!resto.every(w => dv.includes(w) || delCliente(o).includes(w))) return false;
    // El destino solo, sin palabras de señalar: entero («Punta Cana»), para no tomar un nombre por un pedazo del destino.
    return senala || palabrasDe(o.destino).filter(w => !PALABRAS_COMUNES.has(w)).every(w => resto.includes(w));
  });
  return nombrados.length === 1 ? nombrados[0].id : null;
}

/**
 * Una frase corta que SEÑALA un viaje en vez de nombrar a alguien: «ese», «para ese», «el de Ana», «la de
 * Gómez», «el mismo», «el viaje de Ana María». No es el nombre de un cliente nuevo: tomarla como nombre
 * dejaba «¿Creo el cliente nuevo «el de Ana»?» a un «sí» por reflejo (cuarto control de Vera, 2026-10-03).
 */
export function senalaUnViaje(texto: string): boolean {
  const t = normalizarNombre(texto);
  return /\b(?:ese|esa|este|esta|eso|esto|aquel|aquella|ahi|alli|viaje|reserva)\b/.test(t)
    || /^(?:(?:es|era|seria|va|van)\s+)?(?:(?:para|pa|en|a)\s+)?(?:el|la|lo|al|los|las)\s+(?:de|del|que|mism[oa]|primer[oa]?|segund[oa]|tercer[oa]?|ultim[oa])\b/.test(t)
    || /^(?:(?:es|era|seria|va|van)\s+)?(?:para|pa|al|del)\s+(?:el|la)\b/.test(t);
}

/** La respuesta sin lo que va antes y después de señalar («me refiero al segundo por favor» → «al segundo»). */
function sinIntroNiCola(t: string): string {
  return t.replace(INTRO_SENALA, '').replace(COLA_SENALA, '').trim();
}

function leerConfirmacionNuevo(
  texto: string, opciones: ReadonlyArray<OpcionConfirmarNuevo>, propuesto: string | null, viajes: ReadonlyArray<ViajeAbierto>,
): RespuestaConfirmarNuevo {
  const bruto = String(texto ?? '').trim();
  if (!bruto) return { tipo: 'no_entendida' };
  const t = normalizarNombre(bruto);
  const ws = t.split(' ').filter(Boolean);
  // «sí, ese» o «sí, el mismo» a «¿Es para ese (responde 1) o es un cliente nuevo (responde SÍ)?» dice las dos
  // cosas: se vuelve a preguntar (H2: con duda, se pregunta).
  const senala = ws.some(w => DEICTICOS.has(w));
  const niega = NIEGA_EN_CONFIRMACION.test(t);
  if (!senala && esSi(bruto)) return { tipo: 'si' };
  if (/^(?:si )?(?:nuev[oa]|crear|crealo|creala|crearlo|crearla|cliente nuev[oa])$/.test(t)) return { tipo: 'si' };
  // El «sí» de una respuesta completa: con un verbo de alta, con el nombre propuesto entero o «cliente nuevo», o
  // con otra afirmación (quinto y sexto control de Vera). Nunca con una negación, una pregunta o un deíctico.
  if (!senala && !niega && !/[?¿]/.test(bruto) && esSiCompleto(t, propuesto)) return { tipo: 'si' };
  if (/^descart/.test(t) || DESCARTA_CONFIRMACION.test(t)) return { tipo: 'descartar' };
  // El número u ordinal de la lista, como lo lee el atajo del intérprete («2», «el 2», «opción 2», «el
  // segundo», y dentro de una frase corta: «me refiero al segundo»). Fuera de la lista se vuelve a preguntar:
  // nunca es un nombre.
  const corta = sinIntroNiCola(t);
  const num = leerOpcionEscrita(bruto) ?? (corta !== t && corta ? leerOpcionEscrita(corta) : null);
  if (num !== null) {
    const o = opciones[num - 1];
    return o ? { tipo: 'existente', negocio_id: o.id } : { tipo: 'no_entendida' };
  }
  const c = codigoCompacto(bruto);
  if (esCodigo(c)) {
    const o = opciones.find(x => codigoCompacto(x.codigo) === c);
    return o ? { tipo: 'existente', negocio_id: o.id } : { tipo: 'codigo', codigo: c };
  }
  // Un «no …» (en cualquier parte), una pregunta, un «sí» con reserva o el verbo «crear» con algo más no son
  // un nombre: se vuelve a preguntar sin cambiar el propuesto.
  // Lo mismo si empieza por un acuse («claro, después vemos», «listo, ya miro»): no es un nombre (sexto control).
  if (/[?¿]/.test(bruto) || leerSiNo(bruto) !== null || /^(?:no|nop|nel|si|ok|okey|okis|oki|okay|dale|claro|listo|perfecto|bueno|genial|super|entendido|gracias)\b/.test(t)) return { tipo: 'no_entendida' };
  if (niega || ws.some(w => VERBOS_CREAR.has(w))) return { tipo: 'no_entendida' };
  const nuevo = leerNuevo(bruto);
  // «el de Cartagena», «ese mismo», «me refiero al que va a Cartagena», «Punta Cana»: señala un viaje del aviso,
  // no nombra a nadie. Si queda uno solo (por lo que nombra, o el del aviso), es ese; si señala y no queda uno,
  // se vuelve a preguntar.
  if (!nuevo) {
    const id = viajeSenalado(corta || t, opciones, propuesto, viajes);
    if (id) return { tipo: 'existente', negocio_id: id };
  }
  if (senalaUnViaje(nuevo ? nuevo.cliente ?? '' : (corta || bruto))) return { tipo: 'no_entendida' };
  // «es otra, se llama X» / «es otra persona: X»: X es el nombre correcto (se vuelve a confirmar).
  const otra = /^(?:(?:es|era)\s+)?(?:otr[oa]|distint[oa])(?:\s+(?:persona|client[ea]|se[ñn]or|se[ñn]ora))?[\s,.:;-]+(?:(?:que\s+)?se\s+llama|llamad[oa]|de\s+nombre)[\s,.:;-]+(.+)$/i
    .exec(bruto.replace(/[.!]+$/, '').trim());
  const escrito = (otra ? otra[1] : nuevo ? nuevo.cliente ?? '' : bruto)
    .replace(/^(?:(?:que\s+)?se\s+llama|llamad[oa]|de\s+nombre|el\s+nombre\s+es|es)[\s,.:;-]+/i, '')
    // «Rosa Ibáñez, cliente nueva»: el nombre es lo que va antes de «cliente nuevo».
    .replace(/[\s,.:;-]+(?:(?:es\s+)?(?:(?:un|una)\s+)?(?:client[ea]\s+nuev[oa]|nuev[oa](?:\s+client[ea])?))$/i, '')
    .replace(/[.!]+$/, '').trim();
  // Sexto control de Vera (hallazgo 5): un acuse, «espérame», «sácalo», «es otra …»: no es un nombre.
  if (noEsNombreEnConfirmacion(escrito)) return { tipo: 'no_entendida' };
  return calificarNombreNuevo(escrito) === 'nombre' ? { tipo: 'nombre', nombre: escrito } : { tipo: 'no_entendida' };
}

/** «No entendí»: lo que el bot contesta en el acto a una respuesta que no es de la lista del encabezado. */
export function textoNoEntendiEleccion(texto: string, candidatos: ReadonlyArray<ViajeAbierto>): string {
  return `No entendí. ${textoPreguntaEncabezado(texto, candidatos)}`;
}

/**
 * ¿Este escrito es el nombre de un cliente nuevo? Corto, sin números ni preguntas, y no hecho solo de
 * palabras comunes, del equipo ni de un sí/no.
 */
export function esNombreNuevo(texto: string, equipo: ReadonlyArray<string> = []): string | null {
  const bruto = sinPresentacion(String(texto ?? '').trim());
  if (!bruto || /[?¿\d]/.test(bruto) || leerSiNo(bruto) !== null) return null;
  const palabras = palabrasDe(bruto).filter(w => !RELLENO.has(w));
  if (palabras.length === 0 || palabras.length > 4 || sinEfecto(palabras, equipo)) return null;
  return bruto;
}

/**
 * Lo que presenta un nombre y no es parte de él (octavo control de Vera, hallazgo 3): las fórmulas en los dos
 * géneros («el cliente es», «la clienta es», «la señora se llama», «su nombre es», «se llama», «es») y las
 * preposiciones que lo introducen («para», «de», «a nombre de», «es para»). Con el prefijo, el nombre pedía la
 * llave de alguien que ya existe y, con un celular nuevo y el «sí», creaba un duplicado con el prefijo.
 */
const PRESENTA_NOMBRE = /^(?:(?:(?:el|la)\s+)?(?:client[ea]|se[ñn]or|se[ñn]ora|pasajer[oa]|titular)\s+(?:es|se\s+llama)|(?:(?:su|el)\s+)?nombre\s+es|(?:que\s+)?se\s+llama|llamad[oa]|a\s+nombre\s+de|para|de|es)(?:[\s,:;-]+)/i;
export function sinPresentacion(texto: string): string {
  let s = String(texto ?? '').trim();
  for (let i = 0; i < 3; i++) {
    const r = s.replace(PRESENTA_NOMBRE, '').trim();
    if (r === s || !r) break;
    s = r;
  }
  return s;
}

// ── Sí / no ──────────────────────────────────────────────────────────────────

const AFIRMA = new Set(['si', 'sii', 'siii', 'sip', 'sep', 'simon', 'ok', 'oka', 'okey', 'okay', 'oki', 'okis', 'okk', 'dale', 'claro', 'correcto',
  'exacto', 'listo', 'afirmativo', 'confirmo', 'confirmado', 'perfecto', 'obvio', 'yes', 'cargar', 'cargalos', 'asi', 'hagale', 'vale', 'de una']);
/**
 * Acuses que valen como «sí» a «¿Cambias a…?» (cambia UNA caja y el bot lo confirma con «📌»), pero
 * NO como el «sí» que carga un reparto entero: ahí un «ok» o un «👍» reflejo no basta (F11).
 */
const ACUSES = new Set(['ok', 'oka', 'okey', 'okay', 'oki', 'okis', 'okk', 'listo', 'vale', 'perfecto']);
const NIEGA = new Set(['no', 'nop', 'nope', 'negativo', 'nel', 'nones', 'para nada']);
/** Lo que puede acompañar a un sí o a un no sin cambiarlo: «sí, es ella», «no señora», «así es». */
const COLA_SI_NO = new Set(['senor', 'senora', 'es', 'ella', 'el', 'esa', 'ese', 'esta', 'mismo', 'misma', 'tal', 'cual', 'cierto', 'por',
  'favor', 'porfa', 'gracias', 'mil', 'ya', 'claro', 'correcto', 'exacto', 'listo', 'dale', 'de', 'una', 'si', 'asi', 'cambia', 'cambies',
  'cambio', 'ninguno', 'ninguna']);
const EMOJI_SI = /[👍👌✅🙌🫡]/u;
const EMOJI_NO = /[👎❌🚫]/u;

/**
 * Un normalizador de sí/no compartido: la respuesta a «¿Cambias a…?», el «sí» del resumen y las
 * confirmaciones. «si claro», «ok», «sip», «👍», «sí, es ella» son sí; «nop», «no señora», «no, es
 * Carolina» son no. Con un «pero» («ok pero falta uno»), las dos cosas («sí no») o algo más largo,
 * `null`: no se adivina (F11).
 */
export function leerSiNo(texto: string, opts: { estricto?: boolean } = {}): 'si' | 'no' | null {
  const bruto = String(texto ?? '').trim();
  const emojiSi = !opts.estricto && EMOJI_SI.test(bruto);
  const emojiNo = EMOJI_NO.test(bruto);
  const t = normalizarTexto(bruto).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return emojiSi && !emojiNo ? 'si' : emojiNo && !emojiSi ? 'no' : null;
  const ws = t.replace(/\bpara nada\b/g, 'para_nada').replace(/\bde una\b/g, 'de_una').split(' ')
    .map(w => w.replace('para_nada', 'para nada').replace('de_una', 'de una'));
  if (ws.length > 6 || ws.includes('pero')) return null;
  const niega = ws.some(w => NIEGA.has(w)) || emojiNo;
  const afirmaCon = (w: string) => AFIRMA.has(w) && w !== 'asi' && !(opts.estricto && ACUSES.has(w));
  const afirma = ws.some(afirmaCon) || emojiSi || ws.join(' ') === 'asi es';
  if (niega && !afirma) {
    // «no», «nop», «no señora», «no, es Carolina»: empieza por el no y lo que sigue no lo contradice.
    if (!NIEGA.has(ws[0])) return null;
    const cola = ws.slice(1);
    return cola.length === 0 || cola.every(w => COLA_SI_NO.has(w)) || cola[0] === 'es' ? 'no' : null;
  }
  if (afirma && !niega) return ws.every(w => (AFIRMA.has(w) && !(opts.estricto && ACUSES.has(w))) || COLA_SI_NO.has(w)) ? 'si' : null;
  return null;
}

/**
 * ¿Este escrito tiene forma de RESPUESTA a una pregunta del bot? Un sí o un no, un número, un código,
 * «nuevo …», un celular, «descartar», una corrección del resumen («el 3 es de Luisa», «dejar el 2») o
 * algo corto (hasta tres palabras: un nombre). Un texto largo que no es nada de eso («Hola, queremos
 * ir a Cartagena del 12 al 16…») es contenido de una solicitud: si llega sin tanda abierta, puede que
 * su encabezado venga en camino (`hayQueEsperarEnVuelo`). Una respuesta de verdad NO espera: si
 * esperara, un encabezado mandado DESPUÉS de ella podría abrir la tanda y tragársela.
 */
export function pareceRespuesta(texto: string): boolean {
  const bruto = String(texto ?? '').trim();
  if (!bruto) return false;
  if (leerSiNo(bruto) !== null) return true;
  if (interpretarRespuestaNegocio(bruto, []).tipo !== 'no_entendida') return true;
  // «nueva cotización con hotel 4 estrellas»: empieza como un «nuevo», así que contesta la pregunta
  // (no es contenido de la tanda), aunque su nombre pase el tope y la respuesta no se entienda: el bot
  // vuelve a preguntar con la lista y no crea a nadie.
  // «Nueva solicitud: tiquetes y hotel para diciembre» tampoco es un nombre, pero sí la forma de una respuesta.
  if (leerNuevo(bruto) || leerViajeNuevo(bruto) === null) return true;
  // Un celular solo («300 555 1234»): un texto con fechas y edades también junta 10 dígitos.
  if (/^\+?[\d\s().-]{7,}$/.test(bruto)) return true;
  const t = normalizarTexto(bruto).replace(/^[¡!¿?.,;:\s]+/, '');
  if (/^(descart\w*|corregir|corrijo|cambiar|dejar|deja|dejalo|dejalos|mover|mueve|pasar|pasa|quitar|quita|sacar|saca|borrar|borra)\b/.test(t)) return true;
  if (/^(el|la|los|las|mensaje|mensajes)?\s*\d{1,2}(\s*(,|y|e)\s*\d{1,2})*\s+(es|son|va|van|a|al|para)\b/.test(t)) return true;
  return palabrasDe(bruto).length <= 3;
}

/**
 * ¿Este escrito tiene forma de respuesta a la pregunta abierta, según lo que espera? (Trappvel,
 * 2026-10-02, regla 3: la pregunta abierta se contesta sea cual sea la capa que preguntó, aunque una
 * caja esté abierta, y su respuesta nunca es contenido.)
 *   · `viaje` / `nombre` («¿A qué viaje van?», el nombre de un cliente nuevo): lo de `pareceRespuesta`
 *     (un número, un código, un nombre corto, «NUEVO nombre», DESCARTAR); un encabezado también lo es
 *     (quien llama lo mira aparte);
 *   · `resumen` (el reparto, «¿Así? SÍ o corrige»): un sí o un no, números, una corrección («el 2 es de
 *     Luisa», «dejar todos», «descartar el 3», «corregir»). Un nombre suelto NO: es un encabezado que
 *     abre otra caja (QA de #971);
 *   · `otra` («¿es el mismo?», «¿lo creo igual?», «¿cuál contacto?»): un sí o un no, un número, un
 *     celular o «NUEVO» a secas. «nuevo X» con nombre abre su caja.
 */
export function esRespuestaA(espera: 'viaje' | 'nombre' | 'resumen' | 'otra', texto: string): boolean {
  const bruto = String(texto ?? '').trim();
  if (!bruto) return false;
  if (espera === 'viaje' || espera === 'nombre') return pareceRespuesta(bruto);
  if (esSiNoCorto(bruto) || leerEleccion(bruto) !== null) return true;
  // La llave escrita sola contesta el resumen que la espera (2026-10-05: sin llave no se crea el cliente nuevo).
  if (espera === 'resumen' && soloLlave(bruto)) return true;
  if (espera === 'otra') {
    return /^\+?[\d\s().-]{7,}$/.test(bruto) || soloLlave(bruto) !== null || /^(nuev[oa]|crear|crearlo)$/.test(normalizarTexto(bruto).replace(/[.!]+$/, ''));
  }
  const t = normalizarTexto(bruto).replace(/^[¡!¿?.,;:\s]+/, '').replace(/[.!]+$/, '');
  if (/^(corregir|corrijo|cambiar)$/.test(t)) return true;
  if (/^\d{1,2}(\s*(,|y|e)\s*\d{1,2})+$/.test(t)) return true;
  if (/^(descart\w*|dejar|deja|dejalo|dejalos|mover|mueve|pasar|pasa|quitar|quita|sacar|saca|borrar|borra)\b/.test(t)) return true;
  return /^(el|la|los|las|mensaje|mensajes)?\s*\d{1,2}(\s*(,|y|e)\s*\d{1,2})*\s+(es|son|va|van|a|al|para)\b/.test(t);
}

/**
 * Un «sí» o un «no» CORTO (hasta cuatro palabras: «sí», «no señora», «👍», «sí, así es»). Con una
 * pregunta pendiente nunca es contenido de una caja: se aplica a la pregunta (prueba en vivo v2, N1).
 */
export function esSiNoCorto(texto: string): boolean {
  return leerSiNo(texto) !== null && palabrasDe(texto).length <= 4;
}

/** ¿Es un «no» claro? Para «¿Cambias a…? sí/no». */
export function esNo(texto: string): boolean {
  return leerSiNo(texto) === 'no';
}


// ── Segmentos: solo por encabezado ───────────────────────────────────────────

export interface Segmento {
  /** `encabezado`: la caja de un encabezado. `sin_encabezado`: lo que llegó antes del primero o con la caja vencida. */
  origen: 'encabezado' | 'sin_encabezado';
  encabezado: { n: number; texto: string; resolucion: ResolucionEncabezado } | null;
  mensajes: number[];
  /**
   * Solo con un encabezado `aproximado` o `ambiguo`: el viaje que eligió el comercial de la lista
   * numerada. `null` = no eligió: lo de la caja queda sin asignar. `n` es el número de su respuesta.
   */
  eleccion?: { viaje: ViajeAbierto; n: number } | null;
  /** Solo con «nuevo» sin nombre: el nombre que escribió después el comercial. `null` = todavía no llega. */
  nombre?: { texto: string; n: number } | null;
  /** Solo en la caja de un viaje nuevo: lo que el comercial dijo de su cliente (la llave, cuál es, si es otra persona). */
  cliente?: EstadoCliente;
}

/**
 * Lo que se sabe del cliente de un viaje nuevo por lo que escribió el comercial en su caja (diseño 2026-10-05,
 * §3.3). Quién es se resuelve contra el directorio (`clienteDeLaCaja`); aquí solo lo dicho.
 */
export interface EstadoCliente {
  /** La llave del encabezado o la que escribió sola en la caja («300 555 1234», «ana@x.co», «@laurapc»). */
  llave: Llave | null;
  /** El contacto que eligió entre los parecidos, o el dueño de la llave que confirmó («sí, es ella»). */
  elegido: FichaCliente | null;
  /** «Es otra persona» a los parecidos: el nombre ya no busca, falta la llave. */
  otraPersona: boolean;
  /** Los dueños de una llave que dijo que NO son (el bot nunca crea con esa llave). */
  descartadas: string[];
}

function estadoClienteInicial(llave: Llave | null | undefined = null): EstadoCliente {
  return { llave: llave ?? null, elegido: null, otraPersona: false, descartadas: [] };
}

/** El nombre del cliente de un viaje nuevo: el del encabezado o el que escribió después. `null`: no lo ha dicho. */
export function nombreDelViajeNuevo(seg: Segmento): string | null {
  const r = seg.encabezado?.resolucion;
  return r?.tipo === 'nuevo' ? (r.cliente ?? seg.nombre?.texto ?? null) : null;
}

/**
 * ¿Quién es el cliente del viaje nuevo de esta caja? Con el directorio, la resolución (§3.2); el contacto que
 * eligió el comercial gana siempre. `null`: la caja no es de un viaje nuevo, todavía no hay nombre ni llave, o
 * no hay directorio (sin él, el cliente se resuelve al crear).
 */
export function clienteDeLaCaja(seg: Segmento, dir?: Directorio | null): ResolucionCliente | null {
  if (seg.encabezado?.resolucion.tipo !== 'nuevo') return null;
  const ec = seg.cliente ?? estadoClienteInicial();
  const nombre = nombreDelViajeNuevo(seg);
  if (ec.elegido) return { tipo: 'existente', ficha: ec.elegido, por: 'eleccion', nombre, llave: ec.llave };
  if (!dir || (!nombre && !tieneLlave(ec.llave))) return null;
  return resolverConDirectorio(dir, { nombre, llave: ec.llave, descartadas: ec.descartadas, otraPersona: ec.otraPersona });
}

/** El cliente de las cajas (con viaje existente o nuevo), para heredarlo en «es para uno nuevo». */
export function clienteDeCaja(seg: Segmento): string | null {
  const v = viajeDeLaCaja(seg);
  if (v) return v.cliente;
  if (seg.encabezado?.resolucion.tipo === 'nuevo') return seg.cliente?.elegido?.nombre ?? nombreDelViajeNuevo(seg);
  return null;
}

/** ¿Todos los candidatos de la lista son del MISMO cliente? Devuelve su nombre («Mauricio Moreno tiene 5 viajes abiertos»). */
export function unSoloCliente(candidatos: ReadonlyArray<ViajeAbierto>): string | null {
  if (candidatos.length < 2) return null;
  const n = normalizarNombre(candidatos[0].cliente);
  return n && candidatos.every(v => normalizarNombre(v.cliente) === n) ? candidatos[0].cliente : null;
}

/** «nuevo», «uno nuevo», «es nuevo», «ninguno, es otro», «otro viaje»: la respuesta que pide un viaje NUEVO a «¿Va en uno de esos?». */
export function pideViajeNuevo(texto: string): boolean {
  const nv = leerNuevo(texto);
  if (nv && !nv.cliente) return true;
  const t = normalizarNombre(texto);
  return /^(?:no\s+)?(?:(?:a\s+|en\s+)?ningun[oa]?|es\s+otr[oa]|otr[oa])(?:\s+(?:de\s+esos|de\s+esas))?(?:\s+(?:es\s+)?(?:otr[oa]|nuev[oa]|uno\s+nuevo|una\s+nueva|viaje\s+nuevo|otro\s+viaje))*$/.test(t);
}

/**
 * «el de Miami», «el de Armenia», «el M1 26 3»: el ÚNICO candidato cuyo nombre, destino o código tiene todas las
 * palabras que quedan sin el relleno. `null` si no queda uno solo.
 */
export function candidatoNombrado(texto: string, candidatos: ReadonlyArray<ViajeAbierto>): ViajeAbierto | null {
  const ws = palabrasDe(texto).filter(w => !RELLENO_SENALA.has(w) && !DEICTICOS.has(w) && !RELLENO.has(w));
  if (ws.length === 0) return null;
  const del = (v: ViajeAbierto) => new Set(palabrasDe(`${v.nombre ?? ''} ${v.destino ?? ''} ${v.codigo ?? ''}`));
  const cuales = candidatos.filter(v => { const d = del(v); return ws.every(w => d.has(w)); });
  return cuales.length === 1 ? cuales[0] : null;
}

/** ¿La caja tiene un viaje? Un encabezado exacto, o uno aproximado o ambiguo con el viaje elegido de la lista. */
export function viajeDeLaCaja(seg: Segmento): ViajeAbierto | null {
  const r = seg.encabezado?.resolucion;
  if (r?.tipo === 'viaje') return r.viaje;
  return seg.eleccion?.viaje ?? null;
}

/**
 * Un escrito con forma de respuesta CORTA a una pregunta en el acto que no la contesta: un sí o un no,
 * un número. Con la pregunta abierta nunca es contenido (Trappvel, 2026-10-02: el «no» y el «otro
 * cliente» de Edgar quedaron como mensajes del viaje de otra clienta).
 */
export function esRespuestaSuelta(texto: string): boolean {
  return esSiNoCorto(texto) || leerEleccion(texto) !== null;
}

/**
 * Los segmentos de una entrega: cada encabezado abre una caja que vale hasta el siguiente
 * encabezado, el cierre o `horasCajaActiva`. Lo que llega sin caja (antes del primer encabezado o
 * con la caja vencida) va a un segmento `sin_encabezado`: no se adivina de quién es. No se
 * segmenta por silencios ni por contenido (decisión de Mauricio, 2026-10-01: manda el encabezado).
 */
export function armarSegmentos(
  mensajes: ReadonlyArray<MensajeViaje>,
  viajes: ReadonlyArray<ViajeAbierto>,
  cfg: {
    horasCajaActiva: number; equipo?: ReadonlyArray<string>;
    /**
     * Lo que dijo la base de los nombres y llaves de la tanda (`wa-cliente.ts`). Con él, la caja de un viaje
     * nuevo lee en el acto las respuestas a «¿Cuál es?» y «¿Es la misma persona?». Sin él, solo las llaves.
     */
    directorio?: Directorio | null;
  },
): { segmentos: Segmento[]; encabezados: number[] } {
  const equipo = cfg.equipo ?? [];
  const dir = cfg.directorio ?? null;
  const segmentos: Segmento[] = [];
  const encabezados: number[] = [];
  let caja = null as { seg: Segmento; desde: number } | null;
  let suelto = null as Segmento | null;
  const abrirCaja = (m: MensajeViaje, t: number, resolucion: ResolucionEncabezado, conContenido = false): void => {
    const seg: Segmento = {
      origen: 'encabezado', encabezado: { n: m.n, texto: m.cuerpo.trim(), resolucion }, mensajes: conContenido ? [m.n] : [],
      ...(resolucion.tipo === 'aproximado' || resolucion.tipo === 'ambiguo' ? { eleccion: null } : {}),
      ...(resolucion.tipo === 'nuevo' && !resolucion.cliente ? { nombre: null } : {}),
      ...(resolucion.tipo === 'nuevo' ? { cliente: estadoClienteInicial(resolucion.llave) } : {}),
    };
    if (!conContenido) encabezados.push(m.n);
    segmentos.push(seg);
    caja = { seg, desde: t };
    suelto = null;
  };
  for (const m of [...mensajes].sort((a, b) => a.n - b.n)) {
    const t = Date.parse(m.en);
    const escrito = !m.reenviado && m.tipo === 'text';
    // Lo que decidió el intérprete, primero (diseño del bot conversacional, §1): sin esto, al cerrar la
    // tanda «lo de Cartagena» se volvería a leer por su texto como `aproximado` y la caja se perdería.
    const ip = escrito ? decisionDelInterprete(m, viajes, caja?.seg ?? null) : null;
    if (ip) {
      if (ip.tipo === 'caja') {
        // El encabezado que también es contenido no va en `encabezados`: es un mensaje de su caja.
        abrirCaja(m, t, ip.resolucion, ip.conContenido);
        continue;
      }
      if (ip.tipo === 'eleccion') {
        caja!.seg.eleccion = { viaje: ip.viaje, n: m.n };
        encabezados.push(m.n);
        continue;
      }
      if (ip.tipo === 'nombre') {
        caja!.seg.nombre = { texto: ip.nombre, n: m.n };
        encabezados.push(m.n);
        continue;
      }
      // `contenido`: el intérprete dijo que es del cliente; no se relee como encabezado.
      if (caja && !(t - caja.desde > cfg.horasCajaActiva * 3600_000)) {
        caja.seg.mensajes.push(m.n);
        continue;
      }
      caja = null;
      if (!suelto) {
        suelto = { origen: 'sin_encabezado', encabezado: null, mensajes: [] };
        segmentos.push(suelto);
      }
      suelto.mensajes.push(m.n);
      continue;
    }
    const actual = caja as { seg: Segmento; desde: number } | null;
    // La elección de la lista numerada del encabezado (Trappvel, 2026-10-02): la primera, y solo
    // dentro de su caja. Un sí, un no o un número fuera de la lista no la contestan y tampoco son
    // contenido; otro encabezado (un código, «nuevo X») abre su propia caja.
    const candidatos = actual && actual.seg.eleccion === null ? candidatosDelEncabezado(actual.seg.encabezado?.resolucion) : [];
    if (escrito && actual && candidatos.length > 0) {
      const k = leerEleccion(m.cuerpo);
      if (k !== null && k >= 1 && k <= candidatos.length) {
        actual.seg.eleccion = { viaje: candidatos[k - 1], n: m.n };
        encabezados.push(m.n);
        continue;
      }
      // «Mauricio Moreno» con 5 viajes abiertos (diseño 2026-10-05, D1): «nuevo», «uno nuevo» o «ninguno, es
      // otro» es un viaje NUEVO de ese cliente; «el de Miami» es ese viaje.
      const mismo = actual.seg.encabezado?.resolucion.tipo === 'ambiguo' ? unSoloCliente(candidatos) : null;
      if (mismo && pideViajeNuevo(m.cuerpo)) {
        actual.seg.encabezado!.resolucion = { tipo: 'nuevo', cliente: nombrePropio(mismo), mismo: true };
        delete actual.seg.eleccion;
        actual.seg.cliente = estadoClienteInicial();
        encabezados.push(m.n);
        continue;
      }
      const senalado = mismo ? candidatoNombrado(m.cuerpo, candidatos) : null;
      if (senalado) {
        actual.seg.eleccion = { viaje: senalado, n: m.n };
        encabezados.push(m.n);
        continue;
      }
      if (esRespuestaSuelta(m.cuerpo)) {
        encabezados.push(m.n);
        continue;
      }
    }
    // La caja de un viaje nuevo espera algo de su cliente (diseño 2026-10-05, §3.3): la llave escrita sola es
    // siempre la llave, nunca contenido; con el directorio, «el de Miami» o «es otra persona» contestan «¿Cuál
    // es?», y «sí, es ella» o «no» contestan «¿Es la misma persona?».
    if (escrito && actual && actual.seg.cliente) {
      const ec = actual.seg.cliente;
      const k = soloLlave(m.cuerpo);
      if (k) {
        ec.llave = k;
        ec.elegido = null;
        encabezados.push(m.n);
        continue;
      }
      const rc = actual.seg.nombre === null && !tieneLlave(ec.llave) ? null : clienteDeLaCaja(actual.seg, dir);
      if (rc?.tipo === 'elegir') {
        const e = leerEleccionCliente(m.cuerpo, rc.opciones);
        if (e) {
          if (e.tipo === 'ficha') ec.elegido = e.ficha;
          else ec.otraPersona = true;
          encabezados.push(m.n);
          continue;
        }
      }
      if (rc?.tipo === 'llave_de_otro') {
        const s = leerEsLaMisma(m.cuerpo);
        if (s === 'si') ec.elegido = rc.ficha;
        if (s === 'no') {
          ec.descartadas.push(rc.ficha.id);
          ec.llave = null;
        }
        if (s) {
          encabezados.push(m.n);
          continue;
        }
      }
    }
    // El nombre tras un «nuevo» suelto (QA de #971 v6): el primer escrito que no es otro encabezado. Tras
    // «¿Para qué cliente es?», el nombre de un cliente con viajes abiertos es el cliente del viaje NUEVO, no un
    // encabezado de uno de sus viajes (la prueba de Mauricio del 2026-10-05, turno 2): solo un código o un
    // «nuevo X» abren otra caja.
    const necesitaNombre = !!actual && actual.seg.nombre === null
      && (!tieneLlave(actual.seg.cliente?.llave) || !dir || clienteDeLaCaja(actual.seg, dir)?.tipo === 'sin_nombre');
    if (escrito && actual && necesitaNombre) {
      const r = resolverEncabezado(m.cuerpo, viajes, equipo);
      const otro = !!r && ((r.tipo === 'nuevo' && (!!r.cliente || !!r.llave)) || r.tipo === 'codigo_desconocido' || (r.tipo === 'viaje' && r.por === 'codigo'));
      if (!otro) {
        const { nombre: sinLlave, llave } = separarNombreYLlave(m.cuerpo);
        const nombre = esNombreNuevo(llave ? sinLlave : m.cuerpo, equipo);
        if (nombre) {
          actual.seg.nombre = { texto: nombre, n: m.n };
          if (llave && actual.seg.cliente) actual.seg.cliente.llave = llave;
          encabezados.push(m.n);
          continue;
        }
        if (esRespuestaSuelta(m.cuerpo)) {
          encabezados.push(m.n);
          continue;
        }
      }
    }
    const res = escrito ? (resolverEncabezado(m.cuerpo, viajes, equipo) ?? (pareceEncabezado(m.cuerpo, viajes, equipo) ? { tipo: 'no_reconocido' } as ResolucionEncabezado : null)) : null;
    if (res) {
      // «es para uno nuevo», «una cotización nueva sobre un cliente antiguo»: el cliente es el de la caja que
      // estaba abierta (D1, turnos 4 y 5 de la prueba de Mauricio). En la caja de un viaje nuevo, nada cambia; en
      // la de un viaje que ya existe, se vuelve un viaje NUEVO de su cliente.
      const vigente = actual && !(t - actual.desde > cfg.horasCajaActiva * 3600_000) ? actual : null;
      if (res.tipo === 'nuevo' && res.mismo && !res.cliente && !res.llave && vigente) {
        const quien = clienteDeCaja(vigente.seg);
        if (quien && vigente.seg.encabezado?.resolucion.tipo === 'nuevo') {
          encabezados.push(m.n);
          continue;
        }
        if (quien) {
          abrirCaja(m, t, { tipo: 'nuevo', cliente: nombrePropio(quien), mismo: true });
          continue;
        }
      }
      abrirCaja(m, t, res);
      continue;
    }
    if (!m.cuerpo.trim()) continue; // un sticker o una foto sin pie no es contenido
    if (actual && !(t - actual.desde > cfg.horasCajaActiva * 3600_000)) {
      actual.seg.mensajes.push(m.n);
      continue;
    }
    caja = null;
    if (!suelto) {
      suelto = { origen: 'sin_encabezado', encabezado: null, mensajes: [] };
      segmentos.push(suelto);
    }
    (suelto as Segmento).mensajes.push(m.n);
  }
  return { segmentos, encabezados };
}

type DecisionInterprete =
  | { tipo: 'caja'; resolucion: ResolucionEncabezado; conContenido: boolean }
  | { tipo: 'eleccion'; viaje: ViajeAbierto }
  | { tipo: 'nombre'; nombre: string }
  | { tipo: 'contenido' };

/**
 * Lo que dice la `interpretacion` de un escrito, traducido al reparto. `null` = no hay, o no se puede
 * aplicar (el viaje ya no está abierto, la caja no esperaba esa respuesta): se lee como siempre.
 */
function decisionDelInterprete(m: MensajeViaje, viajes: ReadonlyArray<ViajeAbierto>, caja: Segmento | null): DecisionInterprete | null {
  const ip = m.interpretacion;
  if (!ip || typeof ip !== 'object' || typeof ip.accion !== 'string') return null;
  const conContenido = ip.con_contenido === true;
  const viaje = ip.viaje_id ? viajes.find(v => v.id === ip.viaje_id) ?? null : null;
  switch (ip.accion) {
    case 'abrir_viaje':
      if (viaje) return { tipo: 'caja', resolucion: { tipo: 'viaje', viaje, por: 'nombre' }, conContenido };
      if (!ip.viaje_id) {
        const llave = tieneLlave(ip.llave) ? { llave: ip.llave } : {};
        return { tipo: 'caja', resolucion: { tipo: 'nuevo', cliente: ip.nuevo?.trim() || null, ...llave }, conContenido };
      }
      return null;
    case 'preguntar_viaje': {
      const cands = (ip.candidatos ?? []).map(id => viajes.find(v => v.id === id)).filter((v): v is ViajeAbierto => !!v);
      const resolucion: ResolucionEncabezado = cands.length === 1 ? { tipo: 'aproximado', viaje: cands[0], por: 'nombre' }
        : cands.length > 1 ? { tipo: 'ambiguo', candidatos: cands } : { tipo: 'no_reconocido' };
      return { tipo: 'caja', resolucion, conContenido };
    }
    case 'responder': {
      if (!viaje || !caja || caja.eleccion !== null) return null;
      return candidatosDelEncabezado(caja.encabezado?.resolucion).some(v => v.id === viaje.id) ? { tipo: 'eleccion', viaje } : null;
    }
    case 'nombre':
      return caja && caja.nombre === null && ip.nuevo?.trim() ? { tipo: 'nombre', nombre: ip.nuevo.trim() } : null;
    case 'contenido':
      return { tipo: 'contenido' };
    default:
      return null;
  }
}

/** Lo que espera la caja abierta en el acto. `conContenido`: ya entró contenido después de la pregunta. */
export type PendienteDeLaCaja =
  | { tipo: 'eleccion'; texto: string; candidatos: ViajeAbierto[]; conContenido: boolean }
  | { tipo: 'nombre'; conContenido: boolean }
  /**
   * El cliente de un viaje nuevo: falta la llave, elegir entre parecidos o confirmar al dueño de la llave (con el
   * directorio). También `listo`: ya se sabe quién es (para el acuse de la respuesta que lo resolvió).
   */
  | { tipo: 'cliente'; resolucion: ResolucionCliente; nombre: string | null; conContenido: boolean };

/**
 * Lo que espera la última caja: la elección de la lista numerada de un encabezado aproximado o
 * ambiguo, o el nombre de un «nuevo» suelto / «otro cliente». `null`: nada.
 */
export function pendienteDeLaCaja(segmentos: ReadonlyArray<Segmento>, dir?: Directorio | null): PendienteDeLaCaja | null {
  const ultimo = segmentos[segmentos.length - 1];
  const r = ultimo?.encabezado?.resolucion;
  const conContenido = (ultimo?.mensajes.length ?? 0) > 0;
  const candidatos = candidatosDelEncabezado(r);
  if (candidatos.length > 0 && ultimo.eleccion === null) return { tipo: 'eleccion', texto: ultimo.encabezado!.texto, candidatos, conContenido };
  if (r?.tipo === 'nuevo' && ultimo.nombre === null && !tieneLlave(ultimo.cliente?.llave)) return { tipo: 'nombre', conContenido };
  const rc = ultimo ? clienteDeLaCaja(ultimo, dir) : null;
  if (rc && (rc.tipo === 'pedir_llave' || rc.tipo === 'elegir' || rc.tipo === 'llave_de_otro' || rc.tipo === 'sin_nombre' || rc.tipo === 'error')) {
    return { tipo: 'cliente', resolucion: rc, nombre: nombreDelViajeNuevo(ultimo), conContenido };
  }
  return null;
}

/**
 * Cómo se llaman las cajas de una tanda, sin repetir: el viaje (exacto o elegido de la lista) o el
 * cliente nuevo. Para nombrar una tanda al descartarla o cuando no trajo mensajes.
 */
export function nombresDeLasCajas(segmentos: ReadonlyArray<Segmento>): string[] {
  const nombres = segmentos.flatMap(sg => {
    const r = sg.encabezado?.resolucion;
    const v = viajeDeLaCaja(sg);
    if (v) return [nombreDeViaje(v)];
    if (r?.tipo === 'nuevo') return [sg.cliente?.elegido ? nombrePropio(sg.cliente.elegido.nombre) : (r.cliente ?? sg.nombre?.texto ?? null)].filter((x): x is string => !!x);
    return [];
  });
  // «Daniel Pérez» y «daniel perez» son el mismo: se queda el primero como se escribió.
  const vistos = new Map<string, string>();
  for (const x of nombres) if (!vistos.has(normalizarNombre(x))) vistos.set(normalizarNombre(x), x);
  return [...vistos.values()];
}

/** Los mensajes de una tanda que irían al resumen: los de sus cajas, sin risas ni acuses del comercial. */
export function mensajesDelResumen(segmentos: ReadonlyArray<Segmento>, mensajes: ReadonlyArray<MensajeViaje>): number {
  const porN = new Map(mensajes.map(m => [m.n, m]));
  return segmentos.reduce((a, sg) => a + sg.mensajes.filter(n => { const m = porN.get(n); return !!m && !esRuidoDelComercial(m); }).length, 0);
}

/** ¿La entrega tiene al menos un encabezado resuelto? Sin ninguno, la tanda entera es UN viaje y se pregunta como siempre. */
export function tieneEncabezados(segmentos: ReadonlyArray<Segmento>): boolean {
  return segmentos.some(s => s.encabezado !== null && s.encabezado.resolucion.tipo !== 'no_reconocido');
}

/**
 * ¿Un escrito del comercial PARECE un encabezado aunque no se resuelva? Solo si tiene forma de
 * código, o si TODAS sus palabras (sin el relleno) se parecen a una palabra del nombre de algún
 * cliente con viaje abierto: a dos errores o menos, o como su comienzo («Caro» de Carolina). Las
 * palabras del español común (`PALABRAS_COMUNES`) y los nombres del equipo no cortan la caja
 * (QA de #971 v4 y v5: «mira» cortaba por Lina, «otro» por Otero).
 * Si parece y no se resuelve, corta la caja: lo que sigue no hereda el viaje anterior.
 */
export function pareceEncabezado(texto: string, viajes: ReadonlyArray<ViajeAbierto>, equipo: ReadonlyArray<string> = []): boolean {
  const bruto = String(texto ?? '').trim();
  if (!bruto || /[?¿]/.test(bruto)) return false;
  if (esCodigo(codigoCompacto(bruto))) return true;
  const palabras = palabrasDe(bruto);
  if (palabras.length === 0 || palabras.length > 2 || palabras.some(w => /\d/.test(w))) return false;
  const propias = palabras.filter(w => !RELLENO.has(w));
  if (propias.length === 0 || sinEfecto(propias, equipo)) return false;
  const delNombre = [...new Set(viajes.flatMap(v => palabrasDe(v.cliente)).filter(p => p.length >= 4))];
  return propias.every(w => w.length >= 4 && delNombre.some(p => (p.startsWith(w) && w.length >= 4) || distancia(p, w) <= 2));
}

// ── Destinos del plan ────────────────────────────────────────────────────────

/** A dónde va un mensaje. */
export type DestinoPlan =
  | { tipo: 'existente'; negocio_id: string; codigo: string | null; cliente: string | null; nombre?: string | null }
  | DestinoNuevo;

/**
 * Un viaje NUEVO (diseño 2026-10-05: «nuevo» es viaje nuevo). Su cliente se resuelve contra el directorio al
 * armar el resumen (`resolverClientesDelPlan`) y el «sí» del resumen confirma lo que muestra:
 *   · `contacto`: el cliente ya existe (por la llave, por el nombre idéntico y único, o porque el comercial lo
 *     eligió); se muestra con sus 4 dígitos y sus viajes;
 *   · `llave` sin `contacto` ni `falta`: cliente nuevo; se crea con el «sí», con esa llave;
 *   · `falta`: lo que hay que saber antes del «sí» (la llave, cuál de los parecidos, si es el dueño de la llave,
 *     el nombre, o la búsqueda falló). Con algo que falta, el «sí» no carga.
 * Sin ninguno de los tres: no se resolvió (sin directorio); el cliente se resuelve al crear.
 */
export interface DestinoNuevo {
  tipo: 'nuevo';
  cliente: string | null;
  contacto?: FichaCliente | null;
  llave?: Llave | null;
  falta?: FaltaCliente | null;
  /** Con `falta: elegir`, los parecidos; con `falta: confirmar`, el dueño de la llave. */
  opciones?: FichaCliente[];
  /** Lo que dijo el comercial (en la caja o al resumen), para volver a resolver. */
  elegido?: FichaCliente | null;
  otraPersona?: boolean;
  descartadas?: string[];
  /** Ya pasó por el directorio (`resolverClientesDelPlan`): lo que muestra el resumen es lo que dijo la base. */
  resuelto?: boolean;
}

export type FaltaCliente = 'llave' | 'elegir' | 'confirmar' | 'nombre' | 'error';

export function claveDestino(d: DestinoPlan): string {
  if (d.tipo === 'existente') return `e:${d.negocio_id}`;
  return d.contacto ? `c:${d.contacto.id}` : `n:${normalizarNombre(d.cliente)}`;
}

/** ¿El viaje nuevo ya pasó por el directorio? (Una llave dada no basta: hay que buscarla.) */
export function clienteResuelto(d: DestinoNuevo): boolean {
  return d.resuelto === true;
}

/** El destino de un viaje nuevo con lo que dijo el directorio (`ResolucionCliente`). */
export function destinoConResolucion(d: DestinoNuevo, r: ResolucionCliente): DestinoNuevo {
  const base: DestinoNuevo = {
    tipo: 'nuevo', cliente: d.cliente, resuelto: true,
    ...(tieneLlave(d.llave) ? { llave: d.llave } : {}),
    ...(d.elegido ? { elegido: d.elegido } : {}),
    ...(d.otraPersona ? { otraPersona: true } : {}),
    ...(d.descartadas?.length ? { descartadas: [...d.descartadas] } : {}),
  };
  switch (r.tipo) {
    case 'existente': return { ...base, cliente: d.cliente ?? nombrePropio(r.ficha.nombre), contacto: r.ficha };
    case 'nuevo': return { ...base, llave: r.llave };
    case 'pedir_llave': return { ...base, falta: 'llave' };
    case 'elegir': return { ...base, falta: 'elegir', opciones: r.opciones };
    case 'llave_de_otro': return { ...base, falta: 'confirmar', opciones: [r.ficha] };
    case 'sin_nombre': return { ...base, falta: 'nombre' };
    case 'error': return { ...base, falta: 'error' };
  }
}

/**
 * Resuelve el cliente de cada viaje nuevo del plan con el directorio (`wa-cliente.ts` lo arma antes). Los que ya
 * están resueltos no se tocan; un contacto elegido por el comercial gana. Devuelve un plan nuevo.
 */
export function resolverClientesDelPlan(plan: PlanViajes, dir: Directorio): PlanViajes {
  const hechos = new Map<string, DestinoNuevo>();
  const mensajes = plan.mensajes.map(m => {
    const d = m.destino;
    if (!d || d.tipo !== 'nuevo' || clienteResuelto(d)) return { ...m };
    const k = `${normalizarNombre(d.cliente)}|${d.elegido?.id ?? ''}|${d.otraPersona ? 1 : 0}|${(d.descartadas ?? []).join(',')}`;
    if (!hechos.has(k)) {
      const r: ResolucionCliente = d.elegido
        ? { tipo: 'existente', ficha: d.elegido, por: 'eleccion', nombre: d.cliente, llave: d.llave ?? null }
        : resolverConDirectorio(dir, { nombre: d.cliente, llave: d.llave, descartadas: d.descartadas, otraPersona: d.otraPersona });
      hechos.set(k, destinoConResolucion(d, r));
    }
    return { ...m, destino: hechos.get(k)! };
  });
  return { ...plan, mensajes };
}

/** Los viajes nuevos del plan a los que les falta algo de su cliente, en orden (el primero se pregunta). */
export function clientesPorResolver(plan: PlanViajes): Array<{ k: number; destino: DestinoNuevo }> {
  return gruposDelPlan(plan).filter(g => g.destino.tipo === 'nuevo' && !!g.destino.falta)
    .map(g => ({ k: g.k, destino: g.destino as DestinoNuevo }));
}

/** La pregunta de lo que falta del cliente de un viaje nuevo (una sola, arriba; §3.3). */
export function textoFaltaCliente(d: DestinoNuevo): string {
  const nombre = d.cliente ? nombrePropio(d.cliente) : 'este cliente';
  switch (d.falta) {
    case 'llave': return `¿Me pasas el celular o el correo de ${nombre}? Sin uno de los dos no lo creo (también vale su usuario de WhatsApp o Instagram).`;
    case 'elegir': {
      const ops = d.opciones ?? [];
      return ops.length === 1
        ? `¿${nombre} es ${nombrePropio(ops[0].nombre)} (${datoDeLaFicha(ops[0])}, ${viajesDeLaFicha(ops[0])}), o es otra persona?`
        : `¿Cuál ${nombre} es: ${ops.map((f, i) => `${['el primero', 'el segundo', 'el tercero', 'el cuarto', 'el quinto'][i]}, ${datoDeLaFicha(f)} (${viajesDeLaFicha(f)})`).join('; ')}? ¿O es otra persona?`;
    }
    case 'confirmar': {
      const f = d.opciones?.[0];
      return `El ${d.llave?.celular ? 'celular' : d.llave?.correo ? 'correo' : 'usuario'} que me diste ya es de ${f ? nombrePropio(f.nombre) : 'otro contacto'}. ¿Es la misma persona?`;
    }
    case 'nombre': return `¿Cómo se llama el cliente con ${textoLlave(d.llave)}?`;
    case 'error': return 'No pude revisar el directorio de clientes y no creo a nadie sin revisarlo. Responde sí en un momento y lo intento de nuevo.';
    default: return '';
  }
}

/** El viaje nuevo de una caja, con lo que el comercial dijo de su cliente (se resuelve después, con el directorio). */
function destinoNuevoDeLaCaja(nombre: string | null, ec: EstadoCliente | undefined): DestinoNuevo {
  return {
    tipo: 'nuevo', cliente: nombre ?? (ec?.elegido ? nombrePropio(ec.elegido.nombre) : null),
    ...(tieneLlave(ec?.llave) ? { llave: ec!.llave } : {}),
    ...(ec?.elegido ? { elegido: ec.elegido } : {}),
    ...(ec?.otraPersona ? { otraPersona: true } : {}),
    ...(ec?.descartadas?.length ? { descartadas: [...ec.descartadas] } : {}),
  };
}

function destinoDeViaje(v: ViajeAbierto): DestinoPlan {
  return { tipo: 'existente', negocio_id: v.id, codigo: v.codigo, cliente: v.cliente, nombre: v.nombre ?? null };
}

// ── Lo que se ve sin modelo: nombres, lugares, presentaciones ────────────────

/** Palabras de un nombre que no identifican a nadie. */
const NO_IDENTIFICAN = new Set(['san', 'santa', 'del', 'las', 'los', 'familia']);

/**
 * El texto sin los lugares: los destinos de los viajes abiertos y lo que va después de «San» o
 * «Santa». Así «San Andrés» no nombra a Andrés Gil (QA de #971, el día: Luisa terminó sin datos).
 */
export function sinLugares(texto: string, viajes: ReadonlyArray<ViajeAbierto> = []): string {
  let t = ` ${palabrasDe(texto).join(' ')} `;
  const destinos = [...new Set(viajes.map(v => normalizarNombre(v.destino)).filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const d of destinos) t = t.split(` ${d} `).join(' ');
  t = t.replace(/ (san|santa|santo) \w+/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** Los viajes (abiertos o NUEVO de un encabezado) que un mensaje nombra por el nombre del cliente, sin lugares. */
export function viajesNombrados(cuerpo: string, destinos: ReadonlyArray<DestinoPlan>, viajes: ReadonlyArray<ViajeAbierto> = []): DestinoPlan[] {
  const palabras = new Set(sinLugares(cuerpo, viajes).split(' '));
  const out = new Map<string, DestinoPlan>();
  for (const d of destinos) {
    const delNombre = palabrasDe(d.cliente).filter(w => w.length >= 3 && !NO_IDENTIFICAN.has(w));
    if (delNombre.length > 0 && delNombre.some(w => palabras.has(w))) out.set(claveDestino(d), d);
  }
  return [...out.values()];
}

/**
 * El viaje abierto de OTRO cliente que un mensaje nombra con claridad: su código, o el nombre de pila de su cliente
 * junto con otra palabra de su nombre («Jorge Pérez», sin los lugares). No cuenta si esas palabras también son del
 * cliente de la caja, ni el nombre de pila o el apellido solos (puede ser la firma de alguien, o un apellido
 * común). `null` si no nombra a ninguno o nombra a más de uno (eso ya lo marca «habla de dos viajes»).
 */
export function viajeDeOtroCliente(cuerpo: string, caja: DestinoPlan, viajes: ReadonlyArray<ViajeAbierto>): ViajeAbierto | null {
  const dichas = new Set(sinLugares(cuerpo, viajes).split(' '));
  const compacto = codigoCompacto(cuerpo);
  const deLaCaja = new Set(palabrasDe(caja.cliente));
  const otros = viajes.filter(v => !(caja.tipo === 'existente' && caja.negocio_id === v.id)).filter(v => {
    const cod = codigoCompacto(v.codigo);
    if (cod.length >= 4 && compacto.includes(cod)) return true;
    const ws = palabrasDe(v.cliente).filter(w => w.length >= 3 && !NO_IDENTIFICAN.has(w) && !RELLENO.has(w) && !PALABRAS_COMUNES.has(w));
    if (ws.length < 2 || !dichas.has(ws[0])) return false;
    const otra = ws.slice(1).filter(w => dichas.has(w));
    return otra.length > 0 && ![ws[0], ...otra].every(w => deLaCaja.has(w));
  });
  return otros.length === 1 ? otros[0] : null;
}

/** Los destinos de viajes abiertos que el mensaje nombra («para Cartagena»), normalizados. */
export function destinosNombrados(cuerpo: string, viajes: ReadonlyArray<ViajeAbierto>): string[] {
  const t = ` ${palabrasDe(cuerpo).join(' ')} `;
  return [...new Set(viajes.map(v => normalizarNombre(v.destino)).filter(d => d && t.includes(` ${d} `)))];
}

const RELACIONES = '(esposa|esposo|mama|mamá|papa|papá|madre|padre|hija|hijo|hermana|hermano|novia|novio|pareja|suegra|suegro|mujer|marido|asistente|secretaria|nuera|yerno|cunada|cunado|prima|primo|tia|tio|abuela|abuelo)';

/** ¿El mensaje dice que quien escribe es familiar (o asistente) del titular? «la esposa de Jorge». */
export function esFamiliarDe(cuerpo: string, titular: string | null): boolean {
  const t = ` ${palabrasDe(cuerpo).join(' ')} `;
  return palabrasDe(titular).filter(w => w.length >= 3).some(w => new RegExp(` ${RELACIONES} de ${w} `).test(t));
}

const RE_TERCERO = /(desde \$|precio por persona|aplican (condiciones|restricciones)|cupos limitados|\babono\b|\bcomprobante\b|\bconsignaci)/;
const RUIDO = new Set(['gracias', 'ok', 'okey', 'listo', 'dale', 'chao', 'buenas', 'noches', 'bueno', 'perfecto', 'si']);

/** ¿Es una promoción, un pago o ruido (lo que la bandeja clasifica como tercero o ruido sin modelo)? */
export function noEsDelCliente(cuerpo: string): boolean {
  const t = normalizarTexto(cuerpo);
  const palabras = palabrasDe(cuerpo);
  if (palabras.length === 0 || RE_TERCERO.test(t)) return true;
  return palabras.every(w => RUIDO.has(w) || /^(ja|je)+$/.test(w));
}

const RE_PRESENTACION = /(?:^|[\s,.;:¡!¿?])(?:soy|habla|te habla|me llamo|mi nombre es|de parte de|te escribe)\s+(?:la\s+|el\s+)?([A-ZÁÉÍÓÚÑa-záéíóúñü]+)/i;

/** El nombre con el que el mensaje se presenta («soy Andrés», «habla Luisa»), normalizado; `null` si no se presenta. */
export function seQuienSePresenta(cuerpo: string): string | null {
  const r = RE_PRESENTACION.exec(cuerpo);
  return r ? normalizarNombre(r[1]) : null;
}

// ── El plan ──────────────────────────────────────────────────────────────────

export type PorQue = 'encabezado' | 'comercial';

export interface MensajePlan {
  n: number;
  /** El viaje de su caja (o el que eligió el comercial). `null`: sin caja, o habla de dos viajes. */
  destino: DestinoPlan | null;
  por: PorQue | null;
  /** Por qué quedó sin caja, o por qué es sospechoso. */
  motivo?: string;
  /** Sospechoso dentro de una caja: se carga en `destino` solo si el comercial dice «dejar». */
  sospecha?: boolean;
  /** Nombra a dos viajes: no se puede cargar entero en ninguno (F13); solo se descarta. */
  varios?: boolean;
  /** El comercial pidió descartarlo. */
  descartado?: boolean;
}

/** Lo que se guarda en `wa_bandeja_entregas.plan_viajes`: la asignación por mensaje. */
export interface PlanViajes {
  version: 2;
  mensajes: MensajePlan[];
  /** Los números de los mensajes que fueron encabezados (no son contenido). */
  encabezados: number[];
  /** Lo que el bot tiene que decir del reparto («"Carolina" puede ser…»). */
  avisos: string[];
}

const MESES_TXT = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Lo que un mensaje dice de fechas y de adultos, para ver si choca con lo anterior de la caja. */
export function datosDelMensaje(cuerpo: string): { fechas: string[]; adultos: number[] } {
  const t = palabrasDe(cuerpo);
  const fechas: string[] = [];
  t.forEach((w, i) => {
    const mes = MESES_TXT.indexOf(w);
    if (mes < 0) return;
    for (let k = i - 1; k >= Math.max(0, i - 6); k--) {
      if (/^\d{1,2}$/.test(t[k])) fechas.push(`${Number(t[k])}-${mes + 1}`);
      else if (MESES_TXT.includes(t[k])) break;
    }
  });
  const adultos: number[] = [];
  t.forEach((w, i) => {
    if (/^(adultos?|adlts?)$/.test(w) && /^\d{1,2}$/.test(t[i - 1] ?? '')) adultos.push(Number(t[i - 1]));
  });
  return { fechas, adultos };
}

/** Un saludo que abre una conversación: «Hola Tati, buenas tardes», «Buenos días». */
const RE_SALUDO = /^(hola|buenas|buenos dias|buen dia|buenas tardes|buenas noches|que mas|quiubo)\b/;

function chocaConLaCaja(m: { fechas: string[]; adultos: number[] }, caja: { fechas: Set<string>; adultos: Set<number> }): string | null {
  // Un rango contra otro rango: una fecha suelta puede ser la salida o el regreso, no choca.
  if (m.fechas.length >= 2 && caja.fechas.size >= 2 && !m.fechas.some(f => caja.fechas.has(f))) return 'dice otras fechas que lo anterior de esta caja';
  if (m.adultos.length > 0 && caja.adultos.size > 0 && !m.adultos.some(a => caja.adultos.has(a))) return 'dice otro número de adultos que lo anterior de esta caja';
  return null;
}

function avisoEncabezado(seg: Segmento, cerrados: ReadonlySet<string>): string | null {
  const e = seg.encabezado!;
  const r = e.resolucion;
  if (r.tipo === 'aproximado' || r.tipo === 'ambiguo') {
    // Elegido, o con nada después del encabezado (no hay qué asignar, error 11): nada que decir.
    if (seg.eleccion || seg.mensajes.length === 0) return null;
    return `«${e.texto}» puede ser ${candidatosDelEncabezado(r).map(lineaCaja).join(' o ')} y no elegiste: lo que siguió no lo cargué. Dime de qué viaje es.`;
  }
  if (r.tipo === 'no_reconocido') return `No reconocí el encabezado «${e.texto}»: lo que sigue no lo cargo en el viaje anterior. Dime de qué viaje es.`;
  if (r.tipo === 'codigo_desconocido') {
    return cerrados.has(r.codigo)
      ? `El viaje ${e.texto} está cerrado: no lo reabro ni cargo nada en él.`
      : `No existe un viaje abierto con el código ${e.texto}: no creé nada.`;
  }
  return null;
}

/**
 * Arma el plan. MANDA EL ENCABEZADO: un encabezado resuelto fija el viaje de todo lo que sigue,
 * hasta el siguiente encabezado, el cierre o el vencimiento de la caja. Sin modelo.
 *
 * Lo único que se infiere es marcar SOSPECHOSOS dentro de una caja (quedan en la caja, pero no se
 * cargan hasta que el comercial diga «dejar» o «mover a…»):
 *   · nombra a dos viajes (además queda `varios`: solo se puede descartar);
 *   · nombra el destino de otro viaje abierto («para Cartagena» bajo «Carolina», que va a Punta Cana);
 *   · se presenta como otra persona («soy Andrés» bajo «Carolina»);
 *   · saluda a mitad de la caja;
 *   · dice otras fechas u otro número de adultos que lo anterior de la caja;
 *   · sigue a uno de esos (la conversación pudo cambiar) hasta que un mensaje vuelva a nombrar al cliente.
 * Lo que no tiene caja (antes del primer encabezado, caja vencida, encabezado ambiguo o
 * desconocido) queda sin asignar: el comercial dice a qué viaje va o lo descarta.
 */
export function armarPlan(p: {
  mensajes: ReadonlyArray<MensajeViaje>;
  viajes: ReadonlyArray<ViajeAbierto>;
  segmentos: ReadonlyArray<Segmento>;
  encabezados: ReadonlyArray<number>;
  /** Códigos compactos de viajes CERRADOS del workspace, para decir «está cerrado» y no «no existe». */
  codigosCerrados?: ReadonlySet<string>;
}): PlanViajes {
  const porN = new Map(p.mensajes.map(m => [m.n, m]));
  const destinosConocidos: DestinoPlan[] = [
    ...p.viajes.map(destinoDeViaje),
    ...p.segmentos.flatMap(s => (s.encabezado?.resolucion.tipo === 'nuevo' ? [{ tipo: 'nuevo', cliente: s.encabezado.resolucion.cliente } as DestinoPlan] : [])),
  ];
  const destinoDe = (d: DestinoPlan) => (d.tipo === 'existente' ? normalizarNombre(p.viajes.find(v => v.id === d.negocio_id)?.destino ?? null) : '');
  const plan: PlanViajes = { version: 2, mensajes: [], encabezados: [...p.encabezados], avisos: [] };

  for (const seg of p.segmentos) {
    const res = seg.encabezado?.resolucion ?? null;
    if (seg.encabezado) {
      const aviso = avisoEncabezado(seg, p.codigosCerrados ?? new Set());
      if (aviso) plan.avisos.push(aviso);
    }
    const deLaCaja = viajeDeLaCaja(seg);
    const nombreNuevo = res?.tipo === 'nuevo' ? (res.cliente ?? seg.nombre?.texto ?? null) : null;
    const ec = seg.cliente;
    const caja: DestinoPlan | null = deLaCaja ? destinoDeViaje(deLaCaja)
      : res?.tipo === 'nuevo' && (nombreNuevo || ec?.elegido || tieneLlave(ec?.llave)) ? destinoNuevoDeLaCaja(nombreNuevo, ec) : null;
    const nombreCaja = caja?.cliente ?? 'ese viaje';
    const vistos = { fechas: new Set<string>(), adultos: new Set<number>() };
    let tras = false;
    let enLaCaja = 0;

    for (const n of seg.mensajes) {
      const m = porN.get(n);
      if (!m) continue;
      // Una risa o unos emojis («jajaja», «😂😂») no van al resumen ni se numeran (error 13): no
      // traen nada de la solicitud y solo alargan la lista que el comercial revisa. Tampoco un acuse
      // escrito por el comercial («si», «no», «ok gracias»: Trappvel, 2026-10-02).
      if (esRuidoDelComercial(m)) continue;
      // El encabezado que también es contenido (solo con la `interpretacion` del intérprete): ahí el
      // comercial nombra al cliente de la caja con sus palabras, y un apellido compartido («Daniel Pérez»
      // con Lina Pérez abierta) no es otro viaje. Para ese mensaje, un viaje cuenta como nombrado solo
      // con TODAS las palabras de su cliente (la regla de #986). Hoy ese caso no existe.
      const suEncabezado = seg.encabezado?.n === n;
      // En la caja de un viaje NUEVO de un cliente que ya tiene viajes abiertos (D1), nombrarlo no es hablar de
      // «otro viaje»: es el mismo cliente.
      const delMismoCliente = (d: DestinoPlan) => caja?.tipo === 'nuevo' && d.tipo === 'existente' && !!caja.cliente
        && normalizarNombre(d.cliente) === normalizarNombre(caja.cliente);
      const nombrados = viajesNombrados(m.cuerpo, destinosConocidos, p.viajes)
        .filter(d => !suEncabezado || palabrasDe(d.cliente).every(w => palabrasDe(m.cuerpo).includes(w)))
        .filter(d => !delMismoCliente(d));
      if (!caja) {
        const motivo = !seg.encabezado ? 'llegó sin encabezado'
          : res?.tipo === 'nuevo' ? `«${seg.encabezado.texto}»: no me dijiste para qué cliente es`
          : res?.tipo === 'aproximado' ? `«${seg.encabezado.texto}» puede ser ${lineaCaja(res.viaje)} y no elegiste`
          : `el encabezado «${seg.encabezado.texto}» no se pudo resolver`;
        plan.mensajes.push({ n, destino: null, por: null, motivo, ...(nombrados.length >= 2 ? { varios: true } : {}) });
        continue;
      }
      const presenta = seQuienSePresenta(m.cuerpo);
      // «habla Marta, la esposa de Jorge» bajo «Jorge»: un familiar del titular no es otra persona.
      const presentaLaCaja = !!presenta && (palabrasDe(caja.cliente).includes(presenta) || esFamiliarDe(m.cuerpo, caja.cliente));
      // «Soy Andrés Gil, me pasó tu número Luisa» bajo «nuevo Andrés Gil»: nombra a dos, pero se
      // presenta como el cliente de la caja. No es un mensaje de dos viajes.
      if (nombrados.length >= 2 && !presentaLaCaja) {
        plan.mensajes.push({ n, destino: null, por: null, varios: true, sospecha: true, motivo: `habla de dos viajes (${nombrados.map(d => d.cliente).join(' y ')})` });
        tras = true;
        enLaCaja++;
        continue;
      }
      const datos = datosDelMensaje(m.cuerpo);
      const nombraLaCaja = presentaLaCaja || (nombrados.length === 1 && claveDestino(nombrados[0]) === claveDestino(caja));
      const otroDestino = destinosNombrados(m.cuerpo, p.viajes).find(d => caja.tipo === 'existente' && d !== destinoDe(caja) && !destinoDe(caja).includes(d));
      // Sexto control de Vera (hallazgo 7): nombra al cliente de OTRO viaje abierto y no al de la caja. No se carga en
      // la caja sin preguntar: queda marcado y el «sí» espera a que el comercial lo deje, lo mueva o lo descarte.
      const deOtro = nombraLaCaja ? null : viajeDeOtroCliente(m.cuerpo, caja, p.viajes);
      const motivo = otroDestino ? `habla de ${otroDestino.toUpperCase()} y ${caja.tipo === 'existente' ? caja.codigo : 'esta caja'} va a ${destinoDe(caja).toUpperCase() || 'otro lugar'}`
        : deOtro ? `nombra a ${clienteYCodigo(deOtro)}, que tiene un viaje abierto`
        : presenta && !presentaLaCaja ? `se presenta como ${presenta.toUpperCase()}`
        : enLaCaja > 0 && RE_SALUDO.test(normalizarTexto(m.cuerpo)) && !nombraLaCaja ? 'saluda a mitad de la caja: puede ser otra conversación'
        : chocaConLaCaja(datos, vistos)
          ?? (tras && !nombraLaCaja ? 'sigue a un mensaje sospechoso' : null);
      if (nombraLaCaja && !motivo) tras = false;
      // Un mensaje que no es del cliente (una promoción, un pago, ruido) no contagia a los que siguen.
      if (motivo && !noEsDelCliente(m.cuerpo)) tras = true;
      plan.mensajes.push(motivo
        ? { n, destino: caja, por: 'encabezado', sospecha: true, motivo: `${motivo}; puede no ser de ${nombreCaja}` }
        : { n, destino: caja, por: 'encabezado' });
      if (!motivo) {
        for (const f of datos.fechas) vistos.fechas.add(f);
        for (const x of datos.adultos) vistos.adultos.add(x);
      }
      enLaCaja++;
    }
  }
  plan.mensajes.sort((a, b) => a.n - b.n);
  return plan;
}

/** Los viajes del plan, en el orden en que aparecen, con sus mensajes (los sospechosos incluidos, marcados aparte). */
export function gruposDelPlan(plan: PlanViajes): Array<{ k: number; destino: DestinoPlan; mensajes: number[] }> {
  const grupos = new Map<string, { destino: DestinoPlan; mensajes: number[] }>();
  for (const m of plan.mensajes) {
    if (!m.destino || m.descartado) continue;
    const c = claveDestino(m.destino);
    if (!grupos.has(c)) grupos.set(c, { destino: m.destino, mensajes: [] });
    grupos.get(c)!.mensajes.push(m.n);
  }
  return [...grupos.values()].map((g, i) => ({ k: i + 1, ...g }));
}

/** Lo que el comercial tiene que decidir antes del «sí»: sin caja, sospechosos y los de dos viajes. */
export function pendientes(plan: PlanViajes): MensajePlan[] {
  return plan.mensajes.filter(m => !m.descartado && (!m.destino || m.sospecha));
}

/** Lo que quedó sin viaje (sin caja o de dos viajes). */
export function sinAsignar(plan: PlanViajes): MensajePlan[] {
  return plan.mensajes.filter(m => !m.destino && !m.descartado);
}

/**
 * ¿Se puede cargar sin preguntar? Solo con `confirmar: si_duda`, nada pendiente ni avisos, y sin clientes
 * nuevos: un cliente nuevo se crea solo con el «sí» del comercial al resumen (2026-10-03).
 */
export function planSinDudas(plan: PlanViajes): boolean {
  const grupos = gruposDelPlan(plan);
  return pendientes(plan).length === 0 && plan.avisos.length === 0 && grupos.length > 0 && grupos.every(g => g.destino.tipo === 'existente');
}

/** Un destino del plan como se le muestra al comercial: «Cliente nuevo: Laura» o «Europa 2 días · Carolina Ruiz (M1 26 5)». */
export function nombreDestino(d: DestinoPlan): string {
  if (d.tipo !== 'nuevo') return nombreDeViaje(d);
  // El «sí» confirma lo que se muestra: el contacto que ya existe con su dato, o el cliente nuevo con su llave.
  if (d.contacto) return `Viaje nuevo de ${nombrePropio(d.contacto.nombre)} (ya es cliente: ${datoDeLaFicha(d.contacto)}, ${viajesDeLaFicha(d.contacto)})`;
  const quien = d.cliente ? String(d.cliente).trim() : 'un cliente sin nombre';
  if (d.falta === 'llave') return `Viaje nuevo de ${quien} (no lo tengo en el directorio: falta su celular o correo)`;
  if (d.falta === 'elegir') return `Viaje nuevo de ${quien} (hay ${(d.opciones ?? []).length === 1 ? 'un contacto parecido' : 'varios contactos parecidos'}: dime cuál)`;
  if (d.falta === 'confirmar') return `Viaje nuevo de ${quien} (${textoLlave(d.llave)}, que ya es de ${nombrePropio(d.opciones?.[0]?.nombre ?? 'otro contacto')})`;
  if (d.falta === 'nombre') return `Viaje nuevo de un cliente sin nombre (${textoLlave(d.llave)})`;
  if (d.falta === 'error') return `Viaje nuevo de ${quien} (no pude revisar el directorio)`;
  if (tieneLlave(d.llave)) return d.resuelto ? `Viaje nuevo de ${quien} (cliente nuevo, ${textoLlave(d.llave)})` : `Viaje nuevo de ${quien} (${textoLlave(d.llave)})`;
  return `Viaje nuevo de ${quien}`;
}

/**
 * Lo que el resumen dice de un cliente nuevo que se parece al de un viaje abierto: «⚠ 1) Ya hay un viaje
 * de Ana María Gómez (T1 26 4). ¿Es para ese («el 1 y 2 es de T1 26 4») o es un cliente nuevo (responde
 * SÍ)?». Con los números del resumen, para moverlos con la corrección de siempre.
 */
function avisoParecidosDelGrupo(k: number, ns: ReadonlyArray<number>, parecidos: ReadonlyArray<ViajeAbierto>): string {
  const ps = parecidos.slice(0, MAX_PARECIDOS);
  const destino = (v: ViajeAbierto) => v.codigo?.trim() || nombrePropio(v.cliente) || '';
  const mover = `«el ${enumerar(ns.map(String))} ${ns.length === 1 ? 'es' : 'son'} de ${destino(ps[0])}»`;
  return ps.length === 1
    ? `⚠ ${k}) Ya hay un viaje de ${clienteYCodigo(ps[0])}: si es para ese, escribe ${mover}; si es un viaje nuevo, déjalo así.`
    : `⚠ ${k}) Ya hay viajes de ${enumerar(ps.map(clienteYCodigo))}: si es para uno de esos, escribe por ejemplo ${mover}; si es un viaje nuevo, déjalo así.`;
}

function recorte(t: string, n = 40): string {
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

const MAX_CON_TEXTO = 25;
/** WhatsApp corta en 4.096 caracteres; se deja margen. */
export const MAX_LARGO_RESUMEN = 3800;

/**
 * La numeración que ve el comercial: los mensajes del resumen, 1, 2, 3…, sin contar encabezados ni
 * respuestas («sí», el nombre de un nuevo). Las correcciones («el 2 es de…») usan la misma (prueba
 * en vivo del 2026-10-01: «nuevo Laura Prueba» era el 1 y el primer mensaje salía como 2).
 */
export function numeracion(plan: PlanViajes): { visible: (n: number) => number; interno: (k: number) => number | null } {
  const orden = [...new Set(plan.mensajes.map(m => m.n))].sort((a, b) => a - b);
  const pos = new Map(orden.map((n, i) => [n, i + 1]));
  return { visible: n => pos.get(n) ?? n, interno: k => orden[k - 1] ?? null };
}

/** «2-4, 6, 9-10»: los números de una lista, en rangos. */
export function rangos(ns: ReadonlyArray<number>): string {
  const o = [...ns].sort((a, b) => a - b);
  const partes: string[] = [];
  for (let i = 0; i < o.length; i++) {
    let j = i;
    while (j + 1 < o.length && o[j + 1] === o[j] + 1) j++;
    partes.push(j > i ? `${o[i]}-${o[j]}` : `${o[i]}`);
    i = j;
  }
  return partes.join(', ');
}

/**
 * El resumen antes de cargar, en uno o más mensajes de hasta `MAX_LARGO_RESUMEN` caracteres.
 * Cada mensaje CARGADO de cada caja va en su propia línea con sus primeras palabras (no solo el
 * rango): un encabezado olvidado, seguido de mensajes sin fechas ni adultos ni destino, cae en la
 * caja anterior sin que el código lo pueda ver; así Tatiana lo ve antes del «sí» (QA de #971 v3,
 * R2). Lo que hay que decidir va aparte, con su texto y su motivo. Si no cabe en un mensaje, se
 * parte por líneas; el cierre con las instrucciones va siempre en el último.
 */
export function partesResumenPlan(
  plan: PlanViajes, mensajes: ReadonlyArray<MensajeViaje>, aviso?: string,
  /** Los viajes abiertos: un cliente nuevo que se parece al de uno de ellos lo dice antes del «sí». */
  viajes: ReadonlyArray<ViajeAbierto> = [],
): string[] {
  const porN = new Map(mensajes.map(m => [m.n, m]));
  const { visible } = numeracion(plan);
  // La nota del comercial (un juicio) no se repite: ni su texto ni una paráfrasis salen del bot.
  const linea = (n: number, largo: number) => {
    const m = porN.get(n);
    return m && esNotaDelComercial(m.cuerpo, m.reenviado) ? `   ${visible(n)} (nota del comercial, no se guarda)` : `   ${visible(n)} «${recorte(m?.cuerpo ?? '', largo)}»`;
  };
  const grupos = gruposDelPlan(plan);
  const porDecidir = pendientes(plan);
  const largo = plan.mensajes.length <= MAX_CON_TEXTO ? 40 : 30;
  const faltan = clientesPorResolver(plan);
  // Los ejemplos usan un número que está en el resumen (error 8: «el 4» salía con un solo mensaje).
  const k = porDecidir.length > 0 ? visible(porDecidir[0].n) : Math.max(1, ...plan.mensajes.map(m => visible(m.n)));
  // PR B (2026-10-05): UNA pregunta, arriba; el bloque del resumen debajo; sin comandos en mayúsculas.
  const marcados = porDecidir.map(m => visible(m.n));
  const pregunta = porDecidir.length > 0 ? `¿Qué hago con ${marcados.length === 1 ? `el ${marcados[0]}` : `los ${rangos(marcados)}`} (⚠)?`
    : faltan.length > 0 ? textoFaltaCliente(faltan[0].destino)
    : '¿Lo cargo así?';
  // Un aviso corto («Corregido.», «No entendí «x».») va en la misma línea que la pregunta; uno largo, encima.
  const lineas: string[] = !aviso ? [pregunta] : aviso.length <= 60 ? [`${aviso} ${pregunta}`] : [aviso, pregunta];
  lineas.push(grupos.length === 0 ? 'No hay mensajes con un viaje asignado.' : `Entendí ${grupos.length} ${grupos.length === 1 ? 'viaje' : 'viajes'}:`);
  for (const g of grupos) {
    const n = g.mensajes.length;
    lineas.push(`${g.k}) ${nombreDestino(g.destino)} — ${n} ${n === 1 ? 'mensaje' : 'mensajes'}`);
    lineas.push(...g.mensajes.map(n2 => `${linea(n2, largo)}${plan.mensajes.find(x => x.n === n2)?.sospecha ? ' ⚠' : ''}`));
  }
  for (const g of grupos) {
    // Un cliente ya resuelto contra el directorio se muestra tal cual (arriba); el aviso de parecidos queda para
    // el que no pasó por él.
    if (g.destino.tipo !== 'nuevo' || g.destino.contacto) continue;
    const parecidos = viajesParecidos(g.destino.cliente, viajes);
    if (parecidos.length > 0) lineas.push(avisoParecidosDelGrupo(g.k, g.mensajes.map(visible), parecidos));
  }
  if (porDecidir.length > 0) {
    lineas.push(`⚠ Por decidir antes del sí: ${porDecidir.length} ${porDecidir.length === 1 ? 'mensaje' : 'mensajes'}`);
    lineas.push(...porDecidir.map(m => `${linea(m.n, 40)} (${m.motivo ?? 'sin viaje'})`));
  }
  const descartados = plan.mensajes.filter(m => m.descartado).map(m => m.n);
  if (descartados.length > 0) lineas.push(`Descartados: ${rangos(descartados.map(visible))}`);
  lineas.push(...plan.avisos);
  lineas.push(porDecidir.length > 0
    ? `No cargué nada todavía. Para cada uno: «dejar el ${k}» (o «dejar todos»), «el ${k} es de Luisa», «el ${k} es del 2», «el ${k} es nuevo Pedro» o «descartar el ${k}»; después, «sí».`
    : faltan.length > 0
    ? 'No cargué nada todavía: con eso te lo vuelvo a mostrar.'
    : `No cargué nada todavía. Responde «sí» para cargarlo, o corrige: «el ${k} es de Luisa», «descartar el ${k}». Con «descartar» no cargo nada.`);

  const empacar = (tope: number): string[] => {
    const partes: string[] = [];
    let actual = '';
    for (const l of lineas) {
      const candidato = actual ? `${actual}\n${l}` : l;
      if (candidato.length > tope && actual) {
        partes.push(actual);
        actual = l;
      } else {
        actual = candidato;
      }
    }
    if (actual) partes.push(actual);
    return partes;
  };
  const una = empacar(MAX_LARGO_RESUMEN);
  if (una.length === 1) return una;
  // Se reserva el espacio del prefijo «(k/n) » ANTES de partir: ninguna línea se corta.
  const partes = empacar(MAX_LARGO_RESUMEN - PREFIJO_PARTE);
  return partes.map((p, k) => `(${k + 1}/${partes.length}) ${p}`);
}

/** Lo más largo que puede ser «(k/n) » (hasta 99 partes). */
const PREFIJO_PARTE = '(99/99) '.length;

/** El resumen en un solo texto (las partes unidas). Para enviarlo, usar `partesResumenPlan`. */
export function textoResumenPlan(plan: PlanViajes, mensajes: ReadonlyArray<MensajeViaje>, aviso?: string, viajes: ReadonlyArray<ViajeAbierto> = []): string {
  return partesResumenPlan(plan, mensajes, aviso, viajes).join('\n');
}

// ── La respuesta al resumen ──────────────────────────────────────────────────

/**
 * ¿Es un «sí» sin peros, de los que cargan? Mismo normalizador que «¿Cambias a…?» (`leerSiNo`), en
 * modo estricto: «si claro», «sí, es así» sí; «ok», «👍», «ok pero falta uno» y «sí no» no (F11).
 */
export function esSi(texto: string): boolean {
  return leerSiNo(texto, { estricto: true }) === 'si';
}

/**
 * El «sí» que carga el resumen (y, en el de un viaje nuevo, crea el viaje) cuando lo propone el intérprete: la misma
 * lectura que ya tiene «¿Creo el cliente nuevo …?» (octavo control de Vera, bloqueante 1). Solo una afirmación
 * sola, con cortesía o con el verbo de cargar o de crear («sí, cárguelo por favor», «sí, adelante», «dale, créalo»).
 * Con una condición o un pedido de espera («sí, pero espera el pasaporte», «sí cuando me confirme»), con una
 * negación, una pregunta o algo que señala («sí, ese»): no es este «sí», y se vuelve a preguntar.
 */
export function esSiSinReserva(texto: string): boolean {
  const bruto = String(texto ?? '').trim();
  if (!bruto) return false;
  if (esSi(bruto)) return true;
  // «así está bien», «todo correcto»: dicen que el resumen está bien, no señalan nada.
  let t = ` ${normalizarNombre(bruto)} `;
  for (const f of RESUMEN_BIEN) t = t.split(` ${f} `).join(' ');
  t = t.replace(/\s+/g, ' ').trim();
  if (NIEGA_EN_CONFIRMACION.test(t) || /[?¿]/.test(bruto) || t.split(' ').some(w => DEICTICOS.has(w))) return false;
  // «cárgalo», «cárguelos», «cargar»: en el resumen, cargar es el verbo de alta.
  return esSiCompleto(t.split(' ').map(w => VERBOS_CARGAR.has(w) ? 'crea' : w).join(' '), null);
}
const RESUMEN_BIEN: ReadonlyArray<string> = ['todo esta bien', 'asi esta bien', 'asi esta perfecto', 'esta bien', 'esta perfecto', 'todo bien',
  'todo correcto', 'todo ok', 'asi es', 'asi esta', 'tal cual', 'quedo bien', 'asi quedo', 'como esta'];
const VERBOS_CARGAR: ReadonlySet<string> = new Set([...formasDeAlta('carg'), 'cargalos', 'cargalas', 'carguelos', 'carguelas', 'carguemoslos']);

export type Cambio = { ns: number[]; a: DestinoPlan | 'descartar' | 'dejar' };

/** Lo que el comercial dijo del cliente de un viaje nuevo al resumen. */
export interface CambioCliente {
  llave?: Llave;
  elegido?: FichaCliente;
  otraPersona?: boolean;
  /** «No es la misma persona»: el dueño de la llave que NO es. La llave se va con él. */
  descartar?: string;
  nombre?: string;
}

/**
 * Aplica al plan lo que el comercial dijo del cliente de un viaje nuevo (`clave`: la de su destino). El destino
 * queda SIN resolver: quien llama lo vuelve a resolver con el directorio (`resolverClientesDelPlan`).
 */
export function aplicarCambioCliente(plan: PlanViajes, clave: string, c: CambioCliente): PlanViajes {
  const mensajes = plan.mensajes.map(m => {
    const d = m.destino;
    if (!d || d.tipo !== 'nuevo' || claveDestino(d) !== clave) return { ...m };
    const cambiaQuien = !!(c.llave || c.otraPersona || c.descartar || c.nombre);
    const llave = c.llave ?? (c.descartar ? null : d.llave ?? null);
    const elegido = c.elegido ?? (cambiaQuien ? null : d.elegido ?? null);
    const descartadas = [...(d.descartadas ?? []), ...(c.descartar ? [c.descartar] : [])];
    const nuevo: DestinoNuevo = {
      tipo: 'nuevo', cliente: c.nombre ?? d.cliente,
      ...(tieneLlave(llave) ? { llave } : {}),
      ...(elegido ? { elegido } : {}),
      ...(c.otraPersona || d.otraPersona ? { otraPersona: true } : {}),
      ...(descartadas.length ? { descartadas } : {}),
    };
    return { ...m, destino: nuevo };
  });
  return { ...plan, mensajes };
}

export type RespuestaPlan =
  | { tipo: 'si' }
  | { tipo: 'cliente'; clave: string; cambio: CambioCliente }
  | { tipo: 'descartar_todo' }
  | { tipo: 'corregir'; cambios: Cambio[] }
  | { tipo: 'como_corregir' }
  | { tipo: 'no_entendida'; aviso?: string };

function leerNumeros(t: string): number[] {
  return [...t.matchAll(/\d+/g)].map(m => Number(m[0]));
}

/**
 * El destino de una corrección: «Luisa», «del 2», «T1 26 9», «nuevo Pedro Gómez», «descartar».
 * `nombre_en_duda`: «nuevo» con algo que no parece un nombre (`calificarNombreNuevo`).
 */
function destinoDeCorreccion(texto: string, plan: PlanViajes, viajes: ReadonlyArray<ViajeAbierto>): DestinoPlan | 'descartar' | 'nombre_en_duda' | null {
  const t = texto.trim().replace(/^(de|del|para|al|a)\s+/i, '').trim();
  const n = normalizarTexto(t);
  if (/^(descartar|descartalo|descartalos|ninguno|ninguna|nada|basura|no va|no van|fuera)$/.test(n)) return 'descartar';
  // «el 3 es de nuevo …»: la misma regla del nombre que la lista y el encabezado. Más largo que el tope no
  // se entiende; lo que no parece un nombre se pregunta (control de Vera, ND). Nunca queda en el borrador.
  const nuevo = leerNuevo(t);
  if (nuevo) {
    const c = calificarNombreNuevo(nuevo.cliente);
    if (c === 'largo') return null;
    if (c === 'duda') return 'nombre_en_duda';
    return { tipo: 'nuevo', cliente: nuevo.cliente };
  }
  const k = /^(?:viaje\s*)?(\d{1,2})$/.exec(n);
  if (k) {
    const g = gruposDelPlan(plan).find(x => x.k === Number(k[1]));
    return g ? g.destino : null;
  }
  const enPlan = gruposDelPlan(plan).map(g => g.destino);
  const nuevos = enPlan.filter((d): d is Extract<DestinoPlan, { tipo: 'nuevo' }> => d.tipo === 'nuevo');
  const palabras = palabrasDe(t).filter(w => !RELLENO.has(w));
  // Un viaje de ESTE resumen nombrado tal cual (cliente, nombre del negocio o código) gana sobre los demás.
  const tal = (d: DestinoPlan) => (palabras.length > 0 && palabras.every(w => palabrasDe(d.cliente).includes(w)))
    || (d.tipo === 'existente' && (nombreCompacto(d.nombre) === nombreCompacto(t) || (!!d.codigo && codigoCompacto(d.codigo) === codigoCompacto(t))));
  const delResumen = enPlan.filter(tal);
  if (delResumen.length === 1) return delResumen[0];
  const nuevoExacto = nuevos.filter(tal);
  const nuevoCerca = nuevos.filter(d => palabras.length > 0 && palabras.every(w => palabraDelNombre(w, d.cliente)));
  const r = resolverEncabezado(t, viajes);
  // Primero lo EXACTO: el NUEVO de este resumen, o un viaje por código, nombre del negocio o cliente
  // (prueba en vivo v2, N3: «el 3 es de Mateo Prueba5» chocaba con el viaje de «Mateo Prueba2», a un
  // error de distancia, y no se elegía ninguno). Sin uno exacto, una coincidencia aproximada única
  // («Lusia», «Gómez») también vale: el comercial ve el resumen otra vez antes del «sí».
  const unicos = (ds: DestinoPlan[]) => [...new Map(ds.map(d => [claveDestino(d), d])).values()];
  const exactos = unicos([...nuevoExacto, ...(r?.tipo === 'viaje' ? [destinoDeViaje(r.viaje)] : [])]);
  if (exactos.length === 1) return exactos[0];
  if (exactos.length > 1) return null;
  const cerca = unicos([...nuevoCerca, ...(r?.tipo === 'aproximado' ? [destinoDeViaje(r.viaje)] : [])]);
  return cerca.length === 1 ? cerca[0] : null;
}

/**
 * La respuesta del comercial al resumen. Solo un «sí» sin peros carga, y solo cuando no queda nada
 * por decidir. Las decisiones: «dejar el 4» / «dejar todos» (el sospechoso se queda en su caja),
 * «el 4 es de Luisa» / «mover el 4 a Luisa» (otro viaje), «descartar el 4» / «descartar los
 * pendientes». Si UNA parte no se entiende, no se aplica ninguna.
 */
export function interpretarRespuestaPlan(texto: string, plan: PlanViajes, viajes: ReadonlyArray<ViajeAbierto>): RespuestaPlan {
  const bruto = String(texto ?? '').trim();
  if (!bruto) return { tipo: 'no_entendida' };
  const porDecidir = pendientes(plan);
  const { visible, interno } = numeracion(plan);
  if (esSi(bruto)) {
    if (porDecidir.length > 0) {
      const ns = porDecidir.map(m => visible(m.n));
      return { tipo: 'no_entendida', aviso: 'Todavía no lo cargo.' };
    }
    // Un viaje nuevo al que le falta algo de su cliente (la llave, cuál es, si es el dueño de la llave): el «sí»
    // no lo crea (decisión de Mauricio del 2026-10-05: sin llave no se crea).
    const falta = clientesPorResolver(plan)[0];
    if (falta) return { tipo: 'no_entendida', aviso: 'Todavía no lo cargo.' };
    return { tipo: 'si' };
  }
  // La respuesta a lo que falta del cliente de un viaje nuevo: la llave escrita sola, cuál de los parecidos, o si
  // es el dueño de la llave. Va antes que «no» (corregir): con «¿Es la misma persona?» pendiente, «no» es «no es».
  const falta = clientesPorResolver(plan)[0];
  if (falta) {
    const clave = claveDestino(falta.destino);
    const llave = soloLlave(bruto);
    if (llave) return { tipo: 'cliente', clave, cambio: { llave } };
    if (falta.destino.falta === 'elegir') {
      const e = leerEleccionCliente(bruto, falta.destino.opciones ?? []);
      if (e) return { tipo: 'cliente', clave, cambio: e.tipo === 'ficha' ? { elegido: e.ficha } : { otraPersona: true } };
    }
    if (falta.destino.falta === 'confirmar' && falta.destino.opciones?.[0]) {
      const r = leerEsLaMisma(bruto);
      if (r === 'si') return { tipo: 'cliente', clave, cambio: { elegido: falta.destino.opciones[0] } };
      if (r === 'no') return { tipo: 'cliente', clave, cambio: { descartar: falta.destino.opciones[0].id } };
    }
    if (falta.destino.falta === 'nombre') {
      const nombre = esNombreNuevo(bruto);
      if (nombre) return { tipo: 'cliente', clave, cambio: { nombre } };
    }
  }
  const t = normalizarTexto(bruto).replace(/[.!¡¿?]+$/g, '').trim();
  if (/^(descartar|descartar todo|descartalo todo|descarta todo|borrar todo)$/.test(t)) return { tipo: 'descartar_todo' };
  if (/^(corregir|corrijo|no|cambiar)$/.test(t)) return { tipo: 'como_corregir' };
  if (/^dejar (todos|todo|los sospechosos|los demas)$/.test(t)) {
    const ns = porDecidir.filter(m => m.sospecha && m.destino && !m.varios).map(m => m.n);
    return ns.length > 0 ? { tipo: 'corregir', cambios: [{ ns, a: 'dejar' }] } : { tipo: 'no_entendida', aviso: 'No hay sospechosos para dejar.' };
  }
  if (/^descart\w* (los |el )?(sin asignar|sueltos|demas|resto|pendientes|sospechosos)$/.test(t)) {
    const ns = porDecidir.map(m => m.n);
    return ns.length > 0 ? { tipo: 'corregir', cambios: [{ ns, a: 'descartar' }] } : { tipo: 'no_entendida', aviso: 'No hay nada pendiente.' };
  }

  const existentes = new Set(plan.mensajes.map(m => m.n));
  const cambios: Cambio[] = [];
  // Los números que escribe el comercial son los del resumen; un número que no está queda negativo.
  const leer = (t: string) => leerNumeros(t).map(k => interno(k) ?? -k);
  const partes = bruto.replace(/^corregir\s*[:,-]?\s*/i, '').split(/\s*[;\n]\s*|\.\s+/).filter(Boolean);
  for (const parte of partes) {
    const p = parte.trim();
    const desc = /^(?:descartar|descarta|quitar|quita|sacar|saca|borrar|borra)\s+(?:el|la|los|las)?\s*([\d\s,ye]+)$/i.exec(p);
    if (desc) { cambios.push({ ns: leer(desc[1]), a: 'descartar' }); continue; }
    const dejar = /^(?:dejar|deja|dejalo|dejalos)\s+(?:el|la|los|las)?\s*([\d\s,ye]+)$/i.exec(p);
    if (dejar) { cambios.push({ ns: leer(dejar[1]), a: 'dejar' }); continue; }
    const mover = /^(?:mover|mueve|pasar|pasa)\s+(?:el|la|los|las)?\s*((?:\d+)(?:\s*(?:,|y|e)\s*(?:el\s+|la\s+)?\d+)*)\s+(?:a|al|para)\s+(.+)$/i.exec(p)
      ?? /^(?:el|la|los|las|mensaje|mensajes)?\s*((?:\d+)(?:\s*(?:,|y|e)\s*(?:el\s+|la\s+)?\d+)*)\s+(?:(?:es|son|va|van)\s+)?(.+)$/i.exec(p);
    if (!mover) return { tipo: 'no_entendida' };
    const a = destinoDeCorreccion(mover[2], plan, viajes);
    if (a === 'nombre_en_duda') {
      const k = leerNumeros(mover[1])[0] ?? 1;
      return { tipo: 'no_entendida', aviso: `Para un cliente nuevo escribe su nombre y apellido: «el ${k} es de nuevo Marta Gómez». Con «${recorte(mover[2], 30)}» no lo creo.` };
    }
    if (!a) return { tipo: 'no_entendida', aviso: `No sé a qué viaje te refieres con «${recorte(mover[2], 30)}».` };
    cambios.push({ ns: leer(mover[1]), a });
  }
  if (cambios.length === 0) return { tipo: 'no_entendida' };
  for (const c of cambios) {
    const fuera = c.ns.filter(n => !existentes.has(n));
    if (c.ns.length === 0 || fuera.length > 0) return { tipo: 'no_entendida', aviso: `No hay mensaje ${fuera.map(n => (n < 0 ? -n : visible(n))).join(', ')} en el resumen.` };
    const varios = c.ns.filter(n => plan.mensajes.find(m => m.n === n)?.varios);
    if (c.a !== 'descartar' && varios.length > 0) {
      return { tipo: 'no_entendida', aviso: `El ${varios.map(visible).join(', ')} habla de dos viajes: no lo cargo entero en uno. Descártalo y escribe el dato en la ficha de cada viaje.` };
    }
    const sinCaja = c.ns.filter(n => !plan.mensajes.find(m => m.n === n)?.destino);
    if (c.a === 'dejar' && sinCaja.length > 0) return { tipo: 'no_entendida', aviso: `El ${sinCaja.map(visible).join(', ')} no tiene caja: dime a qué viaje va o descártalo.` };
  }
  return { tipo: 'corregir', cambios };
}

/** Aplica las decisiones: el comercial manda. */
export function aplicarCambios(plan: PlanViajes, cambios: ReadonlyArray<Cambio>): PlanViajes {
  const mensajes = plan.mensajes.map(m => ({ ...m }));
  for (const c of cambios) {
    for (const n of c.ns) {
      const m = mensajes.find(x => x.n === n);
      if (!m) continue;
      if (c.a === 'descartar') Object.assign(m, { destino: null, por: 'comercial', descartado: true, sospecha: false });
      else if (c.a === 'dejar') Object.assign(m, { por: 'comercial', sospecha: false, motivo: undefined });
      else Object.assign(m, { destino: c.a, por: 'comercial', descartado: false, sospecha: false, motivo: undefined });
    }
  }
  return { ...plan, mensajes, avisos: [] };
}

/** Cómo se decide, cuando la respuesta fue «corregir» a secas. */
export const TEXTO_COMO_CORREGIR = 'Dime qué corrijo: «dejar el 4» (o «dejar todos»), «el 4 es de Luisa» o «el 4 es del 2» para moverlo, «el 6 es nuevo Pedro», o «descartar el 6».';
