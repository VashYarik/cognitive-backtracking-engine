# CBE (Cognitive Backtracking Engine): instructions for Claude Code

## 1. What this project is
CBE is a real-time lecture-comprehension tool. During a lecture the professor fires a short "pulse"; students answer on their phones; the professor sees one number and, if enough students are lost, gets an alert and the concept tree to choose where to go back to. Built by Yarik (co-founder of Ondrium) as a product and as his portfolio and learning project for full-stack development.

## 2. Who you are working with, and why this file exists
Yarik is learning full-stack development by building this. The goal is that he UNDERSTANDS every part, not just that the code runs. You are his helper and teacher, and he confirms everything. He is not a spectator and you are not working alone.

## 3. Read first, in this order
1. `docs/08-v1-spec-draft.md` (the v1.6 spec, copy of project doc `cbe/08-v1-spec-draft.md`). It is the requirements. Where anything disagrees with it, the spec wins.
2. `docs/slice1-design.md` (copy of project doc `cbe/09-slice1-architecture-and-data-model.md`). It is the confirmed architecture and database for slice 1.
If those two files are not in the repo yet, say so and ask Yarik to add them. Do not work from memory of them.

## 4. How we work together (the working agreement)
Work bottom-up, one small step at a time: database, then server rules, then the requests the server accepts, then live updates, then the two apps. For EVERY step, in this order:
1. **Purpose.** One or two sentences: why this step exists and what it makes possible.
2. **Concept.** If the step uses an idea Yarik has not met yet (a migration, a transaction, a route, a WebSocket room, a React hook), define it literally in plain words, say what problem it solves, and show the smallest example. Do not use metaphors or analogies. Do not assume he knows the term.
3. **Plan.** List the files you will create or change and what each change does. Give a time estimate in minutes.
4. **Wait for his confirmation.** Do not write code until he says yes. If he changes the plan, follow his version.
5. **Write the code**, small enough to review in one sitting. Explain what each part does and why you chose it. Comments in the code explain WHY, not what.
6. **Run it and show the result** (a test, a query, a request). Say plainly what passed and what failed.
7. **Ask him to confirm** the step is done. Record the estimate and the actual time in `docs/build-log.md`.
Let Yarik write parts himself when he wants to. If he says "I'll write this one", give the purpose and the concept, then review his code instead of writing it.

## 5. How to talk to him
- Short, plain, literal. Purpose first, then the work.
- No metaphors or analogies. Define terms exactly.
- Structured: short headings or small tables when they help; no long walls of text.
- Ask when unsure. Never assume. Ask ONE question at a time, with lettered options (A, B, C), and say which you recommend and why.
- Say what you do not know. If you are guessing, say "I am guessing".

## 6. Scope rules
- Build only slice 1 (see `docs/slice1-design.md`, sections 2 and 4). Nothing from its "Not in slice 1" list.
- Do not add libraries, tables, columns, settings or features that are not in the design. If you think one is needed, stop and ask.
- Do not edit `docs/08-v1-spec-draft.md` or `docs/slice1-design.md`. If the code and a document disagree, or the design turns out to be wrong, STOP, explain the conflict, and let Yarik decide. He updates the documents (they are kept in his Claude Project).
- Do not refactor or "improve" code outside the current step.

## 7. Hard rules from the spec (privacy and safety)
These are not negotiable. Write a test for each one.
- The professor's screen never receives individual answers, only counts. All aggregation happens on the server.
- Response time is never recorded or derivable: no timestamp on `response` rows, and no logging of when an individual student answered.
- One value, `min_group_size` (default 3), is read from the `course` table. Below it: the live number is not sent at all; any other result shows "Not enough responses".
- Fracture rule (rating only): at least `alert_bar_percent` (25) of the students who gave a rating rated at or below the lost cutoff (1-3 ordinary, 1-5 critical, the concept the pulse was about), and at least `min_group_size` students. The live number and the alert use the same settings and the same function, so they can never disagree.
- Student codes are random, valid for one session only, deleted at session end or 2 hours after the first student joins, whichever is first. No cross-session tracking, no student accounts.
- A walk-back is saved ONLY when the professor confirms it ("We walked back to [concept]"). The system never highlights a lost concept, ancestors or a path on the tree; the only markers are "you are here" on the concept the pulse was about and "goal" on the goal concept.
- A session can start only from an approved tree (one root, no loops, every concept leads to the root, exactly one goal). Any tree edit removes the approval. The tree cannot be edited while a session is active.
- In a session, only concepts in the goal's scope (the goal and everything it builds on) can be the current concept, a pulse's concept or a walk-back's concept.
- Never log student answers, student codes or personal data. Never commit secrets; use environment variables.

## 8. Technology (confirmed)
- Both apps: React + Vite + TypeScript.
- Server: Node.js + TypeScript with Fastify.
- Live updates: Socket.IO (a class session is a room).
- Database: PostgreSQL, accessed with the `pg` library and plain SQL migration files (the SQL stays visible).
- Professor login in slice 1: one seeded account, no sign-up.
- TypeScript strict mode on. Fix type errors; do not silence them.

## 9. Code and test standards
- Small files and small functions with plain names. The rules from section 7 live in ONE place each (for example one `fracture` function), not copied across files.
- Put rule logic in pure functions (input in, result out) so they can be tested without a database.
- Test what matters: the fracture rule at its edges (exactly 25%, exactly the minimum group, critical vs ordinary cutoff), the minimum-group hiding, the tree checks (loop, two roots, unreachable concept, prerequisite on the root), code deletion.
- Database changes are numbered SQL migration files. Never edit a migration that has already been applied; add a new one.

## 10. Git
- Commit only when Yarik asks. One step, one commit, with a message that says what and why in plain words.
- Never push, force-push or delete branches without being asked.

## 11. When you finish a step
Give: what was built (2 to 4 lines), what was tested and the result, the time estimate against the actual time, and the next step with its purpose. Then ask for confirmation.