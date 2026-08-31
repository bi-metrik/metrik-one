'use server';

/**
 * Carga del catálogo de tier de fuentes (dictamen 2026-08-25).
 *
 * Es el único puente entre las tablas `compliance_tier_*` y la regla pura de
 * `@/lib/compliance/tier-fuentes`.
 *
 * Desde el 2026-08-31 la clasificación se persiste con cada consulta (bloque A
 * del concepto de Emilio). El veredicto y el efecto sobre el flujo de compras
 * siguen fuera de alcance: dependen del bloque B.
 *
 * El catálogo es GLOBAL del producto: no se filtra por workspace y por eso esta
 * función no pide `getWorkspace()`. El tier es un hecho normativo —qué ES la
 * fuente— no una preferencia de cliente. Lo que sí será por workspace, más
 * adelante, es qué tier frena una contratación.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { getWorkspace } from './get-workspace';
import {
  indexarCatalogo,
  type CatalogoIndexado,
  type CatalogoStatus,
  type CatalogoTier,
  type FuenteCatalogada,
} from '@/lib/compliance/tier-fuentes';

/**
 * La versión que se debe usar para clasificar.
 *
 * Prefiere la `vigente` —la que tiene firma jurídica— y cae a la más alta
 * disponible cuando todavía no hay ninguna firmada, que es el estado de hoy. En
 * ese caso el índice vuelve con `opera: false`, y quien emita un veredicto tiene
 * que mirar esa bandera: clasificar sirve para medir cobertura, no para decidir.
 *
 * Devuelve null si no hay ninguna versión sembrada. No lanza: la ausencia de
 * catálogo es un estado que el llamador tiene que poder distinguir de un error.
 */
export async function cargarCatalogoTierVigente(): Promise<CatalogoIndexado | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const { data: versiones } = await svc
    .from('compliance_tier_catalogo_versiones')
    .select('version, status')
    .in('status', ['vigente', 'validada_tecnica', 'propuesta'])
    .order('version', { ascending: false });

  const filas: { version: number; status: CatalogoStatus }[] = versiones ?? [];
  if (filas.length === 0) return null;

  const elegida = filas.find((f) => f.status === 'vigente') ?? filas[0];

  const { data: fuentes } = await svc
    .from('compliance_tier_fuentes')
    .select('llave_tipo, llave, tier, familia, provisional, etiqueta, sustento, grupo_dedup')
    .eq('catalogo_version', elegida.version);

  const catalogo: CatalogoTier = {
    version: elegida.version,
    status: elegida.status,
    fuentes: (fuentes ?? []) as FuenteCatalogada[],
  };

  return indexarCatalogo(catalogo);
}

// ─── Indicador C5: fuentes sin clasificar del periodo ──────────────────────


export type CoberturaCatalogo = {
  /** Consultas del periodo que trajeron alguna fuente que el catálogo no resuelve. */
  consultas_con_fuente_desconocida: number;
  /** Las fuentes crudas, únicas, tal como las manda el proveedor. */
  fuentes: string[];
  desde: string;
  hasta: string;
};

/**
 * Cuántas fuentes se le escaparon al catálogo en el periodo.
 *
 * Es el indicador del §6.A del dictamen y la condición C5 del concepto de
 * Emilio. Mide una sola cosa: si el catálogo sigue cubriendo lo que el proveedor
 * devuelve. Contra los datos de hoy responde cero, porque el catálogo sembrado
 * cubre el cien por ciento de las 50 coincidencias observadas en `alma-afi`.
 *
 * Que deje de responder cero no es un error del sistema: es que apareció una
 * fuente nueva y hay que clasificarla. Mientras tanto esas consultas ya están
 * enrutadas al canal de mayor exigencia, así que el hueco no produce un falso
 * negativo, produce trabajo.
 */
export async function coberturaDelCatalogo(
  desde: string,
  hasta: string,
): Promise<CoberturaCatalogo | null> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data } = await svc
    .from('consultas_listas_dual')
    .select('tier_fuentes_sin_clasificar')
    .eq('workspace_id', workspaceId)
    .eq('tier_sin_clasificar', true)
    .gte('created_at', desde)
    .lte('created_at', hasta);

  const filas = (data ?? []) as Array<{ tier_fuentes_sin_clasificar: string[] | null }>;
  const fuentes = new Set<string>();
  for (const f of filas) {
    for (const nombre of f.tier_fuentes_sin_clasificar ?? []) fuentes.add(nombre);
  }

  return {
    consultas_con_fuente_desconocida: filas.length,
    fuentes: [...fuentes].sort(),
    desde,
    hasta,
  };
}
