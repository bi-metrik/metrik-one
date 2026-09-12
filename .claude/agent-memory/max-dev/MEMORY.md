# Max Dev — Memory Index

## Project memories

- [sprint-10 supervisor y contador](project_sprint10_roles.md) — Patrones para agregar roles nuevos, decisiones de supervisor/contador, campo area y display_role
- [SOENA pipeline VE 2026-04-05](project_soena_ve_pipeline.md) — Etapas, gates, custom fields, estado_ve, gotchas del flujo operativo VE/HEV/PHEV
- [Formato 010 DIAN](project_formulario_010_dian.md) — Overlay AcroForm, aplanado (flatten), seccional casilla 12 con código auto, presets config-driven, scripts de prueba
- [Emisión de cuentas de cobro](project_emision_cuentas_cobro.md) — Solo corre en producción (credenciales sensibles en Vercel); el paso 4 del cron sigue sin decisión de Mauricio
- ⚠️ [Cobros: mergear el cron = autorizar emisión](project_cobros_emision_gate.md) — un PR que cambie qué emite el cron dispara cuentas reales horas después; fuera del merge automático
- ⚠️ [Suscripciones de licencia, Fase 1](project_suscripciones_cobro_automatico.md) — PR #577 sin mergear: nadie se suspende solo, la tabla nace vacía, AFI son 3 planes, y 3 decisiones esperan a Mauricio
- ⚠️ [Casillas gate faltantes SOENA](project_casillas_gate_faltantes.md) — 653 gates sin casilla no retienen nada; hueco abierto, el backfill de 297 no lo cubrió
- ⚠️ [Tablero de marketing SOENA](project_tablero_marketing_soena.md) — mergeado y aplicado, pero el módulo NO está encendido y el sync NO está desplegado; la atribución es last-touch
- [Tableros SOENA, olas 1 y 2](project_tableros_soena.md) — PRs #357 y #366: 4 migraciones sin aplicar, las tres definiciones de "venta", y los huecos que deciden plata
- ⚠️ [/equipo segmentada por mes](project_equipo_por_mes.md) — PR #597 sin mergear (falta QA en pantalla): el 4925%, el reloj propio de la pestaña de operaciones y lo que NO se segmenta
- ⚠️ [Consultas de listas facturables](project_consultas_listas_facturables.md) — cada consulta a SEIYA se cobra a AFI; probar solo con fixtures, validar antes del fetch
- ⚠️ [Git en worktree aislado](project_worktree_git_bloqueado.md) — la rama se crea ANTES de leer (el switch cambia los archivos bajo tus pies); el lint de CI no ve lo sin commitear; otra sesión te borra la rama; `gh pr merge` miente al fallar; otro repo = tarball + API; el scratchpad es COMPARTIDO
- ⚠️ [Valida paquete documental v1.1](project_valida_paquete_documental_v11.md) — PR #18 sin mergear: 2 menciones de INTERPOL son de Lucía; pie AFI del lote y /v/ quedó fuera; migración 10 años pendiente
- [Verificar el deploy sin el CLI de Vercel](project_verificar_deploy_sin_vercel_cli.md) — el CLI se cuelga en un worktree aislado; el commit status y los deployments de GitHub dan fechas absolutas
- ⚠️ [El hook de ownership no reconoce al teammate](project_hook_ownership_no_reconoce_teammate.md) — como teammate toda escritura en metrik-one se bloquea; no crear el flag a mano, pedir `/max`
- ⚠️ [Vistas server-only](project_vistas_server_only.md) — `v_venta_mes_comercial` revocada a `authenticated` devuelve vacío sin error; el `grant` viejo no sobrevive a la siguiente reescritura
- ⚠️ [staff es 1 fila por persona en TODA la base](project_staff_unique_global.md) — UNIQUE global de `profile_id`: el platform_admin en workspace ajeno opera con `staffId` null a propósito
- [La empresa espejo se sigue creando](project_empresa_espejo_se_sigue_creando.md) — decisión cerrada de Mauricio; solo el directorio dejó de listarla, y el predicado son DOS condiciones
- [Canal WhatsApp propio](project_canal_wa_propio.md) — webhook construido (#448) y sin desplegar; Gate 0 prohíbe persistir contenido y no se suscribe `history`
- ⚠️ [Bot Navigate (demo Grupo Progreso)](project_cardumen_navigate_demo.md) — motor determinista aparte del R1; deploy ANTES del SQL; idioma PRIMERO (#574); tríada con botones (#579): explícito no se confirma, modelo sí; un número significa distinto por paso; `wa-webhook` SIN desplegar
- [R4 liberación de contrapartes](project_r4_liberaciones.md) — PR #343: la regla de cobertura, por qué cuelga de la contraparte, y qué quedó para R3/R5
- ⚠️ [Techo de 1.000 filas de PostgREST](project_techo_postgrest.md) — `traerTodo` es la única vía para lecturas por lote; cuáles filas se pierden cambia entre corridas
- ⚠️ [Marcas de Siigo en SOENA](project_marcas_siigo_soena.md) — 11 corregidas; FV-2-244 salió con la cédula truncada y NO se toca; 15 terceros basura para Diana
- ⚠️ [Plantilla de cotización Termotech](project_plantilla_cotizacion_termotech.md) — PR #522: reusa `cotizacion_template_slug`, sin migración de esquema; falta UNA sentencia y la ficha del cliente está vacía
- [Formulario de Meta de SOENA](project_formulario_meta_soena.md) — #540 la ficha, #543 el rol del contacto; los cuatro valores ya medidos y la copia gemela en Deno
- [Vocabulario de activity_log](project_activity_log_vocabulario.md) — 754 son filas de bloque heredado; los eventos de aprobación son 311. CHECK y backfill aplicados
- ⚠️ [Cotizar por rubros: margen y precio manual](project_cotizacion_margen_rubros.md) — PR #514 sin mergear; el backfill decide si 11 ítems pierden $7,17M, y termotech no usa rubros
- [Descarga a Excel de /negocios](project_descarga_excel_negocios.md) — PR #525: el recaudado sale de los tramos BRUTOS de `v_cobro_valor`, no de la vista (bajó a base); punteros del spec caducos; sin QA en pantalla
- ⚠️⚠️ [/negocios se publica como hoja de Google](project_export_negocios_a_drive.md) — PR #625 sin mergear: el `jsonb_set` que no creaba el contenedor ya está corregido, pero la migración sigue SIN aplicar, Drive nunca se ejercitó y el share está apagado
- ⚠️⚠️ ["Todos" incluye cerrados](project_todos_incluye_cerrados.md) — PR #607 mergeado: escribir `cierre_motivo` habría roto TODO cierre (CHECK contra `stage_actual`); el SLA seguía corriendo en los 33 cerrados
- ⚠️ [El cierre se deriva de `estado`](project_cierre_desde_estado.md) — PR #609 sin mergear: el mapa es lista CERRADA (hay 2 `activo` reales) y la ficha del negocio sigue leyendo la columna muerta a propósito
- ⚠️⚠️ [Un cerrado sale de circulación](project_negocio_cerrado_solo_lectura.md) — PR #610 sin mergear: el recibo de caja NO se corta (7 de 53 alcanzables) y la factura sí (0); el banner sigue intacto a propósito
- ⚠️ [El buscador avisa de otras pestañas](project_aviso_otras_pestanas.md) — PR #611 sin mergear: por qué NO se ignora el chip de fase, el hueco de `hayEnFaseEtapa` que se cubre por POSICIÓN en el JSX, y el clic que ninguna prueba ejercita
- ⚠️ [Presupuesto vs Ejecutado](project_presupuesto_vs_ejecutado.md) — PRs #529 y #532: el bloque solo existe en 7 negocios de 4 workspaces (SOENA no lo tiene); la invariante que lo sostiene y el caso de $75M
- ⚠️ [Sucursal de Siigo y adopción de factura](project_siigo_sucursal_adopcion.md) — PR #550 sin mergear; las 252 marcas se autocorrigen solas (no hay backfill) y los 6 candidatos NO son una lista para aplicar
- [Gate de recaudo en facturación](project_gate_recaudo_facturacion.md) — #578 mergeado + enmienda #581: la banda del 1%, y por qué filtrar una fila borra TODAS sus acciones
- ⚠️⚠️ [PQR rechazado: el desenlace que devuelve el caso](project_pqr_rechazado_desenlace.md) — #603 mergeado, config SOENA SIN aplicar; archivar el dato NO rompe el bucle (lo rompe el gate), y otro gate dejaba el frente inalcanzable para 44 casos
- ⚠️⚠️ [Seguimiento de citas DIAN](project_seguimiento_citas_dian.md) — #598 mergeado, config SOENA SIN aplicar; el `solo_si` que evitó el único falso positivo y lo que no se verificó
- ⚠️ [Lector de Navigate = Gemini 3.1 Flash-Lite](project_navigate_lector_gemini.md) — PR #570 mergeado, wa-webhook SIN redesplegar; D-20 abierto; hueco de `ninguno` en el intérprete
- ⚠️ [Declaración juramentada de SOENA](project_declaracion_juramentada_soena.md) — PR #545: un campo no opcional BLOQUEA el PDF (282→307 casos); las 3 decisiones que no se revierten y lo que falta preguntarle a Deisy
- ⚠️ [Duplicados: solo las facturas libres](project_duplicado_hermanos_siigo.md) — PR #561 sin mergear; el vínculo es la marca, NO el contacto (V0321/V0323 lo prueba), y la línea de hermanos no se ve en el caso que la motivó
- [Sucursal y adopción de factura en Siigo](project_siigo_sucursal_adopcion.md) — PR #550 ya en `main`; su guardián de duplicados quedó superado por el #561
- [Certificado UPME en Anexos](project_certificado_upme_anexos.md) — PR #548 mergeado y aplicado: cómo se verifica una migración del MCP sin leer el ledger, y por qué NO es gate
- ⚠️ [Tokens Pino Profundo](project_tokens_pino_profundo.md) — #601 ya mergeado: el acento es invisible sobre carbón, y el branding por workspace nunca pudo aplicar fuera del sidebar
- ⚠️ [Icono de app Pino](project_icono_app_pino.md) — PR #602 sin mergear: el `.ico` gana precedencia sobre el `.svg`, y la geometría hay que fitearla contra el PNG, no leerla del generador
- ⚠️ [Capturas de Sustenta para la landing de AFI](project_capturas_sustenta_landing.md) — datos FICTICIOS; el lockup «MéTRIK sustenta» sigue solo en la foto, pero las tildes YA se corrigieron en el producto (#613)
- ⚠️ [QA en pantalla de las tildes de compliance](project_qa_tildes_compliance.md) — #613 quedó bien; el badge muestra el valor crudo («Automatico») y quedan 7 erratas, una pegada al título ya corregido
- ⚠️⚠️ [Landing de Sustenta](project_landing_sustenta.md) — ya soltó el sector y tiene la franja de normas (ejemplos, NUNCA cobertura); por qué el gate no puede prohibir la raíz «garantiz», y el puerto que otra sesión te roba
- ⚠️ ["Plata" está vetada en copy público](project_lexico_plata_vetada.md) — #614 (rótulo P1) y #616 (banner de alcance) cerrados; quedan ~19 visibles y `falta_plata` es identificador persistido, no copy

- ⚠️⚠️ [Dedup de contactos: nombre y usuario de WhatsApp](project_dedup_contactos_webhook.md) — PR #565 sin mergear: migración ANTES del deploy o Meta reintenta; el DROP de la sobrecarga es obligatorio
- ⚠️⚠️ [Reproceso de documentos migrados](project_reproceso_documentos_migrados.md) — el reproceso puede BORRAR datos y no es idempotente; `manual:true` es confianza baja, no edición humana
- ⚠️ [Routing respeta el `condition` del bloque](project_routing_condition_bloque.md) — PR #586 mergeado: el radio real es UN routing de todo el sistema; los 177 huérfanos siguen sin limpiar
- ⚠️ [Aviso de recaudo sin salida](project_aviso_recaudo_sin_salida.md) — PR #569 sin mergear: por qué el listón es `valorARecaudar` y no la etapa, y el punto ciego que eso evita
- ⚠️⚠️ [Acuses de Resend en avisos_cliente](project_acuses_resend_avisos_cliente.md) — PR #596 sin mergear: el orden de despliegue no es negociable, `rebotado` queda invisible en el producto, y `suppressed` es un hueco abierto
- ⚠️ [FTO del State Dept en Valida](project_valida_fto_state_dept.md) — #33, #34 y #35 mergeados y la lista YA activa (6 fuentes); la privacidad NO enumera la FTO y la dedup de la migr. 0013 sigue abierta
- ⚠️⚠️ [El plazo de retencion ya se vigila en CI](project_retencion_control_en_ci.md) — #634 y #38 mergeados; el expediente KYC sigue en CINCO anios (abierto), y Valida por fin tiene CI
- ⚠️⚠️ [Cierre del frente de datos personales KYC](project_valida_privacidad_v13.md) — diez (10) años; el control cruzado son 5 superficies (#629). ⚠️ Su parte de «ningún CI lo vigila» CADUCÓ
- ⚠️⚠️ [Valida Diligencia v2: SIRI + SECOP II](project_valida_diligencia_v2.md) — entregado como patch SIN commit ni PR (`../metrik-valida-wt-diligencia-v2-pendiente/`); `listas.modulo` aísla el SARLAFT; el PR #15 necesita el mismo filtro
- [Soporte de listas para el operador](project_soporte_listas_operator.md) — #631 mergeado: `/compliance/listas` NO tiene gate por rol (la ruta era el único candado) y `contador` sigue fuera a propósito

## Referencias

- [Medir una server action contra prod con vitest](reference_medicion_con_vitest.md) — arnés temporal en `src/`, sin reimplementar el criterio; y el `User-Agent` que la Management API exige
- [Medir sin MCP desde un worktree aislado](reference_medicion_sin_mcp_supabase.md) — el acceso varía por sesión: probar primero `.env.local`+PostgREST, después la Management API
- [Medir contraste AA en el render, no en el CSS](reference_medir_contraste_render.md) — chromium por CDP, fondo efectivo subiendo el árbol, y el control antes/después que dice si tocaste de más
- [Capturas de pantallas reales sin servidor ni base](reference_capturas_ui_sin_servidor.md) — vitest renderiza, vite compila el CSS y chromium fotografía; rehacer una tanda se verifica con diff de píxeles, y la foto va DESPUÉS del último render
- ⚠️ [Cambio SOLO de tildes, y la eñe aparte](reference_cambio_solo_de_tildes.md) — la eñe NO es tilde (se corrige sola); hay `anos` que rompen código si los tocas, y el grep compuesto miente
- [Verificar un asset visual contra el oficial](reference_verificar_assets_visuales.md) — `sharp` ya está y rasteriza SVG; los `<link>` de icono se leen del HTML del build; el preview de Vercel está tras SSO
- [Mirar de verdad un PDF renderizado](reference_mirar_pdf_renderizado.md) — sin poppler ni sudo: vitest + `pdf-to-img` en prefijo aparte; y cómo probar que otro PDF no cambió byte a byte
- [Renderizar client components en aislamiento](reference_render_appshell_aislado.md) — el AppShell solo pide `usePathname`+`useRouter`; un import de VALOR desde un `'use server'` sí se dobla (uno de tipo no)
- [Renderizar la tarjeta de negocio en aislamiento](reference_render_tarjeta_negocio_aislada.md) — 4 dobles y `await import`; encontró el «26 de sept» que ninguna prueba pura veía
- [SQL y publicacion en metrik-valida](reference_sql_y_publicacion_metrik_valida.md) — si el clasificador tapa las credenciales, el catalogo vivo se lee en las paginas publicas; copia archivo por archivo, PR por `gh api`, y restaurar el checkout
- [SQL contra prod de ONE](reference_sql_prod_one.md) — comprobar el acceso al empezar (varía por sesión); ensayo con rollback y ledger; la verificación va en sentencia aparte
- ⚠️⚠️ [Fechas e hipervínculos con SheetJS](reference_sheetjs_fechas_excel.md) — `cellDates` SOLO en `json_to_sheet`, y ahí no sirve de nada si la fila trae texto: hay que parsear a `Date` antes
- ⚠️ [El guion inventado de @react-pdf](reference_react_pdf_guion_entre_corridas.md) — negrita + puntuación pegada imprime un guion en el TEXTO; `hyphenationCallback` no lo evita
- [Probar un componente sin DOM](reference_probar_render_sin_dom.md) — vitest corre en `node` y solo recoge `.test.ts`: `renderToStaticMarkup` + `React.createElement`
- ⚠️ [`\b` de JS es ASCII](reference_regex_js_b_ascii.md) — "qué" con tilde no cierra palabra y el regex salta al siguiente "que"; lookarounds `\p{L}` con `u`
- [Probar un route handler con vitest](reference_probar_route_handler_vitest.md) — el doble de Supabase debe APLICAR los `.eq()`; un `route.ts` no puede exportar helpers; `params` es Promise
- ⚠️ [Verificar contra el CSS compilado](reference_verificar_css_compilado.md) — un `@theme` mal declarado deja cada clase sin efecto y los cuatro checks salen verdes; y el `/15` que parece perdido está en un `@supports`
- [Fecha y hora en es-CO](reference_formato_fecha_hora_es_co.md) — el CLDR mete "de" y no se quita con opciones; `hourCycle:'h23'` va igual aunque el riesgo no se reproduzca en node
- ⚠️ [La firma Svix de Resend no es el HMAC de Meta](reference_firma_svix_resend.md) — firma `id.timestamp.body` con el secreto decodificado y en base64; el vector oficial es la unica prueba que vale, y la ventana de 5 min descansa en un supuesto
- ⚠️⚠️ [Landing estática en un subdominio de metrik.com.co](reference_landing_estatica_en_metrik.md) — el DNS ya está (wildcard); `all_except_custom_domains` abre PRODUCCIÓN (dominio propio **y** alias `.vercel.app`) y solo cierra la URL por deploy; y git sí corre en el scratchpad
- ⚠️ [Trabajar sobre otro repo desde el worktree aislado](reference_publicar_otro_repo_desde_worktree.md) — git y `gh api` de escritura bloqueados; base verificada por SHA de blobs; Turbopack no acepta `node_modules` symlinkeado; la entrega es un patch
- ⚠️⚠️ [Árbol limpio por tarball](reference_arbol_limpio_por_tarball.md) — el checkout compartido puede ir BEHIND main y mentir en silencio; el tarball da `origin/main` pristino sin tocarlo, y `next build` exige `cp -a` de node_modules

## Feedback

- [Las cifras del brief caducan](feedback_cifras_del_brief_caducan.md) — se re-miden al hacer el QA; otra sesión puede mover los datos de producción a mitad del encargo
- [Pruebas por mutación](feedback_pruebas_por_mutacion.md) — no creerle a una prueba hasta verla fallar; el doble reproduce el defecto; y toda comparación A-vs-B idéntica necesita un control que difiera
- [Medir antes de construir](feedback_medir_antes_de_construir.md) — La medición va antes de escribir, y las premisas del encargo se comprueban en vez de heredarse
