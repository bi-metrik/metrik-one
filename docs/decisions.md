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
