import "./lib/authFetch";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { SWRConfig } from "swr";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import App from "./App.jsx";
import theme from "./theme.js";
import { swrFetcher } from "./lib/swr.js";
import { AuthProvider } from "./contexts/AuthContext.jsx";
import { BusinessProvider } from "./contexts/BusinessContext.jsx";
import { AccessProvider } from "./contexts/AccessContext.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* One shared fetcher + revalidation policy for every useSWR call in the
        app (see lib/swr.js) — a tab regaining focus or the network coming
        back re-checks data automatically, which is most of what "update live"
        means without a websocket. Per-hook options (e.g. refreshInterval)
        still override this where a screen wants actual polling. */}
    <SWRConfig
      value={{
        fetcher: swrFetcher,
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        dedupingInterval: 2000,
        shouldRetryOnError: false,
      }}
    >
      <BrowserRouter>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <AuthProvider>
            <BusinessProvider>
              {/* Inside BusinessProvider: access rules are resolved per business,
                  so this needs to know which one is active. */}
              <AccessProvider>
                <App />
              </AccessProvider>
            </BusinessProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </SWRConfig>
  </React.StrictMode>
);
