---
tipo: servicio
slug: valida-cda-licencia
version: 1
nombre: Licencia Valida por CDA
modulo: valida_consulta
disparador_cobro: ciclo
tratamiento_iva: excluido
tratamiento_iva_fuente: decisiones/2026-09-16_suscripciones-sin-iva-cloud-computing-excluido
precios_lista_fuente: decisiones/2026-09-15_comisiones-afi-por-tipo-de-servicio
descripcion: 'Acceso al módulo Valida de MéTRIK ONE para un CDA — consulta de listas restrictivas SARLAFT, puntual y masiva, con su soporte documental — por suscripción mensual.'
parametros:
  precio_mensual:         { tipo: cop, min: 1, por_defecto: 150000, descripcion: '$150.000 sin IVA por cobro (decisión del 2026-09-15).' }
  licencias:              { tipo: entero, min: 1, por_defecto: 2 }
  dia_cobro:              { tipo: entero, min: 1, max: 28, por_defecto: 10 }
  modo_vitrina:           { tipo: booleano, por_defecto: true, descripcion: 'Deja ver /numeros y /tableros como vitrina de Clarity aunque el CDA no lo tenga contratado.' }
  aviso_vencimiento_dias: { tipo: entero, min: 1, por_defecto: 30 }
  reintentos:             { tipo: entero, min: 0, max: 5, por_defecto: 3 }
  ventana_reintentos_dias: { tipo: entero, min: 1, por_defecto: 7 }
  dias_gracia:            { tipo: entero, min: 0, por_defecto: 5 }
documentos: [terminos-adhesion-one@1.0, terminos-uso-valida@2.0, politica-datos-valida@1.5]
---

# Licencia Valida por CDA

Un CDA que consulta listas restrictivas desde su propio workspace de MéTRIK ONE.

## Qué cambió con D3 (2026-09-15)

Hasta hoy AFI **revendía**: un solo contrato (`A1 26 4`, $400.000/mes) cubría cuatro CDA y
MéTRIK le cobraba a AFI. Con D3, **AFI sale como revendedor**: cada CDA contrata con MéTRIK,
acepta los términos a nombre de MéTRIK y paga con su propia tarjeta; AFI pasa a cobrar
**comisión por venta**.

Consecuencias prácticas de ese cambio, que este archivo no puede resolver solo:

- los cuatro CDA **no existen como empresas** en el directorio de metrik (medido el
  2026-09-15: cero coincidencias). Crearlas con su RUT es prerrequisito de cualquier contrato;
- `A1 26 4` tiene cuota el 2026-09-18: la migración corre contra ese calendario;
- y N5: **cada CDA consulta desde su workspace**, AFI deja de consultar con su llave de
  agregador.

## El precio y la comisión son dos cosas

- **Precio:** $150.000 al mes, **sin IVA**, por CDA.
- **Comisión de AFI:** **$50.000, monto fijo**, no un porcentaje. Vive en
  `servicios_contratados.comision` del contrato de cada CDA, con `modo: monto_fijo`.

Que sea monto fijo y no porcentaje **no es un detalle de forma**: si el precio de la licencia
sube a $180.000, AFI sigue en $50.000 hasta que se renegocie. Un porcentaje se habría movido
solo. Las dos formas están en `src/lib/servicios/comision.ts` de ONE, y la base rechaza una
comisión declarada a medias.

## Por qué la comisión no está en este archivo

N3 del 2026-09-15: el porcentaje o el monto lo define **cada negocio**, no un valor global.
Escribirlo aquí lo convertiría en el valor global que esa decisión prohíbe, y además lo
aplicaría a un CDA que llegue por otra vía y no le deba comisión a nadie. El esquema de ONE
rechaza un archivo de catálogo que traiga `comision`.

## Antecedente que este archivo supera

`decisiones/2026-06-10_pricing-valida-tercerizado-canal-afi` fijaba $250.000/mes/NIT con split
MéTRIK $180.000 / AFI $70.000, bajo el modelo de reventa. D3 lo reemplaza.

## ⚠️ Pendiente antes de publicar

`precios_lista_fuente` cita `decisiones/2026-09-15_comisiones-afi-por-tipo-de-servicio`, que
**todavía no existe como archivo del cerebro**: hoy la decisión vive en la fila del 2026-09-15
de `proyectos/metrik/one/decisions.md`. Kaori tiene que capturarla antes de que la Action pueda
publicar este archivo — la Action comprueba que el slug citado exista y falla si no.
