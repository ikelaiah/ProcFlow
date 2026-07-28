"use strict";
/* T-SQL fixtures whose assertions describe exception and terminating-flow edges. */
var PROCFLOW_TSQL_GRAPH_FIXTURES = [
    {
        name: 'T-SQL graph · THROW transfers to CATCH',
        dialect: 'tsql',
        sql: [
            'CREATE PROCEDURE dbo.throw_flow AS',
            'BEGIN',
            '  BEGIN TRY',
            "    UPDATE dbo.Work SET Status = 'started';",
            "    THROW 50001, 'stop', 1;",
            '    DELETE FROM dbo.Unreachable;',
            '  END TRY',
            '  BEGIN CATCH',
            '    INSERT INTO dbo.ErrorLog(ErrorNumber) VALUES (ERROR_NUMBER());',
            '  END CATCH;',
            '  SET @done = 1;',
            'END'
        ].join('\n'),
        expect: { mode: 'flow', cat: 1, exit: 1, noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: 'UPDATE dbo.Work', toText: "THROW 50001, 'stop', 1" },
                { fromText: "THROW 50001, 'stop', 1", toText: 'BEGIN CATCH', style: 'dotted' },
                { fromText: 'BEGIN CATCH', toText: 'INSERT INTO dbo.ErrorLog' },
                { fromText: 'INSERT INTO dbo.ErrorLog', toText: 'SET @done = 1' }
            ],
            forbidden: [
                { fromText: "THROW 50001, 'stop', 1", toText: 'DELETE FROM dbo.Unreachable' },
                { fromText: 'DELETE FROM dbo.Unreachable', toText: 'BEGIN CATCH' },
                { fromText: 'DELETE FROM dbo.Unreachable', toText: 'SET @done = 1' }
            ],
            sourced: ["THROW 50001, 'stop', 1", 'DELETE FROM dbo.Unreachable']
        }
    },
    {
        name: 'T-SQL graph · nested CATCH rethrow',
        dialect: 'tsql',
        sql: [
            'CREATE PROCEDURE dbo.nested_rethrow AS',
            'BEGIN',
            '  BEGIN TRY',
            '    BEGIN TRY',
            "      THROW 50002, 'inner', 1;",
            '    END TRY',
            '    BEGIN CATCH',
            '      INSERT INTO dbo.InnerLog(ErrorNumber) VALUES (ERROR_NUMBER());',
            '      THROW;',
            '    END CATCH;',
            '    UPDATE dbo.Unreachable SET Value = 1;',
            '  END TRY',
            '  BEGIN CATCH',
            '    INSERT INTO dbo.OuterLog(ErrorNumber) VALUES (ERROR_NUMBER());',
            '  END CATCH;',
            '  SET @finished = 1;',
            'END'
        ].join('\n'),
        expect: { mode: 'flow', cat: 2, exit: 2, noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: "THROW 50002, 'inner', 1", toText: 'BEGIN CATCH',
                    toOccurrence: 1, style: 'dotted' },
                { fromText: 'BEGIN CATCH', fromOccurrence: 1, toText: 'INSERT INTO dbo.InnerLog' },
                { fromText: 'THROW', fromOccurrence: 2, toText: 'BEGIN CATCH',
                    toOccurrence: 2, style: 'dotted' },
                { fromText: 'BEGIN CATCH', fromOccurrence: 2, toText: 'INSERT INTO dbo.OuterLog' },
                { fromText: 'INSERT INTO dbo.OuterLog', toText: 'SET @finished = 1' }
            ],
            forbidden: [
                { fromText: "THROW 50002, 'inner', 1", toText: 'BEGIN CATCH', toOccurrence: 2 },
                { fromText: 'THROW', fromOccurrence: 2, toText: 'BEGIN CATCH', toOccurrence: 1 },
                { fromText: 'UPDATE dbo.Unreachable', toText: 'BEGIN CATCH', toOccurrence: 2 },
                { fromText: 'UPDATE dbo.Unreachable', toText: 'SET @finished = 1' }
            ],
            sourced: [
                "THROW 50002, 'inner', 1",
                { text: 'THROW', occurrence: 2 },
                'UPDATE dbo.Unreachable'
            ]
        }
    },
    {
        name: 'T-SQL graph · RAISERROR severity',
        dialect: 'tsql',
        sql: [
            'CREATE PROCEDURE dbo.raiserror_severity AS',
            'BEGIN',
            '  BEGIN TRY',
            "    RAISERROR('note', 10, 1);",
            '    SET @after_notice = 1;',
            "    RAISERROR('stop', 16, 1);",
            '    SET @unreachable = 1;',
            '  END TRY',
            '  BEGIN CATCH',
            '    SET @caught = 1;',
            '  END CATCH;',
            '  SET @done = 1;',
            'END'
        ].join('\n'),
        expect: { mode: 'flow', cat: 1, exit: 1, noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: "RAISERROR('note'", toText: 'SET @after_notice = 1' },
                { fromText: 'SET @after_notice = 1', toText: "RAISERROR('stop'" },
                { fromText: "RAISERROR('stop'", toText: 'BEGIN CATCH', style: 'dotted' },
                { fromText: 'BEGIN CATCH', toText: 'SET @caught = 1' },
                { fromText: 'SET @caught = 1', toText: 'SET @done = 1' }
            ],
            forbidden: [
                { fromText: "RAISERROR('note'", toText: 'BEGIN CATCH' },
                { fromText: "RAISERROR('stop'", toText: 'SET @unreachable = 1' },
                { fromText: 'SET @unreachable = 1', toText: 'BEGIN CATCH' },
                { fromText: 'SET @unreachable = 1', toText: 'SET @done = 1' }
            ],
            sourced: ["RAISERROR('note'", "RAISERROR('stop'", 'SET @unreachable = 1']
        }
    }
];
PROCFLOW_GRAPH_FIXTURES = PROCFLOW_GRAPH_FIXTURES.concat(PROCFLOW_TSQL_GRAPH_FIXTURES);
PROCFLOW_FIXTURES = PROCFLOW_FIXTURES.concat(PROCFLOW_TSQL_GRAPH_FIXTURES);
//# sourceMappingURL=tsql.js.map