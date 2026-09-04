# Max Dev — Memory Index

## Project memories

- [sprint-10 supervisor y contador](project_sprint10_roles.md) — Patrones para agregar roles nuevos, decisiones de supervisor/contador, campo area y display_role
- [SOENA pipeline VE 2026-04-05](project_soena_ve_pipeline.md) — Etapas, gates, custom fields, estado_ve, gotchas del flujo operativo VE/HEV/PHEV
- [Formato 010 DIAN](project_formulario_010_dian.md) — Overlay AcroForm, aplanado (flatten), seccional casilla 12 con código auto, presets config-driven, scripts de prueba
- [Emisión de cuentas de cobro](project_emision_cuentas_cobro.md) — Solo corre en producción (credenciales sensibles en Vercel); el paso 4 del cron sigue sin decisión de Mauricio
- ⚠️ [Casillas gate faltantes SOENA](project_casillas_gate_faltantes.md) — 653 gates sin casilla no retienen nada; hueco abierto, el backfill de 297 no lo cubrió
- ⚠️ [Tablero de marketing SOENA](project_tablero_marketing_soena.md) — mergeado y aplicado, pero el módulo NO está encendido y el sync NO está desplegado; la atribución es last-touch
- [Tableros SOENA, olas 1 y 2](project_tableros_soena.md) — PRs #357 y #366: 4 migraciones sin aplicar, las tres definiciones de "venta", y los huecos que deciden plata
- ⚠️ [Consultas de listas facturables](project_consultas_listas_facturables.md) — cada consulta a SEIYA se cobra a AFI; probar solo con fixtures, validar antes del fetch
- ⚠️ [Git en worktree aislado](project_worktree_git_bloqueado.md) — git fuera se bloquea; otra sesión te borra la rama; `gh pr merge` miente al fallar
- [R4 liberación de contrapartes](project_r4_liberaciones.md) — PR #343: la regla de cobertura, por qué cuelga de la contraparte, y qué quedó para R3/R5
- ⚠️ [Techo de 1.000 filas de PostgREST](project_techo_postgrest.md) — `traerTodo` es la única vía para lecturas por lote; cuáles filas se pierden cambia entre corridas
- ⚠️ [Marcas de Siigo en SOENA](project_marcas_siigo_soena.md) — 11 corregidas; FV-2-244 salió con la cédula truncada y NO se toca; 15 terceros basura para Diana
- ⚠️ [Plantilla de cotización Termotech](project_plantilla_cotizacion_termotech.md) — PR #522: reusa `cotizacion_template_slug`, sin migración de esquema; falta UNA sentencia y la ficha del cliente está vacía
- [Vocabulario de activity_log](project_activity_log_vocabulario.md) — 754 son filas de bloque heredado; los eventos de aprobación son 311. CHECK y backfill aplicados
- ⚠️ [Cotizar por rubros: margen y precio manual](project_cotizacion_margen_rubros.md) — PR #514 sin mergear; el backfill decide si 11 ítems pierden $7,17M, y termotech no usa rubros
- [Descarga a Excel de /negocios](project_descarga_excel_negocios.md) — PR #525: el recaudado sale de los tramos BRUTOS de `v_cobro_valor`, no de la vista (bajó a base); punteros del spec caducos; sin QA en pantalla

## Referencias

- [Medir una server action contra prod con vitest](reference_medicion_con_vitest.md) — arnés temporal en `src/`, sin reimplementar el criterio; y el `User-Agent` que la Management API exige
- [Medir sin MCP desde un worktree aislado](reference_medicion_sin_mcp_supabase.md) — Management API + Graph API leyendo el token con un script; ensayo con `DO`+`RAISE`
- [Mirar de verdad un PDF renderizado](reference_mirar_pdf_renderizado.md) — sin poppler ni sudo: vitest + `pdf-to-img` en prefijo aparte; y cómo probar que otro PDF no cambió byte a byte
- [SQL contra prod de ONE](reference_sql_prod_one.md) — la Management API también escribe: ensayo con rollback, respaldo y ledger. La verificación va en sentencia aparte
- [Fechas e hipervínculos con SheetJS](reference_sheetjs_fechas_excel.md) — el `Date` se arma con la hora de pared en componentes LOCALES; `cellDates` en las dos llamadas; medido en UTC y Bogotá

## Feedback

- [Las cifras del brief caducan](feedback_cifras_del_brief_caducan.md) — se re-miden al hacer el QA; otra sesión puede mover los datos de producción a mitad del encargo
- [Pruebas por mutación](feedback_pruebas_por_mutacion.md) — no creerle a una prueba hasta verla fallar; el doble reproduce el defecto, no solo la tabla
- [Medir antes de construir](feedback_medir_antes_de_construir.md) — La medición va antes de escribir, y las premisas del encargo se comprueban en vez de heredarse
