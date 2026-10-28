// ============================================================
// Funciones — los tres textos que salen de la ficha en ONE (P11, §1.8 del diseño de la etapa 2). La LÓGICA.
// ------------------------------------------------------------
//   a) generarOferta:          el post de Instagram, con TODAS las funciones a la venta. Límite 2.200 caracteres.
//   b) generarMensajeDirecto:  la misma oferta por mensaje directo de Instagram, SIN la intro y SIN la lista de
//                              funciones (23-oct): título, gancho, qué incluye, precio, y nombra la campaña y ofrece
//                              los horarios aparte. Límite 1.000 BYTES UTF-8 (tildes y ñ ocupan 2, emojis 4).
//   c) generarBienvenida:      la bienvenida al grupo de WhatsApp de UNA función.
// QUÉ dicen vive en `textos-plantilla.ts`; aquí se resuelven los valores y las reglas:
//   · Toda fecha y hora sale de la función (día, hora, llegada −10 min, inicio +10 min) o de su preventa (fecha de
//     fin). Nada se copia de otro texto: los mensajes de hoy traían fechas de otra función.
//   · El precio sale de la tarifa que resolvió la base (`funcion_tarifa`, la misma del asistente y del apartado): en
//     preventa vigente, el de preventa con su fecha de fin y el regular como contexto; vencida, el regular.
//   · Los textos libres de la ficha y del lugar van TAL CUAL (con sus emojis). Un campo vacío sale «[FALTA: campo]», va
//     en `faltantes` y el texto NO se deja copiar.
//   · El pago va solo por el link de Bold: si un texto libre menciona Nequi o Daviplata, sale un AVISO que NO bloquea
//     copiar (23-oct); el equipo decide.
//   · Pasado el límite, NO se corta: se dice cuánto sobra y qué partes se podrían recortar, y no se deja copiar.
//   · El plazo del saldo («paga el saldo N días antes») sale de la campaña (`dias_saldo_antes`).
// Puras: sin red ni reloj (la hora de «a la venta» llega como `ahoraMs`). Las usan el panel (Next) y, cuando se
// conecte, el asistente.
// ============================================================

import { diaTexto, fechaCortaTexto, horaTexto } from './fecha-texto.ts';
import { plantillaBienvenida, plantillaOferta, TEXTO_OFERTA } from './textos-plantilla.ts';
import type { TarifaPublica } from './tipos.ts';

export const LIMITE_POST_CARACTERES = 2200;
export const LIMITE_DIRECTO_BYTES = 1000;

/** La ficha de la experiencia (los campos de P11 que usan los textos). */
export interface FichaTextos {
  titulo_oferta: string | null;
  frase_gancho: string | null;
  intro: string | null;
  que_incluye: string[] | null;
  emojis_tema: string | null;
  saludo_grupo: string | null;
  relato_grupo: string | null;
  /** La puerta se cierra al iniciar (películas, 26-oct). Solo `true` la avisa: sin marcar o ausente, no sale. */
  puerta_cerrada?: boolean | null;
}

/** Los datos del lugar, una vez por workspace (`funcion_negocio`). */
export interface NegocioTextos {
  direccion: string | null;
  piso: string | null;
  recepcion: string | null;
  parqueadero: string | null;
  firma: string | null;
}

/** Una función con la tarifa que resolvió la base. */
export interface FuncionTextos {
  inicia_at: string;
  estado: 'activa' | 'pausada' | 'cancelada';
  /** Sin cupo para nadie (ocupadas ≥ capacidad): no se ofrece. */
  llena: boolean;
  tarifa: TarifaPublica;
}

export interface TextoGenerado {
  texto: string;
  /** Los campos que faltan, en el orden en que aparecen. Con uno solo, no se deja copiar. */
  faltantes: string[];
  /** Puntos de código (un emoji = 1), como se midió el mensaje real (834 caracteres). */
  caracteres: number;
  bytes: number;
  limite: { unidad: 'caracteres' | 'bytes'; maximo: number } | null;
  /** Cuánto pasa del límite, en su unidad; 0 = cabe. */
  sobra: number;
  /** Si sobra: las partes que se podrían recortar, de la más larga a la más corta, con su medida. */
  recortaria: Array<{ parte: string; medida: number }>;
  copiable: boolean;
  /** Por qué no se deja copiar, en llano; `null` si se puede. */
  motivo: string | null;
  /** Lo que conviene revisar pero NO bloquea copiar (Nequi o Daviplata en un texto libre). */
  avisos: string[];
}

/** Lo de la campaña que usan los textos de la oferta. */
export interface CampanaTextos {
  /** Días antes de la función en que se paga el saldo (≥ 1; la base lo llena con 1). */
  dias_saldo_antes: number;
}

const BYTES = new TextEncoder();
export const contarCaracteres = (s: string) => Array.from(s).length;
export const contarBytes = (s: string) => BYTES.encode(s).length;

/** «$170.000»: pesos enteros con punto de miles, sin depender del ICU del proceso. */
export function pesosTexto(n: number): string {
  return `$${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

/** El pago va solo por el link de Bold (P11): si un texto libre nombra otro medio, se avisa (no bloquea, 23-oct). */
const OTRO_PAGO = /nequi|davi\s*plata/i;
export const AVISO_OTRO_PAGO =
  'El texto menciona Nequi o Daviplata: el pago va por el link de Bold. Revísalo en la ficha o en el lugar antes de publicar.';
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const MINUTO = 60_000;

/** Las funciones que se ofrecen: activas, futuras y con cupo, en orden de fecha. */
export function funcionesALaVenta(funciones: FuncionTextos[], ahoraMs: number): FuncionTextos[] {
  return funciones
    .filter((f) => f.estado === 'activa' && !f.llena && Date.parse(f.inicia_at) > ahoraMs)
    .sort((a, b) => Date.parse(a.inicia_at) - Date.parse(b.inicia_at));
}

/** Junta los «[FALTA: …]» de un texto mientras se arma. */
function faltas() {
  const lista: string[] = [];
  const valor = (v: string | null | undefined, campo: string): string => {
    const t = v?.trim();
    if (t) return t;
    if (!lista.includes(campo)) lista.push(campo);
    return `[FALTA: ${campo}]`;
  };
  const precio = (n: number | null | undefined, campo: string): string => (typeof n === 'number' ? pesosTexto(n) : valor(null, campo));
  return { lista, valor, precio };
}

function medir(
  texto: string,
  faltantes: string[],
  limite: TextoGenerado['limite'],
  partes: Array<{ parte: string; texto: string }>,
): TextoGenerado {
  const caracteres = contarCaracteres(texto);
  const bytes = contarBytes(texto);
  const medida = (s: string) => (limite?.unidad === 'bytes' ? contarBytes(s) : contarCaracteres(s));
  const total = limite?.unidad === 'bytes' ? bytes : caracteres;
  const sobra = limite ? Math.max(0, total - limite.maximo) : 0;
  const recortaria = sobra > 0
    ? partes.filter((p) => p.texto).map((p) => ({ parte: p.parte, medida: medida(p.texto) })).sort((a, b) => b.medida - a.medida)
    : [];
  const motivos = [
    faltantes.length > 0 && `Falta en la ficha: ${faltantes.join(', ')}.`,
    sobra > 0 && limite && `Sobran ${sobra} ${limite.unidad} (el límite es ${pesosTexto(limite.maximo).slice(1)}). Se podría recortar: ${recortaria.map((r) => `${r.parte} (${r.medida})`).join(', ')}.`,
  ].filter(Boolean) as string[];
  return {
    texto,
    faltantes,
    caracteres,
    bytes,
    limite,
    sobra,
    recortaria,
    copiable: motivos.length === 0,
    motivo: motivos.length ? motivos.join(' ') : null,
    avisos: OTRO_PAGO.test(texto) ? [AVISO_OTRO_PAGO] : [],
  };
}

/** Las partes comunes de la oferta (post y directo) que salen de la ficha y del lugar. El directo va sin intro. */
function partesComunes(ficha: FichaTextos, negocio: NegocioTextos, f: ReturnType<typeof faltas>, conIntro: boolean) {
  const incluye = (ficha.que_incluye ?? []).map((x) => x.trim()).filter(Boolean);
  const titulo = f.valor(ficha.titulo_oferta, 'título de la oferta');
  const gancho = f.valor(ficha.frase_gancho, 'frase gancho');
  return {
    titulo,
    gancho,
    intro: conIntro ? f.valor(ficha.intro, 'intro') : null,
    incluye: incluye.length ? incluye : [f.valor(null, 'qué incluye')],
    // Las cuatro de arriba primero: así salen los faltantes en el orden del texto.
    _direccion: () => f.valor(negocio.direccion, 'dirección'),
    _emojis: () => f.valor(ficha.emojis_tema, 'emojis del tema'),
  };
}

/** El precio regular de una función: en preventa vigente es el «completo» de contexto; si no, el que rige. */
const regularDe = (t: TarifaPublica) => (t.tarifa === 'preventa' ? t.precio_completo_persona : t.precio_persona);
const unicos = <T,>(xs: T[]) => [...new Set(xs)];

/** El plazo del saldo de la campaña: entero de 0 a 30 (0 = hasta que empieza). Si no llega (no debería: la base lo llena con 1), se pide. */
function plazoSaldo(campana: CampanaTextos, f: ReturnType<typeof faltas>): string | 0 {
  const d = campana.dias_saldo_antes;
  if (d === 0) return 0;
  return Number.isInteger(d) && d >= 1 ? TEXTO_OFERTA.plazoSaldo(d) : f.valor(null, 'días antes para el saldo');
}

/** El abono común de las funciones (o `null` si ninguna se aparta con abono), con el plazo del saldo de la campaña. */
function lineaAbono(vendibles: FuncionTextos[], campana: CampanaTextos, f: ReturnType<typeof faltas>): string | null {
  const abonos = unicos(vendibles.map((x) => x.tarifa.abono_persona));
  if (abonos.every((a) => a === null)) return null;
  const plazo = plazoSaldo(campana, f);
  if (plazo === 0) {
    // Plazo 0 (28-oct): link hasta la hora de inicio; ya en la función, en el lugar.
    return abonos.length === 1 ? TEXTO_OFERTA.abonoHastaInicio(pesosTexto(abonos[0]!)) : TEXTO_OFERTA.abonoVariosHastaInicio;
  }
  return abonos.length === 1 ? TEXTO_OFERTA.abono(pesosTexto(abonos[0]!), plazo) : TEXTO_OFERTA.abonoVarios(plazo);
}

/** a) El post de Instagram de la campaña: todas las funciones a la venta, con día y hora completos. */
export function generarOferta(o: {
  ficha: FichaTextos;
  negocio: NegocioTextos;
  campana: CampanaTextos;
  funciones: FuncionTextos[];
  ahoraMs: number;
}): TextoGenerado {
  const f = faltas();
  const c = partesComunes(o.ficha, o.negocio, f, true);
  const vendibles = funcionesALaVenta(o.funciones, o.ahoraMs);
  const regulares = unicos(vendibles.map((x) => regularDe(x.tarifa)));
  const unRegular = regulares.length === 1;
  const lineas: string[] = [];
  for (const x of vendibles) {
    lineas.push(`${mayuscula(diaTexto(x.inicia_at))}, ${horaTexto(x.inicia_at)}`);
    if (x.tarifa.tarifa === 'preventa') {
      lineas.push(TEXTO_OFERTA.preventa(f.precio(x.tarifa.precio_persona, 'precio de preventa'), x.tarifa.preventa_hasta ? fechaCortaTexto(x.tarifa.preventa_hasta) : null));
    }
    if (!unRegular) lineas.push(TEXTO_OFERTA.regular(f.precio(regularDe(x.tarifa), 'precio regular')));
  }
  if (vendibles.length === 0) lineas.push(f.valor(null, 'funciones a la venta'));
  const precios = unRegular ? [TEXTO_OFERTA.regular(f.precio(regulares[0], 'precio regular'))] : [];
  const abono = lineaAbono(vendibles, o.campana, f);
  const direccion = c._direccion();
  const emojis = c._emojis();
  const agenda = lineas.join('\n');
  const texto = plantillaOferta({
    titulo: c.titulo, gancho: c.gancho, intro: c.intro, incluye: c.incluye,
    agenda: { tipo: 'funciones', lineas }, precios, abono, direccion, emojis,
  });
  return medir(texto, f.lista, { unidad: 'caracteres', maximo: LIMITE_POST_CARACTERES }, [
    { parte: 'la intro', texto: (o.ficha.intro ?? '').trim() },
    { parte: `la lista de funciones (${vendibles.length})`, texto: agenda },
    { parte: 'qué incluye', texto: c.incluye.join('\n') },
    { parte: 'la frase gancho', texto: (o.ficha.frase_gancho ?? '').trim() },
    { parte: 'el título', texto: (o.ficha.titulo_oferta ?? '').trim() },
  ]);
}

/**
 * b) La oferta por mensaje directo de Instagram: sin la intro y sin la lista de funciones (nombra la campaña y ofrece
 * los horarios aparte), para quedar con margen bajo los 1.000 bytes (23-oct). Los precios van si son los mismos en todas las funciones a la venta; si cambian, se dice que van con cada
 * horario: ningún número que no sea de todas.
 */
export function generarMensajeDirecto(o: {
  ficha: FichaTextos;
  negocio: NegocioTextos;
  campana: CampanaTextos & { nombre: string };
  funciones: FuncionTextos[];
  ahoraMs: number;
}): TextoGenerado {
  const f = faltas();
  const c = partesComunes(o.ficha, o.negocio, f, false);
  const vendibles = funcionesALaVenta(o.funciones, o.ahoraMs);
  const precios: string[] = [];
  if (vendibles.length === 0) {
    precios.push(f.valor(null, 'funciones a la venta'));
  } else {
    const preventas = vendibles.filter((x) => x.tarifa.tarifa === 'preventa');
    const grupos = unicos(preventas.map((x) => `${x.tarifa.precio_persona}|${x.tarifa.preventa_hasta}`));
    if (grupos.length === 1) {
      const t = preventas[0].tarifa;
      const precio = f.precio(t.precio_persona, 'precio de preventa');
      const hasta = t.preventa_hasta ? fechaCortaTexto(t.preventa_hasta) : null;
      precios.push(preventas.length === vendibles.length ? TEXTO_OFERTA.preventa(precio, hasta) : TEXTO_OFERTA.preventaAlgunas(precio, hasta));
    } else if (grupos.length > 1) {
      precios.push(TEXTO_OFERTA.preventaVarias);
    }
    const regulares = unicos(vendibles.map((x) => regularDe(x.tarifa)));
    precios.push(regulares.length === 1 ? TEXTO_OFERTA.regular(f.precio(regulares[0], 'precio regular')) : TEXTO_OFERTA.regularVarios);
  }
  const abono = lineaAbono(vendibles, o.campana, f);
  const direccion = c._direccion();
  const emojis = c._emojis();
  const campana = f.valor(o.campana.nombre, 'nombre de la campaña');
  const texto = plantillaOferta({
    titulo: c.titulo, gancho: c.gancho, intro: null, incluye: c.incluye,
    agenda: { tipo: 'campana', campana }, precios, abono, direccion, emojis,
  });
  return medir(texto, f.lista, { unidad: 'bytes', maximo: LIMITE_DIRECTO_BYTES }, [
    { parte: 'qué incluye', texto: c.incluye.join('\n') },
    { parte: 'la frase gancho', texto: (o.ficha.frase_gancho ?? '').trim() },
    { parte: 'el título', texto: (o.ficha.titulo_oferta ?? '').trim() },
  ]);
}

/**
 * c) La bienvenida al grupo de WhatsApp de una función: llegada 10 minutos antes e inicio 10 minutos después (fijo en
 * todas). El aviso de la puerta cerrada solo si la experiencia lo tiene marcado (26-oct).
 */
export function generarBienvenida(o: { ficha: FichaTextos; negocio: NegocioTextos; funcion: { inicia_at: string } }): TextoGenerado {
  const f = faltas();
  const inicio = Date.parse(o.funcion.inicia_at);
  const iso = (ms: number) => new Date(ms).toISOString();
  const texto = plantillaBienvenida({
    saludo: f.valor(o.ficha.saludo_grupo, 'saludo del grupo'),
    dia: mayuscula(diaTexto(o.funcion.inicia_at)),
    hora: horaTexto(o.funcion.inicia_at),
    llegada: horaTexto(iso(inicio - 10 * MINUTO)),
    inicio: horaTexto(iso(inicio + 10 * MINUTO)),
    direccion: f.valor(o.negocio.direccion, 'dirección'),
    piso: f.valor(o.negocio.piso, 'piso'),
    recepcion: f.valor(o.negocio.recepcion, 'recepción'),
    parqueadero: f.valor(o.negocio.parqueadero, 'parqueadero'),
    relato: f.valor(o.ficha.relato_grupo, 'relato de cierre del grupo'),
    puertaCerrada: o.ficha.puerta_cerrada === true,
    firma: f.valor(o.negocio.firma, 'firma'),
  });
  return medir(texto, f.lista, null, []);
}
