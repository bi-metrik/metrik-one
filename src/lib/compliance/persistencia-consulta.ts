/**
 * Lo que se calcula al lado de una consulta antes de guardarla: la clasificación
 * por tier (bloque A del concepto de Emilio) y la vigencia que produce (R2).
 *
 * Vive fuera de `compliance-dual.ts` porque tiene DOS llamadores con contextos
 * distintos: la consulta que hace una persona desde la pantalla, y el barrido de
 * R3, que corre sin sesión desde un cron. Duplicarlo habría dejado que la
 * clasificación de una revalidación derivara de la de una consulta manual — y
 * entonces la misma contraparte tendría dos vigencias calculadas con reglas que
 * se separan con el tiempo.
 *
 * Ninguna de las dos funciones lanza: la consulta ya se pagó contra la cuenta
 * del cliente y perderla por un fallo de cálculo sería cambiar un dato
 * incompleto por ninguno.
 */

import { cargarCatalogoTierVigente } from '@/lib/actions/compliance-tier-catalogo';
import { cargarConfigPeriodicidad } from '@/lib/actions/compliance-periodicidad';
import { clasificarConsulta, verificarCeroSupresion, type TierResuelto } from './tier-fuentes';
import { calcularVigencia } from './periodicidad';
import { todayBogotaISO } from '@/lib/dates/bogota';
import type { InformaMatch } from '@/lib/actions/compliance-dual';

/** Las columnas de clasificación que se escriben junto a la consulta. */
export type ClasificacionPersistida = {
  tier_catalogo_version: number | null;
  tier_maximo: string | null;
  tier_sin_clasificar: boolean;
  tier_fuentes_sin_clasificar: string[] | null;
  tier_hallazgos: number | null;
  tier_duplicados: number | null;
  tier_opera: boolean | null;
};

/**
 * Clasifica las coincidencias para guardarlas junto a la consulta.
 *
 * Tres caminos de fallo, y los tres caen del mismo lado:
 *
 *   - Sin catálogo sembrado: no se clasifica y se marca `tier_sin_clasificar`.
 *   - El catálogo no resuelve alguna fuente (C4): se clasifica y se marca igual.
 *   - La verificación de cero supresión falla (C3): se DESCARTA la clasificación
 *     entera y se marca igual.
 *
 * `tier_sin_clasificar` es lo que enruta al canal de mayor exigencia. Que los
 * tres caminos terminen ahí no es pereza: los tres significan lo mismo, que no
 * sabemos qué es lo que la fuente devolvió, y ante esa duda el lado correcto es
 * el que exige más.
 *
 * Nunca lanza. La consulta ya se pagó contra la cuenta del cliente: perderla por
 * un problema de clasificación sería cambiar un dato incompleto por ninguno.
 */
export async function clasificarParaGuardar(
  matches: InformaMatch[] | null | undefined,
): Promise<ClasificacionPersistida> {
  const sinClasificacion: ClasificacionPersistida = {
    tier_catalogo_version: null,
    tier_maximo: null,
    tier_sin_clasificar: true,
    tier_fuentes_sin_clasificar: null,
    tier_hallazgos: null,
    tier_duplicados: null,
    tier_opera: null,
  };

  // Una consulta sin coincidencias no tiene nada que clasificar, y marcarla
  // como sin clasificar sería mandar al canal de mayor exigencia a una
  // contraparte que salió limpia.
  if (!matches || matches.length === 0) {
    return { ...sinClasificacion, tier_sin_clasificar: false };
  }

  let catalogo;
  try {
    catalogo = await cargarCatalogoTierVigente();
  } catch {
    return sinClasificacion;
  }
  if (!catalogo) return sinClasificacion;

  const clasificada = clasificarConsulta(matches, catalogo);

  // C3: si la clasificación perdió una coincidencia, no se guarda. Un conteo que
  // esconde un hallazgo es peor que no tener conteo.
  if (!verificarCeroSupresion(clasificada, matches.length)) {
    console.error(
      '[tier] cero_supresion_violada',
      { devueltas: matches.length, hallazgos: clasificada.hallazgos.length, duplicados: clasificada.duplicados.length },
    );
    return { ...sinClasificacion, tier_catalogo_version: catalogo.version };
  }

  return {
    tier_catalogo_version: catalogo.version,
    tier_maximo: clasificada.tierMaximo,
    tier_sin_clasificar: clasificada.haySinClasificar,
    tier_fuentes_sin_clasificar: clasificada.fuentesSinClasificar.length > 0
      ? clasificada.fuentesSinClasificar
      : null,
    tier_hallazgos: clasificada.hallazgos.length,
    tier_duplicados: clasificada.duplicados.length,
    tier_opera: clasificada.opera,
  };
}

/**
 * Traduce la clasificación guardada a la vigencia de la consulta (R2).
 *
 * Se apoya en `tier_maximo` y `tier_sin_clasificar` en vez de volver a clasificar:
 * la fila y su vigencia tienen que hablar de lo mismo. Si alguna vez difieren,
 * el historial diría un tier y una fecha calculada con otro.
 *
 * Nunca lanza. Una consulta ya pagada no se pierde porque falló el cálculo de
 * una fecha; se guarda sin vigencia, que la pantalla muestra como tal.
 */
export async function calcularVigenciaParaGuardar(
  workspaceId: string,
  clasificacion: ClasificacionPersistida,
): Promise<{ vigente_hasta: string | null; vigencia_meses: number | null; vigencia_nivel: string | null }> {
  try {
    const config = await cargarConfigPeriodicidad(workspaceId);

    // `tiersPresentes` reducido a lo que la fila guarda. Se agrega
    // `sin_clasificar` cuando la marca está puesta aunque el tier máximo sea
    // otro: la fuente desconocida tiene que poder ganar la vigencia más corta.
    const presentes: TierResuelto[] = [];
    if (clasificacion.tier_maximo) presentes.push(clasificacion.tier_maximo as TierResuelto);
    if (clasificacion.tier_sin_clasificar && !presentes.includes('sin_clasificar')) {
      presentes.push('sin_clasificar');
    }

    const v = calcularVigencia(
      todayBogotaISO(),
      presentes,
      config,
      clasificacion.tier_opera === true,
    );
    return {
      vigente_hasta: v.vigente_hasta,
      vigencia_meses: v.meses,
      vigencia_nivel: v.nivel,
    };
  } catch {
    return { vigente_hasta: null, vigencia_meses: null, vigencia_nivel: null };
  }
}
