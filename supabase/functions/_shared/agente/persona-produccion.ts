// ============================================================
// El paso a una persona en producción: la fila de `asistente_escalamientos` (spec 2026-10-26, §4.2 y §2.7)
// ------------------------------------------------------------
// Tabla de la migración 20261026183000 (PR #1282, ya aplicada): solo `service_role` la escribe. Quien llama la escribe
// a mejor esfuerzo (`registrarEscalamiento`, `persona.ts`): si el insert falla, lanza aquí y allá queda en el log.
// ============================================================

import type { SupabaseClient } from '../types.ts';
import type { PuertoEscalamientos } from './persona.ts';

export function escalamientosSupabase(supabase: SupabaseClient): PuertoEscalamientos {
  return {
    async registrar(f) {
      const { error } = await supabase.from('asistente_escalamientos').insert(f);
      if (error) throw new Error(`asistente_escalamientos: ${error.code ?? ''} ${error.message}`);
    },
  };
}
