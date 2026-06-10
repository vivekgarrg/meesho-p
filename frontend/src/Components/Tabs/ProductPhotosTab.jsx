import React, { useState, useRef } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import Grid from "@mui/material/Grid";
import LinearProgress from "@mui/material/LinearProgress";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import { API, C } from "../../App";

const STYLE_LABELS = [
  "White Studio", "Marble Luxury", "Dark Dramatic", "Wooden Table",
  "Nature Outdoor", "Pastel Flat Lay", "Navy Premium", "Botanical",
  "Warm Gradient", "Minimal Concrete",
];
const STYLE_ICONS = ["🤍", "🪨", "🖤", "🪵", "🌿", "🌸", "🌊", "🌺", "🌅", "🏙️"];

function downloadImage(b64, name) {
  const a = document.createElement("a");
  a.href = `data:image/png;base64,${b64}`;
  a.download = `product-${name.toLowerCase().replace(/\s+/g, "-")}.png`;
  a.click();
}

function downloadAll(results) {
  results.filter(r => r?.status === "ok").forEach((r, i) => {
    setTimeout(() => downloadImage(r.image, r.name), i * 250);
  });
}

export function ProductPhotosTab() {
  const [apiKey,   setApiKey]   = useState("");
  const [preview,  setPreview]  = useState(null);
  const [file,     setFile]     = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [progress, setProgress] = useState(0);
  const [results,  setResults]  = useState([]);
  const [error,    setError]    = useState(null);
  const fileRef = useRef();

  const handleFile = (f) => {
    if (!f || !f.type.startsWith("image/")) return;
    setFile(f); setResults([]); setError(null);
    const reader = new FileReader();
    reader.onload = e => setPreview(e.target.result);
    reader.readAsDataURL(f);
  };

  const generate = async () => {
    if (!file)         return setError("Please upload a product image first.");
    if (!apiKey.trim()) return setError("Please enter your Stability AI API key.");
    setLoading(true); setError(null); setResults([]); setProgress(10);

    const fd = new FormData();
    fd.append("image", file);
    fd.append("api_key", apiKey.trim());

    const ticker = setInterval(() => setProgress(p => Math.min(p + 5, 85)), 3000);
    try {
      const res = await fetch(`${API}/product-photos/generate/`, { method: "POST", body: fd });
      clearInterval(ticker); setProgress(100);
      const data = await res.json();
      if (!res.ok) return setError(data.error || "Generation failed.");
      setResults(data.results || []);
    } catch {
      clearInterval(ticker);
      setError("Network error — is the Django server running on port 8000?");
    } finally { setLoading(false); }
  };

  const successResults = results.filter(r => r?.status === "ok");

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>

      {/* Header */}
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 800, mb: 0.5 }}>AI Product Photography</Typography>
        <Typography variant="body2" color="text.secondary">
          Upload one product photo and get 10 professional AI-generated images with different backgrounds and aesthetics.
        </Typography>
      </Box>

      {/* API Key + Upload row */}
      <Grid container spacing={2.5}>
        <Grid item xs={12} md={6}>
          <Card elevation={1}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Stability AI API Key</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Get your free key at{" "}
                <Typography component="span" sx={{ color: "#2563EB", fontFamily: "monospace", fontSize: 12 }}>
                  platform.stability.ai
                </Typography>
              </Typography>
              <TextField fullWidth size="small" type="password" placeholder="sk-..."
                value={apiKey} onChange={e => setApiKey(e.target.value)}
                inputProps={{ style: { fontFamily: "monospace", fontSize: 13 } }} />
              <Typography variant="caption" color="text.disabled" sx={{ mt: 0.75, display: "block" }}>
                Your key is never stored — only used for this session.
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card elevation={1} sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Product Image</Typography>
              <Box
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
                onClick={() => fileRef.current?.click()}
                sx={{
                  border: `2px dashed ${dragging ? C.orange : "#CBD5E1"}`,
                  borderRadius: 2, p: 2,
                  bgcolor: dragging ? C.orangeLight : "grey.50",
                  cursor: "pointer", transition: "all 0.2s",
                  display: "flex", alignItems: "center", gap: 2,
                }}
              >
                {preview ? (
                  <>
                    <Box component="img" src={preview} alt="preview"
                      sx={{ width: 64, height: 64, objectFit: "contain", borderRadius: 1.5, border: "1px solid", borderColor: "divider" }} />
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{file?.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {(file?.size / 1024).toFixed(1)} KB · click to change
                      </Typography>
                    </Box>
                  </>
                ) : (
                  <Box sx={{ flex: 1, textAlign: "center" }}>
                    <Typography sx={{ fontSize: 28, mb: 0.75 }}>📸</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>Drop image or click to upload</Typography>
                    <Typography variant="caption" color="text.secondary">PNG, JPG, WEBP supported</Typography>
                  </Box>
                )}
              </Box>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => handleFile(e.target.files[0])} />
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Generate button + progress */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <Button variant="contained" size="large" onClick={generate}
          disabled={loading || !file || !apiKey.trim()} disableElevation sx={{ minWidth: 200 }}>
          {loading ? "Generating…" : "Generate 10 Images"}
        </Button>
        {loading && (
          <Box sx={{ flex: 1, maxWidth: 320 }}>
            <LinearProgress variant="determinate" value={progress} sx={{ mb: 0.75, height: 8, borderRadius: 99 }} />
            <Typography variant="caption" color="text.secondary">
              AI is generating your images — this takes ~30–60 seconds…
            </Typography>
          </Box>
        )}
        {successResults.length > 0 && !loading && (
          <Button variant="contained" color="success" disableElevation onClick={() => downloadAll(results)}>
            Download All ({successResults.length})
          </Button>
        )}
      </Box>

      {/* Error */}
      {error && <Alert severity="error">{error}</Alert>}

      {/* Style preview grid (before generation) */}
      {!loading && results.length === 0 && (
        <Card elevation={1}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 2 }}>10 Aesthetic Styles Will Be Generated</Typography>
            <Grid container spacing={1.5}>
              {STYLE_LABELS.map((label, i) => (
                <Grid item xs={6} sm={4} md={2.4} key={i}>
                  <Paper variant="outlined" sx={{ p: 1.5, textAlign: "center", bgcolor: "grey.50" }}>
                    <Typography sx={{ fontSize: 22, mb: 0.5 }}>{STYLE_ICONS[i]}</Typography>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>{label}</Typography>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </CardContent>
        </Card>
      )}

      {/* Loading skeleton grid */}
      {loading && (
        <Grid container spacing={2}>
          {Array.from({ length: 10 }).map((_, i) => (
            <Grid item xs={6} sm={4} md={2.4} key={i}>
              <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 3, overflow: "hidden" }}>
                <Skeleton variant="rectangular" sx={{ aspectRatio: "1/1", width: "100%" }} animation="wave" />
                <Box sx={{ p: 1.5, textAlign: "center" }}>
                  <Typography sx={{ fontSize: 18, mb: 0.25 }}>{STYLE_ICONS[i]}</Typography>
                  <Typography variant="caption" color="text.secondary">{STYLE_LABELS[i]}</Typography>
                </Box>
              </Box>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Results grid */}
      {results.length > 0 && !loading && (
        <Box>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
            <Typography variant="subtitle2">
              Generated Images
              <Chip label={`${successResults.length}/10`} size="small" color="success" sx={{ ml: 1 }} />
            </Typography>
          </Box>
          <Grid container spacing={2}>
            {results.map((r, i) => (
              <Grid item xs={6} sm={4} md={2.4} key={i}>
                <Card elevation={1} sx={{ overflow: "hidden" }}>
                  {r?.status === "ok" ? (
                    <>
                      <Box sx={{ aspectRatio: "1/1", overflow: "hidden" }}>
                        <Box component="img"
                          src={`data:image/png;base64,${r.image}`}
                          alt={r.name}
                          sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      </Box>
                      <Box sx={{ p: 1.25, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <Typography variant="caption" sx={{ fontWeight: 600 }}>{r.name}</Typography>
                        <Button size="small" variant="outlined" sx={{ minWidth: 0, py: 0.25, px: 1, fontSize: 11 }}
                          onClick={() => downloadImage(r.image, r.name)}>
                          Save
                        </Button>
                      </Box>
                    </>
                  ) : (
                    <Box sx={{ p: 2.5, textAlign: "center", aspectRatio: "1/1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                      <Typography sx={{ fontSize: 28, mb: 1 }}>⚠️</Typography>
                      <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>{STYLE_LABELS[i]}</Typography>
                      <Typography variant="caption" color="error" sx={{ mt: 0.5 }}>Generation failed</Typography>
                    </Box>
                  )}
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}
    </Box>
  );
}
