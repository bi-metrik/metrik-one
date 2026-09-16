---
tipo: servicio
slug: valida-api-bolsa
version: 1
nombre: Paquete de consultas Valida API
modulo: valida_api
disparador_cobro: consumo
tratamiento_iva: excluido
tratamiento_iva_fuente: decisiones/2026-09-16_suscripciones-sin-iva-cloud-computing-excluido
precios_lista_fuente: decisiones/2026-09-07_escalera-pricing-volumen-valida
descripcion: 'Bolsa de consultas de listas restrictivas contra la API de Valida, para clientes que integran desde sus propios sistemas. Se renueva por consumo, no por calendario.'
parametros:
  consultas:                  { tipo: entero, min: 1000, descripcion: 'Consultas del paquete.' }
  precio:                     { tipo: cop, min: 1, descripcion: 'Precio del paquete pactado con este cliente.' }
  vigencia_meses:             { tipo: entero, min: 1, por_defecto: 6, descripcion: 'Cuánto dura la bolsa antes de vencer, se consuma o no.' }
  umbral_cobro_pct:           { tipo: entero, min: 1, max: 100, por_defecto: 95, descripcion: 'A qué porcentaje de consumo se cobra la renovación, con la bolsa nueva en espera (D1).' }
  avisos_consumo_pct:         { tipo: lista, por_defecto: [80, 95], descripcion: 'Porcentajes de consumo que disparan aviso al cliente.' }
  aviso_vencimiento_dias:     { tipo: entero, min: 1, por_defecto: 30 }
  tope_renovaciones_mes:      { tipo: entero, min: 1, max: 2, por_defecto: 2, descripcion: 'Tope de renovaciones automáticas por mes calendario. El cliente puede bajarlo, nunca subirlo.' }
  reintentos:                 { tipo: entero, min: 0, max: 5, por_defecto: 3 }
  ventana_reintentos_dias:    { tipo: entero, min: 1, por_defecto: 7 }
  devolucion_dias_habiles:    { tipo: entero, min: 1, por_defecto: 5, descripcion: 'Plazo para reversar una renovación no deseada.' }
  devolucion_consumo_max_pct: { tipo: entero, min: 0, max: 100, por_defecto: 10, descripcion: 'Cuánto se puede haber consumido de la bolsa nueva y aun así devolverla.' }
documentos: [terminos-uso-valida@2.0, politica-datos-valida@1.5, devoluciones-valida@1.0]
---

# Paquete de consultas Valida API

Para clientes que consultan desde **sus propios sistemas**, no desde una pantalla de MéTRIK ONE.
El primero es 4D SOFT.

## Lo que lo hace distinto de todo lo demás del catálogo

**Se cobra por consumo, no por calendario.** No tiene cuotas ni fechas: la renovación la dispara
que la bolsa vigente llegue a `umbral_cobro_pct`. Por eso `disparador_cobro: consumo`, y por eso
un paquete **no usa `planes_cobro`**: el cron que crea cuotas por calendario le inventaría un
calendario que no tiene.

## Por qué hay tope de renovaciones

Una llave comprometida o un bucle en el cliente pueden agotar bolsa tras bolsa en horas. El
tope de **2 por mes calendario** corta esa cadena: al llegar al tope la suscripción se pausa y
seguir exige un clic del cliente. El cliente puede bajarlo; no puede subirlo.

## Por qué el cobro es al 95 % y no al agotarse

D1 del 2026-09-15. Cobrar al agotarse deja al cliente sin servicio mientras el cargo resuelve,
y un cargo tarda. Al 95 % la bolsa nueva queda **en espera**: entra cuando la vigente se agota,
así que no hay corte ni se le cobra por adelantado a alguien que todavía no consumió.

## El precio, y qué no está aquí

El precio de lista sale de la escalera por volumen citada arriba. **La comisión no está aquí:**
para 4D SOFT es **20 % sobre cada paquete** y vive en `servicios_contratados.comision` de su
contrato, con `modo: porcentaje` (N3 del 2026-09-15). El gasto del primer paquete
(`comision-X1-26-1-paq1`, $280.000 = 20 % de $1.400.000) se registró a mano y se queda como
está; de aquí en adelante lo escribe el motor.

## ⚠️ Punto abierto sobre el IVA

La escalera del 2026-09-07 dice «IVA 19 % aparte» y el negocio `X1 26 1` se cerró como
**excluido** (2026-09-14). La decisión del 2026-09-16 resuelve la contradicción a favor de
excluido para toda suscripción, y así queda declarado arriba. Falta la caracterización de
Felipe; si cambiara, se cambia **subiendo la versión de este archivo**, nunca editándolo en su
sitio: los contratos ya firmados apuntan a la versión 1.
