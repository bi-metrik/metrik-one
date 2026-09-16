---
tipo: servicio
slug: licencia-sustenta
version: 1
nombre: Licencia Sustenta
modulo: compliance
disparador_cobro: ciclo
tratamiento_iva: excluido
tratamiento_iva_fuente: decisiones/2026-09-16_suscripciones-sin-iva-cloud-computing-excluido
precios_lista_fuente: reglas/pricing-one
descripcion: 'Acceso al módulo Sustenta de MéTRIK ONE — riesgos, controles, matriz, segmentación y vinculación de contrapartes — por suscripción mensual.'
parametros:
  precio_mensual:         { tipo: cop, min: 1, descripcion: 'Lo pactado con este cliente por mes.' }
  licencias:              { tipo: entero, min: 1, por_defecto: 3, descripcion: 'Personas con acceso. Proyecta workspaces.max_seats.' }
  dia_cobro:              { tipo: entero, min: 1, max: 28, por_defecto: 10 }
  consulta_dual_informa:  { tipo: booleano, por_defecto: false, descripcion: 'Si la consulta de listas cruza además la fuente de Informa. Se cobra aparte porque tiene costo por consulta.' }
  aviso_vencimiento_dias: { tipo: entero, min: 1, por_defecto: 30 }
  reintentos:             { tipo: entero, min: 0, max: 5, por_defecto: 3 }
  ventana_reintentos_dias: { tipo: entero, min: 1, por_defecto: 7 }
  dias_gracia:            { tipo: entero, min: 0, por_defecto: 5 }
documentos: [terminos-adhesion-one@1.0, politica-datos-one@1.0]
---

# Licencia Sustenta

El módulo de gestión documental y de riesgos de MéTRIK ONE. Hoy lo paga ALMA por la concesión
(`A1 26 1`, $400.000/mes, facturado a AFI).

Sustenta es la clave interna `compliance`. Con el módulo viene el grupo «Validación» del menú
—segmentación, sujetos, listas, vinculación—, que cuelga de esa misma llave.

## Por qué está excluido de IVA

La misma razón que Clarity: acceso recurrente a una plataforma en la nube, art. 476 del
Estatuto Tributario. Ver la decisión citada arriba.

## `consulta_dual_informa` es un parámetro y no un módulo aparte

La consulta cruzada con Informa tiene costo por consulta y no todo cliente de Sustenta la
quiere. Vive como parámetro del contrato porque no es otra pantalla: es la misma consulta con
una fuente más. La llave técnica que la enciende (`compliance_dual_informa`) es una llave de
función, y una función se configura, no se contrata por separado.

## Qué no está aquí

El precio de lista (vive en `reglas/pricing-one`), el pactado (en el contrato) y la comisión de
canal, que define cada negocio (N3 del 2026-09-15).
