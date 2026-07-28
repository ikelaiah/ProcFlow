/* SQLite fixtures for trigger RAISE action and termination semantics. */
var PROCFLOW_SQLITE_GRAPH_FIXTURES: GraphFixture[] = [
  {
    name:'SQLite graph · RAISE IGNORE abandons without rollback',
    dialect:'sqlite',
    sql:[
      'CREATE TRIGGER app.ignore_invalid BEFORE INSERT ON item',
      'FOR EACH ROW WHEN NEW.value IS NULL',
      'BEGIN',
      "  INSERT INTO audit(message) VALUES ('before ignore');",
      '  SELECT RAISE(IGNORE);',
      "  INSERT INTO audit(message) VALUES ('unreachable');",
      'END;'
    ].join('\n'),
    expect:{mode:'flow',branch:1,exit:1,noErrors:true,coverageMin:1},
    graphExpect:{
      required:[
        {fromText:'NEW.value IS NULL',toText:'INSERT INTO audit',toOccurrence:1,label:'yes'},
        {fromText:'INSERT INTO audit',fromOccurrence:1,toText:'RAISE IGNORE'}
      ],
      forbidden:[
        {fromText:'RAISE IGNORE',toText:'INSERT INTO audit',toOccurrence:2},
        {fromText:'INSERT INTO audit',fromOccurrence:2,toText:'End'}
      ],
      sourced:[
        {text:'INSERT INTO audit',occurrence:1},'RAISE IGNORE',
        {text:'INSERT INTO audit',occurrence:2}
      ]
    }
  },
  {
    name:'SQLite graph · RAISE FAIL preserves prior statement changes',
    dialect:'sqlite',
    sql:[
      'CREATE TRIGGER app.fail_invalid AFTER UPDATE ON item',
      'BEGIN',
      '  UPDATE audit SET attempts = attempts + 1 WHERE item_id = NEW.id;',
      "  SELECT RAISE(FAIL, 'invalid item ' || NEW.id);",
      '  DELETE FROM pending WHERE item_id = NEW.id;',
      'END;'
    ].join('\n'),
    expect:{mode:'flow',exit:1,noErrors:true,coverageMin:1},
    graphExpect:{
      required:[
        {fromText:'UPDATE audit',toText:'RAISE FAIL'}
      ],
      forbidden:[
        {fromText:'RAISE FAIL',toText:'DELETE FROM pending'},
        {fromText:'DELETE FROM pending',toText:'End'}
      ],
      sourced:['UPDATE audit','RAISE FAIL','DELETE FROM pending']
    }
  },
  {
    name:'SQLite graph · RAISE ABORT rolls back statement changes',
    dialect:'sqlite',
    sql:[
      'CREATE TRIGGER app.abort_invalid BEFORE UPDATE ON item',
      'BEGIN',
      "  INSERT INTO audit(message) VALUES ('before abort');",
      "  SELECT RAISE(ABORT, 'invalid item');",
      '  UPDATE item SET checked = 1 WHERE id = NEW.id;',
      'END;'
    ].join('\n'),
    expect:{mode:'flow',exit:1,noErrors:true,coverageMin:1},
    graphExpect:{
      required:[
        {fromText:'INSERT INTO audit',toText:'RAISE ABORT'}
      ],
      forbidden:[
        {fromText:'RAISE ABORT',toText:'UPDATE item'},
        {fromText:'UPDATE item',toText:'End'}
      ],
      sourced:['INSERT INTO audit','RAISE ABORT','UPDATE item']
    }
  },
  {
    name:'SQLite graph · RAISE ROLLBACK rolls back transaction',
    dialect:'sqlite',
    sql:[
      'CREATE TRIGGER app.rollback_invalid BEFORE DELETE ON item',
      'BEGIN',
      "  INSERT INTO audit(message) VALUES ('before rollback');",
      "  SELECT RAISE(ROLLBACK, 'invalid delete');",
      '  DELETE FROM audit WHERE item_id = OLD.id;',
      'END;'
    ].join('\n'),
    expect:{mode:'flow',exit:1,noErrors:true,coverageMin:1},
    graphExpect:{
      required:[
        {fromText:'INSERT INTO audit',toText:'RAISE ROLLBACK'}
      ],
      forbidden:[
        {fromText:'RAISE ROLLBACK',toText:'DELETE FROM audit'},
        {fromText:'DELETE FROM audit',toText:'End'}
      ],
      sourced:['INSERT INTO audit','RAISE ROLLBACK','DELETE FROM audit']
    }
  },
  {
    name:'SQLite graph · conditional RAISE WHERE preserves fallthrough',
    dialect:'sqlite',
    sql:[
      'CREATE TRIGGER app.reject_negative BEFORE UPDATE ON item',
      'BEGIN',
      '  UPDATE audit SET attempts = attempts + 1 WHERE item_id = NEW.id;',
      "  SELECT RAISE(ABORT, 'quantity must be positive') WHERE NEW.quantity < 0;",
      '  UPDATE item SET checked = 1 WHERE id = NEW.id;',
      'END;'
    ].join('\n'),
    expect:{mode:'flow',branch:1,exit:1,noErrors:true,coverageMin:1},
    graphExpect:{
      required:[
        {fromText:'UPDATE audit',toText:'NEW.quantity < 0'},
        {fromText:'NEW.quantity < 0',toText:'RAISE ABORT',label:'yes'},
        {fromText:'NEW.quantity < 0',toText:'UPDATE item',label:'no'},
        {fromText:'UPDATE item',toText:'End'}
      ],
      forbidden:[
        {fromText:'UPDATE audit',toText:'RAISE ABORT'},
        {fromText:'RAISE ABORT',toText:'UPDATE item'}
      ],
      sourced:['UPDATE audit','NEW.quantity < 0','RAISE ABORT','UPDATE item']
    }
  },
  {
    name:'SQLite graph · searched CASE evaluates RAISE branches in order',
    dialect:'sqlite',
    sql:[
      'CREATE TRIGGER app.validate_quantity BEFORE INSERT ON item',
      'BEGIN',
      '  SELECT CASE',
      "    WHEN NEW.quantity IS NULL THEN RAISE(FAIL, 'quantity is required')",
      "    WHEN NEW.quantity < 0 THEN RAISE(ROLLBACK, 'quantity is negative')",
      '    ELSE NULL',
      '  END;',
      '  INSERT INTO audit(item_id) VALUES (NEW.id);',
      'END;'
    ].join('\n'),
    expect:{mode:'flow',branch:2,exit:2,noErrors:true,coverageMin:1},
    graphExpect:{
      required:[
        {fromText:'NEW.quantity IS NULL',toText:'RAISE FAIL',label:'yes'},
        {fromText:'NEW.quantity IS NULL',toText:'NEW.quantity < 0',label:'no'},
        {fromText:'NEW.quantity < 0',toText:'RAISE ROLLBACK',label:'yes'},
        {fromText:'NEW.quantity < 0',toText:'INSERT INTO audit',label:'no'},
        {fromText:'INSERT INTO audit',toText:'End'}
      ],
      forbidden:[
        {fromText:'RAISE FAIL',toText:'NEW.quantity < 0'},
        {fromText:'RAISE FAIL',toText:'INSERT INTO audit'},
        {fromText:'RAISE ROLLBACK',toText:'INSERT INTO audit'}
      ],
      sourced:[
        'NEW.quantity IS NULL','RAISE FAIL','NEW.quantity < 0',
        'RAISE ROLLBACK','INSERT INTO audit'
      ]
    }
  },
  {
    name:'SQLite graph · searched CASE terminal ELSE has no fallthrough',
    dialect:'sqlite',
    sql:[
      'CREATE TRIGGER app.route_invalid BEFORE INSERT ON item',
      'BEGIN',
      '  SELECT CASE',
      '    WHEN NEW.value IS NULL THEN RAISE(IGNORE)',
      "    ELSE RAISE(ABORT, 'value rejected')",
      '  END;',
      "  INSERT INTO audit(message) VALUES ('unreachable');",
      'END;'
    ].join('\n'),
    expect:{mode:'flow',branch:1,exit:2,noErrors:true,coverageMin:1},
    graphExpect:{
      required:[
        {fromText:'NEW.value IS NULL',toText:'RAISE IGNORE',label:'yes'},
        {fromText:'NEW.value IS NULL',toText:'RAISE ABORT',label:'else'}
      ],
      forbidden:[
        {fromText:'RAISE IGNORE',toText:'INSERT INTO audit'},
        {fromText:'RAISE ABORT',toText:'INSERT INTO audit'},
        {fromText:'INSERT INTO audit',toText:'End'}
      ],
      sourced:['NEW.value IS NULL','RAISE IGNORE','RAISE ABORT','INSERT INTO audit']
    }
  }
];

PROCFLOW_GRAPH_FIXTURES=
  PROCFLOW_GRAPH_FIXTURES.concat(PROCFLOW_SQLITE_GRAPH_FIXTURES);
PROCFLOW_FIXTURES=PROCFLOW_FIXTURES.concat(PROCFLOW_SQLITE_GRAPH_FIXTURES);
