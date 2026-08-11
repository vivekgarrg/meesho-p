import React from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";

/*
 * The public chrome — offer ribbon, navbar and footer — shared by every page a
 * signed-out visitor can reach.
 *
 * Lives apart from LandingPage so the login screen wears the same clothes. A
 * prospect who clicks "Sign in", finds they have no account and lands on a bare
 * form has nowhere to go; with the navbar and the WhatsApp button present they
 * are one click from the sales page or a conversation.
 *
 * Dependency-free on purpose: no App imports, no MUI. Nothing an authenticated
 * screen does can break the only pages prospects ever see.
 */

export const WHATSAPP = "918273343222";
export const WHATSAPP_DISPLAY = "+91 82733 43222";
export const WA_LINK = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(
  "Hi! I'd like to know more about Rudam Commerce OS."
)}`;

export const INK = "#13111C";
export const BRAND = "#7C3AED";
export const BRAND_2 = "#F43397";
export const MUTED = "#6B6577";
export const LINE = "#E9E4EE";
export const SOFT = "#FAF8FC";

export const OFFER = "First year free — for sellers joining now";

export const wrap = { maxWidth: 1120, margin: "0 auto", padding: "0 22px" };

/**
 * True on a phone.
 *
 * The public pages are styled entirely inline, and an inline style cannot be
 * overridden by a CSS media query — so "is this a small screen" has to be a
 * value in JS. Written here rather than imported from the app's shared tokens
 * because these pages deliberately depend on nothing an authenticated screen
 * can break.
 */
export function useIsNarrow(px = 640) {
  const q = `(max-width: ${px}px)`;
  const [narrow, setNarrow] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia(q).matches
  );
  React.useEffect(() => {
    const mql = window.matchMedia(q);
    const on = (e) => setNarrow(e.matches);
    setNarrow(mql.matches);            // re-sync if it changed before mount
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, [q]);
  return narrow;
}

/** Page gutter — tighter on a phone, where 22px each side is real estate. */
export const gutter = (narrow) => ({ ...wrap, padding: narrow ? "0 16px" : "0 22px" });

/**
 * Jump to the signup form, from anywhere in the public site.
 *
 * A plain <Link to="/#signup"> does not work: React Router owns navigation and
 * does not scroll to hash targets, so on the landing page it re-renders the
 * same route and nothing moves at all. From the login page the form isn't even
 * mounted yet, so the scroll has to wait for the landing page to render —
 * hence the state flag rather than a timer, which would race the render.
 */
export function useGoToSignup() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (e) => {
    e?.preventDefault();
    if (pathname === "/") {
      document.getElementById("signup")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      navigate("/", { state: { scrollTo: "signup" } });
    }
  };
}

export function OfferRibbon() {
  const narrow = useIsNarrow();
  return (
    <div style={{
      background: `linear-gradient(90deg, ${BRAND}, ${BRAND_2})`,
      color: "#fff", textAlign: "center", padding: narrow ? "7px 12px" : "8px 16px",
      fontSize: narrow ? 12 : 13.5, fontWeight: 700, letterSpacing: "0.01em",
      lineHeight: 1.45,
    }}>
      🎉 {OFFER}
      {/* The reassurance is worth the line on desktop; on a phone it pushes the
          headline below the fold, which costs more than it earns. */}
      {!narrow && <> · <span style={{ opacity: 0.9, fontWeight: 600 }}>no card, cancel anytime</span></>}
    </div>
  );
}

export function PublicNav() {
  const goToSignup = useGoToSignup();
  const narrow = useIsNarrow();
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 50, background: "rgba(255,255,255,0.92)",
      backdropFilter: "blur(10px)", borderBottom: `1px solid ${LINE}`,
    }}>
      <div style={{ ...gutter(narrow), display: "flex", alignItems: "center",
        gap: narrow ? 8 : 12, height: narrow ? 56 : 64 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: narrow ? 8 : 11,
          textDecoration: "none", minWidth: 0 }}>
          <div style={{
            width: narrow ? 30 : 34, height: narrow ? 30 : 34, borderRadius: 10,
            background: `linear-gradient(135deg, ${BRAND}, #4F46E5)`, flexShrink: 0,
            display: "grid", placeItems: "center", color: "#fff", fontWeight: 900,
            fontSize: narrow ? 14 : 16,
          }}>R</div>
          <div style={{ fontWeight: 800, fontSize: narrow ? 15 : 16, color: INK, whiteSpace: "nowrap" }}>
            {/* Four words of wordmark plus three controls does not fit 390px.
                The mark and the name carry it; the tagline is the part to drop. */}
            Rudam{!narrow && <span style={{ color: BRAND }}> Commerce OS</span>}
          </div>
        </Link>
        <nav style={{ marginLeft: "auto", display: "flex", alignItems: "center",
          gap: narrow ? 4 : 8, flexShrink: 0 }}>
          <a href={WA_LINK} target="_blank" rel="noreferrer"
            aria-label={`WhatsApp ${WHATSAPP_DISPLAY}`}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              color: "#16A34A", textDecoration: "none", fontWeight: 700, fontSize: 13.5,
              padding: narrow ? 0 : "8px 12px", borderRadius: narrow ? "50%" : 9,
              width: narrow ? 40 : "auto", height: narrow ? 40 : "auto",
              border: "1.5px solid #BBF7D0", background: "#F0FDF4", whiteSpace: "nowrap",
            }}>
            <span aria-hidden style={{ fontSize: narrow ? 17 : 14 }}>💬</span>
            {!narrow && WHATSAPP_DISPLAY}
          </a>
          <Link to="/login" style={{
            color: INK, textDecoration: "none", fontWeight: 700,
            fontSize: narrow ? 13 : 13.5,
            padding: narrow ? "10px 8px" : "8px 12px",
          }}>Sign in</Link>
          <a href="/#signup" onClick={goToSignup} style={{
            background: INK, color: "#fff", textDecoration: "none", fontWeight: 700,
            fontSize: narrow ? 13 : 13.5,
            padding: narrow ? "10px 13px" : "9px 16px",
            borderRadius: 9, whiteSpace: "nowrap", cursor: "pointer",
          }}>Get started</a>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer style={{ background: INK, color: "rgba(255,255,255,0.72)", marginTop: "auto" }}>
      <div style={{ ...wrap, padding: "30px 18px", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 15 }}>Rudam Commerce OS</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            Profit, returns, claims, GST and dispatch — in one place.
          </div>
          <div style={{ fontSize: 12.5, marginTop: 7, color: "#34D399", fontWeight: 700 }}>{OFFER}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <a href={WA_LINK} target="_blank" rel="noreferrer"
            style={{ color: "#34D399", textDecoration: "none", fontWeight: 700, fontSize: 14 }}>
            WhatsApp {WHATSAPP_DISPLAY}
          </a>
          <Link to="/" style={{ color: "rgba(255,255,255,0.8)", textDecoration: "none", fontSize: 14 }}>Home</Link>
          <Link to="/login" style={{ color: "rgba(255,255,255,0.8)", textDecoration: "none", fontSize: 14 }}>Sign in</Link>
        </div>
      </div>
    </footer>
  );
}

/** The floating WhatsApp button — the one thing that should never scroll away. */
export function WhatsAppFab() {
  return (
    <a href={WA_LINK} target="_blank" rel="noreferrer" aria-label="Chat on WhatsApp" style={{
      position: "fixed", right: 20, bottom: 20, zIndex: 100,
      width: 56, height: 56, borderRadius: "50%", background: "#25D366",
      display: "grid", placeItems: "center", fontSize: 26, textDecoration: "none",
      boxShadow: "0 10px 28px rgba(37,211,102,0.45)",
    }}>💬</a>
  );
}

/** Wraps any public page in the shared chrome. */
export default function PublicShell({ children }) {
  return (
    <div style={{
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      color: INK, background: "#fff",
      minHeight: "100vh", display: "flex", flexDirection: "column",
    }}>
      <OfferRibbon />
      <PublicNav />
      <div style={{ flex: 1 }}>{children}</div>
      <PublicFooter />
      <WhatsAppFab />
    </div>
  );
}
