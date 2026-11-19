import React from "react";
import { C } from "../../App";
import { TabbedPage } from "../shared/SubTabs";
import { useAccess } from "../../contexts/AccessContext";

/*
 * Pages made of what used to be separate pages, each tab loaded only when it opens
 * and shown only to whoever may use it:
 *   Meesho Inventory   live stock on Meesho (pause, stock to 0 and back) + Meesho Stock (stock sheets)
 *   Ads & analysis     campaigns, spend, true ROI, auto-pause + which SKUs the ads pay for
 *   Business Settings  the business profile, Meesho setup (accounts, automation, schedule), Flipkart setup
 */

const MEESHO = "/meesho-orders";
const lazy = (load, name) => React.lazy(() => load().then((m) => ({ default: name ? m[name] : m.default })));

const MeeshoHubTab = lazy(() => import("./MeeshoHubTab"), "MeeshoHubTab");
const MeeshoInventoryTab = lazy(() => import("./MeeshoInventoryTab"), "MeeshoInventoryTab");
const MeeshoLeaveTab = lazy(() => import("./MeeshoLeaveTab"), "MeeshoLeaveTab");
const MeeshoAdsTab = lazy(() => import("./MeeshoAdsTab"), "MeeshoAdsTab");
const AdsAnalysisTab = lazy(() => import("./AdsAnalysisTab"), "AdsAnalysisTab");
const BusinessProfilePage = lazy(() => import("../BusinessProfile/BusinessProfilePage"));
const FlipkartAccounts = lazy(() => import("./FlipkartSellerTab"), "FlipkartAccounts");
const FlipkartAutomationPage = lazy(() => import("./FlipkartSellerTab"), "FlipkartAutomationPage");

// Flipkart setup, as Meesho's: the logins, and the automation — when orders are accepted, when labels are
// printed and sent to Telegram, and RTD (?part=automation).
const FlipkartSetup = () => (
  <TabbedPage param="part" tabs={[
    { key: "accounts", label: "Seller Hub accounts", icon: "🔑", Component: FlipkartAccounts, color: "#2874F0" },
    { key: "automation", label: "Automation & Telegram", icon: "⏱", Component: FlipkartAutomationPage, color: "#2874F0" },
  ]} />
);

const LiveInventory = () => <MeeshoHubTab forceSection="inventory" />;
const MeeshoSetup = () => <MeeshoHubTab forceSection="settings" />;

const Title = ({ children, sub }) => (
  <div>
    <h1 style={{ fontSize: 22, fontWeight: 900, color: C.gray900, margin: 0 }}>{children}</h1>
    {sub && <p style={{ fontSize: 13, color: C.gray500, margin: "4px 0 0", maxWidth: 860 }}>{sub}</p>}
  </div>
);

export function MeeshoInventoryPage() {
  const { isPathVisible } = useAccess();
  return (
    <TabbedPage
      header={<Title sub="What's live on Meesho and its stock — pause what doesn't sell, hold stock at 0 and give it back — and the stock sheets to upload.">Meesho inventory</Title>}
      tabs={[
        { key: "live", label: "Live stock", icon: "▤", Component: LiveInventory, hidden: !isPathVisible(MEESHO) },
        { key: "stock", label: "Stock sheets", icon: "⊞", Component: MeeshoInventoryTab, hidden: !isPathVisible("/meesho-inventory") },
        // Every live catalog paused for a while, kept paused, and brought back at the end.
        { key: "leave", label: "Leave", icon: "🏖", Component: MeeshoLeaveTab, color: "#EA580C",
          hidden: !isPathVisible(MEESHO) && !isPathVisible("/meesho-inventory") },
      ]}
    />
  );
}

export function AdsPage() {
  const { isPathVisible } = useAccess();
  return (
    <TabbedPage
      header={<Title sub="Every campaign and catalog with its true ROI (after GST and what an order really nets), the auto-pause rule — and, by SKU, whether the ads pay for themselves.">Ads &amp; analysis</Title>}
      tabs={[
        { key: "campaigns", label: "Campaigns & ROI", icon: "📣", Component: MeeshoAdsTab, hidden: !isPathVisible(MEESHO) },
        { key: "skus", label: "SKU ads analysis", icon: "◬", Component: AdsAnalysisTab, hidden: !isPathVisible("/") && !isPathVisible(MEESHO) },
      ]}
    />
  );
}

export function BusinessSettingsPage() {
  const { isPathVisible } = useAccess();
  return (
    <TabbedPage
      header={<Title sub="This business's details, and its marketplace logins: Meesho (accounts, automation and sync schedule) and Flipkart Seller Hub.">Business settings</Title>}
      tabs={[
        { key: "profile", label: "Business profile", icon: "⌂", Component: BusinessProfilePage, hidden: !isPathVisible("/business-profile") },
        { key: "meesho", label: "Meesho setup", icon: "🛍", Component: MeeshoSetup, color: "#9F2089", hidden: !isPathVisible(MEESHO) },
        { key: "flipkart", label: "Flipkart setup", icon: "🛒", Component: FlipkartSetup, color: "#2874F0", hidden: !isPathVisible("/flipkart-seller") },
      ]}
    />
  );
}
