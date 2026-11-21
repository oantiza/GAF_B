// Copiado de scratchpad/informe1016/review5_fe/probe (cases35.ts) para la batería de
// aceptación de la sexta pasada (las 239 sondas con el juez estricto).
// Los 35 extractos de las sondas de la tercera pasada (probe.ts a probe5.ts de la revisión 2 y el fixture Andbank).
export const c: Record<string, string> = {};
c.E1 = `<table>
<tr><td colspan="6">Posiciones a 15/10/2026 - Cartera de prueba</td></tr>
<tr><th>Producto</th><th>Código ISIN</th><th>Títulos</th><th>Liquidativo</th><th>Valor de mercado</th><th>Contravalor EUR</th></tr>
<tr></tr>
<tr><td colspan="6">Fondos de inversión</td></tr>
<tr><td>Fondo Uno</td><td>LU1234567891</td><td>100</td><td>800,00</td><td>80.000,00</td><td>80.000,00</td></tr>
<tr><td colspan="4">Total fondos</td><td></td><td>80.000,00</td></tr>
<tr><td colspan="6">ETF</td></tr>
<tr><td>ETF Dos USD</td><td>IE0098765432</td><td>50</td><td>174,72</td><td>8.736,00</td><td>7.512,09</td></tr>
<tr><td>TOTAL</td><td></td><td></td><td></td><td></td><td>87.512,09</td></tr>
</table>`;
c.E2 = "Nombre;ISIN;Liquidativo;Valor;Importe\nA;LU1234567891;12,34;99;80000\nB;IE0098765432;5,67;99;120000";
c.E2b = "ISIN;Valor;Valor liquidativo\nLU1234567891;80000;12,34\nIE0098765432;120000;5,67";
c.E2c = "Cartera;Prueba;;\nProducto;ISIN;Importe;Liquidativo\n;;;\nA;LU1234567891;80000;12,34\nB;IE0098765432;120000;5,67";
c.E3 = [
  "Extracto de posiciones;;;;",
  "Producto;ISIN;Títulos;Valoración;",
  ";;;Valor de mercado;Contravalor EUR",
  "Renta variable;;;;",
  "ETF Dos USD;IE0098765432;50;8736;7512,09",
  "Fondos;;;;",
  "Fondo Uno;LU1234567891;100;80000;80000",
  "TOTAL;;;;87512,09"
].join("\n");
c.E4 = `<table>
<tr><th rowspan="2">Producto</th><th rowspan="2">ISIN</th><th rowspan="2">Títulos</th><th colspan="2">Valoración</th></tr>
<tr><th>Valor de mercado</th><th>Contravalor EUR</th></tr>
<tr><td>ETF Dos USD</td><td>IE0098765432</td><td>50</td><td>8.736,00</td><td>7.512,09</td></tr>
<tr><td>Fondo Uno</td><td>LU1234567891</td><td>100</td><td>80.000,00</td><td>80.000,00</td></tr>
</table>`;
c.E4b = c.E4.replace('<th rowspan="2">ISIN</th>', '<th rowspan="2">Código ISIN</th>');
c.E5 = "Detalle de posiciones por ISIN;;\nProducto;ISIN;Valor de mercado\nA;LU1234567891;80000\nB;IE0098765432;120000";
c.E5b = `<table>
<tr><td colspan="3">Posiciones valoradas (ISIN y contravalor)</td></tr>
<tr><th>Producto</th><th>ISIN</th><th>Valor de mercado</th></tr>
<tr><td>A</td><td>LU1234567891</td><td>80.000,00</td></tr>
<tr><td>B</td><td>IE0098765432</td><td>120.000,00</td></tr>
</table>`;
c.E6 = `<table>
<tr><td>Valor de mercado total</td><td>200.000,00</td></tr>
<tr><td>Fecha</td><td>15/10/2026</td></tr>
<tr><th>Producto</th><th>Código</th><th>Títulos</th><th>Saldo</th></tr>
<tr><td>A 2030</td><td>LU1234567891</td><td>100</td><td>80.000,00</td></tr>
<tr><td>B</td><td>IE0098765432</td><td>50</td><td>120.000,00</td></tr>
</table>`;
c.E7 = "Activo;Importe\nLU1234567891;1000\nAAPL;500\nFUND-1;250";
c.E7b = "ISIN;Importe\nLU1234567891;1000\nAAPL;500\nFUND-1;250";
c.E8 = "Producto;ISIN;Títulos;Saldo\nFondo A;LU1234567891;100;80000\nFondo B;IE0098765432;50;120000";
c.E9 = `<table>
<tr><th>Producto</th><th>ISIN</th><th>Cuenta</th><th>Contravalor EUR</th></tr>
<tr><td rowspan="2">Fondo Uno</td><td>LU1234567891</td><td>C1</td><td>50.000,00</td></tr>
<tr><td>LU1234567891</td><td>C2</td><td>30.000,00</td></tr>
<tr><td>B</td><td>IE0098765432</td><td>C1</td><td>120.000,00</td></tr>
</table>`;
c.E10 = "Producto;ISIN;Divisa;Valor de mercado;Contravalor en EUR\nA;LU1234567891;EUR;80000;\nB;IE0098765432;USD;8736;7512,09";
c.E11 = `<table>
<tr><th>Producto</th><th>ISIN</th><th>Títulos</th><th>Valor de mercado</th></tr>
<tr><td>Renta variable</td><td>Importe total</td><td></td><td>200.000,00</td></tr>
<tr><td>A</td><td>LU1234567891</td><td>100</td><td>80.000,00</td></tr>
<tr><td>B</td><td>IE0098765432</td><td>50</td><td>120.000,00</td></tr>
</table>`;
c.E12 = "LU1234567891;80000\nAAPL 500\nFUND-1,250";
c.E13 = ["Producto;ISIN;Valor de mercado", "A;LU1234567891;80000", "Producto;ISIN;Valor de mercado", "B;IE0098765432;120000"].join("\n");
c.E14 = "Producto;ISIN;Importe EUR;Contravalor\nA;LU1234567891;80000;1\nB;IE0098765432;120000;1";
c.F1 = "Producto;ISIN;Títulos;Valor de mercado;Importe cupón corrido EUR\nBono A;XS1234567891;100;80000;350\nBono B;XS0098765432;50;120000;910";
c.F1b = "Producto;ISIN;Div;Valor de mercado;Importe dividendos (€)\nA;LU1234567891;EUR;80000;1200\nB;IE0098765432;EUR;120000;40";
c.F1c = "Producto;ISIN;Valor de mercado;Importe comisiones EUR\nA;LU1234567891;80000;12\nB;IE0098765432;120000;30";
c.F2 = `<table>
<tr><td>Posiciones a 15/10/2026</td></tr>
<tr><th>Producto</th><th>Código</th><th>Títulos</th><th>Saldo</th></tr>
<tr><td>Fondo 2030</td><td>LU1234567891</td><td>100</td><td>80.000,00</td></tr>
<tr><td>Fondo B</td><td>IE0098765432</td><td>50</td><td>120.000,00</td></tr>
</table>`;
c.F3 = [
  "ISIN/ID;Nombre;Estado;Retro %;Coeficiente cesión;Cesión %;Importe EUR;Peso %;Ingreso estimado EUR;Coste corriente %;Coste anual EUR",
  "LU1234567891;Fondo A;Encontrado;0,5;0,5;0,25;80000;64;200;1,2;960",
  "PRIVADO-1;Vehículo privado;No encontrado;;0,5;;45000;36;;;"
].join("\n");
c.F4 = `<table>
<tr><th rowspan="2">Producto</th><th rowspan="2">ISIN</th><th rowspan="2">Títulos</th><th colspan="2">Valoración</th></tr>
<tr><th>Valor de mercado</th><th>Contravalor EUR</th></tr>
<tr><td>ETF Mundo</td><td>IE00B4L5Y983</td><td>50</td><td>8.736,00</td><td>7.512,09</td></tr>
<tr><td>Fondo Uno</td><td>LU1234567891</td><td>100</td><td>80.000,00</td><td>80.000,00</td></tr>
</table>`;
c.F5 = "Producto;ISIN;Valor de mercado\n;;EUR\nA;LU1234567891;80000\nB;IE0098765432;120000";
c.F6 = `<table>
<tr><th>Divisa</th><th>Importe EUR</th></tr>
<tr><td>EUR</td><td>200.000,00</td></tr>
</table>
<table>
<tr><th>Producto</th><th>Código</th><th>Saldo</th></tr>
<tr><td>A</td><td>LU1234567891</td><td>80.000,00</td></tr>
<tr><td>B</td><td>IE0098765432</td><td>120.000,00</td></tr>
</table>`;
c.F7 = "producto;isin;importe\nA;lu1234567891;80000\nB;ie0098765432;120000";
c.F8 = "Filtro ISIN: todos;;\nProducto;Código;Valor de mercado\nA;LU1234567891;80000\nB;IE0098765432;120000";
c.P3a = "Producto;ISIN;Precio contravalor EUR;Valor de mercado\nA;LU1234567891;12,34;80000\nB;IE0098765432;5,67;120000";
c.P3b = "Producto;ISIN;Valor de mercado;Importe efectivo EUR\nA;LU1234567891;80000;80000\nB;IE0098765432;8736;7512,09";
c.P3c = "Producto;ISIN;Divisa;Valor de mercado EUR\nA;LU1234567891;EUR;80000\nB;IE0098765432;USD;7512,09";
c.P4 = `<table>
<tr><th>Producto</th><th>Código ISIN</th><th>Valor de mercado</th><th>Divisa</th></tr>
<tr><td colspan="4">Fondos de inversión</td></tr>
<tr><td>Fund A</td><td>LU1234567891</td><td>80.000,00</td><td>EUR</td></tr>
<tr><td>Fund B</td><td>IE0098765432</td><td>120.000,00</td><td>EUR</td></tr>
</table>`;
c.P5 = `<table>
<tr><td colspan="3">Filtro ISIN: todos</td></tr>
<tr><th>Producto</th><th>Código</th><th>Valor de mercado</th></tr>
<tr><td>A</td><td>LU1234567891</td><td>80.000,00</td></tr>
<tr><td>B</td><td>IE0098765432</td><td>120.000,00</td></tr>
</table>`;
c.ANDBANK = [
  "Producto;ISIN;Mercado;Div;Tipo saldo;Títulos;Coste medio;Precio de mercado;Fecha;Fecha;Coste Adquisicion;Valor de mercado;Plus Minus;Contravalor en EUR",
  "JPM EUR EQ PLUS;LU0289214628;FEX;EUR;CONTADO;2467,605;30,7215;32,46;26/06/2026;26/06/2026;75808,41;80000;4290,05;80000",
  "RENTA FIJA FLEXIBLE;LU2222028099;FEX;EUR;CONTADO;1363,056;117,6;119,7;25/06/2026;25/06/2026;160299,87;120000;2855,21;120000",
  "TOTAL CARTERA;;;;;;;;;;;200000;;200000"
].join("\n");
