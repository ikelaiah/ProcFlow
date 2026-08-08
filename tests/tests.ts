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
        (expected.style===undefined||edge.style===expected.style)&&
        (expected.kind===undefined||edge.kind===expected.kind);
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

  PROCFLOW_RANGE_FIXTURES.forEach(function(rangeFixture){
    try{
      var rangeResult=analyse(rangeFixture.sql,
        {dialect:rangeFixture.dialect,mode:'auto',group:false,sources:true});
      var rangeSpans: Array<{start:number; end:number; text: string}>=[],
          rangeWalkDepth=0;
      function walkRange(list: any): void {
        (list||[]).forEach(function(st){
          if(st.type==='stmt'&&st.toks&&st.toks.length){
            var fs=st.toks[0], fe=st.toks[st.toks.length-1];
            rangeSpans.push({start:fs.pos,end:fe.end,
                             text:rangeFixture.sql.slice(fs.pos,fe.end)});
          } else if(st.type==='block') walkRange(st.body);
          else if(st.type==='if'){
            if(st.then) walkRange([st.then]); if(st.else) walkRange([st.else]);
          } else if(st.type==='case'){
            st.branches.forEach(function(b){ walkRange(b.body); });
            if(st.else) walkRange(st.else);
          } else if(['while','for','loop','repeat'].indexOf(st.type)>=0&&st.body)
            walkRange([st.body]);
          else if(st.type==='try'){
            walkRange(st.body);
            st.handlers.forEach(function(h){ walkRange(h.body); });
          } else if(st.type==='handler'&&st.body) walkRange([st.body]);
        });
      }
      walkRange(rangeResult.ast);
      var rangeTexts=rangeSpans.map(function(s){return s.text;});
      var sameRanges=rangeTexts.length===rangeFixture.statements.length&&
        rangeTexts.every(function(t,i){return t===rangeFixture.statements[i];});
      var rangesInBounds=rangeSpans.every(function(s){
        return s.start>=0&&s.end>s.start&&s.end<=rangeFixture.sql.length;
      });
      var rangeDiag=!rangeFixture.diagnostic||
        rangeResult.diagnostics.some(function(d){return d.code===rangeFixture.diagnostic;});
      record(rangeFixture.name+' · statement ranges',
        sameRanges&&rangesInBounds&&rangeDiag,
        JSON.stringify({expected:rangeFixture.statements,actual:rangeTexts,
                        stats:rangeResult.stats}));
    }catch(err){
      record(rangeFixture.name+' · statement ranges',false,String(err&&err.stack||err));
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

  /* v1.1.0: semantic edge kinds, node provenance, token attribution, construct coverage.
     v1.5.0 accuracy correction: sequential control edges leaving io nodes were
     previously classified as semantic 'data' edges; 'data' is now reserved for
     explicit producer→consumer temp-table edges and dependency-graph writes,
     so this fixture stages through #work to assert a genuine data edge. */
  try{
    var semantic=analyse('CREATE PROC dbo.semantic AS BEGIN\n'+
      '  SELECT id INTO #work FROM dbo.Queue;\n'+
      '  BEGIN TRY\n'+
      '    UPDATE #work SET Status = 1;\n'+
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

  /* v1.2.0: statement boundaries are grammar-driven; semicolons authoritative. */
  try{
    var nt=tokenize('SELECT 1_000, 0x1F, 0x1_000, 1., .5, 1.5, dbo.t;');
    var numForms=[{v:'1_000',t:'num'},{v:'0x1F',t:'num'},{v:'0x1_000',t:'num'},
      {v:'1.',t:'num'},{v:'.5',t:'num'},{v:'1.5',t:'num'}];
    var numberLexing=numForms.every(function(exp){
      return nt.some(function(t){return t.v===exp.v&&t.type===exp.t;});
    });
    var dottedName=nt.some(function(t){return t.v==='dbo'&&t.type==='word';})&&
      nt.some(function(t){return t.v==='t'&&t.type==='word';});
    record('v1.2.0 number lexing (0x, separators, 1., .5)',
      numberLexing&&dottedName,
      JSON.stringify(nt.map(function(t){return t.v+'['+t.type+']';})));
  }catch(err){
    record('v1.2.0 number lexing (0x, separators, 1., .5)',
      false,String(err&&err.stack||err));
  }

  try{
    var amb=analyse('SELECT 1;',{dialect:'auto',mode:'auto',group:false,sources:true});
    var ambiguous=amb.detected.tied===true&&
      amb.diagnostics.some(function(d){
        return d.code==='dialect_ambiguous'&&d.scope==='document';
      })&&amb.diagnostics.some(function(d){return d.code==='dialect_low_confidence';});
    record('v1.2.0 dialect_ambiguous guardrail on low-confidence tie',
      ambiguous,
      JSON.stringify({detected:amb.detected,diagnostics:amb.diagnostics}));
  }catch(err){
    record('v1.2.0 dialect_ambiguous guardrail on low-confidence tie',
      false,String(err&&err.stack||err));
  }

  try{
    function spanValid(span: SourceSpan | null): boolean {
      return !!span&&span.start>=0&&span.end>span.start;
    }
    var unbalanced=analyse('SELECT (1;',{dialect:'tsql',mode:'auto',group:false,sources:true});
    var strayEnd=analyse('END SELECT 1;',{dialect:'tsql',mode:'auto',group:false,sources:true});
    var missingEnd=analyse('CREATE PROC dbo.bad AS BEGIN SELECT 1;',
      {dialect:'tsql',mode:'auto',group:false,sources:true});
    var hasParenDiag=unbalanced.diagnostics.some(function(d){
      return d.code==='unclosed_parenthesis'&&d.scope==='region'&&spanValid(d.span);
    });
    var hasStrayDiag=strayEnd.diagnostics.some(function(d){
      return d.code==='unexpected_end'&&d.scope==='region'&&spanValid(d.span);
    });
    var hasMissingDiag=missingEnd.diagnostics.some(function(d){
      return d.code==='missing_end'&&d.scope==='region';
    });
    record('v1.2.0 bracket and BEGIN/END balance diagnostics',
      hasParenDiag&&hasStrayDiag&&hasMissingDiag,
      JSON.stringify({unbalanced:unbalanced.diagnostics,
                      strayEnd:strayEnd.diagnostics,
                      missingEnd:missingEnd.diagnostics}));
  }catch(err){
    record('v1.2.0 bracket and BEGIN/END balance diagnostics',
      false,String(err&&err.stack||err));
  }

  try{
    var headerSql='CREATE VIEW dbo.schemabound WITH SCHEMABINDING, VIEW_METADATA AS SELECT id FROM dbo.t;';
    var headerWith=analyse(headerSql,
      {dialect:'tsql',mode:'auto',group:false,sources:true});
    var irWith=buildObjectIR(headerWith,
      {id:'f',name:headerWith.header.name,kind:headerWith.header.kind,file:'f',sql:headerSql});
    var viewHeaderOk=headerWith.header.name==='dbo.schemabound'&&
      headerWith.header.kind==='VIEW'&&has(irWith.reads,'dbo.t');
    var altPlans=[
      'ALTER PROCEDURE dbo.ap AS BEGIN SELECT 1; END',
      'ALTER VIEW dbo.av AS SELECT id FROM dbo.t;',
      'ALTER FUNCTION dbo.af() RETURNS int AS BEGIN RETURN 1; END'
    ].map(function(sql){
      return analyse(sql,{dialect:'tsql',mode:'auto',group:false,sources:true}).header;
    });
    var altHeaderOk=altPlans[0].kind==='PROCEDURE'&&altPlans[0].name==='dbo.ap'&&
      altPlans[1].kind==='VIEW'&&altPlans[1].name==='dbo.av'&&
      altPlans[2].kind==='FUNCTION'&&altPlans[2].name==='dbo.af';
    var noGoSource=
      'CREATE PROC dbo.first_obj AS BEGIN SELECT 1; END\n'+
      'CREATE PROC dbo.second_obj AS BEGIN SELECT 2; END';
    var noGoEstate=analyseEstate([{name:'no-go.sql',text:noGoSource}],
      {dialect:'tsql',mode:'auto',group:false,sources:true});
    var noGoOk=noGoEstate.objects.length===2&&
      /first_obj/i.test(noGoEstate.objects[0].name)&&
      /second_obj/i.test(noGoEstate.objects[1].name);
    record('v1.2.0 findBody: CREATE VIEW … WITH header',
      viewHeaderOk,JSON.stringify({header:headerWith.header,ir:irWith}));
    record('v1.2.0 findBody: ALTER object headers',
      altHeaderOk,JSON.stringify(altPlans));
    record('v1.2.0 findBody: multi-object script without GO',
      noGoOk,JSON.stringify(noGoEstate.objects.map(function(o){return o.name;})));
  }catch(err){
    record('v1.2.0 findBody: CREATE VIEW … WITH header',
      false,String(err&&err.stack||err));
    record('v1.2.0 findBody: ALTER object headers',
      false,String(err&&err.stack||err));
    record('v1.2.0 findBody: multi-object script without GO',
      false,String(err&&err.stack||err));
  }

  /* v1.3.0: procedural control flow — labelled/GOTO spans, unresolved labels,
     cursor query graphs, DB2 ATOMIC scope, extended summarise, export parity. */
  function spanOk31(span: SourceSpan | null): boolean {
    return !!span&&span.start>=0&&span.end>span.start;
  }
  try{
    var unresDiag=analyse('CREATE PROC dbo.und AS BEGIN GOTO nope; END',
      {dialect:'tsql',mode:'flow',group:false,sources:true});
    var hasGotoDiag=unresDiag.diagnostics.some(function(d){
      return d.code==='goto_unresolved'&&d.scope==='region'&&spanOk31(d.span);
    });
    var hasUnresNode=unresDiag.graph.nodes.some(function(n){
      return /Unresolved label: nope/.test(n.text);
    });
    record('v1.3.0 goto_unresolved region diagnostic and unresolved-label node',
      hasGotoDiag&&hasUnresNode,
      JSON.stringify(unresDiag.diagnostics));
  }catch(err){
    record('v1.3.0 goto_unresolved region diagnostic and unresolved-label node',
      false,String(err&&err.stack||err));
  }

  try{
    var spanSrc='CREATE PROC dbo.span AS BEGIN GOTO done; done: RETURN; END';
    var spanGoto=analyse(spanSrc,
      {dialect:'tsql',mode:'flow',group:false,sources:true});
    var gotoSpans=spanGoto.graph.nodes.filter(function(n){return /^GOTO done/.test(n.text);})
      .every(function(n){return spanOk31(n.source);});
    var labelSpans=spanGoto.graph.nodes.filter(function(n){return /^done:/.test(n.text);})
      .every(function(n){return spanOk31(n.source);});
    record('v1.3.0 labelled loop-control and GOTO carry source spans',
      gotoSpans&&labelSpans,
      JSON.stringify(spanGoto.graph.nodes.map(function(n){return {text:n.text,src:n.source};})));
  }catch(err){
    record('v1.3.0 labelled loop-control and GOTO carry source spans',
      false,String(err&&err.stack||err));
  }

  try{
    var cursorSource='CREATE PROC dbo.cursor_view AS BEGIN\n'+
      '  DECLARE c CURSOR FOR SELECT id FROM dbo.account;\n'+
      '  OPEN c;\n'+
      'END';
    var cursorQ=analyse(cursorSource,
      {dialect:'tsql',mode:'query',group:false,sources:true});
    var cursorSrcs=cursorQ.graph.nodes.filter(function(n){return n.cls==='src';})
      .map(function(n){return n.text;});
    var db2ForSql='CREATE PROCEDURE APP.CURVIEW() LANGUAGE SQL BEGIN\n'+
      '  FOR V AS CUR CURSOR FOR SELECT ID FROM APP.ACCOUNT DO\n'+
      '    SET V_DONE = V_DONE + 1;\n'+
      '  END FOR;\n'+
      'END';
    var db2For=analyse(db2ForSql,
      {dialect:'db2',mode:'query',group:false,sources:true});
    var db2Srcs=db2For.graph.nodes.filter(function(n){return n.cls==='src';})
      .map(function(n){return n.text;});
    record('v1.3.0 cursor query bodies appear in query graphs (T-SQL + DB2)',
      has(cursorSrcs,'dbo.account')&&has(db2Srcs,'APP.ACCOUNT')&&
        cursorQ.graph.stats.tables>=1&&db2For.graph.stats.tables>=1,
      JSON.stringify({tsql:cursorSrcs,db2:db2Srcs}));
  }catch(err){
    record('v1.3.0 cursor query bodies appear in query graphs (T-SQL + DB2)',
      false,String(err&&err.stack||err));
  }

  try{
    var sumSql='CREATE PROCEDURE dbo.summarise AS BEGIN\n'+
      '  GRANT REFERENCES ON dbo.Orders TO app_role;\n'+
      "  WAITFOR DELAY '00:00:02';\n"+
      '  KILL 42;\n'+
      '  DECLARE c CURSOR FOR SELECT id FROM dbo.Orders;\n'+
      '  OPEN c;\n'+
      '  FETCH NEXT FROM c INTO @id;\n'+
      '  DEALLOCATE c;\n'+
      'END';
    var sumR=analyse(sumSql,
      {dialect:'tsql',mode:'flow',group:false,sources:true});
    var sumLabels=['GRANT … ON dbo.Orders','WAITFOR','KILL 42','OPEN c',
      'FETCH FROM c','DEALLOCATE c'];
    var sumOk=sumLabels.every(function(label){
      return !!matchingNode(sumR.graph,label);
    });
    record('v1.3.0 extended summarise label set (GRANT, WAITFOR, KILL, cursor)',
      sumOk,
      JSON.stringify(sumR.graph.nodes.map(function(n){return n.text;})));
  }catch(err){
    record('v1.3.0 extended summarise label set (GRANT, WAITFOR, KILL, cursor)',
      false,String(err&&err.stack||err));
  }

  try{
    var ux=analyse('CREATE PROC dbo.ux AS BEGIN GOTO nope; END',
      {dialect:'tsql',mode:'flow',group:false,sources:true});
    var uxMermaid=toMermaid(ux.graph,'TD');
    var uxXml=toDrawio(ux.graph,{title:'ux',dir:'TD'});
    var uxDoc=new DOMParser().parseFromString(uxXml,'application/xml');
    var atomicSql='CREATE PROCEDURE APP.AX() LANGUAGE SQL BEGIN\n'+
      '  BEGIN ATOMIC\n'+
      '    DECLARE EXIT HANDLER FOR SQLEXCEPTION\n'+
      '      SET V_ERR = 1;\n'+
      '    UPDATE APP.T SET X = 1;\n'+
      '  END;\n'+
      'END';
    var ax=analyse(atomicSql,
      {dialect:'db2',mode:'flow',group:false,sources:true});
    var axMermaid=toMermaid(ax.graph,'TD');
    var axXml=toDrawio(ax.graph,{title:'ax',dir:'TD'});
    var axDoc=new DOMParser().parseFromString(axXml,'application/xml');
    record('v1.3.0 F export parity for unresolved-label and ATOMIC nodes',
      !uxDoc.querySelector('parsererror')&&!axDoc.querySelector('parsererror')&&
        /flowchart/.test(uxMermaid)&&/flowchart/.test(axMermaid)&&
        /data-procflow=/.test(uxXml)&&/data-procflow=/.test(axXml),
      JSON.stringify({ux:uxDoc.querySelector('parsererror')&&
        uxDoc.querySelector('parsererror').textContent,
        ax:axDoc.querySelector('parsererror')&&
          axDoc.querySelector('parsererror').textContent}));
  }catch(err){
    record('v1.3.0 F export parity for unresolved-label and ATOMIC nodes',
      false,String(err&&err.stack||err));
  }

  /* v1.4.0: report every object a query touches — Workstream C structured
     references, read extraction, recursive CTE annotations, F export parity. */
  function spanOk40(span: SourceSpan | null): boolean {
    return !!span&&span.start>=0&&span.end>span.start;
  }
  function hasRef40(list: StructuredQueryReference[], name: string): boolean {
    return (list||[]).some(function(r){return r.name.toUpperCase()===name.toUpperCase();});
  }
  function refsOf40(sql: string, dialect: Dialect): QueryReferenceInfo {
    var a=analyse(sql,{dialect:dialect, mode:'query', group:false, sources:true});
    var stmt=a.ast.filter(function(n){return n.type==='stmt';})[0] as StatementNode;
    return refsIn(stmt?stmt.toks:[]);
  }

  try{
    var comma40=refsOf40('SELECT * FROM dbo.orders o, dbo.customers c, dbo.items i;','tsql');
    var commaNames40=comma40.structuredRefs.map(function(r){return r.name;});
    var commaOk40=commaNames40.length>=3&&
      hasRef40(comma40.structuredRefs,'dbo.orders')&&
      hasRef40(comma40.structuredRefs,'dbo.customers')&&
      hasRef40(comma40.structuredRefs,'dbo.items')&&
      comma40.structuredRefs.every(function(r){
        return r.role==='read'&&r.resolution==='exact'&&spanOk40(r.span);
      });
    record('v1.4.0 comma-separated sources in refsIn',
      commaOk40,JSON.stringify(comma40.structuredRefs));
  }catch(err){
    record('v1.4.0 comma-separated sources in refsIn',false,String(err&&err.stack||err));
  }

  try{
    var apply40=refsOf40('SELECT a.id FROM dbo.a a CROSS APPLY dbo.fn(a.id) f;','tsql');
    var tab40=refsOf40('SELECT * FROM dbo.doc d, UNNEST(d.ids) AS x(id);','plpgsql');
    var fnRef40=(apply40.structuredRefs||[]).filter(function(r){
      return r.name.toUpperCase()==='DBO.FN';})[0];
    var opaqueRef40=(tab40.structuredRefs||[]).filter(function(r){
      return r.resolution==='opaque';})[0];
    var applyOk40=hasRef40(apply40.structuredRefs,'dbo.a')&&
      !!fnRef40&&fnRef40.resolution==='heuristic'&&spanOk40(fnRef40.span);
    var tabOk40=!!opaqueRef40&&opaqueRef40.role==='read'&&spanOk40(opaqueRef40.span);
    record('v1.4.0 APPLY and tabular functions as structured references',
      applyOk40&&tabOk40,
      JSON.stringify({apply:apply40.structuredRefs,tab:tab40.structuredRefs}));
  }catch(err){
    record('v1.4.0 APPLY and tabular functions as structured references',
      false,String(err&&err.stack||err));
  }

  try{
    var nodeTexts40=function(sql: string, dialect: Dialect): string[] {
      var a=analyse(sql,{dialect:dialect, mode:'query', group:false, sources:true});
      return a.graph.nodes.map(function(n){return n.text;});
    };
    var merge40=nodeTexts40('MERGE INTO dbo.target t USING dbo.source s ON s.id=t.id WHEN MATCHED THEN UPDATE SET t.x=s.x;','tsql');
    var del40=nodeTexts40('DELETE FROM dbo.orders USING dbo.customers WHERE orders.cid=customers.id;','plpgsql');
    var upd40=nodeTexts40('UPDATE dbo.o SET o.x=s.x FROM dbo.o INNER JOIN dbo.s ON o.id=s.id;','tsql');
    var readOk40=merge40.some(function(t){return t==='dbo.source';})&&
      del40.some(function(t){return t==='dbo.customers';})&&
      upd40.some(function(t){return t==='dbo.s';});
    record('v1.4.0 read extraction MERGE…USING / DELETE…USING / UPDATE…FROM',
      readOk40,JSON.stringify({merge:merge40,del:del40,upd:upd40}));
  }catch(err){
    record('v1.4.0 read extraction MERGE…USING / DELETE…USING / UPDATE…FROM',
      false,String(err&&err.stack||err));
  }

  try{
    var rec40=analyse('WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n<10) SELECT * FROM r;',
      {dialect:'plpgsql',mode:'query',group:false,sources:true});
    var recInfo40=rec40.diagnostics.filter(function(d){return d.code==='cte_recursive';})[0];
    var hasRecInfo40=!!recInfo40&&recInfo40.severity==='info'&&
      recInfo40.scope==='region'&&spanOk40(recInfo40.span);
    var noRecWarn40=!rec40.diagnostics.some(function(d){
      return d.code==='cte_recursion_approx';});
    var recMarked40=rec40.graph.nodes.some(function(n){
      return /recursive CTE/.test(n.text);})&&rec40.stats.recursive===1;
    var approx40=analyse('WITH RECURSIVE r AS (SELECT 1 UNION ALL SELECT n+1 FROM r, GENERATE_SERIES(1,10) WHERE n<10) SELECT * FROM r;',
      {dialect:'plpgsql',mode:'query',group:false,sources:true});
    var approxWarn40=approx40.diagnostics.some(function(d){
      return d.code==='cte_recursion_approx'&&d.severity==='warning'&&spanOk40(d.span);
    });
    record('v1.4.0 recursive CTE informational annotation and metadata',
      hasRecInfo40&&noRecWarn40&&recMarked40,
      JSON.stringify(rec40.diagnostics));
    record('v1.4.0 approximate recursion emits a warning', approxWarn40,
      JSON.stringify(approx40.diagnostics));
  }catch(err){
    record('v1.4.0 recursive CTE informational annotation and metadata',
      false,String(err&&err.stack||err));
    record('v1.4.0 approximate recursion emits a warning',
      false,String(err&&err.stack||err));
  }

  try{
    var derived40=analyse('SELECT x.id FROM (SELECT id FROM dbo.inner) x;',
      {dialect:'tsql',mode:'query',group:false,sources:true});
    var commaQ40=analyse('SELECT * FROM dbo.a, dbo.b;',
      {dialect:'tsql',mode:'query',group:false,sources:true});
    var derivedOk40=derived40.graph.nodes.some(function(n){return n.text==='dbo.inner';});
    var commaQOk40=commaQ40.graph.nodes.some(function(n){return n.text==='dbo.b';})&&
      commaQ40.graph.stats.tables===2;
    record('v1.4.0 derived-table and comma inner sources wired in query graph',
      derivedOk40&&commaQOk40,
      JSON.stringify({derived:derived40.graph.nodes.map(function(n){return n.text;}),
                      comma:commaQ40.graph.nodes.map(function(n){return n.text;})}));
  }catch(err){
    record('v1.4.0 derived-table and comma inner sources wired in query graph',
      false,String(err&&err.stack||err));
  }

  try{
    var qgSrc40=[
      'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n<10)',
      'SELECT a.id, b.id FROM dbo.a a CROSS APPLY dbo.fn(a.id) f, dbo.b b;',
      'MERGE INTO dbo.target t USING dbo.source s ON s.id=t.id WHEN MATCHED THEN UPDATE SET t.x=s.x;',
      'SELECT * FROM (SELECT id FROM dbo.inner) x;'
    ].join('\n');
    var qg40=analyse(qgSrc40,
      {dialect:'tsql',mode:'query',group:false,sources:true});
    var m40=toMermaid(qg40.graph,'TD');
    var x40=toDrawio(qg40.graph,{title:'q1-4',dir:'TD'});
    var doc40=new DOMParser().parseFromString(x40,'application/xml');
    var hasQuerySources40=['dbo.a','dbo.b','dbo.fn','dbo.source','dbo.inner'].every(
      function(name){return m40.indexOf(name)>=0;});
    var parity40=!doc40.querySelector('parsererror')&&/flowchart/.test(m40)&&
      hasQuerySources40&&/data-procflow=/.test(x40)&&/provenance=/.test(x40);
    record('v1.4.0 F export parity for query graph constructs',
      parity40,JSON.stringify({parsererror:doc40.querySelector('parsererror')&&
        doc40.querySelector('parsererror').textContent}));
  }catch(err){
    record('v1.4.0 F export parity for query graph constructs',
      false,String(err&&err.stack||err));
  }

  /* v1.5.0: data flow and internal resilience — Workstream D temp-table
     producer→consumer data edges, conservative external nodes, F data-flow
     rendering, E construct-coverage counts. */
  var STAGE_FLOW_150=[
    'CREATE PROCEDURE dbo.stage_flow AS',
    'BEGIN',
    '  SELECT id INTO #stage FROM dbo.source;',
    '  UPDATE #stage SET id = id + 1;',
    '  SELECT id FROM #stage;',
    'END'
  ].join('\n');

  try{
    var extEstate150=analyseEstate([{name:'ext.sql',text:[
      'CREATE PROCEDURE dbo.nightly_sync AS',
      'BEGIN',
      '  EXEC remotesrv.salesdb.dbo.pull_orders;',
      '  SELECT id INTO #orders FROM linksrv.warehouse.dbo.orders;',
      'END'
    ].join('\n')}],{dialect:'tsql',mode:'auto',group:false,sources:true});
    var extTexts150=extEstate150.graph.nodes.map(function(n){return n.text;});
    var extNodes150=extEstate150.graph.nodes.filter(function(n){
      return n.text.indexOf('external: ')===0;});
    var extOk150=has(extTexts150,'external: remotesrv.salesdb.dbo.pull_orders')&&
      has(extTexts150,'external: linksrv.warehouse.dbo.orders')&&
      extNodes150.length>=2&&
      extNodes150.every(function(n){return n.provenance==='external';});
    record('v1.5.0 external nodes keep complete three-/four-part names',
      extOk150,JSON.stringify(extEstate150.graph.nodes.map(function(n){
        return {text:n.text,provenance:n.provenance};})));
  }catch(err){
    record('v1.5.0 external nodes keep complete three-/four-part names',
      false,String(err&&err.stack||err));
  }

  try{
    var df150=analyse(STAGE_FLOW_150,
      {dialect:'tsql',mode:'flow',group:false,sources:true});
    var dfDataEdges150=df150.graph.edges.filter(function(e){return e.kind==='data';});
    var dfMermaid150=toMermaid(df150.graph,'TD');
    var dfXml150=toDrawio(df150.graph,{title:'df',dir:'TD'});
    var dfDoc150=new DOMParser().parseFromString(dfXml150,'application/xml');
    record('v1.5.0 F data-flow edge rendering in both exporters',
      dfDataEdges150.length>=2&&
        /linkStyle [0-9,]+ stroke:#54c39b/.test(dfMermaid150)&&
        !dfDoc150.querySelector('parsererror')&&
        /data-procflow-kind="data"/.test(dfXml150)&&/strokeWidth=2/.test(dfXml150),
      JSON.stringify({dataEdges:dfDataEdges150.length,
        parsererror:dfDoc150.querySelector('parsererror')&&
          dfDoc150.querySelector('parsererror').textContent}));
  }catch(err){
    record('v1.5.0 F data-flow edge rendering in both exporters',
      false,String(err&&err.stack||err));
  }

  try{
    var cc150=analyse(STAGE_FLOW_150,
      {dialect:'tsql',mode:'flow',group:false,sources:true});
    var cov150=cc150.constructCoverage;
    var ccOk150=!!cov150&&cov150.constructs>0&&cov150.resolved>0&&
      cov150.opaque===0&&
      !!cov150.byKind.source_ref&&cov150.byKind.source_ref.detected>=2&&
      !!cov150.byKind.temp_flow&&cov150.byKind.temp_flow.detected===2&&
      cov150.byKind.temp_flow.resolved===2;
    record('v1.5.0 construct coverage detected/resolved/opaque counts',
      ccOk150,JSON.stringify(cov150));
  }catch(err){
    record('v1.5.0 construct coverage detected/resolved/opaque counts',
      false,String(err&&err.stack||err));
  }

  /* v1.6.0: honest measurement — a versioned confidence formula derived from
     per-region signals, document-scoped findings with no fabricated spans,
     region diagnostics for every approximate resolution, and informational
     annotations that never inflate the findings count. */
  function findings160(diags: Diagnostic[]): number {
    return diags.filter(function(d){return d.severity==='warning'||d.severity==='error';}).length;
  }
  function spanOk160(span: SourceSpan | null): boolean {
    return !!span&&span.start>=0&&span.end>span.start;
  }

  try{
    var clean160=analyse('CREATE PROC dbo.clean160 AS BEGIN SELECT 1; SELECT 2; END',
      {dialect:'tsql',mode:'flow',group:false,sources:true});
    var opaque160=analyse('CREATE PROC dbo.opaque160 AS BEGIN EXEC(\'SELECT 1\'); END',
      {dialect:'tsql',mode:'flow',group:false,sources:true});
    var broken160=analyse('END SELECT (1;',
      {dialect:'tsql',mode:'auto',group:false,sources:true});
    var cleanSig160=clean160.confidenceSignals;
    var cleanOk160=clean160.confidenceFormulaVersion==='1.6.0'&&
      clean160.confidence===1&&cleanSig160.regionQuality===1&&
      cleanSig160.regionBreakdown.resolved===cleanSig160.regionBreakdown.total&&
      confidenceBand(clean160.confidence)==='high';
    var opaqueOk160=!!opaque160.confidenceSignals&&
      opaque160.confidenceSignals.regionBreakdown.opaque>=1&&
      opaque160.confidence<clean160.confidence&&
      opaque160.coverage===1&&opaque160.confidence<=0.4;
    var brokenOk160=!!broken160.confidenceSignals&&
      broken160.confidenceSignals.regionBreakdown.error>=1&&
      broken160.confidence<opaque160.confidence&&
      confidenceBand(broken160.confidence)==='low';
    record('v1.6.0 versioned confidence formula from per-region signals',
      cleanOk160&&opaqueOk160&&brokenOk160,
      JSON.stringify({clean:cleanSig160,opaque:opaque160.confidenceSignals,
        broken:broken160.confidenceSignals,
        confidences:[clean160.confidence,opaque160.confidence,broken160.confidence]}));
  }catch(err){
    record('v1.6.0 versioned confidence formula from per-region signals',
      false,String(err&&err.stack||err));
  }

  try{
    var amb160=analyse('SELECT 1;',{dialect:'auto',mode:'auto',group:false,sources:true});
    var docScoped160=amb160.diagnostics.filter(function(d){return d.scope==='document';});
    var noFabricatedSpan160=docScoped160.length>0&&
      docScoped160.every(function(d){return d.span===null;});
    var aroundOk160=(docScoped160.filter(function(d){
      return d.code==='dialect_low_confidence'||d.code==='dialect_ambiguous';
    })).length===docScoped160.length;
    record('v1.6.0 document-scoped findings carry no fabricated span',
      noFabricatedSpan160&&aroundOk160,
      JSON.stringify(docScoped160.map(function(d){return {code:d.code,scope:d.scope,span:d.span};})));
  }catch(err){
    record('v1.6.0 document-scoped findings carry no fabricated span',
      false,String(err&&err.stack||err));
  }

  try{
    var opTable160=analyse('SELECT * FROM dbo.doc d, UNNEST(d.ids) AS x(id);',
      {dialect:'plpgsql',mode:'query',group:false,sources:true});
    var apply160=analyse('SELECT a.id FROM dbo.a a CROSS APPLY dbo.fn(a.id) f;',
      {dialect:'tsql',mode:'query',group:false,sources:true});
    var opDiag160=opTable160.diagnostics.filter(function(d){return d.code==='source_opaque';})[0];
    var apDiag160=apply160.diagnostics.filter(function(d){return d.code==='apply_heuristic';})[0];
    record('v1.6.0 opaque table-expression region diagnostic',
      !!opDiag160&&opDiag160.severity==='warning'&&opDiag160.scope==='region'&&
        spanOk160(opDiag160.span)&&opTable160.confidence<1,
      JSON.stringify(opTable160.diagnostics));
    record('v1.6.0 partially resolved APPLY region diagnostic',
      !!apDiag160&&apDiag160.severity==='warning'&&apDiag160.scope==='region'&&
        spanOk160(apDiag160.span)&&apply160.confidence<1,
      JSON.stringify(apply160.diagnostics));
  }catch(err){
    record('v1.6.0 opaque table-expression region diagnostic',
      false,String(err&&err.stack||err));
    record('v1.6.0 partially resolved APPLY region diagnostic',
      false,String(err&&err.stack||err));
  }

  try{
    var rec160=analyse('CREATE PROC dbo.rec160 AS BEGIN\n'+
      '  WITH r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n<10)\n'+
      '  SELECT n FROM r;\n'+
      'END',
      {dialect:'tsql',mode:'flow',group:false,sources:true});
    var hasInfo160=rec160.diagnostics.some(function(d){
      return d.code==='cte_recursive'&&d.severity==='info'&&spanOk160(d.span);
    });
    record('v1.6.0 informational annotations do not inflate the findings count',
      hasInfo160&&findings160(rec160.diagnostics)===0,
      JSON.stringify(rec160.diagnostics));
  }catch(err){
    record('v1.6.0 informational annotations do not inflate the findings count',
      false,String(err&&err.stack||err));
  }

  var passed=results.filter(function(r){return r.pass;}).length;
  document.body.className=passed===results.length?'pass':'fail';
  document.getElementById('summary').textContent=passed+'/'+results.length+' tests passed';
  document.getElementById('results').textContent=JSON.stringify(results,null,2);
})();
