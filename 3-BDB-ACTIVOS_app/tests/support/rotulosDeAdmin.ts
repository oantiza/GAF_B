/**
 * Lo que una prueba de pantalla comprueba de sus campos (MAR-10): todo control tiene un nombre que el lector de
 * pantalla oye, y todo error de campo está enlazado a un control por `aria-describedby`.
 */
const CONTROLES = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea";

/** El nombre de un control: su `aria-label`, lo que dice su `aria-labelledby`, un `<label for>` o la etiqueta que lo envuelve. */
export function nombreDelControl(control: Element): string {
  const etiquetaDirecta = control.getAttribute("aria-label");
  if (etiquetaDirecta) return etiquetaDirecta.trim();
  const apuntadores = control.getAttribute("aria-labelledby");
  if (apuntadores) {
    return apuntadores
      .split(" ")
      .map((id) => control.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  }
  if (control.id) {
    const rotulo = control.ownerDocument.querySelector(`label[for="${control.id}"]`);
    if (rotulo?.textContent?.trim()) return rotulo.textContent.trim();
  }
  return control.closest("label")?.textContent?.trim() ?? "";
}

/** Los controles de la zona que no tienen nombre. */
export function controlesSinNombre(zona: ParentNode): string[] {
  return [...zona.querySelectorAll(CONTROLES)].filter((c) => nombreDelControl(c) === "").map((c) => c.outerHTML.slice(0, 80));
}

/** Los rótulos `<label for>` que no apuntan a ningún control, y los errores de campo que ningún control describe. */
export function enlacesRotos(zona: ParentNode, documento: Document): string[] {
  const rotos: string[] = [];
  /* Un rótulo que no es `<label for>` es de los escritos a mano: lo nombra la etiqueta que envuelve, pero no la pieza Campo. */
  zona.querySelectorAll(".field__label:not(label)").forEach((rotulo) => rotos.push(`rótulo a mano: ${rotulo.textContent}`));
  zona.querySelectorAll("label.field__label[for]").forEach((rotulo) => {
    if (!documento.getElementById(rotulo.getAttribute("for")!)) rotos.push(`rótulo sin control: ${rotulo.textContent}`);
  });
  zona.querySelectorAll(".field__error").forEach((error) => {
    const loDescribe = [...zona.querySelectorAll("[aria-describedby]")].some((c) =>
      (c.getAttribute("aria-describedby") ?? "").split(" ").includes(error.id)
    );
    if (!error.id || !loDescribe) rotos.push(`error sin campo: ${error.textContent}`);
  });
  return rotos;
}
