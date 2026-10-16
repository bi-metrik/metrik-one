---
name: fotos-perfiles
description: Fotos de la propuesta = biblioteca propia por hotel y tour (feat/fotos-perfiles, 2026-10-16) — se quitó TODA búsqueda automática; migración 20261017090000 SIN aplicar y va ANTES del merge; el documento lee por una vista para no sumar idas
metadata:
  type: project
---

Pedido de Mauricio (2026-10-16): Commons/web oficial no encontraron fotos de ningún hotel real de Trappvel.
Reemplaza a [[galeria-fotos-hotel]], [[fotos-hotel-por-categoria]], [[project-fotos-web-bloqueada]] y al selector
de [[biblioteca-fotos]] (sus memorias describen código que ya no existe).

- ⚠️⚠️ Migración `20261017090000_fotos_perfiles.sql` (tablas `fotos_perfiles`, `fotos_perfiles_alias`, vista
  `fotos_catalogo_por_clave`, columna `fotos_catalogo.orden`) SIN aplicar al abrir el PR. El código lee la vista y las
  tablas: sin ellas la tarjeta queda como antes y la propuesta sin fotos de biblioteca. Depende de 20261016221500 y
  20261016233000 (también sin aplicar a esa fecha). Dry-run/reversa en `sql/fotos/2026-10-17_*`, probadas en PGlite.
- Perfil = su llave (`claveDeFoto`), la MISMA de sus fotos en `fotos_catalogo`: no se movió ninguna foto. Un hotel con
  fotos de antes sin fila de perfil cuenta como perfil; la fila nace al abrir una cotización (sin migración de datos).
- El perfil se crea al LEER las tarjetas (`fotosParaTarjetas`, solo roles que escriben), no al insertar ítems: los
  caminos que crean ítems son muchos. El PDF no crea ni resuelve dudas.
- Reconocer: `src/lib/fotos/perfiles.ts` (puro, sin IA). Seguro = mismas palabras + misma ciudad → alias sin preguntar.
  Duda = Dice ≥ 0,6 o misma palabra sin ciudad → la tarjeta pregunta; subir antes de contestar da error.
- **Presupuesto de idas (igualdad-servidor):** el PDF lee `fotos_catalogo_por_clave` con `.in('clave_pedida', …)` en
  UNA ida para hoteles + planes opcionales. Resolver el alias con una segunda consulta rompía el tope.
  `test/cotizacion-pdf-doble.ts` emula esa vista; el doble de igualdad no la conoce (tabla vacía = [] y no revienta).
- Planes opcionales: la llave sale de `nombreVisibleDeLinea` + `ciudadDeActividad` de la línea, igual en la tarjeta y
  en el PDF (los dos motores). Ya no hay búsqueda por nombre sin ciudad (`actividadPorNombre` se borró).
- Se conservó `agencias.ts` (solo `esDeAgenciaDeViajes`) porque la casilla de autorización rechaza una procedencia que
  es un enlace de agencia (regla de Emilio), aunque el brief pedía borrarlo.
- Sin QA visual: ni capturas ni prueba en el preview al abrir el PR.

**How to apply:** antes de tocar fotos de la propuesta, leer `perfiles-db.ts` y `catalogo-propuesta.ts`; toda lectura
del documento va por la vista. Si Mauricio reporta un «mismo hotel» mal reconocido, agregar el par a `perfiles.test.ts`
antes de mover el umbral.
