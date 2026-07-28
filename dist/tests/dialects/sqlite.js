"use strict";
/* SQLite fixtures for trigger RAISE action and termination semantics. */
var PROCFLOW_SQLITE_GRAPH_FIXTURES = [
    {
        name: 'SQLite graph · RAISE IGNORE abandons without rollback',
        dialect: 'sqlite',
        sql: [
            'CREATE TRIGGER app.ignore_invalid BEFORE INSERT ON item',
            'FOR EACH ROW WHEN NEW.value IS NULL',
            'BEGIN',
            "  INSERT INTO audit(message) VALUES ('before ignore');",
            '  SELECT RAISE(IGNORE);',
            "  INSERT INTO audit(message) VALUES ('unreachable');",
            'END;'
        ].join('\n'),
        expect: { mode: 'flow', branch: 1, exit: 1, noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: 'NEW.value IS NULL', toText: 'INSERT INTO audit', toOccurrence: 1, label: 'yes' },
                { fromText: 'INSERT INTO audit', fromOccurrence: 1, toText: 'RAISE IGNORE' }
            ],
            forbidden: [
                { fromText: 'RAISE IGNORE', toText: 'INSERT INTO audit', toOccurrence: 2 },
                { fromText: 'INSERT INTO audit', fromOccurrence: 2, toText: 'End' }
            ],
            sourced: [
                { text: 'INSERT INTO audit', occurrence: 1 }, 'RAISE IGNORE',
                { text: 'INSERT INTO audit', occurrence: 2 }
            ]
        }
    },
    {
        name: 'SQLite graph · RAISE FAIL preserves prior statement changes',
        dialect: 'sqlite',
        sql: [
            'CREATE TRIGGER app.fail_invalid AFTER UPDATE ON item',
            'BEGIN',
            '  UPDATE audit SET attempts = attempts + 1 WHERE item_id = NEW.id;',
            "  SELECT RAISE(FAIL, 'invalid item ' || NEW.id);",
            '  DELETE FROM pending WHERE item_id = NEW.id;',
            'END;'
        ].join('\n'),
        expect: { mode: 'flow', exit: 1, noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: 'UPDATE audit', toText: 'RAISE FAIL' }
            ],
            forbidden: [
                { fromText: 'RAISE FAIL', toText: 'DELETE FROM pending' },
                { fromText: 'DELETE FROM pending', toText: 'End' }
            ],
            sourced: ['UPDATE audit', 'RAISE FAIL', 'DELETE FROM pending']
        }
    },
    {
        name: 'SQLite graph · RAISE ABORT rolls back statement changes',
        dialect: 'sqlite',
        sql: [
            'CREATE TRIGGER app.abort_invalid BEFORE UPDATE ON item',
            'BEGIN',
            "  INSERT INTO audit(message) VALUES ('before abort');",
            "  SELECT RAISE(ABORT, 'invalid item');",
            '  UPDATE item SET checked = 1 WHERE id = NEW.id;',
            'END;'
        ].join('\n'),
        expect: { mode: 'flow', exit: 1, noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: 'INSERT INTO audit', toText: 'RAISE ABORT' }
            ],
            forbidden: [
                { fromText: 'RAISE ABORT', toText: 'UPDATE item' },
                { fromText: 'UPDATE item', toText: 'End' }
            ],
            sourced: ['INSERT INTO audit', 'RAISE ABORT', 'UPDATE item']
        }
    },
    {
        name: 'SQLite graph · RAISE ROLLBACK rolls back transaction',
        dialect: 'sqlite',
        sql: [
            'CREATE TRIGGER app.rollback_invalid BEFORE DELETE ON item',
            'BEGIN',
            "  INSERT INTO audit(message) VALUES ('before rollback');",
            "  SELECT RAISE(ROLLBACK, 'invalid delete');",
            '  DELETE FROM audit WHERE item_id = OLD.id;',
            'END;'
        ].join('\n'),
        expect: { mode: 'flow', exit: 1, noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: 'INSERT INTO audit', toText: 'RAISE ROLLBACK' }
            ],
            forbidden: [
                { fromText: 'RAISE ROLLBACK', toText: 'DELETE FROM audit' },
                { fromText: 'DELETE FROM audit', toText: 'End' }
            ],
            sourced: ['INSERT INTO audit', 'RAISE ROLLBACK', 'DELETE FROM audit']
        }
    }
];
PROCFLOW_GRAPH_FIXTURES =
    PROCFLOW_GRAPH_FIXTURES.concat(PROCFLOW_SQLITE_GRAPH_FIXTURES);
PROCFLOW_FIXTURES = PROCFLOW_FIXTURES.concat(PROCFLOW_SQLITE_GRAPH_FIXTURES);
//# sourceMappingURL=sqlite.js.map