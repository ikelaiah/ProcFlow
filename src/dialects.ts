/* proc>flow: dialect detection and procedural parsing */
/* Pure functions: detect dialect, tokenise, parse control flow, emit Mermaid.
   Dialects: tsql | db2 (SQL PL) | plpgsql | sqlite */

var DIALECT_NAMES: Record<Dialect, string> =
  {tsql:'T-SQL', db2:'DB2 SQL PL', plpgsql:'PL/pgSQL', sqlite:'SQLite'};

/* keywords that can never continue a statement (checked at depth 0) */
var HARD_BASE: string[] = ['BEGIN','END','IF','ELSE','WHILE','RETURN'];
var HARD_BY_DIALECT: Record<Dialect, string[]> = {
  tsql:    HARD_BASE.concat(['BREAK','CONTINUE','GOTO','THROW','GO']),
  db2:     HARD_BASE.concat(['ELSEIF','LEAVE','ITERATE','GOTO','REPEAT','UNTIL','THEN','DO']),
  plpgsql: HARD_BASE.concat(['ELSIF','EXIT','CONTINUE','EXCEPTION','THEN','LOOP']),
  sqlite:  HARD_BASE.slice()
};
/* keywords that may start a new statement when they open a line */
var SOFT: string[] = ['SELECT','INSERT','UPDATE','DELETE','MERGE','EXEC','EXECUTE','SET','DECLARE','PRINT',
  'RAISERROR','TRUNCATE','OPEN','CLOSE','FETCH','DEALLOCATE','COMMIT','ROLLBACK','SAVE','SAVEPOINT',
  'RELEASE','WAITFOR','CREATE','ALTER','DROP','USE','WITH','GRANT','REVOKE','DENY','RESTORE','BACKUP',
  'CALL','PERFORM','RAISE','SIGNAL','RESIGNAL','GET','PREPARE','ASSERT','COPY','ANALYZE','VACUUM',
  'PRAGMA','REPLACE','ATTACH','DETACH','REINDEX','EXPLAIN','VALUES','REFRESH','LISTEN','NOTIFY','CASE'];
var CONT: string[] = ['AS','FROM','INTO','UNION','ALL','EXCEPT','INTERSECT','AND','OR','NOT','THEN','WHEN',
  'FOR','IS','IN','EXISTS','ON','BY','WITH','SET','VALUES','OUTPUT','TOP','APPLY','JOIN','LIKE',
  'BETWEEN','CASE','ELSE','OVER','PARTITION','ORDER','GROUP','HAVING','DISTINCT','PERCENT','CROSS',
  'OUTER','INNER','LEFT','RIGHT','FULL','USING','RETURNING','LIMIT','OFFSET','DO','CONFLICT'];
var CONT_OPS: string[] = [',','(','=','<','>','<=','>=','<>','!=','+','-','*','/','||','.','%','::'];
var CONT_M: StringSet=S(CONT), CONT_OPS_M: StringSet=S(CONT_OPS), SOFT_M: StringSet=S(SOFT);

/* condition/header readers stop at these block-openers */
var OPENERS: StringSet = {THEN:1, DO:1, LOOP:1};

/* ---------- dialect detection ---------- */
function detectDialect(sql: string): DialectDetection {
  var s=String(sql||''), sc: DialectScores={tsql:0, db2:0, plpgsql:0, sqlite:0};
  if(/\$\$|\$[a-z_]+\$/i.test(s)) sc.plpgsql+=4;
  if(/LANGUAGE\s+'?plpgsql/i.test(s)) sc.plpgsql+=7;
  if(/\bELSIF\b/i.test(s)) sc.plpgsql+=3;
  if(/\bRAISE\s+(NOTICE|EXCEPTION|WARNING|INFO|DEBUG|LOG|USING)\b/i.test(s)) sc.plpgsql+=4;
  if(/\bPERFORM\b|\bRETURN\s+(NEXT|QUERY)\b/i.test(s)) sc.plpgsql+=4;
  if(/\bEXCEPTION\s+WHEN\b/i.test(s)) sc.plpgsql+=4;
  if(/::\s*\w/.test(s)) sc.plpgsql+=1;
  if(/\bELSEIF\b/i.test(s)) sc.db2+=4;
  if(/\bEND\s+(WHILE|REPEAT|FOR)\b/i.test(s)) sc.db2+=2;
  if(/\bDECLARE\s+(CONTINUE|EXIT|UNDO)\s+HANDLER\b/i.test(s)) sc.db2+=6;
  if(/\bSIGNAL\s+SQLSTATE\b|\bRESIGNAL\b|\bITERATE\b/i.test(s)) sc.db2+=4;
  if(/\bLANGUAGE\s+SQL\b/i.test(s)&&!/plpgsql/i.test(s)) sc.db2+=3;
  if(/\bSPECIFIC\b|\bDYNAMIC\s+RESULT\s+SETS\b|\bSYSIBM\b|\bSYSCAT\b|\bVALUES\s+INTO\b/i.test(s)) sc.db2+=2;
  if(/@\w/.test(s)) sc.tsql+=3;
  if(/\bBEGIN\s+TRY\b|\bBEGIN\s+CATCH\b/i.test(s)) sc.tsql+=7;
  if(/\bSET\s+NOCOUNT\b|\bRAISERROR\b|\bsp_\w|\bdbo\.|\bEXEC(UTE)?\s+\w/i.test(s)) sc.tsql+=3;
  if(/\[[A-Za-z_#@]/.test(s)) sc.tsql+=2;
  if(/^\s*GO\s*;?\s*$/im.test(s)) sc.tsql+=3;
  if(/\bAUTOINCREMENT\b|\bPRAGMA\b|\bsqlite_|\bINSERT\s+OR\s+(REPLACE|IGNORE)\b/i.test(s)) sc.sqlite+=5;
  if(/\bCREATE\s+TRIGGER\b/i.test(s)&&/\bFOR\s+EACH\s+ROW\b/i.test(s)&&
     !/\bDECLARE\b|\bLANGUAGE\b/i.test(s)) sc.sqlite+=2;
  var best: Dialect='tsql', bv=0, k: keyof DialectScores;
  for(k in sc) if(sc[k]>bv){ bv=sc[k]; best=k; }
  return {dialect: bv===0 ? 'tsql' : best, scores: sc, score:bv, confident: bv>=4};
}

/* ---------- parser plumbing ---------- */
function P(toks: TokenList, dialect: Dialect): ParserState {
  return {t:toks, i:0, d:dialect,
          hard:S(HARD_BY_DIALECT[dialect]||HARD_BY_DIALECT.tsql),
          diagnostics:[], exhausted:false};
}
function peek(p: ParserState, k?: number): Token | undefined { return p.t[p.i+(k||0)]; }
function at(p: ParserState, word: string, k?: number): boolean {
  var t=peek(p,k);
  return !!t&&t.type==='word'&&t.u===word;
}
function eat(p: ParserState, word: string): boolean {
  if(at(p,word)){ p.i++; return true; }
  return false;
}
function skipSemis(p: ParserState): void { while(peek(p)&&peek(p).v===';') p.i++; }

function staticRaiserrorSeverity(toks: TokenList): number | null {
  if(!toks.length||toks[0].u!=='RAISERROR') return null;
  var depth=0;
  for(var i=1;i<toks.length-1;i++){
    if(toks[i].v==='(') depth++;
    else if(toks[i].v===')') depth--;
    else if(toks[i].v===','&&depth===1){
      var severity=toks[i+1];
      return severity&&severity.type==='num'&&/^\d+$/.test(severity.v)
        ? parseInt(severity.v,10) : null;
    }
  }
  return null;
}

function sqliteRaiseAt(toks: TokenList, start: number):
    {node: SqliteRaiseNode; end: number} | null {
  if(!toks[start]||toks[start].u!=='RAISE'||!toks[start+1]||
     toks[start+1].v!=='('||!toks[start+2]) return null;
  var action=toks[start+2].u;
  var next=toks[start+3];
  var valid=(['FAIL','ABORT','ROLLBACK'].indexOf(action)>=0&&next&&next.v===',')||
            (action==='IGNORE'&&next&&next.v===')');
  if(!valid) return null;
  var depth=0, close=-1;
  for(var i=start+1;i<toks.length;i++){
    if(toks[i].v==='(') depth++;
    else if(toks[i].v===')'&&--depth===0){ close=i; break; }
  }
  if(close<0) return null;
  return {
    node:{type:'sqlite_raise',action:action as SqliteRaiseAction,
          toks:toks.slice(start,close+1)},
    end:close
  };
}

function sqliteTopLevelWord(toks: TokenList, start: number, words: string[]): number {
  var paren=0, nestedCase=0;
  for(var i=start;i<toks.length;i++){
    var tok=toks[i];
    if(tok.v==='('){ paren++; continue; }
    if(tok.v===')'){ if(paren>0) paren--; continue; }
    if(paren>0) continue;
    if(tok.u==='CASE'){ nestedCase++; continue; }
    if(tok.u==='END'){
      if(nestedCase>0){ nestedCase--; continue; }
      if(words.indexOf('END')>=0) return i;
    } else if(nestedCase===0&&words.indexOf(tok.u)>=0) return i;
  }
  return -1;
}

function sqliteRangeHasRaise(toks: TokenList, start: number, end: number): boolean {
  for(var i=start;i<end;i++) if(toks[i].u==='RAISE') return true;
  return false;
}

function parseSqliteRaiseCase(toks: TokenList): CaseNode | null {
  /* Searched CASE only: SELECT CASE WHEN ... THEN RAISE(...) ... END */
  if(toks.length<7||toks[0].u!=='SELECT'||toks[1].u!=='CASE'||
     toks[2].u!=='WHEN') return null;
  var branches: Array<{cond: TokenList; body: AstNode[]}>=[], elseBody: AstNode[] | null=null;
  var i=2, raiseCount=0, endCase=-1;
  while(i<toks.length&&toks[i].u==='WHEN'){
    var thenAt=sqliteTopLevelWord(toks,i+1,['THEN']);
    if(thenAt<0||thenAt===i+1) return null;
    var nextAt=sqliteTopLevelWord(toks,thenAt+1,['WHEN','ELSE','END']);
    if(nextAt<0||nextAt===thenAt+1) return null;
    var body: AstNode[]=[];
    var matched=sqliteRaiseAt(toks,thenAt+1);
    if(matched&&matched.end===nextAt-1){ body=[matched.node]; raiseCount++; }
    else if(sqliteRangeHasRaise(toks,thenAt+1,nextAt)) return null;
    branches.push({cond:toks.slice(i+1,thenAt),body:body});
    i=nextAt;
  }
  if(i<toks.length&&toks[i].u==='ELSE'){
    endCase=sqliteTopLevelWord(toks,i+1,['END']);
    if(endCase<0||endCase===i+1) return null;
    var elseRaise=sqliteRaiseAt(toks,i+1);
    if(elseRaise&&elseRaise.end===endCase-1){
      elseBody=[elseRaise.node]; raiseCount++;
    } else if(sqliteRangeHasRaise(toks,i+1,endCase)) return null;
    i=endCase;
  }
  if(i<toks.length&&toks[i].u==='END') endCase=i;
  if(!branches.length||!raiseCount||endCase!==toks.length-1) return null;
  return {type:'case',sel:[],branches:branches,else:elseBody};
}

function parseSqliteRaiseStatement(toks: TokenList): AstNode | null {
  if(toks.length<2||toks[0].u!=='SELECT') return null;
  if(toks[1].u==='CASE') return parseSqliteRaiseCase(toks);
  var matched=sqliteRaiseAt(toks,1);
  if(!matched) return null;
  if(matched.end===toks.length-1) return matched.node;
  if(toks[matched.end+1].u==='WHERE'&&matched.end+2<toks.length&&
     !sqliteRangeHasRaise(toks,matched.end+2,toks.length)){
    return {type:'if',cond:toks.slice(matched.end+2),then:matched.node,else:null};
  }
  return null;
}

function newStatementHere(tok: Token, prev: Token | undefined, startWord: string): boolean {
  if(!tok.nl||!prev) return false;
  if(CONT_M[prev.u]||CONT_OPS_M[prev.v]) return false;
  var u=tok.u;
  if(u==='SELECT'&&['INSERT','WITH','CREATE','DECLARE','MERGE','RETURN'].indexOf(startWord)>=0) return false;
  if((u==='SET'||u==='OUTPUT'||u==='VALUES')&&['UPDATE','DELETE','MERGE','INSERT'].indexOf(startWord)>=0) return false;
  if(['UPDATE','DELETE','INSERT'].indexOf(u)>=0&&startWord==='MERGE') return false;
  if(u==='EXECUTE'&&prev.u==='AS') return false;
  if(u==='WITH'&&prev.v===')') return false;
  if(u==='CASE') return false;
  return true;
}

/* mode 'stmt' reads one statement; mode 'cond' reads a condition/header */
function readTokens(p: ParserState, mode: 'stmt' | 'cond' | 'head' | 'case'): TokenList {
  var out: TokenList=[], depth=0, caseDepth=0;
  var st=peek(p), startWord=st?st.u:'';
  var merge = startWord==='MERGE';
  while(p.i<p.t.length){
    var t=p.t[p.i], prev=out[out.length-1];
    if(t.v===';'&&depth===0&&caseDepth===0){ if(mode!=='cond') p.i++; break; }
    if(t.type==='word'&&depth===0&&!merge){
      if(t.u==='CASE'&&out.length) caseDepth++;
      else if(t.u==='END'){ if(caseDepth>0){ caseDepth--; p.i++; out.push(t); continue; } else break; }
      else if(caseDepth===0&&out.length){
        if(mode==='head'){
          if(t.u==='DO'||t.u==='LOOP') break;
        } else if(mode==='case'){
          if(t.u==='WHEN'||t.u==='THEN'||t.u==='ELSE') break;
        } else if(mode==='cond'){
          if(OPENERS[t.u]||p.hard[t.u]||SOFT_M[t.u]) break;
        } else {
          if(p.hard[t.u]) break;
          if(SOFT_M[t.u]&&newStatementHere(t,prev,startWord)) break;
        }
      }
    }
    if(t.v==='(') depth++;
    if(t.v===')') depth--;
    out.push(t); p.i++;
  }
  return out;
}

var BLOCK_STOPS: string[] = ['END','ELSE','ELSEIF','ELSIF','EXCEPTION','UNTIL','WHEN'];
function parseBlock(p: ParserState, extraStops?: string[]): AstNode[] {
  var stops=S(BLOCK_STOPS.concat(extraStops||[]));
  var list: AstNode[]=[], guard=0;
  while(p.i<p.t.length&&guard++<40000){
    var t=peek(p);
    if(!t) break;
    if(t.v===';'){ p.i++; continue; }
    if(t.type==='word'&&stops[t.u]){
      /* CASE-expression WHEN never appears at statement start; a stray WHEN ends the block */
      break;
    }
    var before=p.i;
    var stmt=parseStatement(p);
    if(stmt) list.push(stmt);
    if(p.i===before) p.i++;
  }
  if(guard>=40000&&p.i<p.t.length){
    p.exhausted=true;
    var stalled=peek(p);
    p.diagnostics.push({severity:'error',code:'parser_guard_exhausted',
      message:'Parser safety limit was reached before the input was consumed.',
      span:stalled?{start:stalled.pos,end:stalled.end}:null});
  }
  return list;
}

/* consume END [IF|WHILE|LOOP|FOR|REPEAT|CASE|TRY|CATCH] [label] [;] */
function eatEnd(p: ParserState, kind?: string): boolean {
  if(!at(p,'END')){
    var missingAt=peek(p)||p.t[p.t.length-1];
    p.diagnostics.push({severity:'error',code:'missing_end',
      message:'Expected END'+(kind?' '+kind:'')+' before the block finished.',
      span:missingAt?{start:missingAt.pos,end:missingAt.end}:null});
    return false;
  }
  p.i++;
  if(kind&&at(p,kind)) p.i++;
  else if(p.d!=='tsql'&&peek(p)&&peek(p).type==='word'&&!peek(p).nl&&
          ['IF','WHILE','LOOP','FOR','REPEAT','CASE'].indexOf(peek(p).u)>=0) p.i++;
  if(peek(p)&&peek(p).type==='word'&&peek(p).v!==';'&&
     !SOFT_M[peek(p).u]&&!p.hard[peek(p).u]&&peek(p).nl===false&&peek(p).v.charAt(0)!=='@'){
    /* trailing block label, e.g. END LOOP outer; */
    if(peek(p,1)&&peek(p,1).v===';') p.i++;
  }
  skipSemis(p);
  return true;
}

function parseHandlers(p: ParserState): Array<{cond: TokenList; body: AstNode[]}> {
  /* EXCEPTION WHEN cond THEN body [WHEN …] */
  var hs: Array<{cond: TokenList; body: AstNode[]}>= [];
  while(at(p,'WHEN')){
    p.i++;
    var cond=readTokens(p,'cond');
    eat(p,'THEN');
    var body=parseBlock(p,[]);
    hs.push({cond:cond, body:body});
  }
  return hs;
}

function parseStatement(p: ParserState): AstNode | null {
  var t=peek(p);
  if(!t) return null;
  var u=t.u, tsql=p.d==='tsql';

  if(t.type==='word'&&u==='GO'&&tsql){ p.i++; return {type:'go'}; }

  /* <<label>> (PL/pgSQL) */
  if(t.v==='<<'){
    var lb=peek(p,1)?peek(p,1).v:'';
    p.i+=3;
    var inner=parseStatement(p);
    if(inner) inner.label=lb;
    return inner;
  }
  /* label: (T-SQL goto target, or DB2 loop label) */
  if(t.type==='word'&&peek(p,1)&&peek(p,1).v===':'&&!p.hard[u]&&!SOFT_M[u]&&t.v.charAt(0)!=='@'){
    var nx2=peek(p,2);
    if(nx2&&nx2.type==='word'&&['LOOP','WHILE','FOR','REPEAT','BEGIN'].indexOf(nx2.u)>=0){
      p.i+=2;
      var st2=parseStatement(p);
      if(st2) st2.label=t.v;
      return st2;
    }
    p.i+=2;
    return {type:'label', label:t.v};
  }

  if(t.type==='word'&&u==='BEGIN'){
    var nx=peek(p,1), nu=nx?nx.u:'';
    if(tsql&&nu==='TRY'){
      p.i+=2;
      var tb=parseBlock(p,[]);
      eatEnd(p,'TRY');
      var cb: AstNode[]=[];
      if(at(p,'BEGIN')&&at(p,'CATCH',1)){ p.i+=2; cb=parseBlock(p,[]); eatEnd(p,'CATCH'); }
      return {type:'try', body:tb, handlers:[{cond:null, body:cb}]};
    }
    if(nu==='TRANSACTION'||nu==='TRAN'||nu==='DISTRIBUTED'||nu==='WORK'||nu==='ISOLATION'||
       (nx&&nx.v===';')||!nx){
      return {type:'stmt', toks:readTokens(p,'stmt')};
    }
    p.i++;
    eat(p,'ATOMIC'); eat(p,'NOT'); eat(p,'ATOMIC');
    var body=parseBlock(p,[]);
    var hs: Array<{cond: TokenList; body: AstNode[]}>= [];
    if(at(p,'EXCEPTION')){ p.i++; hs=parseHandlers(p); }
    eatEnd(p,null);
    if(hs.length) return {type:'try', body:body, handlers:hs};
    return {type:'block', body:body};
  }

  if(t.type==='word'&&u==='IF'){
    p.i++;
    var cond=readTokens(p,'cond');
    if(eat(p,'THEN')){                                   /* DB2 / PL/pgSQL form */
      var thenB=parseBlock(p,[]);
      var node: AstNode={type:'if', cond:cond, then:{type:'block', body:thenB}, else:null};
      var tail: AstNode=node;
      while(at(p,'ELSEIF')||at(p,'ELSIF')){
        p.i++;
        var c2=readTokens(p,'cond');
        eat(p,'THEN');
        var b2=parseBlock(p,[]);
        var nn: AstNode={type:'if', cond:c2, then:{type:'block', body:b2}, else:null};
        tail.else=nn; tail=nn;
      }
      if(eat(p,'ELSE')) tail.else={type:'block', body:parseBlock(p,[])};
      eatEnd(p,'IF');
      return node;
    }
    var thenS=parseStatement(p);                          /* T-SQL form */
    skipSemis(p);
    var elseS=null;
    if(eat(p,'ELSE')) elseS=parseStatement(p);
    return {type:'if', cond:cond, then:thenS, else:elseS};
  }

  if(t.type==='word'&&u==='CASE'){                        /* CASE statement */
    p.i++;
    var sel=readTokens(p,'case');
    var branches: Array<{cond: TokenList; body: AstNode[]}>=[], elseB: AstNode[] | null=null;
    while(at(p,'WHEN')){
      p.i++;
      var wc=readTokens(p,'cond');
      eat(p,'THEN');
      branches.push({cond:wc, body:parseBlock(p,[])});
    }
    if(eat(p,'ELSE')) elseB=parseBlock(p,[]);
    eatEnd(p,'CASE');
    return {type:'case', sel:sel, branches:branches, else:elseB};
  }

  if(t.type==='word'&&u==='WHILE'){
    p.i++;
    var wcond=readTokens(p,'cond');
    if(eat(p,'DO')||eat(p,'LOOP')){
      var wb=parseBlock(p,[]);
      eatEnd(p,null);
      return {type:'while', cond:wcond, body:{type:'block', body:wb}};
    }
    return {type:'while', cond:wcond, body:parseStatement(p)};
  }

  if(t.type==='word'&&u==='LOOP'&&!tsql){
    p.i++;
    var lb2=parseBlock(p,[]);
    eatEnd(p,'LOOP');
    return {type:'loop', body:{type:'block', body:lb2}};
  }

  if(t.type==='word'&&u==='REPEAT'&&!tsql){
    p.i++;
    var rb=parseBlock(p,['UNTIL']);
    eat(p,'UNTIL');
    var rc=readTokens(p,'cond');
    eatEnd(p,'REPEAT');
    return {type:'repeat', body:{type:'block', body:rb}, cond:rc};
  }

  if(t.type==='word'&&(u==='FOR'||u==='FOREACH')&&!tsql){
    p.i++;
    var head=readTokens(p,'head');
    if(eat(p,'DO')||eat(p,'LOOP')){
      var fb=parseBlock(p,[]);
      eatEnd(p,null);
      return {type:'for', head:head, body:{type:'block', body:fb}};
    }
    return {type:'stmt', toks:head};
  }

  /* DB2 declarative handler */
  if(t.type==='word'&&u==='DECLARE'&&p.d==='db2'){
    var k1=peek(p,1), k2=peek(p,2);
    if(k1&&k2&&['CONTINUE','EXIT','UNDO'].indexOf(k1.u)>=0&&k2.u==='HANDLER'){
      p.i+=3;
      eat(p,'FOR');
      var conds=readTokens(p,'cond');
      var hbody=parseStatement(p);
      return {type:'handler', kind:k1.u as Db2HandlerKind, conds:conds, body:hbody};
    }
  }

  if(t.type==='word'&&u==='RETURN'){
    var r1=peek(p,1);
    if(p.d==='plpgsql'&&r1&&(r1.u==='NEXT'||r1.u==='QUERY'))
      return {type:'stmt', toks:readTokens(p,'stmt')};
    return {type:'return', toks:readTokens(p,'stmt')};
  }
  if(t.type==='word'&&u==='THROW'&&tsql) return {type:'throw', toks:readTokens(p,'stmt')};
  if(t.type==='word'&&u==='RAISERROR'&&tsql){
    var raiseToks=readTokens(p,'stmt');
    var severity=staticRaiserrorSeverity(raiseToks);
    return severity!==null&&severity>10
      ? {type:'throw',toks:raiseToks}
      : {type:'stmt',toks:raiseToks};
  }
  if(t.type==='word'&&(u==='SIGNAL'||u==='RESIGNAL')&&p.d==='db2')
    return {type:'throw', toks:readTokens(p,'stmt')};
  if(t.type==='word'&&u==='RAISE'&&p.d==='plpgsql'){
    var lvl=peek(p,1);
    var soft=!!lvl&&['NOTICE','WARNING','INFO','DEBUG','LOG'].indexOf(lvl.u)>=0;
    var pre=[t]; p.i++;
    if(lvl&&lvl.type==='word'&&
       ['NOTICE','WARNING','INFO','DEBUG','LOG','EXCEPTION','SQLSTATE'].indexOf(lvl.u)>=0){
      pre.push(lvl); p.i++;
    }
    var toks2=pre.concat(readTokens(p,'stmt'));
    return soft ? {type:'stmt', toks:toks2} : {type:'throw', toks:toks2};
  }

  /* Dynamic SQL cannot be resolved statically; keep it visible as an opaque step. */
  if(t.type==='word'&&(u==='EXEC'||u==='EXECUTE')){
    var dn=peek(p,1);
    var dynamic = p.d==='plpgsql' ||
      (p.d==='db2'&&dn&&dn.u==='IMMEDIATE') ||
      (p.d==='tsql'&&dn&&(dn.type==='str'||dn.v==='('||
        (dn.v.charAt(0)==='@'&&!(peek(p,2)&&peek(p,2).v==='='))||
        dn.u==='SP_EXECUTESQL'||/\.SP_EXECUTESQL$/i.test(dn.v)));
    if(dynamic) return {type:'dynamic', toks:readTokens(p,'stmt')};
  }

  /* loop control: BREAK / LEAVE / EXIT [label] [WHEN cond] ; CONTINUE / ITERATE */
  if(t.type==='word'&&(u==='BREAK'||u==='LEAVE'||u==='EXIT'||u==='CONTINUE'||u==='ITERATE')){
    var isBreak = (u==='BREAK'||u==='LEAVE'||u==='EXIT');
    p.i++;
    var target=null, when=null, nt=peek(p);
    if(nt&&nt.type==='word'&&nt.u!=='WHEN'&&nt.v!==';'){ target=nt.v; p.i++; }
    if(eat(p,'WHEN')) when=readTokens(p,'cond');
    skipSemis(p);
    var controlEnd=p.t[p.i-1]||t;
    return {type: isBreak?'break':'continue', target:target, when:when, word:t.v,
            span:{start:t.pos,end:controlEnd.end}};
  }

  if(t.type==='word'&&u==='GOTO'){
    p.i++;
    var g=peek(p)?peek(p).v:'?';
    p.i++; skipSemis(p);
    return {type:'goto', label:g};
  }

  var toks=readTokens(p,'stmt');
  if(!toks.length){ p.i++; return null; }
  if(p.d==='sqlite'){
    var sqliteRaise=parseSqliteRaiseStatement(toks);
    if(sqliteRaise) return sqliteRaise;
  }
  return {type:'stmt', toks:toks};
}

/* ---------- header / body extraction ---------- */
var OBJ_KINDS: string[] = ['PROCEDURE','PROC','FUNCTION','TRIGGER','VIEW'];
function findBody(toks: TokenList, dialect: Dialect, src: string): SqlHeader {
  var i=0, name='', params='', kind='', gate=null;
  while(i<toks.length&&['SET','USE','GO','PRAGMA'].indexOf(toks[i].u)>=0){
    while(i<toks.length&&toks[i].v!==';'&&toks[i].u!=='GO') i++;
    if(i<toks.length) i++;
  }
  var start=i;
  if(dialect==='plpgsql'&&toks[i]&&toks[i].u==='DO'){
    for(var di=i+1;di<toks.length;di++) if(toks[di].type==='dollar'){
      var doTag=/^\$[A-Za-z_]*\$/.exec(toks[di].v);
      return {name:'',params:'',kind:'DO',index:-1,gate:null,
              inner:toks[di].v.replace(/^\$[A-Za-z_]*\$/,'').replace(/\$[A-Za-z_]*\$$/,''),
              innerOffset:toks[di].pos+(doTag?doTag[0].length:0)};
    }
  }
  var isCreate = toks[i]&&['CREATE','ALTER','REPLACE'].indexOf(toks[i].u)>=0;
  if(!isCreate) return {name:'', params:'', kind:'', index:start, gate:null};

  var j=i+1;
  while(toks[j]&&['OR','ALTER','REPLACE','TEMP','TEMPORARY','MATERIALIZED','UNIQUE','CLUSTERED'].indexOf(toks[j].u)>=0) j++;
  if(!toks[j]||OBJ_KINDS.indexOf(toks[j].u)<0) return {name:'', params:'', kind:'', index:start, gate:null};
  kind=toks[j].u; i=j+1;

  var NAME_STOP=['AS','WITH','ON','FOR','AFTER','INSTEAD','BEFORE','RETURNS','LANGUAGE','BEGIN','IF','NOT','EXISTS'];
  var parts=[];
  while(i<toks.length&&toks[i].v!=='('&&NAME_STOP.indexOf(toks[i].u)<0&&toks[i].v.charAt(0)!=='@'){
    parts.push(toks[i].v); i++;
  }
  name=parts.join('');
  var afterName=i;

  /* parameters: @vars (T-SQL) or the first parenthesised list */
  var ps=[], depth=0, k;
  for(k=afterName;k<toks.length&&k<afterName+120;k++){
    var pt=toks[k];
    if(pt.v==='('){ depth++; continue; }
    if(pt.v===')'){ depth--; if(depth<=0&&ps.length) break; continue; }
    if(pt.u==='AS'||pt.u==='BEGIN'||pt.u==='RETURNS'){ if(depth<=0) break; }
    if(depth===1||pt.v.charAt(0)==='@'){
      var pv=toks[k-1];
      var named = pt.v.charAt(0)==='@' ||
        (pt.type==='word'&&(!pv||pv.v==='('||pv.v===','||
          ['IN','OUT','INOUT','VARIADIC'].indexOf(pv.u)>=0));
      if(named&&ps.length<10&&['IN','OUT','INOUT','VARIADIC'].indexOf(pt.u)<0) ps.push(pt.v);
    }
  }
  params=ps.join(', ');

  /* body start depends on dialect and object kind */
  if(dialect==='plpgsql'){
    for(k=afterName;k<toks.length;k++) if(toks[k].type==='dollar'){
      var dollarTag=/^\$[A-Za-z_]*\$/.exec(toks[k].v);
      return {name:name, params:params, kind:kind, index:-1, gate:null,
              inner:toks[k].v.replace(/^\$[A-Za-z_]*\$/,'').replace(/\$[A-Za-z_]*\$$/,''),
              innerOffset:toks[k].pos+(dollarTag?dollarTag[0].length:0)};
    }
  }
  if(dialect==='sqlite'||kind==='TRIGGER'){
    var w=-1, b=-1, d2=0;
    for(k=afterName;k<toks.length;k++){
      if(toks[k].v==='(') d2++;
      else if(toks[k].v===')') d2--;
      else if(d2===0&&toks[k].u==='WHEN'&&w<0) w=k;
      else if(d2===0&&toks[k].u==='BEGIN'){ b=k; break; }
    }
    if(b>=0){
      if(w>=0) gate=toks.slice(w+1,b);
      return {name:name, params:params, kind:kind, index:b, gate:gate};
    }
  }
  if(dialect==='db2'){
    var d3=0;
    for(k=afterName;k<toks.length;k++){
      if(toks[k].v==='(') d3++;
      else if(toks[k].v===')') d3--;
      else if(d3===0&&toks[k].u==='BEGIN') return {name:name, params:params, kind:kind, index:k, gate:null};
    }
  }
  /* default (T-SQL): body follows the top-level AS */
  var d4=0;
  for(k=afterName;k<toks.length;k++){
    var tk=toks[k];
    if(tk.v==='(') d4++;
    else if(tk.v===')') d4--;
    else if(d4===0&&tk.type==='word'&&tk.u==='AS'){
      var nn=toks[k+1];
      if(!(toks[k-1]&&toks[k-1].u==='EXECUTE')&&
         !(nn&&['OWNER','SELF','CALLER'].indexOf(nn.u)>=0)&&
         !(nn&&nn.type==='str')) return {name:name, params:params, kind:kind, index:k+1, gate:null};
    }
    else if(d4===0&&tk.type==='word'&&tk.u==='BEGIN'&&tk.nl)
      return {name:name, params:params, kind:kind, index:k, gate:null};
  }
  return {name:name, params:params, kind:kind, index:start, gate:null};
}

