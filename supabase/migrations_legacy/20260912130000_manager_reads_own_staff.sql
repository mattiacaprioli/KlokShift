-- Il gestore non vede più chi ha in organico: due policy passano dalle
-- candidature, che non esistono più.
--
-- `"profiles: manager sees applicant profiles"` e
-- `"waiter_profiles: manager reads applicants"` (entrambe in 20260910120000)
-- concedono la lettura se esiste una riga in `applications` che lega quel
-- professionista a un turno di un locale del chiamante. Dal 2026-09-12 il
-- marketplace è stato rimosso e in `applications` non scrive più nessuno: la
-- tabella è inerte, l'`exists` è sempre falso, e da quel giorno **ogni** lettura
-- di `profiles`/`waiter_profiles` fatta da un gestore torna vuota.
--
-- Non solleva un errore, ed è per questo che è passata inosservata: PostgREST
-- non distingue «riga filtrata dalla RLS» da «riga assente», e un embed negato
-- torna semplicemente `null`. Cosa si è rotto in silenzio:
--
--   · `getVenueStaff` embedda `waiter:profiles!staff_members_waiter_id_fkey` →
--     null → l'organico mostra «Scheda senza account» a chi l'account ce l'ha
--     eccome, e le foto dei dipendenti sono sparite ovunque lato gestore;
--   · `getTodayAssignments` arriva al rating passando per `profiles` → il voto
--     in «Chi lavora oggi» non compare più;
--   · `(manager)/cameriere/[id]` e la pagina web del professionista non
--     mostrano mai Bio, Specializzazioni e Lingue.
--
-- La chat si è salvata solo perché passa da `get_chat_counterparts`, che è
-- DEFINER e non vede la RLS.
--
-- Il criterio giusto ora è **l'organico**: il gestore legge il profilo di chi
-- lavora per lui. Nessun filtro su `link_status`, di proposito — la scheda si
-- guarda anche prima che l'invito sia accettato, ed è anzi il momento in cui
-- serve. È la stessa scelta già motivata in `"venue_roles: staff read"`.
--
-- Costo: l'`exists` parte da `staff_members.waiter_id`, indicizzata da
-- `staff_members_waiter_idx` (20260712070246). Quello vecchio partiva da
-- `applications` ed era il caso peggiore citato da 20260910120000.

drop policy if exists "profiles: manager sees applicant profiles" on public.profiles;
drop policy if exists "profiles: manager reads own staff" on public.profiles;
create policy "profiles: manager reads own staff"
  on public.profiles for select
  to authenticated
  using (
    -- Il guard sul ruolo resta: da qui si leggono i profili dei professionisti
    -- in organico, non quelli di altri gestori.
    role = 'waiter'::public.user_role
    and exists (
      select 1
        from public.staff_members sm
        join public.venues v on v.id = sm.venue_id
       where sm.waiter_id = profiles.id
         and v.owner_id = (select auth.uid())
    )
  );

drop policy if exists "waiter_profiles: manager reads applicants" on public.waiter_profiles;
drop policy if exists "waiter_profiles: manager reads own staff" on public.waiter_profiles;
create policy "waiter_profiles: manager reads own staff"
  on public.waiter_profiles for select
  to authenticated
  using (
    exists (
      select 1
        from public.staff_members sm
        join public.venues v on v.id = sm.venue_id
       where sm.waiter_id = waiter_profiles.id
         and v.owner_id = (select auth.uid())
    )
  );
