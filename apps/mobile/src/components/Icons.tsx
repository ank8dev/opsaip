// 16px line icons on a 1.5px stroke, the same drawing grid as the web's Icons.tsx.
// The ones the web already has are copied path for path.

import type { ReactNode } from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

interface P {
  color: string;
  size?: number;
  strokeWidth?: number;
}

function Icon({ color, size = 20, strokeWidth = 1.5, children }: P & { children: ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </Svg>
  );
}

export const MessageIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M2.25 4.5a2.25 2.25 0 0 1 2.25-2.25h7a2.25 2.25 0 0 1 2.25 2.25v4.75a2.25 2.25 0 0 1-2.25 2.25H7l-3 2.5v-2.5h0a1.75 1.75 0 0 1-1.75-1.75z" />
  </Icon>
);

export const TeamIcon = (p: P) => (
  <Icon {...p}>
    <Circle cx="6" cy="6" r="2.5" />
    <Path d="M1.75 13.5c.5-2.4 2.2-3.75 4.25-3.75s3.75 1.35 4.25 3.75" />
    <Path d="M10.5 3.75a2.5 2.5 0 0 1 0 4.75M12 9.9c1.2.5 2 1.6 2.25 3.6" />
  </Icon>
);

export const MemoryIcon = (p: P) => (
  <Icon {...p}>
    <Rect x="2.75" y="2.25" width="10.5" height="11.5" rx="2.25" />
    <Path d="M5.5 5.75h5M5.5 8h5M5.5 10.25h3" />
  </Icon>
);

export const ArrowUpIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M8 13V3.25M3.75 7.5 8 3.25l4.25 4.25" />
  </Icon>
);

export const MicIcon = (p: P) => (
  <Icon {...p}>
    <Rect x="5.75" y="1.75" width="4.5" height="8" rx="2.25" />
    <Path d="M3.25 7.75a4.75 4.75 0 0 0 9.5 0M8 12.5v1.75" />
  </Icon>
);

export const ComposeIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M8 2.75H4.5a1.75 1.75 0 0 0-1.75 1.75v7a1.75 1.75 0 0 0 1.75 1.75h7a1.75 1.75 0 0 0 1.75-1.75V8" />
    <Path d="M11.6 2.15a1.2 1.2 0 0 1 1.7 1.7L8.25 8.9l-2.1.45.45-2.1z" />
  </Icon>
);

export const CheckIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M3.5 8.4l2.9 2.85 6.1-6.5" />
  </Icon>
);

export const ChevronDownIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M4.5 6.25 8 9.75l3.5-3.5" />
  </Icon>
);

export const ChevronRightIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M6.25 4.5 9.75 8l-3.5 3.5" />
  </Icon>
);

export const DesktopIcon = (p: P) => (
  <Icon {...p}>
    <Rect x="1.75" y="2.75" width="12.5" height="8" rx="1.5" />
    <Path d="M5.75 13.5h4.5M8 10.75v2.75" />
  </Icon>
);

export const MergeIcon = (p: P) => (
  <Icon {...p}>
    <Circle cx="4.5" cy="3.5" r="1.75" />
    <Circle cx="4.5" cy="12.5" r="1.75" />
    <Circle cx="11.5" cy="9" r="1.75" />
    <Path d="M4.5 5.25v5.5M4.5 5.5c0 2.5 2.5 3.5 5.25 3.5" />
  </Icon>
);

export const HashIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M6.25 2.25 5 13.75M11 2.25 9.75 13.75M2.75 5.75h11M2.25 10.25h11" />
  </Icon>
);

export const StatusIcon = (p: P) => (
  <Icon {...p}>
    <Rect x="2.25" y="2.25" width="11.5" height="11.5" rx="3" />
    <Path d="M5.25 8.25l1.9 1.9 3.6-4" />
  </Icon>
);

export const PackageIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M8 1.9 13.5 5v6L8 14.1 2.5 11V5z" />
    <Path d="M2.5 5 8 8.1 13.5 5M8 8.1v6" />
  </Icon>
);

export const PlugIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M5.5 1.75v3M10.5 1.75v3" />
    <Path d="M3.75 4.75h8.5v2.5a4.25 4.25 0 0 1-8.5 0z" />
    <Path d="M8 11.5v2.75" />
  </Icon>
);

export const ClockIcon = (p: P) => (
  <Icon {...p}>
    <Circle cx="8" cy="8" r="5.75" />
    <Path d="M8 4.75V8l2.25 1.5" />
  </Icon>
);

export const UndoIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M5.25 3.75 2.5 6.5l2.75 2.75" />
    <Path d="M2.75 6.5h6.5a3.75 3.75 0 0 1 0 7.5H7" />
  </Icon>
);

export const ArrowUpRightIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M5 11 11 5M6 5h5v5" />
  </Icon>
);

/** Drawn on a 24px grid and scaled to 16, so the stroke is scaled back up to match. */
export const GearIcon = ({ strokeWidth = 1.5, ...p }: P) => (
  <Icon {...p} strokeWidth={strokeWidth}>
    <G scale={2 / 3} strokeWidth={strokeWidth * 1.5}>
      <Path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <Circle cx="12" cy="12" r="3" />
    </G>
  </Icon>
);

export const PlusIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M8 3v10M3 8h10" />
  </Icon>
);

export const CloseIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </Icon>
);

export const TerminalIcon = (p: P) => (
  <Icon {...p}>
    <Rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
    <Path d="M4.5 6.5 6.5 8l-2 1.5M8.5 10h3" />
  </Icon>
);

export const MegaphoneIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M2.5 6.5v3h2l5 3v-9l-5 3z" />
    <Path d="M12 6a2.5 2.5 0 0 1 0 4M4.75 9.5l.75 3.25" />
  </Icon>
);

export const PhotoIcon = (p: P) => (
  <Icon {...p}>
    <Rect x="2" y="2.75" width="12" height="10.5" rx="2" />
    <Circle cx="5.75" cy="6.25" r="1.1" />
    <Path d="M2.5 11.5 6 8.5l2.5 2 2-1.5 3 2.5" />
  </Icon>
);

export const CameraIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M2 5.75A1.75 1.75 0 0 1 3.75 4h1.5l1-1.5h3.5l1 1.5h1.5A1.75 1.75 0 0 1 14 5.75v5.5A1.75 1.75 0 0 1 12.25 13h-8.5A1.75 1.75 0 0 1 2 11.25z" />
    <Circle cx="8" cy="8.5" r="2.25" />
  </Icon>
);

export const FileIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M9 1.75H4.75A1.5 1.5 0 0 0 3.25 3.25v9.5a1.5 1.5 0 0 0 1.5 1.5h6.5a1.5 1.5 0 0 0 1.5-1.5V5z" />
    <Path d="M9 1.75V5h3.25" />
  </Icon>
);

export const AtIcon = (p: P) => (
  <Icon {...p}>
    <Circle cx="8" cy="8" r="2.5" />
    <Path d="M10.5 8v1a1.75 1.75 0 0 0 3.5 0V8a6 6 0 1 0-2.4 4.8" />
  </Icon>
);

export const BellIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M4 7a4 4 0 0 1 8 0c0 3 1.25 4.25 1.25 4.25H2.75S4 10 4 7z" />
    <Path d="M6.5 13.25a1.6 1.6 0 0 0 3 0" />
  </Icon>
);
