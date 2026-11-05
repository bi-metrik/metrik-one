# Carrito persistente de los asistentes de venta

**Estado:** aprobada por Mauricio (4-nov), construida en `feat/carrito-persistente` · **Fecha:** 2026-11-04 · **Owner:** Max
**Rama:** `feat/carrito-persistente` · **Reemplaza:** el borrador `feat/carrito-asistentes` (`afad8913`, carrito reconstruido desde la traza) y la tabla `ferreteria_links_bold`.

## 1. Por qué

4-nov, conversación 10 de Chatwoot (Dimpro, Messenger): Mauricio compró una batería MP-62 y aceptó la venta cruzada de las puntas MP-64. Dimi respondió que iban en **dos links con dos fletes**, porque el reglamento (`proc.compra`) dice que cada pedido es de UN producto y `ferreteria_links_bold` guarda una sola publicación por link.

El pedido de Mauricio: un carrito **estándar** para todo asistente público que venda (hoy Dimi, después cualquiera), **guardado en base de datos** (no reconstruido de la conversación), que termine registrando la venta en ONE, hecho robusto de una vez.

El borrador `feat/carrito-asistentes` resolvía el caso de Dimpro, pero el carrito vivía en la traza de la conversación: si la traza se recorta (tramos, topes), el carrito se pierde; no hay un lugar donde ONE lo vea, ni estado de abandono o vencimiento; y la forma solo sirve a Ferretería. Este diseño lo reemplaza; se reaprovechan sus piezas puras (`totalCarrito`, el `proponer` con `productos[]`, el reintento por línea del webhook).

## 2. Lo que hacen otros

Revisión de documentación oficial, 4-nov. Lo marcado *(sin verificar)* no se encontró en la doc oficial.

| Tema | Qué hacen | Fuente |
|---|---|---|
| Estados | commercetools: `Active` → `Frozen` → `Ordered` (un carrito `Ordered` ya no se modifica), más `Merged`. Medusa no tiene enum: marca `completed_at` al volverse pedido. WooCommerce: pedido `checkout-draft` → Pending payment → Processing/Completed, Failed, Cancelled. Saleor: el checkout se completa en pedido; el pago se mide con `authorizeStatus`. Shopify: el Cart no tiene estado; el pago se abre con `checkoutUrl`, que caduca y se vuelve a pedir. | [commercetools carts](https://docs.commercetools.com/learning-implement-carts-and-shopping-lists/implement-carts/understand-the-carts-api), [Medusa Cart](https://docs.medusajs.com/resources/references/cart/models/Cart), [Woo estados](https://woocommerce.com/document/managing-orders/order-statuses/), [Woo checkout](https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/checkout/), [Saleor checkout](https://docs.saleor.io/developer/checkout/overview), [Shopify cart](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage) |
| Precio | commercetools recalcula al escribir, no al leer; con `SoftFreeze` «los precios quedan como estaban al congelar». Medusa guarda en cada línea `unit_price` y una copia del producto (`product_title`…). Shopify: el costo del carrito es «estimado», el final se fija en el checkout; editar un draft order desvincula el checkout en curso. | [commercetools carts y orders](https://docs.commercetools.com/api/carts-orders-overview), [Medusa conceptos](https://docs.medusajs.com/resources/commerce-modules/cart/concepts), [Shopify DraftOrder](https://shopify.dev/docs/api/admin-graphql/latest/objects/DraftOrder) |
| Idempotencia | Saleor: el mismo `pspReference` + tipo + monto devuelve el evento ya procesado (`alreadyProcessed`); mismo `pspReference` con otro monto = error. Medusa: `completeCartWorkflow` toma un candado sobre el carrito y, si se repite, devuelve el mismo pedido. Shopify: el id del intento de pago es la clave de idempotencia. WhatsApp (Brasil): `reference_id` único por negocio. | [Saleor transacciones](https://docs.saleor.io/developer/payments/transactions), [Medusa locks](https://docs.medusajs.com/learn/fundamentals/workflows/locks), [Medusa pagos](https://docs.medusajs.com/resources/commerce-modules/payment/payment-flow), [Shopify pagos](https://shopify.dev/docs/apps/build/payments/request-reference) |
| Pago tardío | Saleor reconoce el caso «cobrado y sin pedido» y tiene una opción para devolver fondos de checkouts vencidos. WhatsApp India pide confirmar el pago del lado del servidor, no solo por webhook. | [Saleor ciclo de vida](https://docs.saleor.io/developer/checkout/lifecycle), [WhatsApp payment links](https://developers.facebook.com/documentation/business-messaging/whatsapp/payments/payments-in/payment-links/) |
| Vencimiento y abandono | Saleor: checkout vacío se borra a las 6 h, anónimo con líneas a los 30 días, con usuario a los 90. commercetools: `deleteDaysAfterLastModification`, 90 días por defecto. Woo: borra borradores inactivos a diario y cancela Pending al vencer «Hold stock». WhatsApp: `expiration` apaga el botón de pago. | [Saleor ciclo de vida](https://docs.saleor.io/developer/checkout/lifecycle), [commercetools retención](https://docs.commercetools.com/api/releases/2020-01-08-default-project-values-for-deletion), [WhatsApp orders BR](https://developers.facebook.com/documentation/business-messaging/whatsapp/payments/payments-br/orders) |
| Un solo envío | En todos el envío es del carrito o del paquete, no de la línea: Shopify `deliveryGroups`, Medusa `shipping_methods`, Saleor un método de entrega por checkout, Woo `shipping_rates` por paquete, WhatsApp total = subtotal + impuesto + envío − descuento. | [Shopify Cart](https://shopify.dev/docs/api/storefront/latest/objects/Cart), [Woo cart](https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/cart), [WhatsApp orders BR](https://developers.facebook.com/documentation/business-messaging/whatsapp/payments/payments-br/orders) |
| Pedido y entrega | Un pedido con N líneas en las cinco plataformas. Shopify entrega por `fulfillmentOrders` con entrega parcial por línea (`remainingQuantity`); WhatsApp informa `partially_shipped`. | [Shopify fulfillment](https://shopify.dev/docs/apps/build/orders-fulfillment/order-management-apps/build-fulfillment-solutions) |
| Atar la conversación | Shopify: token del carrito + `buyerIdentity`. Woo: `Cart-Token`. commercetools: `anonymousId`/`customerId`, y al identificarse fusiona (`Merged`). El mensaje `order` de WhatsApp trae `product_items` con `item_price` pero sin id de pedido: es intención, se recotiza. | [Woo cart tokens](https://developer.woocommerce.com/docs/apis/store-api/cart-tokens/), [WhatsApp order](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/order/) |
| Bots | Botpress: las variables de conversación se borran al terminar (su propia doc usa un carrito de ejemplo); para lo que debe durar, Tables. Chatwoot no tiene carrito: su integración con Shopify solo consulta pedidos. Meta retiró el checkout dentro de Facebook e Instagram en 2025 *(fecha según fuentes secundarias)*: el pago va a la web del comercio, que es lo que ya hace el link de Bold. | [Botpress variables](https://botpress.com/docs/studio/concepts/variables/scopes/conversation/), [Botpress tables](https://botpress.com/docs/adk/data/tables), [Chatwoot Shopify](https://developers.chatwoot.com/self-hosted/configuration/features/integrations/shopify-integration-setup) |

Lo que se adopta: carrito en tabla propia (no en la conversación, la lección de Botpress); pocos estados explícitos con un «congelado» (commercetools); foto del precio por línea y recálculo solo al escribir (Medusa, commercetools); la referencia de pago como llave de idempotencia y mismo monto o error (Saleor); un carrito → a lo sumo un pedido, con candado (Medusa); envío a nivel de carrito; un pedido con N líneas; el pago tardío se registra, nunca se descarta.

## 3. Decisiones

| # | Decisión | Por qué |
|---|----------|---------|
| D1 | Tres tablas genéricas: `carritos`, `carrito_lineas`, `carrito_pagos` | Carrito ≠ intento de pago (patrón Shopify/Saleor/Medusa: cart → checkout/payment → order). Un link vencido no destruye el carrito: se emite otro intento. |
| D2 | El carrito es de la CONVERSACIÓN (cuenta + conversación de Chatwoot + canal), por workspace | La llave de Chatwoot es cuenta + conversación (no hay teléfono en Instagram/Messenger). A lo sumo **un carrito vivo** (`abierto` o `en_pago`) por conversación: índice único parcial. |
| D3 | Foto del precio por línea al agregar; **se re-cotiza y congela al emitir el link** | Al agregar, la línea guarda el precio que el cliente vio. Al proponer se vuelve a leer el catálogo: si cambió el precio o el producto ya no está activo, el código lo dice antes de cobrar. Con el link emitido, líneas y total quedan inmutables (trigger): el pago se compara contra esa foto, no contra el catálogo de hoy. |
| D4 | Un solo flete por carrito | El flete es del envío (zona, ruta), no del producto. `total = subtotal + flete`, con CHECK. |
| D5 | Idempotencia por referencia de pago (`LNK_…`) y por huella del carrito congelado | Un «sí» repetido no crea otro link (huella única); un aviso repetido de Bold no registra dos veces (referencia única + reclamo con `procesando` y vencimiento de 2 min, como hoy); un carrito, a lo sumo un pago aprobado (índice parcial). |
| D6 | Un carrito pagado = **UN negocio en ONE con una venta por línea** | Ver §5. |
| D7 | Vencimiento y abandono perezosos, sin cron nuevo | El link vence con `expiration_date` de Bold (`venceHoras` del reglamento). Un carrito `abierto` sin cambios en 7 días se lee como `abandonado` la próxima vez que se toca; un `en_pago` con su link vencido vuelve a `abierto` (el cliente puede pedir otro link con precios re-cotizados). Un pago aprobado que llega tarde **se registra igual**: la plata entró. |
| D8 | Herramienta `carrito` genérica en `publico/`; el dominio pone catálogo, flete y registro | Cualquier asistente que venda reutiliza estado, persistencia, congelado, link e idempotencia; el dominio solo resuelve «qué es este código, cuánto vale, cuánto el flete» y, en el servidor, «cómo se vuelve venta». |
| D9 | `ferreteria_links_bold` se retira | En producción tiene 0 filas (consulta del 4-nov). La migración la borra solo si sigue vacía (guarda que aborta si no). La migración del borrador (`20261104170000_ferreteria_links_bold_lineas.sql`) no se aplica nunca. |

## 4. Modelo de datos

Todas server-only (RLS encendida, `revoke` a `anon`/`authenticated`): las escriben `chatwoot-agente` (Edge) y el webhook de Bold (Next) con service_role, acotando por workspace. Guardan nombre, celular y dirección del comprador.

### 4.1 `carritos`

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid pk | |
| `workspace_id` | uuid fk | |
| `dominio` | text | Quién lo convierte en venta: `ferreteria` hoy; `experiencias` u otro después. CHECK de lista. |
| `chatwoot_cuenta_id`, `chatwoot_conversacion_id` | bigint | La conversación dueña. |
| `canal` | text | `messenger`, `instagram`, `whatsapp`, `otro`. |
| `chatwoot_contacto_id` | bigint | El contacto de Chatwoot. Hoy solo informativo; deja abierto atar el carrito al cliente entre conversaciones (fusión tipo `Merged` de commercetools) sin migrar. |
| `estado` | text | `abierto` · `en_pago` · `pagado` · `registrado` · `vencido` · `abandonado` · `cancelado` (§4.4). |
| `version` | int | Sube con cada cambio de líneas. La huella de la propuesta la incluye: un «sí» a una propuesta vieja no cobra un carrito que ya cambió. |
| `subtotal`, `flete`, `total` | numeric(14,2) | `total = subtotal + flete` (CHECK). Flete y total null mientras no hay zona. |
| `moneda` | text | `COP` (CHECK). |
| `zona`, `ruta` | text | Zona de la tabla de flete del reglamento; `despacho` o `recoge`. |
| `comprador_nombre`, `comprador_telefono`, `direccion` | text | Lo que el cliente escribió después del «sí» de autorización. |
| `negocio_id` | uuid fk `negocios` | El negocio de ONE, apenas existe (reintento). |
| `congelado_at`, `pagado_at`, `registrado_at`, `cerrado_at` | timestamptz | |
| `actividad_at` | timestamptz | Último cambio: de aquí sale el abandono. |
| `created_at`, `updated_at` | timestamptz | |

Índices: único parcial `(workspace_id, chatwoot_cuenta_id, chatwoot_conversacion_id) where estado in ('abierto','en_pago')`; `(workspace_id, estado, actividad_at)`.

### 4.2 `carrito_lineas`

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid pk | |
| `carrito_id` | uuid fk (cascade) | |
| `workspace_id` | uuid | Igual al del carrito (trigger). |
| `orden` | smallint | Orden en que el cliente lo pidió. |
| `item_tipo` | text | `ferreteria_publicacion` hoy. |
| `item_id` | uuid | La publicación. Sin FK: el dominio la valida (genérico). |
| `codigo`, `descripcion` | text | Foto: `MP-62`, «Batería 20 V…». |
| `cantidad` | int | 1..`MAX_UNIDADES` del dominio (Dimpro: 3). |
| `precio_unitario` | numeric(14,2) | Foto del precio. |
| `subtotal` | numeric generada | `precio_unitario × cantidad`. |
| `venta_id` | uuid | La venta de ONE de esta línea (genérico, sin FK); se anota apenas se inserta. |

Único `(carrito_id, item_tipo, item_id)`: el mismo producto dos veces es una línea con más unidades. Trigger: con el carrito fuera de `abierto`, las líneas no se insertan, editan ni borran (salvo anotar `venta_id`).

### 4.3 `carrito_pagos` (los intentos de cobro)

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid pk | |
| `carrito_id`, `workspace_id` | uuid | |
| `pasarela` | text | `bold` (CHECK). |
| `referencia` | text | `LNK_…`; único `(workspace_id, referencia)`. |
| `url` | text | `https://…` |
| `huella` | text | Huella del carrito congelado (líneas + versión + flete + comprador). Única por workspace. |
| `monto` | numeric(14,2) | = `carritos.total` al emitir (CHECK al insertar por trigger). |
| `vence_at` | timestamptz | `expiration_date` del link. |
| `estado` | text | `creado` · `procesando` · `aprobado` · `rechazado` · `vencido` · `error`. |
| `monto_recibido`, `motivo` | | Lo que dijo Bold y por qué falló. |
| `reclamado_at`, `veces_recibido`, `procesado_at` | | El reclamo de hoy (2 min). |

Único parcial `(carrito_id) where estado = 'aprobado'`.

### 4.4 Estados del carrito

```
abierto ──(proponer + «sí»: congela, emite link)──▶ en_pago ──(Bold APROBADO)──▶ pagado ──(venta en ONE)──▶ registrado
   ▲                                                   │
   └──────(link vencido sin pago, o el cliente cambia algo)──┘
abierto ──(7 días sin cambios)──▶ abandonado          en_pago/abierto ──(el cliente desiste)──▶ cancelado
```

- `pagado` sin pasar a `registrado` = el registro falló o se cortó; el reintento de Bold (o el botón de la pantalla) lo retoma desde ahí, línea por línea.
- `vencido` queda solo para el carrito cuyo último link venció y el cliente no volvió; uno que vuelve a escribir lo reabre (D7).
- Cambiar algo con el carrito `en_pago`: el link vigente se anula en ONE (estado del intento `vencido`, motivo «reemplazado»), el carrito vuelve a `abierto` con `version + 1`. Si después llega un pago de ese link viejo, se registra igual por su foto congelada (la plata manda) y se avisa al equipo.

## 5. Conversión a venta: un negocio con varias ventas

**Hoy:** `registrarVenta` crea una `ferreteria_ventas` y un negocio por venta; el índice único `ferreteria_ventas_negocio_unico` impide dos ventas en un negocio; la pantalla marca entrega y pago por venta.

**Decisión: un carrito pagado = un negocio de ONE; cada línea = una `ferreteria_ventas` de ese negocio.**

Por qué no N negocios:
- Un pago de Bold, un cliente, un paquete, un flete. Con N negocios el mismo cobro `BOLD-<LNK>` se parte en N cobros con la misma referencia y la entrega de una caja se marca N veces.
- El embudo de ONE contaría 2 negocios por una compra: infla conteos y ticket promedio.
- Es el modelo de todas las plataformas revisadas: un pedido con N líneas; la entrega se marca por pedido, con entrega parcial como excepción.

- **Hallazgo al construir:** `registrarPagoEnNegocio` bloquea la misma referencia de pago en dos negocios distintos («No se puede cargar duplicada»). Con N negocios, el cobro `BOLD-<LNK>` del segundo producto habría fallado. El borrador `feat/carrito-asistentes` tenía ese defecto.

Por qué la venta sigue siendo por línea: la ganancia y la liquidación mensual con Dimpro se miden por publicación (costo del día del producto). No se toca `liquidacion.ts`.

Cambios que implica:
1. Se quita `ferreteria_ventas_negocio_unico`; se agrega `ferreteria_ventas.carrito_linea_id` (único parcial): idempotencia por línea.
2. `registrarPedido(lineas[], …)` en `ventas.ts`: inserta las ventas (cada una se anota en su línea apenas existe), crea UN negocio con el subtotal de productos, anota el negocio en las ventas y en el carrito, y registra UN cobro anticipado con referencia `BOLD-<LNK>`. `registrarVenta` (pantalla, Wompi) queda como estaba: una venta, un negocio. Se decidió al construir no tocarla, para no arriesgar esos dos caminos.
3. Entrega y pago contra entrega por **negocio**: marcar una venta entregada marca todas las del mismo negocio y mueve el negocio una vez. En la pantalla, la venta muestra «parte de un pedido con N productos».
4. El flete sigue fuera de la venta y del precio del negocio (decisión vigente del 29-oct: no es venta del producto); queda escrito en la nota del negocio y en el carrito.
5. Reintento: carrito `pagado` con líneas a medias → las líneas con venta se respetan, las sin venta se insertan; con `negocio_id` ya anotado no se crea otro.

## 6. Cómo lo usa un asistente

**Genérico, en `supabase/functions/_shared/agente/publico/carrito/`:**
- `modelo.ts` (puro): estados, transiciones válidas, `totales`, `huellaCarrito`, `abandonado?`.
- `repo.ts`: puerto `RepoCarritos` (leer vivo de la conversación, reemplazar líneas con control de `version`, congelar, anotar pago) + doble en memoria + producción Supabase.
- `herramienta.ts`: la herramienta `carrito` (el modelo manda el carrito ENTERO como queda, cada vez: más robusto para un modelo que «agregar/quitar» sueltos) y el armado de `proponer` y del link desde el carrito guardado.
- Puerto del dominio `CatalogoCarrito`: `resolver(codigo) → { itemTipo, itemId, codigo, descripcion, precio, disponible, maxUnidades }`, `flete(zona)`, `venceHoras`, `maxLineas`.

**Ventas (Dimpro):** `dominio-ventas.ts` implementa `CatalogoCarrito` con el catálogo de Ferretería y la tabla de flete; `proponer` y `confirmar_compra` leen el carrito de la base; `generar_link_pago` y `verificar_pago` leen `carrito_pagos`.

**Servidor (Next):** `src/lib/carritos/pago-bold.ts` hace el reclamo y la idempotencia genéricos (puro, con dobles en las pruebas) y llama al convertidor del `dominio` del carrito; `src/lib/carritos/servidor.ts` lo cablea a la base. Ferretería: `src/lib/ferreteria/carrito-a-venta.ts` (+ `-servidor.ts`). Un link viejo cuyo carrito ya cambió no se registra solo: queda en `error` para revisión, aunque la plata haya entrado. El webhook `/api/webhooks/bold/funciones/[workspace]` busca primero el `LNK_…` en `carrito_pagos`, igual que hoy en `ferreteria_links_bold`.

**Reglamento:** `proc.compra` deja de decir «un producto por pedido»: todo lo que el cliente lleve va en un carrito, un link y un flete. Va en un SQL nuevo `sql/dimpro/2026-11-0X_carrito.sql` generado por `semilla-sql-dimpro.ts`, **después** de `2026-11-04_cierra-sola.sql` (PR #1418): esta rama se rebasa sobre #1418 cuando entre.

**Doble barrera ante un «sí» viejo:** el núcleo del asistente ya rechaza el botón de una propuesta superada («Ese botón ya no está vigente»); la versión del carrito en `carrito_emitir_pago` es la segunda, para el «sí» escrito o una carrera.

## 7. Fuera de alcance

- Sabor (experiencias) sigue con `funcion_registrar_pago` y sus apartados; el `dominio` del carrito deja la puerta abierta.
- Pago parcial, abonos, devoluciones por línea.
- Recordatorio automático de carrito abandonado (necesita plantilla de WhatsApp y ventana de 24 h de Meta): se decide aparte.
- Mensajes `order` nativos de WhatsApp (catálogo de Meta).

## 8. Pruebas y cierre

- Puras: transiciones, totales, huella, congelado, abandono, vencido.
- Repositorio en memoria: dos «sí» simultáneos = un link; cambiar el carrito en pago anula el link; aviso de Bold repetido/simultáneo/tarde; corte a mitad del registro y reintento por línea.
- Arnés de Dimi: compra de MP-62 + MP-64 en Messenger → un link, un flete, total correcto.
- SQL: la migración en dry-run (DO + RAISE) contra producción, luego aplicada por SQL **antes del merge y con el sí de Mauricio**; el reglamento con «autorizo escribir en dimpro».
- Terminado: spec aprobada; PR en verde; compra de varios productos en Messenger → un link de Bold con un flete; al pagar, el negocio y sus ventas quedan en ONE.
