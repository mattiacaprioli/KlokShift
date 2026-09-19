-- Baseline — 3/N: l'oracolo dei permessi.
--
-- UNA sorgente di verità: la view private.member_venue_grants, che dice per ogni
-- (utente, sede) che authority ha e quali permessi. Tutto il resto deriva da lì.
-- Sostituisce my_venue_ids, can_manage_venue, my_delegate_staff_member_ids e la
-- CASE permesso→colonna che era scritta tre volte.
--
-- Regole che tengono i confini (perché la ricorsione RLS 42P17 è già capitata):
--   * ogni helper è `security definer`, `stable`, `set search_path = ''`, in
--     `private` (PostgREST non lo espone come RPC);
--   * le policy chiamano SOLO helper `private.*`, nella forma
--     `col in (select private.x())` — un initplan, valutato una volta;
--   * nessuna policy ha una subquery diretta su un'altra tabella con RLS.

-- Titolare = tutte le sedi con tutti i permessi. Collaboratore = i suoi cinque
-- permessi, su tutte le sedi (scope 'all', anche quelle create dopo) oppure su
-- quelle in member_scope. Conta solo chi è attivo e ha un account: senza
-- auth.uid() a cui agganciarli i permessi non esistono.
--
-- I permessi derivati: 'roster' = turni OPPURE staff (chi può vedere
-- l'organico), 'any' = vede la sede. Un permesso sconosciuto non è mai nell'array,
-- quindi nega da solo.
create view private.member_venue_grants as
select
  m.user_id,
  m.id           as member_id,
  m.workspace_id,
  v.id           as venue_id,
  m.authority,
  case
    when m.authority = 'owner'
      then array['shifts', 'staff', 'hours', 'documents', 'venue', 'roster', 'any']
    else array_remove(array[
      case when m.can_shifts    then 'shifts'    end,
      case when m.can_staff     then 'staff'     end,
      case when m.can_hours     then 'hours'     end,
      case when m.can_documents then 'documents' end,
      case when m.can_venue     then 'venue'     end,
      case when m.can_shifts or m.can_staff then 'roster' end,
      'any'
    ], null)
  end as perms
from public.workspace_members m
join public.workspaces w on w.id = m.workspace_id and w.deleted_at is null
join public.venues v on v.workspace_id = m.workspace_id
where m.user_id is not null
  and m.status = 'active'
  and m.authority <> 'none'
  and (
    m.authority = 'owner'
    or m.scope = 'all'
    or exists (select 1 from public.member_scope s where s.member_id = m.id and s.venue_id = v.id)
  );

-- ---------------------------------------------------------------------------
-- Sedi e azienda
-- ---------------------------------------------------------------------------
-- Le sedi su cui ho quel permesso. Restituisce un elenco e non un booleano:
-- dentro una policy la forma `id in (select …)` è un initplan (una volta sola),
-- un predicato per riga sarebbe rivalutato ad ogni riga.
create function private.venues_where(p_perm text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select g.venue_id
    from private.member_venue_grants g
   where g.user_id = (select auth.uid()) and p_perm = any (g.perms);
$$;

-- Per trigger e RPC, dove serve un sì/no su una sede precisa.
create function private.can(p_venue uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.member_venue_grants g
     where g.user_id = (select auth.uid()) and g.venue_id = p_venue and p_perm = any (g.perms)
  );
$$;

-- Le aziende in cui sono attivo. p_min: 'owner' = titolare, 'manage' = titolare
-- o collaboratore, 'any' (default) = anche chi è solo dipendente.
create function private.my_workspace_ids(p_min text default 'any')
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.workspace_id
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id and w.deleted_at is null
   where m.user_id = (select auth.uid())
     and m.status = 'active'
     and case p_min
           when 'owner'  then m.authority = 'owner'
           when 'manage' then m.authority <> 'none'
           else true
         end;
$$;

-- Sì/no «sono titolare di questa azienda?». Per le RPC: `x not in (select …)`
-- con x nullo darebbe null e NON solleverebbe, un booleano invece nega sempre.
create function private.owns_workspace(p_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id and w.deleted_at is null
     where m.workspace_id = p_workspace
       and m.user_id = (select auth.uid())
       and m.authority = 'owner'
       and m.status = 'active'
  );
$$;

-- Come sopra ma per chi gestisce (titolare o collaboratore).
create function private.manages_workspace(p_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id and w.deleted_at is null
     where m.workspace_id = p_workspace
       and m.user_id = (select auth.uid())
       and m.authority <> 'none'
       and m.status = 'active'
  );
$$;

create function private.venue_workspace(p_venue uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select v.workspace_id from public.venues v where v.id = p_venue;
$$;

-- Gli account a cui va una notifica «per chi gestisce questa sede». Sostituisce
-- absence_managers e notify_venue_managers, che avevano ciascuna la propria CASE.
create function private.managers_of(p_venue uuid, p_perm text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select g.user_id
    from private.member_venue_grants g
   where g.venue_id = p_venue and p_perm = any (g.perms);
$$;

-- ---------------------------------------------------------------------------
-- Io come persona
-- ---------------------------------------------------------------------------
-- Le mie appartenenze, in qualunque stato: chi è uscito legge comunque il
-- proprio storico.
create function private.my_member_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.workspace_members m where m.user_id = (select auth.uid());
$$;

create function private.my_venue_member_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select vm.id
    from public.venue_members vm
    join public.workspace_members m on m.id = vm.member_id
   where m.user_id = (select auth.uid());
$$;

-- Le sedi in cui lavoro adesso (anche se l'invito non è ancora accettato: serve
-- a mostrarne il nome nella card di invito).
create function private.my_work_venue_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select vm.venue_id
    from public.venue_members vm
    join public.workspace_members m on m.id = vm.member_id
    join public.workspaces w on w.id = m.workspace_id and w.deleted_at is null
   where m.user_id = (select auth.uid())
     and m.status <> 'left'
     and vm.left_at is null;
$$;

-- «Non decidi di te stesso, a meno che tu sia il titolare.» L'unico punto in cui
-- la regola vive: la chiamano le RPC di presenze, ore, rimozione, assenze e i
-- trigger di guardia. Vale per il membro, quindi essere titolare di un'altra
-- azienda non dà nessun potere su questa.
create function private.is_restricted_self(p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
     where m.id = p_member and m.user_id = (select auth.uid()) and m.authority <> 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- Chi posso vedere
-- ---------------------------------------------------------------------------
-- Me stesso; tutta l'azienda se ne sono titolare; la squadra di gestione se ne
-- faccio parte; i dipendenti delle sedi di cui posso vedere l'organico.
create function private.visible_member_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.workspace_members m where m.user_id = (select auth.uid())
  union
  select m.id from public.workspace_members m
   where m.workspace_id in (select private.my_workspace_ids('owner'))
  union
  select m.id from public.workspace_members m
   where m.authority <> 'none' and m.workspace_id in (select private.my_workspace_ids('manage'))
  union
  select vm.member_id from public.venue_members vm
   where vm.venue_id in (select private.venues_where('roster'));
$$;

create function private.visible_profile_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.user_id from public.workspace_members m
   where m.user_id is not null and m.id in (select private.visible_member_ids());
$$;

-- Posso agire su questa persona con quel permesso? Il titolare sempre; chi ha
-- il permesso su almeno una sede in cui la persona lavora, se non è titolare a
-- sua volta. Non esclude me stesso: lo decidono le RPC con is_restricted_self.
create function private.can_person(p_member uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
     where m.id = p_member
       and (
         m.workspace_id in (select private.my_workspace_ids('owner'))
         or (
           m.authority <> 'owner'
           and exists (
             select 1 from public.venue_members vm
              where vm.member_id = m.id and vm.venue_id in (select private.venues_where(p_perm))
           )
         )
       )
  );
$$;

grant execute on function
  private.venues_where(text), private.can(uuid, text), private.my_workspace_ids(text),
  private.owns_workspace(uuid), private.manages_workspace(uuid),
  private.venue_workspace(uuid), private.managers_of(uuid, text),
  private.my_member_ids(), private.my_venue_member_ids(), private.my_work_venue_ids(),
  private.is_restricted_self(uuid), private.visible_member_ids(),
  private.visible_profile_ids(), private.can_person(uuid, text)
to authenticated;
