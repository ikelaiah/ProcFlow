/* ===== CORE START ===== */
/* Pure functions: detect dialect, tokenise, parse control flow, emit Mermaid.
   Dialects: tsql | db2 (SQL PL) | plpgsql | sqlite */

var DIALECT_NAMES = {tsql:'T-SQL', db2:'DB2 SQL PL', plpgsql:'PL/pgSQL', sqlite:'SQLite'};

/* keywords that can never continue a statement (checked at depth 0) */
var HARD_BASE = ['BEGIN','END','IF','ELSE','WHILE','RETURN'];
var HARD_BY_DIALECT = {
  tsql:    HARD_BASE.concat(['BREAK','CONTINUE','GOTO','THROW','GO']),
  db2:     HARD_BASE.concat(['ELSEIF','LEAVE','ITERATE','GOTO','REPEAT','UNTIL','THEN','DO']),
  plpgsql: HARD_BASE.concat(['ELSIF','EXIT','CONTINUE','EXCEPTION','THEN','LOOP']),
  sqlite:  HARD_BASE.slice()
};
/* keywords that may start a new statement when they open a line */
var SOFT = ['SELECT','INSERT','UPDATE','DELETE','MERGE','EXEC','EXECUTE','SET','DECLARE','PRINT',
  'RAISERROR','TRUNCATE','OPEN','CLOSE','FETCH','DEALLOCATE','COMMIT','ROLLBACK','SAVE','SAVEPOINT',
  'RELEASE','WAITFOR','CREATE','ALTER','DROP','USE','WITH','GRANT','REVOKE','DENY','RESTORE','BACKUP',
  'CALL','PERFORM','RAISE','SIGNAL','RESIGNAL','GET','PREPARE','ASSERT','COPY','ANALYZE','VACUUM',
  'PRAGMA','REPLACE','ATTACH','DETACH','REINDEX','EXPLAIN','VALUES','REFRESH','LISTEN','NOTIFY','CASE'];
var CONT = ['AS','FROM','INTO','UNION','ALL','EXCEPT','INTERSECT','AND','OR','NOT','THEN','WHEN',
  'FOR','IS','IN','EXISTS','ON','BY','WITH','SET','VALUES','OUTPUT','TOP','APPLY','JOIN','LIKE',
  'BETWEEN','CASE','ELSE','OVER','PARTITION','ORDER','GROUP','HAVING','DISTINCT','PERCENT','CROSS',
  'OUTER','INNER','LEFT','RIGHT','FULL','USING','RETURNING','LIMIT','OFFSET','DO','CONFLICT'];
var CONT_OPS = [',','(','=','<','>','<=','>=','<>','!=','+','-','*','/','||','.','%','::'];
var S = function(a){ var o={}; for(var i=0;i<a.length;i++) o[a[i]]=1; return o; };
var CONT_M=S(CONT), CONT_OPS_M=S(CONT_OPS), SOFT_M=S(SOFT);

/* condition/header readers stop at these block-openers */
var OPENERS = {THEN:1, DO:1, LOOP:1};

/* ---------- dialect detection ---------- */
function detectDialect(sql){
  var s=String(sql||''), sc={tsql:0, db2:0, plpgsql:0, sqlite:0};
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
  var best='tsql', bv=0, k;
  for(k in sc) if(sc[k]>bv){ bv=sc[k]; best=k; }
  return {dialect: bv===0 ? 'tsql' : best, scores: sc, score:bv, confident: bv>=4};
}

/* ---------- tokeniser ---------- */
function tokenize(sql){
  var toks=[], i=0, n=sql.length, nl=true;
  while(i<n){
    var c=sql[i];
    if(c==='\n'){ nl=true; i++; continue; }
    if(c===' '||c==='\t'||c==='\r'){ i++; continue; }
    if(c==='-'&&sql[i+1]==='-'){ while(i<n&&sql[i]!=='\n') i++; continue; }
    if(c==='/'&&sql[i+1]==='*'){
      var d=1; i+=2;
      while(i<n&&d>0){
        if(sql[i]==='/'&&sql[i+1]==='*'){ d++; i+=2; }
        else if(sql[i]==='*'&&sql[i+1]==='/'){ d--; i+=2; }
        else { if(sql[i]==='\n') nl=true; i++; }
      }
      continue;
    }
    var start=i, type='op';
    var dq=c==='$'?/^\$[A-Za-z_]*\$/.exec(sql.slice(i)):null;
    if(dq){                                        /* $$ … $$ dollar quote */
      var tag=dq[0], close=sql.indexOf(tag, i+tag.length);
      i = close<0 ? n : close+tag.length;
      type='dollar';
    } else if(c==="'"||(/[NnEeBbXx]/.test(c)&&sql[i+1]==="'")){
      if(c!=="'") i++;
      i++;
      while(i<n){ if(sql[i]==="'"){ if(sql[i+1]==="'"){ i+=2; continue; } i++; break; } i++; }
      type='str';
    } else if(c==='['){ i++; while(i<n&&sql[i]!==']') i++; i++; type='word';
    } else if(c==='"'){ i++; while(i<n&&sql[i]!=='"') i++; i++; type='word';
    } else if(c==='`'){ i++; while(i<n&&sql[i]!=='`') i++; i++; type='word';
    } else if(/[A-Za-z_@#:]/.test(c)&&!(c===':'&&sql[i+1]!==':')){
      if(c===':') i+=2;
      while(i<n&&/[A-Za-z_@#$0-9]/.test(sql[i])) i++;
      type = start===i ? 'op' : 'word';
      if(type==='op') i++;
    } else if(/[0-9]/.test(c)){
      while(i<n&&/[0-9.eE]/.test(sql[i])) i++;
      type='num';
    } else {
      var two=sql.substr(i,2);
      if(['<=','>=','<>','!=','!<','!>','+=','-=','*=','/=','||','::','<<','>>','->','=>',':='].indexOf(two)>=0) i+=2;
      else i++;
      type='op';
    }
    var v=sql.slice(start,i);
    toks.push({type:type, v:v, u:type==='word'?v.toUpperCase():v, nl:nl, pos:start, end:i});
    nl=false;
  }
  return toks;
}

/* ---------- parser plumbing ---------- */
function P(toks, dialect){
  return {t:toks, i:0, d:dialect, hard:S(HARD_BY_DIALECT[dialect]||HARD_BY_DIALECT.tsql)};
}
function peek(p,k){ return p.t[p.i+(k||0)]; }
function at(p,word,k){ var t=peek(p,k); return !!t&&t.type==='word'&&t.u===word; }
function eat(p,word){ if(at(p,word)){ p.i++; return true; } return false; }
function skipSemis(p){ while(peek(p)&&peek(p).v===';') p.i++; }

function newStatementHere(tok, prev, startWord){
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
function readTokens(p, mode){
  var out=[], depth=0, caseDepth=0;
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

var BLOCK_STOPS = ['END','ELSE','ELSEIF','ELSIF','EXCEPTION','UNTIL','WHEN'];
function parseBlock(p, extraStops){
  var stops=S(BLOCK_STOPS.concat(extraStops||[]));
  var list=[], guard=0;
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
  return list;
}

/* consume END [IF|WHILE|LOOP|FOR|REPEAT|CASE|TRY|CATCH] [label] [;] */
function eatEnd(p, kind){
  if(!at(p,'END')) return false;
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

function parseHandlers(p){
  /* EXCEPTION WHEN cond THEN body [WHEN …] */
  var hs=[];
  while(at(p,'WHEN')){
    p.i++;
    var cond=readTokens(p,'cond');
    eat(p,'THEN');
    var body=parseBlock(p,[]);
    hs.push({cond:cond, body:body});
  }
  return hs;
}

function parseStatement(p){
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
      var cb=[];
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
    var hs=[];
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
      var node={type:'if', cond:cond, then:{type:'block', body:thenB}, else:null};
      var tail=node;
      while(at(p,'ELSEIF')||at(p,'ELSIF')){
        p.i++;
        var c2=readTokens(p,'cond');
        eat(p,'THEN');
        var b2=parseBlock(p,[]);
        var nn={type:'if', cond:c2, then:{type:'block', body:b2}, else:null};
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
    var branches=[], elseB=null;
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
      return {type:'handler', kind:k1.u, conds:conds, body:hbody};
    }
  }

  if(t.type==='word'&&u==='RETURN'){
    var r1=peek(p,1);
    if(p.d==='plpgsql'&&r1&&(r1.u==='NEXT'||r1.u==='QUERY'))
      return {type:'stmt', toks:readTokens(p,'stmt')};
    return {type:'return', toks:readTokens(p,'stmt')};
  }
  if(t.type==='word'&&u==='THROW'&&tsql) return {type:'throw', toks:readTokens(p,'stmt')};
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
    return {type: isBreak?'break':'continue', target:target, when:when, word:t.v};
  }

  if(t.type==='word'&&u==='GOTO'){
    p.i++;
    var g=peek(p)?peek(p).v:'?';
    p.i++; skipSemis(p);
    return {type:'goto', label:g};
  }

  var toks=readTokens(p,'stmt');
  if(!toks.length){ p.i++; return null; }
  return {type:'stmt', toks:toks};
}

/* ---------- header / body extraction ---------- */
var OBJ_KINDS = ['PROCEDURE','PROC','FUNCTION','TRIGGER','VIEW'];
function findBody(toks, dialect, src){
  var i=0, name='', params='', kind='', gate=null;
  while(i<toks.length&&['SET','USE','GO','PRAGMA'].indexOf(toks[i].u)>=0){
    while(i<toks.length&&toks[i].v!==';'&&toks[i].u!=='GO') i++;
    if(i<toks.length) i++;
  }
  var start=i;
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

/* ---------- label helpers ---------- */
function joinToks(toks, max){
  var s='';
  for(var i=0;i<toks.length;i++){
    var v=toks[i].v, prev=i?toks[i-1].v:'';
    var noSpace = i===0 || v===','||v===')'||v==='.'||v===';'||v==='::'
                  || prev==='('||prev==='.'||prev==='::'
                  || (v==='('&&toks[i-1].type==='word'&&!CONT_M[toks[i-1].u]);
    if(!noSpace&&(prev==='-'||prev==='+')){
      var pp = i>=2 ? toks[i-2] : null;
      if(!pp||(pp.type==='op'&&pp.v!==')')||
         (pp.type==='word'&&['RETURN','THROW','WHEN','THEN','ELSE','BY','TOP'].indexOf(pp.u)>=0)) noSpace=true;
    }
    s += (noSpace?'':' ')+v;
    if(max&&s.length>max+40) break;
  }
  return s.trim();
}
function spanOfTokens(toks){
  if(!toks||!toks.length) return null;
  return {start:toks[0].pos, end:toks[toks.length-1].end};
}
function clip(s, max){ return s.length>max ? s.slice(0,max-1).trim()+'…' : s; }
function qname(toks, i){
  if(!toks[i]) return '';
  var s=toks[i].v, k=i+1;
  while(toks[k]&&toks[k].v==='.'&&toks[k+1]){ s+='.'+toks[k+1].v; k+=2; }
  return s;
}

function summarise(toks, max){
  var u=function(i){ return toks[i]?toks[i].u:''; };
  var v=function(i){ return qname(toks,i); };
  var head=u(0), out=null, i;
  if(head==='INSERT'||head==='REPLACE'){
    i=1;
    while(['INTO','OR','IGNORE','REPLACE'].indexOf(u(i))>=0) i++;
    out='INSERT INTO '+v(i);
  } else if(head==='UPDATE'){
    i = u(1)==='TOP' ? 3 : (u(1)==='OR'?3:1);
    out='UPDATE '+v(i);
  } else if(head==='DELETE'){
    i = u(1)==='FROM' ? 2 : 1;
    out='DELETE FROM '+v(i);
  } else if(head==='MERGE'){
    i = u(1)==='INTO' ? 2 : 1;
    out='MERGE '+v(i);
  } else if(head==='EXEC'||head==='EXECUTE'||head==='CALL'||head==='PERFORM'){
    i=1;
    if(v(1)&&v(1).charAt(0)==='@'&&toks[2]&&toks[2].v==='=') i=3;
    out=(head==='PERFORM'?'PERFORM ':(head==='CALL'?'CALL ':'EXEC '))+v(i);
  } else if(head==='SELECT'){
    var into=-1, from=-1, d=0;
    for(var k=0;k<toks.length;k++){
      if(toks[k].v==='(') d++;
      else if(toks[k].v===')') d--;
      else if(d===0&&toks[k].u==='INTO'&&into<0) into=k;
      else if(d===0&&toks[k].u==='FROM'&&from<0) from=k;
    }
    if(into>=0) out='SELECT … INTO '+v(into+1);
    else if(v(1)&&v(1).charAt(0)==='@') out=clip(joinToks(toks.slice(0,from>0?from:6)),max);
    else if(from>=0) out='SELECT … FROM '+v(from+1);
  } else if(head==='DECLARE'){
    var vars=[];
    for(var j=1;j<toks.length&&vars.length<4;j++)
      if(toks[j].v.charAt(0)==='@'&&(j===1||toks[j-1].v===',')) vars.push(toks[j].v);
    if(vars.length) out='DECLARE '+vars.join(', ')+(vars.length>3?' …':'');
  } else if(head==='RAISE'||head==='SIGNAL'||head==='RESIGNAL'||head==='RAISERROR'){
    out=clip(joinToks(toks,max),max);
  }
  if(!out) out=joinToks(toks, max);
  return clip(out, max);
}

function escLabel(s){
  return String(s)
    .replace(/#/g,'#35;')
    .replace(/&/g,'#amp;')
    .replace(/"/g,'#quot;')
    .replace(/</g,'#lt;')
    .replace(/>/g,'#gt;')
    .replace(/\|/g,'#124;')
    .replace(/%%/g,'#37;#37;')
    .replace(/[\r\n]+/g,' ')
    .replace(/\u0001/g,'<BR>')
    .replace(/\s+/g,' ');
}

/* ---------- graph builder ---------- */
function buildGraph(ast, header, opts){
  opts=opts||{};
  var detail=opts.detail||'summary', group=opts.group!==false;
  var dialect=opts.dialect||'tsql';
  var fanIn=opts.fanIn===true, number=opts.number===true;
  var guarded={};                       /* nodes already wired to an inner handler */
  var PROTECTABLE=['stmt','io','call','tran','opaque'];
  var maxLen = detail==='full' ? 110 : 52;
  var nodes=[], edges=[], seq=0;
  var stats={stmt:0, branch:0, loop:0, cat:0, exit:0, depth:0, opaque:0};
  var labels={}, gotos=[];

  function add(shape, text, cls, source){
    var id='n'+(++seq);
    nodes.push({id:id, shape:shape, text:(text&&String(text).trim())||'…',
                cls:cls, source:source||null});
    return id;
  }
  function link(from, to, label, style){
    if(!from||!to) return;
    edges.push({from:from, to:to, label:label||'', style:style||'solid'});
  }
  function joinExits(exits, to){ for(var i=0;i<exits.length;i++) link(exits[i].id, to, exits[i].label); }
  function textOf(st){ return detail==='full' ? clip(joinToks(st.toks,maxLen),maxLen) : summarise(st.toks,maxLen); }
  function kindOf(st){
    var h=st.toks&&st.toks[0]?st.toks[0].u:'';
    if(['INSERT','UPDATE','DELETE','MERGE','TRUNCATE','REPLACE','COPY'].indexOf(h)>=0) return 'io';
    if(['EXEC','EXECUTE','CALL','PERFORM'].indexOf(h)>=0) return 'call';
    if(['COMMIT','ROLLBACK','SAVE','SAVEPOINT','RELEASE','BEGIN'].indexOf(h)>=0) return 'tran';
    return 'stmt';
  }
  function findLoop(ctx, target){
    while(ctx){
      if(ctx.loop&&(!target||!ctx.loop.label||ctx.loop.label.toUpperCase()===target.toUpperCase())) return ctx.loop;
      ctx=ctx.parent;
    }
    return null;
  }

  function emitList(list, ctx, depth){
    if(depth>stats.depth) stats.depth=depth;
    var local={parent:ctx, handlers:[]};
    var entry=null, exits=[], i=0;
    while(i<list.length){
      var st=list[i], res;
      if(st.type==='go'){ i++; continue; }
      if(group&&st.type==='stmt'&&kindOf(st)==='stmt'){
        var run=[st], j=i+1;
        while(j<list.length&&list[j].type==='stmt'&&kindOf(list[j])==='stmt'&&run.length<6){ run.push(list[j]); j++; }
        if(run.length>1){
          var runSpan={start:run[0].toks[0].pos,
                       end:run[run.length-1].toks[run[run.length-1].toks.length-1].end};
          var id=add('rect', run.map(textOf).join('\u0001'), 'stmt', runSpan);
          stats.stmt+=run.length;
          res={entry:id, exits:[{id:id}]};
          i=j;
        } else { res=emitOne(st, local, depth); i++; }
      } else { res=emitOne(st, local, depth); i++; }
      if(!res||!res.entry) continue;
      if(!entry) entry=res.entry;
      joinExits(exits, res.entry);
      exits=res.exits;
    }
    for(var h=0;h<local.handlers.length;h++)
      link(entry||local.handlers[h].id, local.handlers[h].id, local.handlers[h].label, 'dotted');
    return {entry:entry, exits:exits};
  }

  function emitOne(st, ctx, depth){
    switch(st.type){
      case 'block': return emitList(st.body, ctx, depth);

      case 'stmt': {
        stats.stmt++;
        var id=add('rect', textOf(st), kindOf(st), spanOfTokens(st.toks));
        return {entry:id, exits:[{id:id}]};
      }

      case 'dynamic': {
        stats.stmt++; stats.opaque++;
        var dyn=add('rect', 'Dynamic SQL — '+clip(joinToks(st.toks,42),42),
                    'opaque', spanOfTokens(st.toks));
        return {entry:dyn, exits:[{id:dyn}]};
      }

      case 'if': {
        stats.branch++;
        var c=add('diamond', clip(joinToks(st.cond,60),60), 'cond', spanOfTokens(st.cond));
        var t=st.then?emitOne(st.then, ctx, depth+1):null;
        var e=st.else?emitOne(st.else, ctx, depth+1):null;
        var ex=[];
        if(t&&t.entry){ link(c,t.entry,'yes'); ex=ex.concat(t.exits); } else ex.push({id:c, label:'yes'});
        if(e&&e.entry){ link(c,e.entry,'no'); ex=ex.concat(e.exits); } else ex.push({id:c, label:'no'});
        return {entry:c, exits:ex};
      }

      case 'case': {
        if(!st.branches.length){
          stats.stmt++;
          var cs=add('rect', clip('CASE '+joinToks(st.sel||[],44),52), 'stmt',
                     spanOfTokens(st.sel));
          return {entry:cs, exits:[{id:cs}]};
        }
        var selTxt=st.sel&&st.sel.length?joinToks(st.sel,40):'';
        var entry=null, prev=null, exits=[];
        for(var b=0;b<st.branches.length;b++){
          stats.branch++;
          var br=st.branches[b];
          var lab=(selTxt?selTxt+' = ':'')+clip(joinToks(br.cond,44),44);
          var d=add('diamond', clip(lab,58), 'cond', spanOfTokens(br.cond));
          if(!entry) entry=d;
          if(prev) link(prev, d, 'no');
          var bb=emitList(br.body, ctx, depth+1);
          if(bb.entry){ link(d, bb.entry, 'yes'); exits=exits.concat(bb.exits); }
          else exits.push({id:d, label:'yes'});
          prev=d;
        }
        if(st.else){
          var eb=emitList(st.else, ctx, depth+1);
          if(eb.entry){ link(prev, eb.entry, 'else'); exits=exits.concat(eb.exits); }
        } else if(prev) exits.push({id:prev, label:'no'});
        return {entry:entry, exits:exits};
      }

      case 'while':
      case 'for':
      case 'loop': {
        stats.loop++;
        var txt = st.type==='while' ? clip(joinToks(st.cond,58),58)
                : st.type==='for'   ? clip('for '+joinToks(st.head,54),58)
                : 'loop';
        var wc=add('hex', txt, 'loop', spanOfTokens(st.cond||st.head));
        var inner={loop:{cond:wc, breaks:[], label:st.label||null}, parent:ctx, handlers:[]};
        var body=st.body?emitOne(st.body, inner, depth+1):null;
        if(body&&body.entry){ link(wc, body.entry, st.type==='loop'?'':'yes'); joinExits(body.exits, wc); }
        else link(wc, wc, 'loop');
        var outs=inner.loop.breaks.slice();
        if(st.type!=='loop') outs.push({id:wc, label:'done'});
        return {entry:wc, exits:outs};
      }

      case 'repeat': {
        stats.loop++;
        var body2=st.body?emitOne(st.body, {loop:null, parent:ctx}, depth+1):null;
        var rc=add('diamond', 'until '+clip(joinToks(st.cond,50),50), 'loop',
                   spanOfTokens(st.cond));
        var inner2={loop:{cond:rc, breaks:[], label:st.label||null}, parent:ctx};
        if(body2&&body2.entry){
          joinExits(body2.exits, rc);
          link(rc, body2.entry, 'no');
          return {entry:body2.entry, exits:[{id:rc, label:'yes'}].concat(inner2.loop.breaks)};
        }
        return {entry:rc, exits:[{id:rc, label:'yes'}]};
      }

      case 'try': {
        stats.cat += st.handlers.length||1;
        var tstart=add('marker', dialect==='tsql'?'BEGIN TRY':'BEGIN block', 'try');
        var mark=nodes.length;
        var tb=emitList(st.body, ctx, depth+1);
        if(tb.entry) link(tstart, tb.entry);
        var exits=tb.entry?tb.exits.slice():[{id:tstart}];

        /* which statements inside this block can raise? */
        var raisers=[];
        if(fanIn) nodes.slice(mark).forEach(function(n){
          if(PROTECTABLE.indexOf(n.cls)>=0&&!guarded[n.id]) raisers.push(n.id);
        });

        /* more than one handler: fan into a junction, then branch */
        var junction=null;
        if(fanIn&&raisers.length&&st.handlers.length>1)
          junction=add('marker','on error','catch');

        for(var hh=0;hh<st.handlers.length;hh++){
          var h=st.handlers[hh];
          var lab2=h.cond&&h.cond.length ? clip(joinToks(h.cond,40),40) : 'CATCH';
          var cm=add('marker', lab2==='CATCH'?'BEGIN CATCH':('WHEN '+lab2), 'catch');
          if(lab2!=='CATCH'&&dialect!=='tsql') nodes[nodes.length-1].text='EXCEPTION WHEN '+lab2;
          if(junction) link(junction, cm, lab2==='CATCH'?'':lab2, 'dotted');
          else if(fanIn&&raisers.length)
            raisers.forEach(function(id){ link(id, cm, '', 'dotted'); });
          else link(tstart, cm, 'error', 'dotted');
          var cb2=emitList(h.body, ctx, depth+1);
          if(cb2.entry){ link(cm, cb2.entry); exits=exits.concat(cb2.exits); }
          else exits.push({id:cm});
        }
        if(junction) raisers.forEach(function(id){ link(id, junction, '', 'dotted'); });
        if(fanIn) raisers.forEach(function(id){ guarded[id]=1; });
        return {entry:tstart, exits:exits};
      }

      case 'handler': {
        stats.cat++;
        var hm=add('marker', st.kind+' HANDLER FOR '+clip(joinToks(st.conds,34),34), 'catch');
        var hb=st.body?emitOne(st.body, ctx, depth+1):null;
        if(hb&&hb.entry) link(hm, hb.entry);
        if(ctx&&ctx.handlers) ctx.handlers.push({id:hm, label:'on condition'});
        return {entry:null, exits:[]};
      }

      case 'return': {
        var r=add('round', clip(joinToks(st.toks,40),40)||'RETURN', 'ret',
                  spanOfTokens(st.toks));
        return {entry:r, exits:[]};
      }

      case 'throw': {
        var th=add('round', clip(joinToks(st.toks,46),46), 'err',
                   spanOfTokens(st.toks));
        return {entry:th, exits:[]};
      }

      case 'break':
      case 'continue': {
        var isBreak=st.type==='break';
        var L=findLoop(ctx, st.target);
        var word=(st.word||(isBreak?'BREAK':'CONTINUE')).toUpperCase()+(st.target?' '+st.target:'');
        if(st.when&&st.when.length){
          stats.branch++;
          var dq=add('diamond', word+' WHEN '+clip(joinToks(st.when,40),40), 'cond',
                     spanOfTokens(st.when));
          if(L){ if(isBreak) L.breaks.push({id:dq, label:'yes'}); else link(dq, L.cond, 'yes'); }
          return {entry:dq, exits:[{id:dq, label:'no'}]};
        }
        var bn=add('rect', word, 'flowctl');
        if(L){ if(isBreak) L.breaks.push({id:bn}); else link(bn, L.cond, 'continue'); }
        return {entry:bn, exits:[]};
      }

      case 'label': {
        var lb=add('marker', st.label+':', 'flowctl');
        labels[st.label.toUpperCase()]=lb;
        return {entry:lb, exits:[{id:lb}]};
      }

      case 'goto': {
        var g=add('rect','GOTO '+st.label,'flowctl');
        gotos.push({from:g, to:st.label.toUpperCase()});
        return {entry:g, exits:[]};
      }
    }
    return null;
  }

  var startText = header.name
    ? header.name + (header.params?'('+clip(header.params,44)+')':'')
    : (header.kind ? header.kind.toLowerCase() : 'Script start');
  var start=add('round', startText, 'start');
  var head=start;

  if(header.gate&&header.gate.length){                 /* SQLite trigger WHEN clause */
    stats.branch++;
    var gd=add('diamond', clip(joinToks(header.gate,58),58), 'cond',
               spanOfTokens(header.gate));
    link(start, gd);
    head=gd;
  }

  var body=emitList(ast, null, 1);
  var end=add('round','End','start');
  if(head!==start){
    if(body.entry) link(head, body.entry, 'yes'); else link(head, end, 'yes');
    link(head, end, 'no');
  } else if(body.entry) link(start, body.entry);
  joinExits(body.entry?body.exits:[{id:head}], end);

  for(var i2=0;i2<nodes.length;i2++) if(nodes[i2].cls==='ret') link(nodes[i2].id, end, '', 'dotted');
  for(var g2=0;g2<gotos.length;g2++) if(labels[gotos[g2].to]) link(gotos[g2].from, labels[gotos[g2].to], 'goto', 'dotted');

  if(number){
    var step=0;
    nodes.forEach(function(n){
      if(PROTECTABLE.indexOf(n.cls)>=0) n.text=(++step)+'. '+n.text;
    });
    stats.steps=step;
  }
  stats.exit = nodes.filter(function(n){ return n.cls==='ret'||n.cls==='err'; }).length;
  stats.cc = 1 + stats.branch + stats.loop + stats.cat;
  return {nodes:nodes, edges:edges, stats:stats};
}

/* ---------- query structure (CTE lineage) ---------- */
var NOT_TABLE = S(['SELECT','LATERAL','ONLY','TABLE','UNNEST','VALUES','FINAL','OLD','NEW',
                   'XMLTABLE','JSON_TABLE','GENERATE_SERIES','DUAL']);

function splitCTEs(toks){
  var res={ctes:[], finalStart:0};
  if(!toks.length) return res;
  if(toks[0].u!=='WITH') return res;
  var i=1;
  if(toks[i]&&toks[i].u==='RECURSIVE'){ res.recursive=true; i++; }
  while(i<toks.length){
    var nameTok=toks[i];
    if(!nameTok||nameTok.type!=='word') break;
    var name=nameTok.v; i++;
    if(toks[i]&&toks[i].v==='('){                 /* optional column list */
      var d0=0;
      while(i<toks.length){
        if(toks[i].v==='(') d0++;
        else if(toks[i].v===')'){ d0--; if(d0===0){ i++; break; } }
        i++;
      }
    }
    if(!(toks[i]&&toks[i].u==='AS')) break;
    i++;
    while(toks[i]&&['MATERIALIZED','NOT'].indexOf(toks[i].u)>=0) i++;
    if(!(toks[i]&&toks[i].v==='(')) break;
    var start=i, d=0;
    while(i<toks.length){
      if(toks[i].v==='(') d++;
      else if(toks[i].v===')'){ d--; if(d===0){ i++; break; } }
      i++;
    }
    res.ctes.push({name:name, body:toks.slice(start+1, i-1)});
    if(toks[i]&&toks[i].v===','){ i++; continue; }
    break;
  }
  res.finalStart=i;
  return res;
}

function refsIn(toks){
  var refs=[], joins=0, unions=0, subs=0, filtered=false, d=0, agg=false;
  for(var i=0;i<toks.length;i++){
    var t=toks[i];
    if(t.v==='('){ d++; if(toks[i+1]&&toks[i+1].u==='SELECT') subs++; continue; }
    if(t.v===')'){ d--; continue; }
    if(t.type!=='word') continue;
    if(t.u==='JOIN') joins++;
    else if(t.u==='UNION') unions++;
    else if(t.u==='WHERE'&&d===0) filtered=true;
    else if((t.u==='GROUP'||t.u==='DISTINCT')&&d===0) agg=true;
    if(t.u==='FROM'||t.u==='JOIN'){
      var n=toks[i+1];
      if(!n||n.type!=='word'||n.v==='('||NOT_TABLE[n.u]) continue;
      refs.push(qname(toks,i+1));
    }
  }
  return {refs:refs, joins:joins, unions:unions, subs:subs, filtered:filtered, agg:agg};
}

function buildQueryGraph(stmtToks, header, opts){
  opts=opts||{};
  var showSrc = opts.sources!==false;
  var split=splitCTEs(stmtToks);
  var finalToks=stmtToks.slice(split.finalStart);
  var nodes=[], edges=[], seq=0, srcIds={}, cteIds={}, byName={};
  var stats={ctes:split.ctes.length, tables:0, joins:0, unions:0, subs:0, depth:0};

  function add(shape, text, cls, source){
    var id='q'+(++seq);
    nodes.push({id:id, shape:shape, text:(text&&String(text).trim())||'…',
                cls:cls, source:source||null});
    return id;
  }
  function link(a,b,label){ if(a&&b&&a!==b) edges.push({from:a,to:b,label:label||'',style:'solid'}); }
  function descr(r){
    var bits=[];
    if(r.joins) bits.push(r.joins+' join'+(r.joins>1?'s':''));
    if(r.unions) bits.push(r.unions+' union'+(r.unions>1?'s':''));
    if(r.subs) bits.push(r.subs+' subquer'+(r.subs>1?'ies':'y'));
    if(r.filtered) bits.push('filtered');
    if(r.agg) bits.push('grouped');
    return bits.join(' · ');
  }

  split.ctes.forEach(function(c){
    c.info=refsIn(c.body);
    stats.joins+=c.info.joins; stats.unions+=c.info.unions; stats.subs+=c.info.subs;
    var d=descr(c.info);
    cteIds[c.name.toUpperCase()]=add('rect', c.name+(d?'\u0001'+d:''), 'cte',
                                      spanOfTokens(c.body));
    byName[c.name.toUpperCase()]=c;
  });

  var fi=refsIn(finalToks);
  stats.joins+=fi.joins; stats.unions+=fi.unions; stats.subs+=fi.subs;
  var fd=descr(fi);
  var finalId=add('round', (header.name||'Final SELECT')+(fd?'\u0001'+fd:''), 'final',
                  spanOfTokens(finalToks));

  function srcNode(name){
    var k=name.toUpperCase();
    if(!srcIds[k]){ srcIds[k]=add('io', name, 'src'); stats.tables++; }
    return srcIds[k];
  }
  function wire(refs, toId){
    var seen={};
    refs.forEach(function(r){
      var k=r.toUpperCase();
      if(seen[k]) return;
      seen[k]=1;
      if(cteIds[k]) link(cteIds[k], toId);
      else if(showSrc) link(srcNode(r), toId);
      else stats.tables=Object.keys(srcIds).length;
    });
  }
  split.ctes.forEach(function(c){ wire(c.info.refs, cteIds[c.name.toUpperCase()]); });
  wire(fi.refs, finalId);

  if(!showSrc){
    var all={};
    split.ctes.forEach(function(c){ c.info.refs.forEach(function(r){ if(!cteIds[r.toUpperCase()]) all[r.toUpperCase()]=1; }); });
    fi.refs.forEach(function(r){ if(!cteIds[r.toUpperCase()]) all[r.toUpperCase()]=1; });
    stats.tables=Object.keys(all).length;
  }

  /* longest chain through the CTE graph */
  var memo={};
  function depthOf(id, guard){
    if(memo[id]!==undefined) return memo[id];
    if((guard||0)>60) return 0;
    var best=0;
    edges.forEach(function(e){ if(e.to===id) best=Math.max(best, depthOf(e.from,(guard||0)+1)+1); });
    return (memo[id]=best);
  }
  stats.depth=depthOf(finalId,0);
  stats.parts=stats.ctes+stats.joins+stats.unions+stats.subs;
  return {nodes:nodes, edges:edges, stats:stats, empty:split.ctes.length===0&&fi.refs.length===0};
}

function toMermaid(graph, dir){
  var L=['flowchart '+(dir||'TD')];
  var wrap={rect:['["','"]'], diamond:['{"','"}'], hex:['{{"','"}}'],
            round:['(["','"])'], marker:['>"','"]'], io:['[("','")]'], call:['[["','"]]']};
  graph.nodes.forEach(function(n){ if(n.shape==='io') n.cls=n.cls||'io'; });
  graph.nodes.forEach(function(n){
    var shape=n.shape;
    if(shape==='rect'&&n.cls==='io') shape='io';
    if(shape==='rect'&&n.cls==='call') shape='call';
    var w=wrap[shape]||wrap.rect;
    L.push('  '+n.id+w[0]+escLabel(n.text).replace(/<BR>/g,'<br/>')+w[1]);
  });
  graph.edges.forEach(function(e){
    var arrow=e.style==='dotted' ? '-.->' : '-->';
    L.push('  '+e.from+' '+arrow+(e.label?'|'+escLabel(e.label)+'|':'')+' '+e.to);
  });
  var styles={
    start:'fill:#2b3d4a,stroke:#8ea3b4,color:#e7eef3',
    stmt:'fill:#1e2b35,stroke:#516878,color:#e7eef3',
    io:'fill:#1b3140,stroke:#7ea6e0,color:#dcebff',
    call:'fill:#20303c,stroke:#7ea6e0,color:#dcebff',
    tran:'fill:#232f2b,stroke:#54c39b,color:#dff5ec',
    cond:'fill:#3a2c15,stroke:#e8a33d,color:#ffeccc',
    loop:'fill:#152b3d,stroke:#7ea6e0,color:#dcebff',
    try:'fill:#1f2c33,stroke:#54c39b,color:#dff5ec',
    catch:'fill:#39231f,stroke:#e4645e,color:#ffdedc',
    ret:'fill:#1f3329,stroke:#54c39b,color:#dff5ec',
    err:'fill:#3a2320,stroke:#e4645e,color:#ffdedc',
    opaque:'fill:#332b1f,stroke:#f59e0b,color:#fef3c7,stroke-dasharray:5 3',
    flowctl:'fill:#2a2438,stroke:#a98fd6,color:#ece4ff',
    cte:'fill:#1c2f3f,stroke:#7ea6e0,color:#dcebff',
    src:'fill:#1b242c,stroke:#4c6274,color:#a9bccb',
    final:'fill:#3a2c15,stroke:#e8a33d,color:#ffeccc'
  };
  var byClass={};
  graph.nodes.forEach(function(n){ (byClass[n.cls]=byClass[n.cls]||[]).push(n.id); });
  Object.keys(byClass).forEach(function(c){
    if(!styles[c]) return;
    var safe='pf'+c.charAt(0).toUpperCase()+c.slice(1);   /* 'call', 'class', 'end' are reserved */
    L.push('  classDef '+safe+' '+styles[c]+',stroke-width:1px;');
    L.push('  class '+byClass[c].join(',')+' '+safe+';');
  });
  return L.join('\n');
}

/* ---------- draw.io export ---------- */
function xmlAttr(s){
  return String(s===undefined||s===null?'':s)
    .replace(/&/g,'&amp;')
    .replace(/"/g,'&quot;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/[\r\n]+/g,'&#xa;');
}

function layoutDrawio(graph, dir){
  var nodes=graph.nodes||[], edges=graph.edges||[], rank={}, byId={}, out={}, queue=[];
  nodes.forEach(function(n){ byId[n.id]=n; out[n.id]=[]; });
  edges.forEach(function(e){ if(out[e.from]&&byId[e.to]) out[e.from].push(e.to); });

  if(nodes.length){ rank[nodes[0].id]=0; queue.push(nodes[0].id); }
  while(queue.length){
    var id=queue.shift(), next=out[id]||[];
    next.forEach(function(to){
      if(rank[to]===undefined){ rank[to]=rank[id]+1; queue.push(to); }
    });
  }

  var maxRank=0;
  nodes.forEach(function(n){
    if(rank[n.id]===undefined) rank[n.id]=maxRank+1;
    maxRank=Math.max(maxRank,rank[n.id]);
  });
  var levels=[];
  nodes.forEach(function(n){ (levels[rank[n.id]]=levels[rank[n.id]]||[]).push(n); });

  var pos={}, topDown=dir!=='LR', rankGap=topDown?145:255, itemGap=topDown?220:115;
  levels.forEach(function(level,r){
    if(!level) return;
    var span=(level.length-1)*itemGap;
    level.forEach(function(n,i){
      var w=180, h=60;
      if(n.shape==='diamond'){ w=180; h=90; }
      else if(n.shape==='hex'){ w=180; h=70; }
      else if(n.shape==='round'){ w=150; h=58; }
      else if(n.shape==='marker'){ w=145; h=52; }
      var cross=i*itemGap-span/2;
      pos[n.id]=topDown
        ? {x:520+cross-w/2,y:45+r*rankGap,w:w,h:h}
        : {x:45+r*rankGap,y:420+cross-h/2,w:w,h:h};
    });
  });
  return pos;
}

function toDrawio(graph, opts){
  opts=opts||{};
  var pos=layoutDrawio(graph,opts.dir||'TD');
  var fills={
    start:['#e2e8f0','#64748b','#0f172a'], stmt:['#f8fafc','#64748b','#0f172a'],
    io:['#dbeafe','#3b82f6','#172554'], call:['#e0e7ff','#6366f1','#1e1b4b'],
    tran:['#dcfce7','#22c55e','#14532d'], cond:['#fef3c7','#d97706','#451a03'],
    loop:['#dbeafe','#3b82f6','#172554'], try:['#dcfce7','#16a34a','#14532d'],
    catch:['#fee2e2','#dc2626','#450a0a'], ret:['#dcfce7','#16a34a','#14532d'],
    err:['#fee2e2','#dc2626','#450a0a'], flowctl:['#f3e8ff','#9333ea','#3b0764'],
    opaque:['#fff7ed','#f59e0b','#451a03'],
    cte:['#dbeafe','#3b82f6','#172554'], src:['#f1f5f9','#64748b','#0f172a'],
    final:['#fef3c7','#d97706','#451a03']
  };
  function nodeStyle(n){
    var c=fills[n.cls]||fills.stmt;
    var s='whiteSpace=wrap;html=0;align=center;verticalAlign=middle;'+
      'fontFamily=IBM Plex Sans;fontSize=13;fillColor='+c[0]+';strokeColor='+c[1]+
      ';fontColor='+c[2]+';strokeWidth=1.5;';
    if(n.shape==='round') s+='ellipse;perimeter=ellipsePerimeter;';
    else if(n.shape==='diamond') s+='rhombus;perimeter=rhombusPerimeter;';
    else if(n.shape==='hex') s+='shape=hexagon;perimeter=hexagonPerimeter2;';
    else if(n.shape==='io'||n.cls==='io'||n.cls==='src') s+='shape=cylinder3;boundedLbl=1;backgroundOutline=1;';
    else if(n.shape==='call'||n.cls==='call') s+='shape=process;';
    else if(n.shape==='marker') s+='rounded=1;arcSize=20;dashed=1;';
    else s+='rounded=1;arcSize=8;';
    return s;
  }
  var title=opts.title||'Procflow';
  var L=['<?xml version="1.0" encoding="UTF-8"?>',
    '<mxfile host="app.diagrams.net" agent="Procflow">',
    '  <diagram id="procflow-page" name="'+xmlAttr(title)+'">',
    '    <mxGraphModel dx="1200" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">',
    '      <root>',
    '        <mxCell id="0"/>',
    '        <mxCell id="1" parent="0"/>'];
  graph.nodes.forEach(function(n){
    var p=pos[n.id]||{x:0,y:0,w:180,h:60};
    L.push('        <mxCell id="pf-'+xmlAttr(n.id)+'" value="'+xmlAttr(n.text).replace(/\u0001/g,'&#xa;')+
      '" style="'+xmlAttr(nodeStyle(n))+'" vertex="1" parent="1">');
    L.push('          <mxGeometry x="'+Math.round(p.x)+'" y="'+Math.round(p.y)+
      '" width="'+p.w+'" height="'+p.h+'" as="geometry"/>');
    L.push('        </mxCell>');
  });
  graph.edges.forEach(function(e,i){
    var style='edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;'+
      'html=0;endArrow=block;endFill=1;strokeColor=#64748b;fontColor=#334155;';
    if(e.style==='dotted') style+='dashed=1;';
    L.push('        <mxCell id="pf-e'+(i+1)+'" value="'+xmlAttr(e.label||'')+
      '" style="'+xmlAttr(style)+'" edge="1" parent="1" source="pf-'+xmlAttr(e.from)+
      '" target="pf-'+xmlAttr(e.to)+'">');
    L.push('          <mxGeometry relative="1" as="geometry"/>');
    L.push('        </mxCell>');
  });
  L.push('      </root>','    </mxGraphModel>','  </diagram>','</mxfile>');
  return L.join('\n');
}

/* ---------- shared object/dependency model ---------- */
function uniqueNames(list){
  var seen={}, out=[];
  (list||[]).forEach(function(v){
    if(!v) return;
    var key=v.toUpperCase();
    if(!seen[key]){ seen[key]=1; out.push(v); }
  });
  return out;
}

function statementFacts(toks, dynamic){
  toks=toks||[];
  var split=splitCTEs(toks), cteNames=split.ctes.map(function(c){return c.name.toUpperCase();});
  var work=split.ctes.length?toks.slice(split.finalStart):toks;
  var head=work[0]?work[0].u:'';
  var reads=refsIn(toks).refs.filter(function(r){return cteNames.indexOf(r.toUpperCase())<0;});
  var writes=[], calls=[];
  toks=work;
  var i=1;
  if(head==='INSERT'||head==='REPLACE'){
    while(toks[i]&&['INTO','OR','IGNORE','REPLACE'].indexOf(toks[i].u)>=0) i++;
    if(toks[i]) writes.push(qname(toks,i));
  } else if(head==='UPDATE'){
    if(toks[i]&&toks[i].u==='TOP'){
      i++; if(toks[i]&&toks[i].v==='('){ while(toks[i]&&toks[i].v!==')') i++; i++; }
      else i++;
    }
    if(toks[i]) writes.push(qname(toks,i));
  } else if(head==='DELETE'){
    if(toks[i]&&toks[i].u==='FROM') i++;
    if(toks[i]) writes.push(qname(toks,i));
  } else if(head==='MERGE'){
    if(toks[i]&&toks[i].u==='INTO') i++;
    if(toks[i]) writes.push(qname(toks,i));
  } else if(head==='TRUNCATE'){
    if(toks[i]&&toks[i].u==='TABLE') i++;
    if(toks[i]) writes.push(qname(toks,i));
  } else if(head==='SELECT'){
    var depth=0;
    for(var si=1;si<toks.length;si++){
      if(toks[si].v==='(') depth++;
      else if(toks[si].v===')') depth--;
      else if(depth===0&&toks[si].u==='INTO'&&toks[si+1]&&
              toks[si+1].v.charAt(0)!=='@'){
        writes.push(qname(toks,si+1)); break;
      }
    }
  } else if(head==='CREATE'&&toks[i]&&toks[i].u==='TABLE'&&toks[i+1]){
    writes.push(qname(toks,i+1));
  }
  if(['EXEC','EXECUTE','CALL','PERFORM'].indexOf(head)>=0&&!dynamic){
    if(toks[i]&&toks[i].v.charAt(0)==='@'&&toks[i+1]&&toks[i+1].v==='=') i+=2;
    if(toks[i]) calls.push(qname(toks,i));
  }
  var resultSet=head==='SELECT'&&!toks.some(function(t){ return t.u==='INTO'; });
  return {reads:uniqueNames(reads), writes:uniqueNames(writes), calls:uniqueNames(calls),
          resultSet:resultSet, dynamic:!!dynamic};
}

function walkAst(list, visit, depth){
  (list||[]).forEach(function(st){
    visit(st,depth||0);
    if(st.type==='block') walkAst(st.body,visit,(depth||0)+1);
    else if(st.type==='if'){
      if(st.then) walkAst([st.then],visit,(depth||0)+1);
      if(st.else) walkAst([st.else],visit,(depth||0)+1);
    } else if(st.type==='case'){
      st.branches.forEach(function(b){ walkAst(b.body,visit,(depth||0)+1); });
      walkAst(st.else,visit,(depth||0)+1);
    } else if(['while','for','loop','repeat'].indexOf(st.type)>=0&&st.body)
      walkAst([st.body],visit,(depth||0)+1);
    else if(st.type==='try'){
      walkAst(st.body,visit,(depth||0)+1);
      st.handlers.forEach(function(h){ walkAst(h.body,visit,(depth||0)+1); });
    } else if(st.type==='handler'&&st.body) walkAst([st.body],visit,(depth||0)+1);
  });
}

function buildObjectIR(result, unit){
  var statements=[], branches=[], reads=[], writes=[], calls=[], resultSets=[];
  walkAst(result.ast,function(st,depth){
    var condition=st.cond||st.head||st.sel||null;
    if(['if','case','while','for','loop','repeat'].indexOf(st.type)>=0){
      branches.push({type:st.type, depth:depth, span:spanOfTokens(condition)});
    }
    if(st.toks){
      var facts=statementFacts(st.toks,st.type==='dynamic');
      var item={type:st.type, text:joinToks(st.toks), span:spanOfTokens(st.toks),
                depth:depth, reads:facts.reads, writes:facts.writes,
                calls:facts.calls, resultSet:facts.resultSet, dynamic:facts.dynamic};
      statements.push(item);
      reads=reads.concat(facts.reads); writes=writes.concat(facts.writes);
      calls=calls.concat(facts.calls);
      if(facts.resultSet) resultSets.push({statement:statements.length-1,span:item.span});
    }
  },0);
  return {
    id:unit&&unit.id||'', name:result.header.name||(unit&&unit.name)||'Script',
    kind:(result.header.kind||unit&&unit.kind||'SCRIPT').replace(/^PROC$/,'PROCEDURE'),
    dialect:result.dialect, file:unit&&unit.file||'', source:unit&&unit.sql||'',
    span:{start:0,end:(unit&&unit.sql||'').length}, statements:statements,
    branches:branches, reads:uniqueNames(reads), writes:uniqueNames(writes),
    calls:uniqueNames(calls), resultSets:resultSets,
    diagnostics:result.diagnostics||[]
  };
}

function objectStartAt(toks, i){
  var t=toks[i], j=i;
  if(!t||['CREATE','ALTER','REPLACE'].indexOf(t.u)<0) return null;
  j++;
  if(t.u==='CREATE'&&toks[j]&&toks[j].u==='OR'&&toks[j+1]&&
     ['ALTER','REPLACE'].indexOf(toks[j+1].u)>=0) j+=2;
  while(toks[j]&&['TEMP','TEMPORARY','MATERIALIZED','UNIQUE','CLUSTERED'].indexOf(toks[j].u)>=0) j++;
  if(!toks[j]||OBJ_KINDS.indexOf(toks[j].u)<0) return null;
  return {token:i, kind:toks[j].u, pos:t.pos};
}

function splitSqlObjects(sql, fileName){
  sql=String(sql||'');
  var toks=tokenize(sql), starts=[];
  for(var i=0;i<toks.length;i++){
    var found=objectStartAt(toks,i);
    if(found){ starts.push(found); i=found.token; }
  }
  if(!starts.length) return [{id:'',file:fileName||'Pasted SQL',kind:'SCRIPT',
                              name:fileName||'Script',start:0,end:sql.length,sql:sql}];
  return starts.map(function(s,index){
    var start=index===0?0:s.pos, end=index+1<starts.length?starts[index+1].pos:sql.length;
    return {id:'',file:fileName||'Pasted SQL',kind:s.kind,name:'',start:start,end:end,
            sql:sql.slice(start,end)};
  });
}

function dependencyGraph(objects){
  var nodes=[], edges=[], ids={}, ext={}, seq=0;
  function add(text,cls,source,objectId){
    var id='d'+(++seq);
    nodes.push({id:id,shape:cls==='src'?'io':'rect',text:text,cls:cls,
                source:source||null,objectId:objectId||null});
    return id;
  }
  objects.forEach(function(o){
    var cls=o.kind==='VIEW'?'cte':(o.kind==='SCRIPT'?'final':'call');
    ids[o.name.toUpperCase()]=add(o.name+'\u0001'+o.kind,cls,o.span,o.id);
  });
  function target(name,type){
    var known=ids[name.toUpperCase()];
    if(known) return known;
    var key=type+':'+name.toUpperCase();
    if(!ext[key]) ext[key]=add(name,type==='call'?'call':'src',null,null);
    return ext[key];
  }
  objects.forEach(function(o){
    var from=ids[o.name.toUpperCase()];
    [{items:o.reads,label:'reads',type:'read'},
     {items:o.writes,label:'writes',type:'write'},
     {items:o.calls,label:'calls',type:'call'}].forEach(function(group){
      group.items.forEach(function(name){
        edges.push({from:from,to:target(name,group.type),label:group.label,
                    style:group.type==='write'?'dotted':'solid'});
      });
    });
  });
  return {nodes:nodes,edges:edges,stats:{
    objects:objects.length,
    reads:objects.reduce(function(n,o){return n+o.reads.length;},0),
    writes:objects.reduce(function(n,o){return n+o.writes.length;},0),
    calls:objects.reduce(function(n,o){return n+o.calls.length;},0),
    external:Object.keys(ext).length
  }};
}

function analyseEstate(files, opts){
  opts=opts||{};
  var units=[];
  (files||[]).forEach(function(file){
    units=units.concat(splitSqlObjects(file.text,file.name));
  });
  var objects=units.map(function(unit,index){
    unit.id='object-'+(index+1);
    var result=analyse(unit.sql,opts);
    unit.name=result.header.name||unit.name||('Script '+(index+1));
    var ir=buildObjectIR(result,unit);
    ir.result=result;
    return ir;
  });
  var graph=dependencyGraph(objects);
  return {objects:objects,graph:graph,stats:graph.stats,
          diagnostics:objects.reduce(function(a,o){return a.concat(o.diagnostics);},[])};
}

function narrationPrompt(mermaid, sql, dialect){
  var src=String(sql||'');
  var cut=40000;
  if(src.length>cut) src=src.slice(0,cut)+'\n-- […truncated for length…]';
  return [
'Task: rewrite the labels on a flowchart that has already been verified against its source SQL.',
'',
'A heuristic parser extracted the code below and produced the diagram marked STRUCTURE.',
'Keep that structure unchanged while rewriting labels, but do not claim that it is compiler-verified.',
'Unsupported or dynamic SQL may be represented as opaque steps.',
'',
'Rules:',
'1. Keep every node id, every edge, every arrow style and every node shape exactly as given.',
'   Do not add, delete, merge, split or reorder anything.',
'2. Replace only the text inside each node\'s quotes with a short plain-English description of what',
'   that step does, in the language of the business rather than the language of SQL. Under 12 words.',
'3. Phrase decision nodes as questions. Leave edge labels (yes / no / loop / error) unchanged.',
'   If a label already starts with a step number such as "7. ", keep that prefix exactly.',
'4. Do not put double quotes, pipe characters or angle brackets inside a label.',
'5. Return the complete Mermaid diagram and nothing else.',
'',
'STRUCTURE (heuristic — do not alter):',
'```mermaid',
mermaid,
'```',
'',
'SOURCE ('+(DIALECT_NAMES[dialect]||dialect)+', for meaning only):',
'```sql',
src,
'```'
  ].join('\n');
}

function analyse(sql, opts){
  opts=opts||{};
  var det=detectDialect(sql);
  var dialect = (opts.dialect&&opts.dialect!=='auto') ? opts.dialect : det.dialect;
  var toks=tokenize(sql||'');
  var header=findBody(toks, dialect, sql);
  var bodyToks;
  if(header.inner!==undefined){
    bodyToks=tokenize(header.inner);
    bodyToks.forEach(function(t){ t.pos+=header.innerOffset||0; t.end+=header.innerOffset||0; });
  }
  else bodyToks=toks.slice(header.index<0?0:header.index);
  var p=P(bodyToks, dialect);
  var ast=parseBlock(p,[]);
  while(ast.length===1&&ast[0].type==='block') ast=ast[0].body;
  var diagnostics=[];
  if((!opts.dialect||opts.dialect==='auto')&&!det.confident){
    diagnostics.push({severity:'warning',code:'dialect_low_confidence',
      message:'Dialect detection is uncertain; select the dialect manually if the diagram looks wrong.',
      span:{start:0,end:Math.min(String(sql||'').length,1)}});
  }
  walkAst(ast,function(st){
    if(st.type==='dynamic') diagnostics.push({severity:'warning',code:'dynamic_sql',
      message:'Dynamic SQL is opaque and its internal reads, writes, calls, and branches are not resolved.',
      span:spanOfTokens(st.toks)});
  },0);
  var gopts={detail:opts.detail, group:opts.group, dialect:dialect, sources:opts.sources,
             fanIn:opts.fanIn, number:opts.number};
  var graph=buildGraph(ast, header, gopts);
  var mode=opts.mode||'auto';
  var flat = graph.stats.branch+graph.stats.loop+graph.stats.cat===0;
  var single = ast.length===1&&ast[0].type==='stmt';
  var q=null;
  if(single&&(mode==='query'||(mode==='auto'&&flat))){
    q=buildQueryGraph(ast[0].toks, header, gopts);
    if(q.empty||q.nodes.length<2) q=null;
  }
  var selected=q||graph, selectedMode=q?'query':'flow';
  return {dialect:dialect, detected:det, confidence:Math.min(1,(det.score||0)/7),
          diagnostics:diagnostics, header:header, ast:ast, mode:selectedMode,
          graph:selected, stats:selected.stats,
          mermaid:toMermaid(selected, opts.dir||'TD')};
}
/* ===== CORE END ===== */

