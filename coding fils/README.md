# Auto Ticket Classification using Flow Designer

Rule-driven ticket classifier with a working web UI and REST backend.
It runs **standalone** out of the box, and can also **push tickets to a real ServiceNow instance**
where a Flow Designer flow does the same classification.

```
Browser UI  -->  Node backend (REST API + rule engine)  -->  [optional] ServiceNow Table API / Flow Designer
```

## Project structure

```
auto-ticket-classification/
|-- backend/
|   |-- server.js            REST API, classifier, static file server, ServiceNow push
|   `-- data/rules.json      15 starter rules (tickets.json is created on first ticket)
|-- frontend/                index.html, style.css, app.js (no build step)
|-- servicenow/
|   `-- ClassificationEngine.js   Script Include for Flow Designer
|-- .env.example
`-- package.json
```

## 1. Run it (standalone)

Requirements: **Node.js 18 or newer** (no `npm install` needed - there are no dependencies).

```bash
cd auto-ticket-classification
npm start            # or: node backend/server.js
```

Open **http://localhost:3000**

Try these in *Raise ticket* and watch the routing slip change live:
`VPN keeps disconnecting` -> Network / Network Team | `I am locked out of my account` -> Access / IAM Team | `Received a phishing mail` -> Security / P1.

## 2. Pages

| Page | What it does |
|---|---|
| Raise ticket | Form + live preview of category, team and priority before you submit |
| Tickets | All tickets with category, team, priority, and ServiceNow number if synced |
| Dashboard | Tickets by category/priority, auto-classification rate, top keywords |
| Rules | Add, switch off or delete keyword rules - applied immediately, no restart |

## 3. How classification works

1. Subject + description are lowercased.
2. Every **active** rule whose keyword appears in the text is a match.
3. Best match = lowest priority number (P1 is most critical), then longest keyword.
4. Urgency "High" raises priority by one level.
5. No match -> `General / Service Desk`, flagged for manual review.

## 4. API

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/classify` | Preview: `{short_description, description}` |
| GET / POST | `/api/tickets` | List / create (`short_description` required) |
| GET / POST | `/api/rules` | List / add rule |
| PUT / DELETE | `/api/rules/:id` | Toggle active / delete |
| GET | `/api/stats` | Dashboard numbers |

## 5. Connect to ServiceNow (optional)

1. Get a free Personal Developer Instance at https://developer.servicenow.com
2. Copy `.env.example` to `.env` and fill `SN_INSTANCE`, `SN_USER`, `SN_PASSWORD`. Restart the server.
   The header badge changes to **ServiceNow connected**, and each new ticket also creates an Incident.
3. `SN_PUSH_CLASSIFIED=true` sends category + assignment group from this backend.
   `SN_PUSH_CLASSIFIED=false` sends only the text, so **your Flow Designer flow does the classification**.
4. Assignment group names and category labels must already exist in your instance
   (e.g. Network, Hardware, Software), otherwise ServiceNow may ignore them.

### Build the Flow in ServiceNow (Flow Designer)

1. **Table:** create `u_classification_rule` with fields `u_keyword` (String), `u_category` (String),
   `u_subcategory` (String), `u_priority` (Integer), `u_assignment_group` (Reference > sys_user_group), `active` (True/False).
   Enter the same rows as `backend/data/rules.json`.
2. **Script Include:** create `ClassificationEngine` using `servicenow/ClassificationEngine.js`.
3. **Flow:** Flow Designer > New > Flow named *Auto Ticket Classification*.
   - Trigger: **Created** on Incident, condition *Category is empty*.
   - Action: **Run Script** (or Look Up Records on the rules table + For Each + If *contains*) that calls
     `new ClassificationEngine().classify(short_description, description)`.
   - If a rule matched: **Update Record** (category, subcategory, priority, assignment group) and **Add Work Note**.
   - Else: set assignment group to *Service Desk* and add a note "Manual review".
   - Activate the flow.
4. Run the backend with `SN_PUSH_CLASSIFIED=false`, raise a ticket in the UI, and watch the flow execute under
   *Flow Designer > Executions*.

## Troubleshooting

| Problem | Fix |
|---|---|
| `EADDRINUSE` | Port busy: set `PORT=3001` in `.env` |
| ServiceNow sync failed toast | Check instance URL (no `https://` needed), credentials, and that the user has the `rest_service`/`itil` role. Instance may be hibernating - wake it from the developer portal |
| Rule changes not showing | Refresh the Rules page; rules are read from `backend/data/rules.json` |
| Reset all data | Stop server, delete `backend/data/tickets.json` |
