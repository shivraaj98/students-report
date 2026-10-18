# Live ClassBridge tool

Open **https://students-report-shivraaj98.info828588.chatgpt.site** in a modern browser. This is the public, standalone classroom tool. The original n8n workflow remains available for teachers who prefer n8n.

## Existing WhatsApp group

The tool works with a regular WhatsApp group. It does not connect to a WhatsApp account, read group messages, or extract group participants. The teacher chooses the specific group when sharing a registration invitation in WhatsApp. A group's member list does not establish which adult is a student's guardian or whether that person wants private reports.

1. In **Class setup**, enter your school, class, teacher name, reporting period, and teacher WhatsApp number. Include the country code. Save the details.
2. Choose **Invite parents from your group**. Review the teacher number and invitation. Approve sharing, choose the correct existing class group in WhatsApp, and press Send.
3. Each parent opens the registration link, enters the student ID, student name, guardian name, and their own WhatsApp number, and chooses whether to consent to private reports. The page requires consent before preparing a registration.
4. The parent reviews the teacher number and registration, approves opening the chat, and sends the registration privately to the teacher. This does not publish the registration to the group.
5. In **Students & parents**, choose **Import parent reply** and paste the complete registration message. Check the student's identity against school records and check that the actual WhatsApp sender matches the supplied number. Then confirm both the contact match and the parent's permission. Keep the original reply in WhatsApp.
6. Enter the student's homework, test results, observed behavior or concerns, and requested parent support. Use only recorded information. Alternatively, import a UTF-8 CSV based on `examples/students.csv`, then verify each parent and record their permission individually.
7. In **Reports & approvals**, review a student's full report and recipient. Check the approval box and choose **Approve & open WhatsApp**. Verify the recipient again and press **Send** in WhatsApp.

You must repeat review and approval for every individual report. The teacher's approval applies once to the exact message and recipient. Updating report content or parent details invalidates an old review. A CSV import never grants parent permission, and there is no send-all or background sending operation.

The tool cannot verify the authenticity of an invitation, parent claim, or school identity. Parents should confirm the teacher number with their school. Teachers must verify guardian identity using their school records.

## Permission withdrawal

Parents can reply **STOP** or ask the teacher to stop by another agreed channel. The teacher must promptly open **Edit & verify** for that student, uncheck **both** contact and parent permission confirmations, and save. The report can no longer be opened through the approval flow. The tool cannot read WhatsApp replies or automatically process STOP.

Changing the school, class, teacher name, or teacher number clears all recorded parent permissions. Changing an individual student's or parent's identity or phone requires confirming that contact again. Changing only the reporting period keeps the parent permission but every message still needs a new teacher approval.

## Saving and backups

Records are processed in your browser. They are not uploaded to an application database, and the app makes no background API requests. Ordinary page requests still reach the hosting provider and can appear in hosting access logs. Invitation details use the URL fragment, which is not included in an HTTP page request; it contains class details and the teacher's number, not a roster or student reports.

By default, records are held only for the current page session. Reloading or closing the page loses unsaved changes. On a trusted device, enable **Remember this class on this device** in Class setup to save records in that browser's local storage. Storage is not encrypted by this application and does not sync across browsers, devices, or accounts. Avoid using it on shared devices.

Use **Export class** for a JSON backup and **Restore backup** in Class setup to transfer a class to another device. Backups include private student information and permission notes; store them securely. Restoring a backup clears active permissions and message activity, so the teacher must reconfirm each parent. This prevents an imported file from authorizing messages.

**Clear workspace**, available at the bottom of the page, removes this class and its saved browser copy. It does not delete downloaded backups or existing WhatsApp conversations. To manage another class, export the current class, clear the workspace, and set up or restore the other class.

## What the activity log means

An entry records that the teacher approved a message and requested a WhatsApp draft. It does not establish that a new tab opened, that Send was pressed, or that a message was sent, delivered, or read. If a browser blocks the new tab, allow pop-ups for the tool and review the report again. Each retry needs a fresh approval.

No real parent messages were used to test this project. Browser checks intercept every WhatsApp opening and use fictional records.

## Development

No dependency installation is required:

```powershell
node scripts/build-web.js
node --test
node scripts/serve-web.js
```

Open `http://127.0.0.1:4173`. With that preview running, use `node scripts/check-web-browser.js` in another terminal for real Chrome/Edge checks. Set `REPORT_BROWSER` if the browser is installed elsewhere. The checks never open a real WhatsApp page or send a message.

The authoritative sources are `web/`, `src/report-engine.js`, and `scripts/build-web.js`. Generated `dist/` is ignored by Git. `.openai/hosting.json` retains the hosting identity and static output directory. Publishing uses the Sites source workflow from a separate ignored checkout so the GitHub repository's own remotes are preserved. The published artifact contains only the six generated website assets; it does not contain `.runtime/`, private class records, or credentials.

## WhatsApp references

- [Official click-to-chat links](https://faq.whatsapp.com/5913398998672934)
- [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy)

This edition uses regular WhatsApp click-to-chat. Business API delivery is a separate integration with business account setup, template requirements, platform rules, and applicable provider charges.
