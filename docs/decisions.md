# Decisiones — metrik-one

Historial acumulativo de decisiones tecnicas y de negocio.

| Fecha | Decision | Contexto |
|-------|----------|----------|
| 2026-03-12 | Dashboard Mi Bolsillo dentro de ONE, no standalone | Reunion directiva unanime. Mejor integrado al ecosistema ONE |
| 2026-03-13 | Acceso a modulos por empresa via ADMIN_WORKSPACE_ID | Solo rol owner no basta — otros workspaces tambien tienen owners. Se necesita filtro por workspace UUID |
| 2026-03-13 | Cross-project Supabase con service role key server-only | Patron para conectar a otros proyectos Supabase desde ONE. Nunca exponer key al client |
| 2026-03-13 | Patron de modulos empresa-especificos estandarizado | Env var + 3 capas (sidebar prop, page redirect, action guard). Reusar para cualquier modulo futuro por workspace |
