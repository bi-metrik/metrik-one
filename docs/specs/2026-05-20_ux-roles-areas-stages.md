# Spec UX — Fase 3+ Modelo roles · areas · stages

**Fecha:** 2026-05-20
**Owner UX:** Noor
**Owner implementacion:** Max
**Branch:** `feat/roles-areas-stages-fase-1`
**Fuentes:**
- `cerebro/conceptos/modelo-roles-areas-stages.md`
- `cerebro/reglas/permisos-negocios.md`
- `cerebro/conceptos/identidad-visual-metrik.md`
- `cerebro/conceptos/voz-metrik.md`
- `metrik-one/docs/specs/2026-05-20_roles-areas-stages.md` (spec tecnica Fases 1-2 cerradas)
- Server actions: `src/lib/permissions/can-edit.ts`, `src/lib/actions/bloque-locks.ts`

## Resumen ejecutivo

Spec UX para 6 superficies de Fase 3+ que se montan encima de la logica server ya lista (canEditBloque, bloque_locks, cascadas, cierre adelantado, reapertura). Diseno mobile-first 360px, tokens MeTRIK puros (Negro Carbon / Gris Acero / Verde Metrica), Montserrat UI. Cada superficie es independiente: equipo multi-area, bloque cierre adelantado, lista cerrados, historial etapas anteriores, lock pesimista con banner amber, modal reapertura con bifurcacion. Componentes nuevos identificados: 9 (AreaBadge, AreaMultiSelect, DefaultResponsablesPicker, BloqueCierre, ConfirmCierreModal, EtapasHistorialAccordion, BloqueLockBanner, BloqueLockOwnIndicator, ReabrirNegocioModal). Cero acoplamiento con render existente — todo se enchufa via props en detalle de negocio y `/mi-negocio/equipo`.

## Tokens MeTRIK aplicados a esta spec

Estos tokens reemplazan los `slate-*` / `zinc-*` genericos de Tailwind. Max debe usarlos directamente en Tailwind config como custom colors si no estan ya registrados.

```
--negro-carbon: #1A1A1A   /* Texto principal, headers */
--gris-acero:   #6B7280   /* Texto secundario, labels, area operaciones */
--verde-metrica:#10B981   /* CTAs, area comercial, success */
--verde-dark:   #059669   /* Hover Verde Metrica */
--rojo-alerta:  #EF4444   /* Cerrar/destructivo, lock banner critico */
--amarillo-warn:#F59E0B   /* Banner editando, pausa */
--gris-linea:   #E5E7EB   /* Bordes, divisores */
--fondo-crema:  #F5F4F2   /* Fondo pagina, cards secundarios */
--blanco-papel: #FFFFFF   /* Cards principales */
```

### Mapeo area → color visual

| Area | Background chip | Text | Border |
|------|-----------------|------|--------|
| `comercial` | `verde-metrica` 10% (#10B98119) | `verde-dark` (#059669) | `verde-metrica` |
| `operaciones` | `negro-carbon` 8% (#1A1A1A14) | `negro-carbon` (#1A1A1A) | `negro-carbon` 30% |
| `financiera` | `gris-acero` 12% (#6B72801F) | `gris-acero` (#6B7280) | `gris-acero` 40% |
| `direccion` | gradient sutil `fondo-crema` → blanco | `negro-carbon` | dashed `gris-linea` |

`direccion` deliberadamente sin color solido para reforzar que es **transversal**, no un area mas en la fila. Tooltip al hover: "Acceso a las 3 areas operativas".

## Reglas transversales

- **Mobile-first 360px**. Cada superficie testeada mentalmente a 360 antes de proponer.
- **Touch target ≥44px** en todo control tap-able (botones, chips eliminables, dropdown triggers).
- **Tipografia:** Montserrat 14 (UI base), 12 (labels secundarios), 16 (titulos cards). DM Serif Display solo en titulos de seccion grandes (`<h1>` superficie). Pesos: 400 (cuerpo), 500 (labels), 600 (titulos), 700 (cifras / CTAs).
- **Estados vacios proponen accion.** Nunca "No hay datos" sin CTA siguiente.
- **Errores recuperables sin recargar.** Toast (Sonner) + retry inline. Nunca redirect duro.
- **Voz MeTRIK:** profesional directo. No "Acceso denegado" → "Tu rol no edita este bloque. Habla con tu supervisor."
- **Componentes base:** Radix UI primitivos (ya en stack) + shadcn `Button`, `Dialog`, `Tabs`, `Popover`, `Tooltip`, `Select`. Sonner para toasts.

---

## Superficie 1 — `/mi-negocio/equipo` multi-area

### Objetivo

Permitir al supervisor/admin/owner ver el staff del workspace y editar sus areas asignadas sin limite cardinal. Tambien configurar `workspace_default_responsables` por area para alimentar la cascada server.

### Estructura visual (desktop ≥768px)

```
┌─────────────────────────────────────────────────────────────┐
│ Equipo del workspace                            [+ Invitar] │
│ DM Serif Display 28pt                            CTA verde  │
├─────────────────────────────────────────────────────────────┤
│ Responsables por defecto (cascada automatica)               │
│ ┌─ Comercial ──┐  ┌─ Operaciones ──┐  ┌─ Financiera ─┐      │
│ │ Carla R. ▼  │  │ Sin default ▼  │  │ Daniel M. ▼  │      │
│ │ "Sin default│  │  se usa cascada"│ │              │      │
│ └──────────────┘  └────────────────┘  └──────────────┘      │
├─────────────────────────────────────────────────────────────┤
│ Staff (N personas)                  [Filtro rol ▼]          │
│                                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Carla Ramirez                                            │ │
│ │ Supervisor                                               │ │
│ │ [Comercial] [Direccion]                  [Editar areas]  │ │
│ │ 4 negocios activos                       [Transferir...] │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Daniel Martinez                                          │ │
│ │ Operator                                                 │ │
│ │ [Financiera]                            [Editar areas]   │ │
│ │ 2 negocios activos                      [Transferir...]  │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Mobile (360px)

- Stack vertical puro. Cards full-width.
- `Responsables por defecto` colapsable en accordion (Radix `Accordion`) — collapsed por default si hay ≥5 staff.
- Cada card de staff con altura ~140px. Acciones secundarias (`Transferir...`) en menu `…` dentro de la card para liberar espacio.

### Componentes nuevos

| Componente | Proposito | Primitivo |
|------------|-----------|-----------|
| `AreaBadge` | Render visual de un area como chip con color del area. Variants: filled, outline, dashed (`direccion`) | shadcn `Badge` extendido |
| `AreaMultiSelect` | Selector multi-area con chips eliminables, sin limite cardinal. Dropdown con 4 opciones. Tooltip en `direccion` | Radix `Popover` + `Checkbox` |
| `DefaultResponsablesPicker` | 3 dropdowns (1 por area operativa) con buscador de staff filtrado por area | Radix `Combobox` (cmdk) |

### Interacciones

**Card de staff:**
- Hover/tap: card sube 2px con shadow `0 4px 12px rgba(26,26,26,0.08)`.
- `[Editar areas]` (touch target 44px): abre `Dialog` con `AreaMultiSelect` precargado.
- `[Transferir negocios]` (visible solo si N negocios > 0): abre flujo de reasignacion (out-of-scope esta spec, marcar como TODO Max).

**Modal "Editar areas":**
- Titulo: `Areas de [nombre]`
- Chips actuales arriba (eliminables con × en cada chip si user es admin/owner/supervisor con poder).
- Dropdown abajo para agregar mas areas. Las ya seleccionadas se ocultan.
- `direccion` siempre disponible con icono `Compass` (Lucide) + tooltip.
- Validacion cliente: si rol del staff es `operator`/`supervisor`/`admin`/`owner` y `areas.length === 0`, boton `Guardar` deshabilitado con helper text en rojo: "Debe asignar al menos un area".
- Validacion cliente: si rol es `contador`/`read_only`, oculta el modal entero (mensaje informativo: "Este rol no usa areas — esta fuera del modelo").

**Form de invitar/anadir staff:**
- Step 1: Datos basicos (email, nombre).
- Step 2: Rol (Select con 6 opciones).
- Step 3 (condicional):
  - Si rol ∈ {operator, supervisor, admin, owner}: muestra `AreaMultiSelect` obligatorio con helper "Define al menos un area para definir permisos."
  - Si rol ∈ {contador, read_only}: oculta selector, muestra info inline: "Este rol no se asigna a areas — accesos por defecto."
- Submit deshabilitado hasta cumplir reglas.

**`DefaultResponsablesPicker`:**
- 3 dropdowns horizontales (desktop) / verticales (mobile).
- Cada uno lista staff con area correspondiente (incluyendo `direccion`).
- Valor inicial: "Sin default — se usa cascada" en italica `gris-acero`.
- Solo `supervisor`/`admin`/`owner` puede editar (server valida). Otros ven readonly.
- Cambio dispara server action + toast "Default actualizado".

### Estados

| Estado | Render |
|--------|--------|
| Loading inicial | Skeleton: 3 cards `bg-fondo-crema h-28 animate-pulse` |
| Empty (sin staff) | Card central "Aun no tienes equipo invitado. [+ Invita a tu primer miembro]" |
| Empty por filtro rol | "Sin personas con rol [X]. [Quitar filtro]" |
| Empty default por area | "Sin staff con area [Financiera]. [Agregar miembro]" (CTA abre form invitar con area pre-llenada) |
| Error guardar areas | Toast rojo + mantiene modal abierto + boton `Reintentar` |
| Loading guardando | Boton `Guardar` muestra spinner Lucide + texto "Guardando..." |

### Permisos

| Accion | owner | admin | supervisor | operator | contador | read_only |
|--------|:-----:|:-----:|:----------:|:--------:|:--------:|:---------:|
| Ver pagina | si | si | si | no | no | si |
| Editar areas de cualquier staff | si | si | no | — | — | — |
| Editar areas de staff de su area | — | — | si | — | — | — |
| Editar default responsables | si | si | si | — | — | — |
| Invitar staff | si | si | no | — | — | — |
| Transferir negocios | si | si | si* | — | — | — |

\* supervisor solo dentro de sus areas.

### Server actions consumidas

| Accion UI | Server action |
|-----------|---------------|
| Cargar staff + areas | Nueva: `getEquipoConAreas(workspaceId)` — devuelve `staff[]` con `areas: Area[]` join a `staff_areas` + `negociosActivosCount` |
| Cargar default responsables | Nueva: `getWorkspaceDefaultResponsables()` |
| Editar areas de un staff | Nueva: `updateStaffAreas(staffId, areas: Area[])` — valida regla 14a |
| Cambiar default por area | Nueva: `setWorkspaceDefaultResponsable(area, staffId \| null)` |
| Invitar staff con areas | Extender `inviteTeamMember(...)` existente con param `areas: Area[]` |

---

## Superficie 2 — Bloque cierre adelantado

### Objetivo

Permitir cerrar un negocio antes de su flujo natural por motivo `perdido` (solo venta + cero pagos) o `cancelado` (cualquier stage, notifica owner). El bloque solo aparece si la `etapa.id` esta en `habilitar_perdido_en_etapas` o `habilitar_cancelado_en_etapas`.

### Estructura visual (mobile-first)

```
┌────────────────────────────────────────────┐
│ [icono PowerOff]  Cerrar negocio           │ ← negro-carbon
│                                            │
│ Antes de continuar al siguiente paso,      │ ← gris-acero
│ puedes cerrar el negocio si ya sabes       │
│ que no avanzara.                           │
│                                            │
│        [ Cerrar negocio  ▼ ]               │ ← rojo-alerta border
│                                            │
└────────────────────────────────────────────┘
```

Si solo uno de los dos motivos esta habilitado, el dropdown se omite — boton directo `Marcar como perdido` o `Cancelar negocio`.

Si ambos:
```
   ▼ al tocar
   ┌──────────────────────────┐
   │ ◯ Marcar como perdido    │
   │   El cliente no convirtio │
   │                          │
   │ ◯ Cancelar negocio       │
   │   Detener con recursos   │
   │   ya invertidos          │
   └──────────────────────────┘
```

### Modal de confirmacion — `ConfirmCierreModal`

**Comun a ambos motivos:**
- Titulo: "Cerrar negocio como [Perdido | Cancelado]"
- Body abierto: copy MeTRIK explicando consecuencia (sin tono dramatico).
- Textarea `Razon del cierre` (max 500 chars, obligatorio).
- Footer: `[Cancelar]` (gris-acero outline) + `[Confirmar cierre]` (rojo-alerta filled).

**Para PERDIDO:**
- Pre-validacion server al abrir modal: si hay 1+ cobro asociado, modal renderiza estado bloqueante:
  ```
  No se puede marcar como perdido
  Este negocio tiene cobros registrados ($X.XXX.XXX).
  Lo correcto es cancelarlo y definir el manejo de los pagos.
  [Cancelar] [Cambiar a Cancelar negocio →]
  ```
- Si valida: textarea de razon + checkbox opcional `Notificar a [responsable]`.

**Para CANCELADO:**
- Si hay cobros: aparece campo adicional `Manejo de pagos realizados` (textarea obligatorio, min 30 chars). Helper text: "Describe si se devuelve, se reconoce como anticipo a otro negocio, o queda como ingreso por trabajo ejecutado."
- Aviso permanente arriba (banner `amarillo-warn` 10% bg):
  ```
  Esta accion notificara al owner ([nombre]) por email y in-app
  cuando confirmes.
  ```
- Textarea razon.

### Componentes nuevos

| Componente | Proposito | Primitivo |
|------------|-----------|-----------|
| `BloqueCierre` | Render condicional + boton/dropdown segun config_extra | Radix `DropdownMenu` |
| `ConfirmCierreModal` | Modal multi-modo (perdido / cancelado / pre-validacion fallida) | Radix `Dialog` |

### Estados

| Estado | Render |
|--------|--------|
| Default | Card visible con boton activo |
| Sin permiso | Card oculta (UX server-side: server no entrega config) |
| Submitting | Boton confirm spinner + textarea disabled |
| Error server (lock activo de otro bloque) | Toast rojo: "Este negocio esta siendo editado. Intenta en un momento." + modal cerrado |
| Exito | Toast verde "Negocio cerrado como [motivo]" + redirect a `/negocios?tab=cerrados` (o renderiza read-only inline si Mauricio prefiere). **Decision pendiente — ver Notas Max** |

### Permisos (regla 11)

| Motivo | Quien puede activar |
|--------|---------------------|
| Perdido (stage venta) | `canEditBloque(user, {stage:'venta'}, responsables)` = true Y `'comercial' ∈ areasEfectivas` (regla 10 + 11) |
| Cancelado (cualquier stage) | `user.role ∈ ('admin','owner')` (regla 9 + 11) |

### Server actions consumidas

| Accion | Server action |
|--------|---------------|
| Validar cero cobros al abrir modal perdido | Nueva: `validarCierrePerdido(negocioId)` → `{ok, cobrosCount}` |
| Marcar perdido | Nueva: `cerrarNegocioPerdido(negocioId, {razon, etapaCierreId})` |
| Marcar cancelado | Nueva: `cerrarNegocioCancelado(negocioId, {razon, manejoPagos?, etapaCierreId})` — dispara notif owner |

### Notas Max

- El bloque depende de leer `etapas_negocio.config_extra.habilitar_perdido_en_etapas` y `habilitar_cancelado_en_etapas` (arrays de etapa_id) de la etapa activa.
- La etapa donde se registra el evento de cierre = etapa activa al momento del cierre (no la etapa final del flujo).
- **Decision UX pendiente:** despues de cerrar, prefieres (a) redirect a `/negocios?tab=cerrados` o (b) re-render del detalle en modo read-only con badge `Cerrado · [motivo]`. Recomendacion Noor: **(b)** — mantiene contexto y permite revisar inmediatamente. Mauricio decide.
- Lock pesimista: al abrir el modal, no claim lock de bloques internos. El cierre es accion top-level del negocio.

---

## Superficie 3 — Lista de negocios cerrados + badge pausado

### Objetivo

Visibilizar negocios cerrados sin contaminar la lista activa. Permitir filtrar por motivo, periodo, area de cierre. En lista activa, badge "Pausado" sobre negocios con `is_paused=true`.

### Estructura visual `/negocios`

```
┌─────────────────────────────────────────────────────────┐
│ Negocios                                  [+ Nuevo]      │
│                                                          │
│ [Propuestas] [En curso] [Por cobrar] [ Cerrados ]       │ ← nueva tab
│  (12)        (8)         (3)         (47)                │
└─────────────────────────────────────────────────────────┘
```

### Tab Cerrados — estructura

```
┌─────────────────────────────────────────────────────────┐
│ Cerrados (47)                                            │
│                                                          │
│ Motivo:  [Todos ▼] [Exitoso] [Perdido] [Cancelado]      │ ← pills
│ Periodo: [Mes actual ▼]                                  │
│ Area:    [Todas ▼]                                       │
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ S1 26 3  ·  Sovena Andina                       ✓   │ │
│ │ Exitoso  ·  Cerrado 12 may por Carla R.             │ │
│ │ Verde Metrica $5.4M                                  │ │
│ │                                          [Ver detalle]│ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ A1 26 7  ·  AFI Cooperativa                     ✗   │ │
│ │ Perdido  ·  Cerrado 28 abr por Santiago H.          │ │
│ │ Razon: "Sin presupuesto este trimestre"             │ │
│ │                                          [Ver detalle]│ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Badge "Pausado" en cards activas

En cualquier tab activa, si `negocio.is_paused = true`:

```
┌─────────────────────────────────────────────────────────┐
│ S1 26 3  · Sovena Andina    [⏸ Pausado]                 │ ← amarillo-warn 10%
│ Ejecucion · 14 dias                                      │
│                                                          │
│ Pausado hace 3d por Mauricio M.                          │ ← gris-acero 12pt
│ "Esperando aprobacion presupuesto cliente"               │
└─────────────────────────────────────────────────────────┘
```

Click en badge muestra `Popover` con detalle (paused_by, paused_at, paused_reason) y boton `[Reactivar]` si user es `admin`/`owner`.

### Iconos por motivo (Lucide)

| Motivo | Icono | Color |
|--------|-------|-------|
| exitoso | `CheckCircle2` | `verde-metrica` |
| perdido | `XCircle` | `gris-acero` (no rojo — perdido no es error) |
| cancelado | `Ban` | `rojo-alerta` |
| pausado | `Pause` | `amarillo-warn` |

### Componentes nuevos

| Componente | Proposito |
|------------|-----------|
| `NegocioCardCerrado` | Variant de `NegocioCard` con motivo, responsable cierre, razon truncada |
| `PausadoBadge` | Badge con popover detalle + accion reactivar |

### Estados

| Estado | Render |
|--------|--------|
| Loading | Skeleton 5 cards |
| Empty cerrados | "Aun no tienes negocios cerrados. Cuando cierres uno, lo veras aqui." (sin CTA) |
| Empty por filtro | "Sin cerrados con esos filtros. [Limpiar filtros]" |
| Error carga | Inline retry + toast |

### Permisos

- Operator: ve solo cerrados donde fue responsable (mismo filtro que activa).
- Otros roles: ven todos los cerrados del WS.

### Server actions

| Accion | Server action |
|--------|---------------|
| Listar cerrados | Extender `getNegociosV2({ tab: 'cerrados', filters: {...} })` |
| Reactivar pausado | Nueva: `reactivarNegocio(negocioId)` — solo admin/owner |

### Notas Max

- `getNegociosV2` actual filtra `.in('estado', ['activo','abierto'])`. Para tab cerrados → filtrar por `stage_actual = 'cerrado'`.
- Para badge pausado, no requiere query extra — `is_paused` ya viene en el negocio.

---

## Superficie 4 — Desplegable trazabilidad de etapas anteriores

### Objetivo

Permitir consultar bloques de etapas ya cerradas sin contaminar la vista de la etapa activa. Util para auditoria.

### Estructura visual

En el detalle del negocio `/negocios/[id]`, debajo del bloque de la etapa activa:

```
┌────────────────────────────────────────────────────────┐
│ [etapa activa: bloques renderizados arriba ...]        │
├────────────────────────────────────────────────────────┤
│ ▶ Historial de etapas anteriores (3)                    │ ← clickable
│   Etapas completadas en este negocio                    │
└────────────────────────────────────────────────────────┘
```

Al expandir:

```
┌────────────────────────────────────────────────────────┐
│ ▼ Historial de etapas anteriores (3)                    │
│                                                          │
│   ┌──────────────────────────────────────────────────┐  │
│   │ Etapa 1 · Datos iniciales  · stage venta         │  │
│   │ Completada 12 abr por Carla R.        [+ Expandir]│  │
│   └──────────────────────────────────────────────────┘  │
│                                                          │
│   ┌──────────────────────────────────────────────────┐  │
│   │ Etapa 2 · Cotizacion  · stage venta              │  │
│   │ Completada 18 abr por Carla R.        [+ Expandir]│  │
│   └──────────────────────────────────────────────────┘  │
│                                                          │
│   ┌──────────────────────────────────────────────────┐  │
│   │ Etapa 3 · Anticipo  · stage cobro                │  │
│   │ Completada 02 may por Daniel M.       [+ Expandir]│  │
│   └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

Cada etapa expandible muestra sus bloques en modo read-only (renderizar usando el mismo componente `BloqueRenderer` pero con prop `forceReadOnly`).

### Componente nuevo

| Componente | Proposito | Primitivo |
|------------|-----------|-----------|
| `EtapasHistorialAccordion` | Accordion anidado: nivel 1 = etapa, nivel 2 = bloques | Radix `Accordion` |

### Interacciones

- Tap en row de etapa → expande con animacion 200ms ease-out.
- Activity log de cada bloque accesible via icono `MessageSquare` en header del bloque expandido (abre Sheet lateral con log filtrado a ese bloque).
- Default: todo colapsado al cargar la pagina.

### Estados

| Estado | Render |
|--------|--------|
| Sin etapas anteriores (etapa activa = primera) | Seccion oculta completamente |
| Loading expansion | Skeleton dentro de la etapa expandida |
| Empty bloques (etapa sin bloques) | "Esta etapa no tuvo bloques configurados." |

### Permisos

- Mismas reglas que ver el negocio (`canViewNegocio`). Operator no responsable: no ve el negocio entero, asi que esta superficie no aplica.
- Todos los que ven el negocio pueden expandir historial.

### Server actions

| Accion | Server action |
|--------|---------------|
| Cargar etapas anteriores | Nueva: `getEtapasAnterioresNegocio(negocioId)` — devuelve etapas con `completed_at < etapa_actual.started_at` y sus bloques con valores actuales |

### Notas Max

- `forceReadOnly` debe pasarse a TODOS los bloques internos (BloqueDatos, BloqueDocumentos, BloqueCobros, etc.). Si algun bloque hoy no respeta esa prop, ajustarla.
- No claim de lock para bloques en historial.

---

## Superficie 5 — Lock pesimista UX

### Objetivo

Hacer visible y manejable el estado de lock pesimista sin romper el flujo del editor actual. Tres escenarios: alguien mas tiene el lock, yo tengo el lock, lock expirado.

### Caso A — Bloque lockeado por OTRO usuario

```
┌────────────────────────────────────────────────────────┐
│ ⚠  Editando: Carla R.   hace 2 min                      │ ← banner amber
│    Solo lectura. Te avisaremos cuando libere el bloque. │   amarillo-warn 10% bg
│                                          [Forzar edicion]│   visible solo owner/admin
├────────────────────────────────────────────────────────┤
│ [Bloque renderizado con opacity: 0.6, pointer-events:   │
│  none en inputs]                                        │
└────────────────────────────────────────────────────────┘
```

**Banner specs:**
- bg: `amarillo-warn` 10% (#F59E0B19)
- border-left: 3px solid `amarillo-warn`
- Height: 56px desktop / 64px mobile (2 lineas)
- Icono `AlertCircle` 16px en `amarillo-warn`
- Texto: `negro-carbon` 14pt 500
- Boton `Forzar edicion` (visible solo owner/admin): `rojo-alerta` outline, abre confirmacion.

**Modal forzar edicion:**
```
Forzar edicion del bloque

[nombre] esta editando este bloque desde hace [X] min.
Si fuerzas la edicion:
  • Su sesion vera el bloque como solo lectura
  • Los cambios sin guardar de [nombre] se perderan
  • La accion quedara registrada en el log del negocio

[Cancelar]  [Forzar edicion]   ← rojo-alerta filled
```

### Caso B — YO tengo el lock

Indicador discreto en esquina superior derecha del bloque:

```
┌────────────────────────────────────────────────────────┐
│ Datos del negocio                  [Editando · 4:32 ⏱] │ ← verde-metrica 8%
├────────────────────────────────────────────────────────┤
│ [campos editables normales]                             │
└────────────────────────────────────────────────────────┘
```

- Chip pequeno `Editando · MM:SS` con countdown del TTL.
- Cuando TTL < 60s: chip cambia a `amarillo-warn` con texto "Renovando..." mientras se hace heartbeat.
- Si heartbeat falla 3 veces consecutivas: chip rojo "Conexion perdida. [Reintentar]".

### Caso C — Lock expira mientras editas

Si el cliente no logra heartbeat por desconexion y el server libera el lock:
- Detectar via response de heartbeat.
- Mostrar modal blocking:
  ```
  Tu sesion de edicion expiro
  Otra persona puede tomar el bloque.
  Recargar el bloque te dara la version actual.

  [Descartar mis cambios] [Intentar guardar igual]
  ```
- `Intentar guardar` invoca server con flag `force_save_after_expire` — server rechaza si otro ya claim.

### Componentes nuevos

| Componente | Proposito | Primitivo |
|------------|-----------|-----------|
| `BloqueLockBanner` | Banner amarillo + boton forzar (condicional rol) | Radix `Alert` extendido |
| `BloqueLockOwnIndicator` | Chip countdown + estado heartbeat | shadcn `Badge` |
| `ForceUnlockDialog` | Modal confirmacion forzar | Radix `Dialog` |
| `LockExpiredDialog` | Modal sesion expirada | Radix `Dialog` blocking |

### Hook cliente (Noor recomienda patron, Max implementa)

```ts
// src/hooks/use-bloque-lock.ts
export function useBloqueLock(bloqueInstanciaId: string, opts?: {
  autoHeartbeatMs?: number  // default 60000
  onLockLost?: () => void
}) {
  // estado: { status: 'idle' | 'mine' | 'theirs' | 'expired', heldBy?, expiresAt?, remainingSec? }
  // claim() / release() / forceUnlock()
  // heartbeat automatico cada 60s mientras status === 'mine'
  // listener visibilitychange: si tab oculta >5min, release voluntario
  // listener beforeunload: navigator.sendBeacon al endpoint release
}
```

### Trigger de claim

Lock NO se claim al cargar la pagina. Se claim cuando el usuario hace foco en el primer input editable del bloque. Esto evita locks fantasma cuando alguien solo lee.

- Patron: `onFocus` del primer input → claim. Si falla (`busy`), render Caso A.
- Release: `onBlur` global con debounce 2s + save explicito + close de la pagina.

### Estados

| Estado | Render |
|--------|--------|
| idle (no claimed) | Bloque normal sin indicadores |
| claiming (request inflight) | Skeleton de 200ms sobre inputs |
| mine | Caso B |
| theirs | Caso A |
| expired | Caso C modal |
| heartbeat_failed | Chip rojo + retry automatico 3x con backoff |

### Permisos

- Forzar unlock: `user.role ∈ ('owner','admin')` (server valida, UI esconde boton).
- Todos los otros: solo ven el banner y esperan.

### Server actions consumidas (ya existen)

- `claimBloqueLock(bloqueInstanciaId)`
- `releaseBloqueLock(bloqueInstanciaId)`
- `heartbeatBloqueLock(bloqueInstanciaId)`
- `forceUnlockBloque(bloqueInstanciaId)` — solo owner/admin

### Notas Max

- **Gotcha critico:** evitar race condition entre `onFocus` claim y unmount. Usar `useEffect` cleanup que invoque release sincrono via `sendBeacon`.
- Verificar que `lockState` en hook se sincroniza tras `forceUnlock` ejecutado por otro tab (puede requerir Supabase Realtime sub a `bloque_locks` table).
- TTL countdown solo informativo en UI — server es la fuente de verdad.

### Notas Ren (assets visuales)

- Icono `AlertCircle` y `Lock` ya en Lucide (no necesita custom).
- Pulse animation sutil en el banner amber cuando llega un broadcast realtime: 1 ciclo de 600ms para llamar atencion.

---

## Superficie 6 — Reapertura con cambio de condiciones

### Objetivo

Al reabrir un negocio cerrado, ofrecer 2 caminos claros: misma condicion (reapertura limpia) o cambio de condiciones (crear negocio nuevo pre-llenado).

### Trigger

En la vista de detalle de un negocio `stage_actual = 'cerrado'`, mostrar un boton sticky en el header:

```
┌────────────────────────────────────────────────────────┐
│ S1 26 3 · Sovena Andina   [Cerrado · Perdido]          │
│                                       [Reabrir negocio] │ ← verde-metrica outline
└────────────────────────────────────────────────────────┘
```

Visible solo segun permiso de reapertura (regla 11):
- Cierre `perdido` → supervisor del area comercial.
- Cierre `cancelado` → admin.
- Cierre `exitoso` → boton NO se muestra.

### Modal `ReabrirNegocioModal`

```
Reabrir negocio S1 26 3

Este negocio se cerro como [Perdido | Cancelado]
hace [X] dias.

Las condiciones del cierre se mantienen?

 ┌──────────────────────────────────────────────────┐
 │ ◯ Si, las mismas condiciones                      │
 │   Vuelve al stage y etapa donde estaba antes      │
 │   del cierre. Conserva precio, cronograma y       │
 │   responsables actuales.                          │
 │                                                    │
 │ ◯ No, cambiaron                                    │
 │   Recomendamos crear un negocio nuevo con los     │
 │   datos pre-llenados de este. El cerrado queda    │
 │   como historico.                                  │
 └──────────────────────────────────────────────────┘

[Cancelar]  [Continuar →]
```

### Flujo "Mismas condiciones"

- Submit dispara `reabrirNegocio(negocioId, {mismasCondiciones: true})`.
- Server restaura `stage_actual` al stage previo al cierre, `etapa_actual_id` a la etapa donde estaba.
- Si motivo era `cancelado`: dispara notif al owner (regla 11).
- Toast verde "Negocio reabierto en etapa [X]".
- Redirect a `/negocios/[id]`.

### Flujo "Cambiaron condiciones"

- Submit no llama reabrir. Llama `crearNegocioDesdeCerrado(negocioId)`.
- Server crea negocio nuevo con: misma empresa, mismo contacto, misma linea, mismo arbol de bloques de datos pre-llenados.
- Negocio original queda intacto (sigue cerrado).
- Activity log del original: "Se creo el negocio [nuevo_codigo] como reapertura con nuevas condiciones".
- Redirect a `/negocios/[nuevo_id]?prefilled=true`.

### Componente nuevo

| Componente | Proposito | Primitivo |
|------------|-----------|-----------|
| `ReabrirNegocioModal` | Modal con 2 radio + descripciones | Radix `Dialog` + `RadioGroup` |

### Estados

| Estado | Render |
|--------|--------|
| Sin permiso | Boton oculto |
| Submitting | Botones disabled + spinner |
| Error server | Toast rojo + modal abierto |
| Exito reapertura | Toast verde + redirect detalle |
| Exito crear nuevo | Toast verde "Negocio [nuevo_codigo] creado" + redirect |

### Permisos

| Motivo | Quien reabre | Quien crea nuevo |
|--------|--------------|------------------|
| perdido | supervisor con area comercial | mismo + admin/owner |
| cancelado | admin/owner | admin/owner |
| exitoso | nadie | nadie (boton oculto) |

### Server actions

| Accion | Server action |
|--------|---------------|
| Reabrir mismas condiciones | Nueva: `reabrirNegocio(negocioId, {mismasCondiciones})` |
| Crear nuevo desde cerrado | Nueva: `crearNegocioDesdeCerrado(negocioId)` |

### Notas Max

- Reapertura debe restaurar `stage_actual` al valor previo. Spec tecnica menciona que el stage es derivado de `etapa_actual_id` via trigger — definir cual es la fuente al reabrir: ¿restaurar `etapa_actual_id` y dejar que trigger recalcule stage? Recomendacion: SI, mantener invariante de un solo origen.
- `crearNegocioDesdeCerrado` no copia: cobros, cotizaciones, activity_log, documentos subidos. Solo metadata + datos de bloques tipo `datos`.

---

## Mapeo superficies → server actions

| Superficie | Server actions a crear | Server actions existentes consumidas |
|------------|------------------------|--------------------------------------|
| 1 Equipo multi-area | `getEquipoConAreas`, `getWorkspaceDefaultResponsables`, `updateStaffAreas`, `setWorkspaceDefaultResponsable`. Extender `inviteTeamMember` con `areas` | `canEditBloque` (filtro UI), `inviteTeamMember` |
| 2 Bloque cierre | `validarCierrePerdido`, `cerrarNegocioPerdido`, `cerrarNegocioCancelado` | trigger notif owner ya en Fase 7 (cuando exista) |
| 3 Lista cerrados | Extender `getNegociosV2` con tab `cerrados`. `reactivarNegocio` | `getNegociosV2` |
| 4 Historial etapas | `getEtapasAnterioresNegocio` | `BloqueRenderer` con `forceReadOnly` |
| 5 Lock UX | — (todas existen Fase 2) | `claimBloqueLock`, `releaseBloqueLock`, `heartbeatBloqueLock`, `forceUnlockBloque` |
| 6 Reapertura | `reabrirNegocio`, `crearNegocioDesdeCerrado` | — |

---

## Notas para Max — gotchas y decisiones

1. **Decision Mauricio pendiente Superficie 2:** despues de cerrar, redirect a tab cerrados o re-render inline read-only? Recomendacion Noor: re-render inline.
2. **Realtime para locks (Superficie 5):** considerar subscribe a `bloque_locks` por workspace via Supabase Realtime para que cuando alguien haga `forceUnlock`, los otros clientes se enteren sin esperar siguiente heartbeat. Out-of-scope si añade demasiada superficie a Fase 5.
3. **Validacion cliente vs server:** todas las validaciones de regla 14a (areas obligatorias) deben replicarse cliente (UX inmediato) Y server (autoridad). Cliente NO bloquea por permisos (eso es server).
4. **Operator filter en Superficie 3:** la query de `getNegociosV2` ya debe respetar `canViewNegocio`. Verificar que aplica tambien en tab cerrados.
5. **Lock claim trigger (Superficie 5):** **NO** claim al cargar pagina. Solo onFocus del primer input editable del bloque. Critico para UX — claim en mount generaria locks fantasma en cualquier scroll/preview.
6. **`assigned_by = NULL`** marca asignacion automatica de cascada. En UI, si responsable tiene `assigned_by IS NULL`, mostrar etiqueta sutil `(asignacion automatica)` al hover.
7. **Heartbeat con sendBeacon en unload:** `navigator.sendBeacon` no soporta autenticacion con cookies httpOnly cross-domain. Solucion: endpoint `/api/locks/release` con body `{bloqueId}` y autenticacion via session cookie standard same-origin.
8. **Forzar edicion crea activity_log:** ya cubierto por server action `force_unlock_bloque` Fase 2. UI solo dispara, no escribe log directo.
9. **Mobile drawer vs modal:** en mobile <600px, todos los `Dialog` deben renderizar como `Drawer` (bottom sheet) con `vaul` o shadcn drawer. Mejor UX que modal centrado.

---

## Notas para Ren — assets visuales necesarios

| Asset | Uso | Formato |
|-------|-----|---------|
| Icono `Compass` (ya en Lucide) | Tag `direccion` en `AreaBadge` | Lucide |
| Ilustracion empty state "Sin staff con area X" | Superficie 1 | SVG simple, gris-acero + verde-metrica, max 120x120 |
| Ilustracion empty state "Sin cerrados" | Superficie 3 | SVG checkmark + box, fondo crema |
| Ilustracion "Negocio cerrado" en detalle | Header negocio cerrado | SVG 80x80 |
| Pulse animation banner lock | Superficie 5 | CSS keyframe (sin asset visual extra) |
| Iconos motivo cierre (CheckCircle2, XCircle, Ban, Pause) | Superficie 3 | Lucide |

Ninguna ilustracion requiere personajes ni escenas complejas. Estilo: ilustracion plana monocromatica con acento `verde-metrica`. Powered by MeTRIK §10 NO aplica aqui — son ilustraciones internas de app, no entregable cliente.

---

## Riesgos UX detectados + mitigacion

| Riesgo | Mitigacion propuesta |
|--------|---------------------|
| **Sobrecarga visual:** muchas areas en una card (4 chips) en mobile 360px | Truncar a 2 chips visibles + `+2 mas` clickable que expande. Tap area completa abre detalle. |
| **Confusion entre "cerrar negocio" y "completar etapa":** ambos parecen acciones de cierre | Bloque cierre adelantado solo aparece en etapas habilitadas. Etapa terminal exitosa va por flujo normal (boton verde). Diferenciar copia: "Cerrar negocio" (rojo) vs "Completar etapa" (verde). |
| **Lock pesimista frustra usuarios** que abren un bloque solo para mirar | Claim **diferido a onFocus de input editable**, no a render. Banner amarillo informativo, no bloqueante visual fuerte. |
| **Reapertura accidental** con condiciones cambiadas → crea negocios duplicados | Modal con 2 radio explicito + descripcion. Default sin radio seleccionado. Boton continuar disabled hasta elegir. |
| **Default responsables sin staff de esa area** confunde al admin | Helper text inline + CTA "Agregar miembro" directo desde el dropdown. |
| **Notificacion al owner por cancelacion ruidosa** si admin cancela 5 negocios seguidos | Out-of-scope esta UX — pero recomendar a Vera que considere digest diario en lugar de notificacion individual cuando vuelva a llegar el tema. |
| **Force unlock destruye trabajo del otro** sin posibilidad de recovery | Modal explicita la consecuencia + activity log preserva razon. No persistir borrador del otro (no implementado — out-of-scope). |
| **Mobile tap target en chips eliminables** muy pequeno (×) | Aumentar hit area del × con padding 8px invisible alrededor. Target real 32x32 aunque visual sea 16x16. |
| **Historial etapas anteriores muy largo** en negocios con 10+ etapas | Limitar render inicial a 3 mas recientes + "Ver todas (N)" expand. |
| **Confundir "Pausado" con "Cerrado"** | Badge pausado amarillo en card activa (con icono pause). Cerrado va en tab separada con iconos distintos por motivo. Cero overlap visual. |

---

## Componentes nuevos — inventario consolidado

| # | Componente | Superficie | Primitivo base |
|---|------------|------------|----------------|
| 1 | `AreaBadge` | 1 | shadcn Badge |
| 2 | `AreaMultiSelect` | 1 | Radix Popover + Checkbox |
| 3 | `DefaultResponsablesPicker` | 1 | Radix Combobox |
| 4 | `BloqueCierre` | 2 | Radix DropdownMenu |
| 5 | `ConfirmCierreModal` | 2 | Radix Dialog |
| 6 | `NegocioCardCerrado` | 3 | shadcn Card variant |
| 7 | `PausadoBadge` | 3 | Radix Popover |
| 8 | `EtapasHistorialAccordion` | 4 | Radix Accordion |
| 9 | `BloqueLockBanner` | 5 | Radix Alert |
| 10 | `BloqueLockOwnIndicator` | 5 | shadcn Badge |
| 11 | `ForceUnlockDialog` | 5 | Radix Dialog |
| 12 | `LockExpiredDialog` | 5 | Radix Dialog |
| 13 | `ReabrirNegocioModal` | 6 | Radix Dialog + RadioGroup |

13 componentes nuevos. Todos consumen primitivos ya en stack — sin nuevas dependencias.

Hook nuevo: `useBloqueLock` (Superficie 5).

---

## Pendientes para clarificar antes de implementar

1. **Decision Mauricio (Superficie 2):** despues de cerrar → redirect a `/negocios?tab=cerrados` o re-render inline read-only? **Recomendacion Noor: inline.**
2. **Decision Mauricio (Superficie 5):** activar Realtime de Supabase para sincronizar locks entre tabs? Costo: nueva subscripcion por usuario. Beneficio: UX impecable cuando alguien hace force unlock.
3. **Vera (Superficie 2):** definir si el bloque cierre adelantado requiere texto legal/disclaimer cuando se marca `cancelado` con cobros (manejo de pagos podria tener implicaciones contables). Consultar con Emilio.
4. **Ren (Superficie 3):** entregar las 3 ilustraciones de estado vacio antes de implementar.
5. **Hana (todas):** validar que la lista de server actions nuevas no genera duplicacion con flujos ya existentes en `negocio-v2-actions.ts`.

---

## Anexo — Voz MeTRIK aplicada a copy critico

Reemplazos sugeridos para evitar tono burocratico:

| Anti-patron | MeTRIK |
|-------------|--------|
| "Acceso denegado" | "Tu rol no edita este bloque. Habla con tu supervisor." |
| "No tiene permisos" | "Esta accion la hace [rol]." |
| "Operacion exitosa" | "Listo. [Accion concreta realizada]." |
| "Esta seguro?" | "Confirmas?" |
| "Procesando..." | "Guardando..." / "Cerrando..." |
| "Sin datos" | "Aun no [accion]. [CTA siguiente]." |
| "Campo obligatorio" | "Necesitamos este dato para continuar." |
| "Error al cargar" | "No pudimos cargar. [Reintentar]" |

Aplicar a todo el copy de las 6 superficies.
