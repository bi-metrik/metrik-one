# Max Dev — Memory Index

## Project memories

- [sprint-10 supervisor y contador](project_sprint10_roles.md) — Patrones para agregar roles nuevos, decisiones de supervisor/contador, campo area y display_role
- [SOENA pipeline VE 2026-04-05](project_soena_ve_pipeline.md) — Etapas, gates, custom fields, estado_ve, gotchas del flujo operativo VE/HEV/PHEV
- [Formato 010 DIAN](project_formulario_010_dian.md) — Overlay AcroForm, aplanado (flatten), seccional casilla 12 con código auto, presets config-driven, scripts de prueba
- [Emisión de cuentas de cobro](project_emision_cuentas_cobro.md) — Solo corre en producción (credenciales sensibles en Vercel); el paso 4 del cron sigue sin decisión de Mauricio
- ⚠️ [Casillas gate faltantes SOENA](project_casillas_gate_faltantes.md) — 653 gates sin casilla no retienen nada; hueco abierto, el backfill de 297 no lo cubrió
- [Tableros SOENA, olas 1 y 2](project_tableros_soena.md) — PRs #357 y #366: 4 migraciones sin aplicar, las tres definiciones de "venta", y los huecos que deciden plata

## Referencias

- [SQL contra prod de ONE](reference_sql_prod_one.md) — medir SÍ se puede desde un subagente (Management API); aplicar no. Las RPC con guard salen vacías sin JWT

## Feedback

- [Medir antes de construir](feedback_medir_antes_de_construir.md) — La medición va antes de escribir, y las premisas del encargo se comprueban en vez de heredarse
