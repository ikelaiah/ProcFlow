/* sql-cartographer v2.7.0 — dialect transaction and error-state helpers.
   PL/pgSQL error-code mapping and handler matching, PL/pgSQL transaction
   legality assessment, and the T-SQL transaction-depth/XACT_STATE model.
   These are pure token/AST utilities extracted from ir.ts so the graph builder
   is smaller and the dialect rules can be reviewed on their own. Depends on
   token-utils.ts (spanOfTokens, clip, joinToks) and the ambient types. */
var PG_ERROR_CODES: Record<string, string>={
  RAISE_EXCEPTION:'P0001', NO_DATA_FOUND:'P0002', TOO_MANY_ROWS:'P0003',
  ASSERT_FAILURE:'P0004', QUERY_CANCELED:'57014',
  DIVISION_BY_ZERO:'22012', NUMERIC_VALUE_OUT_OF_RANGE:'22003',
  INVALID_TEXT_REPRESENTATION:'22P02',
  INTEGRITY_CONSTRAINT_VIOLATION:'23000', RESTRICT_VIOLATION:'23001',
  NOT_NULL_VIOLATION:'23502', FOREIGN_KEY_VIOLATION:'23503',
  UNIQUE_VIOLATION:'23505', CHECK_VIOLATION:'23514',
  EXCLUSION_VIOLATION:'23P01'
};
function pgErrorFromRaise(toks: TokenList): PgErrorCondition | null {
  if(!toks.length||toks[0].u!=='RAISE'||toks.length===1) return null;
  var first=toks[1];
  if(first.u==='SQLSTATE'&&toks[2])
    return {name:'',code:toks[2].v.replace(/^'/,'').replace(/'$/,'').toUpperCase()};
  if(first.u==='EXCEPTION'||first.u==='USING'||first.type!=='word')
    return {name:'RAISE_EXCEPTION',code:'P0001'};
  return {name:first.u,code:PG_ERROR_CODES[first.u]||''};
}
function pgHandlerAlternatives(cond: TokenList | null): Token[][] {
  var out: Token[][]=[[]], depth=0;
  (cond||[]).forEach(function(tok){
    if(tok.v==='(') depth++;
    else if(tok.v===')') depth--;
    if(tok.u==='OR'&&depth===0) out.push([]);
    else out[out.length-1].push(tok);
  });
  return out;
}
function pgHandlerMatches(cond: TokenList | null, error: PgErrorCondition): boolean {
  return pgHandlerAlternatives(cond).some(function(part){
    if(!part.length) return false;
    var name=part[0].u;
    if(name==='OTHERS')
      return ['ASSERT_FAILURE','QUERY_CANCELED'].indexOf(error.name)<0&&
             ['P0004','57014'].indexOf(error.code)<0;
    var code=name==='SQLSTATE'&&part[1]
      ? part[1].v.replace(/^'/,'').replace(/'$/,'').toUpperCase()
      : (PG_ERROR_CODES[name]||'');
    if(error.name&&name===error.name) return true;
    if(!code||!error.code) return false;
    return code===error.code||
      (code.length===5&&code.slice(2)==='000'&&code.slice(0,2)===error.code.slice(0,2));
  });
}
function pgHandlerHasOthers(cond: TokenList | null): boolean {
  return pgHandlerAlternatives(cond).some(function(part){
    return !!part.length&&part[0].u==='OTHERS';
  });
}
function pgTransactionAssessment(toks: TokenList, headerKind: string,
    inExceptionScope: boolean): PgTransactionAssessment | null {
  if(!toks.length) return null;
  var head=toks[0].u;
  if(['COMMIT','ROLLBACK','SAVE','SAVEPOINT','RELEASE','BEGIN','START'].indexOf(head)<0)
    return null;
  var savepoint=head==='SAVE'||head==='SAVEPOINT'||head==='RELEASE'||
    (head==='ROLLBACK'&&toks.some(function(tok){return tok.u==='TO';}));
  if(savepoint) return {
    invalid:true,
    label:'invalid: PL/pgSQL does not support savepoints',
    code:'plpgsql_savepoint_unsupported',
    severity:'error',
    message:'PL/pgSQL does not support SAVEPOINT, ROLLBACK TO SAVEPOINT, or RELEASE SAVEPOINT; use a block with EXCEPTION instead.'
  };
  if(head==='BEGIN'||head==='START') return {
    invalid:true,
    label:'invalid: transactions start automatically',
    code:'plpgsql_transaction_start_unsupported',
    severity:'error',
    message:'PL/pgSQL has no separate transaction-start command; BEGIN starts a block and transactions begin automatically after eligible COMMIT or ROLLBACK.'
  };
  if(inExceptionScope) return {
    invalid:true,
    label:'invalid inside EXCEPTION subtransaction',
    code:'plpgsql_transaction_in_exception_scope',
    severity:'error',
    message:'Transaction control is not allowed inside a block with EXCEPTION because that block forms a subtransaction.'
  };
  var kind=String(headerKind||'').toUpperCase();
  if(kind!=='PROCEDURE'&&kind!=='PROC'&&kind!=='DO') return {
    invalid:true,
    label:'invalid: requires eligible CALL or DO context',
    code:'plpgsql_transaction_context',
    severity:'error',
    message:'Transaction control is only allowed in procedures reached through an eligible CALL chain or in DO blocks.'
  };
  if(kind==='DO') return {
    invalid:false,
    label:'eligible DO transaction control',
    code:null,
    severity:null,
    message:''
  };
  return {
    invalid:false,
    label:'requires eligible CALL context',
    code:'plpgsql_transaction_context_required',
    severity:'warning',
    message:'Transaction control in a procedure requires an uninterrupted top-level or nested CALL/DO invocation chain; an intervening command makes it invalid.'
  };
}
function addPgTransactionDiagnostics(list: AstNode[], header: SqlHeader,
    diagnostics: Diagnostic[], inExceptionScope?: boolean): void {
  (list||[]).forEach(function(st){
    if(st.type==='stmt'){
      var assessment=pgTransactionAssessment(
        st.toks,header.kind||'',inExceptionScope===true);
      if(assessment&&assessment.code&&assessment.severity)
        diagnostics.push({
          severity:assessment.severity,
          code:assessment.code,
          message:assessment.message,
          span:spanOfTokens(st.toks)
        });
    }
    if(st.type==='block')
      addPgTransactionDiagnostics(st.body,header,diagnostics,inExceptionScope);
    else if(st.type==='if'){
      if(st.then) addPgTransactionDiagnostics([st.then],header,diagnostics,inExceptionScope);
      if(st.else) addPgTransactionDiagnostics([st.else],header,diagnostics,inExceptionScope);
    } else if(st.type==='case'){
      st.branches.forEach(function(branch){
        addPgTransactionDiagnostics(branch.body,header,diagnostics,inExceptionScope);
      });
      if(st.else) addPgTransactionDiagnostics(st.else,header,diagnostics,inExceptionScope);
    } else if((st.type==='while'||st.type==='for'||st.type==='loop'||
               st.type==='repeat')&&st.body)
      addPgTransactionDiagnostics([st.body],header,diagnostics,inExceptionScope);
    else if(st.type==='try'){
      addPgTransactionDiagnostics(st.body,header,diagnostics,true);
      st.handlers.forEach(function(handler){
        addPgTransactionDiagnostics(handler.body,header,diagnostics,true);
      });
    } else if(st.type==='handler'&&st.body)
      addPgTransactionDiagnostics([st.body],header,diagnostics,inExceptionScope);
  });
}

var TSQL_XACT_UNCOMMITTABLE=1, TSQL_XACT_NONE=2,
    TSQL_XACT_COMMITTABLE=4, TSQL_XACT_ALL=7;

function tsqlSignedStateAt(toks: TokenList, start: number, end: number) {
  var sign=1, i=start;
  if(i<end&&(toks[i].v==='-'||toks[i].v==='+')){
    if(toks[i].v==='-') sign=-1;
    i++;
  }
  if(i>=end||toks[i].type!=='num'||!/^\d+$/.test(toks[i].v)) return null;
  return {value:sign*parseInt(toks[i].v,10),next:i+1};
}

function tsqlXactFunctionAt(toks: TokenList, start: number, end: number): boolean {
  return start+2<end&&toks[start].u==='XACT_STATE'&&
         toks[start+1].v==='('&&toks[start+2].v===')';
}

function tsqlXactStateTest(toks: TokenList) {
  var start=0, end=toks.length, changed=true;
  while(changed&&end-start>=2&&toks[start].v==='('&&toks[end-1].v===')'){
    changed=false;
    var depth=0;
    for(var w=start;w<end;w++){
      if(toks[w].v==='(') depth++;
      else if(toks[w].v===')') depth--;
      if(depth===0){
        if(w===end-1){ start++; end--; changed=true; }
        break;
      }
    }
  }
  var op='', state=null;
  if(tsqlXactFunctionAt(toks,start,end)&&start+3<end){
    op=toks[start+3].v;
    state=tsqlSignedStateAt(toks,start+4,end);
    if(!state||state.next!==end) return null;
  } else {
    state=tsqlSignedStateAt(toks,start,end);
    if(!state||state.next>=end) return null;
    op=toks[state.next].v;
    if(!tsqlXactFunctionAt(toks,state.next+1,end)||state.next+4!==end) return null;
  }
  if(['=','<>','!='].indexOf(op)<0||
     [-1,0,1].indexOf(state.value)<0) return null;
  var bit=state.value===-1?TSQL_XACT_UNCOMMITTABLE:
          (state.value===0?TSQL_XACT_NONE:TSQL_XACT_COMMITTABLE);
  var equal=op==='=';
  var description=state.value===-1?'uncommittable':
                  (state.value===0?'no active transaction':'committable');
  var question=!equal&&state.value===0
    ? 'transaction active?'
    : (equal?description+'?':'not '+description+'?');
  return {
    text:clip(joinToks(toks,42),42)+' · '+question,
    trueStates:equal?bit:(TSQL_XACT_ALL^bit),
    falseStates:equal?(TSQL_XACT_ALL^bit):bit
  };
}

function tsqlTranCountTest(toks: TokenList) {
  var start=0, end=toks.length, changed=true;
  while(changed&&end-start>=2&&toks[start].v==='('&&toks[end-1].v===')'){
    changed=false;
    var depth=0;
    for(var w=start;w<end;w++){
      if(toks[w].v==='(') depth++;
      else if(toks[w].v===')') depth--;
      if(depth===0){
        if(w===end-1){ start++; end--; changed=true; }
        break;
      }
    }
  }
  var op='', value=null, countFirst=false;
  if(toks[start]&&toks[start].u==='@@TRANCOUNT'&&start+2<end){
    op=toks[start+1].v;
    value=tsqlSignedStateAt(toks,start+2,end);
    countFirst=true;
  } else {
    value=tsqlSignedStateAt(toks,start,end);
    if(value&&value.next+1<end&&toks[value.next+1].u==='@@TRANCOUNT'){
      op=toks[value.next].v;
      if(value.next+2!==end) return null;
    }
  }
  if(!value||value.value<0||
     ['=','<>','!=','>','>=','<','<='].indexOf(op)<0) return null;
  if(!countFirst){
    var reversed: Record<string, string>={
      '=':'=','<>':'<>','!=':'!=','>':'<','>=':'<=','<':'>','<=':'>='
    };
    op=reversed[op];
  } else if(value.next!==end) return null;

  var n=value.value, any: TsqlTransactionDepth={min:0,max:null};
  var trueDepth: TsqlTransactionDepth=any, falseDepth: TsqlTransactionDepth=any;
  if(op==='='){
    trueDepth={min:n,max:n};
    falseDepth=n===0?{min:1,max:null}:any;
  } else if(op==='<>'||op==='!='){
    trueDepth=n===0?{min:1,max:null}:any;
    falseDepth={min:n,max:n};
  } else if(op==='>'){
    trueDepth={min:n+1,max:null};
    falseDepth={min:0,max:n};
  } else if(op==='>='){
    trueDepth={min:n,max:null};
    falseDepth={min:0,max:n-1};
  } else if(op==='<'){
    trueDepth={min:0,max:n-1};
    falseDepth={min:n,max:null};
  } else {
    trueDepth={min:0,max:n};
    falseDepth={min:n+1,max:null};
  }
  var question=n===0&&(op==='=')
    ? 'no active transaction?'
    : (n===0&&(op==='>'||op==='<>'||op==='!=')
      ? 'transaction active?'
      : (n===1&&op==='>'?'nested transaction?':'transaction depth?'));
  return {
    text:clip(joinToks(toks,42),42)+' · '+question,
    trueDepth:trueDepth,
    falseDepth:falseDepth
  };
}
