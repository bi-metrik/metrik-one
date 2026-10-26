// ============================================================
// Asistentes MeTRIK — el tipo de una función del catálogo (spec 2026-10-26 asistentes-roles-y-funciones, §2.1-§2.2)
// ------------------------------------------------------------
// Una FUNCIÓN es una capacidad que MéTRIK escribe una vez (registrar un gasto, consultar los negocios, mostrar la ficha
// de una experiencia) y que se le prende a una empresa (`asistente_funciones_empresa`) y se le asigna a un rol (ficha
// `rol.funciones` de su reglamento). Herramientas del turno = funciones asignadas al rol ∩ prendidas en la empresa.
//
// La función NO trae la implementación de sus herramientas: la pone un MOTOR, un `Dominio` que ya existe (`one` =
// `one/dominio.ts`, `publico` = `publico/dominio.ts`; mañana `obras`, `citas`). La función dice cuáles de las
// herramientas del motor son suyas, y el componedor (`../componer.ts`) arma el dominio del turno solo con esas y le
// despacha cada llamada al motor. Así una función nueva no reescribe nada: declara qué es suyo.
//
// La guía para quien construye encima (Sabor, Imperviun, Laura): docs/asistentes/interfaz-roles-y-funciones.md.
// ============================================================

/** El motor que implementa las herramientas: la llave del `Dominio` en `componerDominio({ motores })`. */
export type MotorId = string;

export type FamiliaFuncion = 'equipo' | 'recolector' | 'clientes' | 'comun';

/** Las herramientas que una función toma de un motor, por nombre (los nombres que declara ese `Dominio`). */
export interface HerramientasFuncion {
  /** Lecturas (`Dominio.lecturas`). */
  lecturas?: string[];
  /** Acciones de `proponer` (`Dominio.acciones`). */
  acciones?: string[];
  /** Cierres del dominio (`Dominio.cierres`). */
  cierres?: string[];
}

/** Lo que recibe el gancho de pistas para la transcripción (§4.6). */
export interface ContextoPistas {
  workspaceId: string;
  /** Los parámetros con que la empresa prendió la función. */
  parametros: Record<string, unknown>;
}

export interface Funcion {
  /** `equipo.gastos`, `clientes.ficha`, `comun.persona`… (`^(equipo|recolector|clientes|comun)\.[a-z][a-z0-9_]*$`). */
  clave: string;
  familia: FamiliaFuncion;
  /**
   * Una línea en infinitivo de lo que hace, para la persona («registrar gastos con su soporte»). El código arma con
   * ellas la respuesta de fuera de tema y la ayuda del rol. Vacía = no se nombra (una común, un permiso de ver plata).
   */
  queHace: string;
  /** Las herramientas que toma de cada motor. Una función sin herramientas (un permiso, un hueco) es válida. */
  herramientas: Partial<Record<MotorId, HerramientasFuncion>>;
  /**
   * Los candados que el motor hace cumplir en esas herramientas (el `candado` que devuelve al atajar). Documentan la
   * función y la prueba de permisos los cruza con los casos.
   */
  candados: string[];
  /**
   * Las fichas del reglamento que son de esta función, por clave. Sin la función en el turno, no van (el modelo no lee
   * reglas de lo que no tiene). Una ficha que no es de ninguna función va siempre. Una ficha de varias funciones va si
   * está alguna.
   */
  fichas: string[];
  /** Los temas de `alc.temas` que aporta (sin ella, el tema sale de la lista del turno). */
  temas?: string[];
  /**
   * Las funciones sin las que esta no se puede usar (registrar un gasto necesita `preguntar_destino`, que es de la
   * consulta de negocios). Sin alguna, el componedor la deja fuera y lo anota en el log.
   */
  requiere?: string[];
  /** Común: la pone el componedor a todo rol. No se prende ni se asigna. */
  comun?: boolean;
  /**
   * Gancho de pistas para la transcripción (§4.6): palabras de la base que pueden aparecer en una nota de voz (nombres
   * del equipo, códigos, servicios del portafolio). Lo llamará la pieza de transcripción; aquí solo se declara.
   */
  pistas?(ctx: ContextoPistas): Promise<string[]>;
}

/** Lo que dice la RPC `asistente_resolver_rol` de cada función del rol (prendida en la empresa). */
export interface FuncionPrendida {
  funcion: string;
  parametros: Record<string, unknown>;
}
