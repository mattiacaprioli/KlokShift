/*
 * Icone come SVG inline: sono poche e piccole, e una libreria costerebbe più
 * del disegno. Tutte 24×24, tratto 1.5, `currentColor` — così ereditano l'oro
 * dalla card senza varianti di colore.
 */

import type { ReactElement } from "react";

export type IconName =
  | "people"
  | "calendar"
  | "grid"
  | "clock"
  | "document"
  | "tag"
  | "check"
  | "swap"
  | "eye"
  | "phone"
  | "desktop"
  | "chat";

const PATHS: Record<IconName, ReactElement> = {
  people: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 14.8c2 .7 3.2 2.4 3.2 4.7" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
      <path d="M7.5 13.5h3M7.5 17h6" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9h17M9 9v10.5M14.5 9v10.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  document: (
    <>
      <path d="M6 3.5h7.5L19 9v11.5H6z" />
      <path d="M13.5 3.5V9H19" />
      <path d="M9 13h6M9 16.5h4" />
    </>
  ),
  tag: (
    <>
      <path d="M4.5 11.2V5.5a1 1 0 0 1 1-1h5.7c.3 0 .5.1.7.3l7 7a1 1 0 0 1 0 1.4l-5.7 5.7a1 1 0 0 1-1.4 0l-7-7a1 1 0 0 1-.3-.7Z" />
      <circle cx="8.6" cy="8.6" r="1.1" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.2 2.4 2.4 4.6-4.9" />
    </>
  ),
  swap: (
    <>
      <path d="M4.5 8.5h12M13.5 5.5l3 3-3 3" />
      <path d="M19.5 15.5h-12M10.5 12.5l-3 3 3 3" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 12S6 6.5 12 6.5 21.2 12 21.2 12 18 17.5 12 17.5 2.8 12 2.8 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2.8" width="10" height="18.4" rx="2.4" />
      <path d="M10.8 5.6h2.4" />
    </>
  ),
  desktop: (
    <>
      <rect x="2.8" y="4.5" width="18.4" height="12" rx="2" />
      <path d="M9 20h6M12 16.5V20" />
    </>
  ),
  chat: (
    <>
      <path d="M20.5 11.8c0 3.8-3.8 6.8-8.5 6.8-1 0-2-.1-2.9-.4L4.5 20l1.2-3.3c-1.2-1.2-2-2.8-2-4.6C3.7 8 7.4 5 12 5s8.5 3 8.5 6.8Z" />
    </>
  ),
};

export function Icon({
  name,
  className = "h-6 w-6",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
