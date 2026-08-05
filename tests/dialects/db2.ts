/* DB2 SQL PL fixtures whose assertions describe control-flow edges, not just counts. */
var PROCFLOW_DB2_GRAPH_FIXTURES: Db2GraphFixture[] = [
  {
    name:'DB2 graph · EXIT handler scope',
    dialect:'db2',
    sql:[
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
    expect:{mode:'flow',cat:1,noErrors:true,coverageMin:1},
    graphExpect:{
      required:[
        {fromText:'EXIT HANDLER FOR SQLEXCEPTION',toText:'INSERT INTO APP.ERROR_LOG'},
        {fromText:'INSERT INTO APP.ERROR_LOG',toText:'Exit compound block'},
        {fromText:'UPDATE APP.T',toText:'EXIT HANDLER FOR SQLEXCEPTION',
         label:'SQLEXCEPTION',style:'dotted'},
        {fromText:'SELECT … FROM APP.T',toText:'EXIT HANDLER FOR SQLEXCEPTION',
         label:'SQLEXCEPTION',style:'dotted'},
        {fromText:'Exit compound block',toText:'End',label:'handler exit'}
      ],
      forbidden:[
        {fromText:'DECLARE V_ID',toText:'EXIT HANDLER FOR SQLEXCEPTION'},
        {fromText:'INSERT INTO APP.ERROR_LOG',toText:'EXIT HANDLER FOR SQLEXCEPTION'},
        {fromText:'APP.EXIT_SCOPE',toText:'EXIT HANDLER FOR SQLEXCEPTION'}
      ]
    }
  },
  {
    name:'DB2 graph · CONTINUE handler scope',
    dialect:'db2',
    sql:[
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
    expect:{mode:'flow',cat:1,noErrors:true,coverageMin:1},
    graphExpect:{
      required:[
        {fromText:'CONTINUE HANDLER FOR NOT FOUND',toText:'SET V_DONE = 1'},
        {fromText:'SET V_DONE = 1',toText:'Resume after raising statement'},
        {fromText:'SELECT … INTO V_ID',toText:'CONTINUE HANDLER FOR NOT FOUND',
         label:'NOT FOUND',style:'dotted'},
        {fromText:'Resume after raising statement',toText:'UPDATE APP.T',
         label:'resume',style:'dotted'}
      ],
      forbidden:[
        {fromText:'DECLARE V_DONE',toText:'CONTINUE HANDLER FOR NOT FOUND'},
        {fromText:'SET V_DONE = 1',toText:'CONTINUE HANDLER FOR NOT FOUND'},
        {fromText:'UPDATE APP.T',toText:'CONTINUE HANDLER FOR NOT FOUND'},
        {fromText:'Resume after raising statement',toText:'End'}
      ]
    }
  },
  {
    name:'DB2 graph · nested handler shadowing',
    dialect:'db2',
    sql:[
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
    expect:{mode:'flow',cat:2,noErrors:true,coverageMin:1},
    graphExpect:{
      required:[
        {fromText:'UPDATE APP.OUTER_BEFORE',toText:'CONTINUE HANDLER FOR SQLEXCEPTION',
         label:'SQLEXCEPTION',style:'dotted'},
        {fromText:'DELETE FROM APP.INNER_T',toText:'EXIT HANDLER FOR SQLEXCEPTION',
         label:'SQLEXCEPTION',style:'dotted'},
        {fromText:'UPDATE APP.OUTER_AFTER',toText:'CONTINUE HANDLER FOR SQLEXCEPTION',
         label:'SQLEXCEPTION',style:'dotted'}
      ],
      forbidden:[
        {fromText:'DELETE FROM APP.INNER_T',toText:'CONTINUE HANDLER FOR SQLEXCEPTION'},
        {fromText:'UPDATE APP.OUTER_BEFORE',toText:'EXIT HANDLER FOR SQLEXCEPTION'}
      ]
    }
  },
  {
    name:'DB2 graph · cursor NOT FOUND flow',
    dialect:'db2',
    sql:[
      'CREATE PROCEDURE APP.CURSOR_FLOW()',
      'LANGUAGE SQL',
      'BEGIN',
      '  DECLARE V_DONE SMALLINT DEFAULT 0;',
      '  DECLARE V_ID INTEGER;',
      '  DECLARE C1 CURSOR FOR',
      '    SELECT ID FROM APP.T;',
      '  DECLARE CONTINUE HANDLER FOR NOT FOUND',
      '    SET V_DONE = 1;',
      '  OPEN C1;',
      '  FETCH C1 INTO V_ID;',
      '  WHILE V_DONE = 0 DO',
      '    UPDATE APP.T SET SEEN = 1 WHERE ID = V_ID;',
      '    FETCH NEXT FROM C1 INTO V_ID;',
      '  END WHILE;',
      '  CLOSE C1;',
      'END'
    ].join('\n'),
    expect:{mode:'flow',cat:1,loop:1,noErrors:true,coverageMin:1},
    graphExpect:{
      required:[
        {fromText:'CONTINUE HANDLER FOR NOT FOUND',toText:'SET V_DONE = 1'},
        {fromText:'SET V_DONE = 1',toText:'Resume after raising statement'},
        {fromText:'FETCH C1 INTO V_ID',toText:'CONTINUE HANDLER FOR NOT FOUND',
         label:'NOT FOUND',style:'dotted'},
        {fromText:'FETCH NEXT FROM C1 INTO V_ID',toText:'CONTINUE HANDLER FOR NOT FOUND',
         label:'NOT FOUND',style:'dotted'},
        {fromText:'Resume after raising statement',toText:'V_DONE = 0',
         label:'resume',style:'dotted'}
      ],
      forbidden:[
        {fromText:'DECLARE CURSOR C1',toText:'CONTINUE HANDLER FOR NOT FOUND'},
        {fromText:'OPEN C1',toText:'CONTINUE HANDLER FOR NOT FOUND'},
        {fromText:'UPDATE APP.T',toText:'CONTINUE HANDLER FOR NOT FOUND'},
        {fromText:'CLOSE C1',toText:'CONTINUE HANDLER FOR NOT FOUND'}
      ]
    }
  },
  {
    name:'DB2 graph · mixed one-line and block IF',
    dialect:'db2',
    sql:[
      'CREATE PROCEDURE APP.MIXED_IF()',
      'LANGUAGE SQL',
      'BEGIN',
      '  IF V_FLAG = 1 THEN',
      '    SET V_A = 1;',
      '    CALL APP.LOG_A();',
      '  ELSE',
      '    BEGIN',
      '      SET V_B = 2;',
      '      CALL APP.LOG_B();',
      '    END;',
      '  END IF;',
      '  SET V_DONE = 1;',
      'END'
    ].join('\n'),
    expect:{mode:'flow',branch:1,call:'APP.LOG_A',noErrors:true,coverageMin:1},
    graphExpect:{
      required:[
        {fromText:'V_FLAG = 1',toText:'SET V_A = 1',label:'yes'},
        {fromText:'V_FLAG = 1',toText:'SET V_B = 2',label:'no'},
        {fromText:'CALL APP.LOG_A',toText:'SET V_DONE = 1'},
        {fromText:'CALL APP.LOG_B',toText:'SET V_DONE = 1'}
      ],
      forbidden:[
        {fromText:'CALL APP.LOG_A',toText:'SET V_B = 2'},
        {fromText:'SET V_A = 1',toText:'SET V_B = 2'}
      ],
      sourced:['V_FLAG = 1','SET V_A = 1','CALL APP.LOG_A','SET V_B = 2',
        'CALL APP.LOG_B','SET V_DONE = 1']
    }
  },
  {
    name:'DB2 graph · labelled LEAVE and ITERATE',
    dialect:'db2',
    sql:[
      'CREATE PROCEDURE APP.LABELLED_LOOPS()',
      'LANGUAGE SQL',
      'BEGIN',
      '  OUTER_LOOP: WHILE V_OUTER < 10 DO',
      '    INNER_LOOP: LOOP',
      '      IF V_SKIP = 1 THEN',
      '        ITERATE OUTER_LOOP;',
      '      END IF;',
      '      IF V_DONE = 1 THEN',
      '        LEAVE OUTER_LOOP;',
      '      END IF;',
      '      LEAVE INNER_LOOP;',
      '    END LOOP INNER_LOOP;',
      '  END WHILE OUTER_LOOP;',
      '  SET V_FINISHED = 1;',
      'END'
    ].join('\n'),
    expect:{mode:'flow',branch:2,loop:2,noErrors:true,coverageMin:1},
    graphExpect:{
      required:[
        {fromText:'ITERATE OUTER_LOOP',toText:'V_OUTER < 10',label:'continue'},
        {fromText:'LEAVE OUTER_LOOP',toText:'SET V_FINISHED = 1'},
        {fromText:'LEAVE INNER_LOOP',toText:'V_OUTER < 10'}
      ],
      forbidden:[
        {fromText:'ITERATE OUTER_LOOP',toText:'loop'},
        {fromText:'LEAVE OUTER_LOOP',toText:'V_OUTER < 10'}
      ],
      sourced:['ITERATE OUTER_LOOP','LEAVE OUTER_LOOP','LEAVE INNER_LOOP']
    }
  }
];

var PROCFLOW_GRAPH_FIXTURES: GraphFixture[]=PROCFLOW_DB2_GRAPH_FIXTURES.slice();
PROCFLOW_FIXTURES=PROCFLOW_FIXTURES.concat(PROCFLOW_DB2_GRAPH_FIXTURES);
