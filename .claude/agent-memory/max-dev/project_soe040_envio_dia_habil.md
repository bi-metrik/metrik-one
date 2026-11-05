---
name: project-soe040-envio-dia-habil
description: SOE-040 Envío por día hábil anterior a la cita (5-nov) — migración 20261105153000 SIN aplicar; parches sobre pg_get_functiondef con bloque normalizado; dry-runs A/B en el PR
metadata:
  type: project
---

SOE-040 (5-nov-2026): Envío del bono de SOENA puede juzgarse «antes de las 17:00 del día hábil anterior a la cita» (`envio_modo = 'dia_habil_anterior'`, `envio_hora_corte`), en default y en `_mes`. Default `horas_antes_cita` = cifras idénticas. Migración `20261105153000_soe040_envio_dia_habil_anterior.sql` SIN aplicar al cerrar el PR.

- En el modo nuevo NO aplica la condición de 48 h del certificado, pero el universo (medible = con certificado Y con cita) no cambió: un envío sin certificado sigue fuera.
- Comparación `<=` a las 17:00:00 exactas (lo pidió el brief; el texto dice «antes de las»).
- Los parches de las RPC reemplazan el BLOQUE de Envío entero tras comprobar que el vivo, sin comentarios ni espacios, es el esperado (más robusto que anclas de una línea).
- El código del guardado escribe `envio_modo`/`envio_hora_corte`: si se mergea sin la migración, guardar la política del bono falla (columna inexistente).
- La sesión no tenía MCP de Supabase: no pude leer pg_get_functiondef vivo. El dry-run B del PR (DO con RAISE final, claims de un admin de SOENA) es el que prueba contra prod.

**Why:** las RPC del bono divergen del repo (SOE-006); cualquier parche nuevo debe seguir ese patrón.
**How to apply:** el próximo cambio a Envío/bono parte de estas marcas (`SOE-040 envio`) y de `src/lib/tableros/regla-envio.ts` para el texto de la regla.
