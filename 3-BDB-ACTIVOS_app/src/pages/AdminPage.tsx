import { AdminRetrocessions } from "../components/AdminRetrocessions";
import { EstadoDelCatalogoPanel } from "../components/EstadoDelCatalogoPanel";
import { usePestanaEnLaDireccion } from "../core/usePestanaEnLaDireccion";
import { PageHeader } from "../components/ui/PageHeader";
import { PanelDePestana, SegmentedTabs } from "../components/ui/SegmentedTabs";

/* Sistema lee la base nueva y nada más (Óscar, 04-11-2026, para la web publicada; desde el 21-11-2026 también en
   local). Las siete pestañas de la base vieja —BBDD maestra, Calidad de fondos, Históricos, Inspección, Ingesta,
   Operaciones y Referencia técnica— y el semáforo de integridad se borraron el 21-11-2026 (decisiones 30 a 39 del
   censo `CENSO_BASE_VIEJA_2026-11-21.md`); su código queda en la etiqueta `referencia-base-vieja-2026-11-21`. */
const SECCIONES = [
  { id: "sistema", label: "Estado del sistema" },
  { id: "retrocesiones", label: "Retrocesiones" }
] as const;

type AdminSection = (typeof SECCIONES)[number]["id"];

const IDS_DE_SECCION: readonly AdminSection[] = SECCIONES.map((seccion) => seccion.id);

export function AdminPage() {
  /* Las pestañas van en la dirección (`/sistema#pestana=retrocesiones`): se puede recargar, compartir y volver con
     «Atrás». */
  const [section, setSection] = usePestanaEnLaDireccion<AdminSection>(IDS_DE_SECCION, "sistema");

  return (
    <section className="admin-page">
      <PageHeader
        className="admin-page-head"
        description="Cómo está el catálogo, qué fondos hay que revisar y las retrocesiones."
        eyebrow="Datos · solo administración"
        title="Sistema"
      />

      <SegmentedTabs
        idPrefix="admin"
        label="Áreas de administración"
        onChange={setSection}
        tabs={SECCIONES}
        value={section}
      />

      <PanelDePestana className="admin-tab-panel" idPrefix="admin" pestana={section}>
        {section === "sistema" ? <EstadoDelCatalogoPanel /> : <AdminRetrocessions />}
      </PanelDePestana>
    </section>
  );
}
