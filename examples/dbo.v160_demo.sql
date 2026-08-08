/*
    v1.6.0 demo — honest measurement.

    dbo.v160_demo exercises the v1.6.0 outcomes in one script. Open the file
    in ProcFlow with the default Control flow view and open the analysis
    panel (Refresh if the panel predates the file):

    1. One headline, one honest formula. Confidence (v1.6.0) is derived from
       per-region signals: dialect certainty x token-weighted region quality
       x a coverage factor. This file measures 9 statement regions — 6
       resolved, 2 approximate, 1 opaque — so with Dialect = T-SQL the
       headline reads about 91 % (high band), and with Detect about 78 %
       (medium band, because dialect certainty is 6/7). The health band
       comes from the same formula, so the colour can never contradict the
       percentage.
    2. Every approximation is called out where it happens. The CROSS APPLY
       target and the GENERATE_SERIES table expression below each carry a
       region-scoped, span-attached warning (apply_heuristic and
       source_opaque) that selects the exact text in the SQL editor.
    3. Coverage alone never raises confidence. Coverage reads 100 % for this
       file, yet the headline stays below 100 % because the dynamic-SQL
       region is opaque: guesswork keeps its region quality at 0.40 instead
       of 1.00 no matter how completely the tokens were consumed.
    4. Informational annotations stay out of the way. The recursive CTE is a
       correctly resolved construct: it produces a cte_recursive informational
       annotation, not a warning, and the Diagnostics count stays at 3 (the
       two approximation warnings plus dynamic SQL) rather than 4.
    5. Document-scoped findings are honest about where they don't point.
       This file auto-detects confidently, so it shows no dialect finding.
       Paste a short ambiguous script (for example SELECT 1;) with Dialect =
       Detect instead: the dialect_low_confidence / dialect_ambiguous
       findings are document-scoped and carry no fabricated source span —
       they never highlight a character they do not really point at.
    6. Region status drives the number, not the diagram size. Each statement
       region below contributes 1.00 (resolved), 0.75 (approximate: opaque
       table expression or heuristic APPLY), or 0.40 (opaque dynamic SQL); a
       syntax error would contribute 0.15.

    The deterministic fixture-corpus metrics (attribution, unresolved-token,
    fallback, opaque-dynamic, semantic-edge coverage, provenance, and
    region-diagnostic-to-span ratios) are published separately from the
    checked-in golden corpus in docs/metrics-v1.6.0.json — this demo file is
    an illustration, not an input to those metrics. No user input or runtime
    telemetry is ever collected.
*/
CREATE OR ALTER PROCEDURE dbo.v160_demo @SchoolYear INT
AS
BEGIN
    SET NOCOUNT ON;

    -- 1. Fully resolved regions contribute 1.00 to region quality.
    SELECT Id, Name FROM dbo.Student WHERE SchoolYear = @SchoolYear;
    UPDATE dbo.Student SET Archived = 1 WHERE SchoolYear = @SchoolYear;

    -- 2. Opaque dynamic SQL: kept visible as an opaque step. Its reads,
    --    writes, calls, and branches cannot be inferred, so its region
    --    quality is 0.40 — coverage alone cannot raise it.
    DECLARE @sql NVARCHAR(400) = N'SELECT Id FROM dbo.Student;';
    EXEC sp_executesql @sql;

    -- 3. Partially resolved APPLY: apply_heuristic warning, region 0.75.
    SELECT s.Id, g.Score
    FROM dbo.Student s
    CROSS APPLY dbo.fn_grade(s.Id) g;

    -- 4. Opaque table expression: source_opaque warning, region 0.75.
    SELECT n FROM GENERATE_SERIES(1, 10) AS n;

    -- 5. A correctly resolved recursive CTE: cte_recursive informational
    --    annotation only — it does not inflate the Diagnostics count.
    WITH r(n) AS (
        SELECT 1
        UNION ALL
        SELECT n + 1 FROM r WHERE n < @SchoolYear
    )
    SELECT n FROM r;

    -- 6. Contrast: a multi-part reference resolves heuristically but is not
    --    an APPLY target, so it triggers no approximate-resolution warning.
    SELECT TOP 5 t.Id
    FROM remotesrv.salesdb.dbo.SharedTable t
    WHERE t.SchoolYear = @SchoolYear;
END;
