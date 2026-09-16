# web-review — sito pubblico di recensione (Componente B)

Pagina statica, **separata dall'app Expo**, che il cliente finale apre dopo aver
scansionato il QR del cameriere. Scrive nella tabella `reviews` di Supabase via
**anon key** (la RLS `"reviews: public insert"` consente l'insert anonimo su un
`waiter_id` che sia un cameriere). Nessuno step di build: `@supabase/supabase-js`
è caricato da CDN (`esm.sh`).

## File
- `index.html` — markup (loading / errore / form / successo)
- `styles.css` — stile (design tokens AURA)
- `app.js` — logica: legge `?w=<waiterId>`, carica `waiter_public_cards`, inserisce la recensione
- `config.js` — URL Supabase + anon key (pubblici per definizione: protetti dalla RLS)

## URL
Il cameriere condivide / mostra nel QR:
```
https://<host>/?w=<waiterId>
```
`<waiterId>` è l'UUID del profilo cameriere (`profiles.id`). L'app lo costruisce
in `src/app/(waiter)/qr.tsx` usando `EXPO_PUBLIC_REVIEW_SITE_URL`.

## Sviluppo locale
```bash
cd web-review
python3 -m http.server 8080
# apri http://localhost:8080/?w=<id-di-un-cameriere-reale>
```
Deve combaciare con `EXPO_PUBLIC_REVIEW_SITE_URL` in `.env` (default `http://localhost:8080`).

## Deploy (prod)
Qualsiasi static host gratuito, es. Cloudflare Pages / Vercel / Netlify:
carica la cartella `web-review/` come sito statico (nessun build command, output
dir = cartella stessa). Poi imposta nell'app `EXPO_PUBLIC_REVIEW_SITE_URL` all'URL
risultante (senza slash finale), es. `https://recensioni.klokshift.com`.

## Prerequisito DB
Richiede le migration `20260703120000_reviews.sql` e
`20260703120100_waiter_public_cards.sql` applicate al progetto Supabase.
