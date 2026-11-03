// ============================================================
// Las funciones `equipo.*` que salen del dominio ONE de hoy (`../one/dominio.ts`), 2026-10-26
// ------------------------------------------------------------
// El dominio ONE se parte en funciones sin reescribirlo: cada una toma sus herramientas del motor `one` y es dueña de
// sus fichas de `one/reglamento.ts`. Son más finas que la tabla de §2.2 de la spec porque tienen que reproducir
// EXACTAMENTE `permisosDe` (`../one/dominio.ts:148`), incluida la diferencia entre ver plata y no verla:
//   · `equipo.consulta_negocio` (la consulta de negocios y la pregunta del destino) es el permiso `negocios`;
//   · `equipo.consulta_gastos` (la lista de gastos) es el permiso `gastos`, aparte del registro;
//   · `equipo.ver_plata` no trae herramientas: es el permiso `plata` (el valor del negocio y lo gastado en el mes);
//   · `equipo.gastos` + `equipo.actividades` son el permiso `escribir`; `equipo.ingresos` y `equipo.contactos`, los suyos.
// El mapa cargo → funciones está en `../one/cargos.ts`.
// ============================================================

import type { Funcion } from './tipos.ts';

export const MOTOR_ONE = 'one';

export const EQUIPO_CONSULTA_NEGOCIO: Funcion = {
  clave: 'equipo.consulta_negocio',
  familia: 'equipo',
  queHace: 'consultar tus negocios',
  herramientas: { one: { lecturas: ['buscar_negocios', 'negocios_abiertos', 'ver_negocio'], cierres: ['preguntar_destino'] } },
  candados: ['sin_negocio', 'negocio_inexistente', 'negocio_no_leido', 'negocios_no_leidos', 'sin_negocios', 'formato_meta'],
  fichas: ['g.buscar_negocio', 'g.consultas'],
  temas: ['negocios'],
};

export const EQUIPO_CONSULTA_GASTOS: Funcion = {
  clave: 'equipo.consulta_gastos',
  familia: 'equipo',
  queHace: 'consultar tus gastos',
  herramientas: { one: { lecturas: ['gastos_recientes'] } },
  candados: ['negocio_inexistente', 'negocio_no_leido'],
  fichas: ['g.consultas'],
  temas: ['gasto'],
};

export const EQUIPO_VER_PLATA: Funcion = {
  clave: 'equipo.ver_plata',
  familia: 'equipo',
  queHace: '',
  herramientas: {},
  candados: [],
  fichas: [],
};

export const EQUIPO_GASTOS: Funcion = {
  clave: 'equipo.gastos',
  familia: 'equipo',
  queHace: 'registrar gastos con su soporte (foto o PDF)',
  herramientas: { one: { acciones: ['gasto', 'adjuntar_soporte', 'corregir_gasto'] } },
  candados: [
    'monto', 'categoria', 'sin_destino', 'destino_doble', 'empresa_sin_respaldo', 'sin_negocio', 'negocio_inexistente', 'servicio_viaje', 'foto',
    'soporte_es_ingreso', 'gasto_borrado', 'gasto_desconocido', 'gasto_no_leido', 'ya_tiene_soporte', 'monto_distinto', 'gasto_revisado', 'mismo_monto',
  ],
  fichas: [
    'inv.destino_real', 'inv.gastos_vigentes', 'glo.gasto_empresa', 'glo.soporte', 'glo.monto', 'g.elegir_destino', 'g.categoria', 'g.descripcion',
    'g.soporte', 'g.adjunto_leido', 'g.varios_soportes', 'g.foto_sola', 'g.no_mandar_a_la_app', 'p.gasto', 'p.soporte_despues',
  ],
  temas: ['gasto'],
  requiere: ['equipo.consulta_negocio'],
};

export const EQUIPO_ACTIVIDADES: Funcion = {
  clave: 'equipo.actividades',
  familia: 'equipo',
  queHace: 'anotar actividades en tus negocios',
  herramientas: { one: { acciones: ['actividad'] } },
  candados: ['nota_no_es_de_la_persona', 'nota_de_voz_sin_referencia', 'sin_texto', 'sin_negocio', 'negocio_inexistente'],
  fichas: ['g.actividad', 'g.elegir_destino'],
  temas: ['actividad'],
  requiere: ['equipo.consulta_negocio'],
};

export const EQUIPO_INGRESOS: Funcion = {
  clave: 'equipo.ingresos',
  familia: 'equipo',
  queHace: 'registrar pagos recibidos de cuotas',
  herramientas: { one: { acciones: ['ingreso'] } },
  candados: ['monto', 'foto', 'sin_negocio', 'negocio_inexistente', 'cobros_no_leidos', 'sin_cobros_pendientes', 'cuota_inexistente', 'ingreso_no_cuadra', 'parcial_mayor'],
  fichas: ['g.ingreso', 'glo.soporte', 'glo.monto'],
  temas: ['ingreso'],
  requiere: ['equipo.consulta_negocio'],
};

export const EQUIPO_CONTACTOS: Funcion = {
  clave: 'equipo.contactos',
  familia: 'equipo',
  queHace: 'crear contactos',
  herramientas: { one: { acciones: ['contacto_nuevo'] } },
  candados: ['sin_nombre', 'telefono_sin_respaldo', 'duplicado_no_leido', 'contacto_duplicado'],
  fichas: ['g.contacto'],
  temas: ['contacto'],
};

/** En el orden en que se nombran en la ayuda y en el fuera de tema. */
export const FUNCIONES_EQUIPO_ONE: Funcion[] = [
  EQUIPO_GASTOS, EQUIPO_INGRESOS, EQUIPO_ACTIVIDADES, EQUIPO_CONTACTOS, EQUIPO_CONSULTA_NEGOCIO, EQUIPO_CONSULTA_GASTOS, EQUIPO_VER_PLATA,
];
