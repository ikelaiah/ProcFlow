/*
    v1.3.0 demo — trust procedural control flow.

    dbo.v130_demo exercises the v1.3.0 outcome: mixed one-line and block
    IF / WHILE forms parse into ONE control-flow AST, so the diagram shows
    the true branching instead of mis-wiring or silently dropping a branch.

    Open this file in ProcFlow, pick dbo.v130_demo in Internal logic, and set
    the view to Control flow. Each section combines a one-line statement form
    (no BEGIN/END) with a multi-statement block form of the same construct:

      1. One-line IF — a single statement with no BEGIN/END.
      2. Block IF/ELSE — multi-statement branches on both sides.
      3. Mixed nesting — a one-line IF inside an IF-block's ELSE branch.
      4. One-line WHILE — a single-statement body with no BEGIN/END.
      5. Block WHILE — a multi-statement body containing a one-line IF.

    Before v1.3.0 the one-line and block forms were not treated uniformly, so
    mixed procedures could drop a branch or read the control flow as flat
    steps. v1.3.0 parses them into a single AST: IF and WHILE conditions
    branch yes/no and loop edges are wired regardless of whether their bodies
    use a single statement or a BEGIN/END block.
*/
CREATE OR ALTER PROCEDURE dbo.v130_demo @Limit INT = 10
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @I INT = 0;

    -- 1. One-line IF (single statement, no BEGIN/END).
    IF @Limit < 1
        SELECT 'no rows' AS gate;

    -- 2. Block IF/ELSE (multi-statement branches).
    IF @Limit >= 100
    BEGIN
        SELECT 'high' AS band;
        UPDATE dbo.Account SET Active = 1 WHERE Active = 0;
    END
    ELSE
        SELECT 'low' AS band;

    -- 3. Mixed nesting: a one-line IF inside the ELSE block above would be a
    --    separate IF; here it is placed in its own IF block's ELSE.
    IF @Limit = 50
        SELECT 'half' AS band;
    ELSE
    BEGIN
        SELECT 'other' AS band;
        IF @Limit > 0
            SET @I = @I + 1;
    END;

    -- 4. One-line WHILE (single-statement body).
    WHILE @I < @Limit
        SET @I = @I + 1;

    -- 5. Block WHILE containing a one-line IF.
    WHILE @I > 0
    BEGIN
        SET @I = @I - 1;
        IF @I = 0
            SELECT 'done' AS phase;
    END;

    SELECT @I AS remaining;
END;
