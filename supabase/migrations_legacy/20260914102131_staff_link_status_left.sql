-- Uscire dall'organico non è cancellare: `link_status = 'left'`.
--
-- Fino a oggi `leave_venue()` (20260712095720) e la rimozione dal lato titolare
-- facevano `delete from staff_members`. Ma `shift_assignments.staff_member_id` è
-- `on delete cascade` (20260712075549:13), quindi quel delete portava via **tutte**
-- le assegnazioni di quella sede — comprese quelle passate, con dentro
-- `worked_hours`, cioè l'input di `get_owner_hours_summary` e dell'export per il
-- commercialista.
--
-- È esattamente il danno che 20260913110000 (`freeze_assignment_payroll`) era
-- stato scritto per impedire: lì si è chiusa la porta della *riscrittura* delle
-- ore da parte del professionista, mentre questa — la *cancellazione* — era
-- rimasta aperta, e la apriva un link rosso nel suo Profilo.
--
-- E non solo le ore: se era l'ultima sede di quel titolare, il trigger
-- `staff_members_zz_orphan_person` cancellava anche `staff_people`, e con lui i
-- `staff_documents` (HACCP, contratti) per cascata — lasciando i file orfani
-- nello storage, che da SQL non si cancellano.
--
-- Da qui l'appartenenza finita **resta**, con la data in cui è finita. La storia
-- è dell'azienda e non se la porta via chi se ne va.
--
-- ⚠️ Due file e non uno: un valore aggiunto a un enum non è utilizzabile nella
-- stessa transazione che lo aggiunge. Le funzioni che scrivono `'left'` stanno
-- in 20260914102811.

alter type public.staff_link_status add value if not exists 'left';

-- Quando è finita. Serve alla UI ("non più in organico da…") e a distinguere chi
-- se n'è andato ieri da chi non c'è mai entrato.
alter table public.staff_members
  add column if not exists left_at timestamptz;

comment on column public.staff_members.left_at is
  'Istante in cui l''appartenenza è finita (link_status = ''left''). Null finché la persona è in organico.';
