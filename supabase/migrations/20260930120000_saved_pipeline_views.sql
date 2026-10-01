-- Extends saved_views (20260930100000) to a second object_type: Pipeline.
-- Same table, same RLS, same ownership/sharing rules — a View is a filter
-- spec regardless of which list it's saved against.
alter table public.saved_views drop constraint saved_views_object_type_check;
alter table public.saved_views add constraint saved_views_object_type_check
  check (object_type in ('people','pipeline'));
