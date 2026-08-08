/*
    v1.8.0 demo — usable local workspace.

    This multi-object script exercises the v1.8.0 territory (README post-v1.0.0
    item 7) in one script so you can try both new features in one pane:

    1. Dependency filtering. Switch Scope to "Object dependencies", then use
       Filter dependencies to inspect the estate:
       - toggle Reads / Writes / Calls to hide a whole edge family;
       - toggle External objects to hide the unmatched three-part name;
       - toggle Temp tables to hide the "#stage" placeholder;
       - type "stage" or "export" into Focus to keep only that object and its
         direct neighbours.
       Filtering is presentation-only: the underlying analysis graph is never
       changed, so toggling a filter or clearing the focus never alters the
       reported confidence, coverage, or diagnostics for the estate.

    2. Persistence. Use the Workspace menu (opt-in, versioned, exportable):
       - Save to this browser persists this workspace (files + analysis
         options) to local storage;
       - Restore saved workspace replays it into an identical analysis;
       - Export workspace file / Import workspace file transfer it as JSON;
       - Forget saved workspace removes it explicitly.
       Nothing is written to or restored from storage on load.

    This demo is an illustration, not an input to the fixture-corpus metrics
    (docs/metrics-v1.8.0.json). No user input or runtime telemetry is collected.
*/
CREATE VIEW dbo.v180_export AS
SELECT Id, Name FROM dbo.Student;

GO

CREATE PROCEDURE dbo.v180_process @Year INT
AS
BEGIN
    SET NOCOUNT ON;

    -- Reads dbo.v180_export, writes #stage (a temp-table placeholder).
    SELECT Id INTO #stage FROM dbo.v180_export WHERE SchoolYear = @Year;

    -- Reads #stage, writes dbo.Student.
    UPDATE s
    SET s.Archived = 1
    FROM #stage st
    JOIN dbo.Student s ON s.Id = st.Id;

    -- Calls a known object and an unmatched external three-part name.
    EXEC dbo.v180_audit @Year;
    SELECT Id FROM remotesrv.salesdb.dbo.SharedTable;

    RETURN 0;
END;

GO

CREATE PROCEDURE dbo.v180_audit @Year INT
AS
BEGIN
    -- Reads only; no collaborators, so it is an isolated estate node.
    SELECT COUNT(*) FROM dbo.Student WHERE SchoolYear = @Year;
END;
