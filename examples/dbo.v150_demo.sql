/*
    v1.5.0 demo — data flow and internal resilience.

    dbo.v150_demo exercises the v1.5.0 outcomes in one script. Open the file
    in ProcFlow with the default Control flow view:

    1. Temp-table producer→consumer edges: SELECT … INTO #stage wires a
       labelled data-flow edge to each later consumer on a provably linear
       path. Data edges are thicker and green in both Mermaid and draw.io
       exports, derived from the semantic "data" edge kind.
    2. Branch merges stay conservative: when a temp table is written inside
       one branch, the reaching definition after the merge is ambiguous, so
       no data edge is invented and an informational temp_flow_ambiguous
       annotation explains why.
    3. Savepoint-only recovery: a savepoint declared in a TRY body stays
       visible inside its CATCH, so ROLLBACK TRANSACTION stage_save is
       described as a savepoint rollback (depth unchanged), not an
       unresolved named target.
    4. SET XACT_ABORT inside a CATCH is annotated as scoped to the
       remainder of that CATCH.
    5. Object dependencies (Scope → Object dependencies) label unmatched
       three-/four-part names with their complete identity, e.g.
       "external: remotesrv.salesdb.dbo.pull_orders", never a bare
       last-part match.
    6. The analysis panel shows construct coverage: how many branches,
       loops, handlers, CTEs, source references, and temp-flow links were
       detected, resolved, or left opaque.
*/
CREATE OR ALTER PROCEDURE dbo.v150_demo @SchoolYear INT
AS
BEGIN
    SET NOCOUNT ON;

    -- 1. Linear staging pipeline: each consumer wires to its unique
    --    reaching definition with a labelled data edge.
    SELECT Id, Name INTO #stage FROM dbo.Student WHERE SchoolYear = @SchoolYear;
    UPDATE #stage SET Name = UPPER(Name);
    INSERT INTO dbo.StudentArchive(Id, Name)
        SELECT Id, Name FROM #stage;

    -- 2. Conditional write: after the merge, #optional has no unique
    --    producer, so the final SELECT stays unwired and annotated.
    SELECT Id INTO #optional FROM dbo.Student WHERE Active = 1;
    IF @SchoolYear IS NOT NULL
        INSERT INTO #optional(Id) SELECT Id FROM dbo.Graduate;
    SELECT Id FROM #optional;

    -- 3 + 4. Savepoint declared in TRY remains visible in CATCH for
    --        savepoint-only recovery; XACT_ABORT set inside CATCH is
    --        annotated as catch-scoped.
    BEGIN TRY
        BEGIN TRANSACTION;
        SAVE TRANSACTION stage_save;
        UPDATE dbo.Student SET Archived = 1 WHERE SchoolYear = @SchoolYear;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        SET XACT_ABORT ON;
        ROLLBACK TRANSACTION stage_save;
        THROW;
    END CATCH;

    -- 5. Remote references keep their complete identity in the dependency
    --    view.
    EXEC remotesrv.salesdb.dbo.pull_orders @SchoolYear;
END;
