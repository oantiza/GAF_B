// Quién elabora el informe de cliente: editable desde la pantalla del informe.
//
// INF-01 (13-11-2026): ningún nombre de persona escrito en el código. Antes el
// valor por defecto era el de una persona real, y el asesor que no tocaba el
// campo entregaba documentos firmados por otro. El responsable por defecto lo
// propone la pantalla con el nombre de la cuenta de la sesión
// (`responsableDeLaCuenta`, en identidadDelInforme); aquí, sin nombre, no firma
// nadie.

export interface ReportBanker {
  name: string;
  email: string;
}

/** Sin nadie: ningún documento sale firmado por quien no lo ha escrito. */
export const DEFAULT_BANKER: ReportBanker = {
  name: "",
  email: ""
};

/**
 * Normaliza lo que venga de los campos del formulario: recorta espacios. Un nombre
 * vacío, o ningún nombre (campo ausente), deja la portada sin firma.
 */
export function resolveBanker(banker?: Partial<ReportBanker> | null): ReportBanker {
  return {
    name: banker?.name === undefined || banker.name === null ? DEFAULT_BANKER.name : banker.name.trim(),
    email: banker?.email?.trim() ?? ""
  };
}
