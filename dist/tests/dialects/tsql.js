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
    },
    {
        name: 'T-SQL graph · XACT_STATE recovery branches',
        dialect: 'tsql',
        sql: [
            'CREATE PROCEDURE dbo.recover_transaction AS',
            'BEGIN',
            '  SET XACT_ABORT ON;',
            '  BEGIN TRY',
            '    BEGIN TRANSACTION;',
            "    UPDATE dbo.Work SET Status = 'complete';",
            '    COMMIT TRANSACTION;',
            '  END TRY',
            '  BEGIN CATCH',
            '    IF XACT_STATE() = -1',
            '    BEGIN',
            '      ROLLBACK TRANSACTION;',
            '    END',
            '    ELSE IF XACT_STATE() = 1',
            '    BEGIN',
            '      COMMIT TRANSACTION;',
            '    END',
            '    ELSE',
            "      PRINT 'No active transaction';",
            '    THROW;',
            '  END CATCH;',
            '  SET @done = 1;',
            'END'
        ].join('\n'),
        expect: { mode: 'flow', branch: 2, cat: 1, exit: 1, noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: 'UPDATE dbo.Work', toText: 'BEGIN CATCH', style: 'dotted' },
                { fromText: 'BEGIN CATCH', toText: 'XACT_STATE() = -1 · uncommittable?' },
                { fromText: 'XACT_STATE() = -1 · uncommittable?',
                    toText: 'ROLLBACK TRANSACTION — required full rollback',
                    label: 'yes · -1 · uncommittable' },
                { fromText: 'XACT_STATE() = -1 · uncommittable?',
                    toText: 'XACT_STATE() = 1 · committable?',
                    label: 'no · not uncommittable' },
                { fromText: 'XACT_STATE() = 1 · committable?',
                    toText: 'COMMIT TRANSACTION — commit committable transaction',
                    label: 'yes · 1 · committable' },
                { fromText: 'XACT_STATE() = 1 · committable?',
                    toText: "PRINT 'No active transaction'",
                    label: 'no · 0 · no transaction' },
                { fromText: 'ROLLBACK TRANSACTION — required full rollback', toText: 'THROW' },
                { fromText: 'COMMIT TRANSACTION — commit committable transaction', toText: 'THROW' },
                { fromText: "PRINT 'No active transaction'", toText: 'THROW' },
                { fromText: 'COMMIT TRANSACTION', fromOccurrence: 1, toText: 'SET @done = 1' }
            ],
            forbidden: [
                { fromText: 'ROLLBACK TRANSACTION — required full rollback', toText: 'SET @done = 1' },
                { fromText: 'COMMIT TRANSACTION — commit committable transaction',
                    toText: 'SET @done = 1' },
                { fromText: "PRINT 'No active transaction'", toText: 'SET @done = 1' },
                { fromText: 'THROW', toText: 'SET @done = 1' }
            ],
            sourced: [
                'XACT_STATE() = -1 · uncommittable?',
                'ROLLBACK TRANSACTION — required full rollback',
                'XACT_STATE() = 1 · committable?',
                'COMMIT TRANSACTION — commit committable transaction',
                "PRINT 'No active transaction'", 'THROW'
            ]
        }
    },
    {
        name: 'T-SQL graph · XACT_STATE active rollback',
        dialect: 'tsql',
        sql: [
            'CREATE PROCEDURE dbo.rollback_active AS',
            'BEGIN',
            '  BEGIN TRY',
            '    BEGIN TRANSACTION;',
            "    THROW 50010, 'stop', 1;",
            '  END TRY',
            '  BEGIN CATCH',
            '    IF XACT_STATE() <> 0',
            '      ROLLBACK TRANSACTION;',
            '    THROW;',
            '  END CATCH;',
            '  SET @unreachable = 1;',
            'END'
        ].join('\n'),
        expect: { mode: 'flow', branch: 1, cat: 1, exit: 2, noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: "THROW 50010, 'stop', 1", toText: 'BEGIN CATCH', style: 'dotted' },
                { fromText: 'BEGIN CATCH', toText: 'XACT_STATE() <> 0 · transaction active?' },
                { fromText: 'XACT_STATE() <> 0 · transaction active?',
                    toText: 'ROLLBACK TRANSACTION — roll back active transaction',
                    label: 'yes · active · commit status unknown' },
                { fromText: 'XACT_STATE() <> 0 · transaction active?',
                    toText: 'THROW', toOccurrence: 2, label: 'no · 0 · no transaction' },
                { fromText: 'ROLLBACK TRANSACTION — roll back active transaction',
                    toText: 'THROW', toOccurrence: 2 }
            ],
            forbidden: [
                { fromText: 'THROW', fromOccurrence: 2, toText: 'SET @unreachable = 1' },
                { fromText: 'SET @unreachable = 1', toText: 'End' }
            ],
            sourced: [
                'XACT_STATE() <> 0 · transaction active?',
                'ROLLBACK TRANSACTION — roll back active transaction',
                { text: 'THROW', occurrence: 2 }, 'SET @unreachable = 1'
            ]
        }
    },
    {
        name: 'T-SQL graph · invalid transaction recovery terminates',
        dialect: 'tsql',
        sql: [
            'CREATE PROCEDURE dbo.invalid_recovery AS',
            'BEGIN',
            '  IF XACT_STATE() = -1',
            '    COMMIT TRANSACTION;',
            '  ELSE IF XACT_STATE() = 0',
            '    ROLLBACK TRANSACTION;',
            '  SET @valid_path = 1;',
            'END'
        ].join('\n'),
        expect: { mode: 'flow', branch: 2, exit: 2, noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: 'XACT_STATE() = -1 · uncommittable?',
                    toText: 'COMMIT TRANSACTION — invalid: transaction uncommittable',
                    label: 'yes · -1 · uncommittable' },
                { fromText: 'XACT_STATE() = -1 · uncommittable?',
                    toText: 'XACT_STATE() = 0 · no active transaction?',
                    label: 'no · not uncommittable' },
                { fromText: 'XACT_STATE() = 0 · no active transaction?',
                    toText: 'ROLLBACK TRANSACTION — invalid: no active transaction',
                    label: 'yes · 0 · no transaction' },
                { fromText: 'XACT_STATE() = 0 · no active transaction?',
                    toText: 'SET @valid_path = 1', label: 'no · 1 · committable' },
                { fromText: 'SET @valid_path = 1', toText: 'End' }
            ],
            forbidden: [
                { fromText: 'COMMIT TRANSACTION — invalid: transaction uncommittable',
                    toText: 'SET @valid_path = 1' },
                { fromText: 'ROLLBACK TRANSACTION — invalid: no active transaction',
                    toText: 'SET @valid_path = 1' }
            ],
            sourced: [
                'COMMIT TRANSACTION — invalid: transaction uncommittable',
                'ROLLBACK TRANSACTION — invalid: no active transaction',
                'SET @valid_path = 1'
            ]
        }
    }
];
PROCFLOW_GRAPH_FIXTURES = PROCFLOW_GRAPH_FIXTURES.concat(PROCFLOW_TSQL_GRAPH_FIXTURES);
PROCFLOW_FIXTURES = PROCFLOW_FIXTURES.concat(PROCFLOW_TSQL_GRAPH_FIXTURES);
//# sourceMappingURL=tsql.js.map