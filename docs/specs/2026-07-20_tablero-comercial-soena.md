# Tablero comercial SOENA — seguimiento por vendedor

Fecha: 2026-07-20 · Owner codigo: Max · Estado: en QA

## Contexto

SOENA necesita ver el desempeno comercial por vendedor. Su pipeline vive en
`negocios` (Clarity), NO en `ventas_hechos` (0 registros SOENA; ese modelo es de
manufactura/Siesa). Por eso NO se reutilizan las RPCs de Rentabilidad Comercial
(`get_rentabilidad_comercial`, `get_vendedores_resumen`, `get_vendedor_perfil`),
que van sobre `ventas_hechos`. Camino elegido: RPCs nuevas sobre
`negocios + responsable_id`.

## RPCs (producto generico, opt-in)

Migracion de producto: `supabase/migrations/20260720000001_comercial_negocios_rpcs.sql`.
Ambas `SECURITY DEFINER`, `search_path=public`, revocadas a `anon`, con grant a
`authenticated`.

### `get_comercial_resumen_soena(p_workspace_id uuid) -> jsonb`
Una fila por responsable (incluye bucket sin responsable). Barrera de pertenencia:
solo devuelve datos si `p_workspace_id = current_user_workspace_id()`. Por fila:
conteos por stage (venta/ejecucion/cobro/cerrados), negocios totales y abiertos,
valor aprobado (`precio_aprobado`), honorario recaudado y tarifa recaudada
(pasante) por separado. Orden por honorario recaudado desc.

### `get_comercial_perfil_soena(p_responsable_id uuid) -> jsonb`
Detalle de un vendedor. `p_responsable_id NULL` = bucket sin responsable
(`responsable_id IS NOT DISTINCT FROM p_responsable_id`). Scope al workspace del
llamante via `current_user_workspace_id()`. Devuelve KPIs, conversion por stage
(cuantos negocios y valor en cada uno) y el detalle de negocios con
etapa/valor/recaudo desglosado.

## Decision de metrica: honorario vs tarifa (Mauricio, 2026-07-20)

El headline por vendedor es el **honorario recaudado = ingreso real**. La **tarifa
UPME (pasante)** es plata de terceros (SOENA solo la recauda y la desembolsa a la
UPME); se muestra en una linea secundaria separada, etiquetada "terceros", y jamas
se suma al desempeno comercial.

La definicion se reconcilia con `v_pyl_mes` (migracion 20260708000011) para NO
divergir del EBITDA:

    honorario_recaudado = SUM(cobros.monto) WHERE fecha IS NOT NULL
                                              AND tipo_cobro IS DISTINCT FROM 'pasante'
    tarifa_recaudada    = SUM(cobros.monto) WHERE fecha IS NOT NULL
                                              AND tipo_cobro = 'pasante'

`IS DISTINCT FROM` es null-safe: cobros legacy con tipo NULL cuentan como
honorario, igual que en el P&L.

### Caveat conocido (NO es bug de estas RPCs)

El "Grupo 3" de SOENA aun no esta reclasificado a `tipo_cobro='pasante'`. Hoy no
hay ningun cobro `pasante` en SOENA -> la linea de tarifa sale en 0 y el honorario
recaudado arrastra algo de tarifa. El numero se **auto-corrige** cuando se aplique
esa reclasificacion pendiente. No se debe "arreglar" en estas RPCs.

## Bucket sin responsable

32 de 82 negocios SOENA no tienen `responsable_id` (al 2026-07-20). NO se
higienizan: aparecen agrupados bajo el bucket "(sin responsable)" (id NULL),
visible tanto en la lista del equipo como con su propio perfil, para que no
desaparezcan. Los datos de `responsable_id` tienen algo de ruido (ej. un negocio
con responsable de operaciones); las RPCs son tolerantes y no lo limpian.

## UI

Rutas nuevas en el App Router, gateadas por `modules.comercial_negocios`:

- `/equipo` — nueva rama en `equipo/page.tsx`: si el workspace tiene
  `comercial_negocios` y el rol gestiona equipo, renderiza `ComercialClient`
  (tarjetas por responsable con conteos por stage + valor aprobado + honorario
  recaudado + tarifa aparte, mas la tarjeta "Sin responsable"). Calca el patron
  de la rama `rentabilidad_comercial`.
- `/equipo/comercial/[staff_id]` — perfil del vendedor (`ComercialPerfilClient`):
  KPIs, conversion por stage y detalle de negocios. `staff_id = 'sin-responsable'`
  resuelve el bucket (la action pasa `NULL` a la RPC).

Archivos: `comercial-types.ts`, `comercial-actions.ts`, `comercial-client.tsx`,
`comercial/[staff_id]/page.tsx`, `comercial/[staff_id]/comercial-perfil-client.tsx`.

## Activacion SOENA

`modules.comercial_negocios=true` para el workspace SOENA
(`7dea141d-d4da-483d-a78d-b14ef35500c5`). Aplicado a prod 2026-07-20; registro en
`proyectos/soena/ve/migrations/20260720_comercial_negocios_flag.sql`. Opt-in: no
afecta otros workspaces.

---

# Iteracion 2 (2026-07-21) — paridad total con el Sheet "INDICADORES DE VENTA" + metas

Objetivo: reemplazar el dashboard de Google Sheets de Daniela. Todo en vivo desde
`negocios + cobros + propuestas`, cero tecleo manual.

## Las 6 definiciones (fijadas leyendo el esquema, no inventadas)

### 1. Que es "una venta" y su fecha
Una venta = una **propuesta economica APROBADA**: bloque `bloque_definitions.tipo =
'propuesta_economica'` con `data.aprobado_at IS NOT NULL`. Su FECHA es
`data.aprobado_at` (el equivalente ONE de la "fecha de cierre" del Sheet: es el
evento con timestamp confiable que fija el ingreso).
- **Canonica por negocio:** un negocio tiene varias versiones/bloques de propuesta
  (vi hasta 3 filas identicas por negocio). Se toma UNA por negocio con
  `DISTINCT ON (negocio_id) ... ORDER BY aprobado_at DESC` para NO inflar el conteo x3.
- Datos SOENA al 2026-07-21: 23 negocios con propuesta aprobada (16 con honorario > 0),
  21 de ellas en julio 2026. Planes 1 (50/50) y 2 (unico) presentes.

### 2. Primer vs segundo pago
En SOENA los cobros NO usan `numero_cuota` ni `plan_cobro_id` (ambos NULL hoy en los
32 cobros). El discriminador real es `tipo_cobro`:
- **Primer pago** = `tipo_cobro IN ('anticipo','pago')` (anticipo = 50% del plan 50/50;
  pago = pago unico del plan 2, deja el negocio saldado). 28 anticipos + 4 pagos hoy.
- **Segundo pago** = `tipo_cobro = 'saldo'` (saldo del 50/50). Hoy no existe ninguno;
  la columna aparecera cuando se registre el primer saldo. Se modela ya.
- La tarifa UPME (`tipo_cobro='pasante'`) queda SIEMPRE fuera de todo total comercial
  (plata de terceros).

### 3. IVA
La propuesta guarda el honorario **CON IVA** en `data.aprobado_honorario` y el IVA en
`data.iva_pct` **guardado como fraccion** (ej. `0.19`; se normaliza `>1 -> /100` por si
algun registro trae `19`; default `0.19`). Base con IVA = `precio_base_con_iva` = 850.000
(servicio $714.286 sin IVA + 19%).
- `honorario_sin_iva = honorario_con_iva / (1 + iva_frac)`.
- **Headline = honorario SIN IVA** (ingreso limpio). "con IVA" es columna secundaria de
  paridad con el Sheet. La tarifa UPME nunca entra a totales de desempeno.

### 4. Caso completo / tasa
No hay `completado_at` confiable de cierre financiero. Caso completo = **negocio saldado**:
`honorario_recaudado >= honorario_sin_iva - 1` (tolerancia 1 peso). Tasa = casos completos
/ num ventas del mes.

### 5. Tasa de cancelacion
`negocios.estado = 'perdido'` sobre el universo del mes (ventas del mes + perdidos del mes,
por `updated_at`). En el flujo VE, perder marca `estado='perdido'` (1 negocio hoy);
`tipo_cierre`/`cierre_motivo` aun NO se pueblan, asi que `estado` es la senal fiable.

### 6. Tasa de recaudo
`honorario_recaudado (sin IVA) / honorario_esperado (sin IVA)` de negocios con propuesta
aprobada, MISMO universo en numerador y denominador.
- **CAVEAT reconciliacion con el Sheet (70.1%):** con los datos parciales de hoy la cifra
  NO reconcilia y puede pasar de 100% (medido 172% en una corrida) porque el honorario
  recaudado aun **arrastra tarifa UPME** por el Grupo 3 sin reclasificar a `pasante`, y
  porque hay cobros de negocios sin propuesta aprobada. Se auto-corrige con la
  reclasificacion pendiente. NO se fuerza el numero; se documenta la divergencia.

## Mapeo metrica Sheet -> ONE

| Sheet (Daniela) | ONE (RPC) |
|---|---|
| Vendedores hardcodeados (Bruce, Tejada, Ibanez, Jativa) | `responsable_id` REAL + bucket "(sin responsable)". Jenny Cepeda (14 negocios) SI aparece. **Ventaja mantenida.** |
| Numero de ventas | `num_ventas` = propuestas aprobadas del mes |
| Valor del negocio (con/sin IVA) | `valor_con_iva` / `valor_sin_iva` |
| Primer / segundo pago (con/sin IVA) | `primer_pago` / `segundo_pago` (recaudo real) |
| Casos completos + tasa | `casos_completos` / `tasa_casos_completos` |
| % participacion de ventas | `participacion_pct` |
| Ticket promedio | `ticket_promedio` = valor_sin_iva / num_ventas |
| Mejor dia + ventas de ese dia | `mejor_dia` / `mejor_dia_ventas` |
| Promedio diario / ingreso promedio/dia | `promedio_ventas_dia` / `ingreso_promedio_dia` |
| Cumplimiento de metas | `cumplimiento_num` / `cumplimiento_valor` vs `metas_comerciales` |
| Tasa de cancelacion | `tasa_cancelacion` |
| Ventas proyectadas (run-rate) | `ventas_proyectadas` (proyeccion por dias transcurridos) |
| Series historicas dic/2025 -> hoy | `get_comercial_serie_mensual_soena` |
| Tasa de recaudo global | `serie.tasa_recaudo_global` |

## RPCs nuevas (producto generico, opt-in)

Migracion `supabase/migrations/20260721000002_comercial_serie_kpis_rpcs.sql`.
- `get_comercial_kpis_mes_soena(p_workspace_id, p_anio, p_mes)` -> KPIs del mes + tabla
  por vendedor del mes (incluye bucket sin responsable + metas por vendedor).
- `get_comercial_serie_mensual_soena(p_workspace_id, p_meses)` -> serie de los ultimos N
  meses (ventas, valor con/sin IVA, recaudo, primer/segundo pago) + tasa de recaudo global.
- Ambas SECURITY DEFINER + check de pertenencia (`current_user_workspace_id`), revocadas
  a PUBLIC/anon, grant solo a authenticated. Idempotentes, rollback comentado.

## Tabla nueva: metas_comerciales

Migracion `supabase/migrations/20260721000001_metas_comerciales.sql`.
`(workspace_id, staff_id NULLABLE, anio, mes, meta_num_ventas, meta_valor, created_by)`.
- `staff_id NULL` = **meta global del equipo**; `staff_id != NULL` = meta por vendedor.
- Indice unico `(workspace_id, staff_id, anio, mes)` con **NULLS NOT DISTINCT** (la fila
  global no se duplica).
- RLS por workspace + grant a authenticated. **Editable por owner/admin/supervisor**
  (gate en la server action `guardarMetaComercial`, misma puerta que conciliacion).
- Cumplimiento = real / meta, en vivo.

## UI (calca patrones ONE, sin inventar diseno)

`/equipo` (branch `modules.comercial_negocios`), `ComercialClient` reescrito:
- Selector de mes (< Mes >) con re-consulta via `useTransition`.
- Panel de KPIs mensuales (8 tiles).
- Tabla por vendedor del mes con fila TOTAL (espeja el Sheet).
- Series historicas: 4 charts Recharts (ventas/mes linea; valor/mes barra; recaudo/mes
  barra; primer vs segundo pago apilado).
- Embudo por etapa + honorario-vs-tarifa (tarjetas del resumen historico, iteracion 1).
- Boton "Metas del mes" (solo owner/admin/supervisor) -> `MetasModal` (global + por vendedor).
- Perfil `/equipo/comercial/[staff_id]` sin cambios (iteracion 1).

Archivos nuevos: `metas-modal.tsx`. Extendidos: `comercial-types.ts`, `comercial-actions.ts`,
`comercial-client.tsx`, `page.tsx`.

---

# Iteracion 3 (2026-07-21) — arquitectura de ubicacion: Tableros (agregado) vs Equipo (por persona) + ranking

## Principio (Mauricio)

Los indicadores comerciales AGREGADOS no son de "Equipo". Equipo es sobre las
personas, no sobre el pipeline agregado. Por eso:

- **El tablero AGREGADO vive en `/tableros` (pestaña "Comercial").**
- **`/equipo` muestra una hoja de indicadores POR PERSONA + ranking.**

Nada del contenido de la iteracion 2 se reconstruyo: se RELOCALIZO. Las RPCs de
las iteraciones 1 y 2 (`get_comercial_resumen_soena`, `get_comercial_kpis_mes_soena`,
`get_comercial_serie_mensual_soena`) y la tabla `metas_comerciales` quedan intactas
(NO se re-migraron).

## 1. Tablero agregado -> pestaña "Comercial" de `/tableros`

- Componente nuevo `tableros/components/tab-comercial-soena.tsx` (`TabComercialSoena`):
  es el cuerpo del antiguo `ComercialClient` (selector de mes, panel KPIs, tabla por
  vendedor con TOTAL, 4 charts historicos, embudo por etapa, honorario/tarifa, modal
  de Metas), sin el `<h1>` de pagina (Tableros ya pone su header). En Tableros el
  embudo por vendedor NO enlaza al perfil (el drill al perfil vive en Equipo).
- `tableros-client.tsx`: nueva `TabKey` `comercial_negocios` con label "Comercial".
  Cuando `modules.comercial_negocios` esta activo, esta pestaña REEMPLAZA la pestaña
  "Comercial" generica del pipeline (`BUSINESS_TABS` filtra `comercial`). El periodo
  global de Tableros no aplica a esta pestaña (tiene su propio selector de mes, igual
  que Rentabilidad Comercial y Cumplimiento).
- `tableros/page.tsx`: carga el bundle (`getComercialResumen` + `getComercialMes` +
  `getComercialSerie` + `getMetasComerciales`) SOLO si `modules.comercial_negocios` +
  rol owner/admin/supervisor. Lo pasa como `initialComercialNegocios`.
- El antiguo `equipo/comercial-client.tsx` se ELIMINO (codigo muerto tras el traslado).

## 2. `/equipo` -> hoja por persona + ranking

- Componente nuevo `equipo/equipo-comercial-personas-client.tsx`
  (`EquipoComercialPersonasClient`): bajo `comercial_negocios`, `/equipo` lista al
  equipo comercial como tarjetas POR PERSONA con: ventas del mes, valor vendido del
  mes (sin IVA headline), honorario recaudado, valor aprobado, negocios activos, y la
  POSICION de ranking de cada indicador. Cada tarjeta enlaza a su perfil
  `/equipo/comercial/[staff_id]` ("Ver mi hoja").
- El bucket "(sin responsable)" NO entra al ranking (no es una persona): se muestra
  como fila informativa aparte, debajo de las tarjetas.
- El perfil individual `comercial-perfil-client.tsx` gana un banner de ranking
  PROMINENTE (posicion en recaudo con trofeo si es #1, + posiciones de valor aprobado
  y negocios activos).
- **Fallback preservado:** cuando `comercial_negocios` NO esta activo, `/equipo` sigue
  mostrando la vista generica de gestion de horas/staff (`EquipoClient`) intacta.
- **Acceso:** owner/admin/supervisor (gate `canManageTeam`), aunque el supervisor no
  sea del area comercial (confirmado por Mauricio).

## Logica del ranking (helper PURO, sin tocar RPCs)

`equipo/comercial-ranking.ts`:
- `computeRanking(resumen)` toma el output de `get_comercial_resumen_soena`
  (iteracion 1) y calcula, por persona, la posicion en 3 metricas:
  `honorario_recaudado`, `valor_aprobado`, `negocios_abiertos`. NO duplica la fuente.
- Ranking estandar: orden descendente por metrica; empates comparten posicion
  (1, 1, 3...). El bucket sin responsable se excluye del ranking y se devuelve aparte.
- `rankingDePersona(ranking, staffId)` resuelve la posicion de una persona (usado por
  el perfil individual). El orden de presentacion por defecto es honorario recaudado
  desc.
- Puro y testable: no toca DB ni red; se alimenta del resumen ya cargado.

## Migraciones

Ninguna nueva. Iteracion de UI + un helper puro. Las RPCs y `metas_comerciales`
siguen como quedaron en la iteracion 2 (en prod).

---

# Iteracion 4 (2026-07-21) — correccion de fondo: venta = primer pago + operator + ranking por ventas

Disparada por el transcript de la reunion con Daniela. Mauricio confirmo los cambios.

## CORRECCION CRITICA — definicion #1 REEMPLAZADA

La definicion de venta de las iteraciones 1-3 (venta = propuesta aprobada,
`data.aprobado_at`) estaba MAL segun el cliente. Daniela: **"una venta = cuando el
cliente le paga a SOENA"** (primer pago de honorario recibido).

**Nueva definicion (reemplaza `aprobado_at` como ancla en TODAS las RPCs):**
- **fecha_venta(negocio) = MIN(cobros.fecha) WHERE fecha IS NOT NULL AND
  tipo_cobro <> 'pasante'** (primer pago de honorario; la tarifa Boome/UPME
  'pasante' NO cuenta como venta ni entra jamas al desempeno; `IS DISTINCT FROM`
  es null-safe).
- Un negocio es VENTA solo si tiene >= 1 pago de honorario. Sin pago -> NO es
  venta, NO aparece en la estadistica comercial.
- "Ventas del mes" = negocios cuya fecha_venta (primer pago) cae en ese mes.
- El honorario aprobado de la propuesta canonica (con/sin IVA) YA NO determina si
  es venta: solo aporta el VALOR (monto). Se sigue tomando por DISTINCT ON negocio.

**Divergencia medida:** julio 2026 = 21 ventas con la def vieja (aprobado_at) vs
**18 con la correcta** (primer pago). Total historico 28 ventas. Serie real por mes
(por fecha de primer pago): Feb 2, Abr 3, May 2, Jun 3, Jul 18. Julio por vendedor:
Jessica 10, Daniela 5, Jenny 3.

Afecta las 4 RPCs (`get_comercial_resumen_soena`, `get_comercial_perfil_soena`,
`get_comercial_kpis_mes_soena`, `get_comercial_serie_mensual_soena`). Migracion
`supabase/migrations/20260721000003_comercial_venta_por_pago.sql` (idempotente,
rollback comentado). Aplicada a prod via MCP.

## Pagos partidos -> "pago uno"

Varios pagos parciales de honorario del cliente se AGREGAN al PRIMER pago hasta
cubrir el honorario, sin importar el tipo_cobro (anticipo/pago). El "segundo pago"
es el saldo del 50/50 (`tipo_cobro='saldo'`, hoy inexistente). Boome (pasante)
NUNCA entra en 1er/2o pago. Se ajusto la logica:
- `primer_pago  = SUM(monto) WHERE tipo_cobro <> 'pasante' AND <> 'saldo'`
- `segundo_pago = SUM(monto) WHERE tipo_cobro = 'saldo'`
(antes primer = anticipo+pago; el cambio lo hace resistente a pagos partidos con
cualquier etiqueta). Datos: 4 negocios SOENA tienen pago partido; con fecha=MIN
cuentan como 1 venta con la fecha del primer abono, correcto.

## Ranking por NUMERO DE VENTAS (no recaudo)

Daniela: "el ranking es con respecto a las ventas". La metrica PRIMARIA del ranking
pasa a **numero de ventas del periodo** (negocios pagados); recaudo y valor quedan
secundarios. El helper puro `comercial-ranking.ts` gana `rank_ventas` (primario) y
ordena por el; `get_comercial_resumen_soena` expone `num_ventas` por responsable.
Transparente entre comerciales (nombres + posiciones de todos). Ranking estandar
con empates compartidos. Validado: Jessica #1 (20), Daniela #2 (5), Jenny #3 (3),
tres empatadas #4 (0).

## ACCESO — operator ve SU perfil + ranking

Mauricio aprobo que cada comercial (rol `operator`) vea su propia hoja:
- El nav `/equipo` se abre a `operator` cuando `modules.comercial_negocios` esta
  activo (en `app-shell.tsx`: se inyecta `operator` a los roles de `/equipo` bajo
  el flag). El tablero AGREGADO de `/tableros` sigue restringido a owner/admin/
  supervisor.
- `/equipo` (page): si el rol es operator, redirige a `/equipo/comercial/{su-staffId}`
  (su propio perfil). Gerencia (owner/admin/supervisor) ve el indice de personas.
- `/equipo/comercial/[staff_id]` (page): operator solo puede abrir SU staff_id; si
  intenta otro -> redirige al propio. Ve sus indicadores + el ranking (que es
  transparente: nombres + posiciones + numero de ventas de todos, sin cifras
  financieras detalladas de otros). Gerencia ve cualquier perfil.
- **Fallback preservado:** sin `comercial_negocios`, `/equipo` sigue mostrando la
  gestion de horas/staff; el nav de `/equipo` no gana operator.

## Meta real = 69 ventas/mes

Se reemplazo la meta de PRUEBA (25 / $9M) por la real: **meta_num_ventas = 69**
para el mes en curso (global, staff_id NULL). Daniela NO dio meta de valor -> 
`meta_valor` queda NULL (no se inventa). Cumplimiento julio: 18/69 = 26.1%;
cumplimiento_valor = null (no exigido).

## Ajustes menores

- **Ventas diarias del mes:** grafico de barras "Ventas por dia" en `/tableros` ->
  pestaña Comercial, usando la fecha-de-venta (primer pago). RPC kpis expone
  `porDia` (dia + conteo). Daniela lo pidio ("diariamente cuantas ventas llevamos").
- **Embudo por vendedor con $ pendiente:** el perfil muestra el embudo por
  etapa/estatus con el MONTO pendiente de recaudo del honorario
  (`pendiente_honorario = max(precio_aprobado - honorario_recaudado, 0)`) por etapa.
  La RPC de perfil expone `porEtapa` (+ `pendiente_honorario` en kpis y por negocio).
- **Cancelacion de-priorizada:** se mantiene el KPI `tasa_cancelacion` pero sin
  protagonismo (un tile mas, no destacado).

## Definiciones vigentes tras iteracion 4

1. **Venta = primer pago de honorario recibido** (fecha = MIN cobros.fecha no
   pasante). REEMPLAZA `aprobado_at`. Gobierna num ventas, ticket, participacion,
   cumplimiento, run-rate, series y el conteo del ranking.
2-6. Sin cambios respecto a iteracion 2 (1er/2o pago ajustado a pagos partidos;
   IVA; caso completo = saldado; cancelacion = estado perdido; tasa recaudo con
   caveat Grupo 3).
