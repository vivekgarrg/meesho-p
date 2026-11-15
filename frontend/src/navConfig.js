/**
 * The sidebar / route catalog.
 *
 * Lives in its own module (rather than in App.jsx) so contexts and the admin
 * screen can read it without importing App — App imports the contexts, so the
 * other direction would be a cycle.
 *
 * `path` values must match accounts/nav.py on the server, which is the source of
 * truth for access control and rejects paths it doesn't recognise — except
 * where an item names its permission in `access`: then that path decides who
 * sees it (the Meesho pages all go by "/meesho-orders", one permission for the
 * whole Meesho group), and `path` is only the page's address. `alsoBy` names a
 * second permission that shows the item too (Order Linking has its own, and
 * comes with the whole-Meesho one).
 */
const MEESHO = '/meesho-orders';
export const NAV_GROUPS = [
  {
    // Every section of the Meesho panel sync, each its own page (MeeshoHubTab).
    label: 'Meesho',
    color: '#F43397',
    items: [
      { path: '/meesho/otps', label: 'Delivery OTPs', icon: '🔑', access: MEESHO, accessLabel: 'Meesho (every page in this group)' },
      { path: '/meesho/inventory', label: 'Meesho Inventory', icon: '▤', access: MEESHO },
      { path: '/meesho/payments', label: 'Meesho Payments', icon: '₹', access: MEESHO },
      { path: '/meesho/ads', label: 'Meesho Ads', icon: '📣', access: MEESHO },
      { path: '/meesho/settings', label: 'Meesho Settings', icon: '⚙', access: MEESHO },
    ],
  },
  {
    // Flipkart Seller Hub, connected (password + OTP) — orders and accepting follow as they're added.
    label: 'Flipkart',
    color: '#2874F0',
    items: [
      { path: '/flipkart-seller', label: 'Flipkart Seller Hub', icon: '🛒' },
    ],
  },
  {
    label: 'Analytics',
    color: '#A78BFA',
    items: [
      // Meesho tab: profit & sales, and the live Meesho panel (it was Meesho Overview).
      { path: '/', label: 'Overview', icon: '◈', end: true, alsoBy: MEESHO },
      { path: '/sku-analysis', label: 'SKU Analysis', icon: '↗' },
      { path: '/daily-profit', label: 'Daily Profit', icon: '📅' },
      // Meesho (its returns, Act now, Losses, reasons & trends) and Flipkart — it was Meesho Returns,
      // Return Analysis and Return Analysis (Meesho).
      { path: '/return-analysis', label: 'Returns', icon: '↩', alsoBy: [MEESHO, '/flipkart-seller'] },
    ],
  },
  {
    label: 'Operations',
    color: '#34D399',
    items: [
      // Meesho tab: live on the panel (it was Meesho Orders) and every order uploaded.
      { path: '/orders', label: 'Orders', icon: '⊡', alsoBy: MEESHO },
      // Every order and its state by dispatch day, Meesho and Flipkart as tabs — its own permission too.
      { path: '/orders-panel', label: 'Orders Panel', icon: '🗂', alsoBy: MEESHO },
      // Meesho scan (linking on Meesho, by default) and Flipkart scan. Order Linking was its own page:
      // whoever could open it, or the whole Meesho group, sees this.
      { path: '/order-scan', label: 'Order Scan', icon: '⌗', alsoBy: ['/meesho-linking', MEESHO] },
      { path: '/scan-lookup', label: 'Listing Lookup', icon: '🔎' },
      { path: '/payments', label: 'Payments', icon: '◎' },
      // '/labels' (single-file Labels) is intentionally not listed here — the
      // route still works if linked to directly, but Bulk Labels (now just
      // "Labels" below) covers the same job and is the one the sidebar shows.
      { path: '/bulk-labels', label: 'Labels', icon: '⊟' },
      { path: '/returns', label: 'Returns & Claims', icon: '⟲' },
      { path: '/return-scan', label: 'Return Scan', icon: '⇲' },
      { path: '/return-claim', label: 'Raise Return Claim', icon: '📨' },
      // What's on each labels PDF (automatic or generated) — also for anyone with Order Scan.
      { path: '/label-items', label: 'Labels Downloaded', icon: '📋', alsoBy: '/order-scan' },
      { path: '/employees', label: 'Employees', icon: '🧑‍💼' },
    ],
  },
  {
    label: 'Catalog',
    color: '#60A5FA',
    items: [
      { path: '/listing-hub', label: 'Listing Hub', icon: '🛍' },
      { path: '/pricing', label: 'SKU Pricing', icon: '⊞' },
      { path: '/master-pricing', label: 'Master Pricing', icon: '🧱' },
      // Hidden: not in the sidebar, but its address still works and it can still be granted.
      { path: '/tax-check', label: 'Tax Check', icon: '%', hidden: true },
      { path: '/gst', label: 'GST', icon: '₹' },
      { path: '/inventory-labels', label: 'Labels & Barcodes', icon: '▥' },
      { path: '/meesho-inventory', label: 'Meesho Stock', icon: '⊞' },
      { path: '/expenses', label: 'Expenses', icon: '⊜' },
    ],
  },
  {
    label: 'Tools',
    color: '#FBBF24',
    items: [
      { path: '/upload', label: 'Upload Data', icon: '⇧' },
      { path: '/quadrant-cropper', label: 'Quadrant Cropper', icon: '✂️' },
      { path: '/extension', label: 'Browser Extension', icon: '⧉' },
      { path: '/bulk-listing', label: 'Bulk Listing', icon: '🧾' },
      { path: '/fraud', label: 'Fraud Watch', icon: '⊘' },
      { path: '/business-profile', label: 'Business Profile', icon: '⌂' },
    ],
  },
  {
    label: 'Administration',
    color: '#F472B6',
    adminOnly: true,
    items: [{ path: '/admin', label: 'Admin Panel', icon: '⚙', adminOnly: true }],
  },
];

export const ALL_NAV = NAV_GROUPS.flatMap((g) => g.items);

/** The permission that decides whether an item shows (see `access` above). */
export const accessOf = (item) => item.access || item.path;

/** Whether an item shows, given isPathVisible(permission). */
export const itemVisible = (item, isPathVisible) =>
  isPathVisible(accessOf(item)) || [].concat(item.alsoBy || []).some((p) => isPathVisible(p));

/** The distinct permissions, in sidebar order — what an access rule can grant. */
export const ALL_PERMISSIONS = [...new Set(ALL_NAV.map(accessOf))];

/**
 * Paths an access rule can never hide from a super admin, so an over-restrictive
 * rule can always be undone from the Admin Panel.
 */
export const ALWAYS_VISIBLE_PATHS = ['/admin'];

export const NAV_LABEL_BY_PATH = Object.fromEntries([
  ...ALL_NAV.map((i) => [i.path, i.label]),
  ...ALL_NAV.filter((i) => i.accessLabel).map((i) => [i.access, i.accessLabel]),
]);
