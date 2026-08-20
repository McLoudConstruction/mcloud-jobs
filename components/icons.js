// Simple, consistent line icons for nav items. All 20x20, stroke-based,
// currentColor so they inherit nav text color automatically.

const common = {
  width: 18,
  height: 18,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function DashboardIcon(props) {
  return (
    <svg {...common} {...props}>
      <rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="11" y="2.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="2.5" y="11" width="6.5" height="6.5" rx="1.2" />
      <rect x="11" y="11" width="6.5" height="6.5" rx="1.2" />
    </svg>
  );
}

export function SalesIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M2.5 15.5h15" />
      <path d="M3.5 13l4-4.5 3 2.5 5.5-6.5" />
      <path d="M12.5 4.5h3.5v3.5" />
    </svg>
  );
}

export function JobDashboardIcon(props) {
  return (
    <svg {...common} {...props}>
      <rect x="4" y="3.5" width="12" height="14" rx="1.3" />
      <path d="M7.5 2.5h5a.5.5 0 01.5.5v1.5H7V3a.5.5 0 01.5-.5z" />
      <path d="M7 9h6" />
      <path d="M7 12h6" />
      <path d="M7 15h3.5" />
    </svg>
  );
}

export function SubcontractorsIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M3 11a7 7 0 0114 0" />
      <path d="M2.5 11h15v2a1 1 0 01-1 1h-13a1 1 0 01-1-1v-2z" />
      <path d="M8.5 3.5h3" />
    </svg>
  );
}

export function FinanceIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 5.5v9" />
      <path d="M12.5 7.3c0-1-1-1.6-2.5-1.6s-2.5.7-2.5 1.7c0 2.3 5 1 5 3.3 0 1-1 1.7-2.5 1.7s-2.5-.6-2.5-1.6" />
    </svg>
  );
}

export function SettingsIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.8v2.1M10 15.1v2.1M17.2 10h-2.1M4.9 10H2.8M15 15l-1.5-1.5M6.5 6.5L5 5M15 5l-1.5 1.5M6.5 13.5L5 15" />
    </svg>
  );
}

export function SignOutIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M8 17H4.5a1 1 0 01-1-1V4a1 1 0 011-1H8" />
      <path d="M13 14l4-4-4-4" />
      <path d="M17 10H7.5" />
    </svg>
  );
}
