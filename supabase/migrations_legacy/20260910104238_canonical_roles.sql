-- Ruoli canonici: una lista sola per il profilo del professionista
-- (`waiter_profiles.primary_role`) e per l'organico del locale
-- (`staff_members.role`).
--
-- Prima erano due elenchi diversi e il ruolo veniva copiato dall'uno all'altro
-- quando il locale aggiungeva all'organico chi si era candidato. La copertura
-- per ruolo confronta le stringhe esatte, quindi un "Bartender" non ha mai
-- coperto un fabbisogno "Barman": nessun errore, il turno restava scoperto.
--
-- Qui si ripuliscono i valori già scritti. Il codice lato app usa ora una lista
-- unica (`STAFF_ROLES`) e `canonicalRole()` sui ruoli che arrivano da fuori.

-- 1) Alias storici → canonico. "Barista" non è in elenco: è stato aggiunto
--    ai ruoli canonici, quindi i valori esistenti vanno già bene.
update public.staff_members
set role = 'Hostess'
where lower(btrim(role)) = 'host';

update public.staff_members
set role = 'Barman'
where lower(btrim(role)) = 'bartender';

update public.waiter_profiles
set primary_role = 'Hostess'
where lower(btrim(primary_role)) = 'host';

update public.waiter_profiles
set primary_role = 'Barman'
where lower(btrim(primary_role)) = 'bartender';

-- 2) Differenze di sole maiuscole/spazi ("Chef de rang" → "Chef de Rang").
--    I ruoli sconosciuti restano come sono: perdere il dato sarebbe peggio che
--    non farlo combaciare, e restano visibili nella scheda della persona.
with canonical(role) as (
  values
    ('Cameriere'), ('Chef de Rang'), ('Sommelier'), ('Runner'), ('Hostess'),
    ('Barman'), ('Cuoco'), ('Aiuto cuoco'), ('Lavapiatti'), ('Receptionist'),
    ('Guardarobiere'), ('Facchino'), ('Allestitore'), ('Steward'), ('Barista')
)
update public.staff_members s
set role = c.role
from canonical c
where s.role is not null
  and s.role <> c.role
  and lower(btrim(s.role)) = lower(c.role);

with canonical(role) as (
  values
    ('Cameriere'), ('Chef de Rang'), ('Sommelier'), ('Runner'), ('Hostess'),
    ('Barman'), ('Cuoco'), ('Aiuto cuoco'), ('Lavapiatti'), ('Receptionist'),
    ('Guardarobiere'), ('Facchino'), ('Allestitore'), ('Steward'), ('Barista')
)
update public.waiter_profiles w
set primary_role = c.role
from canonical c
where w.primary_role is not null
  and w.primary_role <> c.role
  and lower(btrim(w.primary_role)) = lower(c.role);
