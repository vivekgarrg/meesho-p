import React from "react";
import { C } from "../../shared";

/**
 * Catches render/lifecycle errors so one broken screen can't blank the whole app.
 *
 * Two placements, both useful:
 *  · around each routed view, keyed by pathname — a failing tab shows a message
 *    while the sidebar and top bar keep working, so you can navigate away and
 *    changing route clears the error automatically;
 *  · around the whole shell as a last resort, in case the shell itself throws.
 *
 * Note this only catches errors thrown while React renders. Failures inside
 * event handlers, promises and `fetch` callbacks never reach a boundary — those
 * still need their own try/catch at the call site.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, showDetail: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Keep the real stack in the console — the on-screen message is deliberately
    // brief, but whoever is debugging still needs the original trace.
    console.error("[ErrorBoundary]", this.props.label || "app", error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    // A new resetKey (e.g. a route change) means the user has moved on; drop the
    // error so they aren't stuck looking at it.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, info: null, showDetail: false });
    }
  }

  render() {
    const { error, info, showDetail } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{
        background: C.white, border: `1px solid ${C.redBorder}`, borderLeft: `4px solid ${C.red}`,
        borderRadius: 14, padding: "24px 26px", margin: "8px 0",
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.gray800, marginBottom: 6 }}>
          This screen ran into a problem
        </div>
        <div style={{ fontSize: 13, color: C.gray500, marginBottom: 16, maxWidth: 620, lineHeight: 1.55 }}>
          The rest of the app is still working — use the menu to go elsewhere, or try again.
          Nothing you've saved is affected.
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <button
            onClick={() => this.setState({ error: null, info: null, showDetail: false })}
            style={{
              background: C.orange, color: "#fff", border: "none", borderRadius: 10,
              padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "transparent", color: C.gray600, border: `1.5px solid ${C.gray200}`,
              borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Reload page
          </button>
          <button
            onClick={() => this.setState({ showDetail: !showDetail })}
            style={{
              background: "transparent", color: C.gray400, border: "none",
              padding: "9px 8px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {showDetail ? "Hide details" : "Show details"}
          </button>
        </div>

        {showDetail && (
          <pre style={{
            background: C.gray50, border: `1px solid ${C.border}`, borderRadius: 10,
            padding: 14, fontSize: 11, color: C.gray600, overflowX: "auto",
            whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 260, margin: 0,
          }}>
            {String(error?.stack || error?.message || error)}
            {info?.componentStack ? `\n${info.componentStack}` : ""}
          </pre>
        )}
      </div>
    );
  }
}

export default ErrorBoundary;
