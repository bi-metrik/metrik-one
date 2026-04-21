---
doc_id: 98I
version: 1.0
updated: 2026-04-02
depends_on: [98H]
depended_by: [34]
---

# Patrón Multi-Proceso en MéTRIK ONE

## Qué es

El patrón multi-proceso permite que un workspace de MéTRIK ONE tenga **múltiples líneas de negocio con flujos distintos** dentro del mismo tenant, sin crear workspaces separados.

Ejemplo: SOENA opera tres líneas simultáneamente — Vehículos Eléctricos (VE), Kaeser (compresores), e Incentivos B2B. Cada línea tiene etapas propias, campos específicos y gates distintos. Con multi-proceso, el equipo de SOENA ve todo en un solo login, filtrado por línea cuando lo necesitan.

## Modelo de datos

### workspace_stages.proceso

Columna `TEXT NULL` en `workspace_stages`.

| Valor | Significado |
|-------|------------|
| `NULL` | Etapa estándar — aparece en todos los procesos del workspace |
| `'ve'` | Exclusiva del proceso VE |
| `'kaeser'` | Exclusiva del proceso Kaeser |
| `'incentivos_b2b'` | Exclusiva del proceso Incentivos B2B |

Las etapas de sistema (`es_sistema = true`) siempre tienen `proceso = NULL` — son el esqueleto que todos los procesos comparten.

### custom_fields.condicion_visibilidad

Columna `JSONB NULL` en `custom_fields`.

| Valor | Comportamiento |
|-------|--------------|
| `NULL` | El campo siempre es visible |
| `{"campo": "linea_negocio", "valor": "ve"}` | Solo visible si `custom_data.linea_negocio === "ve"` |

El campo evaluado (`linea_negocio`) debe ser otro campo custom del mismo registro. La evaluación ocurre en el cliente antes de renderizar los campos.

## Cómo funciona en el frontend

### Selector de proceso en /pipeline

- Solo aparece si el workspace tiene al menos una etapa con `proceso IS NOT NULL`
- "Todos" por defecto (sin persistencia en localStorage)
- Al seleccionar un proceso: el kanban muestra etapas donde `proceso IS NULL OR proceso = seleccionado`
- Las oportunidades se filtran según el proceso de su etapa actual

### cycleEtapa

Cuando el usuario avanza una oportunidad:
1. Se detecta el `proceso` de la etapa actual de esa oportunidad
2. Se calcula la siguiente etapa dentro del conjunto `proceso IS NULL OR proceso = proceso_de_la_oportunidad`
3. El avance respeta los gates configurados via `tenant_rules`

### Visibilidad condicional de campos

En `CustomFieldsSection`:
1. Se cargan todos los campos del workspace para la entidad
2. Antes de renderizar, se evalúa `condicion_visibilidad` contra los valores actuales del registro
3. Un campo con `condicion_visibilidad = {"campo": "linea_negocio", "valor": "ve"}` solo aparece si `custom_data.linea_negocio === "ve"`
4. Los campos sin condición (`NULL`) siempre se renderizan

## Cómo configurar via skills

### Prerequisito: /configure-workflow

Cada proceso se configura agregando etapas custom con el campo `proceso` especificado:

```sql
INSERT INTO workspace_stages
  (workspace_id, entidad, nombre, slug, color, orden, es_sistema, sistema_slug, es_terminal, proceso)
VALUES
  ('[WORKSPACE_ID]', 'oportunidad', 'Solicitud Recibida', 'solicitud_recibida',
   '#6B7280', 15, false, NULL, false, 'kaeser');
```

Etapas sin proceso (`NULL`) son compartidas por todos los procesos.

### Prerequisito: /configure-fields

Campos con visibilidad condicional:

```sql
INSERT INTO custom_fields
  (workspace_id, entidad, nombre, slug, tipo, opciones, obligatorio, orden, condicion_visibilidad)
VALUES (
  '[WORKSPACE_ID]', 'oportunidad', 'Tipo de vehículo', 'tipo_vehiculo',
  'select', '["VE","HEV","PHEV"]'::jsonb, false, 3,
  '{"campo": "linea_negocio", "valor": "ve"}'::jsonb
)
ON CONFLICT (workspace_id, entidad, slug) DO UPDATE SET
  nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo, opciones = EXCLUDED.opciones,
  obligatorio = EXCLUDED.obligatorio, orden = EXCLUDED.orden,
  condicion_visibilidad = EXCLUDED.condicion_visibilidad,
  activo = true, updated_at = NOW();
```

### Orquestador: /configure-clarity

El skill `/configure-clarity` acepta briefs multi-proceso con la siguiente estructura:

```
PROCESOS:
  - nombre: ve | label: Vehículos Eléctricos
  - nombre: kaeser | label: Kaeser
  - nombre: incentivos_b2b | label: Incentivos B2B

PIPELINE (proceso: ve):
  Etapas custom nuevas: [nombre | posicion | color]
  Campos custom: [nombre | tipo | opciones] | condicion: linea_negocio = ve

PIPELINE (proceso: kaeser):
  Etapas custom nuevas: Solicitud Recibida | entre lead_nuevo y ganada | color: #6B7280

PROYECTOS (proceso: ve):
  Campos custom: [nombre | tipo | opciones]
```

El skill parsea los procesos, construye el plan completo, muestra para aprobación, y ejecuta todo en secuencia.

## Ejemplo real: SOENA

SOENA es el primer cliente Clarity configurado sobre ONE con multi-proceso.

### Procesos

| nombre | label | Entidades |
|--------|-------|-----------|
| `ve` | Vehículos Eléctricos | Pipeline + Proyectos |
| `kaeser` | Kaeser | Pipeline (1 etapa custom) |
| `incentivos_b2b` | Incentivos B2B | Pipeline |

### Etapas por proceso (pipeline oportunidades)

| Etapa | proceso | Descripcion |
|-------|---------|-------------|
| lead_nuevo | NULL | Etapa de sistema — compartida |
| contacto_inicial | NULL | Etapa de sistema — compartida |
| discovery_hecha | NULL | Etapa de sistema — compartida |
| propuesta_enviada | NULL | Etapa de sistema — compartida |
| negociacion | NULL | Etapa de sistema — compartida |
| solicitud_recibida | kaeser | Solo para Kaeser: va directo a negociacion |
| ganada | NULL | Terminal — compartida |
| perdida | NULL | Terminal — compartida |

Para VE e Incentivos B2B: flujo estándar (solo etapas de sistema).

### Campos con visibilidad condicional (oportunidades)

Los 9 campos custom de VE tienen `condicion_visibilidad = {"campo": "linea_negocio", "valor": "ve"}`. Solo aparecen cuando el usuario selecciona `linea_negocio = VE`.

El campo `linea_negocio` (select: VE / Kaeser / Incentivos B2B) es siempre visible (`condicion_visibilidad = NULL`).

## Cuándo usar este patrón

Usar multi-proceso cuando:
- El cliente tiene **2+ líneas de negocio con flujos distintos** en el mismo equipo
- Las líneas **comparten contactos y empresas** del mismo directorio
- El equipo opera en un **solo workspace** y ver todo mezclado agrega ruido
- Las diferencias entre líneas son de **etapas adicionales o campos específicos** — no de permisos de acceso

No usar cuando:
- Las líneas tienen **equipos completamente separados** (crear workspaces separados)
- Las diferencias son solo de **nombre visible** de las etapas (usar renombrar en configure-workflow)
- Solo hay **un proceso** (proceso = NULL en todas las etapas — comportamiento por defecto)

## Limitaciones actuales

1. **PROCESO_LABELS es hardcodeado en el frontend**: Los labels visibles en el selector de proceso (`VE`, `Kaeser`, etc.) están definidos en `pipeline-list-v2.tsx`. Si se agrega un proceso nuevo no listado, se muestra el slug crudo. Para personalizarlo, MéTRIK actualiza el diccionario `PROCESO_LABELS`.

2. **Sin selector de proceso en /proyectos**: El filtro de proceso solo existe en `/pipeline`. En proyectos se muestra todo. Post-MVP.

3. **Gate no filtra por proceso**: Los `tenant_rules` con `block_transition` se evalúan para todos los procesos. Si se necesita un gate solo para VE, la condición debe incluir `{"campo": "linea_negocio", "operador": "eq", "valor": "ve"}` en las condiciones de la regla.
