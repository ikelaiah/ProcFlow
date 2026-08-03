(function(){
  var results: Array<{name: string; pass: boolean; detail: unknown}>=[];
  function record(name: string, pass: unknown, detail?: unknown): void {
    results.push({name:name,pass:!!pass,detail:pass?'':detail});
  }
  function has(list: string[], value: string): boolean {
    return (list||[]).some(function(v){ return v.toUpperCase()===value.toUpperCase(); });
  }

  PROCFLOW_FIXTURES.forEach(function(f){
    try{
      var r=analyse(f.sql,{dialect:f.dialect,mode:'auto',group:false,sources:true});
      var ir=buildObjectIR(r,{id:'fixture',name:f.name,kind:r.header.kind,
                              file:f.name,sql:f.sql});
      var e=f.expect, ok=e.mode===undefined||r.mode===e.mode;
      if(e.branch!==undefined) ok=ok&&r.stats.branch===e.branch;
      if(e.loop!==undefined) ok=ok&&r.stats.loop===e.loop;
      if(e.cat!==undefined) ok=ok&&r.stats.cat===e.cat;
      if(e.exit!==undefined) ok=ok&&r.stats.exit===e.exit;
      if(e.opaque!==undefined) ok=ok&&r.stats.opaque===e.opaque;
      if(e.ctes!==undefined) ok=ok&&r.stats.ctes===e.ctes;
      if(e.tables!==undefined) ok=ok&&r.stats.tables===e.tables;
      if(e.call) ok=ok&&has(ir.calls,e.call);
      if(e.write) ok=ok&&has(ir.writes,e.write);
      if(e.write2) ok=ok&&has(ir.writes,e.write2);
      if(e.read) ok=ok&&has(ir.reads,e.read);
      if(e.read2) ok=ok&&has(ir.reads,e.read2);
      if(e.object) ok=ok&&ir.name.toUpperCase()===e.object.toUpperCase();
      if(e.resultSets!==undefined) ok=ok&&ir.resultSets.length===e.resultSets;
      if(e.diagnostic) ok=ok&&r.diagnostics.some(function(d){return d.code===e.diagnostic;});
      if(e.noErrors) ok=ok&&!r.diagnostics.some(function(d){return d.severity==='error';});
      if(e.coverageMin!==undefined) ok=ok&&r.coverage>=e.coverageMin;
      var sourced=r.graph.nodes.filter(function(n){return n.source;});
      ok=ok&&sourced.every(function(n){
        return n.source.start>=0&&n.source.end>n.source.start&&n.source.end<=f.sql.length;
      });
      record(f.name,ok,JSON.stringify({stats:r.stats,diagnostics:r.diagnostics,ir:ir}));
    }catch(err){ record(f.name,false,String(err&&err.stack||err)); }
  });

  function matchingNode(graph: Graph, text: string, occurrence?: number): GraphNode | null {
    var matches=graph.nodes.filter(function(node){return node.text.indexOf(text)>=0;});
    if(occurrence!==undefined) return matches[occurrence-1]||null;
    return matches.length===1?matches[0]:null;
  }
  function matchingWire(graph: Graph, expected: ExpectedGraphWire): boolean {
    var from=matchingNode(graph,expected.fromText,expected.fromOccurrence);
    var to=matchingNode(graph,expected.toText,expected.toOccurrence);
    if(!from||!to) return false;
    return graph.edges.some(function(edge){
      return edge.from===from.id&&edge.to===to.id&&
        (expected.label===undefined||edge.label===expected.label)&&
        (expected.style===undefined||edge.style===expected.style);
    });
  }

  PROCFLOW_GRAPH_FIXTURES.forEach(function(fixture){
    try{
      var result=analyse(fixture.sql,
        {dialect:fixture.dialect,mode:'flow',group:false,sources:true,fanIn:true});
      var missing=fixture.graphExpect.required.filter(function(wire){
        return !matchingWire(result.graph,wire);
      });
      var unexpected=fixture.graphExpect.forbidden.filter(function(wire){
        return matchingWire(result.graph,wire);
      });
      var unsourced=(fixture.graphExpect.sourced||[]).filter(function(expected){
        var text=typeof expected==='string'?expected:expected.text;
        var occurrence=typeof expected==='string'?undefined:expected.occurrence;
        var node=matchingNode(result.graph,text,occurrence);
        return !node||!node.source||node.source.start<0||
          node.source.end<=node.source.start||node.source.end>fixture.sql.length;
      });
      record(fixture.name+' · graph edges',
        missing.length===0&&unexpected.length===0&&unsourced.length===0,
        JSON.stringify({missing:missing,unexpected:unexpected,
                        unsourced:unsourced,graph:result.graph}));
    }catch(err){
      record(fixture.name+' · graph edges',false,String(err&&err.stack||err));
    }
  });

  record('T-SQL fixture corpus has at least 50 cases',
    (window.PROCFLOW_TSQL_FIXTURE_COUNT||0)>=50,
    'Found '+(window.PROCFLOW_TSQL_FIXTURE_COUNT||0)+' T-SQL fixtures.');

  try{
    var multiQuery=[
      'CREATE PROCEDURE dbo.query_modes AS',
      'BEGIN',
      '  IF EXISTS (SELECT 1 FROM dbo.Account)',
      '    INSERT INTO dbo.AuditLog(AccountId)',
      '      SELECT AccountId FROM dbo.Account;',
      '  ELSE',
      '    SELECT AccountId FROM dbo.ArchivedAccount;',
      'END'
    ].join('\n');
    var flowMode=analyse(multiQuery,
      {dialect:'tsql',mode:'flow',group:false,sources:true});
    var queryMode=analyse(multiQuery,
      {dialect:'tsql',mode:'query',group:false,sources:true});
    var sources=queryMode.graph.nodes.filter(function(n){return n.cls==='src';})
      .map(function(n){return n.text;});
    var modesDiffer=flowMode.mode==='flow'&&queryMode.mode==='query'&&
      flowMode.mermaid!==queryMode.mermaid&&
      flowMode.graph.nodes.some(function(n){return n.cls==='cond';})&&
      !queryMode.graph.nodes.some(function(n){return n.cls==='cond';})&&
      has(sources,'dbo.Account')&&has(sources,'dbo.ArchivedAccount');
    record('Control flow and query structure are distinct for procedures',
      modesDiffer,JSON.stringify({flow:flowMode.graph,query:queryMode.graph}));
  }catch(err){
    record('Control flow and query structure are distinct for procedures',
      false,String(err&&err.stack||err));
  }

  try{
    var noQuery=analyse('CREATE PROCEDURE dbo.assign_only AS BEGIN SET NOCOUNT ON; END',
      {dialect:'tsql',mode:'query',group:false,sources:true});
    record('Explicit query mode does not silently fall back to control flow',
      noQuery.mode==='query'&&noQuery.graph.nodes.length===1&&
        /No query-bearing/.test(noQuery.graph.nodes[0].text),
      JSON.stringify(noQuery.graph));
  }catch(err){
    record('Explicit query mode does not silently fall back to control flow',
      false,String(err&&err.stack||err));
  }

  try{
    var sqliteRaiseTrigger=[
      'CREATE TRIGGER reject_negative BEFORE UPDATE ON item',
      'BEGIN',
      "  SELECT RAISE(ABORT, 'quantity must be positive') WHERE NEW.quantity < 0;",
      '  UPDATE item SET checked = 1 WHERE id = NEW.id;',
      'END;'
    ].join('\n');
    var sqliteAuto=analyse(sqliteRaiseTrigger,
      {dialect:'auto',mode:'flow',group:false,sources:true,fanIn:true});
    var raiseNode=matchingNode(sqliteAuto.graph,'RAISE ABORT');
    var updateNode=matchingNode(sqliteAuto.graph,'UPDATE item');
    var conditionNode=matchingNode(sqliteAuto.graph,'NEW.quantity < 0');
    var correctRaiseFlow=!!raiseNode&&!!updateNode&&!!conditionNode&&
      sqliteAuto.graph.edges.some(function(edge){
        return edge.from===conditionNode.id&&edge.to===raiseNode.id&&edge.label==='yes';
      })&&sqliteAuto.graph.edges.some(function(edge){
        return edge.from===conditionNode.id&&edge.to===updateNode.id&&edge.label==='no';
      })&&!sqliteAuto.graph.edges.some(function(edge){
        return edge.from===raiseNode.id&&edge.to===updateNode.id;
      });
    record('SQLite RAISE trigger auto-detection preserves terminal flow',
      sqliteAuto.dialect==='sqlite'&&sqliteAuto.detected.confident&&correctRaiseFlow,
      JSON.stringify({detected:sqliteAuto.detected,graph:sqliteAuto.graph}));
  }catch(err){
    record('SQLite RAISE trigger auto-detection preserves terminal flow',
      false,String(err&&err.stack||err));
  }

  [
    {name:'unclosed parenthesis diagnostic',sql:'SELECT (1;',code:'unclosed_parenthesis'},
    {name:'unterminated string diagnostic',sql:"SELECT 'value;",code:'unterminated_string'},
    {name:'unterminated comment diagnostic',sql:'SELECT 1; /* open',code:'unterminated_comment'},
    {name:'missing END diagnostic',sql:'CREATE PROC dbo.bad AS BEGIN SELECT 1;',code:'missing_end'},
    {name:'unconsumed input diagnostic',sql:'END SELECT 1;',code:'unconsumed_input',
     coverageBelow:1,unknownNode:true}
  ].forEach(function(c){
    try{
      var r=analyse(c.sql,{dialect:'tsql',mode:'auto',group:false,sources:true});
      var ok=r.diagnostics.some(function(d){return d.code===c.code;});
      if(c.coverageBelow!==undefined) ok=ok&&r.coverage<c.coverageBelow;
      if(c.unknownNode) ok=ok&&r.graph.nodes.some(function(node){
        return node.cls==='opaque'&&/^Unresolved SQL/.test(node.text);
      });
      record(c.name,ok,JSON.stringify({coverage:r.coverage,diagnostics:r.diagnostics}));
    }catch(err){ record(c.name,false,String(err&&err.stack||err)); }
  });

  try{
    var estate=analyseEstate([PROCFLOW_ESTATE_FIXTURE],
      {dialect:'tsql',mode:'auto',group:false,sources:true});
    var proc=estate.objects.filter(function(o){return /refresh_export/i.test(o.name);})[0];
    var ok=estate.objects.length===2&&proc&&
      has(proc.calls,'dbo.audit_refresh')&&has(proc.writes,'dbo.student')&&
      has(proc.reads,'dbo.student_export')&&estate.graph.nodes.length>=4;
    record('Multi-object estate and dependencies',ok,JSON.stringify(estate.stats));
  }catch(err){ record('Multi-object estate and dependencies',false,String(err&&err.stack||err)); }

  try{
    var alterSource='CREATE OR ALTER PROCEDURE dbo.pasted_once AS BEGIN SELECT 1; END';
    var replaceSource='CREATE OR REPLACE FUNCTION public.pasted_once() RETURNS integer '+
      'LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END; $$;';
    var alterEstate=analyseEstate([{name:'Pasted SQL',text:alterSource}],
      {dialect:'tsql',mode:'auto',group:false,sources:true});
    var replaceEstate=analyseEstate([{name:'Pasted SQL',text:replaceSource}],
      {dialect:'plpgsql',mode:'auto',group:false,sources:true});
    record('CREATE OR ALTER/REPLACE remains one clean pasted object',
      alterEstate.objects.length===1&&alterEstate.objects[0].source===alterSource&&
      replaceEstate.objects.length===1&&replaceEstate.objects[0].source===replaceSource,
      JSON.stringify({alter:alterEstate.objects.map(function(o){return o.source;}),
                      replace:replaceEstate.objects.map(function(o){return o.source;})}));
  }catch(err){
    record('CREATE OR ALTER/REPLACE remains one clean pasted object',
      false,String(err&&err.stack||err));
  }

  try{
    var escaped=analyse('SELECT \'<tag>&"\' value FROM dbo.source;',
      {dialect:'tsql',mode:'auto',group:false,sources:true});
    var xml=toDrawio(escaped.graph,{title:'A&B',dir:'TD'});
    var doc=new DOMParser().parseFromString(xml,'application/xml');
    record('draw.io XML remains well formed',!doc.querySelector('parsererror'),
           doc.querySelector('parsererror')&&doc.querySelector('parsererror').textContent);
  }catch(err){ record('draw.io XML remains well formed',false,String(err&&err.stack||err)); }

  /* v1.1.0: semantic edge kinds, node provenance, token attribution, construct coverage. */
  try{
    var semantic=analyse('CREATE PROC dbo.semantic AS BEGIN\n'+
      '  BEGIN TRY\n'+
      '    UPDATE dbo.Work SET Status = 1;\n'+
      "    THROW 50001, 'stop', 1;\n"+
      '  END TRY\n'+
      '  BEGIN CATCH\n'+
      '    INSERT INTO dbo.ErrorLog(ErrorNumber) VALUES (ERROR_NUMBER());\n'+
      '  END CATCH;\n'+
      'END',
      {dialect:'tsql',mode:'flow',group:false,sources:true,fanIn:true});
    var allEdgesHaveKind=semantic.graph.edges.every(function(e){return !!e.kind;});
    var allNodesHaveProvenance=semantic.graph.nodes.every(function(n){return !!n.provenance;});
    var hasExceptionEdge=semantic.graph.edges.some(function(e){return e.kind==='exception';});
    var hasControlEdge=semantic.graph.edges.some(function(e){return e.kind==='control';});
    var hasDataEdge=semantic.graph.edges.some(function(e){return e.kind==='data';});
    var hasAttribution=!!semantic.attribution&&semantic.attribution.total>0;
    var hasConstructCoverage=!!semantic.constructCoverage&&semantic.constructCoverage.constructs>0;
    record('v1.1.0 semantic edge kinds and node provenance',
      allEdgesHaveKind&&allNodesHaveProvenance&&hasExceptionEdge&&hasControlEdge&&hasDataEdge,
      JSON.stringify({edges:semantic.graph.edges.map(function(e){return e.kind;}),
                      nodes:semantic.graph.nodes.map(function(n){return n.provenance;})}));
    record('v1.1.0 token attribution and construct coverage',
      hasAttribution&&hasConstructCoverage,
      JSON.stringify({attribution:semantic.attribution,constructCoverage:semantic.constructCoverage}));
  }catch(err){
    record('v1.1.0 semantic edge kinds and node provenance',false,String(err&&err.stack||err));
    record('v1.1.0 token attribution and construct coverage',false,String(err&&err.stack||err));
  }

  try{
    var structured=analyse('SELECT id FROM dbo.student s JOIN dbo.school sc ON sc.id=s.school_id;',
      {dialect:'tsql',mode:'query',group:false,sources:true});
    var info=refsIn((structured.ast[0] as StatementNode).toks);
    var hasStructuredRefs=!!info.structuredRefs&&info.structuredRefs.length>=2;
    var refsHaveSpans=hasStructuredRefs&&info.structuredRefs.every(function(r){
      return !!r.span&&r.span.start>=0&&r.span.end>r.span.start;
    });
    var refsHaveRoles=hasStructuredRefs&&info.structuredRefs.every(function(r){
      return r.role==='read'&&(r.resolution==='exact'||r.resolution==='heuristic');
    });
    record('v1.1.0 structured query references with spans and roles',
      hasStructuredRefs&&refsHaveSpans&&refsHaveRoles,
      JSON.stringify(info.structuredRefs));
  }catch(err){
    record('v1.1.0 structured query references with spans and roles',
      false,String(err&&err.stack||err));
  }

  try{
    var provenance=analyse('CREATE PROC dbo.provenance AS BEGIN\n'+
      '  SELECT 1;\n'+
      '  EXEC dbo.child;\n'+
      'END',
      {dialect:'tsql',mode:'flow',group:false,sources:true});
    var mermaid=toMermaid(provenance.graph,'TD');
    var hasProvenanceComment=/%% proc>flow provenance/.test(mermaid);
    var drawio=toDrawio(provenance.graph,{title:'provenance',dir:'TD'});
    var hasDrawioMeta=/data-procflow=/.test(drawio);
    var hasDrawioKind=/data-procflow-kind=/.test(drawio);
    record('v1.1.0 export provenance metadata (Mermaid + draw.io)',
      hasProvenanceComment&&hasDrawioMeta&&hasDrawioKind,
      JSON.stringify({mermaidHasComment:hasProvenanceComment,
                      drawioHasMeta:hasDrawioMeta,drawioHasKind:hasDrawioKind}));
  }catch(err){
    record('v1.1.0 export provenance metadata (Mermaid + draw.io)',
      false,String(err&&err.stack||err));
  }

  try{
    var scoped=analyse('SELECT 1; /* open',{dialect:'tsql',mode:'auto',group:false,sources:true});
    var regionScoped=scoped.diagnostics.filter(function(d){return d.scope==='region';});
    var documentScoped=scoped.diagnostics.filter(function(d){return d.scope==='document';});
    var allScoped=scoped.diagnostics.every(function(d){return d.scope==='region'||d.scope==='document';});
    record('v1.1.0 diagnostics carry document/region scope',
      allScoped&&regionScoped.length>0,
      JSON.stringify(scoped.diagnostics.map(function(d){return {code:d.code,scope:d.scope};})));
  }catch(err){
    record('v1.1.0 diagnostics carry document/region scope',
      false,String(err&&err.stack||err));
  }

  var passed=results.filter(function(r){return r.pass;}).length;
  document.body.className=passed===results.length?'pass':'fail';
  document.getElementById('summary').textContent=passed+'/'+results.length+' tests passed';
  document.getElementById('results').textContent=JSON.stringify(results,null,2);
})();
