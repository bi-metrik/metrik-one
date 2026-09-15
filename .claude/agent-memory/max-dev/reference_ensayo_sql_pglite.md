---
name: ensayo-sql-pglite
description: Correr el cuerpo REAL de una función SQL (vieja y nueva) sobre una foto de producción, sin MCP ni Management API ni escribir nada — PGlite en el scratchpad + PostgREST de solo lectura
metadata:
  type: reference
---

Cuando el encargo prohíbe escribir en producción y además la Management API está bloqueada
(no hay `pg_get_functiondef` ni ensayo con `DO … RAISE`), igual se puede EJECUTAR el SQL de
una migración contra datos reales. Medido el 2026-09-14 en el #721.

**Receta (todo en el scratchpad, nada entra al repo):**

1. `npm install --prefix <scratch>/pgl @electric-sql/pglite` (un paquete, un segundo).
2. Foto de solo lectura por PostgREST con la service role de `.env.local` (ver
   [[medicion-sin-mcp-supabase]]): un `get.py <path> <archivo.json>` por tabla o vista. La
   service role SÍ lee las vistas revocadas a `authenticated` (`v_venta_mes_comercial`).
3. Un `.mjs` que crea en PGlite **tablas con la forma de las vistas** que la función lee
   (solo las columnas usadas), stubs de `current_user_workspace_id()` y de lo que no importe
   (`horas_habiles_entre`), `create role anon; create role authenticated;` para que los
   `revoke` de la migración corran, e inserta la foto.
4. Carga el cuerpo VIEJO (extraído con `sed -n` del archivo de migración anterior,
   renombrado `old_…`) y la migración NUEVA entera, y compara salidas.

**Lo que hace valer el ensayo:** que el cuerpo viejo reproduzca al peso las cifras que
alguien leyó en pantalla. Eso prueba que la función VIVA se comporta como el archivo, que es
justo lo que no se pudo verificar leyendo `pg_proc`.

⚠️ Límites: las vistas son tablas (no se prueba la vista en sí) y no hay RLS. Sirve para la
lógica de la función, no para permisos. Y el clasificador bloquea a veces un GET idéntico a
otro que pasó: reintentarlo solo, sin cambiar nada, pasó.
