"use strict";
var PROCFLOW_FIXTURES = [
    {
        name: 'T-SQL procedure',
        dialect: 'tsql',
        sql: [
            'CREATE OR ALTER PROCEDURE dbo.sync_student @id int AS',
            'BEGIN',
            '  IF @id IS NULL RETURN;',
            '  EXEC dbo.load_student @id;',
            '  SELECT id INTO #student_stage FROM dbo.student WHERE id = @id;',
            '  UPDATE dbo.student SET synced = 1 WHERE id = @id;',
            '  SELECT id FROM dbo.student WHERE id = @id;',
            'END'
        ].join('\n'),
        expect: { mode: 'flow', branch: 1, call: 'dbo.load_student', write: 'dbo.student',
            write2: '#student_stage', resultSets: 1 }
    },
    {
        name: 'DB2 SQL PL procedure',
        dialect: 'db2',
        sql: [
            'CREATE PROCEDURE APP.P() LANGUAGE SQL',
            'BEGIN',
            '  DECLARE EXIT HANDLER FOR SQLEXCEPTION ROLLBACK;',
            '  IF 1 = 1 THEN CALL APP.LOG_OK(); ELSE SIGNAL SQLSTATE \'75001\'; END IF;',
            'END'
        ].join('\n'),
        expect: { mode: 'flow', branch: 1, cat: 1, call: 'APP.LOG_OK' }
    },
    {
        name: 'PL/pgSQL function with dynamic SQL',
        dialect: 'plpgsql',
        sql: [
            'CREATE FUNCTION app.lookup(p_table text) RETURNS void LANGUAGE plpgsql AS $$',
            'BEGIN',
            '  EXECUTE format(\'SELECT * FROM %I\', p_table);',
            'END;',
            '$$;'
        ].join('\n'),
        expect: { mode: 'flow', opaque: 1, diagnostic: 'dynamic_sql' }
    },
    {
        name: 'SQLite trigger',
        dialect: 'sqlite',
        sql: [
            'CREATE TRIGGER audit_student AFTER UPDATE ON student',
            'FOR EACH ROW WHEN old.name <> new.name',
            'BEGIN',
            '  INSERT INTO audit(student_id) VALUES (new.id);',
            'END;'
        ].join('\n'),
        expect: { mode: 'flow', branch: 1, write: 'audit' }
    },
    {
        name: 'View CTE lineage',
        dialect: 'tsql',
        sql: [
            'CREATE VIEW dbo.active_student AS',
            'WITH enrolment AS (',
            '  SELECT student_id FROM dbo.enrolment WHERE active = 1',
            ')',
            'SELECT s.id FROM dbo.student s JOIN enrolment e ON e.student_id = s.id;'
        ].join('\n'),
        expect: { mode: 'query', ctes: 1, tables: 2 }
    },
    {
        name: 'Report dataset query',
        dialect: 'tsql',
        sql: [
            'WITH totals AS (',
            '  SELECT school_id, COUNT(*) total FROM dbo.student GROUP BY school_id',
            ')',
            'SELECT s.name, t.total FROM dbo.school s JOIN totals t ON t.school_id=s.id;'
        ].join('\n'),
        expect: { mode: 'query', ctes: 1, tables: 2, resultSets: 1 }
    }
];
var PROCFLOW_ESTATE_FIXTURE = {
    name: 'school.sql',
    text: [
        'CREATE VIEW dbo.student_export AS',
        'SELECT id FROM dbo.student;',
        'GO',
        'CREATE PROCEDURE dbo.refresh_export AS',
        'BEGIN',
        '  EXEC dbo.audit_refresh;',
        '  UPDATE dbo.student SET refreshed = 1;',
        '  SELECT id FROM dbo.student_export;',
        'END'
    ].join('\n')
};
//# sourceMappingURL=fixtures.js.map