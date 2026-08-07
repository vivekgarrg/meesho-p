/**
 * The sidebar / route catalog.
 *
 * Lives in its own module (rather than in App.jsx) so contexts and the admin
 * screen can read it without importing App — App imports the contexts, so the
 * other direction would be a cycle.
 *
 * `path` values must match accounts/nav.py on the server, which is the source of
 * truth for access control and rejects paths it doesn't recognise.
 */
export const NAV_GROUPS = [
  {
    label: "Analytics",
    color: "#A78BFA",
    items: [
      { path: "/", label: "Overview", icon: "◈", end: true },
      { path: "/sku-analysis", label: "SKU Analysis", icon: "↗" },
      { path: "/ads-analysis", label: "Ads Analysis", icon: "◬" },
      { path: "/estimated-profit", label: "Estimated Profit", icon: "🧮" },
      { path: "/daily-profit", label: "Daily Profit", icon: "📅" },
    ],
  },
  {
    label: "Operations",
    color: "#34D399",
    items: [
      { path: "/orders", label: "Orders", icon: "⊡" },
      { path: "/order-scan", label: "Order Scan", icon: "⌗" },
      { path: "/payments", label: "Payments", icon: "◎" },
      { path: "/unscheduled", label: "Unscheduled Pay", icon: "◷" },
      { path: "/unsettled", label: "Unsettled", icon: "⚡" },
      { path: "/mismatch", label: "Pay Mismatch", icon: "⊝" },
      { path: "/labels", label: "Labels", icon: "⊟" },
      { path: "/returns", label: "Returns & Claims", icon: "⟲" },
      { path: "/claims", label: "Claim Sheet", icon: "₹" },
      { path: "/tasks", label: "Team Tasks", icon: "☑" },
    ],
  },
  {
    label: "Catalog",
    color: "#60A5FA",
    items: [
      { path: "/pricing", label: "SKU Pricing", icon: "⊞" },
      { path: "/tax-check", label: "Tax Check", icon: "%" },
      { path: "/gst", label: "GST", icon: "₹" },
      { path: "/inventory", label: "Inventory", icon: "⊕" },
      { path: "/inventory-labels", label: "Labels & Barcodes", icon: "▥" },
      { path: "/meesho-inventory", label: "Meesho Stock", icon: "⊞" },
      { path: "/meesho-pricing", label: "Price Update", icon: "₹" },
      { path: "/purchases", label: "Purchases", icon: "⊗" },
      { path: "/expenses", label: "Expenses", icon: "⊜" },
    ],
  },
  {
    label: "Tools",
    color: "#FBBF24",
    items: [
      { path: "/upload", label: "Upload Data", icon: "⇧" },
      { path: "/product-photos", label: "AI Photos", icon: "✦" },
      { path: "/extension", label: "Browser Extension", icon: "⧉" },
      { path: "/fraud", label: "Fraud Watch", icon: "⊘" },
      { path: "/business-profile", label: "Business Profile", icon: "⌂" },
    ],
  },
  {
    label: "Administration",
    color: "#F472B6",
    adminOnly: true,
    items: [
      { path: "/admin", label: "Admin Panel", icon: "⚙", adminOnly: true },
    ],
  },
];

export const ALL_NAV = NAV_GROUPS.flatMap((g) => g.items);

/**
 * Paths an access rule can never hide from a super admin, so an over-restrictive
 * rule can always be undone from the Admin Panel.
 */
export const ALWAYS_VISIBLE_PATHS = ["/admin"];

export const NAV_LABEL_BY_PATH = Object.fromEntries(ALL_NAV.map((i) => [i.path, i.label]));
