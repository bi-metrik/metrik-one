# Decisiones — metrik-one

Historial acumulativo de decisiones tecnicas y de negocio.

| Fecha | Decision | Contexto |
|-------|----------|----------|
| 2026-03-12 | Dashboard Mi Bolsillo dentro de ONE, no standalone | Reunion directiva unanime. Mejor integrado al ecosistema ONE |
| 2026-03-13 | Acceso a modulos por empresa via ADMIN_WORKSPACE_ID | Solo rol owner no basta — otros workspaces tambien tienen owners. Se necesita filtro por workspace UUID |
| 2026-03-13 | Cross-project Supabase con service role key server-only | Patron para conectar a otros proyectos Supabase desde ONE. Nunca exponer key al client |
| 2026-03-13 | Patron de modulos empresa-especificos estandarizado | Env var + 3 capas (sidebar prop, page redirect, action guard). Reusar para cualquier modulo futuro por workspace |
| 2026-03-18 | Costo horas por tarifa individual de cada staff | La vista SQL anterior usaba un solo staff principal. Si nadie tenia es_principal=true, costo_horas=0. Ahora cada registro de hora usa la tarifa del staff que la registro |
| 2026-03-18 | Ruta /equipo (no /horas) para hub de gestion de equipo | Mas amplio que solo horas, alinea con perfil de staff y metricas del equipo |
| 2026-03-18 | Sin causaciones_log para horas por ahora | Flujo de aprobacion directo sin tabla de auditoria. Se puede agregar despues si se necesita |
| 2026-03-18 | Auto-aprobacion de horas para owner/admin | Reduce friccion. Solo operadores necesitan aprobacion explicita |
| 2026-03-18 | Solo APROBADO cuenta en proyecto (no CAUSADO) | CAUSADO es contable, no operativo. El PM solo ve gastos aprobados |
| 2026-03-18 | Barras de costos: umbrales 70/90/100, slate sin presupuesto | Consenso Vera+Kenji+Kaori+Hana. Estandar EVM simplificado |
| 2026-03-18 | WhatsApp botones interactivos para confirmaciones | UX mejorada: botones tappables en vez de texto libre. IDs estandar: btn_confirm, btn_cancel, btn_despues |
| 2026-03-18 | wa-webhook deploy siempre con --no-verify-jwt | Meta envia HMAC signature, no JWT. Sin este flag el webhook rechaza todo con 401 |
| 2026-03-22 | Mi Negocio: sidebar desktop + acordeon mobile | Cards en sidebar, contenido expande al lado (desktop) o inline debajo (mobile). Mi Plan es card regular |
| 2026-03-22 | Tab bar mobile: 4 primarios + "Mas" | owner/admin: Numeros, Oportunidades, Proyectos, Tableros. Resto en panel expandible. Roles con <=4 items no ven boton Mas |
| 2026-03-22 | Activity Log reemplaza notes-section | Comentarios tipo tweet (280 chars) + menciones + links + cambios automaticos del sistema. Tabla activity_log ya en produccion |
| 2026-03-22 | [98H] Custom fields JSONB, no ALTER TABLE por cliente | D154: Campos custom en custom_data JSONB. Solo MéTRIK configura via Clarity (skill /configure-fields). Labels como many-to-many con colores |
| 2026-03-22 | Herencia custom_data en handoff via mappings | Oportunidad→Proyecto: custom_field_mappings define que slugs se copian. Idempotente, configurable por workspace |
| 2026-03-24 | Notificacion = tarea pendiente, no log (D163) | Solo se notifica lo que requiere accion. Estado tripartito: pendiente/completada/descartada. Max 2-4 por dia |
| 2026-03-24 | 9 tipos de notificacion (N1-N8b), crons 13:00 UTC | N1 escalamiento 3-5-7-15d por rol. N7 inactividad proyecto 2-5d. Realtime via Supabase |
| 2026-03-24 | Roles genericos > roles especializados para ICP ONE | Consenso Hana+Kaori+directivos. 5 roles genericos + area como tag. Roles especializados generan friccion en onboarding PYME |
| 2026-03-24 | Supervisor (5° rol): permisos operativo-comerciales | Ve pipeline + proyectos completos. Sin delete ni causacion. area (comercial/operaciones/null) solo afecta routing N1/N7 |
| 2026-03-24 | Contador (6° rol): solo causacion, ilimitado gratis | Puede causar (PUC+CC), no puede aprobar. Solo ve /causacion. No consume licencia del plan |
| 2026-03-24 | profiles.area afecta routing notificaciones, no permisos | N1 busca supervisor area=comercial o null. N7 busca supervisor area=operaciones o null. Fallback a owner si no hay |
| 2026-03-24 | CRON_SECRET en Vercel con printf (no echo) | echo agrega trailing newline. Vercel rechaza CRON_SECRET con whitespace. Usar printf para env vars en CLI |
| 2026-03-25 | Panel notificaciones movil: fixed inset-0 (full-screen) | El dropdown absolute right-0 se corria a la izquierda en movil. Full-screen con overlay es el patron correcto |
| 2026-03-25 | Deducible toggle: permiso canToggleDeducible en roles.ts | Solo owner/admin/contador pueden cambiar deducibilidad. Validacion en server action antes de UPDATE |
| 2026-03-25 | WhatsApp HMAC: fallar hard en prod si falta APP_SECRET | Sin validacion cualquiera puede inyectar mensajes. DENO_DEPLOYMENT_ID como proxy de produccion |
| 2026-03-25 | Titulo de gasto: buildGastoTitle() no mensaje_original | Formato: concepto NLP (si <=40 chars) o "[categoria] — $monto". mensaje_original va a campo notas |
| 2026-03-25 | 6 roles reales en WhatsApp bot | operator/supervisor: mismos permisos que collaborator anterior. contador: solo consultas. read_only: consultas basicas |
| 2026-03-25 | MVP declarado completo | Todos los pendientes del roadmap MVP cerrados. Proximos pasos: go-to-market + features post-MVP |
| 2026-03-25 | Go-to-market: referidos primero (CAC $3-5K), Meta Ads segundo (CAC $15-38K) | Consenso Mateo+Sami. /promotores ya existe en producto. Meta con gate semanal de CAC |
| 2026-03-25 | Alianza contadores como canal multiplicador | 60K contadores en Colombia. Referral fee post-conversion. Landing metrikone.co/programa-contadores |
| 2026-03-26 | Workflow engine: etapas minimas sistema + custom entre ellas | Opcion 2 aprobada — sin duplicidad de estados. etapas_sistema protegidas (es_sistema=true), custom insertables entre ellas |
| 2026-03-26 | UI configuracion workflow solo interna — no visible al usuario ONE | Usuarios de ONE no deben ver ni configurar etapas. MeTRIK configura via /configure-workflow |
| 2026-03-26 | Modelo AI-first: cuello de botella es diseno, no ejecucion | Validado con datos: Max ejecuta en 10-30min, discovery cliente toma 2-5h. Documentado en execution-model.md y agentes |
| 2026-03-26 | Proceso discovery Clarity-ONE: 3 bloques → Brief → /configure-workflow → QA | Hana + Kaori. Brief de configuracion es requisito antes de ejecutar. Proceso [34] en metrik-docs |
| 2026-04-01 | Gates son servicio Clarity — tenant_rules vacio por defecto | No hay gates sin que MeTRIK los configure. Cada cliente tiene reglas de su negocio que MeTRIK levanta en discovery |
| 2026-04-01 | Motor de reglas condicionales: block_transition evalua ANTES de persistir cambio de estado | estado_nuevo en contexto status_change hace los gates etapa-especificos. HTTP 422 si gate activo |
| 2026-04-01 | SOENA: proceso VE es primer cliente Clarity sobre ONE | Pipeline (stages A-B) + Proyectos (10 estados C-F). 11 etapas, 9 campos custom, gates documentales |
| 2026-04-01 | Visibilidad input carpeta Drive: usar dato servidor, no estado local | useState se inicializa una vez — condicionar con prop del server component para campos que persisten en DB |
| 2026-04-05 | Modulos financieros configurables via workspaces.proyecto_modules JSONB | all-false por defecto. MeTRIK activa por workspace. SOENA: todos activos |
| 2026-04-05 | Auto-cobros VE: anticipo al ganar + saldo al llegar a por_cobrar | ganarOportunidad crea anticipo. moveProyectoVe crea saldo = presupuesto - sum(anticipos). Ambos PENDIENTE |
| 2026-04-05 | cobros.tipo_cobro: regular/anticipo/saldo | factura_id ahora nullable. Anticipos y saldos VE se registran antes de emitir factura formal |
| 2026-04-05 | Cotizaciones de negocio: codigo = consecutivo directo | Trigger trg_cotizacion_auto_codigo detecta oportunidad_id IS NULL y usa consecutivo directamente |
| 2026-04-05 | ID negocio: primeras 3-4 letras del primer vocablo, no iniciales | Decision Hana/Vera. Modelo A (auto de nombre empresa) + override via empresas.alias_corto |
| 2026-04-06 | Persona natural = empresa automatica en crearNegocio | PN es su propia empresa. Crear empresa con nombre del contacto y asignar empresa_id |
| 2026-04-06 | Sesion E ejecutada con Sonnet 4.6 — resultados degradados | Proximas sesiones de desarrollo complejo: usar Opus 4.6 |
| 2026-04-06 | BloqueDocumentos: upload real reemplaza inputs de URL | Bucket ve-documentos, path workspace/negocios/negocioId/bloqueId/slug.ext |
| 2026-04-06 | Gate comentario: config_extra.gates en etapas_negocio | Array de strings configurables por etapa. Extensible para otros gates futuros |
| 2026-04-07 | Cobros automaticos desde bloques datos, nunca manuales | Anticipo (etapa 2) y multi-pago (etapa 7) crean cobros via triggers en config_extra |
| 2026-04-07 | Saldo = precio_total - sum(cobros), nunca pre-creado | Calculo dinamico en BloqueCobros. Evita inconsistencias por edicion de cobros |
| 2026-04-07 | require_confirm pattern para bloques financieros | BloqueDatos con config_extra.require_confirm=true no auto-completa. Boton explicito para confirmar |
| 2026-04-07 | cobros.proyecto_id nullable — VE negocios no tienen proyecto | ALTER TABLE cobros ALTER COLUMN proyecto_id DROP NOT NULL |
| 2026-04-07 | tipo_cobro CHECK: regular, anticipo, saldo, pago | 'pago' para multi-pago etapa 7 |
| 2026-04-08 | BloqueDocumentos: useRef para auto-complete, no setState | React 18 setState batching puede diferir updater callbacks. useRef es sincrono y confiable |
| 2026-04-09 | negocios.estado valores reales: 'abierto' / 'completado' (no 'activo') | Bug en /numeros: 3 queries filtraban 'activo'. Corregido a 'abierto' |
| 2026-04-09 | BloqueHistorial: visualizacion pura en etapas ejecucion y cobro | is_visualization=true, tabs gastos/horas/cobros, sin edicion |
| 2026-04-09 | Eliminar anglicismos en UI: "Pipeline" → "En venta" | Directiva: no usar anglicismos en la interfaz de ONE |
| 2026-04-09 | Modulo negocios reemplaza pipeline y proyectos | /pipeline y /proyectos son legacy. Todo nuevo desarrollo apunta a /negocios. FAB, WhatsApp, KPIs, navegacion — todo a negocios |
