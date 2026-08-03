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
      results.push({name:'local Mermaid runtime',
        pass:!!w.mermaid&&!Array.prototype.some.call(d.scripts,function(s){
          return /^https?:/i.test(s.getAttribute('src')||'');
        })});
      finish(results);
    },1200);
  });
})();
