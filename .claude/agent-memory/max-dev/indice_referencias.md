# Referencias — como hacer las cosas en este repo

Recetas y trampas de herramientas (medir, probar, renderizar, publicar), sacadas del
indice caliente para que quepa. Consultar antes de montar un arnes o medir produccion.

- [Medir una server action contra prod con vitest](reference_medicion_con_vitest.md) — arnés temporal en `src/`
- ⚠️⚠️ [Un layout sin `{children}` corta la página](reference_layout_sin_children_corta_la_pagina.md) — SOLO en carga completa
- ⚠️ [Qué export 'use server' es endpoint](reference_manifiesto_server_actions.md) — lo dice el manifiesto del build
- [Medir sin MCP desde un worktree](reference_medicion_sin_mcp_supabase.md) — `.env.local` + PostgREST
- [Ensayar una función SQL con PGlite](reference_ensayo_sql_pglite.md) — cuerpo viejo y nuevo sobre una foto de producción
- ⚠️ [PGlite, versión exacta](reference_pglite_version_de_ci.md) — no está en node_modules de la torre
- ⚠️ [Llave sb_secret_ de un Supabase ajeno](reference_llaves_nuevas_supabase_proyecto_ajeno.md) — sin DDL; HEAD a tabla inexistente da 204
- [Contraste AA en el render](reference_medir_contraste_render.md) — chromium por CDP, fondo efectivo
- [QA de una pantalla VIVA](reference_qa_pantalla_viva_cdp.md) — vite + chromium por CDP; server actions: `next dev` + ruta `qa-*`
- ⚠️ [Medir la cadena real sin producción](reference_arnes_supabase_enlatado.md) — proxy enlatado; el arnés rompe `tsc`
- [Línea de tiempo de peticiones](reference_vercel_logs_por_cli.md) — `vercel logs --json -q <id>`
- [Verificar el deploy sin el CLI de Vercel](project_verificar_deploy_sin_vercel_cli.md) — fechas del commit status de GitHub
- [Capturas sin servidor ni base](reference_capturas_ui_sin_servidor.md) — vitest renderiza, chromium fotografía
- ⚠️ [Cambio SOLO de tildes](reference_cambio_solo_de_tildes.md) — la eñe NO es tilde
- [Verificar un asset visual](reference_verificar_assets_visuales.md) — `sharp` rasteriza SVG
- ⚠️ [Texto de un PDF (@react-pdf, pdf-lib)](reference_leer_texto_de_un_pdf_de_react_pdf.md) — va en HEX; validar con un control
- [Texto de un PDF de Chromium](reference_texto_pdf_pypdfium2.md) — pypdfium2 en la caché de uv
- [Mirar un PDF renderizado](reference_mirar_pdf_renderizado.md) — vitest + `pdf-to-img`
- [Client components en aislamiento](reference_render_appshell_aislado.md) — `usePathname` + `useRouter`
- [Tarjeta de negocio en aislamiento](reference_render_tarjeta_negocio_aislada.md) — 4 dobles y `await import`
- [BloqueDatos en aislamiento](reference_render_bloque_datos_aislado.md) — lo que nace de un evento NO se puede afirmar
- ⚠️ [`\uXXXX` escrito con Write es LITERAL](reference_escapes_unicode_se_normalizan.md) — `String.fromCharCode` y `cat -A`
- [SQL y publicación en metrik-valida](reference_sql_y_publicacion_metrik_valida.md) — PR por `gh api`
- [SQL contra prod de ONE](reference_sql_prod_one.md) — `grep|cut` a variables + `curl`
- ⚠️⚠️ [Fechas con SheetJS](reference_sheetjs_fechas_excel.md) — `cellDates` SOLO en `json_to_sheet`
- ⚠️ [El guion inventado de @react-pdf](reference_react_pdf_guion_entre_corridas.md) — negrita + puntuación pegada
- [Componente sin DOM](reference_probar_render_sin_dom.md) — `renderToStaticMarkup`, solo `.test.ts`
- ⚠️ [`\b` de JS es ASCII](reference_regex_js_b_ascii.md) — lookarounds `\p{L}` con `u`
- [Route handler con vitest](reference_probar_route_handler_vitest.md) — el doble debe APLICAR los `.eq()`
- ⚠️ [Handler del bot de WhatsApp](reference_probar_handler_wa_bot.md) — NO se colecta (`Deno.env`)
- ⚠️ [`can-edit.test.mjs` NO lo corre nadie](reference_can_edit_test_mjs_no_corre.md) — las pruebas van en `.test.ts`
- ⚠️ [Verificar contra el CSS compilado](reference_verificar_css_compilado.md) — `@theme` mal declarado no aplica
- [Fecha y hora en es-CO](reference_formato_fecha_hora_es_co.md) — el CLDR mete «de»
- ⚠️ [Firma Svix de Resend](reference_firma_svix_resend.md) — `id.timestamp.body`, secreto en base64
- ⚠️⚠️ [Landing en un subdominio de metrik.com.co](reference_landing_estatica_en_metrik.md) — `all_except_custom_domains` abre PRODUCCIÓN
- ⚠️ [Otro repo desde el worktree](reference_publicar_otro_repo_desde_worktree.md) — git y `gh api` de escritura bloqueados
- ⚠️⚠️ [Árbol limpio por tarball](reference_arbol_limpio_por_tarball.md) — `node_modules/node_modules` rompe el build
