---
tipo: servicio
slug: licencia-clarity
version: 1
nombre: Licencia Clarity
modulo: business
disparador_cobro: ciclo
tratamiento_iva: excluido
tratamiento_iva_fuente: decisiones/2026-09-16_suscripciones-sin-iva-cloud-computing-excluido
precios_lista_fuente: reglas/pricing-one
descripcion: 'Acceso al módulo Clarity de MéTRIK ONE — negocios, flujo, cotizaciones, tesorería y tableros — por suscripción mensual.'
parametros:
  precio_mensual:         { tipo: cop, min: 1, descripcion: 'Lo pactado con este cliente por mes. El precio de lista vive en la regla citada arriba; aquí va lo que se firmó.' }
  licencias:              { tipo: entero, min: 1, por_defecto: 3, descripcion: 'Personas con acceso. Proyecta workspaces.max_seats; bajarlo no expulsa a nadie, bloquea invitar.' }
  dia_cobro:              { tipo: entero, min: 1, max: 28, por_defecto: 10, descripcion: 'Día del mes en que se intenta el cargo. Hasta 28 para que todos los meses existan.' }
  meses_incluidos:        { tipo: entero, min: 0, por_defecto: 0, descripcion: 'Meses de licencia que un proyecto Clarity ya cubrió. Se cuentan desde que el cliente OPERA en producción, no desde la firma del Acta.' }
  aviso_vencimiento_dias: { tipo: entero, min: 1, por_defecto: 30 }
  reintentos:             { tipo: entero, min: 0, max: 5, por_defecto: 3 }
  ventana_reintentos_dias: { tipo: entero, min: 1, por_defecto: 7 }
  dias_gracia:            { tipo: entero, min: 0, por_defecto: 5, descripcion: 'Días desde el vencimiento antes de que el workspace pase a solo lectura (D4). Nunca se expulsa a nadie.' }
documentos: [terminos-adhesion-one@1.0, politica-datos-one@1.0]
---

# Licencia Clarity

El módulo de flujos de trabajo de MéTRIK ONE, vendido como suscripción mensual. Es lo que hoy
pagan Termotech (`A3 26 2`) y lo que va a pagar SOENA cuando termine su financiación.

## Por qué está excluido de IVA

Es acceso recurrente a una plataforma en la nube, no un servicio profesional: se factura como
servicio de computación en la nube excluido por el art. 476 del Estatuto Tributario. La
decisión citada arriba lo cierra y deja explícito que la regla anterior
(`2026-06-30_iva-pricing-precio-lista-es-total`, que decía 19 % incluido) no aplica a
suscripciones. Los servicios profesionales de Clarity —el proyecto, no la licencia— siguen
gravados: son cosas distintas y se venden aparte.

## Qué no está aquí

- **El precio.** El de lista vive en `reglas/pricing-one`; el pactado, en el contrato.
- **La comisión de canal.** La define cada negocio (N3 del 2026-09-15) y vive en el contrato.
  Un porcentaje escrito aquí sería el valor global que esa decisión prohíbe.
- **Qué funciones del módulo se encienden** (`conciliacion`, `cobros_recurrentes`, `fab_*`):
  eso se configura por workspace, no se contrata.

## Nota sobre `meses_incluidos`

Un proyecto Clarity suele traer meses de licencia incluidos. Se cuentan **desde que el cliente
opera en producción**, no desde la firma del Acta de Aceptación
(`decisiones/2026-09-07_licencia-incluida-desde-el-uso-real`). En SOENA esa diferencia eran
tres meses de licencia ya consumida.
