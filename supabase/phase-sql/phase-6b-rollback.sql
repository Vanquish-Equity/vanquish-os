-- Phase 6B: pause first; refuse protected views, applications and audit.

-- Owner only. Pause is committed even if protected-data removal is refused.
begin;
do $$begin if to_regclass('private.customization_configuration') is not null then update private.customization_configuration set views_enabled=false,kanban_enabled=false,templates_enabled=false;end if;end$$;
commit;
begin;
do $$begin if to_regprocedure('private.vt_rollback_guard()') is not null then perform private.vt_rollback_guard();end if;end$$;
-- DROP: only the new v1 guard; v0 rows, grants and CHECKs remain intact.
drop trigger if exists vt_view_guard on public.saved_views;
-- DROP: Phase 6B removal guard only; v0 CRUD remains intact.
drop trigger if exists vt_view_remove_guard on public.saved_views;
-- DROP: only the additional task audit visibility policy; existing audit data retained.
drop policy if exists vt_task_audit_parent on public.audit_log;
-- DROP: Phase 6B functions only; no CASCADE or data repair.
drop function if exists public.apply_task_template(uuid,integer,uuid,uuid,uuid,uuid,boolean,boolean);
-- DROP: Phase 6B function only.
drop function if exists public.save_task_template(uuid,text,text[],text[],boolean,integer);
-- DROP: Phase 6B function only.
drop function if exists public.move_customization_card(uuid,uuid,uuid,integer,uuid,boolean);
-- DROP: Phase 6B function only.
drop function if exists public.customization_view_data(uuid,uuid);
-- DROP: Phase 6B function only.
drop function if exists public.save_customization_view(uuid,text,text,boolean,jsonb);
-- DROP: Phase 6B function only.
drop function if exists public.customization_state();
-- DROP: empty schema only; protected application/journal checks ran above.
drop table if exists public.crm_template_applications;
-- DROP: Phase 6B table only.
drop table if exists public.crm_template_audit_metadata;
-- DROP: unapplied template definitions only.
drop table if exists public.crm_task_templates;
-- DROP: Phase 6B helper only.
drop function if exists private.vt_view_guard();
-- DROP: Phase 6B helper only.
drop function if exists private.vt_template_guard();
-- DROP: Phase 6B helper only.
drop function if exists private.vt_application_guard();
-- DROP: Phase 6B helper only.
drop function if exists private.vt_application_audit();
-- DROP: Phase 6B helper only.
drop function if exists private.vt_rollback_guard();
-- DROP: Phase 6B read helper only.
drop function if exists private.vt_parent_read(uuid,uuid);
-- DROP: Phase 6B helper only.
drop function if exists private.vt_validate_spec(text,jsonb,boolean);
-- DROP: Phase 6B authorization helper only.
drop function if exists private.vt_require(text,boolean);
-- DROP: Phase 6B authorization helper only.
drop function if exists private.vt_enabled(text);
-- DROP: Phase 6B configuration only.
drop table if exists private.customization_configuration;
commit;
