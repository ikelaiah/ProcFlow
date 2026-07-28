/* proc>flow: query and CTE lineage */
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

