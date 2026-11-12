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
      { path: '/meesho', label: 'Meesho Overview', icon: '◧', end: true, access: MEESHO, accessLabel: 'Meesho (every page in this group)' },
      // Pending, Ready to ship, Shipped and Cancelled — tabs of one page.
      { path: '/meesho/orders', label: 'Meesho Orders', icon: '📦', access: MEESHO },
      // Its own permission, so it can be given alone; the whole-Meesho permission shows it too.
      { path: '/meesho-linking', label: 'Order Linking', icon: '🔗', alsoBy: MEESHO },
      // Every order and its state by dispatch day — its own permission too, like Order Linking.
      { path: '/orders-panel', label: 'Orders Panel', icon: '🗂', alsoBy: MEESHO },
      { path: '/meesho/returns', label: 'Meesho Returns', icon: '↩', access: MEESHO },
      // Return rate by parent SKU / SKU / flag / reason from Meesho's own returns data, and how to stop the loss.
      { path: '/meesho/return-analysis', label: 'Return Analysis (Meesho)', icon: '📉', access: MEESHO },
      { path: '/meesho/otps', label: 'Delivery OTPs', icon: '🔑', access: MEESHO },
      { path: '/meesho/inventory', label: 'Meesho Inventory', icon: '▤', access: MEESHO },
      { path: '/meesho/payments', label: 'Meesho Payments', icon: '₹', access: MEESHO },
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
      { path: '/', label: 'Overview', icon: '◈', end: true },
      { path: '/combined-dashboard', label: 'Combined Dashboard', icon: '🧩' },
      { path: '/sku-analysis', label: 'SKU Analysis', icon: '↗' },
      { path: '/ads-analysis', label: 'Ads Analysis', icon: '◬' },
      { path: '/estimated-profit', label: 'Estimated Profit', icon: '🧮' },
      { path: '/flipkart-profit', label: 'Flipkart Profit', icon: '🛍️' },
      { path: '/daily-profit', label: 'Daily Profit', icon: '📅' },
      { path: '/return-analysis', label: 'Return Analysis', icon: '⤺' },
      { path: '/customer-insights', label: 'Customer Insights', icon: '👥' },
      { path: '/insights', label: 'Business Insights', icon: '💡' },
    ],
  },
  {
    label: 'Operations',
    color: '#34D399',
    items: [
      { path: '/orders', label: 'Orders', icon: '⊡' },
      { path: '/order-scan', label: 'Order Scan', icon: '⌗' },
      { path: '/scan-lookup', label: 'Listing Lookup', icon: '🔎' },
      { path: '/payments', label: 'Payments', icon: '◎' },
      { path: '/unscheduled', label: 'Unscheduled Pay', icon: '◷' },
      { path: '/unsettled', label: 'Unsettled', icon: '⚡' },
      { path: '/mismatch', label: 'Pay Mismatch', icon: '⊝' },
      // '/labels' (single-file Labels) is intentionally not listed here — the
      // route still works if linked to directly, but Bulk Labels (now just
      // "Labels" below) covers the same job and is the one the sidebar shows.
      { path: '/bulk-labels', label: 'Labels', icon: '⊟' },
      { path: '/returns', label: 'Returns & Claims', icon: '⟲' },
      { path: '/return-scan', label: 'Return Scan', icon: '⇲' },
      { path: '/return-claim', label: 'Raise Return Claim', icon: '📨' },
      // What's on each labels PDF (automatic or generated) — also for anyone with Order Scan.
      { path: '/label-items', label: 'Labels Downloaded', icon: '📋', alsoBy: '/order-scan' },
      { path: '/claims', label: 'Claim Sheet', icon: '₹' },
      { path: '/tasks', label: 'Team Tasks', icon: '☑' },
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
      { path: '/tax-check', label: 'Tax Check', icon: '%' },
      { path: '/gst', label: 'GST', icon: '₹' },
      { path: '/inventory', label: 'Inventory', icon: '⊕' },
      { path: '/inventory-labels', label: 'Labels & Barcodes', icon: '▥' },
      { path: '/meesho-inventory', label: 'Meesho Stock', icon: '⊞' },
      { path: '/meesho-pricing', label: 'Price Update', icon: '₹' },
      { path: '/purchases', label: 'Purchases', icon: '⊗' },
      { path: '/expenses', label: 'Expenses', icon: '⊜' },
    ],
  },
  {
    label: 'Tools',
    color: '#FBBF24',
    items: [
      { path: '/upload', label: 'Upload Data', icon: '⇧' },
      { path: '/product-photos', label: 'AI Photos', icon: '✦' },
      { path: '/quadrant-cropper', label: 'Quadrant Cropper', icon: '✂️' },
      { path: '/extension', label: 'Browser Extension', icon: '⧉' },
      { path: '/bulk-listing', label: 'Bulk Listing', icon: '🧾' },
      { path: '/claim-video-tool', label: 'Claim Video Tool', icon: '🎬' },
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
  isPathVisible(accessOf(item)) || (!!item.alsoBy && isPathVisible(item.alsoBy));

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
