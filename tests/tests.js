(function(){
  var results=[];
  function record(name,pass,detail){
    results.push({name:name,pass:!!pass,detail:pass?'':detail});
  }
  function has(list,value){
    return (list||[]).some(function(v){ return v.toUpperCase()===value.toUpperCase(); });
  }

  PROCFLOW_FIXTURES.forEach(function(f){
    try{
      var r=analyse(f.sql,{dialect:f.dialect,mode:'auto',group:false,sources:true});
      var ir=buildObjectIR(r,{id:'fixture',name:f.name,kind:r.header.kind,
                              file:f.name,sql:f.sql});
      var e=f.expect, ok=r.mode===e.mode;
      if(e.branch!==undefined) ok=ok&&r.stats.branch===e.branch;
      if(e.cat!==undefined) ok=ok&&r.stats.cat===e.cat;
      if(e.opaque!==undefined) ok=ok&&r.stats.opaque===e.opaque;
      if(e.ctes!==undefined) ok=ok&&r.stats.ctes===e.ctes;
      if(e.tables!==undefined) ok=ok&&r.stats.tables===e.tables;
      if(e.call) ok=ok&&has(ir.calls,e.call);
      if(e.write) ok=ok&&has(ir.writes,e.write);
      if(e.write2) ok=ok&&has(ir.writes,e.write2);
      if(e.resultSets!==undefined) ok=ok&&ir.resultSets.length===e.resultSets;
      if(e.diagnostic) ok=ok&&r.diagnostics.some(function(d){return d.code===e.diagnostic;});
      var sourced=r.graph.nodes.filter(function(n){return n.source;});
      ok=ok&&sourced.every(function(n){
        return n.source.start>=0&&n.source.end>n.source.start&&n.source.end<=f.sql.length;
      });
      record(f.name,ok,JSON.stringify({stats:r.stats,diagnostics:r.diagnostics,ir:ir}));
    }catch(err){ record(f.name,false,String(err&&err.stack||err)); }
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
    var escaped=analyse('SELECT \'<tag>&"\' value FROM dbo.source;',
      {dialect:'tsql',mode:'auto',group:false,sources:true});
    var xml=toDrawio(escaped.graph,{title:'A&B',dir:'TD'});
    var doc=new DOMParser().parseFromString(xml,'application/xml');
    record('draw.io XML remains well formed',!doc.querySelector('parsererror'),
           doc.querySelector('parsererror')&&doc.querySelector('parsererror').textContent);
  }catch(err){ record('draw.io XML remains well formed',false,String(err&&err.stack||err)); }

  var passed=results.filter(function(r){return r.pass;}).length;
  document.body.className=passed===results.length?'pass':'fail';
  document.getElementById('summary').textContent=passed+'/'+results.length+' tests passed';
  document.getElementById('results').textContent=JSON.stringify(results,null,2);
})();
