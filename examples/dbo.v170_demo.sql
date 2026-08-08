/*
    v1.7.0 demo — clear deterministic exports.

    dbo.v170_demo exercises the v1.7.0 territory (ROADMAP workstream F) in one
    script. Open the file in ProcFlow with the default Control flow view, then
    use Export > Save draw.io (and copy the Mermaid tab):

    1. Deterministic layered layout. Every draw.io export is repositioned by a
       layered, crossing-reducing, data-flow-aware layout. Re-exporting the
       same script always produces identical coordinates (deterministic), no
       node boxes overlap, and the control-flow spine runs monotonically
       top-to-bottom.
    2. Data flow is routed around the spine. The producer->consumer temp-table
       edges (SELECT ... INTO #work -> UPDATE #work -> SELECT #work) are drawn
       as distinct data-flow edges in a dedicated lane, carried by explicit
       waypoints, instead of threading through the middle of the control flow.
    3. Structured labels. Multi-line labels (grouped straight runs, the object
       name + kind, the recursive-CTE marker) are exported as real line breaks
       in both Mermaid (<br/>) and draw.io (&#xa;) — there is no hidden control
       character sentinel in the output text.
    4. Canonical renderer contract. Both exporters derive every node fill,
       stroke, edge colour, dash, and width from one canonical registry, so the
       Mermaid and draw.io views can never disagree about a class or an edge
       kind.
    5. Provenance round-trips. draw.io vertices carry source spans, object
       identity, class, and synthetic origins as metadata; synthetic nodes such
       as the BEGIN TRY marker export their origin instead of a fabricated
       source span. Re-opening the .drawio file keeps that traceability.
    6. Honest geometry. The layout asserts per-class budgets (no overlaps, a
       monotonic spine, readable label bounds, a documented crossing budget) at
       documented size limits; large or non-planar graphs degrade honestly and
       never claim zero crossings.

    The fixture-corpus export metrics (export-parity, export-traceability, and
    layout-budget pass rates) are published separately from the checked-in
    corpus in docs/metrics-v1.7.0.json — this demo file is an illustration, not
    an input to those metrics. No user input or runtime telemetry is ever
    collected.
*/
CREATE OR ALTER PROCEDURE dbo.v170_demo @SchoolYear INT
AS
BEGIN
    SET NOCOUNT ON;

    -- 1. A grouped straight run: exported as a multi-line structured label.
    DECLARE @Count INT = 0;
    DECLARE @Done BIT = 0;

    -- 2. Temp-table producer -> consumer data flow, routed around the spine.
    SELECT Id INTO #work FROM dbo.Student WHERE SchoolYear = @SchoolYear;

    -- 3. Branch structure keeps the control-flow spine monotonic.
    IF @Done = 0
    BEGIN
        UPDATE #work SET Archived = 1;
        SET @Count = @Count + 1;
    END

    -- 4. Exception-protected region: synthetic entry marker exports its origin.
    BEGIN TRY
        BEGIN TRANSACTION;
        DELETE FROM #work WHERE SchoolYear = @SchoolYear;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH;

    -- 5. A recursive CTE marker: structured label in the query structure view.
    WITH r(n) AS (
        SELECT 1
        UNION ALL
        SELECT n + 1 FROM r WHERE n < 10
    )
    SELECT n FROM r;

    -- 6. An external source: complete identity (server.database.schema.object)
    --    is retained on the node and in the exported metadata.
    SELECT TOP 5 Id FROM remotesrv.salesdb.dbo.SharedTable;

    RETURN @Count;
END;
