import React from "react";
import {
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import { C } from "../../App";

// ── Helpers (re-exported so tabs can import from one place) ───────────────────
export function fmtMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}

export function monthToRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return {
    date_from: `${ym}-01`,
    date_to: `${ym}-${String(last).padStart(2, "0")}`,
  };
}

// ── Shared Period Filter Bar ──────────────────────────────────────────────────
/**
 * Controlled period filter bar used across all operation tabs.
 * State lives in the parent; this component only renders and calls setters.
 *
 * Props:
 *   months        – string[]  available month keys ("2024-05")
 *   mode          – "all" | "month" | "custom"
 *   setMode       – setter
 *   selectedMonth – string   active month key (when mode === "month")
 *   setSelectedMonth – setter
 *   customFrom    – string   ISO date (when mode === "custom")
 *   setCustomFrom – setter
 *   customTo      – string   ISO date (when mode === "custom")
 *   setCustomTo   – setter
 *   onApply       – (range: {} | { date_from, date_to }) => void
 */
export function FilterBar({
  months = [],
  mode,
  setMode,
  selectedMonth,
  setSelectedMonth,
  customFrom,
  setCustomFrom,
  customTo,
  setCustomTo,
  onApply,
}) {
  const handleClear = () => {
    setMode("all");
    setCustomFrom?.("");
    setCustomTo?.("");
    onApply({});
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: "12px 20px",
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        flexWrap: "wrap",
        borderRadius: 2,
        background: "#fff",
      }}
    >
      {/* Icon + label */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mr: 0.5 }}>
        <CalendarTodayIcon sx={{ fontSize: 15, color: "text.secondary" }} />
        <Typography
          variant="caption"
          sx={{
            fontWeight: 700,
            color: "text.secondary",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Period
        </Typography>
      </Box>

      {/* All Time */}
      <Button
        size="small"
        variant={mode === "all" ? "contained" : "outlined"}
        color="primary"
        disableElevation
        onClick={() => { setMode("all"); onApply({}); }}
        sx={{ textTransform: "none", fontWeight: mode === "all" ? 700 : 500, borderRadius: 20, minWidth: 80 }}
      >
        All Time
      </Button>

      {/* Month select */}
      <FormControl size="small" sx={{ minWidth: 185 }}>
        <InputLabel>Select month</InputLabel>
        <Select
          value={mode === "month" ? (selectedMonth || "") : ""}
          label="Select month"
          onChange={(e) => {
            const m = e.target.value;
            if (!m) return;
            setMode("month");
            setSelectedMonth(m);
            onApply(monthToRange(m));
          }}
          sx={{
            bgcolor: mode === "month" ? "#F5F3FF" : undefined,
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: mode === "month" ? C.orange : undefined,
            },
          }}
        >
          <MenuItem value=""><em>Select month…</em></MenuItem>
          {months.map((m) => (
            <MenuItem key={m} value={m} sx={{ fontSize: 13 }}>
              {fmtMonth(m)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {mode === "month" && selectedMonth && (
        <Chip
          label={fmtMonth(selectedMonth)}
          color="primary"
          size="small"
          onDelete={handleClear}
          sx={{ borderRadius: 20 }}
        />
      )}

      {/* Divider — "1px", not MUI's `width: 1`, which means 100% and rendered
          as a full-width grey bar whenever this row wrapped. */}
      <Box sx={{ width: "1px", height: 28, bgcolor: "divider", flexShrink: 0 }} />

      {/* Custom range */}
      <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>
        Custom:
      </Typography>
      <TextField
        type="date"
        size="small"
        value={customFrom}
        onChange={(e) => setCustomFrom(e.target.value)}
        sx={{ width: 150 }}
        InputLabelProps={{ shrink: true }}
      />
      <Typography variant="body2" sx={{ color: "text.disabled" }}>→</Typography>
      <TextField
        type="date"
        size="small"
        value={customTo}
        onChange={(e) => setCustomTo(e.target.value)}
        sx={{ width: 150 }}
        InputLabelProps={{ shrink: true }}
      />
      <Button
        size="small"
        variant={mode === "custom" ? "contained" : "outlined"}
        disableElevation
        disabled={!customFrom || !customTo}
        onClick={() => {
          if (!customFrom || !customTo) return;
          setMode("custom");
          onApply({ date_from: customFrom, date_to: customTo });
        }}
        sx={{ textTransform: "none", borderRadius: 20 }}
      >
        Apply
      </Button>

      {mode === "custom" && customFrom && (
        <Chip
          label={`${customFrom} → ${customTo}`}
          color="primary"
          size="small"
          onDelete={handleClear}
          sx={{ borderRadius: 20 }}
        />
      )}
    </Paper>
  );
}
