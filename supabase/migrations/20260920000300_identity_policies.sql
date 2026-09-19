-- Baseline — 4/N: RLS e GRANT dell'identità.
--
-- Una sola policy di lettura per tabella, tutta espressa con gli helper di
-- `private`. Le scritture NON passano di qui: INSERT/UPDATE/DELETE sono
-- revocati ad anon e authenticated (default privileges di 20260920000000) e
-- riaperti a mano solo dove la scrittura diretta è davvero la scelta giusta —
-- l'elenco è in fondo a questo file. Tutto il resto entra dalle RPC.

-- Un GRANT esplicito per ogni tabella: senza, PostgREST risponde 42501 anche se
-- la policy lo permetterebbe.
grant select on
  public.profiles, public.workspaces, public.venues, public.workspace_members,
  public.member_scope, public.member_hr, public.venue_members,
  public.venue_roles, public.venue_member_roles
to authenticated;

-- ---------------------------------------------------------------------------
-- Lettura
-- ---------------------------------------------------------------------------
create policy "workspaces: members read" on public.workspaces
  for select to authenticated
  using (id in (select private.my_workspace_ids()));

-- Nessuna lettura pubblica: le sedi le vede chi le gestisce e chi ci lavora.
create policy "venues: managers and staff read" on public.venues
  for select to authenticated
  using (
    id in (select private.venues_where('any'))
    or id in (select private.my_work_venue_ids())
  );

create policy "workspace_members: visible read" on public.workspace_members
  for select to authenticated
  using (id in (select private.visible_member_ids()));

create policy "member_scope: managers and self read" on public.member_scope
  for select to authenticated
  using (
    workspace_id in (select private.my_workspace_ids('manage'))
    or member_id in (select private.my_member_ids())
  );

-- Contratto e note: chi può gestire lo staff di quella persona, e la persona
-- stessa per le proprie ore da contratto.
create policy "member_hr: staff managers and self read" on public.member_hr
  for select to authenticated
  using (
    member_id in (select private.my_member_ids())
    or private.can_person(member_id, 'staff')
  );

create policy "venue_members: visible read" on public.venue_members
  for select to authenticated
  using (member_id in (select private.visible_member_ids()));

create policy "venue_roles: managers and staff read" on public.venue_roles
  for select to authenticated
  using (
    venue_id in (select private.venues_where('any'))
    or venue_id in (select private.my_work_venue_ids())
  );

create policy "venue_member_roles: roster and self read" on public.venue_member_roles
  for select to authenticated
  using (
    venue_member_id in (select private.my_venue_member_ids())
    or venue_id in (select private.venues_where('roster'))
  );

create policy "profiles: self and visible read" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or id in (select private.visible_profile_ids())
  );

-- member_invites: nessuna policy, quindi nessun accesso da REST.

-- ---------------------------------------------------------------------------
-- Scritture dirette (l'eccezione, non la regola)
-- ---------------------------------------------------------------------------
-- profiles: solo la propria riga e solo le colonne di profilo. `deleted_at`
-- non è fra queste. La riga nasce dal trigger su auth.users; l'INSERT serve da
-- rete di sicurezza se il trigger, che non deve mai bloccare una registrazione,
-- fosse stato saltato.
create policy "profiles: self insert" on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));
create policy "profiles: self update" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
grant insert (id, full_name) on public.profiles to authenticated;
grant update (
  full_name, avatar_url, phone, bio, city, birth_day, birth_month,
  onboarding_complete, intro_seen, notification_prefs
) on public.profiles to authenticated;

-- venues: modifica dei dati (chi ha «Sede»). workspace_id e closed_at restano
-- fuori dal GRANT: la chiusura è una RPC, il workspace non si sposta.
create policy "venues: venue managers update" on public.venues
  for update to authenticated
  using (id in (select private.venues_where('venue')))
  with check (id in (select private.venues_where('venue')));
grant update (name, address, city, cuisine_type, logo_url, description, staff_sees_planning)
  on public.venues to authenticated;

-- venue_roles: il listino delle mansioni si gestisce direttamente.
create policy "venue_roles: venue managers write" on public.venue_roles
  for all to authenticated
  using (venue_id in (select private.venues_where('venue')))
  with check (venue_id in (select private.venues_where('venue')));
grant insert, update, delete on public.venue_roles to authenticated;
