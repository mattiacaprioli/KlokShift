-- Chat keyset pagination: l'ordinamento è (created_at desc, id desc) con tie-break
-- su id. Estende l'indice esistente (conversation_id, created_at desc) per coprire
-- anche il tie-break senza sort aggiuntivo.
create index if not exists messages_conversation_created_id_idx
  on public.messages (conversation_id, created_at desc, id desc);
