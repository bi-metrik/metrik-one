# Suscripciones de licencia ONE: cobro automático y acceso gobernado por el pago

> Max · 2026-09-08 · PR `feat/suscripciones-cobro-automatico`
> Regla de negocio: `cerebro/reglas/pago-anticipado-habilita-acceso.md` (pago anticipado habilita el mes; impago = suspensión desde el vencimiento, con aviso escrito, sin gracia, tras reintentos). **El acceso es el producto.**
> Fiscal (decidido 2026-09-08): METRIK IA S.A.S. (régimen SIMPLE) factura "servicio de computación en la nube", excluido de IVA (art. 476 num. 21 ET); el cliente no practica retefuente (art. 911 ET). **Monto de la cuota = monto debitado, sin desglose.**
> Fase 1 (este PR): modelo + máquina de estados + ciclo + gate de acceso + pasarela `manual`. Sin pasarela real.

## 0. Lo que se midió antes de escribir (producción, 2026-09-08)

| Dato | Medido | Consecuencia |
|---|---|---|
| `workspaces.subscription_status` | 17 workspaces: `trial` ×12, `active` ×4 (cda-*, maxitec), `active_pro` ×1 (soena). `subscription_expires_at` NULL en todos. `trial_ends_at` vencido en casi todos y **nadie lo lee** (`grep` en `src/`: cero consumidores). | El gate solo puede reaccionar a `suspendida`. El vocabulario heredado no se toca en Fase 1. |
| `planes_cobro` | 10 planes, **10 con `pasarela='manual'`**, 9 activos, todos `mensual`. Licencias identificables: SOENA $1.750.000 ×6 desde 2026-04-15 (Clarity financiado, cuota 6 = 2026-09-15), AFI **tres planes** ($400.000 + $416.667 + $100.000, ×12 desde 2026-05-15), Trappvel $833.333 ×6 desde 2026-08-20, Termotech $150.000 ×6 desde 2026-09-05. Días de inicio: 5, 10, 15, 20, 26, 27 (ninguno 29-31). | Ampliar el CHECK de `pasarela` no rechaza ninguna fila. **AFI no cabe en "una suscripción = un plan"** (§2.4). El desborde de `setMonth` (31 ene + 1 mes = 3 mar) no muerde hoy. |
| `modules.cobros_recurrentes` | Solo `metrik`. | Las licencias siguen siendo negocios del cliente dentro del workspace `metrik`; el cobrador es `metrik` y el pagador es otro tenant. |
| Emisión hoy | Cron `procesar-planes-cobro` (12:00 UTC): cobros T+3, vencido a 3 días, notificación, y **cuentas de cobro de persona natural desde el día 10** (`DIA_APERTURA_EMISION`), fechadas el 13, vencimiento el 15. | La factura Siigo de la SAS es un cambio de emisor, de fecha y de documento. Es una de las tres decisiones abiertas (§11). |

## 1. Qué cambia y qué no

**Cambia (Fase 1):** existe una tabla `suscripciones` que enlaza el workspace del cliente con el plan de cobro del cobrador; una máquina de estados pura; un ciclo idempotente que el cron corre cuando toca cobrar; un gate en el layout que cierra el acceso cuando el estado proyectado en `workspaces.subscription_status` es `suspendida`; y una interfaz `PasarelaAdapter` con la implementación `manual`.

**No cambia:** ningún plan actual tiene fila en `suscripciones`, así que el cron hace exactamente lo de hoy. La emisión de cuentas de cobro (paso 4) no se toca. Nadie se suspende solo (`POLITICA_FASE_1.suspenderAutomaticamente = false`). No se aplica la migración a producción con este PR.

## 2. Modelo de datos

### 2.1 `suscripciones` (nueva, migración `20260908120000_suscripciones.sql`)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `workspace_id` | uuid **UNIQUE** → `workspaces` (cascade) | El **cliente**: el tenant cuyo acceso se gobierna. |
| `plan_cobro_id` | uuid **UNIQUE** → `planes_cobro` (restrict) | El plan que la cobra, en el workspace del **cobrador** (`metrik`). Único: dos suscripciones sobre un plan cobrarían la misma cuota dos veces. |
| `pasarela` | text CHECK `manual|bold|epayco`, default `manual` | La efectiva. `planes_cobro.pasarela` queda por compatibilidad con `BloquePlanRecurrente`. |
| `medio_pago` | jsonb nullable, CHECK sin claves `pan/numero/cvv/cvc` | Enmascarado: `{tipo, marca, ultimos4, titular, token_ref, pasarela, registrado_at}`. Nunca PAN ni CVV. |
| `estado` | text CHECK `trial|activa|pendiente_pago|suspendida|cancelada`, default `trial` | Canónico. Se proyecta en `workspaces.subscription_status`. |
| `proximo_cobro` | date nullable | Fecha Bogotá de la próxima cuota. El cron corre el ciclo cuando `<= hoy`. NULL = plan terminado. |
| `intentos_fallidos` | int ≥ 0 | Cargos rechazados seguidos; vuelve a 0 con cada pago. |
| `ultimo_error` | text | Lo último que impidió cobrar, para leerlo sin abrir logs. |
| `estado_cambiado_at`, `created_at`, `updated_at` | timestamptz | Trigger propio `suscripciones_set_updated_at()` con EXECUTE revocado a PUBLIC. |

Índice `idx_suscripciones_ciclo (estado, proximo_cobro) where proximo_cobro is not null`. RLS: `select` para `authenticated` de su propio workspace (`(select current_user_workspace_id())`, InitPlan). **Sin grant de escritura:** solo `service_role` (cron, platform admin). Marca declarada para la guarda `check:migraciones`: tabla con RLS + grant select.

### 2.2 Lo que se reusa tal cual

- `cobros` con `tipo_cobro='programado'`, `plan_cobro_id`, `numero_cuota`, `fecha_esperada`; unique `(plan_cobro_id, numero_cuota)` es la **clave de idempotencia del cobro**. `cobros.external_ref` guarda el id de la transacción de la pasarela; `cobros.fuente` guarda la pasarela (`manual|bold|epayco`, mismo campo que ya usan `epayco`/`davivienda`). `cobros.fecha` = la plata entró (es la definición de ingreso de todo el producto).
- `planes_cobro` (monto, frecuencia, fecha_inicio, total_cuotas, auto_renovar, activo). CHECK de `pasarela` ampliado a `wompi|manual|mixto|bold|epayco`.
- `workspaces.subscription_status` y `subscription_expires_at`: **proyección** de `suscripciones.estado` y `proximo_cobro` (hasta cuándo está pago el acceso). Escritas por el ciclo; leídas por el layout. `trial_ends_at` sigue sin consumidores.

### 2.3 Fuente única de la aritmética de cuotas

`src/lib/cobros/fecha-cuota.ts` (`fechaCuota`, `fechaCuotaISO`, `cuotaParaFecha`, `cuotaSiguiente`, `diasEntreISO`). Se extrajo del cron sin cambiar su semántica: el paso 1 del cron y el ciclo escriben la misma cuota con la misma fecha, y si uno inserta primero el otro relee (23505). Documentado en el módulo el desborde heredado de `setMonth` para inicios 29-31.

### 2.4 Hallazgo: AFI son tres planes y la tabla admite uno

El modelo "una suscripción = un plan" cubre Termotech, Trappvel y SOENA. AFI tiene tres planes agrupados en una sola cuenta de cobro ($916.667). Opciones, ninguna tomada aquí: (a) consolidar AFI en un plan de $916.667 ×12 (cambio de datos, decisión de Mauricio; las 3 filas viejas se cierran con `activo=false`), o (b) Fase 2 con tabla `suscripcion_planes` N:M. Hasta entonces AFI no tiene suscripción y sigue como hoy.

## 3. Estados

`src/lib/suscripciones/estado.ts` — pura, sin base ni reloj. 18 pruebas.

```
trial ──pago──▶ activa ──vencimiento──▶ pendiente_pago ──suspender──▶ suspendida
  │               ▲                          │   ▲                        │
  │               └───────── pago ───────────┘   └── cargo_fallido ──┐    │
  │                                              (intentos < max)   │    │
  │               ◀────────────── pago (reactivación) ──────────────│────┘
  └──────────────────────── cancelar (desde cualquiera) ───────────▶ cancelada
```

| Desde \ evento | `pago_recibido` | `vencimiento` | `cargo_fallido` | `suspender` | `cancelar` |
|---|---|---|---|---|---|
| trial | activa (intentos 0) | pendiente_pago | pendiente_pago / suspendida* | suspendida | cancelada |
| activa | activa | pendiente_pago | pendiente_pago / suspendida* | suspendida | cancelada |
| pendiente_pago | activa | (igual) | pendiente_pago / suspendida* | suspendida | cancelada |
| suspendida | **activa** (reactivación) | (igual) | suspendida (+1) | suspendida | cancelada |
| cancelada | terminal | terminal | terminal | terminal | terminal |

\* `suspendida` cuando `intentos >= maxIntentos` **y** `politica.suspenderAutomaticamente`. `vencimiento` nunca suspende por sí solo: suspender es un evento aparte, para que quede escrito quién lo decidió.

`PoliticaSuspension = { diasGracia, maxIntentos, suspenderAutomaticamente }`. `POLITICA_FASE_1 = { 3, 3, false }`: la gracia de hoy, y nadie se suspende solo hasta que Mauricio fije la política (§11).

`accesoWorkspace(status, esPlatformAdmin)`: solo `'suspendida'` cierra; `trial`, `active`, `active_pro`, `pendiente_pago`, `cancelada` y NULL pasan; el platform admin pasa siempre.

## 4. Ciclo mensual

`src/lib/suscripciones/ciclo.ts` — `correrCicloSuscripcion(sus, plan, deps)`. 21 pruebas con un doble de Supabase que aplica insert/update en memoria (la idempotencia se mide en lo que queda escrito, no en lo que se llamó). Mutaciones probadas: ignorar `cobro.fecha` (3 pruebas caen), gracia con `>=` (1), ignorar la política (2), recobrar en vez de sondear (1).

Orden, y por qué:

1. **La cuota que toca**: `cuotaParaFecha(plan, proximo_cobro)` (primera cuota con fecha `>= proximo_cobro`). Sin cuota → `plan_terminado`, sin escrituras.
2. **Asegurar el cobro programado** de esa cuota. Reusa la fila si existe (el paso 1 del cron la crea T+3 antes); si no, la inserta con `workspace_id` del **cobrador**, `negocio_id` del plan, `fecha_esperada` = fecha de la cuota; 23505 → relee.
3. **¿Ya entró la plata?** Si `cobro.fecha` no es null (confirmación manual, webhook, conciliación): `pago_recibido`, `proximo_cobro` = cuota siguiente (o NULL si era la última), `intentos=0`, y se termina. **Esto es lo que el emisor de cuentas no hace** ("una cuota ya pagada se vuelve a cobrar si hay fila"): el ciclo sí valida el pago, y por eso no puede cobrar dos veces.
4. **Factura ANTES del cargo.** La SAS cobra contra factura. `deps.facturar(ctx)`; si falla, `factura_fallida`, `ultimo_error='factura: …'` y **no se cobra**. Fase 1: `facturaOmitidaFase1` (`{ok:true, omitida:true}`); el hueco queda en el orden correcto.
5. **El cargo.** Si `cobro.external_ref` existe se **sondea** (`adapter.consultar`) — un intento vivo no se duplica; si no, `adapter.cobrar(SolicitudCargo)` con `referencia = referenciaCargo(susId, n)` (`sub-<12 hex>-c<n>`, ≤ 30 caracteres, determinista). Excepciones del adaptador → `error`, sin mover estado.
6. **Registrar.**
   - `aprobado` → `cobros.{fecha, external_ref, fuente, vencido=false}`; `pago_recibido`; avanza.
   - `pendiente` → anota `external_ref` si vino (link); si `hoy − fecha_esperada > diasGracia` → `vencimiento` (activa→pendiente_pago); si la política suspende sola → `suspender`.
   - `rechazado` → `cargo_fallido` (`intentos+1`; suspende solo con política), `ultimo_error = '<codigo>: <mensaje>'`.
   - `error` → `ultimo_error`, estado intacto.
   - Persistencia en `suscripciones` **solo si algo cambió**, y en el mismo movimiento la proyección `workspaces.{subscription_status, subscription_expires_at}`.

**Día del ciclo.** `proximo_cobro` es la fecha de la cuota (`fecha_inicio` + n períodos): Termotech el 5, Trappvel el 20, SOENA el 15. La regla "factura el día 1 con vencimiento inmediato" es un cambio de calendario contractual: §11.

**Renovación.** `auto_renovar` no se implementa aquí: al pagar la última cuota `proximo_cobro` queda NULL, el trigger `trg_cobro_programado_completado` inactiva el plan, y una persona decide. Fase 2.

**Cron.** Paso 5 de `procesar-planes-cobro` (después del paso 1, para que este conserve su comportamiento exacto): `traerTodo` sobre `suscripciones` con `estado in (trial, activa, pendiente_pago, suspendida)` y `proximo_cobro <= hoy`; carga los planes; `adapterPara(pasarela)` (Fase 1: solo `manual`; `bold`/`epayco` se reportan como "sin adaptador" sin escribir); un `try/catch` por suscripción. La respuesta JSON gana `suscripciones_procesadas`, `suscripciones_resultados`, `suscripciones_errores`.

## 5. `PasarelaAdapter`

`src/lib/suscripciones/pasarela/adapter.ts`:

```ts
interface PasarelaAdapter {
  readonly nombre: 'manual' | 'bold' | 'epayco'
  readonly capacidades: { cobroSinClic; tokenizacion; linkDePago; webhook }
  cobrar(s: SolicitudCargo): Promise<ResultadoCargo>        // idempotente por s.referencia
  consultar(externalRef: string): Promise<ResultadoCargo>   // sondeo de lo pendiente
  verificarWebhook?(cuerpoCrudo: string, cabeceras): VerificacionWebhook  // sincrónico, sin red
}
SolicitudCargo = { referencia, suscripcionId, workspaceId (cliente), cobroId, planCobroId, numeroCuota,
                   monto (COP entero), moneda:'COP', descripcion, facturaRef|null, medioPago|null, cliente|null }
ResultadoCargo = { estado:'aprobado', externalRef, fecha, monto }
               | { estado:'pendiente', externalRef|null, linkPago?, expira?, detalle? }
               | { estado:'rechazado', externalRef|null, codigo, mensaje, reintentable }
               | { estado:'error', mensaje, reintentable }
```

Contrato: un rechazo es un **resultado**, no una excepción; `cobrar` no puede cobrar dos veces la misma `referencia`; `verificarWebhook` no toca la red porque el route handler tiene que responder en < 2 s.

`manual.ts`: capacidades todas `false`; `cobrar`/`consultar` devuelven `pendiente` sin `externalRef`. `registro.ts`: `adapterPara('manual')`; `bold`/`epayco` → `null` en Fase 1.

### 5.1 Contrato del webhook (Fase 2, cualquier pasarela)

Route handler `src/app/api/webhooks/pasarela/[nombre]/route.ts` (patrón de `webhooks/kyc/route.ts` y `meta-leads-webhook`):

1. Leer el cuerpo **crudo** (`request.text()`), verificar la firma con `adapter.verificarWebhook` (`timingSafeEqual`); sin secreto configurado → 503; firma inválida → 401. **Un secreto ausente nunca autoriza.**
2. **Inbox antes de procesar**: insertar en `suscripcion_eventos (pasarela, transaccion_id UNIQUE, referencia, tipo, monto, cuerpo jsonb, recibido_at, procesado_at)`. 23505 = evento repetido → **200 sin reprocesar** (Bold reintenta 5 veces; Meta reintenta para siempre: la idempotencia es por `transaccionId`, no por referencia).
3. Responder **200 en < 2 s**. Todo lo que tarde (Siigo, Drive, correo) va **antes de responder** si cabe, o en `after()`/`waitUntil` — nunca como promesa suelta tras el `return` (leads de Meta perdidos 12%, medido 2026-07-31).
4. Procesar: resolver `referencia` → `(suscripcionId, numeroCuota)` → cobro → `cobros.fecha/external_ref/fuente` → `transicionar(pago_recibido)` → proyección. Con `rechazado`/`anulado`: `cargo_fallido` o anulación del cobro (`anulacion.ts`, monto → 0).
5. Reconciliación de respaldo: el ciclo diario sigue sondeando con `consultar`, así que un webhook perdido se resuelve solo al día siguiente. Y un cruce periódico de conteos contra la pasarela mientras dure la adopción (un fallo mudo solo se detecta contra la fuente externa).

## 6. bold-link vs epayco-token

| | `bold-link` | `epayco-token` |
|---|---|---|
| Qué hace el cliente cada mes | **Abre un link y paga** (clic). Sin clic no hay plata. | **Nada**: débito con la tarjeta tokenizada. |
| Cobro iniciado por el comercio | **No existe hoy.** La doc de Bold dice que el comercio tokeniza por su cuenta y que las APIs de recurrencia "vendrán" (verificado 2026-09-08 en developers.bold.co). | Sí, por token de tarjeta (customer + token + plan + subscription/charge). |
| API (verificado hoy) | `POST https://integrations.api.bold.co/online/link/v1` (link por cuota, auth `Authorization: x-api-key <llave>`); `POST https://api.online.payments.bold.co/v1/payment-intent`, `GET /v1/payment/{reference_id}`, `POST /v1/payment`. | ONE ya consulta transacciones por APIFY (`src/lib/epayco.ts`, JWT de PUBLIC+PRIVATE key). **Los endpoints de token/suscripción NO se verificaron hoy**: se leen de la doc antes de escribir el adaptador. |
| Webhook | CloudEvents: `SALE_APPROVED`, `SALE_REJECTED`, `VOID_APPROVED`, `VOID_REJECTED`. Firma **HMAC-SHA256 del cuerpo en base64** comparada con `x-bold-signature`. 5 reintentos; responder 200 en 2 s. | URL de confirmación con firma propia; por verificar en la doc. |
| `capacidades` | `{cobroSinClic:false, tokenizacion:false, linkDePago:true, webhook:true}` | `{cobroSinClic:true, tokenizacion:true, linkDePago:false, webhook:true}` |
| Estado tras `cobrar` | `pendiente` con `externalRef` = id del link y `linkPago`; el ciclo lo sondea a diario y el webhook lo cierra. | `aprobado`/`rechazado` en la misma llamada (más el webhook como respaldo). |
| Lo que vale la regla del cerebro | Cumple "pago anticipado habilita el mes" **si el cliente paga**; la suspensión sale del vencimiento del link, no de reintentos. | Cumple literal: reintentos → suspensión. |
| Riesgo principal | Depende de un humano cada mes; un link vencido sin pagar = suspensión que el cliente vive como sorpresa si el aviso escrito no salió. | Custodia del token y del consentimiento (tokenizar exige que el cliente registre la tarjeta en un checkout de ePayco, no en ONE). |
| Costo por transacción | Se cotiza con Bold; no se cita de memoria. | Ya medido en ONE: comisión + IVA + retefuente + reteica discriminados (`parseDesglose`). |

Con la información de hoy, **`epayco-token` es la única que da "se cobre sola"**; `bold-link` es "se pida sola". Las dos caben en el mismo ciclo y la elección no obliga a reescribir nada de este PR.

## 7. Gate de acceso

`src/app/(app)/layout.tsx`: la lectura de `workspaces` que ya existía gana `subscription_status`; `accesoWorkspace(status, platformAdminState != null) === 'suspendido'` → `redirect('/suscripcion-suspendida')`. Cero consultas extra. `src/app/(marketing)/suscripcion-suspendida/page.tsx` es un server component fuera del grupo `(app)` (dentro, el mismo layout la redirigiría), en español, con `mauricio.moreno@metrik.com.co` y el WhatsApp oficial. `src/middleware.ts`: el guard del rol `contador` (todo → `/revision`) excluye `/suscripcion-suspendida`, o un contador de un workspace suspendido rebotaría entre las dos.

## 8. Fase 1: archivos

| Archivo | Qué |
|---|---|
| `supabase/migrations/20260908120000_suscripciones.sql` | Tabla, índice, trigger, RLS, grant select, CHECK de `planes_cobro.pasarela`. DDL puro. **No aplicada.** |
| `src/lib/cobros/fecha-cuota.ts` (+test) | Aritmética de cuotas, extraída del cron. |
| `src/lib/suscripciones/estado.ts` (+test) | Máquina de estados, política, `accesoWorkspace`. |
| `src/lib/suscripciones/pasarela/adapter.ts` | Interfaz, tipos, `referenciaCargo`. |
| `src/lib/suscripciones/pasarela/manual.ts` (+test), `registro.ts` | Adaptador manual y `adapterPara`. |
| `src/lib/suscripciones/ciclo.ts` (+test) | El ciclo. |
| `src/app/api/crons/procesar-planes-cobro/route.ts` | Paso 5; importa `fechaCuota` del módulo. |
| `src/app/(app)/layout.tsx`, `src/app/(marketing)/suscripcion-suspendida/page.tsx`, `src/middleware.ts` | Gate. |
| `src/types/database.ts` | Tabla `suscripciones` + alias `Suscripcion`, editados a mano con la forma del generador. |

### 8.1 Cómo se enciende una suscripción (cuando Mauricio lo autorice, después de aplicar la migración)

Una fila por cliente, con `proximo_cobro` = **la siguiente cuota sin pagar** (con `cuotaParaFecha`, o a mano). Ejemplo Termotech, si la cuota 1 del 2026-09-05 ya se confirmó:

```sql
insert into public.suscripciones (workspace_id, plan_cobro_id, pasarela, estado, proximo_cobro)
select w.id, p.id, 'manual', 'activa', '2026-10-05'
from public.workspaces w, public.planes_cobro p
where w.slug = 'termotech' and p.id = '<id del plan de $150.000 x 6>';
```

Desde ese momento el cron: el 2026-10-05 asegura la cuota 2 (que el paso 1 ya creó el 2), no cobra (manual), y cuando alguien confirme el pago desde el bloque de cobros, la corrida siguiente lo registra y mueve `proximo_cobro` al 2026-11-05. Si la cuota vence más de 3 días sin pago, `pendiente_pago` (informativo). `suspendida` solo la escribe una persona: `update suscripciones set estado='suspendida', estado_cambiado_at=now()` **más** `update workspaces set subscription_status='suspendida'` (o esperar a que el ciclo lo proyecte en la próxima corrida; para no dejar la ventana, hacer los dos).

## 9. Fase 2 (fuera de este PR)

1. **`emitirFacturaCuota`** (`src/lib/siigo/factura-cuota.ts`): factura por cuota contra el Siigo de la SAS, reusando `borradorFactura` + `siigoRequest` con `idempotencyKey = claveIdempotencia(cobroId, 'fv')`, producto "Servicio de computación en la nube" con impuesto **excluido** (verificar en el catálogo de Siigo que el id de impuesto sea "excluido" y no "exento": son casillas distintas en la DIAN), `ivaPct = 0`, cliente = tercero del workspace pagador (`empresas` del negocio de licencia, como `generar-cuentas-cobro`). `emitirFacturaNegocio` **no sirve tal cual**: exige honorario cubierto y una factura por negocio. Prerrequisitos: `config_extra.siigo` del workspace `metrik` con las credenciales de la SAS (`setup-siigo-workspace.ts`), archivo del PDF en el negocio (`archivarPdfEnBloque`), y decidir si la cuenta de cobro de persona natural del paso 4 se apaga para esos planes.
2. **Adaptadores** `bold-link` y `epayco-token` + route handler del webhook + tabla `suscripcion_eventos`.
3. **Aviso escrito** al suspender y al quedar `pendiente_pago` (Resend, patrón `send-cuenta-cobro.ts`), y notificación interna reusando `cobro_vencido` (ya en el CHECK de `notificaciones.tipo`; `cobro_proximo` y `plan_terminado` también existen y nadie los emite).
4. **Recibo de caja** al aprobarse el cargo (`emitirReciboAutomatico`, que nunca lanza), si la línea lo declara.
5. **Pantalla "Mi suscripción"** en `/mi-negocio` del cliente (lee `suscripciones` por RLS) con medio de pago enmascarado y registro/actualización de tarjeta (checkout de la pasarela, nunca formulario propio).
6. **Renovación** (`auto_renovar`): crear el plan siguiente al pagar la última cuota, con precio revisado.
7. **AFI**: consolidar o `suscripcion_planes`.
8. **Sondeo más frecuente** que diario para links pendientes (el plan Pro de Vercel ya admite crons sub-diarios).
9. Normalizar el vocabulario heredado de `subscription_status` (`active`/`active_pro` → `activa`) con un CHECK, **después** de que todos los workspaces con licencia tengan suscripción.

## 10. Riesgos

- **Aplicar la migración es seguro; encender una suscripción no es reversible en silencio.** Una fila mal puesta (`proximo_cobro` en una cuota ya pagada) no cobra doble (paso 3 lo ve), pero una con `estado='suspendida'` cierra un tenant en el siguiente render. Por eso `suspendida` es manual en Fase 1.
- **`cobros.fuente` y `cobros.anulado_at` no están en `database.ts`** (tipos generados atrasados): el ciclo usa el cliente sin genéricos, como `emitir-cuota-explicita.ts`. Regenerar tipos es deuda vieja, no de este PR.
- **Dos escritores sobre `cobros` de la misma cuota** (paso 1 y ciclo) comparten `fechaCuota`; si alguien cambia la aritmética en uno solo, el 23505 lo esconde. Por eso la función es una y tiene pruebas con los planes reales.
- **`setMonth` desborda** para inicios 29-31. No aplica a ningún plan vivo; queda documentado y probado, no corregido (corregirlo movería cuotas ya emitidas).
- **Un webhook que responda 200 y procese después pierde el evento** (Fase 2): el contrato de §5.1 existe para eso.
- **Siigo "excluido" vs "exento"**: el tipo de impuesto equivocado sale bien en Siigo y mal ante la DIAN. Se valida contra el catálogo antes de la primera emisión.

## 11. Decisiones abiertas para Mauricio

1. **Pasarela.** `epayco-token` es la única que hoy cobra sin clic; `bold-link` obliga al cliente a pagar cada mes desde un link. Bold sin recurrencia no cumple "se cobre sola". ¿ePayco, Bold-link mientras Bold saca recurrencia, o las dos según cliente? El código admite cualquiera de las tres respuestas sin cambiar el ciclo.
2. **Día de facturación y de cobro.** Hoy: cuota el día del contrato (5/15/20), cuenta de cobro desde el 10, fechada el 13, vence el 15. Propuesto: factura Siigo el **día 1** con vencimiento inmediato y cargo el mismo día. Cambiarlo mueve fechas contractuales de Termotech y Trappvel (contratos vivos) y apaga el paso 4 para esos planes. ¿Se migra el calendario o se factura en la fecha de cada cuota?
3. **Política de suspensión.** `POLITICA_FASE_1 = {gracia 3 días, 3 intentos, sin suspensión automática}`. La regla del cerebro dice "sin gracia, tras reintentos, con aviso escrito". ¿Gracia 0 como dice la regla, o 3 como el cron? ¿Cuántos reintentos y con qué cadencia (diaria)? ¿Suspensión automática desde el día uno, o manual hasta que el aviso escrito exista (Fase 2, punto 3)?

## 12. Verificación

- `npm test`: 58 pruebas nuevas en verde; mutaciones §4.
- `npx tsc --noEmit`, `npx eslint <archivos tocados>`, `npm run check:migraciones`, `npx next build`: en verde en local antes del PR.
- Comportamiento de producción tras mergear (sin aplicar la migración): el cron falla en el paso 5 con "relation suscripciones does not exist" **dentro de su try/catch** y reporta `suscripciones_errores: [{suscripcion_id:'*', …}]`; los pasos 1-4 no se enteran. Aplicada la migración y sin filas, el paso 5 procesa 0 y no escribe nada.
