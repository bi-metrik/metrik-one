// Bandera por estudio para el entrevistador R1/R2.
//
// R1/R2 (`r1.ts`, `r2.ts`) es el motor conversacional con Claude Haiku, y a diferencia del motor
// de Navigate el modelo SI redacta lo que ve la persona (`output.message_to_user`). Hasta el
// 2026-09-24 cualquier fila nueva de `cardumen_estudios` con `modo = 'chat'` y un spec sin
// `motor` lo abria sin que nadie lo decidiera. Ahora hace falta decirlo: `spec.entrevistador_libre`
// en `true`. Apagado por defecto.
//
// Los dos estudios que ya corren con R1/R2 en produccion (medido el 2026-09-24 en
// `cardumen_estudios`: araucania-turismo y trappvel-equipo, los dos activos) quedan en esta lista
// para no cortarles la conducta sin una migracion. Cuando su spec lleve la bandera, se sacan de aqui.

export const ESTUDIOS_ENTREVISTADOR_LIBRE_PREVIOS: ReadonlySet<string> = new Set([
  "araucania-turismo",
  "trappvel-equipo",
]);

export function entrevistadorLibreHabilitado(
  slug: string,
  spec: { motor?: string; entrevistador_libre?: boolean } | null | undefined,
): boolean {
  if (!spec || spec.motor === "navigate") return false;
  if (spec.entrevistador_libre === true) return true;
  return ESTUDIOS_ENTREVISTADOR_LIBRE_PREVIOS.has(slug);
}

/** Texto fijo cuando un estudio no tiene habilitado el entrevistador. No promete nada. */
export const TEXTO_ESTUDIO_NO_DISPONIBLE = "Este estudio no está disponible por ahora. Gracias por escribir.";
