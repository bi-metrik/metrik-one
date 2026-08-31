# Spec — Inversión en pauta de Meta dentro de ONE

**Owner de código:** Max · **Growth:** Sami · **Origen:** sesión SOENA S12, 2026-08-20
**Estado:** especificado, sin construir.
**Depende de:** `2026-08-20_backfill-atribucion-meta.md` (ya en `main`, PR #329)

## El hueco

**ONE no guarda un solo peso de inversión en pauta.** No existe ninguna tabla para eso:
lo más cercano son `gastos` y `gastos_fijos_config`, que son otra cosa (egresos del
negocio, no medios). Sin gasto no hay costo por lead, no hay costo por lead calificado y
no hay retorno por campaña.

El equipo comercial de SOENA lo pidió el 2026-08-10, en dos de sus pendientes: *"poder
registrar lead calificado o no calificado en MéTRIK para llevar estadísticas"* y *"abrir
opción de KPIs comerciales"*.

## Lo que ya está listo, y no es poco

La cadena de atribución **existe completa** y está poblada:

```
campaign_id / ad_id  ->  contacto_interacciones  ->  negocio_id  ->  etapa + precio_aprobado
```

Medido hoy en SOENA (`7dea141d-d4da-483d-a78d-b14ef35500c5`), después del backfill:

| Campaña | Leads | Con negocio | Conversión |
|---|---|---|---|
| CLIENTES POTENCIALES AGO 2026 PLUS | 231 | 0 | 0.0% |
| CAMPAÑA JUNIO 2026 DJ - VIDEO | 135 | 7 | 5.2% |
| CLIENTES POTENCIALES JUL/AGO 2026 | 103 | 7 | 6.8% |
| CLIENTES POTENCIALES AGO 2026 | 17 | 0 | 0.0% |

Falta **una sola pieza**: cuánto costó cada una. Con eso, esa tabla se vuelve un tablero
de rendimiento. Sin eso, es una lista de volúmenes que no dice si el dinero rindió.

## Lo que esto NO destraba, y hay que decirlo de frente

**Costo por lead calificado no se va a poder calcular, y no es por falta de gasto.**

De las 486 interacciones de Meta, **467 están en estado `nueva`**. Convertidas 14,
contactadas 2, descartadas 1. El campo donde vive la calificación existe y funciona; lo
que no está ocurriendo es el acto humano de calificar.

Traer la inversión entrega **costo por lead** de inmediato. **Costo por lead calificado**
queda bloqueado por un proceso, no por un dato, y construir el reporte sin resolver eso
produciría una métrica que divide por un denominador falso. Es exactamente el primer
pendiente del correo del 2026-08-10: lo pidieron porque hoy no se puede hacer de forma
usable.

## Diseño

### Tabla `meta_pauta_dia`

Grano: **un día × un anuncio**. No por campaña.

El `ad_id` es la llave más fina y es la única que el lead trae **siempre** (las 486
interacciones tienen `ad_id`; `campaign_id` fue justamente lo que hubo que recuperar).
Desde el anuncio se agrega hacia arriba a adset y campaña sin volver a consultar a Meta,
al revés no.

Columnas mínimas: `workspace_id`, `ad_account_id`, `fecha`, `ad_id`, `adset_id`,
`campaign_id`, los tres nombres, `gasto`, `moneda`, `impresiones`, `clics`,
`actualizado_en`. Clave única `(ad_account_id, ad_id, fecha)`.

Los nombres se guardan junto a los ids **a propósito**, aunque se repitan: si el cliente
renombra una campaña en Meta, el histórico no debe reescribirse solo. El nombre que
importa es el que tenía cuando se gastó la plata.

### Ingesta

Cron diario contra `/act_<id>/insights` con `level=ad`, `time_increment=1`,
`fields=spend,impressions,clicks,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,account_currency`.

`ad_account_id` va en `config_extra.meta_leads` del workspace, al lado del `page_id` que
ya vive ahí. Para SOENA: `3229968600725628`.

## Decisiones de diseño que no son obvias

**1. Ventana móvil, no "inserto ayer y me olvido".**
Meta **revisa sus propias cifras** después de publicarlas: ajusta por fraude, por
facturación, por entregas tardías. El gasto de un día no es definitivo ese día. Por eso
cada corrida hace **upsert de los últimos 7 días**, no insert del día anterior. Si se
insertara una sola vez, el número quedaría congelado en la primera lectura y **no
cuadraría con lo que el cliente ve en su administrador comercial**, que es la peor forma
posible de perder una discusión con el cliente.

**2. El numerador es nuestro, el denominador es de Meta.**
Los leads se cuentan en ONE, por el `ad_id` que trae cada leadgen. **No se usan las
conversiones que reporta Meta** (`actions`), que se calculan con ventanas de atribución
propias, cambian solas y jamás cuadran con nuestro conteo. Mezclarlas daría dos verdades
sobre la misma pregunta, y la que perdería sería la nuestra.

**3. La moneda se guarda, no se asume.**
Meta devuelve `spend` como string decimal en la moneda de la cuenta. Se persiste como
`numeric` con su `moneda` explícita al lado. Nada de asumir COP ni de usar float para
plata.

**4. El día de Meta no es nuestro día.**
Los insights se agregan según la zona horaria de la cuenta publicitaria, no la de Bogotá
ni la del servidor. La fecha que devuelve Meta se guarda tal cual y **no se reinterpreta**.
Cruzarla contra `ocurrida_at` de los leads exige tenerlo presente: son dos relojes.

**5. Falta de permiso se reporta, no se guarda como cero.**
Si el token pierde acceso a la cuenta publicitaria, la API responde error. Un día sin
datos se queda **sin fila**, nunca con `gasto = 0`. Un cero es una afirmación: dice que
no se gastó nada. La ausencia de fila dice que no sabemos, que es la verdad. Este es el
mismo fallo mudo que ya nos costó 350 leads sin atribución.

## Alcance del primer entregable

Ingesta + tabla + un cruce por campaña con **costo por lead**. Nada más.

Fuera de alcance, en este orden: costo por lead calificado (bloqueado arriba), retorno
sobre `precio_aprobado` de los negocios cerrados, corte por ciudad/región (lo pidieron el
2026-08-10 y depende del campo nuevo del formulario de Meta), y pantalla propia.

## Gate

Migración nueva, así que **la mergea Mauricio**: `.claude/rules/branch-workflow-one.md`
exige su sí para toda migración, y aquí además hay que darle acceso al token sobre la
cuenta publicitaria. Antes de construir el reporte, confirmar con SOENA que el gasto
cargado **cuadra contra lo que ven en su administrador comercial**. Si no cuadra, el
problema es la ventana móvil o la zona horaria, en ese orden.
