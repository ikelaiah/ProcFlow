/* proc>flow: column lineage pipelines (v1.11.0)
   Column-flow edges through CTEs, views, temporary tables, transformations,
   and catalogue-resolved object boundaries; the exported column-flow graph with
   its own documented layout class; column-resolution signals surfaced as
   construct coverage and region-scoped diagnostics.

   The engine walks an object's statements in source order and tracks the
   column-level reaching definition of each column-carrying object (temp table,
   local view, or catalogue-resolved external object). A producer statement
   (SELECT … INTO, INSERT … SELECT, CREATE TABLE, CREATE VIEW) defines an
   object's columns and traces each produced column end-to-end to its original
   source object; a consumer statement binds its outputs back through an
   object's known columns. The reaching-definition semantics mirror the
   v1.5.0 flow graph: sequential writes replace the reaching definition, and a
   conditional write (branch merge / loop body / handler) marks the object
   ambiguous (`multi`), so its consumers stay opaque without ever inventing an
   edge (`column_flow_opaque` diagnostics, region-scoped).

   Interactive column views are deferred to v1.13.0; this module produces the
   model (ColumnFlow), its export graph (buildColumnGraph), and the E signals
   wired into construct coverage by src/ir.ts. */

interface CFShared {
  steps: ColumnFlowStep[];
  edges: ColumnFlowEdge[];
  diagnostics: Diagnostic[];
  catalogue: Catalogue | null;
  dialect?: Dialect;
  seq: number;
  opaqueCount: number;
  defs: Record<string, string>;   /* object key -> defining step id */
  viewName: string | null;        /* headered object is a view (seed its outputs) */
  viewExtra: Token[] | null;      /* the view body tokens, when headered */
}

interface CFCtxNode {
  objects: Record<string, ColumnFlowObject>;
  writeLog: string[];
  seen: CFShared;
}

function cfCloneObjects(src: Record<string, ColumnFlowObject>):
    Record<string, ColumnFlowObject> {
  var out: Record<string, ColumnFlowObject>={};
  Object.keys(src||{}).forEach(function(k){
    var o=src[k];
    out[k]={name:o.name, multi:o.multi, span:o.span||null,
            columns:(o.columns||[]).map(function(c){
              return {name:c.name, span:c.span||null, resolution:c.resolution,
                      source:c.source||null, sourceColumn:c.sourceColumn||null,
                      sourceSpan:c.sourceSpan||null, reason:c.reason};
            })};
  });
  return out;
}

function cfNorm(name: string): string {
  return String(name||'').toUpperCase();
}

/* Resolve the reaching-definition object an object name refers to. */
function cfLookupObject(ctx: CFCtxNode, name: string): ColumnFlowObject | null {
  var n=cfNorm(name);
  if(ctx.objects[n]) return ctx.objects[n];
  /* the name may be a synonym/catalogue canonical for a seeded object */
  return null;
}

function cfObjectByRawName(ctx: CFCtxNode, name: string): ColumnFlowObject | null {
  var direct=cfLookupObject(ctx,name);
  if(direct) return direct;
  if(!ctx.seen.catalogue) return null;
  var res=resolveCatalogue(ctx.seen.catalogue,name);
  if(res.resolution!=='verified'||!res.resolvedName) return null;
  return ctx.objects[cfNorm(res.resolvedName)]||null;
}

function cfFindColumn(cols: ColumnFlowOutput[], col: string): ColumnFlowOutput | null {
  var cu=cfNorm(col);
  for(var i=0;i<cols.length;i++)
    if(cfNorm(cols[i].name)===cu) return cols[i];
  return null;
}

/* Catalogue column evidence, seeded lazily so external object boundaries can
   be resolved by the catalogue without inventing columns. */
function cfSeedCatalogueObject(ctx: CFCtxNode, name: string): ColumnFlowObject | null {
  var cat=ctx.seen.catalogue;
  if(!cat||!cat.columns) return null;
  var cols=catalogueColumnsFor(cat,name);
  if(!cols.length) return null;
  var canonical=name;
  var res=resolveCatalogue(cat,name);
  if(res.resolution==='verified'&&res.resolvedName) canonical=res.resolvedName;
  var out: ColumnFlowObject={name:canonical, multi:false, span:null,
    columns:cols.map(function(c){
      return {name:c, span:null, resolution:'exact' as ColumnResolution,
              source:canonical, sourceColumn:c, sourceSpan:null};})};
  ctx.objects[cfNorm(canonical)]=out;
  return out;
}

/* Flatten a column reference through a tracked object to its ultimate origin.
   An ambiguous reaching definition or an unknown produced column yields an
   opaque result with a region-scoped diagnostic. */
function cfTraceAgainstObject(O: ColumnFlowObject, col: string, span: SourceSpan | null,
    ctx: CFCtxNode): {resolution: ColumnResolution; source: string | null;
      sourceColumn: string | null; sourceSpan: SourceSpan | null} {
  if(!O||O.multi){
    ctx.seen.diagnostics.push({severity:'warning', code:'column_flow_opaque',
      message:'Column reference "'+col+'" reads '+(O?('"'+O.name+'"'):'an object')+
        ' whose reaching definition is ambiguous (conditional write or branch merge); the binding is left opaque.',
      span:span||null, scope:'region' as DiagnosticScope});
    return {resolution:'opaque', source:null, sourceColumn:null, sourceSpan:null};
  }
  var def=cfFindColumn(O.columns,col);
  if(!def){
    ctx.seen.diagnostics.push({severity:'warning', code:'column_flow_opaque',
      message:'Column "'+col+'" is not produced by any known definition of "'+O.name+
        '"; its binding across statements is opaque.',
      span:span||null, scope:'region' as DiagnosticScope});
    return {resolution:'opaque', source:null, sourceColumn:null, sourceSpan:null};
  }
  if(def.resolution!=='exact'||!def.source||!def.sourceColumn){
    return {resolution:def.resolution, source:null, sourceColumn:null, sourceSpan:null};
  }
  return {resolution:'exact', source:def.source, sourceColumn:def.sourceColumn,
          sourceSpan:def.sourceSpan||def.span||null};
}

/* Map a statement ColumnSource reference to an ultimate origin. */
function cfTraceSource(cs: ColumnSource, col: string, span: SourceSpan | null,
    ctx: CFCtxNode): {resolution: ColumnResolution; source: string | null;
      sourceColumn: string | null; sourceSpan: SourceSpan | null} {
  if(!cs) return {resolution:'opaque', source:null, sourceColumn:null, sourceSpan:null};
  var O=cfObjectByRawName(ctx,cs.name);
  if(O) return cfTraceAgainstObject(O,col,span,ctx);
  /* untracked cte/table: exact provenance at reference level */
  return {resolution:'exact', source:cs.name, sourceColumn:col, sourceSpan:span};
}

function cfOutputOrigin(o: ColumnOutput, lin: ColumnLineage, ctx: CFCtxNode):
    ColumnFlowOutput {
  if(o.resolution!=='exact'||!o.bindings.length){
    return {name:o.name, span:o.span||null, resolution:o.resolution,
            source:null, sourceColumn:null, sourceSpan:null, reason:o.reason};
  }
  var cs=cfSourceByKey(lin,o.bindings[0].source);
  var origin=cfTraceSource(cs,o.bindings[0].column,o.bindings[0].span,ctx);
  return {name:o.name, span:o.span||null, resolution:origin.resolution,
          source:origin.source, sourceColumn:origin.sourceColumn,
          sourceSpan:origin.sourceSpan};
}

function cfSourceByKey(lin: ColumnLineage, key: string): ColumnSource | null {
  var k=cfNorm(key);
  for(var i=0;i<lin.sources.length;i++)
    if(cfNorm(lin.sources[i].key)===k) return lin.sources[i];
  return null;
}

/* Define an object from produced column outputs. */
function cfDefineObject(ctx: CFCtxNode, stepId: string, name: string,
    columns: ColumnFlowOutput[], span: SourceSpan | null): void {
  var key=cfNorm(name);
  ctx.objects[key]={name:name, multi:false, span:span, columns:columns};
  ctx.seen.defs[key]=stepId;
  ctx.writeLog.push(key);
}

/* Record a consume edge from an object's reaching definition producer, if one
   exists, and drive the end-to-end pipeline edges. */
function cfRecordConsume(ctx: CFCtxNode, stepId: string, O: ColumnFlowObject,
    names: Array<{col: string; span: SourceSpan | null; resolution: ColumnResolution}>,
    span: SourceSpan | null): void {
  var key=cfNorm(O.name);
  var defStep=ctx.seen.defs[key];
  var anyOpaque=names.some(function(n){return n.resolution==='opaque';});
  if(defStep&&defStep!==stepId){
    ctx.seen.edges.push({fromStep:defStep, toStep:stepId, object:O.name,
      columns:names.map(function(n){return {name:n.col, resolution:n.resolution,
        span:n.span||null};}),
      resolution:anyOpaque?'opaque':'exact'});
  }
}

/* Record a step's consumption from a tracked/catalogue object and resolve the
   common consume resolution. Returns whether every name resolved exactly. */
function cfConsumeObject(ctx: CFCtxNode, stepId: string, O: ColumnFlowObject,
    names: Array<{col: string; span: SourceSpan | null}>, span: SourceSpan | null,
    step: ColumnFlowStep): void {
  if(!names.length) return;
  var resolved=names.map(function(n){
    var tr=cfTraceAgainstObject(O,n.col,n.span,ctx);
    return {col:n.col, span:n.span||null, resolution:tr.resolution};
  });
  var anyOpaque=resolved.some(function(r){return r.resolution!=='exact';});
  step.consumes.push({object:O.name, names:resolved.map(function(r){return r.col;}),
                      resolution:anyOpaque?'opaque':'exact', span:span});
  cfRecordConsume(ctx,stepId,O,resolved,span);
  if(anyOpaque) ctx.seen.opaqueCount++;
}

/* Group a statement's bindings to one object, dropping bindings to columns the
   object's known definition does not produce _only when_ other bindings do
   produce known columns (a T-SQL `col = expr` alias target is such a false
   candidate). When no binding matches, all are kept so the genuinely unknown
   reference stays opaque with a region diagnostic and never invents an edge. */
function cfConsumeGroup(ctx: CFCtxNode, stepId: string, O: ColumnFlowObject,
    triples: Array<{col: string; span: SourceSpan | null}>, span: SourceSpan | null,
    step: ColumnFlowStep): void {
  var hasCols=(O.columns||[]).length>0;
  var unknown: Array<{col: string; span: SourceSpan | null}>=[];
  triples.forEach(function(t){
    if(hasCols&&!cfFindColumn(O.columns,t.col)) unknown.push(t);
  });
  var kept=hasCols&&unknown.length&&unknown.length<triples.length
    ? triples.filter(function(t){ return !!cfFindColumn(O.columns,t.col); })
    : triples;
  cfConsumeObject(ctx,stepId,O,kept,span,step);
}

/* ---------- statement handlers ---------- */

function cfSelect(st: StatementNode, step: ColumnFlowStep, ctx: CFCtxNode): void {
  var toks=st.toks||[], span=spanOfTokens(toks);
  var facts=statementFacts(toks,false);
  var lin=analyseColumns(toks,{catalogue:ctx.seen.catalogue, dialect:ctx.seen.dialect});
  if(!lin){ step.resolution='opaque'; step.opaque=true; ctx.seen.opaqueCount++; return; }

  /* consumes: outputs that read tracked or catalogue-proven objects */
  var consumed: Record<string, Array<{col: string; span: SourceSpan | null}>>={};
  lin.outputs.forEach(function(o){
    o.bindings.forEach(function(b){
      var cs=cfSourceByKey(lin,b.source);
      if(!cs) return;
      var O=cfObjectByRawName(ctx,cs.name)||cfSeedCatalogueObject(ctx,cs.name);
      if(!O) return;
      var key=cfNorm(O.name);
      consumed[key]=consumed[key]||[];
      consumed[key].push({col:b.column, span:b.span||null});
    });
  });
  Object.keys(consumed).forEach(function(key){
    var O=ctx.objects[key];
    if(O) cfConsumeGroup(ctx,step.id,O,consumed[key],span,step);
  });

  /* produces: SELECT ... INTO target */
  facts.writes.forEach(function(writeName){
    if(!writeName||writeName.charAt(0)==='@') return;
    var cols=lin.outputs.map(function(o){return cfOutputOrigin(o,lin,ctx);});
    var res='exact' as ColumnResolution;
    cols.forEach(function(c){ if(c.resolution!=='exact') res='opaque'; });
    if(res==='opaque') step.resolution='opaque';
    step.produces.push({object:writeName, columns:cols, multi:false});
    cfDefineObject(ctx,step.id,writeName,cols,span);
  });
}

function cfInsert(st: StatementNode, step: ColumnFlowStep, ctx: CFCtxNode): void {
  var toks=st.toks||[], span=spanOfTokens(toks);
  var facts=statementFacts(toks,false);
  var target=facts.writes[0];
  if(!target){ step.resolution='opaque'; step.opaque=true; ctx.seen.opaqueCount++; return; }
  var selIx=-1, d=0;
  for(var i=1;i<toks.length;i++){
    if(toks[i].v==='(') d++;
    else if(toks[i].v===')') d--;
    else if(d===0&&toks[i].u==='SELECT'){ selIx=i; break; }
  }
  if(selIx<0){
    /* INSERT ... VALUES: schema unknown unless the object is already defined. */
    var O=cfLookupObject(ctx,target);
    if(O&&!O.multi){
      step.produces.push({object:O.name, columns:O.columns.slice(), multi:false});
    } else {
      ctx.seen.diagnostics.push({severity:'warning', code:'column_flow_opaque',
        message:'INSERT into "'+target+'" has no resolvable column source in this version; its columns are opaque.',
        span:span, scope:'region'});
      var op: ColumnFlowOutput[]=[];
      var colsList=cfInsertColumnList(toks,facts);
      if(colsList&&colsList.length){
        op=colsList.map(function(c){return {name:c, span:null, resolution:'opaque' as ColumnResolution,
          source:null, sourceColumn:null, sourceSpan:null};});
      }
      step.produces.push({object:target, columns:op, multi:true});
      cfDefineObject(ctx,step.id,target,op,span);
      step.resolution='opaque'; ctx.seen.opaqueCount++;
    }
    return;
  }
  var lin=analyseColumns(toks.slice(selIx),
    {catalogue:ctx.seen.catalogue, dialect:ctx.seen.dialect});
  var outputs=lin?lin.outputs:[];
  var cols=outputs.map(function(o){return cfOutputOrigin(o,lin!,ctx);});
  var list=cfInsertColumnList(toks,facts);
  if(list&&list.length){
    var renamed: ColumnFlowOutput[]=[];
    for(var k=0;k<list.length;k++){
      var src=cols[k];
      renamed.push(src?{name:list[k], span:spanOfTokens(toks), resolution:src.resolution,
        source:src.source, sourceColumn:src.sourceColumn, sourceSpan:src.sourceSpan}
        :{name:list[k], span:spanOfTokens(toks), resolution:'opaque' as ColumnResolution,
          source:null, sourceColumn:null, sourceSpan:null});
    }
    cols=renamed;
  } else {
    /* no explicit column list: an INSERT into an already-defined schema maps
       the select outputs to the table's columns positionally */
    var exists=cfLookupObject(ctx,target);
    if(exists&&!exists.multi&&exists.columns.length&&exists.columns.length===cols.length){
      cols=cols.map(function(c,i){
        return {name:exists!.columns[i].name, span:spanOfTokens(toks),
                resolution:c.resolution, source:c.source,
                sourceColumn:c.sourceColumn, sourceSpan:c.sourceSpan,
                reason:c.reason};
      });
    }
  }
  if(!lin){ step.resolution='opaque'; step.opaque=true; ctx.seen.opaqueCount++; }
  step.produces.push({object:target, columns:cols, multi:false});
  cfDefineObject(ctx,step.id,target,cols,span);
}

function cfInsertColumnList(toks: Token[], facts: any): string[] | null {
  var i=toks[0].u==='INSERT'?1:1;
  while(toks[i]&&['INTO','OR','IGNORE','REPLACE'].indexOf(toks[i].u)>=0) i++;
  /* skip the write target (possibly qualified) to reach an explicit column list */
  while(toks[i]&&toks[i].type==='word'){
    if(toks[i+1]&&toks[i+1].v==='.'&&toks[i+2]&&toks[i+2].type==='word'){ i+=2; continue; }
    i++; break;
  }
  if(toks[i]&&toks[i].v==='('){
    var out: string[]=[];
    i++;
    while(i<toks.length){
      var t=toks[i];
      if(t.v===')') break;
      if(t.type==='word'&&cfNorm(t.v)!==',')out.push(t.v);
      i++;
    }
    return out;
  }
  return null;
}

function cfUpdate(st: StatementNode, step: ColumnFlowStep, ctx: CFCtxNode): void {
  var toks=st.toks||[], span=spanOfTokens(toks);
  var facts=statementFacts(toks,false);
  var target=facts.writes[0];
  if(!target){ return; }
  var O=cfLookupObject(ctx,target);
  if(!O||O.multi){
    step.resolution='opaque'; step.opaque=true; ctx.seen.opaqueCount++;
    return;
  }
  var sets=cfParseUpdateSets(toks);
  var src: ColumnSource={key:O.name, name:O.name, alias:null, kind:'table',
    columns:O.columns.map(function(c){return c.name;}),
    columnsKnown:O.columns.length>0, span:span};
  var reads: Array<{col: string; span: SourceSpan | null}>=[];
  sets.forEach(function(s){
    if(!s||!s.col) return;
    var scan=colScanRefs(s.expr||[], [src], []);
    var bound=scan.bound.filter(function(b){return b.source;});
    if(bound.length===1&&bound[0].name){
      reads.push({col:bound[0].name, span:bound[0].span||null});
      var origin=cfTraceAgainstObject(O,bound[0].name,bound[0].span||null,ctx);
      O.columns.forEach(function(c){
        if(cfNorm(c.name)===cfNorm(s.col!)){
          c.resolution=origin.resolution;
          c.source=origin.source; c.sourceColumn=origin.sourceColumn;
          c.sourceSpan=origin.sourceSpan||c.sourceSpan;
        }
      });
    }
  });
  /* read-modify-write: the update consumes its own object first */
  if(reads.length) cfConsumeGroup(ctx,step.id,O,reads,span,step);
  step.produces.push({object:O.name, columns:O.columns.slice(), multi:false});
  cfDefineObject(ctx,step.id,O.name,O.columns.slice(),span);
}

function cfParseUpdateSets(toks: Token[]):
    Array<{col: string | null; expr: Token[]} | null> {
  var d=0, si=-1;
  for(var i=0;i<toks.length;i++){
    if(toks[i].v==='(') d++;
    else if(toks[i].v===')') d--;
    else if(d===0&&toks[i].u==='SET'){ si=i; break; }
  }
  if(si<0) return [];
  var out: Array<{col: string | null; expr: Token[]} | null>=[], cur: Token[]=[],
      col: string | null=null, dd=0;
  var j=si+1;
  while(j<toks.length){
    var t=toks[j];
    if(t.v==='(') dd++;
    else if(t.v===')') dd--;
    if(dd===0&&(t.u==='FROM'||t.u==='WHERE'||t.u==='RETURNING')) break;
    if(t.v===','&&dd===0){
      out.push({col:col, expr:cur});
      cur=[]; col=null; j++; continue;
    }
    if(t.v==='='&&dd===0){
      col=cur.length&&cur[cur.length-1].type==='word'?cur[cur.length-1].v:null;
      cur=[];
      /* drop alias/keyword (e.g. SET x = …, SET @v = …) */
      if(cur.length&&cur[cur.length-1].v==='=') cur.pop();
      j++; continue;
    }
    cur.push(t);
    j++;
  }
  out.push({col:col, expr:cur});
  return out;
}

function cfCreate(st: StatementNode, step: ColumnFlowStep, ctx: CFCtxNode): void {
  var toks=st.toks||[], span=spanOfTokens(toks);
  var i=1;
  if(toks[i]&&toks[i].u==='OR'&&toks[i+1]&&
     ['ALTER','REPLACE'].indexOf(toks[i+1].u)>=0) i+=2;
  while(toks[i]&&['TEMP','TEMPORARY','MATERIALIZED','UNIQUE','CLUSTERED','LOCAL','GLOBAL'].
        indexOf(toks[i].u)>=0) i++;
  var kind=toks[i]?toks[i].u:'';
  if(kind==='TABLE'){
    var name=qname(toks,i+1);
    if(!name){ return; }
    var cols=cfTableColumnNames(toks,i+2);
    var defs: ColumnFlowOutput[]=cols.map(function(c){
      return {name:c, span:span, resolution:'exact' as ColumnResolution,
              source:null, sourceColumn:null, sourceSpan:null};});
    step.produces.push({object:name, columns:defs, multi:false});
    cfDefineObject(ctx,step.id,name,defs,span);
    return;
  }
  if(kind==='VIEW'){
    var vname=qname(toks,i+1);
    var asIx=-1, d=0;
    for(var k=i+1;k<toks.length;k++){
      if(toks[k].v==='(') d++;
      else if(toks[k].v===')') d--;
      else if(d===0&&toks[k].u==='AS'&&toks[k+1]&&toks[k+1].u==='SELECT'){ asIx=k; break; }
    }
    if(vname&&asIx>=0){
      var lin=analyseColumns(toks.slice(asIx+1),
        {catalogue:ctx.seen.catalogue, dialect:ctx.seen.dialect});
      var defs2=lin?lin.outputs.map(function(o){return cfOutputOrigin(o,lin!,ctx);}):[];
      step.produces.push({object:vname, columns:defs2, multi:false});
      if(lin) cfDefineObject(ctx,step.id,vname,defs2,span);
    }
    return;
  }
}

function cfTableColumnNames(toks: Token[], start: number): string[] {
  var i=start;
  while(toks[i]&&toks[i].v!=='(') i++;
  if(!toks[i]) return [];
  var out: string[]=[], dd=0, pending=true;
  i++;
  while(i<toks.length){
    var t=toks[i];
    if(t.v==='(') dd++;
    else if(t.v===')'){ if(dd===0) break; dd--; }
    if(pending&&t.type==='word'&&t.v!==','){
      out.push(t.v); pending=false;
    }
    if(t.v===','&&dd===0) pending=true;
    i++;
    if(t.v===')') break;
  }
  return out;
}

function cfMerge(st: StatementNode, step: ColumnFlowStep, ctx: CFCtxNode): void {
  /* MERGE INTO target USING source — column structure of the target is
     unchanged; the source is consumed but its column mapping is opaque here. */
  var facts=statementFacts(st.toks||[],false);
  var target=facts.writes[0];
  var O=target?cfLookupObject(ctx,target):null;
  if(O&&!O.multi){
    step.produces.push({object:O.name, columns:O.columns.slice(), multi:false});
  } else if(target){
    step.resolution='opaque'; step.opaque=true; ctx.seen.opaqueCount++;
  }
}

function cfStmt(st: any, ctx: CFCtxNode): void {
  var toks=st.toks||[];
  var span=spanOfTokens(toks);
  ctx.seen.seq++;
  var step: ColumnFlowStep={id:'s'+ctx.seen.seq, text:'', span:span,
    produces:[], consumes:[], resolution:'exact'};
  ctx.seen.steps.push(step);
  if(!toks.length){ step.opaque=true; step.resolution='opaque'; return; }
  step.text=String(summarise(toks,52)||'…');
  if(st.type==='dynamic'||st.type==='unknown'){
    step.opaque=true; step.resolution='opaque'; ctx.seen.opaqueCount++; return;
  }
  var head=toks[0].u;
  if(head==='WITH'||head==='SELECT'){ cfSelect(st,step,ctx); return; }
  if(head==='INSERT'||head==='REPLACE'){ cfInsert(st,step,ctx); return; }
  if(head==='UPDATE'){ cfUpdate(st,step,ctx); return; }
  if(head==='CREATE'){ cfCreate(st,step,ctx); return; }
  if(head==='MERGE'){ cfMerge(st,step,ctx); return; }
}

/* ---------- branch/loop/handler merge semantics (mirror v1.5.0 flow) ---------- */

function cfMergeConstruct(ctx: CFCtxNode, forks: CFCtxNode[]): void {
  var written: string[]=[];
  forks.forEach(function(f){
    f.writeLog.forEach(function(k){
      if(written.indexOf(k)<0) written.push(k);
    });
  });
  written.forEach(function(k){
    var rep: ColumnFlowObject | null=null;
    forks.forEach(function(f){ if(f.objects[k]&&!rep) rep=f.objects[k]; });
    var cols=(rep?rep.columns:[]).map(function(c){
      return {name:c.name, span:null, resolution:'opaque' as ColumnResolution,
              source:null, sourceColumn:null, sourceSpan:null};});
    ctx.objects[k]={name:(rep&&rep.name)||k, multi:true, span:(rep&&rep.span)||null,
                    columns:cols};
  });
  written.forEach(function(k){ ctx.writeLog.push(k); });
}

function cfIf(st: IfNode, ctx: CFCtxNode): void {
  var tFork: CFCtxNode={objects:cfCloneObjects(ctx.objects), writeLog:[], seen:ctx.seen};
  var eFork: CFCtxNode={objects:cfCloneObjects(ctx.objects), writeLog:[], seen:ctx.seen};
  if(st.then) cfRun([st.then],tFork);
  if(st.else) cfRun([st.else],eFork);
  cfMergeConstruct(ctx,[tFork,eFork]);
}

function cfCase(st: CaseNode, ctx: CFCtxNode): void {
  var forks: CFCtxNode[]=[];
  st.branches.forEach(function(b){
    var fork: CFCtxNode={objects:cfCloneObjects(ctx.objects), writeLog:[], seen:ctx.seen};
    cfRun(b.body,fork);
    forks.push(fork);
  });
  if(st.else&&st.else.length){
    var ef: CFCtxNode={objects:cfCloneObjects(ctx.objects), writeLog:[], seen:ctx.seen};
    cfRun(st.else,ef);
    forks.push(ef);
  }
  if(forks.length) cfMergeConstruct(ctx,forks);
}

function cfLoop(st: LoopNode, ctx: CFCtxNode): void {
  if(!st.body) return;
  var fork: CFCtxNode={objects:cfCloneObjects(ctx.objects), writeLog:[], seen:ctx.seen};
  cfRun([st.body],fork);
  fork.writeLog.forEach(function(k){
    var rep=fork.objects[k];
    ctx.objects[k]={name:(rep&&rep.name)||k, multi:true, span:(rep&&rep.span)||null,
                    columns:[]};
  });
  fork.writeLog.forEach(function(k){ ctx.writeLog.push(k); });
}

function cfTry(st: TryNode, ctx: CFCtxNode): void {
  var forks: CFCtxNode[]=[];
  var bf: CFCtxNode={objects:cfCloneObjects(ctx.objects), writeLog:[], seen:ctx.seen};
  cfRun(st.body,bf);
  forks.push(bf);
  st.handlers.forEach(function(h){
    var hf: CFCtxNode={objects:cfCloneObjects(ctx.objects), writeLog:[], seen:ctx.seen};
    cfRun(h.body||[],hf);
    forks.push(hf);
  });
  cfMergeConstruct(ctx,forks);
}

function cfHandler(st: Db2HandlerNode, ctx: CFCtxNode): void {
  if(!st.body) return;
  var fork: CFCtxNode={objects:cfCloneObjects(ctx.objects), writeLog:[], seen:ctx.seen};
  cfRun([st.body],fork);
  fork.writeLog.forEach(function(k){
    ctx.objects[k]={name:k, multi:true, span:null, columns:[]};
  });
}

function cfRun(list: AstNode[], ctx: CFCtxNode): void {
  (list||[]).forEach(function(st: any){
    if(st.type==='block'){ cfRun(st.body,ctx); return; }
    if(st.type==='stmt'){ cfStmt(st,ctx); return; }
    if(st.type==='dynamic'||st.type==='unknown'){ cfStmt(st,ctx); return; }
    if(st.type==='if'){ cfIf(st,ctx); return; }
    if(st.type==='case'){ cfCase(st,ctx); return; }
    if(['while','for','loop','repeat'].indexOf(st.type)>=0){ cfLoop(st,ctx); return; }
    if(st.type==='try'){ cfTry(st,ctx); return; }
    if(st.type==='handler'){ cfHandler(st,ctx); return; }
  });
}

/* After the walk, if the whole object is a view, seed its output columns so
   estate can resolve same-script consumers by definition. */
function cfSeedViewResult(ctx: CFCtxNode, spanOfObject: SourceSpan | null): void {
  var vn=ctx.seen.viewName;
  if(!vn) return;
  if(ctx.objects[cfNorm(vn)]) return;
  var leaf: ColumnFlowStep | null=null;
  for(var i=ctx.seen.steps.length-1;i>=0;i--){
    var s=ctx.seen.steps[i];
    if(s.opaque) continue;
    if(s.produces.length) break;
    leaf=s; break;
  }
  if(!leaf) return;
  var source=ctx.seen.viewExtra;
  if(!source||!source.length) return;
  var lin=analyseColumns(source,{catalogue:ctx.seen.catalogue, dialect:ctx.seen.dialect});
  if(!lin) return;
  var cols=lin.outputs.map(function(o){return cfOutputOrigin(o,lin,ctx);});
  ctx.objects[cfNorm(vn)]={name:vn, multi:false, span:spanOfObject, columns:cols};
  ctx.seen.defs[cfNorm(vn)]=leaf.id;
}

/* ---------- public API ---------- */

function analyseColumnFlow(ast: AstNode[],
    opts?: {catalogue?: Catalogue | null; dialect?: Dialect; sql?: string;
            define?: Record<string, ColumnFlowObject>; viewName?: string | null;
            viewKind?: string | null; viewBodyTokens?: Token[] | null}): ColumnFlow | null {
  opts=opts||{};
  var seen: CFShared={steps:[], edges:[], diagnostics:[],
    catalogue:opts.catalogue||null, dialect:opts.dialect, seq:0, opaqueCount:0,
    defs:{}, viewName:(opts.viewKind==='VIEW'?(opts.viewName||null):null), viewExtra:opts.viewBodyTokens||null};
  var objects: Record<string, ColumnFlowObject>={};
  if(opts.define){
    Object.keys(opts.define).forEach(function(k){
      var o=opts.define![k];
      if(!o) return;
      objects[cfNorm(o.name)]={name:o.name, multi:o.multi, span:o.span||null,
        columns:(o.columns||[]).map(function(c){
          return {name:c.name, span:c.span||null, resolution:c.resolution,
                  source:c.source||null, sourceColumn:c.sourceColumn||null,
                  sourceSpan:c.sourceSpan||null, reason:c.reason};})};
    });
  }
  var ctx: CFCtxNode={objects:objects, writeLog:[], seen:seen};
  try{
    cfRun(ast,ctx);
    if(seen.viewName) cfSeedViewResult(ctx,spanOfObjectTokens(ast));
  }catch(err){
    /* column flow is best-effort metadata; never break the analysis */
    seen.diagnostics.push({severity:'warning', code:'column_flow_opaque',
      message:'Column-flow analysis failed for part of this object and was left opaque.',
      span:null, scope:'document'});
  }
  if(!seen.steps.length) return null;
  var objectKeys=Object.keys(ctx.objects);
  var objectsResolved=0, objectsOpaque=0;
  objectKeys.forEach(function(k){
    var o=ctx.objects[k];
    var clean=!o.multi&&o.columns.every(function(c){return c.resolution==='exact';});
    if(clean) objectsResolved++; else objectsOpaque++;
  });
  var edgesResolved=0, edgesOpaque=0;
  seen.edges.forEach(function(e){ if(e.resolution==='exact') edgesResolved++; else edgesOpaque++; });
  return {
    steps:seen.steps, edges:seen.edges, objects:ctx.objects,
    opaqueCount:seen.opaqueCount, diagnostics:seen.diagnostics,
    stats:{objects:objectKeys.length, objectsResolved:objectsResolved,
           objectsOpaque:objectsOpaque, edges:seen.edges.length,
           edgesResolved:edgesResolved, edgesOpaque:edgesOpaque}
  };
}

function spanOfObjectTokens(ast: AstNode[]): SourceSpan | null {
  var lo=Infinity, hi=-1;
  walkAst(ast,function(st){
    if(!('toks' in st)||!st.toks) return;
    var s=spanOfTokens(st.toks);
    if(s){ lo=Math.min(lo,s.start); hi=Math.max(hi,s.end); }
  },0);
  return isFinite(lo)?{start:lo,end:hi}:null;
}

/* ---------- export graph (own documented layout class) ---------- */

function buildColumnGraph(cf: ColumnFlow): Graph {
  var nodes: GraphNode[]=[], edges: GraphEdge[]=[];
  var objIds: Record<string, string>={};
  var objSeq=0;
  cf.steps.forEach(function(s){
    nodes.push({id:s.id, shape:'rect', text:s.text, cls:s.opaque?'opaque':'colstep',
                source:s.span||null, provenance:s.span?'source':'synthetic',
                reason:s.opaque?'statement outside column analysis':undefined});
  });
  Object.keys(cf.objects).forEach(function(k){
    var o=cf.objects[k];
    if(o.name.charAt(0)==='#') objIds[k]='cobj'+(++objSeq);
    else objIds[k]='cobj'+(++objSeq);
    nodes.push({id:objIds[k], shape:'io', text:o.name, cls:'colobj', source:o.span||null,
                provenance:o.span?'source':'synthetic',
                reason:o.multi?'ambiguous reaching definition (no unique producer)':undefined});
  });
  for(var i=1;i<cf.steps.length;i++){
    edges.push({from:cf.steps[i-1].id, to:cf.steps[i].id, label:'',
                style:'solid', kind:'control'});
  }
  cf.steps.forEach(function(s){
    s.produces.forEach(function(p){
      var oid=objIds[cfNorm(p.object)];
      if(!oid) return;
      var label=p.columns.slice(0,6).map(function(c){return c.name;}).join(', ');
      edges.push({from:s.id, to:oid, label:label, style:'solid', kind:'data'});
    });
    s.consumes.forEach(function(c){
      var oid=objIds[cfNorm(c.object)];
      if(!oid) return;
      var label=(c.names||[]).slice(0,6).join(', ');
      edges.push({from:oid, to:s.id, label:label, style:'solid', kind:'data'});
    });
  });
  return {nodes:nodes, edges:edges, stats:{
    steps:cf.steps.length, objects:Object.keys(cf.objects).length,
    columnEdges:edges.filter(function(e){return e.kind==='data';}).length,
    opaque:cf.opaqueCount
  }};
}
