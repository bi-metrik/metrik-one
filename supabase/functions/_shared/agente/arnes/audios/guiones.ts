// ============================================================
// Arnés de audios — los 20 guiones inventados (spec 2026-10-26, §4.6)
// ------------------------------------------------------------
// TODO ES INVENTADO: personas, empresas, obras, clientas, cédulas y cifras. Ninguno sale de la base ni de un cliente.
// Reparto: 7 de Imperviun (obras), 7 de Laura (salón) y 6 de Sabor (experiencias, habla un cliente).
//
// Cada guion trae:
//   · `texto`, con las palabras que cuentan marcadas: `{n:…}` nombre (persona, cliente, obra, servicio, experiencia),
//     `{c:…}` cifra, `{k:…}` código. `{tipo:como se escribe|como se dice}` cuando la voz debe leerlo distinto («I1 26 5»
//     se dice «i uno veintiséis cinco»). La referencia es el texto con «como se escribe»; la voz lee «como se dice».
//   · las condiciones de la grabación (ruido de calle, de obra o de salón; habla rápido; la nota se corta al final);
//   · los distractores: nombres que SÍ están en la base de su workspace y NO se dicen (los parecidos a propósito), para
//     medir la inserción falsa;
//   · la voz y el estilo para la voz sintética provisional (`generar.ts`).
// La base de cada workspace (`BASES`) es la «base» inventada que el constructor de pistas convierte en el bloque del
// prompt, con la misma función de producción (`textoPistas`).
// ============================================================

import { textoPistas } from '../../pistas.ts';
import type { BasePistas } from '../../pistas.ts';
import type { Marca, TipoMarca } from './metricas.ts';

export type Workspace = 'imperviun' | 'laura' | 'sabor';
export type Ruido = 'calle' | 'obra' | 'salon';

export interface BaseWorkspace {
  /** `one`: habla el equipo (ONE y la bandeja). `publico`: habla un cliente (Chatwoot): sin clientes ni códigos en las pistas. */
  canal: 'one' | 'publico';
  base: BasePistas;
  /** Lo que aportarían las funciones del rol por su gancho (portafolio de Laura, experiencias vigentes de Sabor). */
  extras: string[];
}

export interface Guion {
  id: string;
  workspace: Workspace;
  /** Quién habla, para quien grabe la nota real. */
  quien: string;
  texto: string;
  condiciones: {
    ruido: Ruido | null;
    rapido: boolean;
    /** Lo que se alcanza a empezar a decir y se corta (no entra a la referencia). `null` = la nota termina completa. */
    corte: string | null;
  };
  distractores: string[];
  voz: string;
  estilo: string;
}

export const BASES: Record<Workspace, BaseWorkspace> = {
  imperviun: {
    canal: 'one',
    base: {
      equipo: ['Gloria Benavides', 'Hernán Quintero'],
      colaboradores: ['Wilmer Ospina', 'Wilson Ospina', 'Yeison Cárdenas', 'Didier Mosquera', 'Jhon Fredy Arango'],
      negocios: [
        { codigo: 'I1 26 5', nombre: 'Tanque Bosque Verde - impermeabilización interna', cliente: 'Inversiones Iguazú' },
        { codigo: 'I1 26 3', nombre: 'Cubierta Alameda', cliente: 'Inversiones Iguazú' },
        { codigo: 'R1 26 2', nombre: 'Terraza Mirador del Parque', cliente: 'Constructora Roble Alto' },
        { codigo: 'S1 26 1', nombre: 'Fachada Santa Bárbara', cliente: 'Santa Bárbara PH' },
        { codigo: 'G1 25 4', nombre: 'Juntas Coliseo (fase 2)', cliente: 'Gimnasio Campestre Los Cerezos' },
        { codigo: 'B1 26 1', nombre: 'Sótano Balcones de Toledo', cliente: 'Balcones de Toledo' },
      ],
    },
    extras: [],
  },
  laura: {
    canal: 'one',
    base: {
      equipo: ['Andrea Villegas'],
      colaboradores: ['Yuliana Mejía', 'Karen Sofía Duque'],
      negocios: [
        { codigo: 'P 26 41', nombre: 'Microblading', cliente: 'Yeimy Castaño' },
        { codigo: 'P 26 44', nombre: 'Lifting de pestañas', cliente: 'Marcela Giraldo' },
        { codigo: 'P 26 38', nombre: 'Microblading en cuotas', cliente: 'Luz Dary Henao' },
        { codigo: 'P 26 36', nombre: 'Laminado de cejas', cliente: 'Ximena Toro' },
        { codigo: 'P 26 45', nombre: 'Depilación con hilo', cliente: 'Valentina Roa' },
        { codigo: 'P 26 29', nombre: 'Uñas en acrílico', cliente: 'Maryory Salazar' },
        { codigo: 'P 26 47', nombre: 'Diseño de cejas', cliente: 'Marcia Londoño' },
        { codigo: 'P 26 33', nombre: 'Lifting de pestañas', cliente: 'Yesenia Castillo' },
      ],
    },
    extras: ['Diseño de cejas', 'Lifting de pestañas', 'Microblading', 'Laminado de cejas', 'Depilación con hilo', 'Uñas en acrílico', 'Henna'],
  },
  sabor: {
    canal: 'publico',
    base: {
      equipo: ['Camila Arboleda', 'Sebastián Ochoa'],
      colaboradores: [],
      // En público el constructor no usa los negocios (`incluirClientes: false`); se dejan para probar que no se cuelan.
      negocios: [
        { codigo: 'R1 26 12', nombre: 'Noche de Ramen', cliente: 'Rodrigo Valencia' },
        { codigo: 'A1 26 3', nombre: 'Cata de cacao', cliente: 'Ana María Bedoya' },
      ],
    },
    extras: ['Noche de Ramen', 'Cata de cacao amazónico', 'Brunch de mercado', 'Taller de arepas', 'Cata de café de origen'],
  },
};

export const GUIONES: Guion[] = [
  // ── Imperviun (7): obras con nombre corto, rubros, cifras con «millones» y «mil», factura, operario que dice la obra ──
  {
    id: 'imp-01', workspace: 'imperviun', quien: 'el residente de obra',
    texto: 'Gasto de la obra {n:Alameda}: compré dos canecas de impermeabilizante en {n:Construmax}, {c:un millón trescientos cincuenta mil} pesos, factura {k:FE 4587|efe e cuarenta y cinco ochenta y siete}.',
    condiciones: { ruido: 'obra', rapido: false, corte: null },
    distractores: ['Bosque Verde', 'Hernán Quintero'], voz: 'Algenib', estilo: 'Hombre colombiano de unos 45 años, maestro de obra, habla claro pero informal',
  },
  {
    id: 'imp-02', workspace: 'imperviun', quien: 'un operario',
    texto: 'Buenos días, aquí {n:Wilmer}, ya llegué a la obra {n:Mirador del Parque} con {n:Yeison}, arrancamos con la terraza.',
    condiciones: { ruido: 'calle', rapido: false, corte: null },
    distractores: ['Wilson Ospina', 'Didier Mosquera'], voz: 'Fenrir', estilo: 'Operario joven colombiano, voz animada, hablando en la calle',
  },
  {
    id: 'imp-03', workspace: 'imperviun', quien: 'la dueña',
    texto: 'Registra un anticipo de {n:Inversiones Iguazú} para el negocio {k:I1 26 5|i uno veintiséis cinco}, son {c:ocho millones} de pesos, entró por transferencia.',
    condiciones: { ruido: null, rapido: true, corte: null },
    distractores: ['Constructora Roble Alto', 'Gimnasio Campestre Los Cerezos'], voz: 'Kore', estilo: 'Mujer colombiana de negocios, habla rápido y segura',
  },
  {
    id: 'imp-04', workspace: 'imperviun', quien: 'el residente de obra',
    texto: 'En {n:Santa Bárbara} se fueron {c:cuatrocientos ochenta mil} en manto asfáltico y {c:ciento veinte mil} de transporte, cárgalo al {k:S1 26 1|ese uno veintiséis uno}.',
    condiciones: { ruido: 'calle', rapido: false, corte: null },
    distractores: ['Balcones de Toledo', 'Alameda'], voz: 'Orus', estilo: 'Hombre colombiano, tono cansado, al final de la jornada',
  },
  {
    id: 'imp-05', workspace: 'imperviun', quien: 'la dueña',
    texto: 'Pago de la semana a {n:Didier Mosquera}, {c:seiscientos cincuenta mil}, por el trabajo en el {n:Coliseo}.',
    condiciones: { ruido: 'obra', rapido: false, corte: null },
    distractores: ['Wilmer Ospina', 'Yeison Cárdenas'], voz: 'Leda', estilo: 'Mujer colombiana, habla pausado, desde una obra ruidosa',
  },
  {
    id: 'imp-06', workspace: 'imperviun', quien: 'el residente de obra',
    texto: '{n:Gloria}, la obra de {n:Bosque Verde} va en el {c:setenta} por ciento, faltan las juntas del tanque',
    condiciones: { ruido: 'calle', rapido: false, corte: 'y mañana llegan los' },
    distractores: ['Hernán Quintero', 'Tanque Bosque Verde', 'Inversiones Iguazú'], voz: 'Charon', estilo: 'Hombre colombiano, mensaje de voz rápido que se corta',
  },
  {
    id: 'imp-07', workspace: 'imperviun', quien: 'un operario que no está en la base',
    texto: 'Habla {n:Jhon Fredy}, hoy estoy en {n:Alameda} con el maestro {n:Efraín}, gasté {c:treinta y cinco mil} en almuerzo.',
    condiciones: { ruido: 'obra', rapido: true, corte: null },
    distractores: ['Hernán Quintero', 'Wilson Ospina'], voz: 'Puck', estilo: 'Operario colombiano, habla rápido y comiéndose letras, con ruido de máquinas',
  },

  // ── Laura (7): nombre de la clienta, servicio del portafolio, «me pagó 40», cuotas ──
  {
    id: 'lau-01', workspace: 'laura', quien: 'la dueña del salón',
    texto: 'Le hice {n:microblading} a {n:Yeimy Castaño}, eran {c:trescientos cincuenta mil}, me pagó {c:200} y queda debiendo el resto.',
    condiciones: { ruido: 'salon', rapido: false, corte: null },
    distractores: ['Yesenia Castillo', 'Marcela Giraldo'], voz: 'Aoede', estilo: 'Mujer colombiana de Medellín, tono cálido, en un salón de belleza',
  },
  {
    id: 'lau-02', workspace: 'laura', quien: 'la dueña del salón',
    texto: '{n:Marcela} vino a {n:lifting de pestañas}, {c:sesenta mil}, me pagó {c:40}.',
    condiciones: { ruido: 'salon', rapido: true, corte: null },
    distractores: ['Marcia Londoño', 'Maryory Salazar'], voz: 'Despina', estilo: 'Mujer colombiana, habla rápido entre una clienta y otra',
  },
  {
    id: 'lau-03', workspace: 'laura', quien: 'la dueña del salón',
    texto: '{n:Luz Dary} va a pagar el {n:microblading} en {c:6} cuotas de {c:70 mil}, hoy pagó la primera.',
    condiciones: { ruido: null, rapido: false, corte: null },
    distractores: ['Yeimy Castaño', 'Valentina Roa'], voz: 'Callirrhoe', estilo: 'Mujer colombiana, tono tranquilo',
  },
  {
    id: 'lau-04', workspace: 'laura', quien: 'la manicurista',
    texto: 'Abono de {n:Ximena Toro} a la cuota {c:3}, {c:cincuenta mil} por Nequi.',
    condiciones: { ruido: 'calle', rapido: false, corte: null },
    distractores: ['Yesenia Castillo', 'Karen Sofía Duque'], voz: 'Leda', estilo: 'Mujer joven colombiana, caminando por la calle',
  },
  {
    id: 'lau-05', workspace: 'laura', quien: 'la dueña del salón, con una clienta nueva que no está en la base',
    texto: 'Llegó una clienta nueva, {n:Marlory Pineda}, se hizo {n:laminado de cejas}, {c:ochenta y cinco mil}, pagó completo.',
    condiciones: { ruido: 'salon', rapido: false, corte: null },
    distractores: ['Maryory Salazar', 'Marcela Giraldo', 'Marcia Londoño'], voz: 'Sulafat', estilo: 'Mujer colombiana, tono amable, con secador de pelo de fondo',
  },
  {
    id: 'lau-06', workspace: 'laura', quien: 'la dueña del salón',
    texto: '{n:Yuliana} compró tintes y pigmentos donde {n:Hernando}, {c:ciento diez mil}, sale de la caja del salón.',
    condiciones: { ruido: 'salon', rapido: true, corte: null },
    distractores: ['Karen Sofía Duque', 'Andrea Villegas'], voz: 'Kore', estilo: 'Mujer colombiana, habla rápido y con prisa',
  },
  {
    id: 'lau-07', workspace: 'laura', quien: 'la dueña del salón',
    texto: '{n:Valentina Roa} no vino a la cita del sábado, le corro la de {n:depilación con hilo} para el martes',
    condiciones: { ruido: null, rapido: false, corte: 'y le cobro la' },
    distractores: ['Ximena Toro', 'Marcela Giraldo'], voz: 'Aoede', estilo: 'Mujer colombiana, mensaje que se corta al final',
  },

  // ── Sabor (6): nombre de la experiencia, «el sábado a las 5», número de personas, una cédula dictada (habla un cliente) ──
  {
    id: 'sab-01', workspace: 'sabor', quien: 'un cliente',
    texto: 'Hola, quiero reservar la {n:Noche de Ramen} para el sábado a las {c:5}, somos {c:cuatro} personas.',
    condiciones: { ruido: 'calle', rapido: false, corte: null },
    distractores: ['Cata de café de origen', 'Taller de arepas'], voz: 'Achird', estilo: 'Hombre joven colombiano, amable, en la calle',
  },
  {
    id: 'sab-02', workspace: 'sabor', quien: 'una clienta',
    texto: 'Mi nombre es {n:Ana Lucía Bermúdez}, cédula {c:uno cero dos tres cuatro cinco seis siete ocho nueve}.',
    condiciones: { ruido: null, rapido: false, corte: null },
    distractores: ['Camila Arboleda', 'Ana María Bedoya'], voz: 'Vindemiatrix', estilo: 'Mujer colombiana, dicta despacio número por número',
  },
  {
    id: 'sab-03', workspace: 'sabor', quien: 'un cliente',
    texto: 'Buenas, la {n:cata de cacao amazónico} del viernes, ¿todavía hay cupo para {c:seis} personas?',
    condiciones: { ruido: 'salon', rapido: false, corte: null },
    distractores: ['Cata de café de origen', 'Brunch de mercado'], voz: 'Gacrux', estilo: 'Hombre colombiano de unos 50 años, en un restaurante lleno',
  },
  {
    id: 'sab-04', workspace: 'sabor', quien: 'un cliente',
    texto: 'Somos dos parejas, o sea {c:cuatro}, para el {n:brunch de mercado} del domingo a las {c:10}, a nombre de {n:Felipe Cuartas}.',
    condiciones: { ruido: null, rapido: true, corte: null },
    distractores: ['Sebastián Ochoa', 'Noche de Ramen'], voz: 'Zubenelgenubi', estilo: 'Hombre colombiano, habla muy rápido y casual',
  },
  {
    id: 'sab-05', workspace: 'sabor', quien: 'una clienta',
    texto: 'Va a nombre de {n:Yolanda Grisales}, la cédula es {c:cincuenta y dos, ochocientos setenta y tres, cuatrocientos diez}.',
    condiciones: { ruido: 'calle', rapido: false, corte: null },
    distractores: ['Camila Arboleda', 'Ana María Bedoya'], voz: 'Sadachbia', estilo: 'Mujer colombiana, dicta la cédula por grupos, con tráfico de fondo',
  },
  {
    id: 'sab-06', workspace: 'sabor', quien: 'una clienta',
    texto: 'Quiero el {n:taller de arepas} para el sábado, somos {c:tres}',
    condiciones: { ruido: 'salon', rapido: false, corte: 'y quería pregun' },
    distractores: ['Brunch de mercado', 'Noche de Ramen'], voz: 'Leda', estilo: 'Mujer joven colombiana, nota que se corta al final',
  },
];

const RE_MARCA = /\{([nck]):([^}|]+)(?:\|([^}]+))?\}/g;
const TIPOS: Record<string, TipoMarca> = { n: 'nombre', c: 'cifra', k: 'codigo' };

/** El texto de referencia: las marcas como se escriben. Pura. */
export function referencia(g: Guion): string {
  return g.texto.replace(RE_MARCA, (_, _t, escrito) => escrito);
}

/** Lo que lee la voz: las marcas como se dicen, y la cola que se corta. Pura. */
export function dicho(g: Guion): string {
  const t = g.texto.replace(RE_MARCA, (_, _t, escrito, como) => como ?? escrito);
  return g.condiciones.corte ? `${t} ${g.condiciones.corte}` : t;
}

export function marcas(g: Guion): Marca[] {
  return [...g.texto.matchAll(RE_MARCA)].map((m) => ({ tipo: TIPOS[m[1]], texto: m[2] }));
}

/** El bloque de pistas de la nota, con la función de producción y la base inventada de su workspace. Pura. */
export function pistasDe(g: Guion, tope?: number): string | null {
  const b = BASES[g.workspace];
  return textoPistas(b.base, { incluirClientes: b.canal === 'one', extras: b.extras, ...(tope ? { tope } : {}) });
}

/** Todos los nombres de la base del workspace (lo que podría colarse como inserción falsa). */
export function nombresBase(w: Workspace): string[] {
  const b = BASES[w];
  return [
    ...b.base.equipo, ...b.base.colaboradores, ...b.extras,
    ...b.base.negocios.flatMap((n) => [n.cliente ?? '', n.nombre ?? '']),
  ].filter(Boolean);
}
