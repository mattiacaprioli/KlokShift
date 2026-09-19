-- Ore effettive del singolo assegnato quando diverse dal pianificato
-- (es. uscita anticipata o straordinario). NULL = usa la durata pianificata del
-- turno (start_time -> end_time). Nessun dato economico: si tracciano solo ore.
alter table public.shift_assignments
  add column if not exists worked_hours numeric(5, 2);

comment on column public.shift_assignments.worked_hours is
  'Ore effettive svolte dall''assegnato; NULL = durata pianificata del turno.';
