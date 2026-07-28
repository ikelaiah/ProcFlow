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
      results.push({name:'local Mermaid runtime',
        pass:!!w.mermaid&&!Array.prototype.some.call(d.scripts,function(s){return /^https?:/i.test(s.src);})});
      finish(results);
    },1200);
  });
})();
