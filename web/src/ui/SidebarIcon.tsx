const PATHS = {
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  planning: "M8 3v4m8-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 9h2m4 0h2m-8 4h2",
  hours: "M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  absence: "M8 3v4m8-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 10h6",
  history: "M3 4v5h5M3.5 9a9 9 0 1 1 .5 7M12 8v4l3 2",
  staff: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm4-3.87a4 4 0 0 1 0 7.74",
  chat: "M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z",
  notifications: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0",
  venue: "M3 21h18M5 21V5l7-2 7 2v16M9 21v-5h6v5M9 7h1m4 0h1m-6 4h1m4 0h1",
  team: "M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 10v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m5-13v6m-3-3h6",
  settings: "m9 3-.5 2.5-2 1.2L4 6l-2 4 2 1.5v1L2 14l2 4 2.5-.7 2 1.2L9 21h6l.5-2.5 2-1.2 2.5.7 2-4-2-1.5v-1l2-1.5-2-4-2.5.7-2-1.2L15 3Zm6 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5M21 12H9",
} as const;

export type SidebarIconName = keyof typeof PATHS;

export function SidebarIcon({ name }: { name: SidebarIconName }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-[18px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
