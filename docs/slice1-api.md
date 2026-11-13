# CBE Slice 1: Server Requests and Live Events (DRAFT, 2026-11-13)
Status: DRAFT for Yarik's confirmation. Source: spec v1.6 (docs/08-v1-spec-draft.md) and docs/slice1-design.md (decisions 1 to 14). Nothing here is built until confirmed. Items marked OPEN need a decision; they are asked one at a time.

## 1. Purpose
This document lists every request the server accepts in slice 1 (HTTP) and every live event it sends (Socket.IO), with who may call it, what it receives and returns, and which rule it applies. It is the contract between the server and the two apps.

## 2. General rules
- All requests and responses are JSON. Every request body is checked against a schema before any code runs (Fastify built-in validation); a body that does not match is refused with 400.
- Professor requests require the logged-in professor: the session token in the cookie must match an unexpired `professor_session` row (decision 7.2), and a professor can only reach their own courses (spec 5: professor data is private). Another professor's course answers 404, so its existence is not revealed.
- Student requests carry the student code (the random `student_session.id`) in the header `Authorization: Bearer <code>`. A deleted or unknown code answers 401.
- When the database refuses a change, the response carries the rule name, for example `409 { "error": "tree_locked_during_session" }`. The apps turn rule names into plain sentences.
- No response or event sent to the professor ever contains a student code, an individual answer, or a count for a group smaller than `min_group_size` (spec 5, D27).
- Nothing logs answers, student codes or personal data (CLAUDE.md section 7).

## 3. Professor requests (HTTP)
| # | Request | Body | Result | Rules applied |
|---|---|---|---|---|
| P1 | `POST /api/professor/login` | `{ email, password }` | 200; sets an `httpOnly` cookie holding a new random session token (decision 7.2) | One seeded professor; password checked against its `scrypt` hash; wrong email or password gives the same 401 |
| P2 | `POST /api/professor/logout` | none | 204 | Deletes the `professor_session` row, so the token stops working everywhere |
| P3 | `GET /api/courses` | none | the professor's courses with `id`, `name`, `treeApproved` | |
| P4 | `GET /api/courses/:courseId/tree` | none | concepts (`id`, `title`, `isRoot`, `isCritical`, `isGoal`), links, `treeApproved`, ids in the goal's scope | |
| P5a | `POST /api/courses/:courseId/concepts` | `{ title, isRoot?, isCritical?, isGoal? }` | 201 `{ id }` | Tree editing, one request per change (decision 7.1). Every P5 request: refused during a session (`tree_locked_during_session`); removes the approval |
| P5b | `PATCH /api/concepts/:conceptId` | any of `{ title, isRoot, isCritical, isGoal }` | 204 | Setting `isGoal` (or `isRoot`) to true moves the flag: in one transaction the server clears it from the previous concept first, so the professor moves the goal with one tap (spec 3.6). `concept_root_has_no_prerequisites` |
| P5c | `DELETE /api/concepts/:conceptId` | none | 204, or 409 `{ error: "concept_in_use" }` | Refused while the concept still has links, or is used by a past pulse, walk-back or session, so history is never lost |
| P5d | `POST /api/courses/:courseId/links` | `{ conceptId, prerequisiteId }` ("conceptId needs prerequisiteId") | 201 | `prerequisite_no_loop`, `prerequisite_not_on_root`, `prerequisite_not_self`, same course |
| P5e | `DELETE /api/links/:conceptId/:prerequisiteId` | none | 204 | |
| P6 | `POST /api/courses/:courseId/approve` | none | 200 `{ approved: true }` or 422 `{ approved: false, failures }` | `checkTree` (step 8); sets `tree_approved` only on a pass (spec 3.2, D21) |
| P7 | `POST /api/courses/:courseId/sessions` | none | 201 `{ sessionId, joinCode }` | Approved tree only (decision 11); join code unique among active sessions |
| P8 | `PUT /api/sessions/:sessionId/current-concept` | `{ conceptId }` | 204 | Concept in the course and in the goal's scope (decisions 12, 14) |
| P9 | `POST /api/sessions/:sessionId/pulses` | `{ windowSeconds? }` | 201 `{ pulseId }` | Uses the current concept; none set gives 409. One open pulse at a time. Stores wording, `joined_count`, window (default from course, 15 to 60) |
| P10 | `POST /api/pulses/:pulseId/close` | none | 204, closed by `professor` | Only an open pulse |
| P11 | `POST /api/sessions/:sessionId/walk-backs` | `{ conceptId }` | 201 | Saved only by this request, the professor's "We walked back to [concept]" (spec 4.9); concept in the goal's scope |
| P12 | `POST /api/sessions/:sessionId/end` | none | 204 | NEW (not in the design's connection table): sets `ended_at`, closes an open pulse, deletes the session's student codes (spec D24), unlocks the tree (decision 13) |

## 4. Student requests (HTTP)
| # | Request | Body | Result | Rules applied |
|---|---|---|---|---|
| S1 | `POST /api/join` | `{ joinCode }` (6 characters, not case-sensitive, decision 7.4) | 201 `{ studentCode, sessionId }` | Active session only; creates `student_session`; sets `first_student_joined_at` on the first join (starts the 2-hour code lifetime, D24). The app shows the privacy notice once (D25) |
| S2 | `PUT /api/pulses/:pulseId/answer` | `{ p1?: "yes" \| "not_yet", p2?: 1..7 }` | 204, or 409 `{ error: "pulse_closed" }` | Open pulse of the student's own session only. P1 and P2 may arrive in two calls; both go into one `response` row. No time is stored. A late answer gives `pulse_closed` and the app shows "That check has finished, thanks." (spec 4.5) |

## 5. Live events (Socket.IO)
Each session has two rooms: one for the professor (joined only with the professor's login) and one for its students (joined only with a valid student code).

| Event | To | Content | When |
|---|---|---|---|
| `pulse:open` | students | `{ pulseId, p1Text, p1Seconds }` | P9. `p1Seconds` tells the app when to move on from P1 to P2 (decision 7.6) |
| `pulse:closed` | students | `{ pulseId }` | Window over, everyone answered, P10 or P12 |
| `live:number` | professor | `{ pulseId, followingCount, ratingCount, followingPercent }` | Every `live_update_seconds` (5) while the pulse is open, only when `evaluatePulse` has enough ratings (spec 4.6, v1.5) |
| `fracture:alert` | professor | `{ pulseId }` | The first send at which the fracture rule is met; also saves the `fracture_alert` row with the send time and settings (decision 9) |
| `pulse:summary` | professor | `{ pulseId, result }`, where `result` is the final counts or `"not_enough_responses"` | Right after the pulse closes (spec 4.6, D27) |

## 6. Timed work on the server
| Job | What it does | Source |
|---|---|---|
| Answer window | Closes the pulse with `timeout` when `window_seconds` have passed | spec 4.5 |
| Live sends | Every `live_update_seconds`: `evaluatePulse` with the course's current settings, then `live:number` and possibly `fracture:alert` | spec 4.6, 4.7 (v1.5) |
| Early close | Closes the pulse with `all_answered` when every student joined at fire time (`joined_count`) has submitted a P2 rating (decision 7.3). Otherwise the pulse closes at the end of its window | spec 4.5 |
| Code deletion | Deletes a session's student codes 2 hours after `first_student_joined_at`, if the session has not ended before | spec D24 |

## 7. Open decisions
1. DECIDED (Yarik, 2026-11-13): tree editing uses one request per change (P5a to P5e), not one "save the whole tree" request.
2. DECIDED (Yarik, 2026-11-13): server-side sessions. Passwords are stored as `scrypt` hashes (Node built-in `node:crypto`). Login creates a random token stored in a new `professor_session` table (token, professor, expiry) and sent in an `httpOnly` cookie; logout deletes the row. Cookies are read with the official `@fastify/cookie` plugin (version to be checked and pinned when built). Design doc decision 15.
3. DECIDED (Yarik, 2026-11-13): there is no skip button. A student skips a question only by not answering it. The pulse closes early only when every student joined at fire time has submitted a P2 rating; otherwise it closes when the window ends. A student who answers P1 but not P2 leaves a row with P1 only and is not counted as done. To be applied to the spec (4.4, 4.5, 9) with the other spec-affecting decisions of this review.
4. DECIDED (Yarik, 2026-11-13): the join code is 6 characters from a 31-character set: the letters A to Z without O, I and L, and the digits 2 to 9 (no 0 or 1), so no two characters look alike (about 890 million codes). Input is not case-sensitive. Slice 1 uses a typed code only; QR is not in slice 1. To be applied to the spec (9, join flow) with the other spec-affecting decisions of this review.
5. DECIDED (Yarik, 2026-11-13): slice 1 uses one course, seeded together with the professor; there is no "create course" request yet. The professor builds the tree by hand (P5a to P5e). Long-term goal (Yarik): the professor uploads course material in any format and an AI proposes the tree (spec 3.1; format left to design, D16). Room for it: the tree rules and checks (database triggers, `checkTree`, approval) do not depend on how a tree was made, so a future upload-and-propose flow creates concepts and links through the same rules, and the professor edits and approves the proposal as spec 3.2 describes. Nothing is added for it in slice 1.
6. DECIDED (Yarik, 2026-11-13): P1 is shown first. When the student answers it, P2 appears at once. If P1 is not answered within `p1_seconds` (new course setting, default 8, placeholder; shorter than the answer window), the student's screen moves on to P2 without a countdown, and that student's P1 stays empty. The timer runs in the student app; the server never learns whether or when it fired, so no response time is stored. Design doc decision 16. To be applied to the spec (4.4, 9) with the other spec-affecting decisions of this review.

## 8. Change log
- 2026-11-13: first draft (Claude Code).
- 2026-11-13: decision 7.1 (one request per tree change); P5 split into P5a to P5e.
- 2026-11-13: decision 7.2 (server-side professor sessions); P1, P2 and section 2 updated.
- 2026-11-13: decision 7.3 (no skip button; early close only when every joined student has given P2); section 6 updated; open decision 7.6 added.
- 2026-11-13: decision 7.4 (join code format); S1 updated.
- 2026-11-13: decision 7.5 (one seeded course; AI upload kept as the long-term goal).
- 2026-11-13: decision 7.6 (P1 first, P2 after an answer or after 8 seconds); `pulse:open` updated. All open decisions settled.
