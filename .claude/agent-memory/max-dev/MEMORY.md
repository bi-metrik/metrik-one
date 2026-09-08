# Max Dev — Memory Index

## Project memories

- [sprint-10 supervisor y contador](project_sprint10_roles.md) — Patrones para agregar roles nuevos, decisiones de supervisor/contador, campo area y display_role
- [SOENA pipeline VE 2026-04-05](project_soena_ve_pipeline.md) — Etapas, gates, custom fields, estado_ve, gotchas del flujo operativo VE/HEV/PHEV
- [Formato 010 DIAN](project_formulario_010_dian.md) — Overlay AcroForm, aplanado (flatten), seccional casilla 12 con código auto, presets config-driven, scripts de prueba
- [Emisión de cuentas de cobro](project_emision_cuentas_cobro.md) — Solo corre en producción (credenciales sensibles en Vercel); el paso 4 del cron sigue sin decisión de Mauricio
- ⚠️ [Cobros: mergear el cron = autorizar emisión](project_cobros_emision_gate.md) — un PR que cambie qué emite el cron dispara cuentas reales horas después; fuera del merge automático
- ⚠️ [Casillas gate faltantes SOENA](project_casillas_gate_faltantes.md) — 653 gates sin casilla no retienen nada; hueco abierto, el backfill de 297 no lo cubrió
- ⚠️ [Tablero de marketing SOENA](project_tablero_marketing_soena.md) — mergeado y aplicado, pero el módulo NO está encendido y el sync NO está desplegado; la atribución es last-touch
- [Tableros SOENA, olas 1 y 2](project_tableros_soena.md) — PRs #357 y #366: 4 migraciones sin aplicar, las tres definiciones de "venta", y los huecos que deciden plata
- ⚠️ [Consultas de listas facturables](project_consultas_listas_facturables.md) — cada consulta a SEIYA se cobra a AFI; probar solo con fixtures, validar antes del fetch
- ⚠️ [Git en worktree aislado](project_worktree_git_bloqueado.md) — git fuera se bloquea (pero el mantenimiento sin `-C` pasa); otra sesión te borra la rama; `gh pr merge` miente al fallar
- [Verificar el deploy sin el CLI de Vercel](project_verificar_deploy_sin_vercel_cli.md) — el CLI se cuelga en un worktree aislado; el commit status y los deployments de GitHub dan fechas absolutas
- ⚠️ [El hook de ownership no reconoce al teammate](project_hook_ownership_no_reconoce_teammate.md) — como teammate toda escritura en metrik-one se bloquea; no crear el flag a mano, pedir `/max`
- ⚠️ [Vistas server-only](project_vistas_server_only.md) — `v_venta_mes_comercial` revocada a `authenticated` devuelve vacío sin error; el `grant` viejo no sobrevive a la siguiente reescritura
- ⚠️ [staff es 1 fila por persona en TODA la base](project_staff_unique_global.md) — UNIQUE global de `profile_id`: el platform_admin en workspace ajeno opera con `staffId` null a propósito
- [La empresa espejo se sigue creando](project_empresa_espejo_se_sigue_creando.md) — decisión cerrada de Mauricio; solo el directorio dejó de listarla, y el predicado son DOS condiciones
- [Canal WhatsApp propio](project_canal_wa_propio.md) — webhook construido (#448) y sin desplegar; Gate 0 prohíbe persistir contenido y no se suscribe `history`
- ⚠️ [Bot Navigate (demo Grupo Progreso)](project_cardumen_navigate_demo.md) — motor determinista aparte del R1; deploy ANTES del SQL; `meta.ts` antes del modelo; golden del lector; idioma PRIMERO (#574, sin desplegar)
- [R4 liberación de contrapartes](project_r4_liberaciones.md) — PR #343: la regla de cobertura, por qué cuelga de la contraparte, y qué quedó para R3/R5
- ⚠️ [Techo de 1.000 filas de PostgREST](project_techo_postgrest.md) — `traerTodo` es la única vía para lecturas por lote; cuáles filas se pierden cambia entre corridas
- ⚠️ [Marcas de Siigo en SOENA](project_marcas_siigo_soena.md) — 11 corregidas; FV-2-244 salió con la cédula truncada y NO se toca; 15 terceros basura para Diana
- ⚠️ [Plantilla de cotización Termotech](project_plantilla_cotizacion_termotech.md) — PR #522: reusa `cotizacion_template_slug`, sin migración de esquema; falta UNA sentencia y la ficha del cliente está vacía
- [Formulario de Meta de SOENA](project_formulario_meta_soena.md) — #540 la ficha, #543 el rol del contacto; los cuatro valores ya medidos y la copia gemela en Deno
- [Vocabulario de activity_log](project_activity_log_vocabulario.md) — 754 son filas de bloque heredado; los eventos de aprobación son 311. CHECK y backfill aplicados
- ⚠️ [Cotizar por rubros: margen y precio manual](project_cotizacion_margen_rubros.md) — PR #514 sin mergear; el backfill decide si 11 ítems pierden $7,17M, y termotech no usa rubros
- [Descarga a Excel de /negocios](project_descarga_excel_negocios.md) — PR #525: el recaudado sale de los tramos BRUTOS de `v_cobro_valor`, no de la vista (bajó a base); punteros del spec caducos; sin QA en pantalla
- ⚠️ [Presupuesto vs Ejecutado](project_presupuesto_vs_ejecutado.md) — PRs #529 y #532: el bloque solo existe en 7 negocios de 4 workspaces (SOENA no lo tiene); la invariante que lo sostiene y el caso de $75M
- ⚠️ [Sucursal de Siigo y adopción de factura](project_siigo_sucursal_adopcion.md) — PR #550 sin mergear; las 252 marcas se autocorrigen solas (no hay backfill) y los 6 candidatos NO son una lista para aplicar
- [Gate de recaudo en facturación](project_gate_recaudo_facturacion.md) — #578 mergeado + enmienda #581: la banda del 1%, y por qué filtrar una fila borra TODAS sus acciones
- ⚠️ [Lector de Navigate = Gemini 3.1 Flash-Lite](project_navigate_lector_gemini.md) — PR #570 mergeado, wa-webhook SIN redesplegar; D-20 abierto; hueco de `ninguno` en el intérprete
- ⚠️ [Declaración juramentada de SOENA](project_declaracion_juramentada_soena.md) — PR #545: un campo no opcional BLOQUEA el PDF (282→307 casos); las 3 decisiones que no se revierten y lo que falta preguntarle a Deisy
- ⚠️ [Duplicados: solo las facturas libres](project_duplicado_hermanos_siigo.md) — PR #561 sin mergear; el vínculo es la marca, NO el contacto (V0321/V0323 lo prueba), y la línea de hermanos no se ve en el caso que la motivó
- [Sucursal y adopción de factura en Siigo](project_siigo_sucursal_adopcion.md) — PR #550 ya en `main`; su guardián de duplicados quedó superado por el #561
- [Certificado UPME en Anexos](project_certificado_upme_anexos.md) — PR #548 mergeado y aplicado: cómo se verifica una migración del MCP sin leer el ledger, y por qué NO es gate

- ⚠️⚠️ [Dedup de contactos: nombre y usuario de WhatsApp](project_dedup_contactos_webhook.md) — PR #565 sin mergear: migración ANTES del deploy o Meta reintenta; el DROP de la sobrecarga es obligatorio
- ⚠️⚠️ [Reproceso de documentos migrados](project_reproceso_documentos_migrados.md) — el reproceso puede BORRAR datos y no es idempotente; `manual:true` es confianza baja, no edición humana
- ⚠️ [Aviso de recaudo sin salida](project_aviso_recaudo_sin_salida.md) — PR #569 sin mergear: por qué el listón es `valorARecaudar` y no la etapa, y el punto ciego que eso evita

## Referencias

- [Medir una server action contra prod con vitest](reference_medicion_con_vitest.md) — arnés temporal en `src/`, sin reimplementar el criterio; y el `User-Agent` que la Management API exige
- [Medir sin MCP desde un worktree aislado](reference_medicion_sin_mcp_supabase.md) — el acceso varía por sesión: probar primero `.env.local`+PostgREST, después la Management API
- [Mirar de verdad un PDF renderizado](reference_mirar_pdf_renderizado.md) — sin poppler ni sudo: vitest + `pdf-to-img` en prefijo aparte; y cómo probar que otro PDF no cambió byte a byte
- [Renderizar el AppShell en aislamiento](reference_render_appshell_aislado.md) — sí se puede: solo `usePathname` + `useRouter` (este lo pide el FAB); Supabase no se dobla
- [SQL contra prod de ONE](reference_sql_prod_one.md) — comprobar el acceso al empezar (varía por sesión); ensayo con rollback y ledger; la verificación va en sentencia aparte
- [Fechas e hipervínculos con SheetJS](reference_sheetjs_fechas_excel.md) — el `Date` se arma con la hora de pared en componentes LOCALES; `cellDates` en las dos llamadas; medido en UTC y Bogotá
- ⚠️ [El guion inventado de @react-pdf](reference_react_pdf_guion_entre_corridas.md) — negrita + puntuación pegada imprime un guion en el TEXTO; `hyphenationCallback` no lo evita
- [Probar un componente sin DOM](reference_probar_render_sin_dom.md) — vitest corre en `node` y solo recoge `.test.ts`: `renderToStaticMarkup` + `React.createElement`

## Feedback

- [Las cifras del brief caducan](feedback_cifras_del_brief_caducan.md) — se re-miden al hacer el QA; otra sesión puede mover los datos de producción a mitad del encargo
- [Pruebas por mutación](feedback_pruebas_por_mutacion.md) — no creerle a una prueba hasta verla fallar; el doble reproduce el defecto; y toda comparación A-vs-B idéntica necesita un control que difiera
- [Medir antes de construir](feedback_medir_antes_de_construir.md) — La medición va antes de escribir, y las premisas del encargo se comprueban en vez de heredarse
