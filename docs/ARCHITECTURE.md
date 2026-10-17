# Architecture and implementation

The application is an n8n workflow backed by a dependency-free JavaScript report engine. It converts one uploaded class CSV into a teacher-only review page and one WhatsApp draft link per student who has a valid parent phone number.

![Components and data flow](assets/workflow.svg)

## Components

| Component | Responsibility | Location |
| --- | --- | --- |
| Teacher form | Collect school, class, teacher, reporting period, and one CSV file. | Form Trigger node |
| CSV extraction | Decode UTF-8 and preserve the original header as a row. | Extract from File node |
| Report engine | Validate the whole batch, generate messages, and build escaped review HTML. | `src/report-engine.js`, embedded in Code node |
| Review page | Display individual records, messages, phone status, and draft links. | Form completion node |
| WhatsApp | Open the addressed draft; the teacher verifies and presses Send. | Parent chat outside n8n |
| Workflow builder | Combine node configuration and engine code into an importable JSON file. | `scripts/build-workflow.js` |
| Local runtime | Host n8n and preserve its database between restarts. | `compose.yaml`, `n8n_data` volume |

The sticky-note node explains usage in the editor and performs no processing.

## Data flow

1. The teacher submits metadata and a CSV through the form.
2. The extraction node emits items whose `json.row` contains each CSV row, including the header.
3. The Code node reads form metadata from `$('Teacher details and student CSV').first().json` and gathers all rows using `$input.all()`.
4. `buildReports(table, settings)` validates form settings, headers, rows, student IDs, phone formatting, and homework counts.
5. Only after the complete batch passes validation does it create report objects and the review HTML.
6. The completion node renders `html`. The teacher opens one student's link at a time.

## Engine interface

```javascript
const { buildReports, CSV_COLUMNS } = require('./src/report-engine');

const table = [CSV_COLUMNS, [
  'STU001', 'Example student', 'Example parent', '',
  '4', '5', 'Mathematics: 38/50',
  'One assignment is pending.', 'Please help complete the assignment.',
]];

const result = buildReports(table, {
  school_name: 'Example School',
  class_name: '6 A',
  teacher_name: 'Example Teacher',
  report_period: 'Example week',
});
```

| Output | Meaning |
| --- | --- |
| `student_count` | Number of validated student records. |
| `ready_count` | Number with a formatted parent phone and a draft link. |
| `reports` | Individual student IDs, names, parents, phones, messages, status, and URLs. |
| `html` | Complete escaped review document. |

Statuses are `ready_for_review` and `missing_phone`. Neither status means sent or delivered.

## Validation and limits

The batch contains 1–45 student rows. Student IDs are required and compared case-insensitively for uniqueness. Names and IDs are limited to 120 characters. Form settings are required and limited to 160 characters each. Results, concerns, and parent actions are limited to 1,000 characters each.

CSV headers may be reordered; leading/trailing header whitespace and a UTF-8 byte-order mark are handled. `parent_name` and `parent_action` are optional columns. Duplicate, missing required, and unknown headers are rejected. Completely blank rows are ignored, while other rows must have the expected number of cells.

Homework counts must both be present or both be blank. Present values must be nonnegative whole numbers, and completed work cannot exceed assigned work. `0,0` explicitly means no homework assigned. Blank counts mean the information is not recorded.

Phone formatting removes accepted punctuation and an international `+` or `00` prefix. The remaining number must contain 8–15 digits and start with a nonzero digit. This is a format check; it cannot prove country-code correctness, ownership, or WhatsApp registration. The teacher supplies the full international number.

## Design decisions

**One shared engine.** The builder embeds the source file directly into the workflow. A test executes that exact embedded code in an n8n-shaped environment so the shipped workflow and tested engine stay aligned.

**Deterministic messages.** The teacher's structured data already contains the required facts. No language model, vector database, retrieval step, or generated academic assessment is needed. Results are reproduced as supplied rather than converted into unprovided grades or percentages.

**Whole-batch validation.** A bad row stops the run before links are generated. The teacher corrects the data and submits again instead of receiving a silently truncated class.

**Explicit human sending.** WhatsApp click-to-chat creates a draft addressed to a supplied number. n8n does not sign into WhatsApp or send through an unofficial browser session.

**Escaped output.** Every dynamic value inserted into HTML is escaped. Messages use `encodeURIComponent` in draft URLs, preserving Unicode, newlines, and URL punctuation. Shared parent numbers are flagged so the teacher can distinguish siblings.

## Storage and operational boundary

This project defines no separate student database. n8n can retain submissions, uploaded binary files, and report output in its own execution storage. An operator must configure retention and protect access for real school use. Stopping the Compose service preserves its named volume.

The supplied port binding is `127.0.0.1:5678:5678`, so the service is available on the host computer. A remote deployment needs its own HTTPS, authentication, and operational configuration. Publishing the repository does not deploy n8n.
