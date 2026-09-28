# CRM workspace expansion

Product direction discussed with Mario on 2026-09-28. This extends the Product Context, Technical Blueprint and Implementation Architecture. Company, Deal and People remain distinct records. A board is a view or workflow over those records; it never duplicates them.

## Navigation and board types

The sidebar groups Investment Pipeline, Boards, Companies and People under CRM. **+ Create board** lets an authorized user choose a name, record type and columns. Investment Pipeline remains the principal process for investment Deals. Other boards can track committee preparation, founder follow-up, LP outreach or tasks, with behavior appropriate to their records.

Three behaviors must remain explicit:

| Type | Card movement |
| --- | --- |
| Investment Pipeline | Changes the Deal's real `stage_id` and writes status history with actor and time. Outcome and relationship state remain separate. |
| Independent board | Changes only this board's card membership/column. The investment stage is unchanged. A Deal can appear on multiple boards. |
| Field-grouped saved view | Groups existing records by a named field (such as priority). Dragging edits that field only when editable; otherwise dragging is disabled. A filtered view like “My Deals” is not another copy of Deals. |

Users can create, rename, archive and reorder boards; create, rename, color and reorder whole columns with their displayed cards; add/remove existing records without deleting them; and drag cards across columns. Reordering a column does not change card status. Removing a populated column must require reassignment or an explicit safe archive. Card fields, filters, sorting and counts should be configurable. Provide a select/dropdown alternative to dragging for keyboard and touch use. Personal and shared views require explicit permissions on the underlying records.

The current migration introduces **shared independent Deal boards** first. Their columns are not investment stages. The principal Pipeline remains backed by `pipeline_stages` and `deals.stage_id`. Task boards (To do / Doing / Done) need a richer task status model than today's open/done. LP outreach should use People/LP relationships, not investment Deals. Additional genuine investment pipelines with distinct stage sets require an explicit process model. Scott and Francis must confirm final stages, including `IC Review`, `Closing`, and the meaning of `Completed`.

## Deal preview

Clicking a Pipeline or Deal-board card opens a large accessible overlay while the board remains visible behind it. Show Deal name, Company, stage, owner, priority, potential investment, last activity and next action. **Open full deal** goes to the existing shareable `/companies/{companyId}/deals/{dealId}` page; **View company** goes to its Company record. Escape, close button and backdrop return to the board. Never include restricted documents or portfolio details in a preview for a member lacking access.

## Other CRM capabilities

| Capability | Intended behavior | Current position |
| --- | --- | --- |
| Next action | Assigned follow-up with due date visible on Deal/board and overdue in Overview. | Tasks exist; surface them consistently. |
| Saved views and custom fields | Personal/shared filters, table/Kanban layouts, card fields and business fields. | Basic Pipeline filters exist; durable views remain. |
| Relationship history | Consolidate activity by Person and Company, relationship owner and possible warm introductions. | People and manual activity exist; sync and graph remain. |
| Stage rules | Show required inputs and optionally create tasks or notifications on stage entry. | Stage history and some diligence requirements exist; reusable rules remain. |
| LP outreach | Own workflow for prospects linked to People, communications and investments. | LP flag/drafts exist; workflow remains. |
| Search/quick actions | Find People, Companies and Deals globally; add notes/tasks in context. | Dedicated pages exist; universal search remains. |
| Analytics | Time per stage, stale Deals, movement, outcomes, owner and investment potential. | Overview exists; process metrics remain. |
| Templates | Start from Investment Deal, LP Outreach or Tasks, then customize. | Later, once each record workflow exists. |
| Connected activity | Authorized Gmail/Outlook and calendars attach activity and update last interaction. | Provider connections and sync remain separate roadmap work. |

## Delivery order and open decisions

1. CRM navigation and Deal preview over Pipeline.
2. Persistent independent Deal boards with column and card management, verified RLS, no stage mutation.
3. Primary Pipeline stage administration, saved views and card customization.
4. Next-action surfaces, LP and Task boards, stage requirements.
5. Relationship intelligence, search, templates and reporting.

Decide who can create shared versus personal boards; whether another Deal board is an independent workflow or a genuine additional investment pipeline; final stage taxonomy; who edits stage rules; and LP outreach stages. Initially, Admin creates shared boards and active members can move their cards. The pending manual-interaction PR #12 and migration 0024 remain a separate integration; do not assume they are on `main`.
