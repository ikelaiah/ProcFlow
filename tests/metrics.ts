/* v1.9.0 — fixture-corpus metric publishing.
   Aggregates the "Metrics that matter" over the checked-in golden corpus,
   including the v1.7.0 export-parity, export-traceability, and layout-budget
   pass rates reported by tests/parity.ts, the v1.8.0 workspace
   persistence/dependency-filtering pass rate from tests/workspace.ts, and the
   v1.9.0 catalogue pass rate from tests/catalogue.ts.
   Purely deterministic and fixture-only: no user inputs and no runtime
   telemetry are ever collected. scripts/metrics.mjs drives this page to
   produce or verify docs/metrics-v1.9.0.json. */
(function(){
  var corpus=PROCFLOW_FIXTURES||[];

  var totalTokens=0, attributedAll=0, unresolvedTokens=0, opaqueTokens=0,
      tailUnconsumed=0;
  var regionScoped=0, regionValidSpan=0;
  var edges=0, kindEdges=0, nodes=0, provenanceNodes=0;
  var statementRegions=0, unknownRegions=0;
  var sampleConfidenceFormula='1.6.0';

  /* Statement-region walk: counts every statement node and how many fell back
     to an unresolved region, mirroring walkAst's recursion. */
  function walk(list: any): void {
    (list||[]).forEach(function(st){
      if(st.toks&&st.toks.length){
        statementRegions++;
        if(st.type==='unknown') unknownRegions++;
      }
      if(st.type==='block') walk(st.body);
      else if(st.type==='if'){
        if(st.then) walk([st.then]);
        if(st.else) walk([st.else]);
      } else if(st.type==='case'){
        st.branches.forEach(function(b){ walk(b.body); });
        if(st.else) walk(st.else);
      } else if(['while','for','loop','repeat'].indexOf(st.type)>=0&&st.body)
        walk([st.body]);
      else if(st.type==='try'){
        walk(st.body);
        st.handlers.forEach(function(h){ walk(h.body); });
      } else if(st.type==='handler'&&st.body) walk([st.body]);
    });
  }

  corpus.forEach(function(f){
    var r=analyse(f.sql,{dialect:f.dialect,mode:'auto',group:false,sources:true});
    var a=r.attribution||{total:0,resolved:0,ignored:0,unresolved:0,opaque:0};
    totalTokens+=a.total;
    /* Attribution rate: every body token must land in a resolved, deliberately
       ignored, unresolved, or opaque region — the no-silent-drops contract.
       The four buckets always cover the corpus, so a rate below 1 would mean
       token accounting regressed. */
    attributedAll+=a.resolved+a.ignored+a.unresolved+a.opaque;
    unresolvedTokens+=a.unresolved;
    opaqueTokens+=a.opaque;
    tailUnconsumed+=(r.totalTokens-r.consumedTokens);
    if(r.confidenceFormulaVersion) sampleConfidenceFormula=r.confidenceFormulaVersion;
    r.diagnostics.forEach(function(d){
      if(d.scope==='region'){
        regionScoped++;
        if(!!d.span&&d.span.start>=0&&d.span.end>d.span.start) regionValidSpan++;
      }
    });
    r.graph.edges.forEach(function(e){ edges++; if(!!e.kind) kindEdges++; });
    r.graph.nodes.forEach(function(n){ nodes++; if(!!n.provenance) provenanceNodes++; });
    walk(r.ast);
  });

  function rate(n: number, d: number): number {
    return d?Math.round((n/d)*1000000)/1000000:1;
  }
  var metrics: Record<string, unknown>={
    generator:'proc>flow fixture-corpus metrics (deterministic, fixture-only)',
    formulaVersion:sampleConfidenceFormula,
    corpus:{
      /* Corpus size is checked in, so any growth of the fixture suite (or a
         UI/fuzz-count change) requires regenerating the snapshot via
         `npm run metrics:write`; CI then refuses to merge a stale snapshot. */
      golden:corpus.length,
      fuzz:400,
      ui:22,
      parity:window.PROCFLOW_PARITY_RESULT?window.PROCFLOW_PARITY_RESULT.total/2:0,
      layout:window.PROCFLOW_LAYOUT_RESULT?window.PROCFLOW_LAYOUT_RESULT.total:0,
      workspace:window.PROCFLOW_WORKSPACE_RESULT
        ?window.PROCFLOW_WORKSPACE_RESULT.total:0,
      catalogue:window.PROCFLOW_CATALOGUE_RESULT
        ?window.PROCFLOW_CATALOGUE_RESULT.total:0
    },
    attributionRate:rate(attributedAll,totalTokens),
    unresolvedTokenRate:rate(unresolvedTokens,totalTokens),
    tailUnconsumedRate:rate(tailUnconsumed,totalTokens),
    opaqueDynamicRate:rate(opaqueTokens,totalTokens),
    fallbackRate:rate(unknownRegions,statementRegions),
    semanticEdgeCoverage:rate(kindEdges,edges),
    provenanceRate:rate(provenanceNodes,nodes),
    regionDiagnosticToSpanRatio:rate(regionValidSpan,regionScoped),
    /* v1.7.0 clear deterministic exports: export-parity, export-traceability,
       and layout-budget rates come from tests/parity.ts, which parses each
       Mermaid and draw.io output back to a semantic manifest and compares it
       with the input Graph at its documented size limits. */
    exportParityPassRate:window.PROCFLOW_PARITY_RESULT
      ? rate(window.PROCFLOW_PARITY_RESULT.passed,window.PROCFLOW_PARITY_RESULT.total)
      : 0,
    exportTraceabilityRate:window.PROCFLOW_PARITY_RESULT
      ? rate(window.PROCFLOW_PARITY_RESULT.traceabilityPassed,
             window.PROCFLOW_PARITY_RESULT.traceabilityTotal)
      : 1,
    layoutBudgetPassRate:window.PROCFLOW_LAYOUT_RESULT
      ? rate(window.PROCFLOW_LAYOUT_RESULT.passed,window.PROCFLOW_LAYOUT_RESULT.total)
      : 0,
    /* v1.8.0 usable local workspace: persistence round-trip, migration,
       corrupt recovery, explicit clearing, and presentation-only dependency
       filtering all pass on the checked-in fixture corpus. */
    workspacePassRate:window.PROCFLOW_WORKSPACE_RESULT
      ? rate(window.PROCFLOW_WORKSPACE_RESULT.passed,window.PROCFLOW_WORKSPACE_RESULT.total)
      : 0,
    /* v1.9.0 resolve by catalogue: import parsing (JSON and line formats),
       exact synonym/linked-server/cross-database verification, conservative
       conflict handling, region-scoped partial diagnostics, export metadata,
       and workspace round-trip all pass on the checked-in fixture corpus. */
    cataloguePassRate:window.PROCFLOW_CATALOGUE_RESULT
      ? rate(window.PROCFLOW_CATALOGUE_RESULT.passed,window.PROCFLOW_CATALOGUE_RESULT.total)
      : 0,
    aggregate:{
      totalTokens:totalTokens,
      accountedTokens:attributedAll,
      statementRegions:statementRegions,
      unresolvedRegions:unknownRegions
    }
  };

  var out=JSON.stringify(metrics,null,2);
  document.body.className='pass';
  document.getElementById('summary').textContent=
    'Fixture-corpus metrics · '+corpus.length+' golden fixtures';
  document.getElementById('metrics-output').textContent=out;
  document.title='proc>flow metrics';
  window.PROCFLOW_METRICS_OUTPUT=out;
  window.PROCFLOW_METRICS_READY=true;
})();
