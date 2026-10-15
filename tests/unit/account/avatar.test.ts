import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Avatar as WebAvatar } from "../../../web/src/ui/Avatar";

vi.mock("@/tw", () => ({
  Text: ({ children }: { children: React.ReactNode }) => createElement("span", null, children),
  View: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
}));
vi.mock("@/tw/image", () => ({
  Image: ({ source }: { source: string }) => createElement("img", { src: source }),
}));

// Il componente reale resta nel test; i tipi NativeWind sono già controllati
// dal typecheck dell'app. Importarli anche nel grafo test supera il limite TS2590.
const mobileModule = "../../../src/components/ui/Avatar.tsx";
const { Avatar: MobileAvatar } = await import(mobileModule) as {
  Avatar: ComponentType<{ uri: string | null; name: string }>;
};

const backend = "https://fixture.supabase.co";
const avatar = `${backend}/storage/v1/object/public/avatars/user/1.jpg`;
const render = {
  mobile: (url: string | null) => renderToStaticMarkup(createElement(MobileAvatar, { uri: url, name: "Ada Rossi" })),
  web: (url: string | null) => renderToStaticMarkup(createElement(WebAvatar, { url, name: "Ada Rossi" })),
};

describe.each(["mobile", "web"] as const)("avatar %s", (client) => {
  beforeEach(() => vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", backend));
  it.each([
    "https://esempio.invalid/pixel.png",
    "https://altro.supabase.co/storage/v1/object/public/avatars/user/1.jpg",
    "https://fixture.supabase.co.evil.invalid/storage/v1/object/public/avatars/user/1.jpg",
    `${backend}/storage/v1/object/public/staff-documents/user/1.jpg`,
    "data:image/png;base64,invalid",
    null,
  ])("usa le iniziali senza creare un'immagine per %s", (url) => {
    const html = render[client](url);
    expect(html).not.toContain("<img");
    expect(html).toContain("AR");
  });
  it("mostra la foto del bucket avatars del progetto configurato", () => {
    expect(render[client](avatar)).toContain(`<img src="${avatar}"`);
  });
  it("accetta anche una configurazione con slash finale", () => {
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", backend + "/");
    expect(render[client](avatar)).toContain(`<img src="${avatar}"`);
  });
  it("non carica immagini quando manca la configurazione", () => {
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", "");
    expect(render[client](avatar)).not.toContain("<img");
  });
});
