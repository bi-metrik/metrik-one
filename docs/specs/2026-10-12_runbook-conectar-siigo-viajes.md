# Runbook: conectar Siigo de un workspace con viajes

Fecha: 2026-10-12 · Dueño: Max · Primer caso: Trappvel (`slug = trappvel`).

El objetivo es que el día que lleguen las credenciales **no haya código nuevo**: correr el setup,
correr la prueba sin escritura, revisar la simulación y encender. Todo lo que este documento manda
hacer lo corre la sesión principal (o Mauricio) desde la raíz del repo principal de ONE, con el
`.env.local` de siempre. Ningún paso emite nada en Siigo hasta el último, y ese pide confirmación.

## 1. Qué pedirle al cliente

| Dato | Para qué | Dónde lo saca el cliente |
|---|---|---|
| Usuario API | Autenticar | Siigo → Alianzas / Integraciones |
| Access Key | Autenticar | El mismo lugar. **Nunca por chat**: se pega en el setup, que lo manda a Vault |
| Partner-Id | Cabecera de cada petición | Lo da Siigo a la integración |
| Comprobante FV (factura electrónica) | `facturaDocumentId` | Lo lista el setup |
| Comprobante RC (recibo de caja) | `reciboDocumentId` | Lo lista el setup |
| Producto de **ingreso propio** (fee, margen, con IVA) | `productoPropioCode` | El contador lo crea en Siigo (bandera 2) |
| Producto **recibido para terceros** (sin IVA) | `productoTercerosCode` | Ídem |
| Forma de pago del recibo **por cada cuenta** donde entra la plata | `reciboPaymentIdPorCuenta` | Una por cuenta de `cuentas_recaudo` (Bancolombia, Davivienda, …) |
| Centro de costo (opcional) | `centroCostoId` | Si el contador lo usa |
| ¿Empresa de pruebas o libros reales? | `entorno` | Lo decide MéTRIK con el cliente |

Siigo no tiene sandbox: «pruebas» es **otra empresa** de Siigo con sus propias credenciales. Con
`entorno = produccion`, un negocio marcado de prueba (`metadata.prueba` o `metadata.es_prueba`)
**nunca** emite: ni factura, ni recibo, ni tercero.

## 2. El día de las credenciales (comandos exactos)

```bash
# 0) Desde el repo principal de ONE (no un worktree: necesita node_modules y .env.local)
cd ~/Developer/metrik/metrik-one

# 1) Setup: comprueba las credenciales contra Siigo ANTES de guardar, lista el catálogo y pregunta
#    los ids. Credenciales → Vault; catálogo → workspaces.config_extra.siigo_config.
#    Con líneas de viaje pregunta además los dos productos, el centro de costo, la forma de pago
#    por cuenta y el entorno. --viajes lo fuerza si la línea todavía no declara servicios_viaje.
npx tsx scripts/setup-siigo-workspace.ts trappvel --viajes

# 2) Prueba sin escritura (solo GET): cada id existe y está activo en ESA empresa; dice el entorno.
#    Sale con código 1 si algo falta.
npx tsx scripts/check-siigo.ts trappvel

# 3) Simulación: el payload exacto de cada viaje en cola y de cada recibo pendiente.
#    No llama a Siigo ni escribe nada.
npx tsx scripts/simular-siigo-desde-one.ts trappvel --viajes
```

Qué revisar en la simulación, caso por caso:
- **Tercero**: tipo y número de documento del titular de «El cliente confirmó», dirección y ciudad
  (código DANE). Si dice «falta: dirección / ciudad», se completa en el negocio → «Ver datos de
  facturación».
- **Factura**: dos ítems, el de ingreso propio con el IVA configurado y el de terceros sin
  impuestos, y `payments[0].value` igual al precio aprobado (± centavos de redondeo).
- **Recibo**: `payment.id` = la forma de pago de la cuenta donde entró la plata. Una cuenta sin
  mapear dice «falta configurar» y no se emite con la forma de otra.
- `⛔` en un negocio de prueba con entorno producción: es la guarda funcionando.

## 3. Encender

Solo después de que la simulación cuadre y del OK de Mauricio (D3). SQL de configuración (la
sesión principal lo corre por MCP con el filtro de workspace; aquí no se corre):

```sql
-- Recibo de caja automático al registrar cada pago del viajero (F2-6) y facturación por evento (F5).
update lineas_negocio
   set config_extra = config_extra
     || jsonb_build_object('siigo', coalesce(config_extra->'siigo','{}'::jsonb) || '{"recibo_total_automatico": true}'::jsonb)
     || jsonb_build_object('facturacion', coalesce(config_extra->'facturacion','{}'::jsonb) || '{"por_titular": {"activo": true}}'::jsonb)
 where id = '<linea Viaje a medida>'
   and workspace_id = (select id from workspaces where slug = 'trappvel');
```

**Encender no vacía la cola sola.** Lo que quedó pendiente mientras no había credenciales:
- recibos: en `/conciliacion` aparece «Hay N recibos de caja de viajes pendientes» → «Emitir
  pendientes» → confirma el conteo («Sí, emitir N»). Si el conteo cambió entre ver y confirmar, el
  servidor no emite y pide confirmar de nuevo. O caso por caso con «Reintentar» en el riel del
  negocio;
- facturas: una por una desde la cola de facturación, como siempre (cada una se revisa).

## 4. De `pruebas` a `produccion`

1. Con la empresa de pruebas: correr el viaje de prueba (F8) de punta a punta y revisar en Siigo de
   pruebas el recibo y la factura (F2-6, F5-2).
2. Cambiar a los libros reales: volver a correr el setup con las credenciales de **producción** y
   responder `produccion` (el setup reescribe Vault y el `siigo_config` completo; los ids son
   distintos en cada empresa: nunca se copian a mano).
3. `check-siigo` y la simulación otra vez, ahora contra producción.
4. El negocio de prueba queda marcado: desde ahí no emite nada (guarda de entorno).

## 5. Si algo sale mal

| Síntoma | Causa | Qué hacer |
|---|---|---|
| Setup: «FALLÓ (HTTP 401)» | Usuario, Access Key o Partner-Id | Pedirlos de nuevo; no se guardó nada |
| check: «✗ … NO EXISTE en esta empresa» | Id de otra empresa (p. ej. de pruebas) | Volver a correr el setup |
| Recibo «falta configurar en Siigo la forma de pago de la cuenta X» | Cuenta nueva sin mapear | Setup otra vez (pregunta todas las cuentas) |
| Factura «falta configurar en Siigo el producto …» | Faltan los productos de viaje | Setup con `--viajes` |
| «Este es un negocio de prueba y Siigo está conectado a los libros reales» | Guarda de entorno | Correcto: el negocio de prueba no emite en producción |

Relacionado: `docs/specs/2026-08-06_integracion-siigo-facturacion.md` (la integración de SOENA, que
no cambia: sin los campos nuevos, `siigo_config` se comporta como siempre).
