---
name: valida-cobro-correos-prueba
description: VALIDA_COBRO_CORREOS_PRUEBA abre en producción las Condiciones con cobro (v2.1 + aviso v1.5 + tarjeta ePayco) solo al correo de la SESIÓN listado; interruptor global sigue en false. PR #1222 contra main (reemplaza #1220, cerrado al borrarse la base de #1191); gate de Vera antes del merge.
metadata:
  type: project
---

Mauricio aprobó el 2026-10-20 una lista de correos de prueba para el cobro con tarjeta en producción
(pruebas internas con empresas ficticias MéTRIK, AFI, DIMPRO). `CLAUSULA_COBRO_APROBADA_PARA_PRODUCCION`
sigue en `false`.

**Why:** probar el cobro real de ePayco en producción sin abrir la cláusula de cobro a clientes reales.

**How to apply:**
- La decisión vive en `correoEnListaDePruebaCobro` / `cobroAprobadoEnProduccionPara` (condiciones-cobro.ts)
  y entra por el 3er parámetro de `condicionesVigentes(env, terminosListos, correoDeSesion)`. Sin correo
  = v1.0 en producción (falla cerrado). Solo la página `/valida/empezar` y `crearEspacioValida` leen el
  interruptor; ambas pasan el correo de `getCachedUser()`.
- Lo de después del registro (aviso 48 h, cobro del día 7, activación, cancelación) NO mira la lista: sigue
  lo aceptado en el registro (`metodo_pago_estado`, `condiciones_version`, `cobro_estado`, `cobro_entorno`).
  Sacar a alguien de la lista no detiene su cobro: tiene que tocar «Cancelar prueba».
- Un registro de prueba en producción se cobra DE VERDAD el día 7 ($150.000) si EPAYCO_PRODUCCION está.
- Entradas: correo exacto o `@dominio` (igualdad exacta del dominio, sin subdominios). Vacía = nadie.
- La pantalla hace `router.refresh()` tras el código OTP: la página se renderiza antes del login.

Relacionado: [[suscripciones-multiproducto]], [[valida-alta-autogestionada]].
