(function(){
  var frame=document.getElementById('app') as HTMLIFrameElement,
      output=document.getElementById('results') as HTMLElement;
  function finish(results: any[]): void {
    var passed=results.filter(function(r){return r.pass;}).length;
    document.body.className=passed===results.length?'pass':'fail';
    document.getElementById('summary').textContent=passed+'/'+results.length+' tests passed';
    output.textContent=JSON.stringify(results,null,2);
  }
  frame.addEventListener('load',function(){
    var w=frame.contentWindow, d=frame.contentDocument, results: any[]=[];
    var get=function(id: string): any { return d.getElementById(id); };
    results.push({name:'compact local-processing header',
      pass:!!d.querySelector('.top .privacy-disclosure')&&
        !d.querySelector('.privacy-note')&&
        !!get('btn-draw').closest('.editor-head')&&
        !get('btn-draw').closest('.top')});
    results.push({name:'settings and export menus group secondary controls',
      pass:!!get('view-settings-menu').querySelector('#opt-group')&&
        !!get('view-settings-menu').querySelector('#opt-fanin')&&
        !!get('export-menu').querySelector('#btn-copy')&&
        !!get('export-menu').querySelector('#btn-drawio')});
    get('btn-analysis-details').click();
    results.push({name:'analysis details expand accessibly',
      pass:!get('analysis-details').hidden&&
        get('btn-analysis-details').getAttribute('aria-expanded')==='true'});
    get('btn-analysis-details').click();
    var pastedSource=[
      'CREATE OR ALTER PROCEDURE dbo.pasted_once AS',
      'BEGIN',
      '  SELECT 1;',
      'END'
    ].join('\n');
    get('sql').value=pastedSource;
    get('sql').dispatchEvent(new Event('input'));
    get('btn-draw').click();
    results.push({name:'single modified CREATE paste remains one clean source',
      pass:get('object-select').options.length===1&&get('sql').value===pastedSource,
      detail:{objectCount:get('object-select').options.length,source:get('sql').value}});
    var source=[
      'CREATE VIEW dbo.export_students AS SELECT id FROM dbo.student;',
      'GO',
      'CREATE PROCEDURE dbo.refresh_students AS',
      'BEGIN',
      '  EXEC dbo.audit_refresh;',
      '  UPDATE dbo.student SET refreshed = 1;',
      '  SELECT id FROM dbo.export_students;',
      'END'
    ].join('\n');
    get('sql').value=source;
    get('sql').dispatchEvent(new Event('input'));
    get('btn-draw').click();
    results.push({name:'multi-object picker',
      pass:get('object-select').options.length===2&&!get('lbl-object').hidden});

    var scope=get('opt-scope');
    scope.value='dependencies';
    scope.dispatchEvent(new Event('change'));
    results.push({name:'dependency diagram',
      pass:/reads|writes|calls/.test(get('mermaid-out').textContent)&&
        /Estate/.test(get('proc-name').textContent)});

    var picker=get('object-select');
    picker.value=picker.options[1].value;
    picker.dispatchEvent(new Event('change'));
    scope.value='internal';
    scope.dispatchEvent(new Event('change'));
    results.push({name:'linked object selection',
      pass:/refresh_students/i.test(get('proc-name').textContent)&&
        /refresh_students/i.test(get('sql').value)});
    get('proc-name').textContent='Shortcut pending';
    get('sql').dispatchEvent(new KeyboardEvent('keydown',
      {key:'Enter',ctrlKey:true,bubbles:true}));
    results.push({name:'Ctrl+Enter refresh shortcut',
      pass:get('proc-name').textContent!=='Shortcut pending'&&
        /refresh_students/i.test(get('proc-name').textContent)});
    results.push({name:'confidence and coverage display',
      pass:get('coverage-val').textContent==='100%'&&
        /%$/.test(get('confidence-val').textContent)&&
        /^\d+$/.test(get('diagnostic-val').textContent)});
    results.push({name:'analysis health data-band derives from the confidence formula',
      pass:(function(){
        var pct=parseInt(get('confidence-val').textContent,10);
        var expected=pct>=85?'high':pct>=60?'medium':'low';
        return get('analysis-health').getAttribute('data-band')===expected;
      })(),
      detail:{band:get('analysis-health').getAttribute('data-band'),
        pct:get('confidence-val').textContent}});
    results.push({name:'construct coverage display',
      pass:/^\d+\/\d+$/.test(get('construct-val').textContent)&&
        /\d+ detected · \d+ resolved · \d+ opaque/.test(get('construct-note').textContent),
      detail:{val:get('construct-val').textContent,
        note:get('construct-note').textContent}});
    var view=get('opt-view');
    view.value='flow';
    view.dispatchEvent(new Event('change'));
    var flowCode=get('mermaid-out').textContent;
    view.value='query';
    view.dispatchEvent(new Event('change'));
    var queryCode=get('mermaid-out').textContent;
    results.push({name:'control flow and query structure selector',
      pass:flowCode!==queryCode&&/dbo\.export_students/.test(queryCode)&&
        get('cc-label').textContent==='Moving parts'});

    setTimeout(function(){
      var node=d.querySelector('#stage .node[data-source-start]'),
          before=get('sql').selectionEnd;
      if(node) node.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      results.push({name:'diagram source selection',
        pass:!!node&&get('sql').selectionEnd>get('sql').selectionStart&&
          get('sql').selectionEnd!==before,
        detail:{nodeCount:d.querySelectorAll('#stage .node').length,
          linkedCount:d.querySelectorAll('#stage .node[data-source-start]').length,
          ids:Array.prototype.map.call(d.querySelectorAll('#stage .node'),function(n){return n.id;}),
          start:get('sql').selectionStart,end:get('sql').selectionEnd,before:before}});
      get('sql').value='END SELECT (1;';
      get('sql').dispatchEvent(new Event('input'));
      get('opt-dialect').value='tsql';
      get('btn-draw').click();
      results.push({name:'malformed input health warning',
        pass:parseInt(get('coverage-val').textContent,10)<100&&
          parseInt(get('diagnostic-val').textContent,10)>=2&&
          get('analysis-health').getAttribute('data-band')==='low'});
      get('opt-dialect').value='tsql';
      get('sql').value=[
        'CREATE PROC dbo.rec_ui AS',
        'BEGIN',
        '  WITH r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n<10)',
        '  SELECT n FROM r;',
        'END'
      ].join('\n');
      get('sql').dispatchEvent(new Event('input'));
      get('btn-draw').click();
      results.push({name:'informational annotations do not inflate findings count',
        pass:get('diagnostic-val').textContent==='0'&&
          parseInt(get('confidence-val').textContent,10)>=85,
        detail:{diag:get('diagnostic-val').textContent,
          conf:get('confidence-val').textContent}});
      results.push({name:'local Mermaid runtime',
        pass:!!w.mermaid&&!Array.prototype.some.call(d.scripts,function(s){
          return /^https?:/i.test(s.getAttribute('src')||'');
        })});

      /* v1.8.0 usable local workspace — dependency filtering and opt-in
         persistence (save → restore identical, explicit clear). */
      w.clearWorkspace();
      var depSource=[
        'CREATE VIEW dbo.dep_view AS SELECT id FROM dbo.student;',
        'GO',
        'CREATE PROC dbo.dep_proc AS',
        'BEGIN',
        '  EXEC dbo.dep_callee;',
        '  UPDATE dbo.student SET x = 1;',
        '  SELECT id FROM dbo.dep_view;',
        'END'
      ].join('\n');
      get('sql').value=depSource;
      get('sql').dispatchEvent(new Event('input'));
      get('btn-draw').click();
      get('object-select').options.length; /* analyse estate */
      get('opt-scope').value='dependencies';
      get('opt-scope').dispatchEvent(new Event('change'));
      var filterShown=get('filter-menu').style.display!=='none';
      var fullDep=get('mermaid-out').textContent;
      get('f-w').checked=false;
      get('f-w').dispatchEvent(new Event('change'));
      var filteredDep=get('mermaid-out').textContent;
      get('btn-filter-reset').click();
      var resetDep=get('mermaid-out').textContent;
      results.push({name:'dependency filter panel shows only in dependency scope',
        pass:filterShown&&fullDep.length>0,
        detail:{shown:filterShown,full:fullDep.slice(0,80)}});
      results.push({name:'dependency filtering is presentation-only in the UI',
        pass:fullDep!==filteredDep&&filteredDep.length<fullDep.length&&
          resetDep===fullDep,
        detail:{full:fullDep.slice(0,120),filtered:filteredDep.slice(0,120),
          reset:resetDep.slice(0,120)}});

      var persistenceSource=[
        'CREATE PROC dbo.ws_persist AS',
        'BEGIN',
        '  SELECT 1;',
        'END'
      ].join('\n');
      get('opt-scope').value='internal';
      get('opt-scope').dispatchEvent(new Event('change'));
      get('opt-dialect').value='tsql';
      get('sql').value=persistenceSource;
      get('sql').dispatchEvent(new Event('input'));
      get('btn-draw').click();
      var capturedCode=get('mermaid-out').textContent;
      get('btn-ws-save').click();
      get('sql').value='SELECT changed;';
      get('sql').dispatchEvent(new Event('input'));
      get('btn-draw').click();
      get('btn-ws-restore').click();
      var restoredCode=get('mermaid-out').textContent;
      results.push({name:'opt-in save then restore reproduces identical analysis',
        pass:get('sql').value.indexOf('ws_persist')>=0&&capturedCode===restoredCode,
        detail:{captured:capturedCode.slice(0,80),restored:restoredCode.slice(0,80),
          sql:get('sql').value.slice(0,60)}});
      get('btn-ws-forget').click();
      results.push({name:'forgetting a saved workspace is explicit',
        pass:w.hasSavedWorkspace()===false&&
          /No workspace is saved/i.test(get('ws-status').textContent||''),
        detail:{saved:w.hasSavedWorkspace(),status:get('ws-status').textContent}});

      /* v1.9.0 resolve by catalogue — paste catalogue metadata, Apply, and
         verify the dependency view shows the verified object (no external
         label) while an unproven three-part name stays external. */
      get('opt-scope').value='internal';
      get('opt-dialect').value='tsql';
      get('sql').value=[
        'CREATE PROC dbo.cat_ui AS',
        'BEGIN',
        '  SELECT id FROM salesdb.dbo.orders;',
        '  SELECT id FROM readme.dbo.ghost;',
        'END'
      ].join('\n');
      get('sql').dispatchEvent(new Event('input'));
      get('catalogue-text').value='salesdb.dbo.orders TABLE';
      get('btn-catalogue-apply').click();
      get('opt-scope').value='dependencies';
      get('opt-scope').dispatchEvent(new Event('change'));
      var catalogued= get('mermaid-out').textContent;
      results.push({name:'catalogue verification in the dependency view',
        pass:catalogued.indexOf('salesdb.dbo.orders')>=0&&
          catalogued.indexOf('external: salesdb.dbo.orders')<0&&
          catalogued.indexOf('external: readme.dbo.ghost')>=0&&
          /Loaded: 1 object/i.test(get('catalogue-status').textContent||''),
        detail:{code:catalogued.slice(0,160),
          status:get('catalogue-status').textContent}});
      get('btn-catalogue-clear').click();
      results.push({name:'clearing the catalogue resets its status',
        pass:/No catalogue loaded/i.test(get('catalogue-status').textContent||''),
        detail:{status:get('catalogue-status').textContent}});

      /* v1.12.0 report import — paste an SSRS/RDL definition, Apply, verify the
         status summary distinguishes embedded/shared/unresolved datasets, and
         select an embedded dataset so its SQL loads and analyses. */
      get('opt-scope').value='internal';
      get('opt-dialect').value='tsql';
      var rdlText='<Report xmlns="http'+'://schemas.microsoft.com/sqlserver/reporting/2008/01/reportdefinition">\n'+
        '<DataSets>\n'+
        '  <DataSet Name="Students"><Query>\n'+
        '    <DataSourceName>SchoolDB</DataSourceName>\n'+
        '    <CommandText>SELECT StudentId FROM dbo.Student</CommandText>\n'+
        '  </Query></DataSet>\n'+
        '  <DataSet Name="Rollup"><SharedDataSet>\n'+
        '    <SharedDataSetReference>Shared/Rollup</SharedDataSetReference>\n'+
        '  </SharedDataSet></DataSet>\n'+
        '  <DataSet Name="Broken"></DataSet>\n'+
        '</DataSets>\n</Report>';
      get('report-text').value=rdlText;
      get('btn-report-apply').click();
      var reportStatus=get('report-status').textContent||'';
      var datasetOptions: string[]=Array.prototype.map.call(
        get('report-dataset-select').options,function(o:any){return String(o.textContent);}) as string[];
      results.push({name:'report import distinguishes embedded, shared, and unresolved datasets',
        pass:/1 report · 3 datasets · 1 embedded · 1 shared · 1 unresolved/i.test(reportStatus)&&
          datasetOptions.length===3&&
          datasetOptions.some(function(t:string){return /Students — embedded/i.test(t);})&&
          datasetOptions.some(function(t:string){return /Rollup — shared/i.test(t);})&&
          datasetOptions.some(function(t:string){return /Broken — unresolved/i.test(t);}),
        detail:{status:reportStatus,options:datasetOptions}});
      var beforeCode=get('mermaid-out').textContent;
      Array.prototype.forEach.call(get('report-dataset-select').options,function(o:any){
        if(/Students/.test(o.textContent)) get('report-dataset-select').value=o.value;
      });
      get('report-dataset-select').dispatchEvent(new Event('change'));
      var afterCode=get('mermaid-out').textContent;
      results.push({name:'selecting an embedded dataset loads and analyses its SQL',
        pass:get('sql').value.indexOf('SELECT StudentId FROM dbo.Student')>=0&&
          afterCode!==beforeCode&&/dbo\.Student/i.test(afterCode)&&
          /Students — embedded/.test(get('report-dataset-select').selectedOptions[0].textContent||''),
        detail:{sql:get('sql').value.slice(0,80),
          code:afterCode.slice(0,120),before:beforeCode.slice(0,120)}});
      get('btn-report-clear').click();
      results.push({name:'clearing the report resets its status and picker',
        pass:/No report definition loaded/i.test(get('report-status').textContent||'')&&
          get('report-dataset-select').disabled===true,
        detail:{status:get('report-status').textContent}});

      /* v1.13.0 report intelligence — the Report dependencies scope renders the
         report → dataset → object → column chain and its presentation-only
         filter hides the column layer without changing the underlying graph. */
      get('report-text').value=rdlText;
      get('btn-report-apply').click();
      get('opt-scope').value='report';
      get('opt-scope').dispatchEvent(new Event('change'));
      var reportGraphCode=get('mermaid-out').textContent;
      var reportStats=get('stats').textContent||'';
      results.push({name:'report dependencies scope renders the report chain',
        pass:reportGraphCode.indexOf('Report')>=0&&
          reportGraphCode.indexOf('Students')>=0&&
          reportGraphCode.indexOf('dbo.Student')>=0&&
          reportGraphCode.indexOf('StudentId')>=0&&
          /Reports · 1 report/i.test(get('proc-name').textContent||'')&&
          /Reports/.test(reportStats)&&
          get('report-filter-menu').style.display!=='none',
        detail:{code:reportGraphCode.slice(0,160),stats:reportStats,
          name:get('proc-name').textContent}});
      var fullReportCode=get('mermaid-out').textContent;
      get('rf-cols').checked=false;
      get('rf-cols').dispatchEvent(new Event('change'));
      var filteredReportCode=get('mermaid-out').textContent;
      results.push({name:'report filter hides columns presentation-only in the UI',
        pass:filteredReportCode.indexOf('StudentId')<0&&
          fullReportCode.indexOf('StudentId')>=0&&
          filteredReportCode.length<fullReportCode.length,
        detail:{full:fullReportCode.slice(0,120),
          filtered:filteredReportCode.slice(0,120)}});
      get('btn-report-filter-reset').click();
      get('rf-cols').checked=true;
      get('btn-report-clear').click();
      get('opt-scope').value='internal';
      get('opt-scope').dispatchEvent(new Event('change'));
      finish(results);
    },1200);
  });
})();
