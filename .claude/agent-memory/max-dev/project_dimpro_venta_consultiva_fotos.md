---
name: project-dimpro-venta-consultiva-fotos
description: Dimpro ventas consultiva (29-oct) — ver_catalogo con `uso` y tope 3, fotos por código tras el texto; SQL del reglamento SIN correr y va después del deploy
metadata:
  type: project
---

Pedido de Mauricio tras probar el asistente vivo (Messenger, cuenta 189134): «no vende; fotos y no tantas opciones;
preguntar el tipo y sugerir 3». Rama `feat/dimpro-asistente-fotos-consultivo`.

- Tope de 3 en tres capas: `ver_catalogo` nunca devuelve más de 3 (`sugerirProductos`); sin `uso` y con más de 3
  coincidencias devuelve `preguntar_uso` + tipos (sin productos); `guardaTexto` de ventas rechaza >3 códigos MP-xx.
  El verificador del núcleo ya rechaza un código que no salió de una herramienta (cifra sin respaldo).
- Tope de llamados del asistente público = 3 por turno: un caso de arnés con dos lecturas + guarda + reintento no
  cabe; usar `{ varias: [...] }` en el guion.
- Fotos: las decide el CÓDIGO (no hay herramienta), solo de códigos nombrados en el texto Y leídos en ese turno; sin
  repetir en la conversación salvo «foto/muéstrame/cómo es». Host permitido = `SUPABASE_URL` del runtime de la Edge
  Function; sin él ninguna foto sale. Fila en `chatwoot_conversacion` con texto «[Foto] MP-xx · título» (sin URL: el
  modelo la vería en el historial).
- Catálogo real medido (29-oct, solo lectura): 59 publicaciones, 51 activas, 48 activas con foto; casi toda la ficha
  es «descripcion publicada» (no verificada) → la razón de la sugerencia sale mucho del título.
- Live = código antes del cambio (bot_parametros de dimpro idénticos a reglamento-dimpro.ts salvo orden de claves jsonb).

**Why:** la sesión que despliegue necesita el orden y lo SIN VERIFICAR (multipart de Chatwoot Cloud con el token del
Agent Bot; foto en Messenger).
**How to apply:** deploy de `chatwoot-agente` → `sql/dimpro/2026-10-29_reglamento-ventas-consultiva.sql` (idempotente) →
probar «quiero un taladro» y «taladro para metal de cable» en Messenger. Ver [[project-dimpro-asistente-ventas-bold]].
