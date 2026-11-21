/**
 * Las marcas del eje de edades, de cinco en cinco (70, 75, 80…), más la primera y la última edad cuando no quedan a
 * menos de dos años de una de ellas. Las que elegía la librería iban de dos en dos y se saltaban alguna junto al final
 * («…89, 91, 94»): un eje de paso irregular despista al leer la edad de una barra.
 */
export function marcasDeEdad(edades: readonly number[]): number[] {
  if (edades.length === 0) return [];
  const primera = edades[0];
  const ultima = edades[edades.length - 1];
  const marcas: number[] = [];
  for (let edad = Math.ceil(primera / 5) * 5; edad <= ultima; edad += 5) marcas.push(edad);
  if (marcas.length === 0 || marcas[0] - primera >= 2) marcas.unshift(primera);
  if (ultima - marcas[marcas.length - 1] >= 2) marcas.push(ultima);
  return marcas;
}
