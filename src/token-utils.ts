/* sql-cartographer v2.7.0 — shared token and AST helpers.
   Pure, side-effect-free utilities used across graph construction, column
   lineage, and export: token joining/spans, identifier quoting, statement
   summarisation, Mermaid label escaping, AST traversal, and name dedup.

   This module deliberately has no dependency on ir.ts (or on any analysis
   module). Extracting it breaks the previous ir <-> columns/lineage/columnflow/
   exporters cycle, so each of those can be read and tested on its own. It
   depends only on the tokenizer/dialect layer (for CONT_M) and the ambient
   types in types.d.ts. Load it after dialects.ts and before any consumer. */
/* ---------- label helpers ---------- */
function joinToks(toks: Token[], max?: number): string {
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
function spanOfTokens(toks?: Token[] | null): SourceSpan | null {
  if(!toks||!toks.length) return null;
  return {start:toks[0].pos, end:toks[toks.length-1].end};
}
function clip(s: string, max: number): string { return s.length>max ? s.slice(0,max-1).trim()+'…' : s; }
function qname(toks: Token[], i: number): string {
  if(!toks[i]) return '';
  var s=toks[i].v, k=i+1;
  while(toks[k]&&toks[k].v==='.'&&toks[k+1]){ s+='.'+toks[k+1].v; k+=2; }
  return s;
}

function summarise(toks: Token[], max: number): string {
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
    var cursor=-1;
    for(var c=2;c<toks.length;c++) if(u(c)==='CURSOR'){ cursor=c; break; }
    if(cursor>=0) out='DECLARE CURSOR '+v(1);
    var vars=[];
    for(var j=1;j<toks.length&&vars.length<4;j++)
      if(toks[j].v.charAt(0)==='@'&&(j===1||toks[j-1].v===',')) vars.push(toks[j].v);
    if(!out&&vars.length) out='DECLARE '+vars.join(', ')+(vars.length>3?' …':'');
  } else if(head==='RAISE'||head==='SIGNAL'||head==='RESIGNAL'||head==='RAISERROR'){
    out=clip(joinToks(toks,max),max);
  } else if(head==='GRANT'||head==='REVOKE'||head==='DENY'){
    var onIx=-1, gd0=0;
    for(var gg=0;gg<toks.length;gg++){
      if(toks[gg].v==='(') gd0++;
      else if(toks[gg].v===')') gd0--;
      else if(gd0===0&&toks[gg].u==='ON'){ onIx=gg; break; }
    }
    if(onIx>0) out=head+' … ON '+v(onIx+1);
    else out=clip(joinToks(toks,max),max);
  } else if(head==='WAITFOR'){
    out='WAITFOR '+clip(joinToks(toks.slice(1),max-8),max);
  } else if(head==='KILL'){
    out='KILL '+v(1);
  } else if(head==='OPEN'||head==='CLOSE'||head==='DEALLOCATE'||head==='ALLOCATE'){
    out=head+' '+v(1);
  } else if(head==='FETCH'){
    var fx=-1;
    for(var ff=1;ff<toks.length;ff++) if(toks[ff].u==='FROM'){ fx=ff; break; }
    out = fx>0 ? ('FETCH FROM '+v(fx+1)) : clip(joinToks(toks,max),max);
  }
  if(!out) out=joinToks(toks, max);
  return clip(out, max);
}

function escLabel(s: unknown): string {
  return String(s)
    .replace(/#/g,'#35;')
    .replace(/&/g,'#amp;')
    .replace(/"/g,'#quot;')
    .replace(/</g,'#lt;')
    .replace(/>/g,'#gt;')
    .replace(/\|/g,'#124;')
    .replace(/%%/g,'#37;#37;')
    .replace(/[\r\n]+/g,' ')
    /* biome-ignore lint/suspicious/noControlCharactersInRegex: \u0001 is an internal line-break sentinel, not user input */
    .replace(/\u0001/g,'<BR>')
    .replace(/\s+/g,' ');
}

function uniqueNames(list: string[]): string[] {
  var seen: StringSet={}, out: string[]=[];
  (list||[]).forEach(function(v){
    if(!v) return;
    var key=v.toUpperCase();
    if(!seen[key]){ seen[key]=1; out.push(v); }
  });
  return out;
}

function walkAst(list: any, visit: (statement: AstNode, depth: number) => void, depth?: number): void {
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

/* ---------- shared graph-filter primitives ----------
   The dependency and report filters both narrow a graph to matching nodes plus
   their one-hop neighbours, then return a fresh shallow-cloned graph. Keeping
   the two steps here means the neighbour rule and the no-mutation guarantee
   cannot drift between the two views. */

/* Narrow a keep-set to the nodes matching `focus` (by text or object id) plus
   their immediate neighbours. Returns null when the focus matches nothing, so
   the caller can present an explicit empty state. */
function graphNarrowByFocus(graph: Graph, keep: Record<string, 1|undefined>,
                            focus: string): Record<string, 1|undefined> | null {
  var needle=String(focus||'').trim().toUpperCase();
  if(!needle) return keep;
  var matched: Record<string, 1|undefined>={}, neighbour: Record<string, 1|undefined>={};
  (graph.nodes||[]).forEach(function(n){
    if(keep[n.id]&&(String(n.text||'').toUpperCase().indexOf(needle)>=0||
       String(n.objectId||'').toUpperCase().indexOf(needle)>=0))
      matched[n.id]=1;
  });
  if(!Object.keys(matched).length) return null;
  (graph.edges||[]).forEach(function(e){
    if(matched[e.from]) neighbour[e.to]=1;
    if(matched[e.to]) neighbour[e.from]=1;
  });
  var narrowed: Record<string, 1|undefined>={};
  (graph.nodes||[]).forEach(function(n){
    if(keep[n.id]&&(matched[n.id]||neighbour[n.id])) narrowed[n.id]=1;
  });
  return narrowed;
}

/* Return a fresh graph containing only the kept nodes and the edges that pass
   `edgePass` and have both endpoints kept. Nodes and edges are shallow-cloned
   so a caller can never mutate the shared analysis graph. Stats are carried
   unchanged: a filter changes only what is drawn, never what is analysed. */
function graphFilteredClone(graph: Graph, keep: Record<string, 1|undefined>,
                            edgePass?: (edge: GraphEdge) => boolean): Graph {
  var nodes=(graph.nodes||[]).filter(function(n){
    return keep[n.id]===1;
  }).map(function(n){
    var c: any={};
    for(var k in n) c[k]=n[k];
    return c;
  });
  var edges=(graph.edges||[]).filter(function(e){
    if(keep[e.from]!==1||keep[e.to]!==1) return false;
    return edgePass?edgePass(e):true;
  }).map(function(e){
    var c: any={};
    for(var k in e) c[k]=e[k];
    return c;
  });
  return {nodes:nodes, edges:edges, stats:graph.stats};
}

