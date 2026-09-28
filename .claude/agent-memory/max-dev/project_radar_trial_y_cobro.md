---
name: radar-trial-y-cobro
description: Trial de 5 días del Radar anclado a la aceptación de términos + eslabón servicios_contratados → planes_cobro (paso 6a del cron); migración 20260929010000 SIN aplicar y la gracia de mora pasa de 3 a 5 días para TODOS los productos
metadata:
  type: project
---

PR abierto el 2026-09-28 sobre `main` tras #952. Autorización literal de Mauricio: «que quede el
periodo de prueba de 5 días después de aceptar los términos y que para seguir usando el servicio
tenga que pagar con el link». Cierra el bloque C de
`proyectos/metrik/one/2026-09-28_spec-radar-secop-en-one.md` (el eslabón que [[radar-secop-modulo]]
midió que faltaba) y el bloque G (banner).

## ⚠️⚠️ Estado que no se ve en el código

- **`20260929010000_enrolamiento_cobro_por_ciclo.sql` SIN aplicar.** DDL + una función, cero filas.
  Sin ella el paso 6a del cron reporta error y **nada más se rompe** (ningún camino viejo la usa).
  **Va antes del merge**, porque mergear `main` despliega.
- **Nada se enrola hasta que exista el contrato de Fabri** (empresa + negocio + ficha publicada). El
  paso 6a con 0 contratos de `radar_secop` devuelve el resumen vacío sin escribir.
- **La ficha `radar-secop-licencia` no se puede publicar** hasta que Kaori capture
  `decisiones/2026-09-28_pricing-radar-secop`: la Action del catálogo falla si el slug citado no
  existe como archivo.

## ⚠️⚠️ La gracia de mora pasó de 3 a 5 días, y eso toca a TODOS los productos

`DIAS_GRACIA` del cron `procesar-planes-cobro` y `POLITICA_FASE_1.diasGracia`. **Lo que se alineó fue
el código**: los términos que firma el cliente y `cerebro/reglas/pago-anticipado-habilita-acceso`
(2026-09-15) prometen cinco, y con tres ONE marcaba `vencido` dos días antes de lo pactado. Efecto
real: una cuota se declara impaga dos días más tarde que antes, en Clarity, Valida y el Radar.

⚠️ **La otra mitad de esa promesa —«desde el día 6, solo lectura»— no la cumple ningún producto.**
Medido: `accesoWorkspace` solo cierra con `suspendida`, `POLITICA_FASE_1.suspenderAutomaticamente`
está en `false`, y el único `soloLectura` del repo es el de casillas de negocios
(`editable-si-vacio.ts`). Es un motor aparte, con spec propia
(`proyectos/metrik/one/2026-09-28_spec-motor-solo-lectura.md`) y **PR aparte ya autorizado**: solo
lectura en el Radar = ver todos los procesos sin poder filtrar, ordenar por fit, seguir ni editar el
perfil; por SERVICIO contratado, no por workspace; y el cliente conserva ver y exportar su
configuración. Ahí `suspenderAutomaticamente` pasa a `true`. Antes de escribirlo hay que medir quién
lee `servicios_contratados.estado='pausado'` y si `suscripciones.suspendida` la tratan todos como
solo lectura o alguno como bloqueo.

## How to apply — lo que no se deduce del código

- **El ancla es un MIN, nunca un MAX**: `respondido_at` de la aceptación MÁS VIEJA del negocio del
  contrato. Con un MAX, aceptar una versión nueva de los términos corre el trial hacia adelante y
  regala días. Lo prueban `enrolar-ciclo.test.ts` y `acceso-servidor.test.ts`.
- **La base hace cumplir el ancla**, no el código: CHECK
  `fin_trial = (ancla_at at time zone 'America/Bogota')::date + dias_trial` y
  `enrolar_cobro_por_ciclo` rechaza el calendario cuya cuota 1 no venza ese día exacto. El acta es
  inmutable por trigger: el trial no se estira por UPDATE. En PGlite, limpiar entre casos exige
  `alter table ... disable trigger`.
- **El plan nace `activo = false`.** `activo` es el interruptor del EMISOR de cuentas de cobro (paso
  4, desde el día 10 con `modules.cobros_recurrentes`, que `metrik` tiene); el paso 6 (el enlace) no
  lo mira. Un plan activo le emitiría a Fabri una cuenta de cobro que nadie pidió. Mismo arreglo que
  el plan de `cda-pruebas`.
- **Alcance: un solo módulo.** `MODULOS_CON_ENROLAMIENTO_AUTOMATICO = ['radar_secop']`. Agregar otro
  módulo por ciclo (Clarity, Sustenta, CDA) enrolaría contratos cuyos planes se cargan a mano y
  emitiría cobros no autorizados: es decisión de Mauricio, no una línea de código.
- **El precio sale del CONTRATO, no de la ficha**: sin `parametros.precio_mensual` no se enrola (no
  se cobra el de lista). `dias_trial` sí puede venir del `por_defecto` de la ficha, que es lo que
  significa un por_defecto.
- **El Radar se CIERRA, no pasa a solo lectura**, y el argumento está en la cabecera de
  `src/lib/radar/acceso.ts`: donde todo el valor es LEER, «solo lectura» no restringe nada. La regla
  D4 de Clarity/Valida no se tocó.
- **Fail-open al leer el pago, fail-closed en los términos.** «No pude leer las cuotas» no es «no
  pagó» (mismo criterio que `estadoMora` de Valida); «no pude leer la aceptación» sí es «no aceptó».
- **El contador del banner lo calcula el servidor** y la pantalla recibe el número, no la fecha: un
  reloj de navegador movido regalaría días. Los tramos «1 día → mañana termina» y «último día → hoy
  es el último» de la spec son EL MISMO día en este modelo (trial = días 1..5, día 6 = vencimiento):
  se dicen las dos cosas en un texto en vez de inventar un sexto día.

Relacionado: [[radar-secop-modulo]], [[project-enlace-pago-automatico]], [[idempotencia-cuentas-cobro]],
[[catalogo-servicios-a2]], [[suscripciones-cobro-automatico]], [[ensayo-sql-pglite]].
