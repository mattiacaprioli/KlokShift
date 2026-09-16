-- Insert e update su `staff_members` falliscono tutti con 42P17.
--
-- «infinite recursion detected in policy for relation "staff_members"»: la
-- `with check` di 20260916110000 (§8) verifica che la persona sia del titolare
-- della sede con una join su `staff_people`. Da 20260916130000 (§4) però
-- `staff_people` ha una policy di SELECT, «delegate reads venue people», che
-- legge `staff_members`. Postgres espande le policy di `staff_people` dentro
-- quelle di `staff_members`, ci ritrova `staff_members` e si ferma.
--
-- Non c'entra chi scrive: si ferma anche il titolare, perché le policy di SELECT
-- si espandono tutte prima di sapere quale passerà. Da quel giorno erano rotti
-- «+ Aggiungi» (insert), il «Salva» di ruoli e impiego sulla card di una sede e
-- «Rimetti in organico» (update). Restavano in piedi solo le scritture che
-- passano da una RPC DEFINER, come `remove_staff_member`.
--
-- Il ciclo si rompe da questa parte, non togliendo la policy di `staff_people`:
-- quella serve ai collaboratori per vedere le persone delle loro sedi. Qui il
-- controllo diventa una funzione DEFINER che legge `venues` e `staff_people`
-- senza RLS, e quindi senza espandere niente. La condizione è la stessa di
-- prima, spezzata in due: la sede è fra quelle che gestisco, e la persona è del
-- titolare di quella sede.
--
-- In `private` e non in `public`, come `private.waiter_public_cards_src`: in
-- `public` PostgREST la esporrebbe come RPC, e risponderebbe a chiunque «questa
-- persona è del titolare di questa sede?» per id arbitrari.

create or replace function private.staff_person_fits_venue(
  p_person uuid,
  p_venue uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.venues v
      join public.staff_people p on p.owner_id = v.owner_id
     where v.id = p_venue
       and p.id = p_person
  );
$$;

revoke execute on function private.staff_person_fits_venue(uuid, uuid) from public;
grant  execute on function private.staff_person_fits_venue(uuid, uuid) to authenticated;

comment on function private.staff_person_fits_venue(uuid, uuid) is
  'La persona appartiene al titolare della sede. DEFINER per non espandere la RLS di staff_people dentro le policy di staff_members (42P17).';

drop policy if exists "staff_members: owner insert" on public.staff_members;
create policy "staff_members: owner insert"
  on public.staff_members for insert
  to authenticated
  with check (
    staff_members.venue_id in (select public.my_venue_ids('staff'))
    and private.staff_person_fits_venue(staff_members.person_id, staff_members.venue_id)
  );

drop policy if exists "staff_members: owner update" on public.staff_members;
create policy "staff_members: owner update"
  on public.staff_members for update
  to authenticated
  using (staff_members.venue_id in (select public.my_venue_ids('staff')))
  with check (
    staff_members.venue_id in (select public.my_venue_ids('staff'))
    and private.staff_person_fits_venue(staff_members.person_id, staff_members.venue_id)
  );
