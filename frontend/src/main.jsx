import "./lib/authFetch";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import App from "./App.jsx";
import theme from "./theme.js";
import { AuthProvider } from "./contexts/AuthContext.jsx";
import { BusinessProvider } from "./contexts/BusinessContext.jsx";
import { AccessProvider } from "./contexts/AccessContext.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
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
  </React.StrictMode>
);
