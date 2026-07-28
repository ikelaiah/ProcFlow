(function(){
  var frame=document.getElementById('app'), output=document.getElementById('results');
  function finish(results){
    var passed=results.filter(function(r){return r.pass;}).length;
    document.body.className=passed===results.length?'pass':'fail';
    document.getElementById('summary').textContent=passed+'/'+results.length+' tests passed';
    output.textContent=JSON.stringify(results,null,2);
  }
  frame.addEventListener('load',function(){
    var w=frame.contentWindow, d=frame.contentDocument, results=[];
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
    d.getElementById('sql').value=source;
    d.getElementById('btn-draw').click();
    results.push({name:'multi-object picker',
      pass:d.getElementById('object-select').options.length===2&&!d.getElementById('lbl-object').hidden});

    var scope=d.getElementById('opt-scope');
    scope.value='dependencies';
    scope.dispatchEvent(new Event('change'));
    results.push({name:'dependency diagram',
      pass:/reads|writes|calls/.test(d.getElementById('mermaid-out').textContent)&&
        /Estate/.test(d.getElementById('proc-name').textContent)});

    var picker=d.getElementById('object-select');
    picker.value=picker.options[1].value;
    picker.dispatchEvent(new Event('change'));
    scope.value='internal';
    scope.dispatchEvent(new Event('change'));
    results.push({name:'linked object selection',
      pass:/refresh_students/i.test(d.getElementById('proc-name').textContent)&&
        /refresh_students/i.test(d.getElementById('sql').value)});
    results.push({name:'confidence and coverage display',
      pass:d.getElementById('coverage-val').textContent==='100%'&&
        /%$/.test(d.getElementById('confidence-val').textContent)&&
        /^\d+$/.test(d.getElementById('diagnostic-val').textContent)});
    var view=d.getElementById('opt-view');
    view.value='flow';
    view.dispatchEvent(new Event('change'));
    var flowCode=d.getElementById('mermaid-out').textContent;
    view.value='query';
    view.dispatchEvent(new Event('change'));
    var queryCode=d.getElementById('mermaid-out').textContent;
    results.push({name:'control flow and query structure selector',
      pass:flowCode!==queryCode&&/dbo\.export_students/.test(queryCode)&&
        d.getElementById('cc-label').textContent==='Moving parts'});

    setTimeout(function(){
      var node=d.querySelector('#stage .node[data-source-start]'),
          before=d.getElementById('sql').selectionEnd;
      if(node) node.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      results.push({name:'diagram source selection',
        pass:!!node&&d.getElementById('sql').selectionEnd>d.getElementById('sql').selectionStart&&
          d.getElementById('sql').selectionEnd!==before,
        detail:{nodeCount:d.querySelectorAll('#stage .node').length,
          linkedCount:d.querySelectorAll('#stage .node[data-source-start]').length,
          ids:Array.prototype.map.call(d.querySelectorAll('#stage .node'),function(n){return n.id;}),
          start:d.getElementById('sql').selectionStart,end:d.getElementById('sql').selectionEnd,before:before}});
      d.getElementById('sql').value='END SELECT (1;';
      d.getElementById('sql').dispatchEvent(new Event('input'));
      d.getElementById('opt-dialect').value='tsql';
      d.getElementById('btn-draw').click();
      results.push({name:'malformed input health warning',
        pass:parseInt(d.getElementById('coverage-val').textContent,10)<100&&
          parseInt(d.getElementById('diagnostic-val').textContent,10)>=2&&
          d.getElementById('analysis-health').getAttribute('data-band')==='low'});
      results.push({name:'local Mermaid runtime',
        pass:!!w.mermaid&&!Array.prototype.some.call(d.scripts,function(s){return /^https?:/i.test(s.src);})});
      finish(results);
    },1200);
  });
})();
