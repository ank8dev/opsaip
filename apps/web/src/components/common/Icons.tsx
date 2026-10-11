// 16px line icons, drawn on a 1.5px stroke to match the brand.

import type { ReactNode } from 'react';

function Icon({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type P = { className?: string };

export const AgentsIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="8" cy="8" r="5.5" />
    <circle cx="8" cy="8" r="1.75" fill="currentColor" stroke="none" />
  </Icon>
);

export const TeamIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="6" cy="6" r="2.5" />
    <path d="M1.75 13.5c.5-2.4 2.2-3.75 4.25-3.75s3.75 1.35 4.25 3.75" />
    <path d="M10.5 3.75a2.5 2.5 0 0 1 0 4.75M12 9.9c1.2.5 2 1.6 2.25 3.6" />
  </Icon>
);

export const McpIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M5.5 1.75v3M10.5 1.75v3" />
    <path d="M3.75 4.75h8.5v2.5a4.25 4.25 0 0 1-8.5 0z" />
    <path d="M8 11.5v2.75" />
  </Icon>
);

export const RepoIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="4.5" cy="3.5" r="1.75" />
    <circle cx="4.5" cy="12.5" r="1.75" />
    <circle cx="11.5" cy="5.5" r="1.75" />
    <path d="M4.5 5.25v5.5M11.5 7.25c0 2.5-2.5 3-6.25 3.75" />
  </Icon>
);

export const TaskIcon = ({ className }: P) => (
  <Icon className={className}>
    <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="3" />
    <path d="M5.25 8.25l1.9 1.9 3.6-4" />
  </Icon>
);

export const MessageIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M2.25 4.5a2.25 2.25 0 0 1 2.25-2.25h7a2.25 2.25 0 0 1 2.25 2.25v4.75a2.25 2.25 0 0 1-2.25 2.25H7l-3 2.5v-2.5h0a1.75 1.75 0 0 1-1.75-1.75z" />
  </Icon>
);

export const AnnounceIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M2.25 6.25v3.5h2.5l5 3V3.25l-5 3z" />
    <path d="M12 5.75a3 3 0 0 1 0 4.5" />
  </Icon>
);

export const SettingsIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
    <circle cx="10" cy="4.5" r="1.5" />
    <circle cx="6" cy="11.5" r="1.5" />
  </Icon>
);
