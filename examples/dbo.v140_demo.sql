/*
    v1.4.0 demo — report every object a query touches.

    dbo.v140_demo exercises the v1.4.0 query-lineage outcomes in one script.
    Open the file in ProcFlow and use View → Query structure: every object
    the queries read — comma-separated sources, APPLY functions, tabular
    functions, MERGE/DELETE sources, recursive-CTE self-references, and
    derived-table inner tables — appears as a source node.

    1. Comma-separated FROM lists wire every source, not just the first:
       FROM dbo.Account a, dbo.Contact c, dbo.Orders o yields three sources.
    2. CROSS/OUTER APPLY functions are structured read references, so
       dbo.fn_LineItems shows up as a source in the query graph.
    3. Tabular functions (XMLTABLE, JSON_TABLE, GENERATE_SERIES, UNNEST)
       are documented opaque source references.
    4. MERGE … USING reads the source and writes the target, even though
       there is no FROM clause. (DELETE … USING is dialect-specific and is
       shown in the PL/pgSQL dialect fixtures.)
    5. A recursive CTE is marked "recursive CTE" in the graph metadata and
       carries an informational annotation instead of a warning. An
       approximate recursion would raise "cte_recursion_approx".
    6. Derived-table inner sources are wired: FROM (SELECT … FROM dbo.t) x
       plots dbo.t as a source.
*/
CREATE OR ALTER PROCEDURE dbo.v140_demo @CustomerId INT
AS
BEGIN
    SET NOCOUNT ON;

    -- 1. Comma-separated sources: three read sources in one statement.
    SELECT a.Name, c.Email, o.Total
    FROM dbo.Account a, dbo.Contact c, dbo.Orders o
    WHERE a.Id = c.AccountId AND o.AccountId = a.Id;

    -- 2. CROSS APPLY function source.
    SELECT a.Name, f.TotalValue
    FROM dbo.Account a
    CROSS APPLY dbo.fn_AccountTotals(a.Id) f;

    -- 3. Tabular function as a documented opaque source.
    SELECT x.Id
    FROM dbo.Account a
    CROSS JOIN GENERATE_SERIES(1, a.Rank) AS x(Id);

    -- 4. MERGE … USING reads the source, writes the target.
    MERGE INTO dbo.AccountSnapshot AS dst
    USING dbo.Account AS src
    ON dst.Id = src.Id
    WHEN MATCHED THEN UPDATE SET dst.Balance = src.Balance
    WHEN NOT MATCHED THEN INSERT (Id, Balance) VALUES (src.Id, src.Balance);

    -- 5. Recursive CTE: marked recursive; informational annotation, no warning.
    --    T-SQL recursion is implicit (no RECURSIVE keyword); the self-reference
    --    is detected and the node is annotated "recursive CTE".
    WITH org(id, parent_id) AS (
        SELECT Id, ParentId FROM dbo.Chart WHERE ParentId IS NULL
        UNION ALL
        SELECT c.Id, c.ParentId
        FROM dbo.Chart c
        JOIN org o ON o.id = c.ParentId
    )
    SELECT Id FROM org;

    -- 6. Derived table: dbo.tier is plotted as a source.
    SELECT t.Level
    FROM (SELECT Id, Level FROM dbo.Tier WHERE Active = 1) t;
END;
