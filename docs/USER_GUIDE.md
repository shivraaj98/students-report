# Installation and user guide

## Requirements

- Docker Desktop with its engine running, or another working Docker Engine with Compose.
- A browser for n8n and report review.
- WhatsApp on a phone, or a signed-in WhatsApp Web session, for actual sending.
- Node.js 22 or newer only if rebuilding the export or running local tests.

On Windows, complete any restart requested when enabling WSL or virtualization before starting Docker. No npm package installation is required for this repository's scripts.

## Start and stop

Run from the repository folder:

```powershell
docker compose up -d
docker compose ps
```

Open `http://localhost:5678` and create the owner account on a new installation. Keep these account details private.

```powershell
docker compose stop
```

The stop command leaves the database volume intact. Start again with `docker compose up -d`.

## Import and first execution

1. Create an n8n workflow and choose **Import from File** from the workflow menu.
2. Select `student-reports.n8n.json` and save it.
3. Choose **Execute Workflow**, then open the teacher form's Test URL.
4. Enter **Example School**, **6 A**, **Example Teacher**, and **Example week**.
5. Upload `examples/students.csv` and select **Prepare reports**.
6. Check the separate Aarav and Sita reports, IDs STU001 and STU002, and their different homework and exam results.

The example has blank phone numbers and therefore shows **Phone needed**. It deliberately cannot open a parent's chat. An offline version is available in `examples/report-preview.html`.

## Reuse the form

For a stable form address, publish/activate the saved workflow and use the Form Trigger's Production URL. With the supplied path on the default local instance, this is `http://localhost:5678/form/class-parent-reports`. A Test URL works only while n8n is waiting for a test submission.

Submit a fresh CSV for each class and reporting period. Reports are regenerated from the current input; the project does not reconcile them against a historical student database.

## Prepare real records

Use the supplied CSV as a column template, replacing the fictional records. Save real files outside Git or under the ignored `private/` folder. Export CSV UTF-8 from the spreadsheet and keep IDs and phone numbers as text.

Keep all required headers exactly as supplied. One row represents one student. Semicolons or line breaks separate subjects in `exam_results`; quote CSV cells that contain commas or line breaks using your spreadsheet's CSV exporter.

Supply the full parent number including the country code. Do not add an unverified country code automatically. Blank phones allow report review but disable WhatsApp. Blank results and concerns are reported as **Not recorded**.

## Review and send

1. Verify the student name, ID, parent, phone, and academic facts on the review page.
2. Select **Open WhatsApp for [student]**.
3. Verify the recipient shown inside WhatsApp and review the prefilled draft.
4. Press **Send** in WhatsApp, then repeat for the next student.

Send each individual report to its parent. The full class review page contains multiple students and is intended for the teacher. Printing or saving the review page does not create a sending or delivery log.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Docker engine connection fails | Start Docker Desktop and complete any required Windows restart. |
| Port 5678 is already in use | Check existing containers/services; use the existing n8n instance or choose a free host port in Compose. |
| Test form is unavailable | Start **Execute Workflow** again and copy the current Test URL. |
| Production form returns 404 | Confirm the workflow was saved and published; use the URL shown by the Form Trigger. |
| Missing or unknown CSV columns | Restore the template headers and remove unintended spreadsheet columns. |
| Duplicate student ID | Correct the IDs; IDs differing only by letter case count as duplicates. |
| Homework validation error | Supply both whole-number counts or leave both blank; completed cannot exceed assigned. |
| Parent phone validation error | Use the full international number and check its formatting. |
| Phone needed appears | Add a verified parent number in the CSV, then submit the form again. |
| One phone is shared by siblings | Verify the student's name before sending each report. |
| WhatsApp asks for sign-in | Sign into WhatsApp Web yourself and review the recipient before sending. |
| Edited engine is absent in n8n | Run the workflow builder and reimport the rebuilt export. |

## Update the report for submission

Edit the identification fields and content in `docs/PROJECT_REPORT.md`, then run:

```powershell
node scripts/build-report.js
node scripts/build-report.js --pdf
```

The second command uses a locally installed Chrome or Edge. Alternatively, open the generated HTML, choose **Print**, and save as PDF. Include only verification results you have actually reproduced.
