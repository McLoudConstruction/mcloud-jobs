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

export function PersonIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="10" cy="7" r="3.3" />
      <path d="M3.5 17c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
    </svg>
  );
}

export function CalculatorIcon(props) {
  return (
    <svg {...common} {...props}>
      <rect x="4" y="2.5" width="12" height="15" rx="1.5" />
      <path d="M6.5 5.5h7" />
      <path d="M6.5 9.2h1.3M9.35 9.2h1.3M12.2 9.2h1.3" />
      <path d="M6.5 12.2h1.3M9.35 12.2h1.3M12.2 12.2v3" />
      <path d="M6.5 15.2h1.3M9.35 15.2h1.3" />
    </svg>
  );
}

export function MessagesIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M3 4.5h14a1 1 0 011 1v8a1 1 0 01-1 1H8l-4 3.5v-3.5H3a1 1 0 01-1-1v-8a1 1 0 011-1z" />
      <path d="M6 8.5h8M6 11.5h5" />
    </svg>
  );
}

export function InvoiceIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M5.5 2.5h9v15l-2.2-1.5-2.3 1.5-2.3-1.5-2.2 1.5v-15z" />
      <path d="M7.7 6.2h4.6M7.7 9h4.6M7.7 11.8h3" />
    </svg>
  );
}

export function SunIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="10" cy="10" r="3.6" />
      <path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1L4.7 4.7" />
    </svg>
  );
}

export function MoonIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M16.5 12.3A7 7 0 018 4.2c0-.5 0-1 .1-1.5A7.5 7.5 0 1017.9 12a7 7 0 01-1.4.3z" />
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
    <svg {...common} {...props} fill="currentColor" stroke="none">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M 15.27 7.82 L 17.31 8.84 L 17.31 11.16 L 15.27 12.18 L 15.99 14.35 L 14.35 15.99 L 12.18 15.27 L 11.16 17.31 L 8.84 17.31 L 7.82 15.27 L 5.65 15.99 L 4.01 14.35 L 4.73 12.18 L 2.69 11.16 L 2.69 8.84 L 4.73 7.82 L 4.01 5.65 L 5.65 4.01 L 7.82 4.73 L 8.84 2.69 L 11.16 2.69 L 12.18 4.73 L 14.35 4.01 L 15.99 5.65 Z M 12.3 10 A 2.3 2.3 0 1 0 7.7 10 A 2.3 2.3 0 1 0 12.3 10 Z"
      />
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
