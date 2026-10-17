# Demonstration and viva preparation

## Suggested seven-minute presentation

| Time | Topic | Show |
| --- | --- | --- |
| 0:00–1:00 | Problem and objectives | Teachers repeat similar reporting work but must preserve each student's identity and facts. |
| 1:00–2:00 | Architecture | Form → CSV extraction → validation/report engine → review → WhatsApp draft. |
| 2:00–4:00 | Working demonstration | Upload the two-student sample and compare the generated reports. |
| 4:00–5:00 | Implementation | Engine, builder, inactive export, and CSV rules. |
| 5:00–6:00 | Verification | 21 tests and the recorded live integration result. |
| 6:00–7:00 | Limits and extensions | Human sending, no delivery tracking, no historical student database. |

## Demonstration script

1. Start Docker and run `docker compose up -d` before presenting.
2. Open the n8n editor and show the four processing nodes plus the instruction note.
3. Start a test execution or open the published local teacher form.
4. Enter the example metadata and upload `examples/students.csv`.
5. Compare Aarav's 4/5 homework with Sita's 5/5 and their different exam marks.
6. Explain why each sample displays Phone needed. Do not invent or use random real phone numbers.
7. Run `node --test` and show the 21 passing tests.
8. Show `docs/PROJECT_REPORT.pdf` and the repository documentation.

Use `examples/report-preview.html` as a clearly labeled offline fallback if the local server cannot be started. It demonstrates presentation, not a new hosted execution.

## Viva questions and answers

**What does the system automate?** It validates an uploaded class CSV and prepares a separate fact-based report and addressed draft link for each student. Sending remains a teacher action in WhatsApp.

**Why n8n?** Its form, file extraction, Code node, and completion page provide a connected workflow without building a separate web server and upload interface.

**Why use JavaScript inside a workflow tool?** The Code node provides explicit batch rules and testable message generation. Keeping the logic in a source module supports local tests and reproducible export generation.

**Why no AI or RAG?** Required facts already exist in structured CSV fields. Deterministic mapping preserves them directly; no document search or generated assessment is needed.

**How do you prevent reports going to the wrong parent?** A single validated row carries the student ID, name, parent, and phone together. Mapping tests cover 45 records; the teacher still verifies the actual recipient because code cannot establish phone ownership.

**What happens if two students have the same parent number?** Both reports are retained and the review page warns that the number is shared. Different student IDs remain required.

**What happens if a mark is blank?** It becomes Not recorded rather than zero or a guessed result.

**Why reject the whole batch?** A clear validation error makes the teacher correct an invalid upload before preparing parent links. The system does not silently drop or truncate students.

**Is the system secure?** It escapes HTML output, validates input, uses example-only repository data, and binds the local server to localhost. Real deployment still requires access controls, retention policies, and operational protection.

**Where is data stored?** The project has no separate student database. n8n may store uploaded data and outputs in execution history inside its persistent Docker volume.

**Can it confirm a message was sent?** No. A click-to-chat URL is a draft launcher, and the workflow receives no sent, delivery, or read events.

**What has actually been tested?** Twenty-one automated tests pass. A live two-student upload passed through the hosted form and generated both reports; real WhatsApp sending was not tested.

**What would you add next?** A configurable class size, teacher authentication for remote hosting, student history, retention controls, and an explicitly authorized official messaging integration with delivery events.
