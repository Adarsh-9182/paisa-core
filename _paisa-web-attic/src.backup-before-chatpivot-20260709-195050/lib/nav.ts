import {
  LayoutDashboard,
  Sparkles,
  Wallet,
  ReceiptText,
  Landmark,
  TrendingUp,
  BarChart3,
  Settings2,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  hint: string;
}

export const NAV: NavItem[] = [
  { label: "Overview", href: "/", icon: LayoutDashboard, hint: "Mission control" },
  { label: "Ask AI", href: "/ask", icon: Sparkles, hint: "Your verified CFO" },
  { label: "Money", href: "/money", icon: Wallet, hint: "Cash & transactions" },
  { label: "Invoices", href: "/invoices", icon: ReceiptText, hint: "Receivables & aging" },
  { label: "Taxes & GST", href: "/taxes", icon: Landmark, hint: "Filings & position" },
  { label: "Investments", href: "/investments", icon: TrendingUp, hint: "Treasury & trades" },
  { label: "Reports", href: "/reports", icon: BarChart3, hint: "Statements" },
  { label: "Settings", href: "/settings", icon: Settings2, hint: "Org & policies" },
];
