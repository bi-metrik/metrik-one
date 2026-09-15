/**
 * Catálogo de módulos de ONE. **Fuente única** de qué módulos existen, qué llave de
 * `workspaces.modules` enciende cada uno y qué rutas de `src/app/(app)` le pertenecen.
 *
 * Spec: `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md`, §2 (entrega A1).
 *
 * ## Por qué vive en código y no en una tabla
 *
 * Un módulo son rutas y pantallas, y las rutas viven en el código: una tabla con la lista
 * quedaría desfasada en el primer deploy. Lo que sí vive en la base es QUIÉN tiene cada
 * módulo (`workspace_modulos`, migración `20260915210000`), y esa tabla usa como
 * vocabulario las `clave` de aquí — `catalogo.test.ts` lee la migración y falla si se
 * separan.
 *
 * ## Tres clases de llave en `workspaces.modules`
 *
 * - **Llave de módulo** (`clave`): enciende un producto entero. Es lo único que el gate por
 *   ruta mira y lo único que `proyectar_modulos` recalcula.
 * - **Llave de función** (`funciones`): una capacidad dentro de un módulo (`conciliacion`,
 *   `fab_registrar_pago`, …). La pantalla de cada función la sigue guardando por su cuenta;
 *   el gate no la mira salvo en `RUTAS_POR_FUNCION`. La proyección la conserva tal cual.
 * - Cualquier otra llave es un error de vocabulario: `catalogo.test.ts` exige que todas las
 *   llaves medidas en producción estén clasificadas.
 *
 * ## Cómo agregar una ruta
 *
 * Crear la carpeta en `src/app/(app)` hace fallar `catalogo.test.ts` hasta que la ruta se
 * declare en un módulo, en `RUTAS_COMUNES` o en ambos lados que correspondan. La prueba
 * existe para que la pregunta "¿de qué módulo es esto?" se conteste al crear la ruta, y no
 * cuando un cliente de un solo módulo la abre.
 *
 * Este archivo lo importan el middleware (edge) y el AppShell (cliente): nada de
 * `server-only`, `node:*` ni Supabase aquí.
 */

export interface Modulo {
  /** Nombre visible. */
  nombre: string
  /**
   * Llave de `workspaces.modules` que lo enciende. Es también el valor que se guarda en
   * `workspace_modulos.modulo`. Las llaves heredadas no se renombran: Clarity se llama así
   * en pantalla (D6) y sigue siendo `business` por dentro, que es como la lee todo el código.
   */
  clave: string
  /** A dónde entra un workspace cuyo único módulo es este. */
  inicio: string
  /**
   * Prefijos de ruta que le pertenecen. `/negocios` cubre `/negocios/[id]/...`. Una ruta
   * puede ser de varios módulos y se permite si cualquiera está encendido.
   */
  rutas: readonly string[]
  /** Llaves de función que cuelgan del módulo. */
  funciones: readonly string[]
}

export const MODULOS = {
  clarity: {
    nombre: 'Clarity',
    clave: 'business',
    inicio: '/numeros',
    rutas: [
      '/negocios', '/numeros', '/equipo', '/movimientos', '/directorio', '/contactos',
      '/tableros', '/flujo', '/gastos', '/facturacion', '/cobros-recurrentes',
      '/conciliacion', '/revision', '/promotores', '/nuevo',
    ],
    funciones: [
      'comercial_negocios', 'conciliacion', 'cobros_recurrentes', 'aliados', 'causacion',
      'centro_costos', 'operaciones_bonos', 'marketing_campanas', 'proceso_semanal',
      'rentabilidad_comercial', 'pausa_enabled', 'pausa_sla_auto_enabled',
      'fab_registrar_cobro', 'fab_registrar_horas', 'fab_registrar_pago', 'fab_pago_epayco',
    ],
  },
  valida: {
    nombre: 'Valida',
    clave: 'valida_consulta',
    inicio: '/valida',
    rutas: ['/valida'],
    funciones: [],
  },
  // Clientes de API directa (4D SOFT). Es un módulo distinto de Valida: otro cliente, otra
  // pantalla, otro cobro. La carpeta `/valida-api` todavía no existe (entrega C2).
  valida_api: {
    nombre: 'Valida API',
    clave: 'valida_api',
    inicio: '/valida-api',
    rutas: ['/valida-api'],
    funciones: [],
  },
  sustenta: {
    nombre: 'Sustenta',
    clave: 'compliance',
    inicio: '/riesgos',
    // `/directorio` y `/tableros` también son de Sustenta: el menú de un workspace de solo
    // compliance (alma-afi) los muestra hoy, y sus pestañas móviles primarias son
    // riesgos, matriz, tableros y directorio.
    rutas: ['/riesgos', '/controles', '/matriz', '/compliance', '/directorio', '/tableros'],
    funciones: [
      'compliance_dual_informa', 'compliance_vinculacion', 'compliance_validacion',
      'compliance_audit',
    ],
  },
  // Fuera de los cuatro módulos pedidos; catalogados para que el gate no los apague.
  llamadas: {
    nombre: 'Llamadas',
    clave: 'calidad_llamadas',
    inicio: '/calidad',
    // `/equipo` y `/tableros` también sirven a Llamadas (el módulo reutiliza las pantallas
    // de personas e indicadores en vez de inventar las suyas), y el menú de un call
    // center de solo calidad muestra `/directorio`.
    rutas: ['/calidad', '/solicitudes', '/equipo', '/tableros', '/directorio'],
    funciones: ['wa_customer_bot'],
  },
  certificaciones: {
    nombre: 'Certificaciones',
    clave: 'cert_qr',
    inicio: '/certificaciones',
    rutas: ['/certificaciones'],
    funciones: [],
  },
} as const satisfies Record<string, Modulo>

export type IdModulo = keyof typeof MODULOS

/** Orden estable de los módulos: el del catálogo. */
export const IDS_MODULO = Object.keys(MODULOS) as IdModulo[]

/** Las llaves de `workspaces.modules` que son módulo (no función). */
export const CLAVES_DE_MODULO: readonly string[] = IDS_MODULO.map((id) => MODULOS[id].clave)

/**
 * Rutas de todo workspace, con cualquier módulo. `/servicios` es donde cada cliente ve lo
 * que tiene contratado (§2.4), así que no puede depender de ningún módulo.
 */
export const RUTAS_COMUNES = ['/servicios', '/mi-negocio', '/config', '/admin', '/story-mode'] as const

/**
 * Rutas que `config_extra.modo_vitrina` abre aunque su módulo esté apagado: son las
 * vitrinas de venta de Clarity en un workspace que solo tiene Valida (los CDA).
 */
export const RUTAS_VITRINA = ['/numeros', '/tableros'] as const

/**
 * Rutas que una llave de función abre sin que su módulo esté encendido. Lista cerrada: cada
 * entrada es una excepción que alguien tuvo que justificar.
 */
export const RUTAS_POR_FUNCION: readonly { ruta: string; funcion: string; porque: string }[] = [
  {
    ruta: '/compliance/comparativa-informa',
    funcion: 'compliance_audit',
    porque:
      'Auditoría interna de consultas duales del workspace metrik, que no tiene Sustenta. ' +
      'La página además exige el slug metrik.',
  },
  {
    ruta: '/solicitudes',
    funcion: 'wa_customer_bot',
    porque:
      'Las solicitudes que deja el bot de WhatsApp. Un workspace puede tener el bot sin ' +
      'auditoría de llamadas: el menú y la página lo gatean por esta llave.',
  },
]
