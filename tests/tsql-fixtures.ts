(function(){
  function proc(name: string, body: string, params?: string): string {
    return 'CREATE OR ALTER PROCEDURE dbo.'+name+(params?' '+params:'')+
      ' AS\nBEGIN\n'+body+'\nEND';
  }
  function valid(name: string, sql: string, expect?: FixtureExpectation): ProcflowFixture {
    expect=expect||{};
    expect.noErrors=true;
    expect.coverageMin=1;
    return {name:'T-SQL · '+name,dialect:'tsql',sql:sql,expect:expect};
  }

  var cases: ProcflowFixture[]=[
    valid('simple select',proc('p01','SELECT id FROM dbo.student;'),{read:'dbo.student',resultSets:1}),
    valid('simple IF',proc('p02','IF @x = 1 SELECT 1;'),{branch:1}),
    valid('IF ELSE',proc('p03','IF @x = 1 SELECT 1; ELSE SELECT 2;'),{branch:1,resultSets:2}),
    valid('nested IF',proc('p04','IF @x > 0 BEGIN\n IF @y > 0 SELECT 1;\nEND'),{branch:2}),
    valid('WHILE loop',proc('p05','WHILE @x < 10 BEGIN\n SET @x += 1;\nEND'),{loop:1}),
    valid('WHILE BREAK',proc('p06','WHILE 1 = 1 BEGIN\n IF @done = 1 BREAK;\nEND'),{loop:1,branch:1}),
    valid('WHILE CONTINUE',proc('p07','WHILE @x < 10 BEGIN\n SET @x += 1;\n CONTINUE;\nEND'),{loop:1}),
    valid('TRY CATCH',proc('p08','BEGIN TRY\n SELECT 1;\nEND TRY\nBEGIN CATCH\n SELECT ERROR_MESSAGE();\nEND CATCH'),{cat:1}),
    valid('THROW',proc('p09','THROW 50001, \'failed\', 1;'),{exit:1}),
    valid('early RETURN',proc('p10','IF @x IS NULL RETURN;\nSELECT @x;'),{branch:1,exit:1}),
    valid('EXEC procedure',proc('p11','EXEC dbo.child @id = 1;'),{call:'dbo.child'}),
    valid('EXEC output assignment',proc('p12','EXEC @rc = dbo.child @id = 1;'),{call:'dbo.child'}),
    valid('sp_executesql opaque',proc('p13','EXEC sp_executesql N\'SELECT 1\';'),{opaque:1,diagnostic:'dynamic_sql'}),
    valid('EXEC variable opaque',proc('p14','EXEC(@sql);'),{opaque:1,diagnostic:'dynamic_sql'}),
    valid('transaction',proc('p15','BEGIN TRANSACTION;\nUPDATE dbo.t SET x=1;\nCOMMIT TRANSACTION;'),{write:'dbo.t'}),
    valid('INSERT values',proc('p16','INSERT INTO dbo.t(id) VALUES (1);'),{write:'dbo.t'}),
    valid('INSERT SELECT',proc('p17','INSERT INTO dbo.target(id) SELECT id FROM dbo.source;'),{write:'dbo.target',read:'dbo.source'}),
    valid('UPDATE',proc('p18','UPDATE dbo.t SET x=1 WHERE id=2;'),{write:'dbo.t'}),
    valid('UPDATE FROM',proc('p19','UPDATE t SET x=s.x FROM dbo.target t JOIN dbo.source s ON s.id=t.id;'),{read:'dbo.target',read2:'dbo.source'}),
    valid('DELETE',proc('p20','DELETE FROM dbo.t WHERE id=1;'),{write:'dbo.t'}),
    valid('MERGE',proc('p21','MERGE INTO dbo.target t USING dbo.source s ON s.id=t.id WHEN MATCHED THEN UPDATE SET t.x=s.x;'),{write:'dbo.target'}),
    valid('SELECT INTO temp',proc('p22','SELECT id INTO #stage FROM dbo.source;'),{write:'#stage',read:'dbo.source'}),
    valid('temp table pipeline',proc('p23','SELECT id INTO #stage FROM dbo.source;\nUPDATE #stage SET id=id+1;\nSELECT id FROM #stage;'),{write:'#stage',read:'dbo.source',resultSets:1}),
    valid('single CTE',proc('p24','WITH a AS (SELECT id FROM dbo.t) SELECT id FROM a;'),{read:'dbo.t',resultSets:1}),
    valid('chained CTEs',proc('p25','WITH a AS (SELECT id FROM dbo.t), b AS (SELECT id FROM a) SELECT id FROM b;'),{read:'dbo.t',resultSets:1}),
    valid('recursive CTE',proc('p26','WITH n AS (SELECT 1 x UNION ALL SELECT x+1 FROM n WHERE x<5) SELECT x FROM n;'),{resultSets:1}),
    valid('CASE expression',proc('p27','SELECT CASE WHEN x=1 THEN \'a\' ELSE \'b\' END FROM dbo.t;'),{read:'dbo.t',resultSets:1}),
    valid('cursor lifecycle',proc('p28','DECLARE c CURSOR FOR SELECT id FROM dbo.t;\nOPEN c;\nFETCH NEXT FROM c INTO @id;\nCLOSE c;\nDEALLOCATE c;'),{read:'dbo.t'}),
    valid('RAISERROR',proc('p29','RAISERROR(\'failed\',16,1);'),{}),
    valid('GOTO label',proc('p30','GOTO finished;\nSELECT 1;\nfinished:\nRETURN;'),{exit:1}),
    valid('semicolon-free statements',proc('p31','SET @x = 1\nPRINT @x\nSELECT @x'),{resultSets:1}),
    valid('line and block comments',proc('p32','-- IF ignored\n/* WHILE ignored */\nSELECT id FROM dbo.t;'),{read:'dbo.t'}),
    valid('escaped bracket identifier',proc('p33','SELECT [odd]]name] FROM [dbo].[source]]table];'),{resultSets:1}),
    valid('escaped quoted identifier',proc('p34','SELECT "odd""name" FROM "dbo"."source";'),{resultSets:1}),
    valid('keywords inside string',proc('p35','SELECT \'IF ELSE BEGIN END FROM dbo.fake\';'),{resultSets:1}),
    valid('nested parentheses',proc('p36','SELECT COALESCE((SELECT MAX(id) FROM dbo.t),0);'),{read:'dbo.t',resultSets:1}),
    valid('UNION',proc('p37','SELECT id FROM dbo.a UNION ALL SELECT id FROM dbo.b;'),{read:'dbo.a',read2:'dbo.b',resultSets:1}),
    valid('derived subquery',proc('p38','SELECT x.id FROM (SELECT id FROM dbo.t) x;'),{read:'dbo.t',resultSets:1}),
    valid('EXISTS subquery',proc('p39','SELECT id FROM dbo.a a WHERE EXISTS (SELECT 1 FROM dbo.b b WHERE b.id=a.id);'),{read:'dbo.a',read2:'dbo.b',resultSets:1}),
    valid('CROSS APPLY',proc('p40','SELECT a.id FROM dbo.a a CROSS APPLY dbo.fn(a.id) f;'),{read:'dbo.a',resultSets:1}),
    valid('OUTER APPLY',proc('p41','SELECT a.id FROM dbo.a a OUTER APPLY dbo.fn(a.id) f;'),{read:'dbo.a',resultSets:1}),
    valid('table-valued function source',proc('p42','SELECT id FROM dbo.fn_students(@year);'),{read:'dbo.fn_students',resultSets:1}),
    valid('multiple result sets',proc('p43','SELECT id FROM dbo.a;\nSELECT id FROM dbo.b;'),{read:'dbo.a',read2:'dbo.b',resultSets:2}),
    valid('CREATE VIEW','CREATE VIEW dbo.v44 AS SELECT id FROM dbo.t;',{object:'dbo.v44',read:'dbo.t'}),
    valid('ALTER VIEW','ALTER VIEW dbo.v45 AS SELECT id FROM dbo.t;',{object:'dbo.v45',read:'dbo.t'}),
    valid('CREATE OR ALTER procedure',proc('p46','SELECT 1;'),{object:'dbo.p46'}),
    valid('scalar function','CREATE FUNCTION dbo.f47(@x int) RETURNS int AS BEGIN\nRETURN @x+1;\nEND',{object:'dbo.f47',exit:1}),
    valid('inline table function','CREATE FUNCTION dbo.f48() RETURNS TABLE AS RETURN (SELECT id FROM dbo.t);',{object:'dbo.f48',read:'dbo.t'}),
    valid('DML trigger','CREATE TRIGGER dbo.tr49 ON dbo.t AFTER INSERT AS BEGIN\nINSERT INTO dbo.audit(id) SELECT id FROM inserted;\nEND',{object:'dbo.tr49',write:'dbo.audit'}),
    valid('OUTPUT clause',proc('p50','UPDATE dbo.t SET x=1 OUTPUT inserted.id WHERE id=2;'),{write:'dbo.t'}),
    valid('TRUNCATE TABLE',proc('p51','TRUNCATE TABLE dbo.stage;'),{write:'dbo.stage'}),
    valid('CREATE TABLE AS workflow',proc('p52','CREATE TABLE #stage(id int);\nINSERT INTO #stage(id) SELECT id FROM dbo.t;\nSELECT id FROM #stage;'),{write:'#stage',read:'dbo.t',resultSets:1}),
    valid('EXECUTE AS header','CREATE PROCEDURE dbo.p53 WITH EXECUTE AS OWNER AS BEGIN\nSELECT id FROM dbo.t;\nEND',{object:'dbo.p53',read:'dbo.t'}),
    valid('parameter forms',proc('p54','SELECT @id, @name;','@id int, @name nvarchar(50)=N\'x\', @out int OUTPUT'),{object:'dbo.p54',resultSets:1})
  ];

  PROCFLOW_FIXTURES=PROCFLOW_FIXTURES.concat(cases);
  window.PROCFLOW_TSQL_FIXTURE_COUNT=cases.length;
})();
