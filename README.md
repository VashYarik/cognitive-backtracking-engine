# CBE: Cognitive Backtracking Engine

A real-time lecture comprehension tool. Students join by QR code and answer quick, anonymous check-ins. The professor sees one live number and, when many students lose the thread, a map of concepts leading back to the course root.

> **Status: early stage.** The version 1 requirements are written and frozen. Architecture and design are next. There is no running code yet.

## The idea

When a lecture builds on earlier ideas, one missed connection can leave part of the class lost for the rest of the hour. Professors usually find out too late, through a quiz or an exam.

CBE aims to catch that moment while the lecture is still happening:

1. **Detect.** The professor fires a short check-in at a natural pause.
2. **Locate.** If enough students are lost, the professor sees the concept tree with the lost concept marked and every prerequisite highlighted back to the course root.
3. **Repair.** The professor decides where to go back to and what to say. CBE shows the structure; the teaching stays with the professor.

## How it works (version 1)

- **Before class:** an LLM proposes a concept tree from the course material. The professor edits and approves it, and a validator checks it (no loops, one root, every concept leads back to the root).
- **During class:** students keep a calm page open on their phone or laptop. When the professor fires a check-in, students answer two quick taps: a yes/no, then a 1 to 7 rating.
- **The professor's view:** one live number, such as "Following: 18 of 24". If it drops below a set bar, the concept tree appears.
- **After class:** an optional one-tap rating of how useful a walk-back was.

## Privacy by design

These are requirements, not afterthoughts:

- The professor can never tell which student answered what. Only totals are shown, and any group smaller than 5 shows "not enough responses".
- Students need no account. Each gets a random code that lasts one session.
- Response time is not recorded.
- Every check-in is skippable, and "not yet" is framed as a normal, useful answer.
- A professor's class data is private to that professor by default.

## Tech stack

| Layer | Choice |
| --- | --- |
| Front end | React |
| Back end | Node.js + TypeScript |
| Database | PostgreSQL |
| Live updates | Real-time connection from server to the professor's screen (WebSockets) |

## How this project is being built

CBE is a solo project and a learning project. It follows a standard professional process, one stage at a time, with each stage written down before the next begins:

- [ ] Foundations
- [ ] Requirements (version 1 spec frozen; being rewritten as numbered, testable requirements)
- [ ] Architecture
- [ ] Detailed design
- [ ] Build
- [ ] Test
- [ ] Release (target: a shareable demo by late 2026)

Every design and code decision is meant to trace back to a numbered requirement, and significant decisions are logged as architecture decision records.

## Author

Built by Yaroslav (Yarik) Vashchuk.

## License

Not yet chosen.
