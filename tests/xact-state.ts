/* sql-cartographer v3.1.0 — unit fixtures for the T-SQL transaction state model.
   These functions moved out of src/ir.ts into src/dialects-state.ts as pure
   functions over FlowContext, StatementNode, and TsqlTransactionDepth. They
   were previously covered only transitively through golden graph assertions,
   which cannot tell *which* half of the algebra is wrong. Every case here is a
   direct assertion on the predicate, including the impossible/empty ranges and
   the ambiguous bit sets the model exists to represent.

   After this suite runs, SQL_CARTOGRAPHER_XACTSTATE_PASS and
   SQL_CARTOGRAPHER_XACTSTATE_RESULT gate the golden suite (tests/tests.ts). */
(function(){
  var results: Array<{name: string; pass: boolean; detail: unknown}>=[];
  function record(name: string, pass: boolean, detail?: unknown): void {
    results.push({name:name,pass:pass,detail:pass?'':detail});
  }
  function check(name: string, actual: unknown, expected: unknown): void {
    var ok=JSON.stringify(actual)===JSON.stringify(expected);
    record(name, ok, ok?'':{actual:actual, expected:expected});
  }

  /* A minimal token: `u` is the uppercased form the classifier reads. */
  function tok(word: string, pos?: number): Token {
    var p=pos||0;
    return {type:'word', v:word, u:word.toUpperCase(), nl:false,
            pos:p, end:p+word.length};
  }
  function stmt(words: string[]): StatementNode {
    var pos=0, toks: Token[]=[];
    words.forEach(function(w){ toks.push(tok(w,pos)); pos+=w.length+1; });
    return {type:'stmt', toks:toks} as StatementNode;
  }
  function ctxOf(fields: any): FlowContext {
    var c: any={parent:null,handlers:[],handlerExits:[]};
    Object.keys(fields||{}).forEach(function(k){ c[k]=fields[k]; });
    return c as FlowContext;
  }

  /* ---------- depth range algebra ---------- */
  check('intersectDepth takes the tighter minimum and the tighter maximum',
    intersectDepth({min:1,max:5},{min:3,max:9}), {min:3,max:5});
  check('intersectDepth treats a null maximum as unbounded',
    intersectDepth({min:1,max:null},{min:3,max:9}), {min:3,max:9});
  check('intersectDepth of two unbounded ranges stays unbounded',
    intersectDepth({min:0,max:null},{min:2,max:null}), {min:2,max:null});
  check('intersectDepth can produce an empty range',
    intersectDepth({min:5,max:6},{min:1,max:2}), {min:5,max:2});

  /* ---------- depth range <-> state bit set ---------- */
  check('statesForDepth: depth 0 means no transaction',
    statesForDepth({min:0,max:0}), TSQL_XACT_NONE);
  check('statesForDepth: any active depth can be either committable state',
    statesForDepth({min:1,max:null}), TSQL_XACT_UNCOMMITTABLE|TSQL_XACT_COMMITTABLE);
  check('statesForDepth: an empty range is impossible',
    statesForDepth({min:5,max:2}), 0);
  check('statesForDepth: an unknown depth is any state',
    statesForDepth({min:0,max:null}), TSQL_XACT_ALL);

  check('depthForStates: an impossible state set is an empty range',
    depthForStates({min:0,max:null}, 0), {min:1,max:0});
  check('depthForStates: excluding the no-transaction state forces depth >= 1',
    depthForStates({min:0,max:null}, TSQL_XACT_UNCOMMITTABLE|TSQL_XACT_COMMITTABLE),
      {min:1,max:null});
  check('depthForStates: only no-transaction collapses to depth 0',
    depthForStates({min:0,max:null}, TSQL_XACT_NONE), {min:0,max:0});
  check('depthForStates: a full bit set leaves the range alone',
    depthForStates({min:2,max:5}, TSQL_XACT_ALL), {min:2,max:5});

  /* ---------- labels ---------- */
  check('xactStatesLabel names the uncommittable state',
    xactStatesLabel(TSQL_XACT_UNCOMMITTABLE), '-1 · uncommittable');
  check('xactStatesLabel names the no-transaction state',
    xactStatesLabel(TSQL_XACT_NONE), '0 · no transaction');
  check('xactStatesLabel names the committable state',
    xactStatesLabel(TSQL_XACT_COMMITTABLE), '1 · committable');
  check('xactStatesLabel names an ambiguous commit status',
    xactStatesLabel(TSQL_XACT_UNCOMMITTABLE|TSQL_XACT_COMMITTABLE),
      'active · commit status unknown');
  check('xactStatesLabel names an impossible state set',
    xactStatesLabel(0), 'impossible');

  check('depthRangeLabel names depth 0',
    depthRangeLabel({min:0,max:0}), 'depth 0 · no transaction');
  check('depthRangeLabel names a single outermost transaction',
    depthRangeLabel({min:1,max:1}), 'depth 1 · outermost transaction');
  check('depthRangeLabel names nested transactions',
    depthRangeLabel({min:2,max:null}), 'depth ≥2 · nested transaction');
  check('depthRangeLabel names a general active transaction',
    depthRangeLabel({min:1,max:null}), 'depth ≥1 · active transaction');
  check('depthRangeLabel names an empty range as impossible',
    depthRangeLabel({min:3,max:1}), 'impossible');
  check('depthRangeLabel names a closed depth span',
    depthRangeLabel({min:1,max:3}), 'depth 1–3');

  /* ---------- statement classification ---------- */
  check('tsqlTransactionAction reads BEGIN',
    tsqlTransactionAction(stmt(['BEGIN'])), {kind:'begin',target:'',staticTarget:false});
  check('tsqlTransactionAction reads BEGIN TRANSACTION',
    tsqlTransactionAction(stmt(['BEGIN','TRANSACTION'])),
      {kind:'begin',target:'',staticTarget:false});
  check('tsqlTransactionAction reads BEGIN DISTRIBUTED TRANSACTION',
    tsqlTransactionAction(stmt(['BEGIN','DISTRIBUTED','TRANSACTION'])),
      {kind:'begin',target:'',staticTarget:false});
  check('tsqlTransactionAction reads COMMIT',
    tsqlTransactionAction(stmt(['COMMIT'])), {kind:'commit',target:'',staticTarget:false});
  check('tsqlTransactionAction reads COMMIT WORK',
    tsqlTransactionAction(stmt(['COMMIT','WORK'])),
      {kind:'commit',target:'',staticTarget:false});
  check('tsqlTransactionAction reads an untargeted ROLLBACK',
    tsqlTransactionAction(stmt(['ROLLBACK'])),
      {kind:'rollback',target:'',staticTarget:false});
  check('tsqlTransactionAction reads a static savepoint target',
    tsqlTransactionAction(stmt(['ROLLBACK','TO','my_sp'])),
      {kind:'rollback',target:'my_sp',staticTarget:true});
  check('tsqlTransactionAction marks a variable savepoint target as not static',
    tsqlTransactionAction(stmt(['ROLLBACK','TO','@sp'])),
      {kind:'rollback',target:'@sp',staticTarget:false});
  check('tsqlTransactionAction reads SAVE',
    tsqlTransactionAction(stmt(['SAVE','sp1'])),
      {kind:'save',target:'sp1',staticTarget:true});
  check('tsqlTransactionAction reads SAVEPOINT',
    tsqlTransactionAction(stmt(['SAVEPOINT','sp1'])),
      {kind:'save',target:'sp1',staticTarget:true});
  check('tsqlTransactionAction ignores a non-transaction statement',
    tsqlTransactionAction(stmt(['SELECT','1'])),
      {kind:'',target:'',staticTarget:false});

  check('tsqlStatefulStatement recognises SET XACT_ABORT ON',
    tsqlStatefulStatement(stmt(['SET','XACT_ABORT','ON'])), true);
  check('tsqlStatefulStatement recognises SET XACT_ABORT OFF',
    tsqlStatefulStatement(stmt(['SET','XACT_ABORT','OFF'])), true);
  check('tsqlStatefulStatement rejects SET NOCOUNT ON',
    tsqlStatefulStatement(stmt(['SET','NOCOUNT','ON'])), false);

  /* ---------- validity of transaction actions ---------- */
  check('COMMIT is invalid with no active transaction',
    invalidTsqlTransactionAction(stmt(['COMMIT']), ctxOf({xactStates:TSQL_XACT_NONE})), true);
  check('COMMIT is invalid when the transaction is uncommittable',
    invalidTsqlTransactionAction(stmt(['COMMIT']),
      ctxOf({xactStates:TSQL_XACT_UNCOMMITTABLE})), true);
  check('COMMIT is valid when the transaction is committable',
    invalidTsqlTransactionAction(stmt(['COMMIT']),
      ctxOf({xactStates:TSQL_XACT_COMMITTABLE})), false);
  check('ROLLBACK is invalid with no active transaction',
    invalidTsqlTransactionAction(stmt(['ROLLBACK']), ctxOf({xactStates:TSQL_XACT_NONE})), true);
  check('ROLLBACK is valid on an uncommittable transaction (full rollback is required)',
    invalidTsqlTransactionAction(stmt(['ROLLBACK']),
      ctxOf({xactStates:TSQL_XACT_UNCOMMITTABLE})), false);
  check('SAVE is invalid with no active transaction',
    invalidTsqlTransactionAction(stmt(['SAVE','sp']), ctxOf({xactStates:TSQL_XACT_NONE})), true);
  check('a plain SELECT is never an invalid transaction action',
    invalidTsqlTransactionAction(stmt(['SELECT','1']), ctxOf({xactStates:TSQL_XACT_NONE})), false);

  /* ---------- FlowContext inheritance ---------- */
  check('currentXactStates falls back to any state at the root',
    currentXactStates(null), TSQL_XACT_ALL);
  check('currentXactStates reads the nearest definition',
    currentXactStates(ctxOf({xactStates:TSQL_XACT_COMMITTABLE})), TSQL_XACT_COMMITTABLE);
  check('currentXactStates inherits from the parent chain',
    currentXactStates(ctxOf({parent:ctxOf({xactStates:TSQL_XACT_NONE})})), TSQL_XACT_NONE);
  check('currentXactStates prefers the child definition',
    currentXactStates(ctxOf({xactStates:TSQL_XACT_COMMITTABLE,
      parent:ctxOf({xactStates:TSQL_XACT_NONE})})), TSQL_XACT_COMMITTABLE);

  check('currentTranDepth falls back to depth 0 at the root',
    currentTranDepth(null), {min:0,max:null});
  check('currentTranDepth inherits from the parent chain',
    currentTranDepth(ctxOf({parent:ctxOf({tranDepth:{min:2,max:null}})})), {min:2,max:null});

  check('currentXactAbort is undefined at the root',
    currentXactAbort(null)===undefined, true);
  check('currentXactAbort reads an explicit false rather than inheriting',
    currentXactAbort(ctxOf({xactAbort:false,parent:ctxOf({xactAbort:true})})), false);

  check('currentSavepoints falls back to no savepoints at the root',
    currentSavepoints(null), {});
  check('currentSavepoints inherits from the parent chain',
    currentSavepoints(ctxOf({parent:ctxOf({savepoints:{sp1:1}})})), {sp1:1});

  check('currentPgSubtransaction is false at the root',
    currentPgSubtransaction(null), false);
  check('currentPgSubtransaction is true when any ancestor opens one',
    currentPgSubtransaction(ctxOf({parent:ctxOf({pgSubtransaction:true})})), true);

  check('currentInCatch is false at the root', currentInCatch(null), false);
  check('currentInCatch is true inside a catch region',
    currentInCatch(ctxOf({inCatch:true})), true);

  var passed=results.filter(function(r){return r.pass;}).length;
  window.SQL_CARTOGRAPHER_XACTSTATE_RESULT={passed:passed,total:results.length};
  window.SQL_CARTOGRAPHER_XACTSTATE_PASS=passed===results.length;
  window.SQL_CARTOGRAPHER_XACTSTATE_DETAIL=results;

  var out=document.getElementById('xactstate-results');
  if(out) out.textContent=JSON.stringify({
    cases:passed+'/'+results.length,
    failures:results.filter(function(r){return !r.pass;}).map(function(r){
      return {name:r.name, detail:r.detail};
    })
  },null,2);
  var sum=document.getElementById('xactstate-summary');
  if(sum) sum.textContent='v3.1.0 transaction state model · '+(passed+'/'+results.length);
})();
