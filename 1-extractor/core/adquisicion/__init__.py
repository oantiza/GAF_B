"""Núcleo de adquisición: adaptadores con capacidades declaradas, procedencia
por campo, planificador por familias de dato y fusión con frescura.

Nace del descubrimiento del 04-09: una sola fuente (Morningstar, API interna y
no licenciada) aportaba el 99,1 % de los campos por el mismo grifo frágil, con
un único TTL de 7 días y sin saber, campo a campo, quién había escrito qué.
Este paquete separa las piezas:

- `procedencia`: quién escribió cada campo y cuándo se descargó.
- `adaptador`: qué sabe dar cada proveedor (capacidades) y a qué familia
  pertenece cada dato, para responder «si cae X, ¿qué me queda?».
- `registro`: los adaptadores disponibles.
- `planificador`: qué adaptadores tocan a un activo y qué familias refrescar.
- `nucleo`: la ejecución (una sola vía para CLI, interfaz web y cualquier
  otro cliente).
- `retencion`: lo que la fuente deja de traer se conserva de la ficha
  anterior con reglas por familia y procedencia `retenido:` (14-10-2026).
"""
