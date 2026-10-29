// ============================================================
// Las funciones `equipo.*` del motor de VIAJES (la bandeja de solicitudes de Trappvel, `../bandeja/dominio.ts`), 2026-10-29
// ------------------------------------------------------------
// Mauricio aprobó el 29-oct dos roles para Trappvel por el número de Agus (`wa_one`): la mano derecha (el dueño) y la
// asesora de viajes. La bandeja se parte en funciones sin reescribirla: cada función toma sus herramientas del motor
// `viajes` y es dueña de sus fichas del reglamento de la bandeja. Partición (cada herramienta, una dueña):
//   · `equipo.viajes_consulta`   buscar, ver_viaje                       (la base: las otras tres la requieren)
//   · `equipo.viajes_registro`   viaje_nuevo, cargar_tanda, anotar_en_viaje, descartar
//   · `equipo.clientes_viaje`    crear_cliente, perfil_contacto
//   · `equipo.autorizacion_datos` link_autorizacion
// Por qué así: `buscar` alimenta a todas (el viaje nuevo, el perfil y el link exigen la ficha vista por `buscar`), así
// que es de la consulta y las demás la requieren. Crear un cliente y su perfil van juntos (los dos escriben en el
// contacto, no en el viaje). El link de autorización es un cierre aparte: una agencia puede no usarlo.
// Los roles de Trappvel llevan las cuatro: con todas, el reglamento del turno es el mismo de la bandeja.
// ============================================================

import type { Funcion } from './tipos.ts';

export const MOTOR_VIAJES = 'viajes';

export const EQUIPO_VIAJES_CONSULTA: Funcion = {
  clave: 'equipo.viajes_consulta',
  familia: 'equipo',
  queHace: 'buscar clientes y ver cómo va cada viaje',
  herramientas: { viajes: { lecturas: ['buscar', 'ver_viaje'] } },
  candados: [],
  fichas: ['g.buscar_primero', 'g.consulta_propia', 'g.falta_para', 'g.carga_en_vuelo', 'p.consulta'],
  temas: ['viaje'],
};

export const EQUIPO_VIAJES_REGISTRO: Funcion = {
  clave: 'equipo.viajes_registro',
  familia: 'equipo',
  queHace: 'abrir viajes y cargarles lo que te pasan tus clientes (reenvíos, audios, fotos)',
  herramientas: { viajes: { acciones: ['viaje_nuevo', 'cargar_tanda', 'anotar_en_viaje', 'descartar'] } },
  candados: [
    'cliente_ambiguo', 'cliente_sin_buscar', 'dato_sin_respaldo', 'desde_invalido', 'falta_responsable', 'responsable_fuera_del_equipo',
    'sin_equipo_comercial', 'lectura_fallida', 'viaje_nombrado', 'codigo_ambiguo', 'viaje_inexistente', 'viaje_cerrado', 'tanda_vacia',
    'texto_sin_respaldo', 'solo_duda', 'sin_datos_nuevos',
  ],
  fichas: [
    'inv.viaje_nombrado', 'glo.viaje_nuevo', 'glo.tanda', 'glo.minimo', 'glo.infante', 'g.viaje_nuevo_existente', 'g.relato_del_cliente',
    'g.quien_pregunta', 'g.respuesta_a_falta', 'g.varios_viajes', 'g.no_es_solicitud', 'g.viaje_equivocado', 'g.sin_juicios', 'g.fechas',
    'g.pasajeros', 'g.presupuesto', 'g.descartar_alcance', 'p.solicitud_nueva', 'p.completar_viaje',
  ],
  temas: ['solicitud'],
  requiere: ['equipo.viajes_consulta'],
};

export const EQUIPO_CLIENTES_VIAJE: Funcion = {
  clave: 'equipo.clientes_viaje',
  familia: 'equipo',
  queHace: 'crear clientes y guardar lo que quieras recordar de ellos',
  herramientas: { viajes: { acciones: ['crear_cliente', 'perfil_contacto'] } },
  candados: [
    'dato_sin_respaldo', 'falta_llave', 'guardian_fallo', 'llave_de_otro', 'parecidos', 'cliente_ambiguo', 'cliente_sin_buscar', 'menor_con_nombre',
    'texto_sin_respaldo', 'perfil_vacio', 'perfil_no_guardable', 'lectura_fallida', 'sin_autorizacion', 'ya_en_perfil',
  ],
  fichas: ['inv.cliente_nuevo', 'glo.cliente_nuevo', 'glo.llave', 'glo.perfil', 'g.perfil_explicito', 'g.perfil_marcas', 'g.sin_juicios', 'p.cliente_nuevo'],
  temas: ['cliente'],
  requiere: ['equipo.viajes_consulta'],
};

export const EQUIPO_AUTORIZACION_DATOS: Funcion = {
  clave: 'equipo.autorizacion_datos',
  familia: 'equipo',
  queHace: 'pasarte el link de autorización de datos de un cliente',
  herramientas: { viajes: { cierres: ['link_autorizacion'] } },
  candados: ['cliente_ambiguo', 'cliente_sin_buscar', 'lectura_fallida'],
  fichas: ['g.link_autorizacion'],
  requiere: ['equipo.viajes_consulta'],
};

/** En el orden en que se nombran en la ayuda y en el fuera de tema. */
export const FUNCIONES_EQUIPO_VIAJES: Funcion[] = [
  EQUIPO_VIAJES_REGISTRO, EQUIPO_VIAJES_CONSULTA, EQUIPO_CLIENTES_VIAJE, EQUIPO_AUTORIZACION_DATOS,
];

/** Las claves de viajes (para saber si un rol lleva el motor). */
export const CLAVES_VIAJES: ReadonlySet<string> = new Set(FUNCIONES_EQUIPO_VIAJES.map((f) => f.clave));
