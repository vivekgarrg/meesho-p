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
  return (
    <div style={{
      background: `linear-gradient(90deg, ${BRAND}, ${BRAND_2})`,
      color: "#fff", textAlign: "center", padding: "8px 16px",
      fontSize: 13.5, fontWeight: 700, letterSpacing: "0.01em",
    }}>
      🎉 {OFFER} · <span style={{ opacity: 0.9, fontWeight: 600 }}>no card, cancel anytime</span>
    </div>
  );
}

export function PublicNav() {
  const goToSignup = useGoToSignup();
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 50, background: "rgba(255,255,255,0.92)",
      backdropFilter: "blur(10px)", borderBottom: `1px solid ${LINE}`,
    }}>
      <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 12, height: 64 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 11, textDecoration: "none" }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: `linear-gradient(135deg, ${BRAND}, #4F46E5)`,
            display: "grid", placeItems: "center", color: "#fff", fontWeight: 900, fontSize: 16,
          }}>R</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: INK }}>
            Rudam <span style={{ color: BRAND }}>Commerce OS</span>
          </div>
        </Link>
        <nav style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <a href={WA_LINK} target="_blank" rel="noreferrer" style={{
            display: "flex", alignItems: "center", gap: 6, color: "#16A34A", textDecoration: "none",
            fontWeight: 700, fontSize: 13.5, padding: "8px 12px", borderRadius: 9,
            border: "1.5px solid #BBF7D0", background: "#F0FDF4", whiteSpace: "nowrap",
          }}>
            <span aria-hidden>💬</span> {WHATSAPP_DISPLAY}
          </a>
          <Link to="/login" style={{
            color: INK, textDecoration: "none", fontWeight: 700, fontSize: 13.5, padding: "8px 12px",
          }}>Sign in</Link>
          <a href="/#signup" onClick={goToSignup} style={{
            background: INK, color: "#fff", textDecoration: "none", fontWeight: 700,
            fontSize: 13.5, padding: "9px 16px", borderRadius: 9, whiteSpace: "nowrap",
            cursor: "pointer",
          }}>Get started</a>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer style={{ background: INK, color: "rgba(255,255,255,0.72)", marginTop: "auto" }}>
      <div style={{ ...wrap, padding: "34px 22px", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
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
