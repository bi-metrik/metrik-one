// ============================================================
// El catálogo de funciones (spec §2.2): vive en el código. La base solo dice cuáles están prendidas por empresa.
// ------------------------------------------------------------
// Una clave que no está aquí se ignora y queda en el log: nunca abre nada (§2.3). Para agregar una función: su archivo
// en esta carpeta, su entrada aquí y sus casos (ver docs/asistentes/interfaz-roles-y-funciones.md). La prueba de
// permisos (`../componer.test.ts`) falla si una herramienta de un motor queda sin dueño o con dos.
// ============================================================

import { FUNCIONES_COMUNES } from './comunes.ts';
import { FUNCIONES_EQUIPO_ONE } from './equipo-one.ts';
import type { Funcion } from './tipos.ts';

export const RE_CLAVE_FUNCION = /^(equipo|recolector|clientes|comun)\.[a-z][a-z0-9_]*$/;

export type Catalogo = Readonly<Record<string, Funcion>>;

/** Arma un catálogo por clave. Lanza si una clave está mal formada o repetida (es un error de código, no de datos). */
export function catalogoDe(funciones: Funcion[]): Catalogo {
  const c: Record<string, Funcion> = {};
  for (const f of funciones) {
    if (!RE_CLAVE_FUNCION.test(f.clave)) throw new Error(`clave de función mal formada: ${f.clave}`);
    if (c[f.clave]) throw new Error(`función repetida en el catálogo: ${f.clave}`);
    if ((f.familia === 'comun') !== (f.comun === true)) throw new Error(`${f.clave}: solo la familia comun es común`);
    c[f.clave] = f;
  }
  return Object.freeze(c);
}

export const CATALOGO: Catalogo = catalogoDe([...FUNCIONES_COMUNES, ...FUNCIONES_EQUIPO_ONE]);
