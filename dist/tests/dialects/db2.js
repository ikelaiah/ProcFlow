"use strict";
/* DB2 SQL PL fixtures whose assertions describe control-flow edges, not just counts. */
var PROCFLOW_DB2_GRAPH_FIXTURES = [
    {
        name: 'DB2 graph · EXIT handler scope',
        dialect: 'db2',
        sql: [
            'CREATE PROCEDURE APP.EXIT_SCOPE()',
            'LANGUAGE SQL',
            'BEGIN',
            '  DECLARE V_ID INTEGER DEFAULT 0;',
            '  DECLARE EXIT HANDLER FOR SQLEXCEPTION',
            '    INSERT INTO APP.ERROR_LOG VALUES (V_ID);',
            '  UPDATE APP.T SET SEEN = 1;',
            '  SELECT ID FROM APP.T;',
            'END'
        ].join('\n'),
        expect: { mode: 'flow', cat: 1, noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: 'EXIT HANDLER FOR SQLEXCEPTION', toText: 'INSERT INTO APP.ERROR_LOG' },
                { fromText: 'INSERT INTO APP.ERROR_LOG', toText: 'Exit compound block' },
                { fromText: 'UPDATE APP.T', toText: 'EXIT HANDLER FOR SQLEXCEPTION',
                    label: 'SQLEXCEPTION', style: 'dotted' },
                { fromText: 'SELECT … FROM APP.T', toText: 'EXIT HANDLER FOR SQLEXCEPTION',
                    label: 'SQLEXCEPTION', style: 'dotted' },
                { fromText: 'Exit compound block', toText: 'End', label: 'handler exit' }
            ],
            forbidden: [
                { fromText: 'DECLARE V_ID', toText: 'EXIT HANDLER FOR SQLEXCEPTION' },
                { fromText: 'INSERT INTO APP.ERROR_LOG', toText: 'EXIT HANDLER FOR SQLEXCEPTION' },
                { fromText: 'APP.EXIT_SCOPE', toText: 'EXIT HANDLER FOR SQLEXCEPTION' }
            ]
        }
    },
    {
        name: 'DB2 graph · CONTINUE handler scope',
        dialect: 'db2',
        sql: [
            'CREATE PROCEDURE APP.CONTINUE_SCOPE()',
            'LANGUAGE SQL',
            'BEGIN',
            '  DECLARE V_DONE SMALLINT DEFAULT 0;',
            '  DECLARE CONTINUE HANDLER FOR NOT FOUND',
            '    SET V_DONE = 1;',
            '  SELECT ID INTO V_ID FROM APP.T WHERE ID = 1;',
            '  UPDATE APP.T SET SEEN = 1 WHERE ID = V_ID;',
            'END'
        ].join('\n'),
        expect: { mode: 'flow', cat: 1, noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: 'CONTINUE HANDLER FOR NOT FOUND', toText: 'SET V_DONE = 1' },
                { fromText: 'SET V_DONE = 1', toText: 'Resume after raising statement' },
                { fromText: 'SELECT … INTO V_ID', toText: 'CONTINUE HANDLER FOR NOT FOUND',
                    label: 'NOT FOUND', style: 'dotted' },
                { fromText: 'UPDATE APP.T', toText: 'CONTINUE HANDLER FOR NOT FOUND',
                    label: 'NOT FOUND', style: 'dotted' }
            ],
            forbidden: [
                { fromText: 'DECLARE V_DONE', toText: 'CONTINUE HANDLER FOR NOT FOUND' },
                { fromText: 'SET V_DONE = 1', toText: 'CONTINUE HANDLER FOR NOT FOUND' },
                { fromText: 'Resume after raising statement', toText: 'End' }
            ]
        }
    },
    {
        name: 'DB2 graph · nested handler shadowing',
        dialect: 'db2',
        sql: [
            'CREATE PROCEDURE APP.NESTED_HANDLERS()',
            'LANGUAGE SQL',
            'BEGIN',
            '  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION',
            '    SET OUTER_FLAG = 1;',
            '  UPDATE APP.OUTER_BEFORE SET VALUE = 1;',
            '  BEGIN',
            '    DECLARE EXIT HANDLER FOR SQLEXCEPTION',
            '      SET INNER_FLAG = 1;',
            '    DELETE FROM APP.INNER_T WHERE ID = 1;',
            '  END;',
            '  UPDATE APP.OUTER_AFTER SET VALUE = 1;',
            'END'
        ].join('\n'),
        expect: { mode: 'flow', cat: 2, noErrors: true, coverageMin: 1 },
        graphExpect: {
            required: [
                { fromText: 'UPDATE APP.OUTER_BEFORE', toText: 'CONTINUE HANDLER FOR SQLEXCEPTION',
                    label: 'SQLEXCEPTION', style: 'dotted' },
                { fromText: 'DELETE FROM APP.INNER_T', toText: 'EXIT HANDLER FOR SQLEXCEPTION',
                    label: 'SQLEXCEPTION', style: 'dotted' },
                { fromText: 'UPDATE APP.OUTER_AFTER', toText: 'CONTINUE HANDLER FOR SQLEXCEPTION',
                    label: 'SQLEXCEPTION', style: 'dotted' }
            ],
            forbidden: [
                { fromText: 'DELETE FROM APP.INNER_T', toText: 'CONTINUE HANDLER FOR SQLEXCEPTION' },
                { fromText: 'UPDATE APP.OUTER_BEFORE', toText: 'EXIT HANDLER FOR SQLEXCEPTION' }
            ]
        }
    }
];
PROCFLOW_FIXTURES = PROCFLOW_FIXTURES.concat(PROCFLOW_DB2_GRAPH_FIXTURES);
//# sourceMappingURL=db2.js.map