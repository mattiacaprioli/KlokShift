import { it } from "./it";
import type { Content } from "./types";

/*
 * Oggi la vetrina è solo in italiano. Quando arrivano inglese e spagnolo si
 * aggiunge `en.ts` / `es.ts` e si sceglie qui la lingua per build (una
 * sottocartella per lingua: vedi README.md). I componenti non cambiano.
 */
export const t: Content = it;

export type { Content } from "./types";
