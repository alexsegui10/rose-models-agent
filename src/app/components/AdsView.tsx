import type { Candidate } from "@/domain/candidate";
import { computeAdPerformance, totalsOf } from "@/application/adPerformance";

/**
 * Pestaña "Anuncios": embudo de CALIDAD por creatividad, sobre datos que el CRM ya tiene cargados (la
 * atribución adId/adTitle se persiste desde el 11-jul). Componente AISLADO (patrón "toda vista nueva nace
 * como componente"): no toca el resto de page.tsx. Toda la lógica vive en application/adPerformance.ts (puro,
 * testeado); aquí solo se pinta.
 */

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

const th: React.CSSProperties = {
  textAlign: "right",
  padding: "8px 10px",
  fontSize: 11,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: "var(--muted)",
  fontWeight: 600,
  whiteSpace: "nowrap",
  borderBottom: "1px solid var(--border, rgba(128,128,128,0.25))"
};

const td: React.CSSProperties = {
  textAlign: "right",
  padding: "9px 10px",
  fontVariantNumeric: "tabular-nums",
  color: "var(--text)",
  borderBottom: "1px solid var(--border, rgba(128,128,128,0.14))",
  whiteSpace: "nowrap"
};

export function AdsView({ candidates }: { candidates: readonly Candidate[] }) {
  const rows = computeAdPerformance(candidates);
  const totals = totalsOf(rows);
  const fromAds = rows.filter((r) => !r.isOrganic).length;

  return (
    <section style={{ padding: "18px 16px", maxWidth: 980, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 20, color: "var(--text)" }}>Anuncios</h2>
      <p style={{ margin: "0 0 16px", fontSize: 13.5, color: "var(--text-dim)", maxWidth: "62ch" }}>
        Qué anuncio trae candidatas de <strong>calidad</strong>, no solo volumen. Lo que importa es la tasa de{" "}
        <strong>aptas</strong> (las que apruebas) y de <strong>llamadas</strong>, no cuántas escriben. Sobre los datos que ya
        tiene el CRM; para el <em>coste por apta</em> falta meter el gasto de Meta (pendiente).
      </p>

      {rows.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
          📊 Aún no hay candidatas para medir. Cuando lleguen leads de los anuncios, aparecerán aquí.
        </div>
      ) : (
        <div style={{ overflowX: "auto", borderRadius: 10, background: "var(--panel)", boxShadow: "var(--card-shadow)" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720, fontSize: 13.5 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Anuncio</th>
                <th style={th}>Leads</th>
                <th style={th}>Respond.</th>
                <th style={th}>Aptas</th>
                <th style={{ ...th, color: "var(--info)" }}>Tasa apta</th>
                <th style={th}>Llamadas</th>
                <th style={th}>Descart.</th>
                <th style={th}>% medio</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.adId}>
                  <td
                    style={{
                      ...td,
                      textAlign: "left",
                      color: r.isOrganic ? "var(--muted)" : "var(--text)",
                      fontStyle: r.isOrganic ? "italic" : "normal",
                      maxWidth: 240,
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    }}
                    title={r.label}
                  >
                    {r.label}
                  </td>
                  <td style={td}>{r.leads}</td>
                  <td style={td}>{r.responded}</td>
                  <td style={{ ...td, color: "var(--success)", fontWeight: 600 }}>{r.aptas}</td>
                  <td style={{ ...td, color: "var(--info)", fontWeight: 600 }}>{r.leads > 0 ? pct(r.aptaRate) : "—"}</td>
                  <td style={td}>{r.callsCompleted}</td>
                  <td style={{ ...td, color: r.discarded > 0 ? "var(--danger)" : "var(--muted)" }}>{r.discarded}</td>
                  <td style={td}>{r.avgNegotiatedShare != null ? `${r.avgNegotiatedShare}%` : "—"}</td>
                </tr>
              ))}
              <tr>
                <td style={{ ...td, textAlign: "left", fontWeight: 700, color: "var(--text)" }}>Total</td>
                <td style={{ ...td, fontWeight: 700 }}>{totals.leads}</td>
                <td style={{ ...td, fontWeight: 700 }}>{totals.responded}</td>
                <td style={{ ...td, fontWeight: 700, color: "var(--success)" }}>{totals.aptas}</td>
                <td style={{ ...td, fontWeight: 700, color: "var(--info)" }}>
                  {totals.leads > 0 ? pct(totals.aptas / totals.leads) : "—"}
                </td>
                <td style={{ ...td, fontWeight: 700 }}>{totals.callsCompleted}</td>
                <td style={{ ...td, fontWeight: 700 }}>{totals.discarded}</td>
                <td style={td} />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p style={{ margin: "12px 2px 0", fontSize: 12, color: "var(--muted)" }}>
        {fromAds > 0
          ? `${fromAds} anuncio${fromAds === 1 ? "" : "s"} con candidatas atribuidas + orgánico.`
          : "Todavía sin candidatas atribuidas a un anuncio (o llegaron antes de la atribución por ad)."}
      </p>
    </section>
  );
}
