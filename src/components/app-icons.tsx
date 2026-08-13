import type { ReactNode, SVGProps } from "react";

export type NavigationIconName =
  | "dashboard"
  | "clients"
  | "projects"
  | "timesheets"
  | "reports"
  | "resources"
  | "leave"
  | "calendar"
  | "financials"
  | "expenses"
  | "subscriptions"
  | "invoices"
  | "quotations"
  | "departments"
  | "employees"
  | "roles"
  | "activity"
  | "integrations";

const navigationPaths: Record<NavigationIconName, ReactNode> = {
  dashboard: <><rect height="7" rx="1.5" width="7" x="3" y="3" /><rect height="7" rx="1.5" width="7" x="14" y="3" /><rect height="7" rx="1.5" width="7" x="3" y="14" /><rect height="7" rx="1.5" width="7" x="14" y="14" /></>,
  clients: <><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="4" /><path d="M17 11a4 4 0 0 1 4 4v2M16 3.3a4 4 0 0 1 0 7.4" /></>,
  projects: <><path d="M3 7.5h7l2 2h9v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M3 7.5V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1.5" /></>,
  timesheets: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  reports: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  resources: <><circle cx="9" cy="8" r="3" /><circle cx="17.5" cy="9" r="2.5" /><path d="M3 20v-1a6 6 0 0 1 12 0v1M15 15.5a5 5 0 0 1 6 4.5" /></>,
  leave: <><path d="M7 3v3M17 3v3M4 9h16" /><rect height="17" rx="2" width="16" x="4" y="4" /><path d="m9 14 2 2 4-4" /></>,
  calendar: <><rect height="17" rx="2" width="18" x="3" y="4" /><path d="M8 2v4M16 2v4M3 9h18M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" /></>,
  financials: <><path d="m3 17 5-5 4 4 8-9" /><path d="M15 7h5v5" /></>,
  expenses: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5c-.8-.8-2-1.2-3.5-1.2-1.9 0-3.5 1-3.5 2.5 0 3.8 7 1.7 7 5.4 0 1.5-1.5 2.6-3.6 2.6-1.5 0-2.9-.5-3.8-1.4M12 5v14" /></>,
  subscriptions: <><path d="M20 7h-6a4 4 0 0 0-4 4v1" /><path d="m17 4 3 3-3 3M4 17h6a4 4 0 0 0 4-4v-1" /><path d="m7 20-3-3 3-3" /></>,
  invoices: <><path d="M6 2h8l4 4v16H6Z" /><path d="M14 2v5h5M9 12h6M9 16h6" /></>,
  quotations: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  departments: <><path d="M3 21h18M5 21V7l7-4 7 4v14" /><path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01M10 21v-3h4v3" /></>,
  employees: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /><path d="m18 13 1 1 2-2" /></>,
  roles: <><path d="M12 3 4 6v5c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6Z" /><path d="m9 12 2 2 4-4" /></>,
  activity: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  integrations: <><path d="M8 12h8M12 8v8" /><path d="M7 3v4H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2v4M17 3v4h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2v4" /></>,
};

function IconFrame({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {children}
    </svg>
  );
}

export function NavigationIcon({ name }: { name: NavigationIconName }) {
  return <IconFrame aria-hidden="true">{navigationPaths[name]}</IconFrame>;
}

export function BellIcon() {
  return (
    <IconFrame aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </IconFrame>
  );
}
