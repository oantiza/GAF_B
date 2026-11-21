// Las clases que una pantalla escribe sin que ninguna hoja las defina, y por qué se admiten.
//
// La puerta inversa de `deadCssD3.mjs` falla si una pantalla usa una clase sin regla. Nació el
// 04-11-2026 porque una limpieza del día anterior borró un bloque entero de `modules.css` que
// seguía en uso —90 sitios sin estilo de nota— y el censo, que solo avisaba de lo que sobra, no
// se enteró. Esto no es una lista de cosas correctas: es lo que había ese día, mirado una a una
// y separado por motivo. **Esta lista solo baja.** Si añades una clase nueva, dale su regla, o
// usa una pieza; una entrada nueva aquí tiene que explicar por qué no necesita ninguna. La
// puerta falla también si una entrada ya no hace falta, para que se borre.
//
// La historia de cada nombre se ha mirado en Git, con `git log -G`, y es lo que dice el motivo.

// Nombran un bloque para quien lee el código: lo que pintan lo pintan sus hijos o la pieza.
const ENVOLTORIOS = {
  "admin-refresh-row": "contenedor de un botón de Sistema, nunca tuvo regla",
  "app-fallback": "mensaje de arranque de main.tsx, antes de que carguen las hojas",
  "backtest-comparison-layout": "columna de la simulación, nunca tuvo regla",
  "backtest-evolution-block": "bloque del gráfico; el estilo es de .backtest-block",
  "costs-retro-section": "pestaña del diálogo; el estilo es de .costs-tab-panel",
  "f5-risk-contribution": "panel; el estilo es de .f5-analytics-panel",
  "f5-stress": "panel; el estilo es de .f5-analytics-panel",
  "frontier-approximate-caption": "pie de gráfico, sin estilo propio desde que existe",
  "frontier-chart-col": "columna del gráfico, nunca tuvo regla",
  "frontier-historical-error": "panel que solo enseña un aviso, que ya trae su estilo",
  "frontier-panel": "panel, nunca tuvo regla",
  "geo-map-figure": "figura del mapa: su relleno era de cuando era una caja (04-11-2026)",
  "mercado-page": "raíz de pantalla; la disposición la pone .app-content",
  "portfolio-allocation": "panel, nunca tuvo regla",
  "strategy-view": "envoltorio de la vista elegida del informe de estrategia, y ancla de una prueba; sus dos reglas (con .pos y .neg) no las usaba nadie y se borraron el 14-11-2026",
  "portfolio-allocation-chart": "contenedor del gráfico, nunca tuvo regla",
  "portfolio-analysis-result": "contenedor; la caja que dibujaba se retiró en julio",
  "positions-search-field": "campo; la disposición la pone .stack",
  "positions-table-panel": "panel; lo citan las pruebas de Posiciones como selector",
  "region-allocation--side": "panel de la columna lateral, nunca tuvo regla",
  "ui-confirm-dialog": "diálogo; el estilo es de .ui-dialog",
  "xray-style-block": "bloque del gráfico de estilo, sin regla desde septiembre"
};

// La tabla lleva el estilo general de <table>: el nombre solo dice cuál es.
const TABLAS = {
  "asset-holdings-table": "general de <table>",
  "cmp-table": "general de <table>",
  "costs-retro-table": "general de <table>",
  "ops-campos-table": "general de <table>",
  "ops-plan-table": "general de <table>",
};

// Un elemento interior que no necesita más estilo que el que hereda.
const INTERIORES = {
  "account-security-status": "texto de estado; su color lo dan is-ok e is-pending",
  actual: "resaltado de una cifra que ya va en <strong>",
  "cmp-legend-name": "texto de la leyenda, hereda de .cmp-legend",
  "cmp-period": "botón del selector; el estilo es de .ui-segmented__button",
  "f5-risk-bar-risk": "barra; el estilo es de .f5-risk-bar",
  "geo-map-area": "región del mapa; lo que se ve se pinta en línea",
  "is-neutral": "estado sin color propio: hereda, y por eso no hay regla",
  "loading-note": "mensaje de carga; el estilo es de .ui-async-state",
  "oaa-donut-frame--centered": "modificador sin regla, nunca la tuvo",
  "portfolio-diagnostic-detail": "bloque de texto del diagnóstico, hereda",
  "topbar-switch__label": "texto del interruptor de la barra, hereda"
};

// DEUDA. Perdieron la regla en una limpieza y SÍ se nota. No son correctos: están aquí porque
// arreglarlos es de la pantalla que los usa, y al arreglarlos se borran de esta lista.
const DEUDA = {
  // 0abcec9 (03-11-2026) borró «Contenedores de tabla»: estos envoltorios ya no se desplazan,
  // y una tabla más ancha que la columna puede empujar la página.
  "asset-holdings-table-wrapper": "0abcec9: sin overflow-x",
  "cmp-table-wrap": "0abcec9: sin overflow-x",
  // La misma limpieza les quitó la letra de código: ISIN y notas salen en texto normal.
  "system-data-missing": "0abcec9: sin la letra de código",
  // Y a estos, el aspecto de distintivo.
  "quality-chip": "0abcec9: sin aspecto de distintivo",
  // ff0f058 (03-11-2026), la limpieza de las notas. Lo que el lote de las notas no devolvió
  // porque no hace falta o no es suyo.
  "asset-detail-stars": "ff0f058: las estrellas de la ficha anterior salen sin color",
  "cmp-th-left": "ff0f058: era el alineado por defecto, no se nota"
};

export const CLASES_SIN_REGLA_PERMITIDAS = {
  ...ENVOLTORIOS,
  ...TABLAS,
  ...INTERIORES,
  ...DEUDA
};
