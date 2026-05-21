# Spec — Assets empty states + header negocio cerrado

**Fecha:** 2026-05-20
**Owner visual:** Ren (Art Director)
**Owner implementacion:** Max
**Branch:** `feat/roles-areas-stages-fase-1`
**Spec UX referente:** `metrik-one/docs/specs/2026-05-20_ux-roles-areas-stages.md` (Noor)
**Fuentes de marca:**
- `cerebro/conceptos/identidad-visual-metrik.md`
- `cerebro/reglas/powered-by-metrik.md`
- `cerebro/conceptos/voz-metrik.md`

## Alcance

Tres ilustraciones SVG mobile-first para superficies UX de Fase 3+ del modelo roles · areas · stages:

1. `empty-staff-area.svg` — `/mi-negocio/equipo` filtrado por area sin staff asignado.
2. `empty-cerrados.svg` — Tab "Cerrados" en `/negocios` vacia.
3. `header-cerrado-{exitoso|perdido|cancelado}.svg` — Badge visual en header de negocio cerrado.

Total entregado: **5 SVGs** en `metrik-one/public/empty-states/`.

## Tokens canonicos usados

Tomados directo del manual (`cerebro/conceptos/identidad-visual-metrik.md`). Cero invencion.

| Token | Hex | Uso en estos assets |
|-------|-----|---------------------|
| Negro Carbon | `#1A1A1A` | Stroke principal en caja archivo + ban icon. Texto si aplica |
| Gris Acero | `#6B7280` | Strokes secundarios (sillas vacias, mesa, anillos perdido/cancelado, X) |
| Verde Metrica | `#10B981` | Acento de invitacion (silla cuarta) + sello cierre exitoso |
| Verde Dark | `#059669` | Check del cierre exitoso (hover/profundidad) |
| Gris Linea | `#E5E7EB` | Sombras sutiles, lineas de vacio en caja |
| Blanco | `#FFFFFF` | Fondo cara frontal caja archivo, contraste icono "+" |

**No usados** (deliberadamente): Rojo Alerta `#EF4444` — descartado en cancelado porque la spec de Noor pide que el cierre NO se lea como error (ver Superficie 3 → iconos: `Ban` con `rojo-alerta` solo cuando es accion **activa** de cancelacion en UI; el badge de estado pasivo se mantiene neutral).

## Conceptos visuales

### 1. `empty-staff-area.svg` (240x180)

**Metafora:** mesa de trabajo vista en planta con 4 sillas. 3 sillas grises (Gris Acero) que representan asientos vacios neutros + 1 silla con stroke Verde Metrica + chip "+" indicando "este es el asiento que invitas a llenar".

**Por que funciona:**
- Refleja literal el contexto operacional MeTRIK (equipo coordinando un area).
- Mantiene proporcion canonica de paleta: 90% achromatico, 10% verde acento.
- Mobile-first: la mesa y la silla verde son los anclajes visuales — funciona claro a 120px de ancho renderizado.
- No usa figura humana realista (anti-patron en spec marca).

### 2. `empty-cerrados.svg` (240x180)

**Metafora:** caja de archivo cerrada y vacia, con etiqueta en blanco. Pequena cinta verde discreta como "sello de marca", sin celebrar (porque incluye perdidos y cancelados, no solo exitosos).

**Por que funciona:**
- Caja de archivo = metafora natural de "historico cerrado".
- Lineas dashed sobre la caja sugieren "aqui llegaran cosas" sin texto.
- Cinta verde en borde derecho de la etiqueta es el unico acento — minimal, no protagonista (matches voz: "Aun no tienes negocios cerrados").

### 3. `header-cerrado-{motivo}.svg` (80x80 cada uno)

**Metafora:** sello circular tipo "estampa de archivo". Anillo doble (uno solido + uno discontinuo) refuerza la idea de "marcado oficialmente". Icono central varia por motivo.

| Motivo | Stroke anillo | Icono central | Color icono |
|--------|---------------|---------------|-------------|
| `exitoso` | Verde Metrica `#10B981` | Check | Verde Dark `#059669` |
| `perdido` | Gris Acero `#6B7280` | X diagonal limpia | Gris Acero `#6B7280` |
| `cancelado` | Gris Acero `#6B7280` | Ban (circulo con diagonal) | Negro Carbon `#1A1A1A` |

**Por que 3 SVGs separados (en vez de 1 con grupos):**
1. **Render condicional limpio:** Max hace `<img src={`/empty-states/header-cerrado-${cierre_motivo}.svg`} />`. Sin manipulacion CSS de visibilidad de grupos ni inline SVG con switches.
2. **Bundle/cache:** cada motivo se cachea independiente. Un negocio renderiza solo el SVG de su motivo, no los 3.
3. **Mantenibilidad:** cambiar el icono de un motivo no afecta los otros archivos. Diff limpio.
4. **Accessibility:** cada archivo tiene su `aria-label` especifico ("Negocio cerrado exitoso" vs "Negocio cerrado como perdido"). En un solo SVG seria genérico.

Trade-off aceptado: 3 requests en lugar de 1, pero como solo se carga 1 por negocio en el detalle, no hay sobrecosto real.

## Copy sugerido para HTML (NO va dentro del SVG)

Todos los textos en voz MeTRIK: proponen accion en lugar de quejarse del vacio. Aplicables al sustituir `{area}` o `{motivo}` segun corresponda.

### Superficie `/mi-negocio/equipo` filtrado por area

```tsx
<EmptyState
  illustration="/empty-states/empty-staff-area.svg"
  title="Sin miembros en esta area"
  description="Invita a tu primer miembro a coordinar {area}."
  primaryCta={{ label: "Invitar miembro", onClick: openInviteWithArea(area) }}
/>
```

Variantes de `{area}`:
- `comercial` -> "comercial"
- `operaciones` -> "operaciones"
- `financiera` -> "finanzas"
- `direccion` -> "direccion" (caso raro, normalmente direccion no esta vacia)

### Superficie Tab "Cerrados" vacia

```tsx
<EmptyState
  illustration="/empty-states/empty-cerrados.svg"
  title="Sin negocios cerrados todavia"
  description="Aqui veras el historial de negocios exitosos, perdidos y cancelados cuando los tengas."
  // sin CTA - los cierres son consecuencia de operacion, no se "crean"
/>
```

### Superficie header negocio cerrado

```tsx
{negocio.stage_actual === 'cerrado' && (
  <div className="flex items-center gap-3">
    <img
      src={`/empty-states/header-cerrado-${negocio.cierre_motivo}.svg`}
      alt={cierreMotivoLabel(negocio.cierre_motivo)}
      width={80}
      height={80}
      className="shrink-0"
    />
    <div>
      <h1 className="font-display text-2xl text-[#1A1A1A]">{negocio.codigo} · {negocio.empresa.nombre}</h1>
      <p className="text-sm text-[#6B7280]">
        Cerrado {cierreMotivoLabel(negocio.cierre_motivo)} · {formatDate(negocio.cierre_fecha)} por {negocio.cierre_por.nombre}
      </p>
    </div>
  </div>
)}
```

Labels canonicas de `cierre_motivo`:
- `exitoso` -> "como exitoso"
- `perdido` -> "como perdido"
- `cancelado` -> "como cancelado"

### Reglas de copy aplicadas

- **"Sin miembros en esta area"** y NO "No hay datos" / "Vacio" (anti-patron documentado en voz-metrik anexo).
- **"Invita a tu primer miembro a coordinar X"** propone accion concreta (formula MeTRIK = "[verbo accion] [a quien/que] para [resultado]").
- **"Aqui veras el historial..."** anticipa el estado futuro sin disculparse.
- **NO emojis** en copy ni iconos. Lucide o iconos vectoriales propios solo.

## Especificaciones tecnicas

### Comunes a los 5 SVGs

- **viewBox:** proportional, sin `width`/`height` hardcoded. Escala fluida en CSS.
- **Atributos accesibles:** `role="img"` + `aria-label` descriptivo en cada uno.
- **Stroke widths:** 2px standard, 2.5px para acento Verde Metrica (jerarquia visual), 1px para detalles dashed.
- **Sin fonts:** ningun SVG contiene `<text>`. El copy va en HTML aparte (decision explicita: no acoplar copy a asset visual).
- **Sin raster:** todo path/shape/line. Cero `<image>` embebido.
- **Sin gradientes:** solo fills planos + opacities sutiles donde aplica.
- **Optimizado:** decimales mantenidos a maximo 1, sin metadata extra (sin `<defs>` innecesarios, sin `<title>` redundante - aria-label cubre a11y).

### Mobile-first verificado mentalmente

| Asset | Min render util | Comportamiento |
|-------|-----------------|----------------|
| `empty-staff-area.svg` | 120x90 px | Mesa + silla verde + chip "+" siguen distinguibles |
| `empty-cerrados.svg` | 120x90 px | Caja + cinta verde reconocibles |
| `header-cerrado-*.svg` | 40x40 px | Anillo + icono central legibles. Estamos rendering a 80x80 para tener margen |

### Powered by MeTRIK § no aplica

Confirmado contra `cerebro/reglas/powered-by-metrik.md`:
- Estos son **assets internos de la app ONE**, no entregables que el cliente recibe y conserva.
- "Si la pieza es MeTRIK hablando como MeTRIK, no [aplica Powered by]" — aqui ni siquiera es comunicacion, es UI funcional.
- Adicionalmente confirmado en spec Noor (§ "Notas para Ren — assets visuales necesarios"): _"Powered by MeTRIK §10 NO aplica aqui"_.

## Lista de archivos entregados

| Archivo | Path absoluto | Tamano viewBox |
|---------|---------------|----------------|
| Empty staff por area | `/Users/mauricio/Developer/metrik/metrik-one/public/empty-states/empty-staff-area.svg` | 240x180 |
| Empty negocios cerrados | `/Users/mauricio/Developer/metrik/metrik-one/public/empty-states/empty-cerrados.svg` | 240x180 |
| Header cerrado exitoso | `/Users/mauricio/Developer/metrik/metrik-one/public/empty-states/header-cerrado-exitoso.svg` | 80x80 |
| Header cerrado perdido | `/Users/mauricio/Developer/metrik/metrik-one/public/empty-states/header-cerrado-perdido.svg` | 80x80 |
| Header cerrado cancelado | `/Users/mauricio/Developer/metrik/metrik-one/public/empty-states/header-cerrado-cancelado.svg` | 80x80 |

## Pendientes para Max (integracion JSX)

1. **Empty state staff por area:** consumir en componente que renderiza la lista filtrada por `area` cuando `staff.length === 0`. Si Max ya tiene un componente `EmptyState` generico, usar ese y pasar los 3 props (`illustration`, `title`, `description`, `primaryCta`). Si no existe, crearlo siguiendo el ejemplo de la spec.

2. **Empty state cerrados:** consumir en `/negocios` tab "Cerrados" cuando el resultado server devuelva array vacio (con filtros default — sin filtro de motivo activo). Si hay filtros aplicados, ya hay otro empty state ("Sin cerrados con esos filtros. [Limpiar filtros]") que NO usa esta ilustracion.

3. **Header cerrado:** renderizar condicionalmente cuando `negocio.stage_actual === 'cerrado'`. El badge va antes del titulo (ver snippet de copy arriba). Para impresion/PDF del negocio cerrado el badge tambien aplica. En mobile <600px, considerar reducir el tamano renderizado a 56x56 para liberar espacio horizontal.

4. **Optimizacion build:** Next.js servira los SVGs como assets estaticos desde `/public/empty-states/`. Si se quiere inline para reducir requests, importar como componente `next/image` con `unoptimized` o usar SVGR. Decision queda en Max segun perf real.

5. **Variantes color-scheme dark:** estos SVGs estan disenados para fondo claro (Blanco Papel o Fondo Crema). Si en el futuro ONE habilita dark mode pleno, hace falta variantes con stroke invertido. **Out-of-scope esta entrega**, marcar como TODO si dark mode entra a roadmap.

## Validacion

- [x] Paleta solo tokens canonicos del manual — verificado uno a uno.
- [x] Proporcion paleta respetada: ~85% achromatico + ~15% verde acento sumando los 5 assets.
- [x] Sin texto en SVG.
- [x] viewBox proportional, escalable.
- [x] Mobile-first verificado mentalmente.
- [x] Voz MeTRIK aplicada al copy sugerido.
- [x] Powered by descartado correctamente (asset interno).
- [x] Estilo plano monocromatico, sin 3D ni gradientes pesados.
- [x] Sin fuentes default Next template.
- [x] aria-label en cada SVG.
