/* proc>flow v2.1.0 — ERD page controller.
   Parses schema DDL into the shared schema IR and draws an entity map of
   declared tables, views, and foreign keys. Declared constraints only: this
   page never infers a relationship from query text. */
(function(){
  if(typeof document==='undefined') return;
  var $=function(id: string): any { return document.getElementById(id); };
  var sql=$('erd-sql'), gutter=$('erd-gutter'), msg=$('erd-msg'),
      cardsHost=$('erd-cards'), overlay=$('erd-overlay'), canvas=$('erd-canvas'),
      empty=$('erd-empty'), mermaidOut=$('erd-mermaid-out');
  var result: SchemaResult | null=null;
  var cardEls: Record<string, HTMLElement>={};
  var selectedId: string | null=null;
  var renderSeq=0;

  function drawGutter(): void {
    if(!gutter||!sql) return;
    var lines=sql.value.split('\n').length, out='';
    for(var i=1;i<=lines;i++) out+=(i>1?'\n':'')+i;
    gutter.textContent=out; gutter.scrollTop=sql.scrollTop;
  }

  function setStat(id: string, value: number): void {
    var el=$(id); if(el) el.textContent=String(value);
  }

  function showDiagnostics(): void {
    if(!msg||!result) return;
    msg.textContent=''; msg.classList.remove('show','warn');
    var list=result.diagnostics||[];
    if(!list.length) return;
    var errors=list.filter(function(d){ return d.severity==='error'; }).length;
    msg.classList.add('show');
    if(!errors) msg.classList.add('warn');
    list.forEach(function(d){
      var line=document.createElement('span');
      line.className='diag'+(d.severity==='info'?' info':'');
      line.textContent=d.message+(d.span?'  ('+d.span.start+'–'+d.span.end+')':'');
      msg.appendChild(line);
    });
  }

  function relationCount(entityId: string): number {
    if(!result) return 0;
    return result.relationships.filter(function(rel){
      return rel.fromId===entityId||rel.toId===entityId;
    }).length;
  }

  function buildCard(entity: SchemaEntity): HTMLElement {
    var card=document.createElement('article');
    card.className='erd-card'+(entity.unresolved?' unresolved':'')+
      (entity.kind==='view'?' view':'');
    card.setAttribute('data-entity-id',entity.id);
    var head=document.createElement('header');
    var kind=document.createElement('span');
    kind.className='erd-kind';
    kind.textContent=entity.unresolved?'external':entity.kind;
    var title=document.createElement('h3');
    title.textContent=entity.name;
    head.appendChild(kind);
    head.appendChild(title);
    var count=relationCount(entity.id);
    if(count){
      var badge=document.createElement('span');
      badge.className='erd-relcount';
      badge.title=count+' declared relationship'+(count===1?'':'s');
      badge.textContent=String(count);
      head.appendChild(badge);
    }
    card.appendChild(head);
    var list=document.createElement('ul');
    list.className='erd-cols';
    if(entity.columns.length){
      entity.columns.forEach(function(column){
        var row=document.createElement('li');
        var name=document.createElement('span');
        name.className='erd-col-name';
        name.textContent=column.name;
        var type=document.createElement('span');
        type.className='erd-col-type';
        type.textContent=column.type||'—';
        type.title=column.type||'no declared type';
        var flags=document.createElement('span');
        flags.className='erd-badges';
        erdColumnKeys(entity,column).forEach(function(key){
          var tag=document.createElement('b');
          tag.className='erd-badge erd-badge-'+key.toLowerCase();
          tag.textContent=key;
          flags.appendChild(tag);
        });
        if(column.identity){
          var idTag=document.createElement('b');
          idTag.className='erd-badge erd-badge-id';
          idTag.textContent='ID';
          idTag.title='identity / auto-increment';
          flags.appendChild(idTag);
        }
        if(column.generated||column.computed){
          var genTag=document.createElement('b');
          genTag.className='erd-badge erd-badge-gen';
          genTag.textContent=column.computed?'COMP':'GEN';
          genTag.title=column.computed?'computed column':'generated column';
          flags.appendChild(genTag);
        }
        if(!column.nullable){
          var nnTag=document.createElement('b');
          nnTag.className='erd-badge erd-badge-nn';
          nnTag.textContent='NN';
          nnTag.title='not null';
          flags.appendChild(nnTag);
        }
        row.appendChild(name);
        row.appendChild(type);
        row.appendChild(flags);
        list.appendChild(row);
      });
    } else {
      var none=document.createElement('li');
      none.className='erd-no-cols';
      none.textContent=entity.unresolved?'referenced but not declared':'no declared columns';
      list.appendChild(none);
    }
    card.appendChild(list);
    card.addEventListener('click',function(){
      selectedId=selectedId===entity.id?null:entity.id;
      Object.keys(cardEls).forEach(function(id){
        cardEls[id].classList.toggle('focus',id===selectedId);
      });
      drawOverlay();
    });
    return card;
  }

  function renderCards(): void {
    if(!cardsHost||!result) return;
    cardEls={};
    cardsHost.textContent='';
    result.entities.forEach(function(entity){
      var card=buildCard(entity);
      cardEls[entity.id]=card;
      cardsHost.appendChild(card);
    });
    if(empty) empty.hidden=result.entities.length>0;
  }

  interface ErdBox {
    cx: number; cy: number;
    left: number; top: number; right: number; bottom: number;
  }

  function entityBox(entityId: string): ErdBox | null {
    var el=cardEls[entityId], c=canvas;
    if(!el||!c) return null;
    var r=el.getBoundingClientRect(), cr=c.getBoundingClientRect();
    var left=r.left-cr.left+c.scrollLeft, top=r.top-cr.top+c.scrollTop;
    return {left:left,top:top,right:left+r.width,bottom:top+r.height,
            cx:left+r.width/2,cy:top+r.height/2};
  }

  /* Intersection of the line from a box centre toward (tx, ty) with the box
     edge, so relationship lines stop at the entity border. */
  function edgePoint(box: ErdBox, tx: number, ty: number): {x: number; y: number} {
    var dx=tx-box.cx, dy=ty-box.cy;
    if(!dx&&!dy) return {x:box.cx,y:box.cy};
    var sx=dx?Math.abs((box.right-box.left)/2/dx):Infinity;
    var sy=dy?Math.abs((box.bottom-box.top)/2/dy):Infinity;
    var s=Math.min(sx,sy);
    return {x:box.cx+dx*s,y:box.cy+dy*s};
  }

  function svgEl(name: string, attrs?: Record<string, string|number>): SVGElement {
    var el=document.createElementNS('http://www.w3.org/2000/svg',name);
    if(attrs) Object.keys(attrs).forEach(function(k){ el.setAttribute(k,String(attrs[k])); });
    return el;
  }

  function drawOverlay(): void {
    if(!overlay||!canvas||!result) return;
    while(overlay.firstChild) overlay.removeChild(overlay.firstChild);
    var width=Math.max(cardsHost.scrollWidth+40,canvas.clientWidth);
    var height=Math.max(cardsHost.scrollHeight+40,canvas.clientHeight);
    overlay.setAttribute('width',String(width));
    overlay.setAttribute('height',String(height));
    overlay.setAttribute('viewBox','0 0 '+width+' '+height);
    result.relationships.forEach(function(rel){
      var from=entityBox(rel.fromId), to=entityBox(rel.toId);
      if(!from||!to) return;
      var focused=!selectedId||rel.fromId===selectedId||rel.toId===selectedId;
      var dash=rel.resolution==='exact'?'':(rel.resolution==='heuristic'?'7 4':'2 4');
      var color=rel.resolution==='opaque'?'#e4645e':
        (rel.resolution==='heuristic'?'#e8a33d':'#7ea6e0');
      var d: string, labelAt: {x: number; y: number}[];
      if(rel.fromId===rel.toId){
        var loopX=from.right+10, loopY=from.cy;
        d='M '+from.right+' '+(from.top+14)+' C '+(loopX+34)+' '+(from.top-14)+', '+
          (loopX+34)+' '+(from.bottom+14)+', '+from.right+' '+(from.bottom-14);
        labelAt=[{x:loopX+30,y:from.top+6},{x:loopX+30,y:from.bottom-4}];
      } else {
        var p1=edgePoint(from,to.cx,to.cy), p2=edgePoint(to,from.cx,from.cy);
        var midX=(p1.x+p2.x)/2;
        d='M '+p1.x+' '+p1.y+' C '+midX+' '+p1.y+', '+midX+' '+p2.y+', '+p2.x+' '+p2.y;
        labelAt=[{x:p1.x+(p2.x-p1.x)*0.16,y:p1.y+(p2.y-p1.y)*0.16},
                 {x:p1.x+(p2.x-p1.x)*0.84,y:p1.y+(p2.y-p1.y)*0.84}];
      }
      var path=svgEl('path',{d:d,fill:'none',stroke:color,'stroke-width':focused?2:1.4,
        'stroke-dasharray':dash,opacity:focused?0.95:0.18,'stroke-linecap':'round'});
      path.setAttribute('data-relationship',rel.id);
      overlay.appendChild(path);
      var leftLabel=rel.optional?'0..1':'1', rightLabel=rel.unique?'1':'N';
      [{text:leftLabel,at:labelAt[0]},{text:rightLabel,at:labelAt[1]}].forEach(function(item){
        var text=svgEl('text',{x:item.at.x,y:item.at.y,fill:color,'font-size':10,
          'font-family':'ui-monospace,Consolas,monospace',opacity:focused?1:0.25,
          'text-anchor':'middle','dominant-baseline':'middle'});
        text.textContent=item.text;
        overlay.appendChild(text);
      });
    });
  }

  function render(): void {
    if(!sql) return;
    var text=sql.value;
    result=parseSchema(text);
    setStat('erd-tables',result.stats.tables);
    setStat('erd-views',result.stats.views);
    setStat('erd-columns',result.stats.columns);
    setStat('erd-relationships',result.stats.relationships);
    setStat('erd-unresolved',result.stats.unresolved);
    setStat('erd-diagnostics',result.diagnostics.length);
    selectedId=null;
    renderCards();
    showDiagnostics();
    if(mermaidOut) mermaidOut.textContent=toMermaidER(result);
    var seq=++renderSeq;
    requestAnimationFrame(function(){
      if(seq!==renderSeq) return;
      drawOverlay();
    });
  }

  function schedule(): void {
    if(scheduleTimer!==null) clearTimeout(scheduleTimer);
    scheduleTimer=setTimeout(render,220);
  }
  var scheduleTimer: ReturnType<typeof setTimeout> | null=null;

  function tab(which: 'diagram'|'mermaid'): void {
    var diagram=$('view-erd-diagram'), mermaid=$('view-erd-mermaid');
    var diagramTab=$('tab-erd-diagram'), mermaidTab=$('tab-erd-mermaid');
    if(!diagram||!mermaid||!diagramTab||!mermaidTab) return;
    var showDiagram=which==='diagram';
    diagram.classList.toggle('active',showDiagram);
    mermaid.classList.toggle('active',!showDiagram);
    diagramTab.setAttribute('aria-selected',String(showDiagram));
    mermaidTab.setAttribute('aria-selected',String(!showDiagram));
    if(showDiagram) requestAnimationFrame(drawOverlay);
  }

  function flash(btn: HTMLElement, word: string): void {
    if(!btn) return;
    var old=btn.textContent;
    btn.textContent=word;
    setTimeout(function(){ btn.textContent=old; },1400);
  }

  function copyMermaid(): void {
    var text=mermaidOut?mermaidOut.textContent:'';
    var done=function(): void { flash($('btn-erd-copy'),'Copied'); };
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done,function(){ fallbackCopy(text,done); });
    } else fallbackCopy(text,done);
  }

  function fallbackCopy(text: string, done: () => void): void {
    var area=document.createElement('textarea');
    area.value=text; area.setAttribute('readonly','');
    area.style.position='absolute'; area.style.left='-9999px';
    document.body.appendChild(area); area.select();
    try { document.execCommand('copy'); done(); } catch(err){ /* clipboard unavailable */ }
    document.body.removeChild(area);
  }

  if(sql){
    sql.value='';
    sql.addEventListener('input',schedule);
    sql.addEventListener('scroll',function(){ if(gutter) gutter.scrollTop=sql.scrollTop; });
    sql.addEventListener('keydown',function(event: KeyboardEvent){
      if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){ event.preventDefault(); render(); }
    });
  }
  var sample=$('btn-erd-sample');
  if(sample) sample.addEventListener('click',function(){
    if(!sql) return;
    sql.value=PROCFLOW_ERD_SAMPLE_TSQL; drawGutter(); render(); sql.focus();
  });
  var sampleDb2=$('btn-erd-sample-db2');
  if(sampleDb2) sampleDb2.addEventListener('click',function(){
    if(!sql) return;
    sql.value=PROCFLOW_ERD_SAMPLE_DB2; drawGutter(); render(); sql.focus();
  });
  var clear=$('btn-erd-clear');
  if(clear) clear.addEventListener('click',function(){
    if(!sql) return;
    sql.value=''; drawGutter(); render(); sql.focus();
  });
  var draw=$('btn-erd-draw');
  if(draw) draw.addEventListener('click',render);
  var copy=$('btn-erd-copy');
  if(copy) copy.addEventListener('click',copyMermaid);
  var tabDiagram=$('tab-erd-diagram');
  if(tabDiagram) tabDiagram.addEventListener('click',function(){ tab('diagram'); });
  var tabMermaid=$('tab-erd-mermaid');
  if(tabMermaid) tabMermaid.addEventListener('click',function(){ tab('mermaid'); });

  var fileInput=$('erd-file-input');
  var importBtn=$('btn-erd-import');
  if(importBtn&&fileInput) importBtn.addEventListener('click',function(){ fileInput.click(); });
  if(fileInput) fileInput.addEventListener('change',function(){
    var files=Array.prototype.slice.call(fileInput.files||[]);
    if(!files.length) return;
    Promise.all(files.map(function(file: File){
      return file.text();
    })).then(function(texts: string[]){
      if(!sql) return;
      var joined=sql.value.trim();
      texts.forEach(function(text){
        joined=(joined?joined+'\nGO\n':'')+text;
      });
      sql.value=joined; drawGutter(); render();
      fileInput.value='';
    });
  });

  window.addEventListener('resize',function(){ requestAnimationFrame(drawOverlay); });
  if(typeof ResizeObserver!=='undefined'&&cardsHost){
    new ResizeObserver(function(){ drawOverlay(); }).observe(cardsHost);
  }

  drawGutter();
  render();
  document.documentElement.setAttribute('data-procflow-ready',String(
    typeof parseSchema==='function'&&typeof toMermaidER==='function'));
})();
