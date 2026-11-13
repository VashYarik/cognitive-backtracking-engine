# CBE Slice 1: Architecture and Data Model (CONFIRMED by Yarik, 2026-11-11)
Date: 2026-11-11. Source: cbe/08-v1-spec-draft.md (now v1.5, which matches this document). Working method changed on 2026-11-11: Claude drafts, Yarik reviews and confirms. Status: CONFIRMED. The seven spec-comparison decisions (section 6) and the four items in section 5 were each confirmed by Yarik on 2026-11-11. Spec v1.4 was applied the same day (change 08-C4). Changes after confirmation are listed in section 8.

## 1. Purpose of this document
Slice 1 is the smallest end-to-end path through the product. This document fixes (a) the parts of the system and how they communicate, and (b) what the database stores. Everything not listed under "Not in slice 1" waits for a later slice.

## 2. Slice 1 scope
In: professor enters a small concept tree by hand and approves it (the server checks: one root, no loops, every concept leads to the root); professor starts a class session from an approved tree; students join with a code and see the privacy notice once (spec D25); professor sets the current concept and fires a pulse; students answer P1 and P2 (P2 is a slider, spec 4.4); professor sees the one live number; fracture alert; professor opens the whole tree (with "you are here") and confirms a walk-back by tapping "We walked back to [concept]" and picking that concept.
Not in slice 1: AI tree generation; lectures and segments (so the segment check of the validator is also out); professor sign-up (one seeded professor account only); end-of-class tap; quiz results; second-pulse and limits modes; the "Ask again" button after a walk-back (a new pulse can still be fired by hand); the student-facing summary line; the professor's settings screen (settings exist in the database with defaults).

## 3. Architecture
Parts:
1. Professor app: a React client (browser). Purpose: let the professor build the tree, run the session and see results.
2. Student app: a React client (browser). Purpose: let a student join with a code and answer pulses. No login.
3. Server: one Node.js + TypeScript program. Purpose: apply every rule (minimum group size, window closing, fracture rule, tree checks), reading the values from the database, so no client can bypass them. Contains an HTTP API (request/response) and a real-time hub (WebSocket).
4. Database: PostgreSQL. Purpose: permanent storage.
(No AI service in slice 1.)

Connections:
| From | To | Kind | Used for |
|---|---|---|---|
| Professor app | Server | Request/response | log in, save tree, approve tree, start session, set current concept, fire pulse, close pulse, confirm walk-back |
| Server | Professor app | Real-time | live number, alert |
| Student app | Server | Request/response | join with code (receives a random session code), submit answers |
| Server | Student app | Real-time | pulse opens, pulse closes |
| Server | Database | Queries | all reads and writes |

Rule: the professor app only ever receives counts, never individual answers. The apps never talk to the database directly, only through the server. Aggregation happens in the server. The server works out the live number and checks the fracture rule every live_update_seconds (default 5) and once more when the pulse closes, not after each rating (spec 4.6 and 4.7, v1.5). The live number is not sent at all until at least min_group_size ratings are in (spec D27); there is no other hold. Any other result for a group smaller than min_group_size is not sent; the screen shows "Not enough responses" instead.

Technology (confirmed):
- Client: React + Vite + TypeScript.
- Server: Node.js + TypeScript with Fastify (typed requests, built-in input validation).
- Real-time: Socket.IO (a session is a "room"; automatic reconnect helps phones that sleep and wake).
- Database access: the `pg` library with plain SQL migrations (keeps SQL visible, which matters for the ancestor queries and the tree checks).
- Professor login in slice 1: one seeded account, no sign-up.

## 4. Data model (slice 1)
Entities and relations:
```
professor 1---* course 1---* concept
                  |            *---* concept   (via prerequisite)
                  1---* class_session 1---* pulse 1---* response
                              |             \--- 1 fracture_alert
                              1---* student_session --(optional link)--> response
                              1---* walk_back
p1_wording 1---* pulse
```
Tables:
- professor(id, email, password_hash, created_at)
- course(id, professor_id, name, window_seconds default 25 (allowed 15 to 60), lost_cutoff_ordinary default 3, lost_cutoff_critical default 5, alert_bar_percent default 25, min_group_size default 3, live_update_seconds default 5, tree_approved default false)
  - live_update_seconds: how often the server sends the live number and checks the fracture rule during an open pulse (spec 4.6, v1.5). A stored value with no professor screen, like min_group_size.
  - min_group_size: one value used for three things: the fewest ratings before the live number appears, the fewest rating-givers for the fracture rule, and the fewest students for which any result is shown. Default 3 (Yarik, 2026-11-11; spec v1.3 said 5, v1.4 says 3). It is a stored value; in slice 1 there is no settings screen, so it changes only in the database.
  - tree_approved: set to true only by the server after the tree checks pass. Any edit to a concept or prerequisite sets it back to false.
- concept(id, course_id, title, is_root, is_critical default false, is_goal default false). At most one root and at most one goal per course; the root may also be the goal (decision 14). A concept left unmarked counts as ordinary (spec D18).
- prerequisite(course_id, concept_id, prerequisite_id). Primary key (concept_id, prerequisite_id). No self-link; both concepts must belong to the same course. A trigger rejects a link that would create a loop and any prerequisite on the root. No explanation text on links (spec section 3).
- p1_wording(id, text). Slice 1 has one seeded row: "Could you explain the last idea to a classmate right now?"
- class_session(id, course_id, join_code, started_at, first_student_joined_at, ended_at, current_concept_id). Join code unique among active sessions. A session can be created only when the course's tree_approved is true. current_concept_id must belong to the course.
- student_session(id random token, class_session_id, joined_at). Deleted when the session ends, or 2 hours after first_student_joined_at, whichever comes first (spec D24).
- pulse(id, class_session_id, concept_id (the concept the pulse was about), wording_id, joined_count (students joined at fire time), window_seconds, fired_at, closed_at, closed_by: timeout | all_answered | professor). The min_group_size in force is read from course when the pulse fires.
- response(id, pulse_id, student_session_id nullable, p1: yes | not_yet | null, p2: 1..7 | null). Unique (pulse_id, student_session_id). No timestamp column, so no response time can be worked out (spec section 5). When the student_session row is deleted, the link is set to null: the answers stay, the identity link disappears.
- fracture_alert(id, pulse_id, rating_count, lost_count, lost_cutoff, alert_bar_percent, min_group_size, created_at). lost_cutoff, alert_bar_percent and min_group_size are copies of the values the fracture rule used when this alert was raised (lost_cutoff is the ordinary or critical cutoff that applied to the concept the pulse was about). They keep each alert explainable after a setting on course changes (decision 9). created_at is the time of the send (or the pulse close) at which the rule was met, never the time of one rating (spec section 5, v1.5).
- walk_back(id, class_session_id, concept_id (walked back to), confirmed_at). One row is saved only when the professor taps "We walked back to [concept]". There is no alert_id in slice 1; it can be added later if needed.

Tree checks run by the server when the professor taps Approve (spec section 3, D21; the segment check is not in slice 1): exactly one root; no loops; every concept leads back to the root. If a check fails, the screen names the check that failed.

Design decisions inside the model (confirmed):
1. P1 and P2 live in one response row, so a student's two answers are linked without any student identifier surviving the session.
2. Deleting student_session rows at session end or after 2 hours implements "random code valid for one session only".
3. No response-time data anywhere: no timestamp on response rows (spec section 5).
4. Settings live on course with defaults, so a threshold is a value, not a constant in the code.
5. The tree is a concept table plus a prerequisite table. Ancestor queries (later slices) use a recursive SQL query.

## 5. Confirmations (all 2026-11-11)
1. Slice 1 scope and exclusions (section 2): confirmed.
2. The four parts and the connections table (section 3): confirmed.
3. The technology (section 3): confirmed.
4. The tables and the five design decisions (section 4): confirmed.

## 6. Comparison with spec v1.3 and decisions (2026-11-11)
Matches the spec: the pulse flow (P1, P2 to every student); 25-second window, 15 to 60 allowed, early close; rating-only fracture rule with 25% bar and cutoffs 1-3 / 1-5; one live number; professor sees only counts; P1 recorded but not displayed; P1 wording stored per pulse; the whole tree with only a "you are here" marker; walk-back saved only on the professor's confirmation; the two concepts (pulse concept, walk-back concept) kept apart; stack.

Corrected in the draft because it contradicted a hard rule or the spec: response timestamp removed (response time is not recorded); is_critical defaults to false (D18); privacy notice at join added (D25); the live number shows nothing before the minimum is reached and "Not enough responses" applies to other results (D27, still marked "reading to confirm" in the spec); window limited to 15 to 60 seconds.

Decisions by Yarik, all 2026-11-11:
1. Minimum group size: ONE value, 3, for the live number, the fracture rule and the privacy hiding (spec v1.3 said 5 in three places). Applied in spec v1.4. With 3 ratings one student moves the number by about 33 points. Spec D1 says this minimum is not a professor setting; here it is a stored value with no professor screen.
2. Live-number hold: none. Same as spec (D23). No hold column. (Sends at a fixed interval were added on 2026-11-12; see decision 10.)
3. Student code lifetime: as the spec (D24). Deleted at session end or 2 hours after the first student joins, whichever comes first.
4. Linking across pulses: the code stays on every response row until the code is deleted. This was looser than the old wording of spec section 5; v1.4 now states it and says the link is never sent to the professor's screen.
5. Approved tree: a basic approval step is in slice 1 (approved flag, three checks, named failure, session only from an approved tree, any edit removes approval). Segment check not in slice 1.
6. Walk-back without an alert: no alert_id on walk_back in slice 1; add later if needed. The tree and the confirm button open from an alert, as the spec describes.

Decisions by Yarik, 2026-11-12 (from the build start in Claude Code):
8. Row ids: every table, including response, uses an incrementing id. A random id for response was considered (it would hide the order in which students answered) and not chosen. The order stays readable only to someone with database access, and only until the student code is deleted; it is never sent to the professor's screen.
9. Settings used by an alert: fracture_alert stores the lost cutoff, alert bar and minimum group size it was judged by. The live number and the fracture rule read the current values from course while a pulse is open; pulse does not store them.
10. Live-number sends: the live number is sent, and the fracture rule checked, every live_update_seconds (default 5, placeholder) and once on close, not after each rating. Reason: when the number changes after each rating, the professor can tell what the student who just tapped answered, and the alert time marks one student's answer. Applied in spec v1.5 (change 08-C5).
11. Tree-approval rules live in the database (2026-11-13): a trigger on concept and prerequisite sets course.tree_approved to false after any insert, update or delete, and a trigger on class_session rejects a new session when the course's tree_approved is false. Reason: both are hard rules (spec section 3, D20), and a trigger cannot be bypassed by any server code path. The server still sets tree_approved to true only after the tree checks pass.
12. Concepts stay inside their course (2026-11-13): pulse.concept_id and walk_back.concept_id must be concepts of the session's course. A database trigger rejects any other concept (pulse and walk_back have no course_id, so a plain foreign key cannot check it). class_session.current_concept_id is checked by a composite foreign key on (course_id, current_concept_id). No columns added.
13. The tree is locked during a session (Yarik, 2026-11-13): while a course has a session that has not ended (ended_at is empty), no concept or prerequisite of that course can be inserted, changed or deleted; a database trigger rejects the edit. Consequence: a session's tree stays approved for the whole session, so the current concept is always set from an approved tree (spec D20) without a separate check.
14. The goal concept (spec v1.6, 3.6 and 4.15; 2026-11-13): concept gains is_goal (default false) with at most one goal per course (partial unique index). A trigger on class_session (current_concept_id), pulse and walk_back rejects a concept outside the goal's scope (the goal and every concept it builds on, found by a recursive walk from the goal). "Exactly one goal" is checked by the server's tree checks at Approve, because a tree being built may have no goal yet. Moving the goal is an update of concept rows, so the triggers of decisions 11 and 13 already remove the approval and block it during a session.
7. Re-ask after a walk-back (spec 4.10, D3): not in slice 1; a new pulse can be fired by hand.

Spec v1.4 was applied on 2026-11-11 (change 08-C4) with decisions 1, 3 and 4.

## 7. Next steps
1. Done: spec v1.4 applied.
2. Draft the slice 1 API list (the requests the server accepts) and screen sketches, for Yarik's confirmation.
3. Plan the build order with a time estimate per step, compared with actual time afterward.
4. Open: whether Claude also writes the code (earlier agreement was that Yarik writes it while Claude teaches).

## 8. Change log
- 2026-11-11: document confirmed (sections 1 to 7).
- 2026-11-12 (Yarik's decisions 8 and 9, applied by Claude Code with Yarik's permission): section 4, fracture_alert gains lost_cutoff, alert_bar_percent and min_group_size; section 6, decisions 8 (incrementing ids, including response) and 9 (settings stored on the alert only) added.
- 2026-11-12 (Yarik's decision 10, applied by Claude Code with Yarik's permission; matches spec v1.5): section 3, the rule on sending the live number now uses a fixed interval and checks the fracture rule at the same moments; section 4, course gains live_update_seconds default 5 and fracture_alert.created_at is defined as the send time; section 6, decision 2 points to decision 10, and decision 10 added; header source updated to spec v1.5.
- 2026-11-13 (Yarik's decision 11, answer "B", applied by Claude Code with Yarik's permission): section 6, decision 11 added (the tree-approval reset and the approved-tree check for new sessions are database triggers). No table or column changes.
- 2026-11-13 (Yarik's decision 12, answer "A", applied by Claude Code with Yarik's permission): section 6, decision 12 added (a pulse's and a walk-back's concept must belong to the session's course, checked by a trigger). No table or column changes.
- 2026-11-13 (Yarik's decision 13, "tree can't be edited during the session", applied by Claude Code with Yarik's permission): section 6, decision 13 added (concept and prerequisite edits are rejected while the course has an active session). No table or column changes.
- 2026-11-13 (decision 14, from spec v1.6 approved by Yarik, applied by Claude Code): section 4, concept gains is_goal; section 6, decision 14 added (one goal per course, goal-scope trigger on class_session, pulse and walk_back).
