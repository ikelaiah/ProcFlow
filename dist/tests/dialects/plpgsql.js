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
                    toText: 'Implicit rollback · unique_violation OR SQLSTATE' },
                { fromText: 'Implicit rollback · unique_violation OR SQLSTATE',
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
                { fromText: 'EXCEPTION WHEN unique_violation',
                    toText: 'Implicit rollback · unique_violation' },
                { fromText: 'Implicit rollback · unique_violation', toText: 'PERFORM app.log_inner' },
                { fromText: 'RAISE', fromOccurrence: 2, toText: 'EXCEPTION WHEN OTHERS',
                    style: 'dotted' },
                { fromText: 'EXCEPTION WHEN OTHERS', toText: 'Implicit rollback · OTHERS' },
                { fromText: 'Implicit rollback · OTHERS', toText: 'PERFORM app.log_outer' },
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
                { fromText: 'EXCEPTION WHEN assert_failure',
                    toText: 'Implicit rollback · assert_failure' },
                { fromText: 'Implicit rollback · assert_failure', toText: 'PERFORM app.log_assertion' },
                { fromText: 'PERFORM app.log_assertion', toText: 'PERFORM app.after_assertion' }
            ],
            forbidden: [
                { fromText: 'RAISE assert_failure', toText: 'EXCEPTION WHEN OTHERS' },
                { fromText: 'EXCEPTION WHEN OTHERS', toText: 'PERFORM app.should_not_run' },
                { fromText: 'PERFORM app.should_not_run', toText: 'PERFORM app.after_assertion' }
            ],
            sourced: ['RAISE assert_failure', 'PERFORM app.should_not_run']
        }
    },
    {
        name: 'PL/pgSQL graph · exception subtransaction rolls back data but keeps variables',
        dialect: 'plpgsql',
        sql: [
            'CREATE FUNCTION app.retry_order() RETURNS integer LANGUAGE plpgsql AS $$',
            'DECLARE',
            '  v_attempts integer := 0;',
            'BEGIN',
            "  INSERT INTO app.audit(event) VALUES ('before block');",
            '  BEGIN',
            "    UPDATE app.orders SET state = 'retrying';",
            '    v_attempts := v_attempts + 1;',
            '    RAISE division_by_zero;',
            '  EXCEPTION',
            '    WHEN division_by_zero THEN',
            '      PERFORM app.record_attempt(v_attempts);',
            '  END;',
            "  INSERT INTO app.audit(event) VALUES ('after block');",
            '  RETURN v_attempts;',
            'END;',
            '$$;'
        ].join('\n'),
        expect: { mode: 'flow', cat: 1, exit: 2, noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: 'INSERT INTO app.audit', fromOccurrence: 1,
                    toText: 'BEGIN exception block · subtransaction' },
                { fromText: 'UPDATE app.orders', toText: 'v_attempts := v_attempts + 1' },
                { fromText: 'v_attempts := v_attempts + 1', toText: 'RAISE division_by_zero' },
                { fromText: 'RAISE division_by_zero',
                    toText: 'EXCEPTION WHEN division_by_zero', style: 'dotted' },
                { fromText: 'EXCEPTION WHEN division_by_zero',
                    toText: 'Implicit rollback · division_by_zero' },
                { fromText: 'Implicit rollback · division_by_zero',
                    toText: 'PERFORM app.record_attempt' },
                { fromText: 'PERFORM app.record_attempt',
                    toText: 'INSERT INTO app.audit', toOccurrence: 2 },
                { fromText: 'INSERT INTO app.audit', fromOccurrence: 2, toText: 'RETURN v_attempts' }
            ],
            forbidden: [
                { fromText: 'UPDATE app.orders', toText: 'INSERT INTO app.audit', toOccurrence: 2 },
                { fromText: 'EXCEPTION WHEN division_by_zero', toText: 'PERFORM app.record_attempt' }
            ],
            sourced: [
                { text: 'INSERT INTO app.audit', occurrence: 1 }, 'UPDATE app.orders',
                'v_attempts := v_attempts + 1', 'RAISE division_by_zero',
                { text: 'INSERT INTO app.audit', occurrence: 2 }, 'RETURN v_attempts'
            ]
        }
    },
    {
        name: 'PL/pgSQL graph · function transaction control is rejected',
        dialect: 'plpgsql',
        sql: [
            'CREATE FUNCTION app.invalid_commit() RETURNS void LANGUAGE plpgsql AS $$',
            'BEGIN',
            '  COMMIT;',
            '  PERFORM app.never_reached();',
            'END;',
            '$$;'
        ].join('\n'),
        expect: {
            mode: 'flow', exit: 1, diagnostic: 'plpgsql_transaction_context', coverageMin: 1
        },
        graphExpect: {
            required: [],
            forbidden: [
                { fromText: 'COMMIT — invalid: requires eligible CALL or DO context',
                    toText: 'PERFORM app.never_reached' }
            ],
            sourced: [
                'COMMIT — invalid: requires eligible CALL or DO context',
                'PERFORM app.never_reached'
            ]
        }
    },
    {
        name: 'PL/pgSQL graph · procedure transaction control requires eligible CALL chain',
        dialect: 'plpgsql',
        sql: [
            'CREATE PROCEDURE app.rotate_batches() LANGUAGE plpgsql AS $$',
            'BEGIN',
            '  INSERT INTO app.batch_log(id) VALUES (1);',
            '  COMMIT AND CHAIN;',
            '  UPDATE app.batch_log SET complete = true;',
            '  ROLLBACK;',
            'END;',
            '$$;'
        ].join('\n'),
        expect: {
            mode: 'flow', exit: 0, diagnostic: 'plpgsql_transaction_context_required',
            noErrors: true, coverageMin: 1
        },
        graphExpect: {
            required: [
                { fromText: 'INSERT INTO app.batch_log',
                    toText: 'COMMIT AND CHAIN — requires eligible CALL context' },
                { fromText: 'COMMIT AND CHAIN — requires eligible CALL context',
                    toText: 'UPDATE app.batch_log' },
                { fromText: 'UPDATE app.batch_log',
                    toText: 'ROLLBACK — requires eligible CALL context' }
            ],
            forbidden: [],
            sourced: [
                'INSERT INTO app.batch_log', 'COMMIT AND CHAIN — requires eligible CALL context',
                'UPDATE app.batch_log', 'ROLLBACK — requires eligible CALL context'
            ]
        }
    },
    {
        name: 'PL/pgSQL graph · transaction control inside EXCEPTION scope is rejected',
        dialect: 'plpgsql',
        sql: [
            'CREATE PROCEDURE app.invalid_subtransaction_commit() LANGUAGE plpgsql AS $$',
            'BEGIN',
            '  BEGIN',
            '    INSERT INTO app.work_log(id) VALUES (1);',
            '    COMMIT;',
            '  EXCEPTION',
            '    WHEN OTHERS THEN',
            '      PERFORM app.log_failure();',
            '  END;',
            'END;',
            '$$;'
        ].join('\n'),
        expect: {
            mode: 'flow', cat: 1, exit: 1,
            diagnostic: 'plpgsql_transaction_in_exception_scope', coverageMin: 1
        },
        graphExpect: {
            required: [
                { fromText: 'INSERT INTO app.work_log',
                    toText: 'COMMIT — invalid inside EXCEPTION subtransaction' },
                { fromText: 'COMMIT — invalid inside EXCEPTION subtransaction',
                    toText: 'EXCEPTION WHEN OTHERS', style: 'dotted' },
                { fromText: 'EXCEPTION WHEN OTHERS', toText: 'Implicit rollback · OTHERS' },
                { fromText: 'Implicit rollback · OTHERS', toText: 'PERFORM app.log_failure' }
            ],
            forbidden: [
                { fromText: 'EXCEPTION WHEN OTHERS', toText: 'PERFORM app.log_failure' }
            ],
            sourced: [
                'INSERT INTO app.work_log', 'COMMIT — invalid inside EXCEPTION subtransaction',
                'PERFORM app.log_failure'
            ]
        }
    },
    {
        name: 'PL/pgSQL graph · DO transaction control is eligible',
        dialect: 'plpgsql',
        sql: [
            'DO $$',
            'BEGIN',
            '  INSERT INTO app.do_log(id) VALUES (1);',
            '  COMMIT;',
            '  INSERT INTO app.do_log(id) VALUES (2);',
            'END;',
            '$$ LANGUAGE plpgsql;'
        ].join('\n'),
        expect: { mode: 'flow', exit: 0, noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: 'INSERT INTO app.do_log', fromOccurrence: 1,
                    toText: 'COMMIT — eligible DO transaction control' },
                { fromText: 'COMMIT — eligible DO transaction control',
                    toText: 'INSERT INTO app.do_log', toOccurrence: 2 }
            ],
            forbidden: [],
            sourced: [
                { text: 'INSERT INTO app.do_log', occurrence: 1 },
                'COMMIT — eligible DO transaction control',
                { text: 'INSERT INTO app.do_log', occurrence: 2 }
            ]
        }
    },
    {
        name: 'PL/pgSQL graph · savepoint commands are rejected',
        dialect: 'plpgsql',
        sql: [
            'CREATE PROCEDURE app.invalid_savepoint() LANGUAGE plpgsql AS $$',
            'BEGIN',
            '  SAVEPOINT before_write;',
            '  UPDATE app.orders SET state = \'queued\';',
            'END;',
            '$$;'
        ].join('\n'),
        expect: {
            mode: 'flow', exit: 1, diagnostic: 'plpgsql_savepoint_unsupported', coverageMin: 1
        },
        graphExpect: {
            required: [],
            forbidden: [
                { fromText: 'SAVEPOINT before_write — invalid: PL/pgSQL does not support savepoints',
                    toText: 'UPDATE app.orders' }
            ],
            sourced: [
                'SAVEPOINT before_write — invalid: PL/pgSQL does not support savepoints',
                'UPDATE app.orders'
            ]
        }
    },
    {
        name: 'PL/pgSQL graph · unresolved EXIT target gets an explicit node',
        dialect: 'plpgsql',
        sql: [
            'CREATE FUNCTION app.bad_exit() RETURNS void LANGUAGE plpgsql AS $$',
            'BEGIN',
            '  LOOP',
            '    EXIT missing_loop;',
            '  END LOOP;',
            'END;',
            '$$;'
        ].join('\n'),
        expect: { mode: 'flow', loop: 1, diagnostic: 'goto_unresolved', noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: 'EXIT missing_loop', toText: 'Unresolved label: missing_loop', style: 'dotted' }
            ],
            forbidden: [
                { fromText: 'EXIT missing_loop', toText: 'loop' },
                { fromText: 'EXIT missing_loop', toText: 'End' }
            ],
            sourced: ['EXIT missing_loop']
        }
    }
];
PROCFLOW_GRAPH_FIXTURES =
    PROCFLOW_GRAPH_FIXTURES.concat(PROCFLOW_PLPGSQL_GRAPH_FIXTURES);
PROCFLOW_FIXTURES = PROCFLOW_FIXTURES.concat(PROCFLOW_PLPGSQL_GRAPH_FIXTURES);
//# sourceMappingURL=plpgsql.js.map