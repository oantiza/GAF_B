# Incidencias pendientes

*Regla 7 de `COORDINACION_SESIONES.md`: lo que una sesión encuentra roto fuera de su territorio se anota aquí, una línea con fecha, repositorio, fichero y qué pasa, y lo arregla su dueño.*

- ~~**07-11 · `3-BDB-ACTIVOS_app` · `tests/internalPortfolioReport.test.ts`:**~~ **Resuelta el 07-11 (`cb05ed2`):** reloj fijo en la prueba (viernes 06-11); `demoBackend.ts` sigue generando desde `new Date()`, así que otra prueba que lo use sin reloj fijo volvería a depender del día. Texto original: 7 pruebas fallan en fin de semana. `src/adapters/demoBackend.ts` genera las series sintéticas desde `new Date()` (`isoDay`, `demoSeriesDates`) y salta sábados y domingos, así que «hoy» no tiene punto y el bloque relativo del informe interno sale `null`. Pasaron el jueves 06-11 (`699ec16`) y fallan el sábado 07-11 sin ningún cambio en esos ficheros; la sesión «tira-alfa» lo encontró y no lo tocó. Arreglo: reloj fijo en la prueba (`vi.setSystemTime`) o fecha de referencia inyectable en el demo. Hasta entonces, `npm test` de la app no está en verde los fines de semana. **Cierre 09-11 (`ff7ba23`):** `demoBackend.ts` toma la fecha de un reloj inyectable (`setDemoClock`, por defecto «ahora») y `tests/setupRelojDemo.ts` lo fija a un viernes en toda la suite; comprobado con sábado y domingo (9 suites que usan el demo, 76/76).

## 08-11-2026 · Moderna (`US60770K1079`) sin métricas: salto de +177 % el 19-08-2026

**Qué pasa.** Al entrar en el universo (decisión 38), la serie de EODHD da una rentabilidad de +981 % a un año con
un salto de +177 % el 19-08-2026. El contrato de métricas la bloquea y la ficha dice la ausencia. La sesión de
ampliación atribuye el salto a la publicación de los resultados de fase 3 de la vacuna contra el melanoma con Merck,
sin contrasplit ni otra operación societaria.

**Decisión 42 (Óscar).** Se queda sin métricas con la ausencia dicha. Pendiente: contrastar la serie con otra fuente;
si confirma el salto, lo que hay que revisar es la regla del contrato que lo bloquea (un salto real de un valor
cotizado no es un dato inválido), no el dato. Si no lo confirma, es un error de fuente y se trata como tal.

**Estado:** abierta.

## 08-11-2026 · Un re-mapeo entero sin red no es neutro (corregida el 09-11: no pierde FIRDS, 27 fondos lo ganan)

**Qué se creyó el 08-11.** La sesión de la séptima subida corrió `update --all --sin-red --sin-caducidad --sin-historico`
sobre los 1.316 instrumentos y anotó que 27 fichas perdían campos de FIRDS. Devolvió las 1.305 fichas que no ganaban bloque
del emisor, así que ni la base ni la nube llevaron nada de aquello.

**Qué se midió el 09-11** (`INFORME_REMAPEO_SIN_RED_2026-11-09.md`, sobre copia, canónico intacto por hash). **La dirección
estaba al revés:** ninguna ficha pierde ningún campo de FIRDS, y 27 fondos los **ganan**, porque su último plan guardado
(05-11) no incluía aún el adaptador de FIRDS. FIRDS no depende de la red: se lee de `cache/firds/firds.sqlite`, y `--sin-red`
solo gobierna las peticiones HTTP. `refrescar.mjs` no corre ninguna pasada sin red. Las 27 entrarán solas en la próxima
pasada con red.

**Lo que sí es cierto del «no neutro»:** un re-mapeo sin red envejece el valor liquidativo frente a la fecha de pasada
(`_dias_vl`) y 8 fondos caerían de ALTO a BAJO con el `score` igual; 198 acciones más llevan `dato_retenido` porque sin red
no se pregunta a Yahoo; 4 acciones italianas pierden un `score` inflado por una cadena vacía. Nada de eso llegó a la base.

**El riesgo real, comprobado en copia.** Si falta el índice FIRDS, o un ISIN sale de él, `esma_firds.fetch` devuelve vacío
y la ficha se escribe sin identidad, sin error, sin aviso y sin que la guarda de calidad pare nada: 3 de 3 fichas la
perdieron. Hoy no le pasa a ninguna. Vías posibles: un `update` en un equipo sin `cache/` (no va al repositorio),
`--sin-firds` sin índice, o un ISIN que deje de estar en el índice.

**Qué hacer.** Opciones del informe: B, que `update` se pare si faltan el índice y hay fichas con `firds_visto`, salvo bandera
explícita (unas 10 líneas y una prueba); C, retener FIRDS con aviso y caducidad cuando el índice no lo sirva (unas 40 líneas
y decidir el plazo); D, distinguir «falta el índice» de «falta el ISIN». La directora recomienda B ahora y C cuando se toque
la retención. Pendiente de Óscar.

**Estado:** abierta, con la causa medida y la dirección corregida.
