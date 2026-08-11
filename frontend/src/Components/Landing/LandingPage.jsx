import React, { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import PublicShell, {
  useGoToSignup, useIsNarrow, gutter,
  WA_LINK, WHATSAPP_DISPLAY, OFFER,
  INK, BRAND, BRAND_2, MUTED, LINE, SOFT, wrap,
} from "./PublicShell";

/*
 * The public front page.
 *
 * Deliberately self-contained: no imports from App, no design tokens, no MUI.
 * A visitor who has never logged in should not be made to download the whole
 * authenticated bundle's styling just to read a sales page, and keeping it
 * dependency-free means a change to the app's internals can never break the
 * only page prospects ever see.
 */


const FEATURES = [
  {
    tag: "Profit",
    title: "Know what you actually made",
    body: "Settlement, commission, shipping, returns, ads and GST netted off against your real purchase cost — per SKU, per order, per month. Not an estimate you typed into a spreadsheet.",
    points: ["Profit and loss per SKU", "Ads cost attributed to the SKUs it sold", "Loss-makers surfaced before they eat the month"],
    mock: "profit",
  },
  {
    tag: "Returns & claims",
    title: "Stop losing claim money to the clock",
    body: "Every return that comes back starts a 7-day claim window. Scan the parcel, decide if a claim is due, capture the packet as evidence, and upload the ticket sheet to reconcile what Meesho actually paid.",
    points: ["Countdown on every open claim", "Packet scan checked against what you shipped", "Approved, rejected and paid amounts imported from the panel"],
    mock: "claims",
  },
  {
    tag: "Dispatch",
    title: "Nothing unshipped leaves the building",
    body: "Scan each parcel at the desk. We check it against the marketplace's own status and flag anything still sitting as ready-to-ship or cancelled — before it goes in the courier bag.",
    points: ["Continuous camera scanning, verdict on screen", "Cross-checked across every business you run", "Duplicate scans caught instantly"],
    mock: "scan",
  },
  {
    tag: "Team",
    title: "Pay your team for what they finished",
    body: "Hand out listing and claim work, set the rate per marketplace, review each SKU, and the worker's wallet updates itself. Settle in one click and keep an auditable ledger.",
    points: ["Rate per platform, fixed once", "Approve per SKU — approved SKUs join your catalogue", "Wallet balance, payouts and adjustments recorded"],
    mock: "tasks",
  },
];

const MODULES = [
  "Orders", "Payments", "Unsettled", "Pay mismatch", "SKU analysis", "Ads analysis",
  "Estimated profit", "Labels & barcodes", "Order scan", "Returns & claims",
  "Claim sheet", "GST", "Tax check", "Inventory", "Purchases", "Expenses",
  "Meesho stock", "Price update", "Fraud watch", "Team tasks", "Browser extension",
];

/* ── Little product mockups ─────────────────────────────────────────────────
   Drawn in markup rather than shipped as images: they stay sharp on any
   screen, weigh nothing, and cannot go stale against a UI change the way a
   PNG screenshot silently does. Swap in real captures whenever you like. */

function Chrome({ title, children }) {
  return (
    <div style={{
      border: `1px solid ${LINE}`, borderRadius: 14, overflow: "hidden",
      background: "#fff", boxShadow: "0 18px 50px rgba(19,17,28,0.10)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "9px 12px",
        background: SOFT, borderBottom: `1px solid ${LINE}`,
      }}>
        {["#F87171", "#FBBF24", "#34D399"].map((c) => (
          <span key={c} style={{ width: 9, height: 9, borderRadius: "50%", background: c }} />
        ))}
        <span style={{ marginLeft: 8, fontSize: 11, color: MUTED, fontWeight: 600 }}>{title}</span>
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  );
}

function Bar({ label, value, pct, tone = BRAND }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 3 }}>
        <span style={{ color: MUTED, fontFamily: "monospace" }}>{label}</span>
        <span style={{ fontWeight: 800, color: tone, fontFamily: "monospace" }}>{value}</span>
      </div>
      <div style={{ height: 6, borderRadius: 6, background: "#F1EDF6" }}>
        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 6, background: tone }} />
      </div>
    </div>
  );
}

function Mock({ kind }) {
  if (kind === "profit") {
    return (
      <Chrome title="Overview">
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          {[["Net profit", "₹1,84,320", "#16A34A"], ["Settlement", "₹9,42,110", INK], ["Returns", "₹71,240", "#DC2626"]].map(([l, v, c]) => (
            <div key={l} style={{ flex: "1 1 110px", border: `1px solid ${LINE}`, borderRadius: 10, padding: "9px 11px" }}>
              <div style={{ fontSize: 9.5, color: MUTED, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>{l}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: c, fontFamily: "monospace" }}>{v}</div>
            </div>
          ))}
        </div>
        <Bar label="KURTI-COT-RED-M" value="+₹42,180" pct={88} tone="#16A34A" />
        <Bar label="SAREE-SLK-BLU-FS" value="+₹19,640" pct={52} tone="#16A34A" />
        <Bar label="DECOR-BRS-VAS-S" value="−₹4,210" pct={22} tone="#DC2626" />
      </Chrome>
    );
  }
  if (kind === "claims") {
    return (
      <Chrome title="Returns & claims">
        {[["TODAY is the last day", "#DC2626", "#FEF2F2"],
          ["2 days left to claim", "#D97706", "#FFFBEB"],
          ["Claim approved · ₹511.56 paid", "#16A34A", "#F0FDF4"]].map(([t, c, bg]) => (
          <div key={t} style={{
            background: bg, border: `1px solid ${c}22`, color: c,
            borderRadius: 9, padding: "9px 11px", fontSize: 12, fontWeight: 700, marginBottom: 7,
          }}>{t}</div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
          {[["22", "open"], ["120", "approved"], ["₹49,481", "recovered"]].map(([n, l]) => (
            <div key={l} style={{ flex: 1, textAlign: "center", border: `1px solid ${LINE}`, borderRadius: 9, padding: "7px 4px" }}>
              <div style={{ fontSize: 14, fontWeight: 800, fontFamily: "monospace", color: INK }}>{n}</div>
              <div style={{ fontSize: 9.5, color: MUTED, fontWeight: 600 }}>{l}</div>
            </div>
          ))}
        </div>
      </Chrome>
    );
  }
  if (kind === "scan") {
    return (
      <Chrome title="Order scan">
        <div style={{ background: INK, borderRadius: 10, padding: 11, marginBottom: 10 }}>
          {[["✓", "Recorded · shipped", "#34D399"],
            ["✕", "DO NOT SHIP — not shipped", "#F87171"],
            ["!", "Already scanned · 2×", "#FBBF24"]].map(([m, t, c]) => (
            <div key={t} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <span style={{ color: c, fontWeight: 800, fontSize: 12 }}>{m}</span>
              <span style={{ color: "#fff", fontSize: 11.5, fontWeight: 600 }}>{t}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: MUTED }}>Camera stays on — keep scanning, verdicts appear above.</div>
      </Chrome>
    );
  }
  return (
    <Chrome title="Team tasks">
      {[["KURTI-COT-RED-S", "Approved", "#16A34A", "₹60"],
        ["KURTI-COT-RED-M", "Approved", "#16A34A", "₹60"],
        ["KURTI-COT-RED-L", "Pending", "#D97706", "—"]].map(([sku, st, c, amt]) => (
        <div key={sku} style={{
          display: "flex", alignItems: "center", gap: 8, border: `1px solid ${LINE}`,
          borderRadius: 9, padding: "8px 10px", marginBottom: 6,
        }}>
          <span style={{ fontFamily: "monospace", fontSize: 11.5, fontWeight: 700, flex: 1, color: INK }}>{sku}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: c }}>{st}</span>
          <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 800, color: "#16A34A" }}>{amt}</span>
        </div>
      ))}
      <div style={{ marginTop: 10, padding: "8px 11px", background: SOFT, borderRadius: 9, fontSize: 11.5, color: MUTED }}>
        Wallet · <b style={{ color: "#16A34A", fontFamily: "monospace" }}>₹120</b> owed to Priya
      </div>
    </Chrome>
  );
}

/* ── Signup ─────────────────────────────────────────────────────────────── */

function SignupForm({ innerRef }) {
  const [form, setForm] = useState({
    name: "", business_name: "", phone: "", email: "",
    marketplaces: "", monthly_orders: "", message: "", company_website: "",
  });
  const [state, setState] = useState("idle");   // idle | sending | done | error
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError("Please tell us your name."); return; }
    if (!form.phone.trim() && !form.email.trim()) {
      setError("Leave a phone number or an email so we can get back to you."); return;
    }
    setState("sending"); setError("");
    try {
      const res = await fetch("/api/auth/leads/", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.status === 429) { setState("error"); setError("Too many requests just now — please try again shortly, or message us on WhatsApp."); return; }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setState("error");
        setError(d.detail || Object.values(d)[0] || "Something went wrong. WhatsApp us instead?");
        return;
      }
      setState("done");
    } catch {
      setState("error");
      setError("Couldn't reach the server. WhatsApp us instead?");
    }
  };

  const field = {
    width: "100%", padding: "11px 13px", borderRadius: 10,
    border: `1.5px solid ${LINE}`, fontSize: 14, fontFamily: "inherit",
    outline: "none", background: "#fff", color: INK, boxSizing: "border-box",
  };

  if (state === "done") {
    return (
      <div ref={innerRef} id="signup" style={{
        background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 16,
        padding: 32, textAlign: "center",
      }}>
        <div style={{ fontSize: 34, marginBottom: 8 }}>✓</div>
        <h3 style={{ fontSize: 20, fontWeight: 800, color: "#166534", margin: "0 0 8px" }}>
          Got it — we'll be in touch
        </h3>
        <p style={{ fontSize: 14.5, color: "#15803D", lineHeight: 1.6, margin: "0 0 18px" }}>
          We'll set your account up and walk you through it. If you'd rather talk now, message us on WhatsApp.
        </p>
        <a href={WA_LINK} target="_blank" rel="noreferrer" style={{
          display: "inline-block", background: "#25D366", color: "#fff", textDecoration: "none",
          padding: "12px 22px", borderRadius: 10, fontWeight: 800, fontSize: 15,
        }}>WhatsApp {WHATSAPP_DISPLAY}</a>
      </div>
    );
  }

  return (
    <form ref={innerRef} id="signup" onSubmit={submit} style={{
      background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16,
      padding: 26, boxShadow: "0 18px 50px rgba(19,17,28,0.08)",
    }}>
      <h3 style={{ fontSize: 21, fontWeight: 800, color: INK, margin: "0 0 5px" }}>
        Get started
      </h3>
      <p style={{ fontSize: 14, color: MUTED, margin: "0 0 20px", lineHeight: 1.6 }}>
        Tell us about your shop and we'll set you up. <b style={{ color: "#047857" }}>Your first year is
        free</b> — no card, no commitment.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <div><label style={{ fontSize: 12.5, fontWeight: 700, color: INK, display: "block", marginBottom: 5 }}>Your name *</label>
          <input value={form.name} onChange={set("name")} style={field} placeholder="Vivek Garg" /></div>
        <div><label style={{ fontSize: 12.5, fontWeight: 700, color: INK, display: "block", marginBottom: 5 }}>Business name</label>
          <input value={form.business_name} onChange={set("business_name")} style={field} placeholder="Rudam Enterprises" /></div>
        <div><label style={{ fontSize: 12.5, fontWeight: 700, color: INK, display: "block", marginBottom: 5 }}>WhatsApp number</label>
          <input value={form.phone} onChange={set("phone")} style={field} placeholder="+91 …" inputMode="tel" /></div>
        <div><label style={{ fontSize: 12.5, fontWeight: 700, color: INK, display: "block", marginBottom: 5 }}>Email</label>
          <input value={form.email} onChange={set("email")} style={field} placeholder="you@shop.com" type="email" /></div>
        <div><label style={{ fontSize: 12.5, fontWeight: 700, color: INK, display: "block", marginBottom: 5 }}>Where do you sell?</label>
          <input value={form.marketplaces} onChange={set("marketplaces")} style={field} placeholder="Meesho, Amazon, Flipkart" /></div>
        <div><label style={{ fontSize: 12.5, fontWeight: 700, color: INK, display: "block", marginBottom: 5 }}>Orders a month</label>
          <select value={form.monthly_orders} onChange={set("monthly_orders")} style={field}>
            <option value="">Select…</option>
            {["Under 500", "500 – 2,000", "2,000 – 10,000", "10,000+"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select></div>
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={{ fontSize: 12.5, fontWeight: 700, color: INK, display: "block", marginBottom: 5 }}>Anything specific?</label>
        <textarea value={form.message} onChange={set("message")} rows={2}
          style={{ ...field, resize: "vertical" }} placeholder="What's costing you the most time right now?" />
      </div>

      {/* Honeypot — invisible to people, irresistible to bots. */}
      <input value={form.company_website} onChange={set("company_website")} tabIndex={-1}
        autoComplete="off" aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} />

      {error && (
        <div style={{
          marginTop: 13, padding: "10px 13px", borderRadius: 10, background: "#FEF2F2",
          border: "1px solid #FECACA", color: "#B91C1C", fontSize: 13.5, fontWeight: 600,
        }}>{error}</div>
      )}

      <button type="submit" disabled={state === "sending"} style={{
        marginTop: 16, width: "100%", padding: "14px 20px", borderRadius: 11, border: "none",
        background: `linear-gradient(135deg, ${BRAND}, ${BRAND_2})`, color: "#fff",
        fontSize: 15.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
        opacity: state === "sending" ? 0.6 : 1,
      }}>
        {state === "sending" ? "Sending…" : "Claim my free year"}
      </button>

      <p style={{ fontSize: 12.5, color: MUTED, textAlign: "center", margin: "12px 0 0" }}>
        Already have an account? <Link to="/login" style={{ color: BRAND, fontWeight: 700 }}>Sign in</Link>
      </p>
    </form>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function LandingPage() {
  const signupRef = useRef(null);
  const toSignup = useGoToSignup();
  const narrow = useIsNarrow();
  const location = useLocation();

  // Arriving from another public page (or a shared /#signup link) should land
  // on the form. Waits a frame so the section exists before scrolling to it.
  useEffect(() => {
    if (location.state?.scrollTo !== "signup" && location.hash !== "#signup") return;
    const id = requestAnimationFrame(() =>
      signupRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    return () => cancelAnimationFrame(id);
  }, [location]);


  return (
    <PublicShell>
      {/* Hero */}
      <section style={{ background: `linear-gradient(180deg, ${SOFT}, #fff)`, borderBottom: `1px solid ${LINE}` }}>
        <div style={{ ...gutter(narrow), padding: narrow ? "30px 16px 34px" : "62px 22px 56px",
          display: "grid",
          // 320px minimum columns still try to sit side by side on a 390px
          // phone; below the breakpoint the hero is explicitly one column.
          gridTemplateColumns: narrow ? "minmax(0, 1fr)" : "repeat(auto-fit, minmax(320px, 1fr))",
          gap: narrow ? 26 : 44, alignItems: "center" }}>
          <div>
            <div style={{
              display: "inline-block", background: "#F3E8FF", color: BRAND, fontSize: 12.5,
              fontWeight: 800, padding: "6px 12px", borderRadius: 999, marginBottom: 18,
            }}>For Meesho, Amazon &amp; Flipkart sellers</div>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              // The offset reads as a gap between two pills on one line; once
              // they wrap onto separate lines it just looks like a stray indent.
              marginLeft: narrow ? 0 : 9,
              background: "#ECFDF5", color: "#047857", fontSize: 12.5, fontWeight: 800,
              padding: "6px 12px", borderRadius: 999, marginBottom: 18,
              border: "1.5px solid #A7F3D0",
            }}>🎉 First year free</div>
            <h1 style={{ fontSize: narrow ? 29 : 42, lineHeight: narrow ? 1.2 : 1.12,
              fontWeight: 900, margin: narrow ? "0 0 12px" : "0 0 18px", letterSpacing: "-0.02em" }}>
              {/* The hard break is a desktop line-length decision; on a phone it
                  strands "one screen." on a line of its own. */}
              Run the whole shop from{narrow ? " " : <br />}one screen.
            </h1>
            <p style={{ fontSize: narrow ? 15 : 17, lineHeight: 1.6, color: MUTED,
              margin: narrow ? "0 0 20px" : "0 0 26px", maxWidth: 520 }}>
              Rudam Commerce OS turns your marketplace exports into real numbers — true profit per SKU,
              claims you'd otherwise miss, parcels that shouldn't ship, GST that reconciles, and a team
              you can pay for exactly what they finished.
            </p>
            <div style={{ display: "flex", gap: narrow ? 9 : 11, flexWrap: "wrap" }}>
              <a href="#signup" onClick={toSignup} style={{
                background: `linear-gradient(135deg, ${BRAND}, ${BRAND_2})`, color: "#fff",
                textDecoration: "none", fontWeight: 800, fontSize: 15.5,
                padding: "14px 26px", borderRadius: 11,
                flex: narrow ? "1 1 100%" : "0 0 auto", textAlign: "center",
              }}>Start free for a year</a>
              <a href={WA_LINK} target="_blank" rel="noreferrer" style={{
                background: "#25D366", color: "#fff", textDecoration: "none", fontWeight: 800,
                fontSize: 15.5, padding: "14px 24px", borderRadius: 11,
                flex: narrow ? "1 1 100%" : "0 0 auto", textAlign: "center",
              }}>💬 Chat on WhatsApp</a>
            </div>
            <div style={{ display: "flex", gap: 22, marginTop: 26, flexWrap: "wrap" }}>
              {[["21", "modules"], ["3", "marketplaces"], ["1", "place for all of it"]].map(([n, l]) => (
                <div key={l}>
                  <div style={{ fontSize: 23, fontWeight: 900, color: INK }}>{n}</div>
                  <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 600 }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
          <Mock kind="profit" />
        </div>
      </section>

      {/* Features */}
      <section style={{ ...gutter(narrow), padding: narrow ? "38px 16px 14px" : "64px 22px 20px" }}>
        <h2 style={{ fontSize: narrow ? 24 : 31, fontWeight: 900, textAlign: "center", margin: "0 0 10px", letterSpacing: "-0.02em" }}>
          Everything a marketplace seller has to do
        </h2>
        <p style={{ fontSize: 16, color: MUTED, textAlign: "center", margin: "0 auto 50px", maxWidth: 620, lineHeight: 1.6 }}>
          Not a dashboard bolted onto a spreadsheet. The daily jobs — packing, claiming, pricing,
          filing, paying — each with the numbers already worked out.
        </p>

        {FEATURES.map((f, i) => (
          <div key={f.tag} style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: 42, alignItems: "center", marginBottom: 66,
            direction: i % 2 ? "rtl" : "ltr",
          }}>
            <div style={{ direction: "ltr" }}>
              <div style={{
                display: "inline-block", background: "#F3E8FF", color: BRAND, fontSize: 11.5,
                fontWeight: 800, padding: "5px 11px", borderRadius: 999, marginBottom: 13,
                letterSpacing: ".04em", textTransform: "uppercase",
              }}>{f.tag}</div>
              <h3 style={{ fontSize: 25, fontWeight: 800, margin: "0 0 12px", letterSpacing: "-0.01em" }}>{f.title}</h3>
              <p style={{ fontSize: 15.5, color: MUTED, lineHeight: 1.68, margin: "0 0 16px" }}>{f.body}</p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {f.points.map((p) => (
                  <li key={p} style={{ display: "flex", gap: 9, alignItems: "flex-start", marginBottom: 8, fontSize: 14.5 }}>
                    <span style={{ color: "#16A34A", fontWeight: 900 }}>✓</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div style={{ direction: "ltr" }}><Mock kind={f.mock} /></div>
          </div>
        ))}
      </section>

      {/* Modules */}
      <section style={{ background: SOFT, borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}` }}>
        <div style={{ ...gutter(narrow), padding: narrow ? "34px 16px" : "50px 22px" }}>
          <h2 style={{ fontSize: 23, fontWeight: 800, textAlign: "center", margin: "0 0 8px" }}>
            And everything else you'd otherwise keep in spreadsheets
          </h2>
          <p style={{ fontSize: 14.5, color: MUTED, textAlign: "center", margin: "0 0 26px" }}>
            All included — no per-module pricing, and free for your first year.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
            {MODULES.map((m) => (
              <span key={m} style={{
                background: "#fff", border: `1px solid ${LINE}`, borderRadius: 999,
                padding: "7px 14px", fontSize: 13, fontWeight: 600, color: INK,
              }}>{m}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Signup */}
      <section style={{ ...gutter(narrow), padding: narrow ? "38px 16px" : "62px 22px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 42, alignItems: "center" }}>
          <div>
            <h2 style={{ fontSize: narrow ? 24 : 30, fontWeight: 900, margin: "0 0 14px", letterSpacing: "-0.02em" }}>
              Start with your own numbers — free for a year
            </h2>
            <p style={{ fontSize: 16, color: MUTED, lineHeight: 1.68, margin: "0 0 20px" }}>
              Send us your details and we'll get you set up — usually the same day. Upload one month of
              exports and you'll see your real profit, the claims still open, and where the money went.
            </p>
            {[OFFER, "We set the account up for you", "Bring your existing exports — nothing to re-enter",
              "Talk to a person, on WhatsApp, not a ticket queue"].map((t) => (
              <div key={t} style={{ display: "flex", gap: 10, marginBottom: 11, fontSize: 15 }}>
                <span style={{ color: "#16A34A", fontWeight: 900 }}>✓</span><span>{t}</span>
              </div>
            ))}
            <a href={WA_LINK} target="_blank" rel="noreferrer" style={{
              display: "inline-flex", alignItems: "center", gap: 9, marginTop: 14,
              background: "#F0FDF4", border: "1.5px solid #BBF7D0", color: "#166534",
              textDecoration: "none", fontWeight: 800, fontSize: 15, padding: "13px 20px", borderRadius: 11,
            }}>💬 Or message {WHATSAPP_DISPLAY}</a>
          </div>
          <SignupForm innerRef={signupRef} />
        </div>
      </section>

    </PublicShell>
  );
}
