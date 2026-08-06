/*
    v1.3.0 demo — trust procedural control flow.

    dbo.v130_demo exercises the v1.3.0 procedural control-flow outcomes in one
    procedure. Open the file in ProcFlow, pick dbo.v130_demo, and use View →
    Control flow for the branching and loops; then View → Query structure to
    see the cursor body's source table.

    1. Mixed one-line and block IF/WHILE parse into one AST. Single-statement
       bodies and BEGIN/END bodies mix freely in the same procedure: every
       condition branches yes/no and loop bodies wire back to the loop
       condition.
    2. Labelled GOTO and labels carry source spans, so clicking the GOTO node
       selects the GOTO keyword in the editor. An unresolved GOTO target
       instead raises a "goto_unresolved" warning and draws an explicit
       "Unresolved label" node rather than silently dropping control.
    3. Cursor queries are represented in the Query structure view: the source
       table behind DECLARE ... CURSOR FOR appears as a source node (and is
       kept in the object's reads).
    4. Extended statement labels: GRANT, WAITFOR, KILL, and cursor operations
       produce concise node labels instead of full statement text.

    (DB2 BEGIN ATOMIC rollback scope and labelled LEAVE/ITERATE are shown in
    the dialect fixtures; T-SQL does not express those forms.)
*/
CREATE OR ALTER PROCEDURE dbo.v130_demo @Limit INT = 10
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @I INT = 0;

    -- 1. Mixed one-line and block control flow in a single AST.
    IF @Limit < 1
        SELECT 'no rows' AS gate;
    IF @Limit >= 100
    BEGIN
        SELECT 'high' AS band;
        UPDATE dbo.Account SET Active = 1 WHERE Active = 0;
    END
    ELSE
        SELECT 'low' AS band;
    WHILE @I < 3
        SET @I = @I + 1;
    WHILE @I > 0
    BEGIN
        SET @I = @I - 1;
        IF @I = 0
            SELECT 'done' AS phase;
    END;

    -- 2. Labelled GOTO with a carried source span (resolved target).
    IF @I = 0
        GOTO finished;
    SET @I = 99;
finished:
    SELECT @I AS remaining;

    -- 3. Cursor query visible in Query structure view.
    DECLARE c CURSOR FOR
        SELECT Id, Name FROM dbo.Customer WHERE Active = 1;
    OPEN c;
    FETCH NEXT FROM c INTO @id, @name;
    CLOSE c;
    DEALLOCATE c;

    -- 4. Concise labels for GRANT, WAITFOR, and KILL.
    GRANT REFERENCES ON dbo.Customer TO app_role;
    WAITFOR DELAY '00:00:01';
    KILL 42;
END;
