# Testing and observed results

Validation date: **17 October 2026**. The automated suite and the live run cover different boundaries; neither proves WhatsApp delivery.

## Automated verification

```powershell
node scripts/build-workflow.js
node --test
```

Observed result: **21 tests passed; 0 failed; 0 skipped**, using Node.js **22.19.0**. The test file is `tests/report-engine.test.js`.

| Area | Verified behavior |
| --- | --- |
| Report content | Correct student/parent names, homework pending count, exam subjects, concerns, support request, and teacher. |
| Maximum class | All 45 students remain mapped to their own parent, concern, and message. |
| Oversized class | 46 rows are rejected rather than silently cut off. |
| Student identity | Missing IDs/names and case-insensitive duplicate IDs are rejected. |
| Shared parents | Siblings may share a number; the review page flags it. |
| Missing phones | Readable drafts appear without WhatsApp links. |
| Phone format | Accepted international formatting is normalized; malformed nonempty inputs fail. |
| Text preservation | Unicode, newlines, ampersands, and URL punctuation survive URL encoding. |
| Missing facts | Blank data says Not recorded; it does not invent results or concerns. |
| Homework | Zero assigned work differs from missing data; impossible/partial/fractional/negative counts fail. |
| Output handling | HTML is escaped; unsupported control characters and overlong text fail. |
| CSV shape | Required/duplicate/unknown headers, optional columns, column reordering, BOM, malformed rows, and blank rows. |
| Export integrity | Nodes are connected; upload/extraction settings match; exported workflow starts inactive. |
| Embedded execution | The exact Code node runs with n8n-shaped inputs without CommonJS helpers. |
| Example preview | Fictional students appear; no real contact links or sending scripts are present. |

## Live n8n integration run

Environment: Windows host, Docker Compose, n8n image `docker.n8n.io/n8nio/n8n:2.43.7`. The workflow was imported through n8n's server CLI, published locally, and exercised through its actual HTTP form. This used the stable production form rather than the editor's temporary test listener.

| Step | Input or observation | Result |
| --- | --- | --- |
| Import | Repository workflow JSON | Workflow saved in the local n8n instance. |
| Form availability | GET local production form | Form returned HTTP 200. |
| Metadata | Example School; 6 A; Example Teacher; Example week | Used in both generated reports. |
| Upload | `examples/students.csv`, submitted as multipart form data | Accepted; form returned an execution-specific result address. |
| Extraction and code | Actual n8n nodes executed | Two student reports generated. |
| Student/parent mapping | Aarav/STU001/Parent One; Sita/STU002/Parent Two | Both mappings present and separate. |
| Homework | Aarav 4/5, pending 1; Sita 5/5, pending 0 | Both correct. |
| Exam details | Mathematics 38/50 versus 46/50; corresponding English results | Both distinct records present. |
| Review completion | Two HTML report cards and two message blocks | Returned by the live completion page. |
| Phone behavior | Both sample phones blank | Zero WhatsApp links; phone prompts displayed. |
| Sending | No real recipients were supplied | No WhatsApp message sent. |

Local request captures and execution-specific signed URLs remain under ignored `.runtime/`. They are not needed to reproduce the example and are excluded from the GitHub repository.

## Reproduce the integration check

Follow the first-execution instructions in [User guide](USER_GUIDE.md). Confirm both names and IDs, the homework counts, distinct exam marks, and the two phone prompts. A different instance can assign different workflow and execution IDs; those values are not part of the acceptance criteria.

## Remaining validation

- A consenting recipient must verify a real WhatsApp draft, press Send, and separately confirm receipt before claiming delivery works.
- The 45-student mapping is verified locally in the engine; a 45-row hosted upload has not been observed.
- Remote deployment, concurrent teachers, mobile browser coverage, backups/restoration, and long-term retention are outside the observed run.
- No timing benchmark, school deployment study, or measured reduction in teacher workload has been conducted.

The project report uses these same limits and does not present proposed features as completed results.
