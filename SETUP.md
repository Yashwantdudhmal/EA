# EA Lite — Setup Guide (Windows)

This repo is a minimal Electron + React + Neo4j desktop app for:
- Application inventory (via CSV import)
- Application dependency graph (Neo4j → Cytoscape)
- Impact analysis (click node → downstream “what breaks” highlight)

No cloud. No SaaS. Local Neo4j only.

---

## 1) Prerequisites

Install these first:

1. **Node.js (LTS recommended)**
   - Verify: `node -v` and `npm -v`

2. **Git for Windows**
   - Verify: `git --version`

3. **Neo4j Community (local)**
   - Recommended: Neo4j Desktop, or a local Neo4j Community server install
   - Must have Bolt enabled and listening on `neo4j://127.0.0.1:7687` (or set `NEO4J_URI`)
   - Neo4j Browser typically at: `http://localhost:7474`

---

## 2) Clone the project

```powershell
git clone https://github.com/Yashwantdudhmal/EA.git
cd EA
```

---

## 3) Install dependencies

```powershell
npm install
```

---

## 4) Configure Neo4j connection (local)

This project reads Neo4j settings from environment variables.

### Required

Set the Neo4j password for the current PowerShell session:

```powershell
$env:NEO4J_PASSWORD = "<your_neo4j_password>"
```

### Optional

Override URI or username if needed:

```powershell
$env:NEO4J_URI = "neo4j://127.0.0.1:7687"
$env:NEO4J_USER = "neo4j"
```

Notes:
- Do **not** commit secrets to git.
- `.env` files are ignored by `.gitignore`.

---

## 5) Run the app (dev)

```powershell
npm run dev
```

Expected main-process logs:
- `[neo4j] connecting to neo4j://127.0.0.1:7687...`
- `[neo4j] connected`
- `[schema] initializing constraints and indexes...`
- `[schema] initialized`

If Neo4j is not running or URI is wrong, you’ll see a connection error (the window should still open).

---

## 6) Import CSV data

Sample CSVs are included in the repo root:
- `sample_applications.csv`
- `sample_dependencies.csv`

In the app window:
1. Click **Import Applications** → select `sample_applications.csv`
2. Click **Import Dependencies** → select `sample_dependencies.csv`

You should see success snackbars like:
- `✓ Imported 4 applications`
- `✓ Imported 4 dependencies`

---

## 7) Verify Neo4j data

Open Neo4j Browser: `http://localhost:7474`

Run:

```cypher
// Check constraints
SHOW CONSTRAINTS;

// Check indexes
SHOW INDEXES;

// See all applications
MATCH (a:Application) RETURN a;

// See all dependencies
MATCH (s)-[r:DEPENDS_ON]->(t)
RETURN s.name, r.dependency_type, t.name;
```

---

## 8) Impact analysis (blast radius)

After importing data:
- Click a node (example: `billing`)
- The clicked node highlights dark red
- All downstream impacted apps highlight red

This answers: “what breaks if this app is removed?” (downstream dependency closure).

---

## 9) Push changes to GitHub

### Option A — If you have write access to the repo

1. Check status:

```powershell
git status
```

2. Commit your changes:

```powershell
git add -A
git commit -m "Describe your change"
```

3. Push:

```powershell
git push
```

When prompted for credentials, **do not use your GitHub account password**.
Use one of these:
- **GitHub “Sign in with browser”** (recommended)
- **Personal Access Token (PAT)** as the password for HTTPS

### Option B — If you do NOT have write access

1. Fork the repository in GitHub.
2. Clone your fork.
3. Push to your fork.
4. Open a Pull Request.

---

## Common issues

### Vite port 5173 is in use

Stop the old process using port 5173, then rerun `npm run dev`.

### Neo4j connection fails

- Confirm Neo4j is running.
- Confirm URI (`NEO4J_URI`) and password (`NEO4J_PASSWORD`).
- Confirm Bolt is enabled and listening on `127.0.0.1:7687`.
