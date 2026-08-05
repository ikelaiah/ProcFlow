"use strict";
/* v1.2.0 — Workstream A boundary fixtures.
   Statement-range fixtures assert the exact source text of each parsed
   statement, for both terminated and valid unterminated statements, and for
   the one-line semicolon-free grammar that previously required a newline.
   Golden additions cover the hardened findBody headers. */
var PROCFLOW_RANGE_FIXTURES = [
    { name: 'T-SQL all one-line, no semicolons', dialect: 'tsql',
        sql: 'CREATE PROC dbo.p AS BEGIN SET @x = 1 PRINT @x SELECT @x END',
        statements: ['SET @x = 1', 'PRINT @x', 'SELECT @x'] },
    { name: 'T-SQL semicolon then unterminated', dialect: 'tsql',
        sql: 'CREATE PROC dbo.p AS BEGIN SELECT 1; SELECT 2 END',
        statements: ['SELECT 1', 'SELECT 2'] },
    { name: 'T-SQL terminated pair', dialect: 'tsql',
        sql: 'CREATE PROC dbo.p AS BEGIN SELECT 1; SELECT 2; END',
        statements: ['SELECT 1', 'SELECT 2'] },
    { name: 'DB2 one-line, no semicolons', dialect: 'db2',
        sql: 'CREATE PROCEDURE APP.P() LANGUAGE SQL BEGIN SET V = 1 UPDATE APP.T SET SEEN = 1 END',
        statements: ['SET V = 1', 'UPDATE APP.T SET SEEN = 1'] },
    { name: 'DB2 newline unterminated pair', dialect: 'db2',
        sql: 'CREATE PROCEDURE APP.P() LANGUAGE SQL BEGIN\nSET V = 1\nUPDATE APP.T SET SEEN = 1\nEND',
        statements: ['SET V = 1', 'UPDATE APP.T SET SEEN = 1'] },
    { name: 'PL/pgSQL one-line, no semicolons', dialect: 'plpgsql',
        sql: 'CREATE FUNCTION app.f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN x := 1 PERFORM app.g(); END; $$;',
        statements: ['x := 1', 'PERFORM app.g()'] },
    { name: 'SQLite single unterminated statement', dialect: 'sqlite',
        sql: 'CREATE TRIGGER t AFTER UPDATE ON item BEGIN\nUPDATE audit SET x = 1\nEND',
        statements: ['UPDATE audit SET x = 1'] },
    { name: 'SQLite two statements one line, no semicolons', dialect: 'sqlite',
        sql: 'CREATE TRIGGER t AFTER UPDATE ON item BEGIN UPDATE audit SET x = 1 UPDATE item SET y = 2 END',
        statements: ['UPDATE audit SET x = 1', 'UPDATE item SET y = 2'] },
    { name: 'View body with WITH schema-binding header', dialect: 'tsql',
        sql: 'CREATE VIEW dbo.v WITH SCHEMABINDING, VIEW_METADATA AS SELECT id FROM dbo.t;',
        statements: ['SELECT id FROM dbo.t'] },
    { name: 'T-SQL mixed one-line and block IF', dialect: 'tsql',
        sql: 'CREATE PROC dbo.p AS BEGIN IF @a = 1 SELECT 1; ELSE BEGIN SELECT 2; SELECT 3; END SET @done = 1 END',
        statements: ['SELECT 1', 'SELECT 2', 'SELECT 3', 'SET @done = 1'] },
    { name: 'DB2 mixed one-line and block IF', dialect: 'db2',
        sql: 'CREATE PROCEDURE APP.P() LANGUAGE SQL BEGIN IF V = 1 THEN SET V_A = 1; ELSE BEGIN SET V_B = 2; END; END IF; END',
        statements: ['SET V_A = 1', 'SET V_B = 2'] }
];
var PROCFLOW_BOUNDARY_FIXTURES = [
    {
        name: 'T-SQL · CREATE VIEW WITH schema-binding header',
        dialect: 'tsql',
        sql: 'CREATE VIEW dbo.v57 WITH SCHEMABINDING, VIEW_METADATA AS SELECT id FROM dbo.t;',
        expect: { object: 'dbo.v57', read: 'dbo.t' }
    },
    {
        name: 'T-SQL · CREATE VIEW body starts with WITH CTE',
        dialect: 'tsql',
        sql: 'CREATE VIEW dbo.v58 AS WITH c AS (SELECT id FROM dbo.t) SELECT id FROM c;',
        expect: { object: 'dbo.v58', read: 'dbo.t' }
    },
    {
        name: 'T-SQL · ALTER TRIGGER header',
        dialect: 'tsql',
        sql: 'ALTER TRIGGER dbo.tr59 ON dbo.t AFTER INSERT AS BEGIN\nINSERT INTO dbo.audit(id) SELECT id FROM inserted;\nEND',
        expect: { object: 'dbo.tr59', write: 'dbo.audit' }
    },
    {
        name: 'T-SQL · semicolon-free one-line statements',
        dialect: 'tsql',
        sql: 'CREATE PROC dbo.p60 AS BEGIN SET @x = 1 PRINT @x SELECT @x END',
        expect: { object: 'dbo.p60', resultSets: 1, noErrors: true, coverageMin: 1 }
    }
];
PROCFLOW_FIXTURES = PROCFLOW_FIXTURES.concat(PROCFLOW_BOUNDARY_FIXTURES);
//# sourceMappingURL=boundary.js.map