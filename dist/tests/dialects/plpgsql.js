"use strict";
/* PL/pgSQL fixtures for condition matching, block recovery, and error propagation. */
var PROCFLOW_PLPGSQL_GRAPH_FIXTURES = [
    {
        name: 'PL/pgSQL graph · first matching exception handler',
        dialect: 'plpgsql',
        sql: [
            'CREATE FUNCTION app.handle_unique() RETURNS void LANGUAGE plpgsql AS $$',
            'BEGIN',
            '  BEGIN',
            "    RAISE NOTICE 'checking item';",
            '    RAISE unique_violation;',
            '    UPDATE app.unreachable SET value = 1;',
            '  EXCEPTION',
            '    WHEN division_by_zero THEN',
            '      PERFORM app.log_division();',
            "    WHEN unique_violation OR SQLSTATE '23505' THEN",
            '      PERFORM app.log_unique();',
            '    WHEN OTHERS THEN',
            '      PERFORM app.log_other();',
            '  END;',
            '  PERFORM app.after_block();',
            'END;',
            '$$;'
        ].join('\n'),
        expect: { mode: 'flow', cat: 3, exit: 1, noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: "RAISE NOTICE 'checking item'", toText: 'RAISE unique_violation' },
                { fromText: 'RAISE unique_violation',
                    toText: "EXCEPTION WHEN unique_violation OR SQLSTATE '23505'", style: 'dotted' },
                { fromText: "EXCEPTION WHEN unique_violation OR SQLSTATE '23505'",
                    toText: 'PERFORM app.log_unique' },
                { fromText: 'PERFORM app.log_unique', toText: 'PERFORM app.after_block' }
            ],
            forbidden: [
                { fromText: "RAISE NOTICE 'checking item'", toText: 'EXCEPTION WHEN' },
                { fromText: 'RAISE unique_violation', toText: 'EXCEPTION WHEN division_by_zero' },
                { fromText: 'RAISE unique_violation', toText: 'EXCEPTION WHEN OTHERS' },
                { fromText: 'EXCEPTION WHEN division_by_zero', toText: 'PERFORM app.log_division' },
                { fromText: 'EXCEPTION WHEN OTHERS', toText: 'PERFORM app.log_other' },
                { fromText: 'UPDATE app.unreachable', toText: 'PERFORM app.after_block' }
            ],
            sourced: [
                "RAISE NOTICE 'checking item'", 'RAISE unique_violation',
                'UPDATE app.unreachable'
            ]
        }
    },
    {
        name: 'PL/pgSQL graph · nested handler rethrow',
        dialect: 'plpgsql',
        sql: [
            'CREATE FUNCTION app.rethrow_nested() RETURNS void LANGUAGE plpgsql AS $$',
            'BEGIN',
            '  BEGIN',
            '    BEGIN',
            "      RAISE SQLSTATE '23505';",
            '    EXCEPTION',
            '      WHEN unique_violation THEN',
            '        PERFORM app.log_inner();',
            '        RAISE;',
            '    END;',
            '    UPDATE app.unreachable SET value = 1;',
            '  EXCEPTION',
            '    WHEN OTHERS THEN',
            '      PERFORM app.log_outer();',
            '  END;',
            '  PERFORM app.after_rethrow();',
            'END;',
            '$$;'
        ].join('\n'),
        expect: { mode: 'flow', cat: 2, exit: 2, noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: "RAISE SQLSTATE '23505'", toText: 'EXCEPTION WHEN unique_violation',
                    style: 'dotted' },
                { fromText: 'EXCEPTION WHEN unique_violation', toText: 'PERFORM app.log_inner' },
                { fromText: 'RAISE', fromOccurrence: 2, toText: 'EXCEPTION WHEN OTHERS',
                    style: 'dotted' },
                { fromText: 'EXCEPTION WHEN OTHERS', toText: 'PERFORM app.log_outer' },
                { fromText: 'PERFORM app.log_outer', toText: 'PERFORM app.after_rethrow' }
            ],
            forbidden: [
                { fromText: "RAISE SQLSTATE '23505'", toText: 'EXCEPTION WHEN OTHERS' },
                { fromText: 'RAISE', fromOccurrence: 2, toText: 'EXCEPTION WHEN unique_violation' },
                { fromText: 'UPDATE app.unreachable', toText: 'EXCEPTION WHEN OTHERS' },
                { fromText: 'UPDATE app.unreachable', toText: 'PERFORM app.after_rethrow' }
            ],
            sourced: [
                "RAISE SQLSTATE '23505'", { text: 'RAISE', occurrence: 2 },
                'UPDATE app.unreachable'
            ]
        }
    },
    {
        name: 'PL/pgSQL graph · OTHERS exclusions propagate',
        dialect: 'plpgsql',
        sql: [
            'CREATE FUNCTION app.assert_propagates() RETURNS void LANGUAGE plpgsql AS $$',
            'BEGIN',
            '  BEGIN',
            '    BEGIN',
            '      RAISE assert_failure;',
            '    EXCEPTION',
            '      WHEN OTHERS THEN',
            '        PERFORM app.should_not_run();',
            '    END;',
            '  EXCEPTION',
            '    WHEN assert_failure THEN',
            '      PERFORM app.log_assertion();',
            '  END;',
            '  PERFORM app.after_assertion();',
            'END;',
            '$$;'
        ].join('\n'),
        expect: { mode: 'flow', cat: 2, exit: 1, noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: 'RAISE assert_failure', toText: 'EXCEPTION WHEN assert_failure',
                    style: 'dotted' },
                { fromText: 'EXCEPTION WHEN assert_failure', toText: 'PERFORM app.log_assertion' },
                { fromText: 'PERFORM app.log_assertion', toText: 'PERFORM app.after_assertion' }
            ],
            forbidden: [
                { fromText: 'RAISE assert_failure', toText: 'EXCEPTION WHEN OTHERS' },
                { fromText: 'EXCEPTION WHEN OTHERS', toText: 'PERFORM app.should_not_run' },
                { fromText: 'PERFORM app.should_not_run', toText: 'PERFORM app.after_assertion' }
            ],
            sourced: ['RAISE assert_failure', 'PERFORM app.should_not_run']
        }
    }
];
PROCFLOW_GRAPH_FIXTURES =
    PROCFLOW_GRAPH_FIXTURES.concat(PROCFLOW_PLPGSQL_GRAPH_FIXTURES);
PROCFLOW_FIXTURES = PROCFLOW_FIXTURES.concat(PROCFLOW_PLPGSQL_GRAPH_FIXTURES);
//# sourceMappingURL=plpgsql.js.map