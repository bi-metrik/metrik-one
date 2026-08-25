'use server';

/**
 * Carga del catálogo de tier de fuentes (dictamen 2026-08-25).
 *
 * Es el único puente entre las tablas `compliance_tier_*` y la regla pura de
 * `@/lib/compliance/tier-fuentes`. Nada consume esto todavía: el veredicto y las
 * bandejas están fuera de alcance hasta que la firma jurídica esté resuelta.
 *
 * El catálogo es GLOBAL del producto: no se filtra por workspace y por eso esta
 * función no pide `getWorkspace()`. El tier es un hecho normativo —qué ES la
 * fuente— no una preferencia de cliente. Lo que sí será por workspace, más
 * adelante, es qué tier frena una contratación.
 */

import { createServiceClient } from '@/lib/supabase/server';
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
