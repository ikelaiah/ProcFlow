/*
    v1.9.0 demo — resolve by catalogue.

    This multi-object script exercises the v1.9.0 territory (README
    post-v1.0.0 item 5) in one script so you can try catalogue resolution in
    one pane:

    1. Open the Catalogue menu and paste this catalogue (JSON or line format):

       dbo.Student TABLE student
       salesdb.dbo.Orders TABLE
       linksrv.warehouse.dbo.OrderLines TABLE
       dbo.v190_audit PROC

    2. Press Apply catalogue, then switch Scope to "Object dependencies".

       Now the unqualified "student" synonym resolves to dbo.Student, and the
       cross-database and linked-server names resolve to their exact catalogue
       identity — no "external: " label, because the catalogue proves the
       match. "earn.dbo.Totals" is not in the catalogue, so it keeps the
       conservative external label (and a lower-confidence reading of the
       estate).

    3. In Internal logic / Query structure view, a SELECT from a catalogued
       source also shows the exact identity instead of an unproven name.

    Any reference the catalogue only partially explains (for example a full
    "earn.src.warehouse.dbo.Totals" when only "warehouse.dbo.Totals" is
    catalogued) stays conservative and reports a region-scoped
    catalogue_partial diagnostic instead of guessing.

    This demo is an illustration, not an input to the fixture-corpus metrics
    (docs/metrics-v1.9.0.json). No user input or runtime telemetry is
    collected.
*/
CREATE VIEW dbo.v190_report AS
SELECT o.Id, l.Qty
FROM salesdb.dbo.Orders o
JOIN linksrv.warehouse.dbo.OrderLines l ON l.OrderId = o.Id;

GO

CREATE PROCEDURE dbo.v190_process @Year INT
AS
BEGIN
    SET NOCOUNT ON;

    -- "student" is a catalogue synonym for dbo.Student.
    SELECT Id INTO #stage FROM student WHERE SchoolYear = @Year;

    -- Reads the cross-database and linked-server tables catalogued above.
    INSERT INTO dbo.v190_report
    SELECT o.Id, l.Qty
    FROM salesdb.dbo.Orders o
    JOIN linksrv.warehouse.dbo.OrderLines l ON l.OrderId = o.Id;

    -- Missing from the catalogue: stays an external node, honestly labelled.
    SELECT SUM(Amount) FROM earn.dbo.Totals WHERE Year = @Year;

    -- Known object call.
    EXEC dbo.v190_audit @Year;

    RETURN 0;
END;

GO

CREATE PROCEDURE dbo.v190_audit @Year INT
AS
BEGIN
    SELECT COUNT(*) AS Total FROM dbo.Student WHERE SchoolYear = @Year;
END;
