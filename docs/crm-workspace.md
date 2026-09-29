# CRM workspace expansion

Product direction discussed with Mario on 2026-09-28. This extends the Product Context, Technical Blueprint and Implementation Architecture. Company, Deal and People remain distinct records. A board is a view or workflow over those records; it never duplicates them.

## Navigation and board types

The sidebar groups Investment Pipeline, Boards, Companies and People under CRM. **+ Create board** lets an authorized user choose a name and whether the board can link Deals; lists are added inside the board. Investment Pipeline remains the principal process for investment Deals. Other boards can track committee preparation, founder follow-up, LP outreach or tasks, with behavior appropriate to their records.

Three behaviors must remain explicit:

| Type | Card movement |
| --- | --- |
| Investment Pipeline | Changes the Deal's real `stage_id` and writes status history with actor and time. Outcome and relationship state remain separate. |
| Independent board | Changes only this board's card membership/column. The investment stage is unchanged. A Deal can appear on multiple boards. |
| Field-grouped saved view | Groups existing records by a named field (such as priority). Dragging edits that field only when editable; otherwise dragging is disabled. A filtered view like “My Deals” is not another copy of Deals. |

Users can create, rename, archive and reorder boards; create, rename and reorder whole columns with their displayed cards; add/remove existing records without deleting them; and drag cards across columns. Reordering a column does not change card status. Removing a populated column must require reassignment or an explicit safe archive. Card fields, filters, sorting and counts should be configurable. Provide a select/dropdown alternative to dragging for keyboard and touch use. Personal and shared views require explicit permissions on the underlying records.

The current implementation includes shared general boards with native cards and optional Deal links. Their columns are not investment stages. The principal Pipeline remains backed by `pipeline_stages` and `deals.stage_id`. Task boards (To do / Doing / Done) need a richer task status model than today's open/done. LP outreach should use People/LP relationships, not investment Deals. Additional genuine investment pipelines with distinct stage sets require an explicit process model. Scott and Francis must confirm final stages, including `IC Review`, `Closing`, and the meaning of `Completed`.

As of the current board implementation, native cards support team assignees,
due dates, descriptions and checklists. Linked Deals support multiple team
assignees with avatars. Pipeline supports on-board filters. Board pages support
contextual comments. Saved views, custom fields, task/LP record workflows and
personal boards are still planned rather than available.

Board creation follows the in-board workflow: choose a title and whether to link existing Deals, create an empty board, then add lists and native cards one at a time. Admins can later rename/archive the board, rename/reorder whole lists, and delete only empty lists; populated lists require moving or removing their cards first. Native cards have a title, description, due date and persistent list/order, and can be dragged across lists. Boards that opt into Deal links may contain both native cards and existing Deals; those Deal cards retain their own investment stage. All current boards are shared with the team; private visibility is a future permission model, not a selectable setting yet. The background is the existing neutral workspace design, without user color configuration.

## Deal preview

Clicking a Pipeline or Deal-board card opens a large accessible overlay while the board remains visible behind it. Show Deal name, Company, stage, owner, priority, potential investment, last activity and next action. **Open full deal** goes to the existing shareable `/companies/{companyId}/deals/{dealId}` page; **View company** goes to its Company record. Escape, close button and backdrop return to the board. Never include restricted documents or portfolio details in a preview for a member lacking access.

## Other CRM capabilities

| Capability | Intended behavior | Current position |
| --- | --- | --- |
| Next action | Assigned follow-up with due date visible on Deal/board and overdue in Overview. | Tasks exist; surface them consistently. |
| Deal team | Assign multiple active members to a Deal, show team avatars on Pipeline cards, and filter by member. Preserve the old free-text `deals.owner` for historical records; migrate only unambiguous member names. | Membership and avatar profiles exist; join-table assignments are added in the Deal team migration. |
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

Pipeline's board filter supports text, team member (including "me" or unassigned), priority, stage, overdue next action and no next action. It filters displayed cards only and keeps each Deal's underlying stage intact. Team avatars are visible to active Vanquish members, including other members' profile photos; the Storage read policy is scoped to authenticated active members.

Decide who can create shared versus personal boards; whether another Deal board is an independent workflow or a genuine additional investment pipeline; final stage taxonomy; who edits stage rules; and LP outreach stages. Initially, Admin creates shared boards and active members can move their cards. The manual-interaction PR #12 and migration 0024 remain a separate integration; verify their merge state before relying on them.
