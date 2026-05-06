import { useState, useRef, useCallback } from "react";

const SYSTEM_PROMPT = `You are an institutional-level mutual fund analyst. Given a mutual fund factsheet image, extract and analyze ALL data, then respond ONLY with a valid JSON object (no markdown, no backticks, no preamble). If certain data is not available, use null.

CRITICAL AUM RULE: Always convert AUM to Indian Crores (₹ Cr). If the factsheet shows AUM in millions (e.g. "9381.03 INR mil" or "₹ 9381.03 million"), divide by 10 to get crores. If shown as "₹ 9381.03 crores" already, keep as-is. Output as plain number string in crores e.g. "9381". Same for AAuM.

JSON structure:
{
  "fund_name": "string",
  "benchmark": "string",
  "allotment_date": "string",
  "aum": "string - numeric value IN CRORES only",
  "aaum": "string - numeric value IN CRORES only",
  "nav_direct": "string",
  "nav_regular": "string",
  "holdings_count": "string",
  "expense_direct": "string",
  "expense_regular": "string",
  "turnover": "string",
  "factsheet_date": "string",
  "fund_category": "string",
  "risk_level": "string",
  "managers": [
    {
      "name": "string",
      "role": "string",
      "experience_years": "string",
      "tenure": "string",
      "education": "string or null",
      "career_path": "string - reconstruct from available info",
      "investment_style": "string - classify as Value/Growth/Quality/GARP/Blend based on portfolio evidence",
      "sector_bias": "string"
    }
  ],
  "performance": [
    { "period": "string", "fund": "string", "benchmark": "string", "alpha": "string" }
  ],
  "risk_metrics": {
    "sharpe": "string or null",
    "beta": "string or null",
    "std_dev": "string or null",
    "alpha": "string or null"
  },
  "market_cap": { "large": "string", "mid": "string", "small": "string" },
  "pe_ratio": "string or null",
  "pb_ratio": "string or null",
  "top_holdings": [
    { "name": "string", "weight": "string", "classification": "string - Growth/Quality/Value/Turnaround/New-age" }
  ],
  "sector_allocation": [
    { "sector": "string", "weight": "string" }
  ],
  "portfolio_analysis": {
    "strategy_type": "string",
    "strategy_evidence": "string - 2-3 sentences",
    "hidden_bets": [ { "name": "string", "weight": "string", "note": "string" } ],
    "turnover_interpretation": "string"
  },
  "edge": {
    "differentiators": [ { "title": "string", "description": "string" } ],
    "regime_matrix": [ { "regime": "string", "expected": "Outperform/Moderate/Underperform", "reason": "string" } ],
    "replicability": "string"
  },
  "verdict": {
    "one_liner": "string - sharp, no-BS single sentence summary",
    "ideal_investor": "string",
    "biggest_risk": "string",
    "quarterly_trackers": [ { "item": "string", "detail": "string" } ]
  }
}`;

const C = {
  bg: "#0a0c10", card: "#111318", bdr: "rgba(255,255,255,0.06)",
  t: "#c9cdd3", tb: "#e8eaed", td: "#6b7280", tm: "#4b5563",
  bl: "#3b82f6", gr: "#10b981", pu: "#8b5cf6", am: "#f59e0b",
  rd: "#ef4444", cy: "#06b6d4", pk: "#ec4899", ind: "#6366f1",
};

const TC = { Growth: C.gr, Quality: C.bl, Value: C.am, Turnaround: C.rd, "New-age": C.pu, Leader: C.bl, Warrior: C.pu, Star: C.gr, "Frog Prince": C.rd, GARP: C.cy, Blend: C.ind };
const gtc = (cls) => { if (!cls) return C.bl; for (const [k, v] of Object.entries(TC)) { if (cls.toLowerCase().includes(k.toLowerCase())) return v; } return C.bl; };
const SC = [C.bl, C.gr, C.pu, C.am, C.rd, C.cy, C.pk, C.ind];

function fmtAUM(raw) {
  if (!raw) return "—";
  const s = String(raw).replace(/[₹,\s]/g, "").replace(/cr(ores?)?$/i, "").trim();
  let n = parseFloat(s);
  if (isNaN(n)) {
    const m = String(raw).match(/([\d,.]+)\s*(INR\s*)?mil/i);
    if (m) n = parseFloat(m[1].replace(/,/g, "")) / 10; else return String(raw);
  }
  if (/mil/i.test(String(raw))) n = n / 10;
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
}

const Tag = ({ children, color = C.bl }) => (
  <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: `${color}18`, color, border: `1px solid ${color}30`, marginLeft: 6 }}>{children}</span>
);

const Card = ({ title, children, accent }) => (
  <div style={{ background: C.card, borderRadius: 10, padding: 20, border: `1px solid ${C.bdr}`, borderTop: accent ? `2px solid ${accent}` : undefined, marginBottom: 14 }}>
    {title && <h3 style={{ fontSize: 13, fontWeight: 700, color: C.tb, letterSpacing: "0.3px", marginBottom: 14, textTransform: "uppercase" }}>{title}</h3>}
    {children}
  </div>
);

const Bar = ({ label, value, max = 15, color = C.bl }) => {
  const nv = parseFloat(value) || 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 12, color: C.t }}>{label}</span>
        <span style={{ fontSize: 12, color: C.td, fontFamily: "'JetBrains Mono', monospace" }}>{value}%</span>
      </div>
      <div style={{ height: 5, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min((nv / max) * 100, 100)}%`, background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
};

const tabs = [
  { id: "overview", label: "Overview" }, { id: "managers", label: "Fund Managers" },
  { id: "portfolio", label: "Portfolio" }, { id: "edge", label: "Edge" }, { id: "verdict", label: "Verdict" },
];

function UploadScreen({ onAnalyze, loading, progress, progressMsg }) {
  const fr = useRef(null);
  const [files, setFiles] = useState([]);
  const [drag, setDrag] = useState(false);
  const add = (fl) => { const a = Array.from(fl).filter(f => f.type.startsWith("image/") || f.type === "application/pdf"); if (a.length) setFiles(p => [...p, ...a]); };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: 3, background: C.gr }} />
          <span style={{ fontSize: 11, color: C.td, letterSpacing: "1px", textTransform: "uppercase" }}>Mutual Fund Forensics</span>
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: C.tb, margin: "0 0 6px", fontFamily: "'DM Sans', sans-serif" }}>Fund Factsheet Analyzer</h1>
        <p style={{ fontSize: 14, color: C.td, margin: "0 0 28px" }}>Upload a factsheet to generate an institutional-grade forensic analysis</p>

        <div onClick={() => !loading && fr.current?.click()} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
          style={{ border: `2px dashed ${drag ? C.bl : "rgba(255,255,255,0.1)"}`, borderRadius: 12, padding: "40px 24px", cursor: loading ? "default" : "pointer", background: drag ? "rgba(59,130,246,0.04)" : "rgba(255,255,255,0.02)", transition: "all 0.2s", marginBottom: 16 }}>
          <input ref={fr} type="file" accept="image/*,.pdf" multiple hidden onChange={e => add(e.target.files)} />
          <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 14, color: C.t, marginBottom: 4 }}>Drop factsheet images here or click to browse</div>
          <div style={{ fontSize: 12, color: C.tm }}>Supports PNG, JPG, PDF — upload all pages</div>
        </div>

        {files.length > 0 && (
          <div style={{ marginBottom: 16, textAlign: "left" }}>
            {files.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: C.card, borderRadius: 6, border: `1px solid ${C.bdr}`, marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{f.type.startsWith("image/") ? "🖼️" : "📄"}</span>
                  <span style={{ fontSize: 13, color: C.t, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                  <span style={{ fontSize: 11, color: C.tm }}>{(f.size / 1024).toFixed(0)} KB</span>
                </div>
                {!loading && <button onClick={e => { e.stopPropagation(); setFiles(p => p.filter((_, j) => j !== i)); }} style={{ background: "none", border: "none", color: C.td, cursor: "pointer", fontSize: 16, padding: "0 4px" }}>×</button>}
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div style={{ padding: "16px 0" }}>
            <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden", marginBottom: 12 }}>
              <div style={{ height: "100%", background: `linear-gradient(90deg, ${C.bl}, ${C.gr})`, borderRadius: 2, width: `${progress}%`, transition: "width 0.5s ease" }} />
            </div>
            <p style={{ fontSize: 13, color: C.td, margin: 0 }}>{progressMsg}</p>
          </div>
        ) : (
          <button onClick={() => files.length > 0 && onAnalyze(files)} disabled={files.length === 0}
            style={{ width: "100%", padding: "14px 0", borderRadius: 8, border: "none", background: files.length > 0 ? C.bl : "rgba(255,255,255,0.06)", color: files.length > 0 ? "#fff" : C.tm, fontSize: 14, fontWeight: 600, cursor: files.length > 0 ? "pointer" : "default", fontFamily: "'DM Sans', sans-serif" }}>
            Analyze Factsheet
          </button>
        )}
        <p style={{ fontSize: 11, color: C.tm, marginTop: 20 }}>Powered by Claude AI · AUM in ₹ Crores · Not investment advice</p>
      </div>
    </div>
  );
}

function ReportView({ data, onReset }) {
  const [active, setActive] = useState("overview");
  const d = data;
  const maxS = Math.max(...(d.sector_allocation || []).map(s => parseFloat(s.weight) || 0), 15);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.t, fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

      <div style={{ borderBottom: `1px solid ${C.bdr}`, padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: C.gr }} />
              <span style={{ fontSize: 10, color: C.td, letterSpacing: "1px", textTransform: "uppercase" }}>Forensic Analysis</span>
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: C.tb, margin: "4px 0 2px" }}>{d.fund_name || "Fund Analysis"}</h1>
            <p style={{ fontSize: 12, color: C.td, margin: 0 }}>{[d.fund_category, d.benchmark, d.factsheet_date ? `as of ${d.factsheet_date}` : null].filter(Boolean).join(" · ")}</p>
          </div>
          <button onClick={onReset} style={{ background: "rgba(255,255,255,0.06)", border: "none", color: C.td, padding: "8px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>← New</button>
        </div>
      </div>

      <div style={{ display: "flex", borderBottom: `1px solid ${C.bdr}`, padding: "0 20px", overflowX: "auto" }}>
        {tabs.map(s => (
          <button key={s.id} onClick={() => setActive(s.id)} style={{ padding: "10px 14px", fontSize: 12, fontWeight: active === s.id ? 600 : 400, color: active === s.id ? C.tb : C.td, background: "none", border: "none", cursor: "pointer", borderBottom: active === s.id ? `2px solid ${C.bl}` : "2px solid transparent", whiteSpace: "nowrap", fontFamily: "'DM Sans', sans-serif" }}>{s.label}</button>
        ))}
      </div>

      <div style={{ padding: "16px 20px", maxWidth: 780, margin: "0 auto" }}>

        {active === "overview" && (<>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
            {[
              { l: "AUM", v: fmtAUM(d.aum), s: d.aaum ? `AAuM ${fmtAUM(d.aaum)}` : null },
              { l: "NAV (Direct)", v: d.nav_direct || "—", s: d.nav_regular ? `Regular ${d.nav_regular}` : null },
              { l: "Holdings", v: d.holdings_count || "—", s: d.turnover ? `Turnover ${d.turnover}` : null },
            ].map((s, i) => (
              <div key={i} style={{ background: C.card, borderRadius: 8, padding: 14, border: `1px solid ${C.bdr}` }}>
                <div style={{ fontSize: 10, color: C.td, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 4 }}>{s.l}</div>
                <div style={{ fontSize: 17, fontWeight: 600, color: C.tb, fontFamily: "'JetBrains Mono', monospace" }}>{s.v}</div>
                {s.s && <div style={{ fontSize: 10, color: C.tm, marginTop: 2 }}>{s.s}</div>}
              </div>
            ))}
          </div>

          {d.performance?.length > 0 && (
            <Card title="Performance vs Benchmark" accent={C.gr}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 6, padding: "4px 0 6px", fontSize: 10, color: C.tm, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                <span>Period</span><span style={{ textAlign: "right" }}>Fund</span><span style={{ textAlign: "right" }}>Bench</span><span style={{ textAlign: "right" }}>Alpha</span>
              </div>
              {d.performance.map((r, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 6, padding: "8px 0", borderBottom: `1px solid ${C.bdr}`, fontSize: 12 }}>
                  <span style={{ color: C.t }}>{r.period}</span>
                  <span style={{ color: C.tb, fontFamily: "'JetBrains Mono', monospace", textAlign: "right" }}>{r.fund}</span>
                  <span style={{ color: C.td, fontFamily: "'JetBrains Mono', monospace", textAlign: "right" }}>{r.benchmark}</span>
                  <span style={{ color: r.alpha?.startsWith("-") ? C.rd : C.gr, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textAlign: "right" }}>{r.alpha}</span>
                </div>
              ))}
            </Card>
          )}

          {d.risk_metrics && Object.values(d.risk_metrics).some(v => v) && (
            <Card title="Risk Metrics">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                {[{ l: "Sharpe", v: d.risk_metrics.sharpe }, { l: "Beta", v: d.risk_metrics.beta }, { l: "Std Dev", v: d.risk_metrics.std_dev }, { l: "Alpha", v: d.risk_metrics.alpha }].filter(m => m.v).map((m, i) => (
                  <div key={i} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: C.tb, fontFamily: "'JetBrains Mono', monospace" }}>{m.v}</div>
                    <div style={{ fontSize: 10, color: C.td, textTransform: "uppercase", marginTop: 3 }}>{m.l}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {d.market_cap && (
            <Card title="Market Cap Split">
              <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
                {[{ v: d.market_cap.large, c: C.bl }, { v: d.market_cap.mid, c: C.pu }, { v: d.market_cap.small, c: C.gr }].map((s, i) => (
                  <div key={i} style={{ width: `${parseFloat(s.v) || 0}%`, background: s.c }} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 11, flexWrap: "wrap" }}>
                {[{ l: "Large", v: d.market_cap.large, c: C.bl }, { l: "Mid", v: d.market_cap.mid, c: C.pu }, { l: "Small", v: d.market_cap.small, c: C.gr }].map((m, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <div style={{ width: 7, height: 7, borderRadius: 2, background: m.c }} />
                    <span style={{ color: C.td }}>{m.l}</span>
                    <span style={{ color: C.tb, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{m.v}%</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>)}

        {active === "managers" && (<>
          {(d.managers || []).map((m, i) => (
            <Card key={i}>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: C.tb }}>{m.name}</div>
                <div style={{ fontSize: 11, color: C.td }}>{m.role}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 9, color: C.td, textTransform: "uppercase", letterSpacing: "0.5px" }}>Experience</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: C.tb, marginTop: 2 }}>{m.experience_years} Years</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 9, color: C.td, textTransform: "uppercase", letterSpacing: "0.5px" }}>Tenure</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: C.tb, marginTop: 2 }}>{m.tenure}</div>
                </div>
              </div>
              {m.education && <><div style={{ fontSize: 10, color: C.td, marginBottom: 4 }}>EDUCATION</div><div style={{ fontSize: 12, color: C.t, marginBottom: 12 }}>{m.education}</div></>}
              {m.career_path && <><div style={{ fontSize: 10, color: C.td, marginBottom: 4 }}>CAREER PATH</div><div style={{ fontSize: 12, color: C.t, lineHeight: 1.6, marginBottom: 12 }}>{m.career_path}</div></>}
              {m.investment_style && <><div style={{ fontSize: 10, color: C.td, marginBottom: 4 }}>INVESTMENT STYLE</div><div style={{ fontSize: 12, color: C.tb, lineHeight: 1.6, marginBottom: 12 }}>{m.investment_style}</div></>}
              {m.sector_bias && <><div style={{ fontSize: 10, color: C.td, marginBottom: 4 }}>SECTOR BIAS</div><div style={{ fontSize: 12, color: C.t }}>{m.sector_bias}</div></>}
            </Card>
          ))}
          {d.managers?.length === 0 && <Card><p style={{ fontSize: 13, color: C.td }}>Fund manager details not available.</p></Card>}
        </>)}

        {active === "portfolio" && (<>
          {d.top_holdings?.length > 0 && (
            <Card title="Top Holdings" accent={C.bl}>
              {d.top_holdings.map((h, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.bdr}` }}>
                  <div style={{ flex: 1 }}><span style={{ fontSize: 12, color: C.t }}>{h.name}</span>{h.classification && <Tag color={gtc(h.classification)}>{h.classification}</Tag>}</div>
                  <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: C.td }}>{h.weight}%</span>
                </div>
              ))}
            </Card>
          )}
          {d.sector_allocation?.length > 0 && (
            <Card title="Sector Allocation">
              {d.sector_allocation.slice(0, 10).map((s, i) => <Bar key={i} label={s.sector} value={s.weight} max={maxS} color={SC[i % SC.length]} />)}
            </Card>
          )}
          {d.portfolio_analysis && (<>
            <Card title="Portfolio DNA" accent={C.pu}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.tb, marginBottom: 6 }}>{d.portfolio_analysis.strategy_type}</div>
              <p style={{ fontSize: 12, color: C.t, lineHeight: 1.6, margin: "0 0 12px" }}>{d.portfolio_analysis.strategy_evidence}</p>
              {d.portfolio_analysis.turnover_interpretation && (
                <div style={{ padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
                  <div style={{ fontSize: 10, color: C.td, marginBottom: 3, textTransform: "uppercase" }}>Turnover</div>
                  <div style={{ fontSize: 12, color: C.t }}>{d.portfolio_analysis.turnover_interpretation}</div>
                </div>
              )}
            </Card>
            {d.portfolio_analysis.hidden_bets?.length > 0 && (
              <Card title="Hidden Bets">
                {d.portfolio_analysis.hidden_bets.map((h, i) => (
                  <div key={i} style={{ padding: "8px 0", borderBottom: `1px solid ${C.bdr}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.tb }}>{h.name}</span>
                      <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: C.td }}>{h.weight}%</span>
                    </div>
                    <p style={{ fontSize: 11, color: C.td, margin: 0 }}>{h.note}</p>
                  </div>
                ))}
              </Card>
            )}
          </>)}
        </>)}

        {active === "edge" && (<>
          {d.edge?.differentiators?.length > 0 && (
            <Card title="What Makes This Fund Different" accent={C.gr}>
              {d.edge.differentiators.map((e, i) => (
                <div key={i} style={{ padding: "12px 0", borderBottom: i < d.edge.differentiators.length - 1 ? `1px solid ${C.bdr}` : "none" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.tb, marginBottom: 4 }}>{e.title}</div>
                  <p style={{ fontSize: 12, color: C.t, margin: 0, lineHeight: 1.6 }}>{e.description}</p>
                </div>
              ))}
            </Card>
          )}
          {d.edge?.regime_matrix?.length > 0 && (
            <Card title="Market Regime Matrix">
              {d.edge.regime_matrix.map((r, i) => {
                const rc = r.expected?.toLowerCase().includes("under") ? C.rd : r.expected?.toLowerCase().includes("moderate") ? C.am : C.gr;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.bdr}`, gap: 8 }}>
                    <span style={{ fontSize: 12, color: C.t, flex: 2 }}>{r.regime}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: rc, background: `${rc}12`, padding: "2px 8px", borderRadius: 4, textAlign: "center", minWidth: 80 }}>{r.expected}</span>
                    <span style={{ fontSize: 11, color: C.td, flex: 3 }}>{r.reason}</span>
                  </div>
                );
              })}
            </Card>
          )}
          {d.edge?.replicability && <Card title="Replicability"><p style={{ fontSize: 12, color: C.t, lineHeight: 1.6, margin: 0 }}>{d.edge.replicability}</p></Card>}
        </>)}

        {active === "verdict" && (<>
          {d.verdict?.one_liner && (
            <Card accent={C.gr}>
              <div style={{ padding: 14, background: `${C.gr}0a`, borderRadius: 8, border: `1px solid ${C.gr}22` }}>
                <div style={{ fontSize: 10, color: C.gr, fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase", marginBottom: 6 }}>One-Line Summary</div>
                <p style={{ fontSize: 14, color: C.tb, margin: 0, lineHeight: 1.6, fontWeight: 500 }}>{d.verdict.one_liner}</p>
              </div>
            </Card>
          )}
          {d.verdict?.ideal_investor && <Card title="Who Should Invest"><p style={{ fontSize: 12, color: C.t, lineHeight: 1.7, margin: 0 }}>{d.verdict.ideal_investor}</p></Card>}
          {d.verdict?.biggest_risk && (
            <Card title="Biggest Risk" accent={C.rd}>
              <div style={{ padding: 12, background: `${C.rd}0a`, borderRadius: 8, border: `1px solid ${C.rd}18` }}>
                <p style={{ fontSize: 12, color: "#d4a0a0", margin: 0, lineHeight: 1.6 }}>{d.verdict.biggest_risk}</p>
              </div>
            </Card>
          )}
          {d.verdict?.quarterly_trackers?.length > 0 && (
            <Card title="Track Every Quarter">
              {d.verdict.quarterly_trackers.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.bdr}` }}>
                  <div style={{ width: 3, borderRadius: 2, background: SC[i % SC.length], flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.tb, marginBottom: 2 }}>{t.item}</div>
                    <p style={{ fontSize: 11, color: C.td, margin: 0, lineHeight: 1.4 }}>{t.detail}</p>
                  </div>
                </div>
              ))}
            </Card>
          )}
          <div style={{ textAlign: "center", padding: "16px 0 32px", color: C.tm, fontSize: 10 }}>AI-generated analysis · AUM in ₹ Crores · Not investment advice · DYOR</div>
        </>)}
      </div>
    </div>
  );
}

export default function App() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [error, setError] = useState(null);

  const toB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = () => rej(new Error("fail")); r.readAsDataURL(file); });

  const analyze = useCallback(async (files) => {
    setLoading(true); setError(null); setProgress(8);
    setProgressMsg("Reading factsheet data...");
    try {
      const blocks = [];
      for (const file of files) {
        const b64 = await toB64(file);
        blocks.push(file.type.startsWith("image/")
          ? { type: "image", source: { type: "base64", media_type: file.type, data: b64 } }
          : { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
        );
      }
      blocks.push({ type: "text", text: "Analyze this mutual fund factsheet. Extract every data point. CRITICAL: Convert all AUM/AAuM to Indian Crores (if in millions, divide by 10). Output AUM as plain number in crores. Classify investment style from holdings. Respond ONLY with JSON, no backticks." });

      setProgress(25); setProgressMsg("Analyzing portfolio & fund managers...");

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 8000, system: SYSTEM_PROMPT, messages: [{ role: "user", content: blocks }] })
      });

      setProgress(65); setProgressMsg("Generating forensic report...");
      const data = await resp.json();
      const txt = data.content?.map(b => b.type === "text" ? b.text : "").join("") || "";
      const parsed = JSON.parse(txt.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());

      setProgress(100); setProgressMsg("Done!");
      setTimeout(() => setReport(parsed), 200);
    } catch (err) {
      console.error(err);
      setError("Analysis failed. Please upload a clear factsheet image and try again.");
    } finally { setLoading(false); setProgress(0); }
  }, []);

  if (report) return <ReportView data={report} onReset={() => { setReport(null); setError(null); }} />;

  return (<>
    <UploadScreen onAnalyze={analyze} loading={loading} progress={progress} progressMsg={progressMsg} />
    {error && (
      <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#1e1012", border: `1px solid ${C.rd}30`, borderRadius: 8, padding: "12px 20px", color: "#fca5a5", fontSize: 13, maxWidth: 420, textAlign: "center", zIndex: 10 }}>
        {error}
      </div>
    )}
  </>);
}
