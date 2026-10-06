---
name: doble-guardado-idempotencia
description: Doble guardado (2026-10-06) — #1047/#1048/#1051 sin migración; #1049 (migración) + #1050/#1053 apilados SIN mergear; #1052 migración SIN aplicar; el POST cortado se repite también vía Vercel
metadata:
  type: project
---

Brief `proyectos/soena/ve/2026-10-06_brief-max-doble-guardado.md`. Causas medidas en código y en prueba:

- **Menciones** (72 pares a 0,2 s): `addComment` ponía `mencion_id` y el trigger legado avisaba antes de que
  llegaran las filas de `activity_menciones` (otro viaje). #1047: `mencion_id` null con lista nueva.
- **`bloque_datos`** (663 pares): leer-calcular-escribir sin condición + re-guardado sin cambios dejaba línea.
  #1048: `.eq('updated_at', leída)` con 3 intentos y línea solo si cambió. En prueba, `main` duplicaba
  también los cobros de `auto_cobros_multi`.
- **Crons**: update sin condición antes de avisar (#1051 reclama) + candado `tomar_candado` (#1049).
- **`negocio_en_etapa`** (~68 s): trigger en cada cambio de etapa; ir y volver avisa dos veces, también al
  cliente por `notificar-etapa`. #1052 guarda de 10 min. La CAUSA del ir y volver sigue sin medir.
- **Chromium reenvía el POST cortado también a través de Vercel** (4/4, `scripts/post-cortado-vercel.e2e.mjs`):
  0,7 s si se cae la conexión, 10 s o 75 s si la señal se pierde. Leer logs de Vercel lo niega el
  clasificador (Production Reads): las sondas las cuenta la sesión principal.

**Why:** la escala es 100 personas en cualquier operador; lo que sale hacia afuera no se deshace.

**How to apply:** acción nueva de plata, correo, WhatsApp o Siigo → cuerpo en `<x>SinClave`, export que
envuelve con `accionIdempotente`, y el componente usa `useIntencion` (clave() en la llamada, cerrar() al
recibir respuesta). Sin la tabla de #1049 todo corre como antes. Inventario: `docs/idempotencia/inventario.md`.
Relacionado: [[piloto-red-soena]], [[recuperacion-red-iphone]], [[cargue-segundo-plano]].
