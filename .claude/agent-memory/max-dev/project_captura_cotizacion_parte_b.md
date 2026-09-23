---
name: captura-cotizacion-parte-b
description: "#847 (Trappvel, 2026-09-23) SIN mergear: migración de ranuras/cargo/tramos SIN aplicar, va ANTES del merge; decisiones de diseño abiertas con Mauricio y Noor"
metadata:
  type: project
---

PR [#847](https://github.com/bi-metrik/metrik-one/pull/847), Parte B del brief
`proyectos/trappvel/clarity/docs/diseno/brief-max-captura-cotizacion-2026-09-23.md` más los
pasos 1, 2, 4 y 5 de Noor. Sigue a [[captura-cotizacion-parte-a]].

**Orden obligatorio:** la sesión principal aplica
`supabase/migrations/20260923233000_cotizacion_ranuras_y_captura.sql` (dry-run primero) y
DESPUÉS se mergea. Max no aplica ni mergea. El código aguanta sin la migración.

**Why:** el brief lo exige y la migración toca datos de producción (backfill).

**How to apply:** antes de dar el frente por cerrado, comprobar en la base que la tabla
`cotizacion_ranuras` existe y correr el SELECT de verificación del cierre (esperado con los
datos del 23-sep: 12 ranuras, 15 líneas con ranura, 0 partidos, 0 fundidos, 3 cargos).

## Lo que no se ve en el código

- **El motor sigue agrupando por `items.grupo`**: la ranura es la entidad que la pantalla
  nombra y `grupo` su clave derivada. `normalizarGrupo` distingue mayúsculas: «Hotel» y
  «hotel» son dos ranuras para el motor, y el backfill y los bloques respetan eso.
- **`opcion_de` no decide ningún total** (la opción por defecto es la primera por `orden`),
  por eso el backfill la pone en null dentro de las ranuras sin mover un peso.
- **La zona única de pegado NO puede usar el aria-label «Pegar el pantallazo del
  proveedor»**: ya lo usa la casilla de cada línea (`tarifa-pasajero-item.tsx`). La prueba de
  render lo encontró 4 veces.
- **Detección medida sobre el banco real** (`capturas-proveedor/2026-09-16`): 9 de 10 con
  tipo; la «liquidación de la cotización» de un paquete sale sin tipo y la pantalla pregunta.
  Booking devuelve «Cancun (y alrededores)»: `ciudadCorta` lo recorta.

## Decisiones que quedaron para Mauricio o Noor

Recomendada con dos opciones = la más barata; una opción sin precio no entra al reparto; las
tarifas completas nacen marcadas (y sin la tabla de ranuras igual); el recargo por pasajero
cuenta infantes; el backfill toca las 4 líneas de COT-2026-0009; los tramos no se llenan en
SQL (se derivan). Hallazgos 4 («HOTEL») y 17/32 (número y equipaje) no se reprodujeron sin la
captura del ensayo.
