---
name: perfil-contacto-bot
description: Perfil del contacto por el bot (corte 1 del motor de perfil, 2026-10-12) — migración 20261012234500 SIN aplicar; fichas del reglamento en SQL sin publicar; el trigger exige autorización vigente; QA real 2026-10-14 en verde (cp-* 7/7)
metadata:
  type: project
---

Rama `feat/perfil-contacto-por-bot`. Tabla `contacto_perfil_hechos` (un hecho por fila; sugerido / confirmado /
descartado; `origen_ref` = id de la fila de `wa_conversacion` o `usuario:<uid>`). Vocabulario en
`supabase/functions/_shared/perfil-contacto.ts` (lo importa también Next).

**Why:** Mauricio, 2026-10-12: «recuerda que a Mauricio Moreno le gusta la comida italiana» tiene que ir al perfil,
no a un viaje. Autorización v1.1 de Trappvel es la base legal; sin ella no se guarda nada (ni sugerido).

**How to apply:**
- Orden: migración → deploy `wa-webhook` → `sql/trappvel/2026-10-12_reglamento-perfil-contacto.sql` →
  `bot_publicar_reglamento`. Sin las fichas el bot igual tiene la acción (va en la declaración de `proponer`), pero
  `alc.no_temas` dice «salud» → «es celíaco» puede salir como `fuera`.
- El TRIGGER (no solo el código) exige contacto del workspace y `vigente.generales` para crear o confirmar; descartar
  siempre. Un workspace sin `config_extra.autorizacion_datos` no ve la sección ni puede guardar (hoy solo Trappvel).
- El modelo marca `clase` (dato/sensible/juicio) y `nombra_menores`; el código solo obedece. No meter listas de
  palabras para detectar salud o juicios: si falla, se arregla el prompt o la ficha `g.perfil_marcas`.
- La extracción con `perfil: true` solo la usa el bot (sube ~250 tokens la parte fija; tope de la prueba 1.450). Sin
  la opción el prompt es byte a byte el de antes («Pegar conversación»).
- Igualdad de hechos = `textoComparable` (tildes, mayúsculas, puntuación), nunca «mismo significado».
- ⚠️ El esquema de respuesta MANDA sobre el prompt: el arnés (`extraccion-gemini.ts`) pedía `perfil` en las
  instrucciones pero no en `responseSchema`, y cp-mixto fallaba (2026-10-14). Ahora `ExtractorMemoria` recibe
  `perfil` y el esquema se arma con él; producción siempre lo tuvo. Con eso cp-mixto 3/3 con Gemini real.
- Pendiente: QA real con `qa-real.sh` (paso 4, `--conjunto perfil`) cuando Google quede al día; barra de completitud
  y paso 1 (cálculo desde viajes) fuera de este corte.
Relacionado: [[autorizacion-datos-link]], [[nucleo-conversacional]].
