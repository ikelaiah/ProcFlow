/* v1.14.0 deterministic scale and realistic-corpus invariants. Timing is
   deliberately excluded: the repeatable benchmark command owns performance
   numbers, while this suite catches truncation, nondeterminism, and runaway
   graph construction in the normal correctness gate. */
(function(){
  var results: Array<{name:string;pass:boolean;detail?:unknown}>=[];
  function record(name:string,pass:boolean,detail?:unknown):void {
    results.push({name:name,pass:pass,detail:detail});
  }
  function stressSql(size:number):string {
    var filler=new Array(size+1).join(' ');
    return 'SELECT 1;\n'+filler;
  }
  function checkAnalysis(sql:string):{pass:boolean;detail:unknown} {
    var first=analyse(sql,{dialect:'sqlite',mode:'auto',group:false,sources:true});
    var second=analyse(sql,{dialect:'sqlite',mode:'auto',group:false,sources:true});
    var a=first.attribution;
    return {pass:sql.length>=100000&&first.totalTokens>0&&
      first.consumedTokens<=first.totalTokens&&!!a&&
      a.total===a.resolved+a.ignored+a.unresolved+a.opaque&&
      first.mermaid===second.mermaid,
      detail:{bytes:sql.length,tokens:first.totalTokens,coverage:first.coverage,
        attribution:a,deterministic:first.mermaid===second.mermaid}};
  }
  [100000,500000].forEach(function(size){
    var checked=checkAnalysis(stressSql(size));
    record('large SQL structural analysis · '+size+' bytes',checked.pass,checked.detail);
  });

  var files:WorkspaceFile[]=[{name:'scale-100.sql',text:(function(){
    var parts:string[]=[];
    for(var i=1;i<=100;i++)
      parts.push('CREATE VIEW dbo.scale_view_'+i+' AS SELECT id FROM dbo.scale_source_'+i+';','GO');
    return parts.join('\n');
  })()}];
  var estate=analyseEstate(files,{dialect:'tsql',mode:'auto',group:false,sources:true});
  record('multi-object estate · approximately 100 SQL objects',estate.objects.length===100&&
    estate.graph.nodes.length>=100&&estate.graph.edges.length>=100,
    {objects:estate.objects.length,nodes:estate.graph.nodes.length,edges:estate.graph.edges.length});

  var datasetParts:string[]=[];
  for(var d=1;d<=25;d++) datasetParts.push(
    '<DataSet Name="Dataset'+d+'"><Query><CommandText>'+
    'SELECT id FROM dbo.report_source_'+d+'</CommandText></Query></DataSet>');
  var report=parseReport('<Report><DataSets>'+datasetParts.join('')+
    '</DataSets></Report>');
  var reportGraph=buildReportGraph(report,{});
  record('report dependency graph · approximately 25 datasets',
    report.datasetCount===25&&report.embeddedCount===25&&
      reportGraph.stats.datasets===25&&reportGraph.stats.objects>=25,
    {datasets:report.datasetCount,embedded:report.embeddedCount,
      graphStats:reportGraph.stats});

  function scaleGraph(count:number):Graph {
    var nodes:GraphNode[]=[];
    var edges:GraphEdge[]=[];
    for(var i=0;i<count;i++) nodes.push({id:'scale-'+i,shape:'rect',
      text:'Scale node '+i,cls:'stmt',source:null,provenance:'synthetic'});
    for(var e=1;e<count;e++) edges.push({from:'scale-'+(e-1),to:'scale-'+e,
      label:'next',style:'solid',kind:'dependency'});
    return {nodes:nodes,edges:edges,stats:{nodes:count,edges:edges.length}};
  }
  [100,250,500].forEach(function(count){
    var graph=scaleGraph(count), layout=layoutAnalysis(graph,'TD');
    var positions=layoutDrawio(graph,'TD');
    var xml=toDrawio(graph,{title:'scale-'+count,dir:'TD'});
    var parsed=new DOMParser().parseFromString(xml,'application/xml');
    record('dependency layout budget · '+count+' nodes',
      Object.keys(positions).length===count&&layout.overlaps===0&&
        layout.backboneEdges===count-1&&!parsed.querySelector('parsererror')&&
        toMermaid(graph,'TD').indexOf('flowchart TD')===0,
      {nodes:count,overlaps:layout.overlaps,crossings:layout.crossings,
        backbone:layout.backboneEdges,warnings:layout.warnings});
  });

  PROCFLOW_REALISTIC_CORPUS.forEach(function(f){
    var passed=false, detail:Record<string,unknown>={};
    try{
      var result=analyse(f.sql,{dialect:f.dialect,mode:'auto',group:false,sources:true});
      var a=result.attribution;
      var spans=(result.diagnostics||[]).filter(function(d){return d.scope==='region';})
        .every(function(d){return !!d.span&&d.span.start>=0&&d.span.end>d.span.start&&d.span.end<=f.sql.length;});
      var opaque=f.expectsOpaque
        ? (result.diagnostics||[]).some(function(d){return d.code==='dynamic_sql';})
        : true;
      passed=result.totalTokens>0&&!!a&&a.total===a.resolved+a.ignored+a.unresolved+a.opaque&&
        result.mermaid.indexOf('flowchart ')===0&&spans&&opaque;
      detail={dialect:f.dialect,tokens:result.totalTokens,coverage:result.coverage,
        diagnostics:result.diagnostics.length,opaque:opaque,attribution:a};
    }catch(err){ detail={error:String(err&&err.stack||err)}; }
    record('realistic anonymised corpus · '+f.name,passed,detail);
  });

  var passed=results.filter(function(r){return r.pass;}).length;
  var corpusByDialect:Record<string,number>={};
  PROCFLOW_REALISTIC_CORPUS.forEach(function(f){
    corpusByDialect[f.dialect]=(corpusByDialect[f.dialect]||0)+1;
  });
  window.PROCFLOW_SCALABILITY_PASS=passed===results.length;
  window.PROCFLOW_SCALABILITY_RESULT={passed:passed,total:results.length};
  window.PROCFLOW_SCALABILITY_DETAIL=results;
  window.PROCFLOW_REALISTIC_CORPUS_RESULT={total:PROCFLOW_REALISTIC_CORPUS.length,
    dialects:corpusByDialect};
  var out=document.getElementById('scalability-results');
  if(out) out.textContent=JSON.stringify({passed:passed,total:results.length,
    failures:results.filter(function(r){return !r.pass;})},null,2);
  var summary=document.getElementById('scalability-summary');
  if(summary) summary.textContent='v1.14.0 scale/corpus · '+passed+'/'+results.length;
})();
