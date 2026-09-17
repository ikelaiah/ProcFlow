/* proc>flow v2.1.0 — ERD page controller.
   Parses schema DDL into the shared schema IR and draws an entity map of
   declared tables, views, and foreign keys. Declared constraints only: this
   page never infers a relationship from query text. */
(function(){
  if(typeof document==='undefined') return;
  var $=function(id: string): any { return document.getElementById(id); };
  var sql=$('erd-sql'), gutter=$('erd-gutter'), msg=$('erd-msg'),
      cardsHost=$('erd-cards'), overlay=$('erd-overlay'), canvas=$('erd-canvas'),
      empty=$('erd-empty'), mermaidOut=$('erd-mermaid-out'),
      inspector=$('erd-inspector'), largeNotice=$('erd-large-notice'),
      findInput=$('erd-find'), findCount=$('erd-find-count'),
      compactInput=$('erd-compact');
  var result: SchemaResult | null=null;
  var cardEls: Record<string, HTMLElement>={};
  var adjacency: Record<string, string[]>={};
  var relCounts: Record<string, number>={};
  var selectedId: string | null=null;
  var renderSeq=0;
  var compactMode=false, compactTouched=false;
  var findMatches: string[]=[], findIndex=0;
  var panning=false, panStartX=0, panStartY=0,
      panStartScrollLeft=0, panStartScrollTop=0, didPan=false;
  var dragMode: 'pan' | 'card' | null=null, dragCardId: string | null=null,
      dragBaseX=0, dragBaseY=0, dragLastDx=0, dragLastDy=0;
  var cardOffsets: Record<string, {x: number; y: number}>={};
  var overlayRaf=0;

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

  function compactSummary(entity: SchemaEntity): string {
    var fkColumns: Record<string, 1>={}, pkCount=0;
    entity.keys.forEach(function(key){
      if(key.kind==='pk') pkCount++;
      if(key.kind==='fk') key.columns.forEach(function(name){
        fkColumns[name.toUpperCase()]=1;
      });
    });
    return entity.columns.length+' cols \u00b7 '+pkCount+' PK \u00b7 '+
      Object.keys(fkColumns).length+' FK';
  }

  function buildCard(entity: SchemaEntity): HTMLElement {
    var card=document.createElement('article');
    card.className='erd-card'+(entity.unresolved?' unresolved':'')+
      (entity.kind==='view'?' view':'')+(compactMode?' compact':'');
    card.setAttribute('data-entity-id',entity.id);
    var head=document.createElement('header');
    var kind=document.createElement('span');
    kind.className='erd-kind';
    kind.textContent=entity.unresolved?'external':entity.kind;
    var title=document.createElement('h3');
    title.textContent=entity.name;
    head.appendChild(kind);
    head.appendChild(title);
    var count=relCounts[entity.id]||0;
    if(count){
      var badge=document.createElement('span');
      badge.className='erd-relcount';
      badge.title=count+' declared relationship'+(count===1?'':'s');
      badge.textContent=String(count);
      head.appendChild(badge);
    }
    card.appendChild(head);
    if(compactMode){
      var summary=document.createElement('p');
      summary.className='erd-summary';
      summary.textContent=compactSummary(entity);
      card.appendChild(summary);
    } else {
      var list=document.createElement('ul');
      list.className='erd-cols';
      if(entity.columns.length){
        var frag=document.createDocumentFragment();
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
          frag.appendChild(row);
        });
        list.appendChild(frag);
      } else {
        var none=document.createElement('li');
        none.className='erd-no-cols';
        none.textContent=entity.unresolved?'referenced but not declared':'no declared columns';
        list.appendChild(none);
      }
      card.appendChild(list);
    }
    card.tabIndex=0;
    card.addEventListener('click',function(){
      selectEntity(selectedId===entity.id?null:entity.id);
    });
    card.addEventListener('keydown',function(event: KeyboardEvent){
      if(event.key==='Enter'||event.key===' '){
        event.preventDefault();
        selectEntity(selectedId===entity.id?null:entity.id);
      }
    });
    card.addEventListener('dblclick',function(event: MouseEvent){
      event.preventDefault();
      if(cardOffsets[entity.id]){
        delete cardOffsets[entity.id];
        card.style.transform='';
        card.classList.remove('moved');
        scheduleOverlay();
      }
    });
    return card;
  }


  function selectEntity(id: string | null): void {
    selectedId=id;
    var related: Record<string, 1>={};
    if(selectedId){
      (adjacency[selectedId]||[]).forEach(function(other){ related[other]=1; });
    }
    Object.keys(cardEls).forEach(function(entityId){
      var card=cardEls[entityId];
      card.classList.toggle('focus',entityId===selectedId);
      card.classList.toggle('related',
        !!selectedId&&entityId!==selectedId&&related[entityId]===1);
      card.classList.toggle('dim',
        !!selectedId&&entityId!==selectedId&&related[entityId]!==1);
    });
    renderInspector();
    drawOverlay();
  }

  /* Find highlights matches and jumps between them (Enter / Shift+Enter). */
  function applyFind(jump: boolean): void {
    Object.keys(cardEls).forEach(function(id){ cardEls[id].classList.remove('match'); });
    findMatches=[];
    var query=(findInput?String(findInput.value||''):'').trim().toUpperCase();
    if(!query||!result){
      if(findCount) findCount.textContent='';
      return;
    }
    result.entities.forEach(function(entity){
      if(entity.name.toUpperCase().indexOf(query)>=0||entity.id.indexOf(query)>=0){
        findMatches.push(entity.id);
      }
    });
    findMatches.forEach(function(id){
      if(cardEls[id]) cardEls[id].classList.add('match');
    });
    if(findCount){
      findCount.textContent=findMatches.length
        ? findMatches.length+' match'+(findMatches.length===1?'':'es')
        : '0 matches';
    }
    if(jump&&findMatches.length){
      var id=findMatches[findIndex%findMatches.length];
      var card=cardEls[id];
      if(card&&card.scrollIntoView){
        card.scrollIntoView({block:'center',inline:'nearest',behavior:'smooth'});
      }
    }
  }

  /* Selection inspector: every declared FK touching the selected entity, with
     direction, column mapping, cardinality, and constraint name. Never inferred. */
  function renderInspector(): void {
    if(!inspector||!result) return;
    inspector.textContent='';
    var selected=selectedId?result.entities.filter(function(entity){
      return entity.id===selectedId;
    })[0]:null;
    if(!selected){
      inspector.hidden=true;
      return;
    }
    inspector.hidden=false;
    var head=document.createElement('header');
    var title=document.createElement('h4');
    title.textContent=selected.name;
    var clear=document.createElement('button');
    clear.type='button';
    clear.className='erd-inspector-close';
    clear.textContent='Clear';
    clear.addEventListener('click',function(){ selectEntity(null); });
    head.appendChild(title);
    head.appendChild(clear);
    inspector.appendChild(head);
    function group(label: string, rows: SchemaRelationship[], outgoing: boolean): void {
      if(!rows.length) return;
      var heading=document.createElement('p');
      heading.className='erd-inspector-group';
      heading.textContent=label;
      inspector.appendChild(heading);
      rows.forEach(function(rel){
        var otherId=outgoing?rel.fromId:rel.toId;
        var other=result.entities.filter(function(entity){
          return entity.id===otherId;
        })[0];
        var row=document.createElement('button');
        row.type='button';
        row.className='erd-rel-row';
        var arrow=document.createElement('span');
        arrow.className='erd-rel-arrow';
        arrow.textContent=outgoing?'\u2192':'\u2190';
        var name=document.createElement('span');
        name.className='erd-rel-name';
        name.textContent=other?other.name:otherId;
        var detail=document.createElement('span');
        detail.className='erd-rel-detail';
        detail.textContent=rel.toColumns.join(',')+' \u2192 '+
          (rel.fromColumns.join(',')||'PK');
        var meta=document.createElement('span');
        meta.className='erd-rel-meta';
        meta.textContent=(rel.cardinality==='one-to-one'?'1:1':'1:N')+
          (rel.optional?' optional':'')+(rel.name?' \u00b7 '+rel.name:'');
        row.appendChild(arrow);
        row.appendChild(name);
        row.appendChild(detail);
        row.appendChild(meta);
        row.title='Select '+name.textContent;
        row.addEventListener('click',function(){
          selectEntity(otherId);
          var card=cardEls[otherId];
          if(card&&card.scrollIntoView){
            card.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
          }
        });
        inspector.appendChild(row);
      });
    }
    group('References (FK out)',result.relationships.filter(function(rel){
      return rel.toId===selected.id;
    }),true);
    group('Referenced by (FK in)',result.relationships.filter(function(rel){
      return rel.fromId===selected.id&&rel.toId!==selected.id;
    }),false);
    if(!result.relationships.some(function(rel){
      return rel.fromId===selected.id||rel.toId===selected.id;
    })){
      var none=document.createElement('p');
      none.className='erd-inspector-empty';
      none.textContent='No declared foreign keys.';
      inspector.appendChild(none);
    }
  }

  /* Adjacency and degree are precomputed so selecting a hub table in an
     800-table estate stays O(degree) instead of O(tables × relationships). */
  function renderCards(): void {
    if(!cardsHost||!result) return;
    adjacency={};
    relCounts={};
    result.relationships.forEach(function(rel){
      (adjacency[rel.fromId]=adjacency[rel.fromId]||[]).push(rel.toId);
      (adjacency[rel.toId]=adjacency[rel.toId]||[]).push(rel.fromId);
      relCounts[rel.fromId]=(relCounts[rel.fromId]||0)+1;
      relCounts[rel.toId]=(relCounts[rel.toId]||0)+1;
    });
    if(!compactTouched&&result.entities.length>150){
      compactMode=true;
      if(compactInput) compactInput.checked=true;
    }
    cardsHost.classList.toggle('compact',compactMode);
    if(Object.keys(cardOffsets).length){
      var keptOffsets: Record<string, {x: number; y: number}>={};
      result.entities.forEach(function(entity){
        if(cardOffsets[entity.id]) keptOffsets[entity.id]=cardOffsets[entity.id];
      });
      cardOffsets=keptOffsets;
    }
    cardEls={};
    cardsHost.textContent='';
    var frag=document.createDocumentFragment();
    result.entities.forEach(function(entity){
      var card=buildCard(entity);
      var offset=cardOffsets[entity.id];
      if(offset&&(offset.x||offset.y)){
        card.style.transform='translate('+offset.x+'px,'+offset.y+'px)';
        card.classList.add('moved');
      }
      cardEls[entity.id]=card;
      frag.appendChild(card);
    });
    cardsHost.appendChild(frag);
    if(empty) empty.hidden=result.entities.length>0;
  }

  interface ErdBox {
    cx: number; cy: number;
    left: number; top: number; right: number; bottom: number;
  }

  var cachedCanvasRect: DOMRect | null=null;

  function entityBox(entityId: string): ErdBox | null {
    var el=cardEls[entityId], c=canvas;
    if(!el||!c) return null;
    var r=el.getBoundingClientRect(), cr=cachedCanvasRect||c.getBoundingClientRect();
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

  function scheduleOverlay(): void {
    if(overlayRaf) return;
    overlayRaf=requestAnimationFrame(function(){
      overlayRaf=0;
      drawOverlay();
    });
  }

  /* Manual placement: offsets survive re-renders (keyed by entity id) and are
     cleared per card by double-click or all at once by Reset layout. */
  function resetLayout(): void {
    cardOffsets={};
    Object.keys(cardEls).forEach(function(id){
      cardEls[id].style.transform='';
      cardEls[id].classList.remove('moved');
    });
    scheduleOverlay();
  }

  function currentZoom(): number {
    if(!canvas) return 1;
    var value=parseFloat(canvas.style.getPropertyValue('--erd-zoom'));
    return isNaN(value)?1:value;
  }

  function setZoom(value: number): void {
    if(!canvas) return;
    var zoom=Math.max(0.15,Math.min(2,value));
    canvas.style.setProperty('--erd-zoom',String(zoom));
    canvas.classList.toggle('zoomed-out',zoom<0.5);
    var label=$('erd-zoom-val');
    if(label) label.textContent=Math.round(zoom*100)+'%';
    drawOverlay();
  }

  function zoomBy(factor: number): void {
    if(!canvas) return;
    var from=currentZoom(), to=Math.max(0.15,Math.min(2,from*factor));
    var cx=(canvas.scrollLeft+canvas.clientWidth/2)/from;
    var cy=(canvas.scrollTop+canvas.clientHeight/2)/from;
    setZoom(to);
    canvas.scrollLeft=cx*to-canvas.clientWidth/2;
    canvas.scrollTop=cy*to-canvas.clientHeight/2;
  }

  /* Fit the whole estate, or — with a table selected — that table and its
     declared neighbours, so the highlighted entity is immediately readable. */
  function fitView(): void {
    if(!result||!canvas) return;
    var ids: string[]=selectedId
      ? [selectedId].concat(adjacency[selectedId]||[])
      : result.entities.map(function(entity){ return entity.id; });
    var minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    ids.forEach(function(id){
      var box=entityBox(id);
      if(!box) return;
      minX=Math.min(minX,box.left);
      minY=Math.min(minY,box.top);
      maxX=Math.max(maxX,box.right);
      maxY=Math.max(maxY,box.bottom);
    });
    if(minX===Infinity) return;
    var pad=40;
    var width=maxX-minX+pad*2, height=maxY-minY+pad*2;
    var from=currentZoom();
    var to=Math.max(0.15,Math.min(2,
      from*Math.min(canvas.clientWidth/width,canvas.clientHeight/height)));
    var ratio=to/from;
    setZoom(to);
    canvas.scrollLeft=(minX+maxX)/2*ratio-canvas.clientWidth/2;
    canvas.scrollTop=(minY+maxY)/2*ratio-canvas.clientHeight/2;
  }

  function drawOverlay(): void {
    if(!overlay||!canvas||!result) return;
    while(overlay.firstChild) overlay.removeChild(overlay.firstChild);
    var width=Math.max(cardsHost.scrollWidth+40,canvas.clientWidth);
    var height=Math.max(cardsHost.scrollHeight+40,canvas.clientHeight);
    overlay.setAttribute('width',String(width));
    overlay.setAttribute('height',String(height));
    overlay.setAttribute('viewBox','0 0 '+width+' '+height);
    cachedCanvasRect=canvas.getBoundingClientRect();
    var boxCache: Record<string, ErdBox | null>={};
    function boxOf(id: string): ErdBox | null {
      if(!(id in boxCache)) boxCache[id]=entityBox(id);
      return boxCache[id];
    }
    result.relationships.forEach(function(rel){
      var from=boxOf(rel.fromId), to=boxOf(rel.toId);
      if(!from||!to) return;
      var active=!!selectedId;
      var connected=!active||rel.fromId===selectedId||rel.toId===selectedId;
      var dash=rel.resolution==='exact'?'':(rel.resolution==='heuristic'?'7 4':'2 4');
      var color=rel.resolution==='opaque'?'#e4645e':
        (rel.resolution==='heuristic'?'#e8a33d':'#7ea6e0');
      var d: string, labelAt: {x: number; y: number}[], midAt: {x: number; y: number};
      if(rel.fromId===rel.toId){
        var loopX=from.right+10, loopY=from.cy;
        d='M '+from.right+' '+(from.top+14)+' C '+(loopX+34)+' '+(from.top-14)+', '+
          (loopX+34)+' '+(from.bottom+14)+', '+from.right+' '+(from.bottom-14);
        labelAt=[{x:loopX+30,y:from.top+6},{x:loopX+30,y:from.bottom-4}];
        midAt={x:loopX+34,y:loopY};
      } else {
        var p1=edgePoint(from,to.cx,to.cy), p2=edgePoint(to,from.cx,from.cy);
        var midX=(p1.x+p2.x)/2;
        d='M '+p1.x+' '+p1.y+' C '+midX+' '+p1.y+', '+midX+' '+p2.y+', '+p2.x+' '+p2.y;
        labelAt=[{x:p1.x+(p2.x-p1.x)*0.16,y:p1.y+(p2.y-p1.y)*0.16},
                 {x:p1.x+(p2.x-p1.x)*0.84,y:p1.y+(p2.y-p1.y)*0.84}];
        midAt={x:midX,y:(p1.y+p2.y)/2};
      }
      var path=svgEl('path',{d:d,fill:'none',stroke:color,
        'stroke-width':active&&connected?2.6:(connected?2:1.4),
        'stroke-dasharray':dash,opacity:active?(connected?0.95:0.07):0.95,
        'stroke-linecap':'round'});
      path.setAttribute('data-relationship',rel.id);
      overlay.appendChild(path);
      if(!active||connected){
        var leftLabel=rel.optional?'0..1':'1', rightLabel=rel.unique?'1':'N';
        [{text:leftLabel,at:labelAt[0]},{text:rightLabel,at:labelAt[1]}].forEach(function(item){
          var text=svgEl('text',{x:item.at.x,y:item.at.y,fill:color,'font-size':10,
            'font-family':'ui-monospace,Consolas,monospace',
            opacity:active?(connected?1:0.1):1,
            'text-anchor':'middle','dominant-baseline':'middle'});
          text.textContent=item.text;
          overlay.appendChild(text);
        });
      }
      if(active&&connected){
        var label=rel.name||(rel.toColumns.join(',')+ ' \u2192 '+
          (rel.fromColumns.join(',')||'PK'));
        var mid=svgEl('text',{x:midAt.x,y:midAt.y,fill:color,'font-size':10,
          'font-family':'ui-monospace,Consolas,monospace',
          stroke:'#101b23','stroke-width':3,'paint-order':'stroke',
          'text-anchor':'middle','dominant-baseline':'middle'});
        mid.textContent=label;
        overlay.appendChild(mid);
      }
    });
    /* At estate zoom the card ring scales away; the overlay is unzoomed, so
       draw the selection highlight here instead. */
    if(selectedId&&currentZoom()<0.5){
      var ring=boxOf(selectedId);
      if(ring){
        overlay.appendChild(svgEl('rect',{x:ring.left-5,y:ring.top-5,
          width:ring.right-ring.left+10,height:ring.bottom-ring.top+10,rx:6,
          fill:'none',stroke:'#e8a33d','stroke-width':2,'stroke-dasharray':'7 5'}));
      }
    }
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
    renderInspector();
    showDiagnostics();
    applyFind(false);
    updateLargeInputNotice();
    if(mermaidOut) mermaidOut.textContent=toMermaidER(result);
    var seq=++renderSeq;
    requestAnimationFrame(function(){
      if(seq!==renderSeq) return;
      drawOverlay();
    });
  }

  /* Large, exported-estate DDL must not reparse and rebuild hundreds of cards
     on every keystroke: auto-draw pauses above the shared local threshold and
     resumes when the input shrinks or Refresh is pressed. */
  function updateLargeInputNotice(): boolean {
    if(!sql) return false;
    var policy=largeInputPolicy(sql.value.length);
    if(largeNotice){
      largeNotice.hidden=!policy.large;
      if(policy.large){
        largeNotice.textContent='Large DDL ('+policy.length.toLocaleString('en-US')+
          ' characters). Auto-draw is paused — press Refresh (Ctrl+Enter) or edit below '+
          policy.threshold.toLocaleString('en-US')+' characters to resume live updates.';
      }
    }
    return policy.large;
  }

  function schedule(): void {
    if(updateLargeInputNotice()) return;
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

  if(findInput){
    findInput.addEventListener('input',function(){ findIndex=0; applyFind(true); });
    findInput.addEventListener('keydown',function(event: KeyboardEvent){
      if(event.key==='Enter'){
        event.preventDefault();
        if(findMatches.length){
          findIndex=event.shiftKey
            ? (findIndex-1+findMatches.length)%findMatches.length
            : (findIndex+1)%findMatches.length;
          applyFind(true);
        }
      } else if(event.key==='Escape'){
        findInput.value=''; findIndex=0; applyFind(false);
      }
    });
  }
  if(compactInput) compactInput.addEventListener('change',function(){
    compactTouched=true;
    compactMode=!!compactInput.checked;
    renderCards();
    applyFind(false);
    renderInspector();
    requestAnimationFrame(drawOverlay);
  });
  var resetLayoutBtn=$('btn-erd-reset-layout');
  if(resetLayoutBtn) resetLayoutBtn.addEventListener('click',resetLayout);
  var zoomOut=$('erd-z-out');
  if(zoomOut) zoomOut.addEventListener('click',function(){ zoomBy(1/1.25); });
  var zoomIn=$('erd-z-in');
  if(zoomIn) zoomIn.addEventListener('click',function(){ zoomBy(1.25); });
  var zoomFit=$('erd-z-fit');
  if(zoomFit) zoomFit.addEventListener('click',fitView);

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

  /* Drag on empty canvas pans; drag on a card moves that card so crowded
     relationships can be separated. Click still selects: a drag shorter than
     the threshold never suppresses the click, and a real drag always does. */
  if(canvas){
    canvas.addEventListener('pointerdown',function(event: PointerEvent){
      if(event.button!==0) return;
      var target=event.target as HTMLElement;
      var cardEl=target&&target.closest?target.closest('.erd-card') as HTMLElement:null;
      dragMode=cardEl?'card':'pan';
      dragCardId=cardEl?cardEl.getAttribute('data-entity-id'):null;
      panning=true; didPan=false;
      dragLastDx=0; dragLastDy=0;
      panStartX=event.clientX; panStartY=event.clientY;
      panStartScrollLeft=canvas.scrollLeft; panStartScrollTop=canvas.scrollTop;
      if(dragMode==='card'&&dragCardId){
        var offset=cardOffsets[dragCardId]||{x:0,y:0};
        dragBaseX=offset.x; dragBaseY=offset.y;
        if(cardEl) cardEl.classList.add('moving');
      } else {
        canvas.classList.add('dragging');
      }
    });
    document.addEventListener('pointermove',function(event: PointerEvent){
      if(!panning) return;
      var dx=event.clientX-panStartX, dy=event.clientY-panStartY;
      dragLastDx=dx; dragLastDy=dy;
      if(dragMode==='card'){
        if(Math.abs(dx)>4||Math.abs(dy)>4) didPan=true;
        if(didPan&&dragCardId&&cardEls[dragCardId]){
          var zoom=currentZoom();
          cardEls[dragCardId].style.transform=
            'translate('+(dragBaseX+dx/zoom)+'px,'+(dragBaseY+dy/zoom)+'px)';
          scheduleOverlay();
        }
        return;
      }
      if(Math.abs(dx)>6||Math.abs(dy)>6) didPan=true;
      canvas.scrollLeft=panStartScrollLeft-dx;
      canvas.scrollTop=panStartScrollTop-dy;
    });
    var endDrag=function(): void {
      if(!panning) return;
      if(dragMode==='card'&&dragCardId&&didPan){
        var endZoom=currentZoom();
        cardOffsets[dragCardId]={x:dragBaseX+dragLastDx/endZoom,
                                 y:dragBaseY+dragLastDy/endZoom};
        if(cardEls[dragCardId]){
          cardEls[dragCardId].classList.add('moved');
          cardEls[dragCardId].classList.remove('moving');
        }
      } else if(dragCardId&&cardEls[dragCardId]){
        cardEls[dragCardId].classList.remove('moving');
      }
      panning=false; dragMode=null; dragCardId=null;
      canvas.classList.remove('dragging');
    };
    document.addEventListener('pointerup',endDrag);
    document.addEventListener('pointercancel',endDrag);
    canvas.addEventListener('click',function(event: MouseEvent){
      if(didPan){ didPan=false; event.stopPropagation(); event.preventDefault(); }
    },true);
  }
  document.addEventListener('keydown',function(event: KeyboardEvent){
    if(event.key==='Escape'&&selectedId) selectEntity(null);
  });

  drawGutter();
  render();
  document.documentElement.setAttribute('data-procflow-ready',String(
    typeof parseSchema==='function'&&typeof toMermaidER==='function'));
})();
