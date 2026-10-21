// ============================================================
// Arnés del dominio ONE — los casos (2026-10-21)
// ------------------------------------------------------------
// Rehechos de las conversaciones reales del bot de siempre en dos workspaces (un taller de refrigeración con un solo
// teléfono, 60 días de «Registrar gasto → monto → 1 → Confirmar → Después», y el workspace interno con gastos,
// actividades, contactos y consultas), más el caso que disparó esto (2026-10-20: «Registra un gasto de 27000 por
// transportes al proyecto impervium», que el bot registró solo y sin decir el código).
// Los mensajes son los reales; los negocios, empresas y personas son INVENTADOS (aquí no van datos de clientes). El
// banco con los nombres reales se arma aparte, fuera del repo, y se pasa con `--banco <archivo.json>`.
//
// `viejoOk`: el bot de siempre dejó ese caso bien. Si el agente lo deja mal, es una regresión.
// ============================================================

import type { NegocioMem } from '../one/puerto-memoria.ts';

export interface PasoCasoOne {
  escribe?: string;
  /** Una foto, con su pie (vacío = sin texto). */
  foto?: string;
  dicta?: string;
  /** Toca el botón con ese título; si no lo hay, escribe `oEscribe` (o «sí»). */
  toca?: string;
  oEscribe?: string;
  /** La opción n del último mensaje con opciones; si no hay, escribe el número. */
  elige?: number;
}

export interface EsperadoOne {
  gastos?: Array<{ monto: number; negocio: string | null; soporte?: boolean; categoria?: string }>;
  actividades?: Array<{ negocio: string }>;
  contactos?: Array<{ nombre: string }>;
  /** Nada escrito. */
  nada?: boolean;
}

export interface CasoOne {
  id: string;
  titulo: string;
  mundo: 'interno' | 'taller' | string;
  rol?: string;
  pasos: PasoCasoOne[];
  esperado: EsperadoOne;
  viejoOk: boolean;
  /** La intención de la persona para la persona simulada; sin ella, se arma de `esperado`. */
  objetivo?: string;
  /** Gastos de hoy ya registrados (para las consultas). */
  gastosHoy?: Array<{ monto: number; categoria: string; descripcion: string; negocio: string | null }>;
}

const n = (codigo: string, empresa: string | null, nombre: string, etapa = 'venta', contacto: string | null = null): NegocioMem =>
  ({ id: `n-${codigo.replace(/\s/g, '')}`, codigo, empresa, nombre, etapa, contacto, valor: 3_000_000 });

/** El workspace interno (inventado): 12 negocios, los más recientes primero. */
export const MUNDO_INTERNO: NegocioMem[] = [
  n('E1 26 2', 'Equipo Contable Prisma', 'Tablero de cierre mensual', 'venta', 'Laura Prisma'),
  n('E1 26 1', 'Equipo Contable Prisma', 'Taller de automatización para el equipo', 'venta', 'Laura Prisma'),
  n('F2 26 1', 'Fundición Andes', 'Diagnóstico de procesos — Fundición Andes'),
  n('V1 26 5', 'Vértice Impermeables', 'Utilidad por obra', 'venta', 'Lina Vértice'),
  n('S2 26 1', 'Sazón & Eventos', 'Atención de reservas por chat', 'ejecucion'),
  n('T2 26 1', 'Transportes Ruta Norte', 'Control de entregas'),
  n('A1 26 1', 'Alfa Grupo Internacional', 'Matriz de riesgos sede Valle', 'cobro'),
  n('C3 26 1', 'Carolina Test', 'Viaje de Carolina Test a Santa Marta', 'venta', 'Carolina Test'),
  n('A1 26 2', 'Alfa Grupo Internacional', 'Registro de pedidos', 'ejecucion'),
  n('L2 26 1', 'Estética Lumen', 'Agenda de citas'),
  n('A1 26 5', 'Alfa Grupo Internacional', 'Apoyo de alianza', 'ejecucion'),
  n('A1 26 3', 'Alfa Grupo Internacional', 'Consultas de terceros', 'cobro'),
];

/** El taller (inventado): 5 negocios abiertos, el primero es el de casi todos sus gastos. */
export const MUNDO_TALLER: NegocioMem[] = [
  n('E1 26 1', 'Eléctricas del Sur SAS', 'OBRA CALLE NORTE'),
  n('S1 26 1', 'Sur Movilidad SAS', 'CENTRO COMERCIAL SUR'),
  n('A1 26 1', 'Aire Polar SAS', 'MONTAJE OCTUBRE'),
  n('C1 26 1', 'Consorcio Coral Ingeniería', 'COLEGIO SAN PEDRO'),
  n('F1 26 1', 'Fundación Salud Norte', 'MANTENIMIENTO PREVENTIVO GENERAL'),
];

export const MUNDOS: Record<string, NegocioMem[]> = { interno: MUNDO_INTERNO, taller: MUNDO_TALLER };

const DESPUES = { toca: 'Después', oEscribe: 'Después' };

export const CASOS_ONE: CasoOne[] = [
  // ── El caso que disparó esto ─────────────────────────────────────────────
  {
    id: 'i-empresa', titulo: 'gasto al «proyecto» nombrado por la empresa', mundo: 'interno',
    pasos: [{ escribe: 'Registra un gasto de 27000 por transportes al proyecto vértice' }, { toca: 'Registrar' }],
    esperado: { gastos: [{ monto: 27000, negocio: 'V1 26 5', categoria: 'transporte' }] }, viejoOk: true,
  },
  {
    id: 'i-id-del-negocio', titulo: 'no encuentra el nombre; la persona da el código y el bot entiende que es el destino', mundo: 'interno',
    pasos: [
      { escribe: 'Registra un gasto de 27000 por transportes al proyecto impermeabilizaciones' },
      { escribe: 'Revisa el V1 26 5' },
      { toca: 'Registrar', oEscribe: 'No quiero, te estoy dando el id del negocio' },
      { toca: 'Registrar' },
    ],
    esperado: { gastos: [{ monto: 27000, negocio: 'V1 26 5' }] }, viejoOk: false,
  },
  {
    id: 'i-codigo-suelto', titulo: 'código escrito sin espacios', mundo: 'interno',
    pasos: [{ escribe: 'gasto 12000 almuerzo v1265' }, { toca: 'Registrar' }],
    esperado: { gastos: [{ monto: 12000, negocio: 'V1 26 5', categoria: 'alimentacion' }] }, viejoOk: true,
  },
  // ── El workspace interno ─────────────────────────────────────────────────
  {
    id: 'i-empresa-gasto', titulo: 'gasto de empresa (impresión para abrir la cuenta)', mundo: 'interno',
    pasos: [{ escribe: '14400 para impresión de documentos para abrir la cuenta en el banco' }, { toca: 'Gasto de empresa', oEscribe: 'es gasto de empresa' }, { toca: 'Registrar' }, { toca: 'No tengo', oEscribe: 'No tengo' }],
    esperado: { gastos: [{ monto: 14400, negocio: null }] }, viejoOk: true,
  },
  {
    id: 'i-dos-de-la-empresa', titulo: 'la empresa tiene dos negocios: pregunta cuál', mundo: 'interno',
    pasos: [{ escribe: 'gasto de 50000 en papelería al de equipo contable prisma' }, { elige: 1 }, { toca: 'Registrar' }],
    esperado: { gastos: [{ monto: 50000, negocio: 'E1 26 2' }] }, viejoOk: true,
  },
  {
    id: 'i-actividad', titulo: 'actividad con el contacto de un negocio', mundo: 'interno',
    pasos: [{ escribe: 'llamé a Carolina Test para revisar su viaje' }, { toca: 'Registrar' }],
    esperado: { actividades: [{ negocio: 'C3 26 1' }] }, viejoOk: true,
  },
  {
    id: 'i-contacto', titulo: 'contacto nuevo con teléfono', mundo: 'interno',
    pasos: [{ escribe: 'nuevo contacto Sofía Prueba 3001234567' }, { toca: 'Crear' }],
    esperado: { contactos: [{ nombre: 'Sofía Prueba' }] }, viejoOk: true,
  },
  {
    id: 'i-consulta-negocios', titulo: '«cuántos viajes tengo» (consulta, no escribe)', mundo: 'interno',
    pasos: [{ escribe: 'cuántos viajes tengo' }],
    esperado: { nada: true }, viejoOk: true,
  },
  {
    id: 'i-hola', titulo: 'saludo y ayuda', mundo: 'interno',
    pasos: [{ escribe: 'hola' }, { escribe: 'ok gracias' }],
    esperado: { nada: true }, viejoOk: true,
  },
  {
    id: 'i-link', titulo: 'un link suelto', mundo: 'interno',
    pasos: [{ escribe: 'https://www.facebook.com/share/1AbCdEfGh/' }],
    esperado: { nada: true }, viejoOk: true,
  },
  {
    id: 'i-pedido-cliente', titulo: 'un pedido de viaje de un cliente pegado (no es de este bot)', mundo: 'interno',
    pasos: [{ escribe: 'Hola, queremos ir a Cartagena del 12 al 16 de diciembre, somos 2 adultos y 1 niño, hotel 4 estrellas' }, { escribe: 'listo' }],
    esperado: { nada: true }, viejoOk: true,
  },
  {
    id: 'i-suelto', titulo: 'dos palabras sin sentido', mundo: 'interno',
    pasos: [{ escribe: 'Objeto adultos' }],
    esperado: { nada: true }, viejoOk: true,
  },
  {
    id: 'i-operador-contacto', titulo: 'un operador no crea contactos', mundo: 'interno', rol: 'operator',
    pasos: [{ escribe: 'nuevo contacto Sofía Prueba 3001234567' }, { toca: 'Crear' }],
    esperado: { nada: true }, viejoOk: true,
  },
  // ── El taller: «Registrar gasto → monto → 1 → Confirmar → Después» ────────
  {
    id: 't-base', titulo: 'Registrar gasto, monto, el 1, confirmar, después', mundo: 'taller',
    pasos: [{ escribe: 'Registrar gasto' }, { escribe: '295.000' }, { elige: 1 }, { toca: 'Registrar' }, DESPUES],
    esperado: { gastos: [{ monto: 295000, negocio: 'E1 26 1', soporte: false }] }, viejoOk: true,
  },
  {
    id: 't-mantenimiento', titulo: 'el concepto suena a nombre de negocio', mundo: 'taller',
    pasos: [{ escribe: 'necesito cargar un gasto a mantenimiento correctivo' }, { escribe: '47.600' }, { elige: 1 }, { toca: 'Registrar' }],
    esperado: { gastos: [{ monto: 47600, negocio: 'E1 26 1' }] }, viejoOk: true,
  },
  {
    id: 't-si-despues', titulo: '«Si» después de registrar y luego «Después»', mundo: 'taller',
    pasos: [{ escribe: 'Necesito registrar gastos' }, { escribe: '323893' }, { elige: 1 }, { toca: 'Registrar' }, { escribe: 'Si' }, DESPUES],
    esperado: { gastos: [{ monto: 323893, negocio: 'E1 26 1', soporte: false }] }, viejoOk: true,
  },
  {
    id: 't-foto-despues', titulo: 'la foto del soporte después de registrar', mundo: 'taller',
    pasos: [{ escribe: 'Registrar gasto' }, { escribe: '17000' }, { elige: 1 }, { toca: 'Registrar' }, { foto: '' }, { toca: 'Adjuntar' }],
    esperado: { gastos: [{ monto: 17000, negocio: 'E1 26 1', soporte: true }] }, viejoOk: true,
  },
  {
    id: 't-foto-primero', titulo: 'la foto del recibo con su pie, antes de todo', mundo: 'taller',
    pasos: [{ foto: 'gasolina 90000' }, { elige: 1 }, { toca: 'Registrar' }],
    esperado: { gastos: [{ monto: 90000, negocio: 'E1 26 1', soporte: true, categoria: 'transporte' }] }, viejoOk: true,
  },
  {
    id: 't-peaje', titulo: 'concepto y monto en el mismo mensaje', mundo: 'taller',
    pasos: [{ escribe: 'Registrar un gasto de 18900 de peaje' }, { elige: 1 }, { toca: 'Registrar' }, DESPUES],
    esperado: { gastos: [{ monto: 18900, negocio: 'E1 26 1', categoria: 'transporte' }] }, viejoOk: true,
  },
  {
    id: 't-corrige-concepto', titulo: 'escribe el concepto encima de la confirmación', mundo: 'taller',
    pasos: [{ escribe: 'Registrar gasto' }, { escribe: '18900' }, { elige: 1 }, { escribe: 'Peaje' }, { toca: 'Registrar' }],
    esperado: { gastos: [{ monto: 18900, negocio: 'E1 26 1', categoria: 'transporte' }] }, viejoOk: true,
  },
  {
    id: 't-bebidas', titulo: '«Gasto» y luego «Bebidas de 20000»', mundo: 'taller',
    pasos: [{ escribe: 'Gasto' }, { escribe: 'Bebidas de 20000' }, { elige: 1 }, { toca: 'Registrar' }, DESPUES],
    esperado: { gastos: [{ monto: 20000, negocio: 'E1 26 1' }] }, viejoOk: true,
  },
  {
    id: 't-otro-gasto', titulo: 'dos gastos seguidos («Otro gasto»)', mundo: 'taller',
    pasos: [
      { escribe: 'Otro gasto' }, { escribe: '100000 alimentación' }, { elige: 1 }, { toca: 'Registrar' }, DESPUES,
      { escribe: 'Otro gasto' }, { escribe: '100000 hospedaje' }, { elige: 1 }, { toca: 'Registrar' }, DESPUES,
    ],
    esperado: { gastos: [{ monto: 100000, negocio: 'E1 26 1', categoria: 'alimentacion' }, { monto: 100000, negocio: 'E1 26 1' }] }, viejoOk: true,
  },
  {
    id: 't-cuarto', titulo: 'elige el cuarto negocio', mundo: 'taller',
    pasos: [{ escribe: 'Registrar gasto' }, { escribe: '1693365 en materiales' }, { elige: 4 }, { toca: 'Registrar' }, DESPUES],
    esperado: { gastos: [{ monto: 1693365, negocio: 'C1 26 1', categoria: 'materiales' }] }, viejoOk: true,
  },
  {
    id: 't-diez-millones', titulo: 'un gasto grande', mundo: 'taller',
    pasos: [{ escribe: 'Registrar gasto' }, { escribe: '10000000' }, { elige: 1 }, { toca: 'Registrar' }, DESPUES],
    esperado: { gastos: [{ monto: 10_000_000, negocio: 'E1 26 1' }] }, viejoOk: true,
  },
  {
    id: 't-consultas', titulo: 'egresos, cuánto gasté hoy, movimientos (consultas, no escriben)', mundo: 'taller',
    gastosHoy: [{ monto: 90000, categoria: 'transporte', descripcion: 'gasolina', negocio: 'E1 26 1' }, { monto: 18900, categoria: 'transporte', descripcion: 'peaje', negocio: 'E1 26 1' }],
    pasos: [{ escribe: 'Quiero ver los egresos' }, { escribe: 'Quiero saber cuánto gasté hoy' }, { escribe: 'Movimientos' }],
    esperado: { nada: true }, viejoOk: false,
  },
  {
    id: 't-no-confirma', titulo: 'cancela en la confirmación: nada se escribe', mundo: 'taller',
    pasos: [{ escribe: 'Registrar gasto' }, { escribe: '24000' }, { elige: 1 }, { toca: 'No', oEscribe: 'cancelar' }],
    esperado: { nada: true }, viejoOk: true,
  },
];
