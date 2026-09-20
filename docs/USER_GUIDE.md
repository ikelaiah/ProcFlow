# ProcFlow user guide

ProcFlow is a local-first investigation aid for SQL control flow and object
dependencies. It accepts pasted SQL, a folder of SQL files, a catalogue, or an
SSRS/RDL report definition and renders an explorable diagram.

## First run

1. Download the v2.4.0 runtime ZIP from the repository release, or clone the
   repository for development.
2. Open `index.html` in a current Chromium, Firefox, or Edge browser. The
   runtime does not require a server or a database connection.
3. Paste SQL, choose **Auto** or a dialect, and select **Refresh**.
4. Use the **Object**, **Scope**, and **Direction** controls to focus the
   diagram. The source and diagnostics panels remain the authority for review.

For a repeatable local server, run `python -m http.server 8000` in the runtime
directory and open `http://127.0.0.1:8000/`.

## Main workflows

### Database review

Paste or import a procedure, function, trigger, view, or multi-object script.
Start with **Control flow** to inspect decisions, loops, transactions, exits,
cursor operations, and exception paths. Switch to **Query structure** to see
reads, writes, joins, CTEs, subqueries, and result sets. For a multi-object
script, **Object dependencies** shows calls and table relationships.

Use the source span selection and diagnostics before relying on a relationship
in a change review. Dynamic SQL is deliberately shown as an opaque step.

### ERD query builder

On `erd.html`, choose **Query builder** to pick columns directly on the table
cards. Every card shows a checkbox per column, and a floating window (drag its
header to move it, drag the corner grip to resize it, arrow keys work on the
grip) shows the generated SQL. The window controls:

- **Dialect**, **Distinct**, a row cap, and **Comments** for the provenance
  header. The SQL is marked up with syntax colours and **Copy SQL** copies the
  exact text.
- **Join plan** cards for each join the declared foreign keys imply, with an
  INNER/LEFT switch and a sentence explaining direction, optionality, and row
  multiplication. Bridge tables are tagged; hovering a join card highlights
  the exact edge and both endpoint cards.
- **Problems** for tables no declared path reaches. ProcFlow never silently
  cross-joins: teach the join with the column pair (or a typed predicate),
  opt into a CROSS JOIN, or leave the table's columns out. The SQL header lists
  anything left out.
- **Teach join** (toolbar or a problem card) defines a join by clicking two
  columns on the diagram. Clicking two columns of the same table creates a
  self join with a second alias; tick which picked columns should read from
  that second copy.

Picked-column chips at the top of the window cycle through ascending and
descending sorts (the arrow button), reveal the table on the diagram, and
remove the pick. **Only used tables** narrows the canvas to the query's tables
plus any that need a resolution. Query mode dims edges outside the plan,
suspends compact boxes, and hides the selection inspector while you build.

### Report and dataset review

Open **Reports**, paste or import an `.rdl`/`.xml` report, and choose **Apply
report**. Embedded dataset queries are analysed; shared and unresolved datasets
remain explicit with diagnostics. Choose a dataset to inspect its SQL. The
**Report dependencies** scope shows the report → dataset → object → column
chain.

### Catalogue-assisted resolution

Open **Catalogue** and paste JSON or the supported line format, then choose
**Apply catalogue**. Exact full-name matches and explicit synonyms can verify
object identity. Partial, conflicting, or ambiguous matches remain external
and receive a diagnostic rather than being silently guessed.

### Large inputs

Inputs at or above 100,000 characters show a notice and pause automatic
re-analysis while editing. This keeps typing responsive. Select **Refresh** to
analyse the current text explicitly. The threshold is a responsiveness guard,
not a parser truncation limit; source text and coverage are preserved.

### Workspace and filters

Workspace save is opt-in. **Save to this browser** stores the current files,
options, catalogue, and report in local browser storage. **Export workspace
file** creates a portable JSON snapshot; **Import workspace file** restores it.
Dependency filters change presentation only and do not rewrite analysis counts.
Older supported workspaces migrate deterministically. A workspace from a newer
ProcFlow schema is not imported or changed; upgrade ProcFlow to open it.

## Exports

- **Copy Mermaid** copies the deterministic Mermaid definition.
- **Save SVG** saves the rendered diagram.
- **Save draw.io** saves editable XML with source and provenance metadata.
- **Copy narration prompt** creates a text prompt describing the diagram.

Treat exported diagrams as review artifacts. Keep the source SQL with them and
record the ProcFlow version used.

## Troubleshooting

- If automatic dialect detection is uncertain, select the dialect manually and
  inspect the `dialect_ambiguous` diagnostic.
- If coverage is incomplete, review the unresolved span before accepting any
  conclusion.
- If a diagram is unexpectedly sparse, check for dynamic SQL, unsupported
  vendor syntax, or a missing catalogue/report input.
- If an import fails, use the diagnostics and the minimal anonymised fixture
  when reporting the issue; do not attach confidential SQL.

See [Accuracy](ACCURACY.md), [Security](SECURITY.md), and [Development](DEVELOPMENT.md)
for the limits and verification contract.
