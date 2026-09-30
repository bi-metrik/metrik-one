---
name: radar-secop-modulo
description: PR #952 (Radar SECOP en ONE) MERGEADO ec1bab8e con su migración aplicada; el cron de cobro NO lee disparador_cobro, así que enrolar el contrato no emite nada; el puntaje quedó con una sola implementación en src/lib/radar/puntuar.ts
metadata:
  type: project
---

Spec `proyectos/metrik/one/2026-09-28_spec-radar-secop-en-one.md`, bloques D → E → B.
**PR #952 MERGEADO** el 2026-09-28 (`ec1bab8e` en `main`); su migración `20260928180000` es DDL puro.
⚠️ **CADUCÓ lo de «sin mergear»** y también el hallazgo del eslabón que sigue: Mauricio autorizó
construirlo el mismo día y vive en [[radar-trial-y-cobro]] (trial de 5 días anclado a la aceptación,
paso 6a del cron, cierre del módulo al día 6). El #957 (`terminos-uso-radar@1.0`) también está
mergeado (`b23efc92`). El workspace `fabri` ya existe, medido en producción: `modules
{radar_secop:true}`, `max_seats 2`, `drive_folder_id null`, `tipo nativo`, `trial`.

**Why:** el Radar dejó de ser un HTML empaquetado y entra a ONE como módulo con licencia propia
($20.000/mes de lista; Fabri paga $15.000 como descuento de fundador, que vive en el contrato y no
en la ficha del catálogo). Primer cliente: Fabri (Alex Contreras).

## ⚠️⚠️ Lo que la spec da por hecho y el código NO hace (bloque C)

La spec dice: «el contrato entra a `servicios_contratados` con `disparador_cobro: ciclo` y el cron
existente emite la cuota, genera el enlace de Bold y manda el aviso». **Medido: falso.**

**`disparador_cobro` no lo lee NINGÚN cron.** Sus únicos lectores son
`src/lib/catalogo/definicion.ts` (el esquema) y `src/lib/catalogo/servicios-de-workspace.ts` (la
pantalla `/servicios`). Lo que de verdad dispara cada paso de `procesar-planes-cobro`:

| Paso | Lo dispara | ¿Basta el contrato? |
|---|---|---|
| 1 cuota programada | `planes_cobro.activo = true` | No |
| 4 cuenta de cobro | `workspaces.modules.cobros_recurrentes` + día ≥ 10 | No |
| 5 ciclo suscripción | fila en `suscripciones` con `proximo_cobro <= hoy` | No (y Fase 1 es `manual`, no cobra) |
| 6 enlace Bold + correo | contrato activo/pausado + `planes_cobro` con pasarela en línea + **filas en `plan_cobro_cuotas`** | No |

**Falta el eslabón `servicios_contratados` → `planes_cobro` + `plan_cobro_cuotas`.** Hoy lo crea
una persona. Y el trial (`dias_trial` en `servicios_contratados.parametros`) **no lo lee nadie**:
el estado `trial` existe en `suscripciones` pero el ciclo corre por `proximo_cobro`, así que quien
fije esa fecha decide el trial.

**How to apply:** cualquier encargo que diga «enrolar en `servicios_contratados` y el cron ya cobra»
está apoyado en una premisa falsa. Escribir ese eslabón es **escritura de dinero**: se pregunta
antes. Hermano de [[cobros-emision-gate]] y [[suscripciones-cobro-automatico]].

## El puntaje: una sola implementación, y dos hallazgos medidos

`src/lib/radar/puntuar.ts` es la autoridad única. Antes vivía **dos veces**
(`metrik-data/scripts/temas.py` para el correo semanal, y un `puntuar()` en JS dentro de
`dashboard/index.html`). Los números de `puntuar.test.ts` salieron de correr el motor Python real
el 2026-09-28, no de leer el código: SDP-LP-003-2026 = 8, INVIAS férreo = -2, IA + audiovisual = 2.

**Paridad comprobada contra el barrido real** (`metrik-data/barridos/_universo-2026-09-28.json`,
2.075 filas): TS y Python dan 1.908 únicos, 26/24 para `metrik` y 56/53 para `fabri`, con los
mismos top-fit. **⚠️ `metrik-data/CONTEXT.md` dice 7/5 y NO reproduce a ningún umbral** (fit≥4 da
16/14) — es cifra vieja en el doc de allá, no un defecto del puerto. Sin corregir.

- ⚠️ **El JS del tablero excluye de MÁS.** Aplanaba `stems` y `palabras` de las exclusiones y las
  probaba todas como substring: sobre los 1.908 procesos con el perfil `fabri` eso saca **4 de
  más**, porque `VIDEOVIGILANCIA` contiene `VIGILANCIA`. La semántica correcta es la de `temas.py`:
  un `stem` es substring (es un fragmento a propósito, como `VACUN`), una `palabra` es palabra
  completa. Misma familia que el plural S/ES, al otro lado del filtro.
- ⚠️ **El castigo por forma de compra se topa; el de dominio ajeno NO**, y el caso de INVIAS **no
  prueba esa asimetría**: con bruto 6 no hay señal fuerte (umbral 8) y el tope nunca entra. Se
  descubrió mutando `puntuar`. El caso que sí la mide: fábrica de software + audiovisual +
  mantenimiento = **-3** (si el dominio se topara, +1).

**How to apply:** tocar `biblioteca.json` (los 97 temas y sus pesos) mueve TODOS los puntajes a la
vez; el umbral del correo semanal ya bajó de 5 a 4 por eso. Antes de cambiar un peso, correr
`puntuar.test.ts` y comparar contra `temas.py` sobre el barrido real.

## La migración `20260928180000_modulo_radar_secop.sql` — YA aplicada

**DDL puro: ni una fila de datos, y NINGÚN workspace queda con el módulo encendido** (a diferencia
de la de Ferretería, que activaba `dimpro`). El workspace de Fabri no existe: su contrato depende
del NIT de la empresa y del correo de Alex, el mismo prerrequisito de los cuatro CDA del
2026-09-15. Encenderlo es otra migración.

- `radar_procesos` es **global, sin `workspace_id`** (dato público, dataset `p6dx-8zbt`), con
  `policy using (true)` y grant de SELECT a `authenticated`. Escribe solo el cron.
- `radar_perfiles` / `radar_temas` / `radar_seguimiento` son por workspace con RLS completa: es lo
  que vivía en `localStorage`.
- `radar_seguimiento` **NO tiene FK** a `radar_procesos` a propósito: un proceso que cierra sale
  del dataset y la marca tiene que sobrevivir.

⚠️⚠️ **Dos defectos que solo aparecieron al correr la migración con PGlite:**

1. **Postgres NO admite subconsultas en un CHECK** («cannot use subquery in check constraint»). El
   CHECK de `pesos` llevaba `not exists (select 1 from jsonb_each(pesos) …)` y la base lo rechazó.
   Salida: una función `immutable` (`radar_pesos_coherentes`), el patrón de `comision_coherente`.
2. **`array_length('{}', 1)` es NULL, no 0**, así que `check (array_length(terminos,1) >= 1)`
   **dejaba pasar el arreglo vacío**. Va con `coalesce(..., 0)`. Tercera vez que muerde lo mismo:
   un CHECK solo rechaza con FALSE.

## Detalles de la entrega que no se deducen del código

- ⚠️ **El gate de términos no se reimplementó**: se agregó `radar_secop` a `PRODUCTOS_ENTRADA` y se
  reusó entero el motor de Valida. Ver [[terminos-modulo-radar]].
- **Agregar un módulo obliga a tocar TRES listas de llaves en SQL** (`workspace_modulos_modulo`,
  `catalogo_servicios_modulo` y el `v_claves_modulo` de `proyectar_modulos`) además de
  `src/lib/modulos/catalogo.ts`. `src/lib/modulos/catalogo.test.ts` lee la última migración que las
  define y falla si se separan. Y crear la carpeta en `src/app/(app)` sin declarar la ruta también
  falla.
- El cron nuevo `/api/crons/radar-secop-sync` es el único de la entrega. Pagina porque **el
  `$limit` de Socrata corta en silencio**: la única señal de «se acabó» es un lote incompleto.
  Nunca borra filas.
- El puntaje corre **en el navegador** (la pantalla importa `puntuar.ts`) para que mover un peso
  reordene sin round-trip. Es la misma implementación, no una copia.
- **Fuera de alcance, anotado en la propia página**: el botón «esto se persigue» (crea el negocio en
  el pipeline), las cinco gráficas de la referencia, y el editor de temas uno por uno.

Relacionado: [[terminos-modulo-radar]], [[catalogo-servicios-a2]], [[modulos-gate-ruta-a1]],
[[techo-postgrest]], [[ensayo-sql-pglite]], [[cifras-del-brief-caducan]].
