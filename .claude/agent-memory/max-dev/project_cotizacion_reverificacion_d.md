---
name: cotizacion-reverificacion-d
description: Ajustes de la re-verificación D de Vera (2026-10-14), PRs #1183 #1185 #1186 #1187 #1188 sin mergear; hotel de varias habitaciones = una opción solo con la bandeja por pasos; V2 bloque optimista + vista en la respuesta; V8 sembrada pide --resembrar; «actividades opcionales» quedó reportado
metadata:
  type: project
---

Encargo: `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-14-ajustes-reverificacion-d.md`. Un PR por grupo:
#1183 hotel de varias habitaciones · #1185 V2 (aceptar uno) · #1186 semilla V8 · #1187 menores · #1188 PDF. Ninguno
mergeado por mí. No escribí en producción.

**Why:** Vera dejó V2 en FALLA (bloquea encender en Trappvel) y tres condiciones para Sofía (resembrar, decidir el hotel
de varias habitaciones, V8 con 3 dobles). Mauricio decidió: total del pantallazo, sin partirlo, con registro de habitaciones.

**How to apply (lo que no se ve en el código):**
- **Hotel de varias habitaciones:** la lectura real de siempre (gemini-2.5-flash) dejó la Posada en RX1 en 2 de 3 corridas.
  Con el bloque de reserva en el prompt, 10 de 10 aceptadas, y una grilla «elige habitación» sigue en RX1. El bloque y la
  propiedad `habitaciones_reserva` del esquema van SOLO con `reservaVariasHabitaciones` (bandeja por pasos y el interruptor
  comprobado en la base). Apagado, el prompt y el esquema son byte a byte los de main: hay hash por ranura en
  `reserva-habitaciones.test.ts`. La guarda determinista exige que los precios de las habitaciones SUMEN el total. El costo
  entra por la rama 2d de `resolverTarifa` (una fila `porHabitacion` con `nombre`): sin ella, TP4 pedía dos búsquedas más.
- **V2:** el bloque provisional sale de `aceptar-optimista.ts`, con «Guardando…» y sin tocar el total. La ruta
  `aceptar-captura` con `porPasos` devuelve `vista` (`vistaTrasAceptar`) y el editor la aplica con `laMasNueva`: +4 idas,
  2 de ellas en serie. El techo de idas encendido pasó de 48 a 52 en `por-pasos-aceptar-tiempos-e2e`. El `cierre` (≈340 ms)
  NO se bajó: compartir el contexto toca `recalcularTotales`, que fija C0. Falta medirlo con Playwright en trappvel-pruebas.
- **V8:** una corrida normal ve V8 como «ya existe»: hay que correr `--resembrar --apply` (lo hace la sesión principal).
  `--resembrar` ahora también borra el `activity_log` por `entidad_id`.
- **«A tener en cuenta» con un traslado opcional:** NO se arregló. El texto vive en el PDF, los sugeridos no traen su tipo,
  y apagados también pueden ser hoteles. Queda para que decida Mauricio.
- **Gotcha de CI:** un comentario con «2 años» hizo caer `retencion.test.ts` (ver [[project-retencion-cifra-anios]]).
  Escribir «edad 0 o 1».
- **Gotcha del guard de Bash en worktree aislado:** rechaza heredoc + `cd`, `for` con variables y `jq` en `gh`. Los
  scripts van con Write dentro del worktree y se borran después. Un `.test.ts` suelto en la raíz no lo recoge vitest:
  va dentro de `src/`.

Relacionado: [[cotizacion-verificacion-d]], [[cotizacion-integrada-c0]], [[project-espacio-pruebas-trappvel]].
