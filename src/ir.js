/* proc>flow: graph construction and shared intermediate representation */
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

function analyse(sql, opts){
  opts=opts||{};
  sql=String(sql||'');
  var det=detectDialect(sql);
  var dialect = (opts.dialect&&opts.dialect!=='auto') ? opts.dialect : det.dialect;
  var toks=tokenize(sql);
  var diagnostics=(toks.diagnostics||[]).slice();
  var header=findBody(toks, dialect, sql);
  var bodyToks;
  if(header.inner!==undefined){
    bodyToks=tokenize(header.inner);
    var innerOffset=header.innerOffset||0;
    bodyToks.forEach(function(t){ t.pos+=innerOffset; t.end+=innerOffset; });
    (bodyToks.diagnostics||[]).forEach(function(d){
      var shifted={severity:d.severity,code:d.code,message:d.message,span:d.span};
      if(d.span) shifted.span={start:d.span.start+innerOffset,end:d.span.end+innerOffset};
      diagnostics.push(shifted);
    });
  }
  else bodyToks=toks.slice(header.index<0?0:header.index);
  var p=P(bodyToks, dialect);
  var ast=parseBlock(p,[]);
  while(ast.length===1&&ast[0].type==='block') ast=ast[0].body;
  diagnostics=diagnostics.concat(p.diagnostics||[]);
  var remaining=bodyToks.slice(p.i).filter(function(t){return t.v!==';';});
  if(remaining.length){
    diagnostics.push({severity:'error',code:'unconsumed_input',
      message:'Parser stopped before '+remaining.length+' token'+(remaining.length===1?' was':'s were')+
        ' consumed. The diagram may be incomplete.',
      span:{start:remaining[0].pos,end:remaining[remaining.length-1].end}});
  }
  var totalTokens=bodyToks.length, consumedTokens=Math.min(p.i,totalTokens);
  var coverage=totalTokens?consumedTokens/totalTokens:1;
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
  if(mode==='query'){
    q=buildObjectQueryGraph(ast, header, gopts);
  } else if(single&&mode==='auto'&&flat){
    q=buildQueryGraph(ast[0].toks, header, gopts);
    if(q.empty||q.nodes.length<2) q=null;
  }
  var selected=q||graph, selectedMode=q?'query':'flow';
  var dialectConfidence=(opts.dialect&&opts.dialect!=='auto')?1:Math.min(1,(det.score||0)/7);
  var hasErrors=diagnostics.some(function(d){return d.severity==='error';});
  var confidence=Math.max(0,Math.min(1,dialectConfidence*coverage*(hasErrors?0.55:1)));
  return {dialect:dialect, detected:det, confidence:confidence,
          dialectConfidence:dialectConfidence, coverage:coverage,
          consumedTokens:consumedTokens,totalTokens:totalTokens,
          diagnostics:diagnostics, header:header, ast:ast, mode:selectedMode,
          graph:selected, stats:selected.stats,
          mermaid:toMermaid(selected, opts.dir||'TD')};
}
