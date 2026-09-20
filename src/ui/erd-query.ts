/* proc>flow v2.4.0 — ERD query-builder panel.
   Query mode turns column rows on the diagram cards into checkboxes and shows
   a floating window with the SQL, the join plan, and any unjoinable picks.
   Join problems are never resolved silently: each one offers teach-the-join,
   an explicit CROSS JOIN, or leaving the table out. */
(function(){
  if(typeof document==='undefined') return;

  var $=function(id: string): any { return document.getElementById(id); };
  var floatEl=$('qb-float'), bodyEl=$('qb-float-body'), planEl=$('qb-plan-body'),
      picksEl=$('qb-picks'), summaryEl=$('qb-summary'), sqlEl=$('qb-sql-out'),
      dialectEl=$('qb-dialect'), commentsEl=$('qb-comments'), copyBtn=$('btn-qb-copy'),
      clearBtn=$('btn-qb-clear'), toggleBtn=$('btn-erd-query'),
      countEl=$('erd-query-count'), closeBtn=$('btn-qb-close'),
      collapseBtn=$('btn-qb-collapse'), dragEl=$('qb-drag'),
      resizeEl=$('qb-resize'), distinctEl=$('qb-distinct'), limitEl=$('qb-limit'),
      onlyUsedEl=$('qb-only-used'), teachBtn=$('btn-qb-teach'),
      statusEl=$('qb-status');
  if(!planEl||!sqlEl||!floatEl||!toggleBtn) return;

  var active=false;
  var schema: SchemaResult | null=null;
  var graph: QueryGraph | null=null;
  var entityById: Record<string, SchemaEntity>={};
  var columnKeys: Record<string, StringSet>={};
  var picks: QueryColumnRef[]=[];
  var manual: QueryManualJoin[]=[];
  var cross: StringSet={};
  var excluded: StringSet={};
  var joinTypes: Record<string, QueryJoinType>={};
  var pathChoices: Record<string, number>={};
  var drafts: Record<string, QbDraft>={};
  var dialect: QueryDialect='tsql';
  var withComments=true;
  var distinct=false;
  var rowLimit=0;
  var onlyUsed=false;
  var teaching=false;
  var teachFirst: QueryColumnRef | null=null;
  var sorts: QuerySort[]=[];
  var plan: QueryPlan | null=null;
  var focusEntity: ((id: string) => void) | null=null;
  var manualSeq=0;

  function keyOf(entityId: string, column: string): string {
    return entityId+'|'+schemaNormColumn(column);
  }

  function splitValue(value: string): {id: string; column: string} {
    var cut=String(value||'').indexOf('|');
    if(cut<0) return {id:'',column:''};
    return {id:value.slice(0,cut),column:value.slice(cut+1)};
  }

  function buildIndexes(result: SchemaResult): void {
    entityById={}; columnKeys={};
    result.entities.forEach(function(entity){
      entityById[entity.id]=entity;
      var columns: StringSet={};
      entity.columns.forEach(function(column){
        columns[schemaNormColumn(column.name)]=1;
      });
      columnKeys[entity.id]=columns;
    });
  }

  /* ===== diagram decoration ===== */
  function state(): ErdQueryDecoration {
    var pickedKeys: Record<string, 1 | undefined>={};
    var counted: Record<string, number>={};
    picks.forEach(function(entry){
      pickedKeys[keyOf(entry.entityId,entry.column)]=1;
      counted[entry.entityId]=(counted[entry.entityId]||0)+1;
    });
    var usedEdges: Record<string, 1 | undefined>={};
    var usedTables: Record<string, 1 | undefined>={};
    var problemTables: Record<string, 1 | undefined>={};
    if(active&&plan&&plan.fromId){
      plan.usedIds.forEach(function(id){ usedTables[id]=1; });
      plan.joins.forEach(function(join){
        if(join.edgeId) usedEdges[join.edgeId]=1;
      });
      plan.problems.forEach(function(problem){
        problem.entityIds.forEach(function(id){ problemTables[id]=1; });
      });
    }
    return {active:active,
      teaching:active&&teaching,
      teachFirstKey:active&&teaching&&teachFirst
        ?teachFirst.entityId+'|'+schemaNormColumn(teachFirst.column)
        :undefined,
      pickedKeys:active?pickedKeys:{},
      picked:active?counted:{},
      usedEdges:usedEdges,
      usedTables:usedTables,
      problemTables:problemTables};
  }

  /* Checkbox state, badges, and rings are applied here rather than at card
     build time, so a pick update never rebuilds the whole diagram. */
  function decorate(): void {
    var current=state();
    var filterUsed=active&&onlyUsed;
    document.body.classList.toggle('qb-teaching',!!current.teaching);
    var cardsHost=document.getElementById('erd-cards');
    if(cardsHost) cardsHost.classList.toggle('qb-only-used',filterUsed);
    var cards=document.querySelectorAll('#erd-cards .erd-card');
    Array.prototype.forEach.call(cards,function(card: HTMLElement){
      var id=card.getAttribute('data-entity-id')||'';
      var pickedCount=current.picked[id]||0;
      card.classList.toggle('qb-picked-card',pickedCount>0);
      card.classList.toggle('qb-problem-card',!!current.problemTables[id]);
      card.classList.toggle('qb-used-card',filterUsed&&
        (!!current.usedTables[id]||!!current.problemTables[id]));
      Array.prototype.forEach.call(card.querySelectorAll('input.qb-pick'),function(box: HTMLInputElement){
        var column=box.getAttribute('data-column')||'';
        box.checked=!!current.pickedKeys[id+'|'+schemaNormColumn(column)];
      });
      Array.prototype.forEach.call(card.querySelectorAll('.erd-cols li[data-column]'),function(row: HTMLElement){
        var column=row.getAttribute('data-column')||'';
        row.classList.toggle('qb-picked',!!current.pickedKeys[id+'|'+schemaNormColumn(column)]);
        row.classList.toggle('qb-teach-first',!!current.teachFirstKey&&
          current.teachFirstKey===id+'|'+schemaNormColumn(column));
      });
      var badge=card.querySelector('.erd-qbcount') as HTMLElement | null;
      if(pickedCount){
        if(!badge){
          badge=document.createElement('b');
          badge.className='erd-qbcount';
          var head=card.querySelector('header');
          var pin=head?head.querySelector('.erd-pin'):null;
          if(head){
            if(pin) head.insertBefore(badge,pin);
            else head.appendChild(badge);
          }
        }
        badge.textContent=pickedCount+' picked';
      } else if(badge&&badge.parentNode){
        badge.parentNode.removeChild(badge);
      }
    });
  }

  /* ===== picking ===== */
  function togglePick(entityId: string, column: string, on: boolean): void {
    var key=keyOf(entityId,column);
    var next: QueryColumnRef[]=[];
    picks.forEach(function(entry){
      if(keyOf(entry.entityId,entry.column)!==key) next.push(entry);
    });
    picks=next;
    if(on){
      picks.push({entityId:entityId,column:column});
      delete excluded[entityId];
    }
    if(!on&&!picks.some(function(entry){ return entry.entityId===entityId; })){
      delete cross[entityId];
    }
    if(!on){
      sorts=sorts.filter(function(sort){
        return !(sort.entityId===entityId&&
          schemaNormColumn(sort.column)===schemaNormColumn(column));
      });
    }
    refresh();
  }

  function removePickAt(index: number): void {
    if(index<0||index>=picks.length) return;
    var entry=picks[index];
    togglePick(entry.entityId,entry.column,false);
  }

  /* Chip sort cycles none → ascending → descending → none. */
  function cycleSort(index: number): void {
    var entry=picks[index];
    if(!entry) return;
    var norm=schemaNormColumn(entry.column);
    var existing=sorts.filter(function(sort){
      return sort.entityId===entry.entityId&&
        schemaNormColumn(sort.column)===norm;
    })[0];
    if(!existing){
      sorts.push({entityId:entry.entityId,column:entry.column,direction:'asc'});
    } else if(existing.direction==='asc'){
      existing.direction='desc';
    } else {
      sorts=sorts.filter(function(sort){ return sort!==existing; });
    }
    refresh();
  }

  function renderChips(): void {
    if(!picksEl) return;
    picksEl.textContent='';
    picks.forEach(function(entry,index){
      var entity=entityById[entry.entityId];
      var name=entity?entity.name:entry.entityId;
      var sort=sorts.filter(function(existing){
        return existing.entityId===entry.entityId&&
          schemaNormColumn(existing.column)===schemaNormColumn(entry.column);
      })[0]||null;
      picksEl.appendChild(qbViewChip(name,entry,index,sort));
    });
  }

  /* ===== join plan ===== */
  function draftFor(problem: QueryProblem): QbDraft {
    var key=problem.entityIds[0];
    if(!drafts[key]){
      var leftId=problem.entityIds[0];
      var leftEntity=entityById[leftId];
      var rightId=(plan&&plan.usedIds.length?plan.usedIds[0]:null)||
        (graph?graph.order.filter(function(id){
          return problem.entityIds.indexOf(id)<0;
        })[0]:'')||'';
      var rightEntity=entityById[rightId];
      drafts[key]={
        left:leftId+'|'+(leftEntity&&leftEntity.columns.length?leftEntity.columns[0].name:''),
        right:rightId+'|'+(rightEntity&&rightEntity.columns.length?rightEntity.columns[0].name:''),
        predicate:'',
        usePredicate:false
      };
    }
    return drafts[key];
  }

  function renderProblems(): void {
    if(!plan) return;
    plan.problems.forEach(function(problem){
      planEl.appendChild(qbViewProblemCard(plan.graph,problem,
        draftFor(problem),teaching));
    });
  }

  function renderSummary(): void {
    if(!summaryEl) return;
    if(!plan||!plan.fromId){
      summaryEl.textContent='';
      return;
    }
    var parts: string[]=[];
    parts.push(plan.usedIds.length+' table'+(plan.usedIds.length===1?'':'s'));
    parts.push(plan.joins.length+' join'+(plan.joins.length===1?'':'s'));
    if(plan.bridges.length) parts.push(plan.bridges.length+' bridge');
    if(plan.problems.length){
      parts.push(plan.problems.length+
        (plan.problems.length===1?' table unjoined':' tables unjoined'));
    }
    summaryEl.textContent=parts.join(' · ');
  }

  function renderPlanBody(): void {
    planEl.textContent='';
    if(!plan||!plan.fromId){
      planEl.appendChild(qbViewEmptyPlan());
      return;
    }
    if(teaching){
      planEl.appendChild(qbViewTeachBanner(plan.graph,teachFirst));
    }
    plan.ambiguities.forEach(function(ambiguity){
      planEl.appendChild(qbViewAmbiguityCard(plan.graph,ambiguity));
    });
    plan.joins.forEach(function(join){
      planEl.appendChild(qbViewJoinCard(plan.graph,join,picks));
    });
    renderProblems();
    if(plan.warnings.length){
      plan.warnings.forEach(function(warning){
        var line=document.createElement('p');
        line.className='qb-verify';
        line.textContent='⚠ '+warning;
        planEl.appendChild(line);
      });
    }
    if(!distinct&&plan.warnings.some(function(warning){
      return warning.indexOf('repeat rows')>=0;
    })){
      var tip=document.createElement('p');
      tip.className='qb-tip';
      var tipText=document.createElement('span');
      tipText.textContent='Tip: Distinct can collapse rows repeated by one-to-many joins. ';
      var tipAction=document.createElement('button');
      tipAction.type='button';
      tipAction.className='qb-tip-action';
      tipAction.textContent='Turn on Distinct';
      tipAction.setAttribute('data-action','set-distinct');
      tip.appendChild(tipText);
      tip.appendChild(tipAction);
      planEl.appendChild(tip);
    }
    var learn=qbViewLearn(plan.education);
    if(learn) planEl.appendChild(learn);
  }

  var QUERY_SQL_TOKEN_CLASSES: Record<string, string>={keyword:'sql-kw',
    comment:'sql-comment',string:'sql-str',ident:'sql-ident',number:'sql-num',
    punct:'sql-punct'};

  function renderSql(): void {
    var text='';
    if(plan&&plan.fromId){
      text=queryPlanSQL(plan,{dialect:dialect,comments:withComments,
        distinct:distinct,rowLimit:rowLimit,orderBy:sorts});
    }
    if(!text){
      sqlEl.textContent='-- Pick columns on the diagram to generate SQL.';
      if(copyBtn) copyBtn.disabled=true;
      return;
    }
    sqlEl.textContent='';
    var frag=document.createDocumentFragment();
    queryTokenizeSQL(text).forEach(function(token){
      var className=QUERY_SQL_TOKEN_CLASSES[token.kind];
      if(!className){
        frag.appendChild(document.createTextNode(token.text));
        return;
      }
      var span=document.createElement('span');
      span.className=className;
      span.textContent=token.text;
      frag.appendChild(span);
    });
    sqlEl.appendChild(frag);
    if(copyBtn) copyBtn.disabled=false;
  }

  function renderCount(): void {
    if(!countEl) return;
    countEl.hidden=!picks.length;
    countEl.textContent=picks.length?String(picks.length):'';
    if(teachBtn){
      teachBtn.disabled=!picks.length;
      if(!picks.length&&teaching) cancelTeaching();
    }
  }

  function refresh(): void {
    var scrollTop=bodyEl?bodyEl.scrollTop:0;
    plan=active&&schema?queryBuildPlan({
      result:schema,
      selections:picks,
      manual:manual,
      cross:Object.keys(cross),
      excluded:Object.keys(excluded),
      joinTypes:joinTypes,
      pathChoices:pathChoices
    }):null;
    renderSummary();
    renderChips();
    renderPlanBody();
    renderSql();
    renderCount();
    decorate();
    if(statusEl) statusEl.textContent=statusMessage();
    if(bodyEl) bodyEl.scrollTop=scrollTop;
    document.dispatchEvent(new CustomEvent('procflow-query-changed'));
  }

  /* Live regions re-announce their whole subtree, so the panel publishes one
     concise sentence instead of the SQL and join cards. */
  function statusMessage(): string {
    if(!active) return '';
    if(teaching) return 'Teaching a join. Click a column on the diagram.';
    if(!plan||!plan.fromId) return 'No columns picked.';
    var parts: string[]=[
      plan.usedIds.length+' table'+(plan.usedIds.length===1?'':'s'),
      plan.joins.length+' join'+(plan.joins.length===1?'':'s')
    ];
    if(plan.problems.length){
      parts.push(plan.problems.length+
        (plan.problems.length===1?' table needs a join':' tables need a join'));
    }
    return 'SQL updated: '+parts.join(', ')+'.';
  }

  /* ===== actions ===== */
  function startTeaching(): void {
    teaching=true;
    teachFirst=null;
    if(teachBtn) teachBtn.setAttribute('aria-pressed','true');
    refresh();
  }

  function cancelTeaching(): void {
    teaching=false;
    teachFirst=null;
    if(teachBtn) teachBtn.setAttribute('aria-pressed','false');
    refresh();
  }

  /* One diagram click sets the first column; the second click completes the
     join. Two clicks on the same table create a self join. */
  function teachColumn(entityId: string, column: string): void {
    if(!teaching) return;
    if(!teachFirst){
      teachFirst={entityId:entityId,column:column};
      refresh();
      return;
    }
    if(teachFirst.entityId===entityId&&
       schemaNormColumn(teachFirst.column)===schemaNormColumn(column)){
      return;
    }
    manualSeq++;
    manual.push({id:'m'+manualSeq,
      leftId:teachFirst.entityId,leftColumn:teachFirst.column,
      rightId:entityId,rightColumn:column,
      selfColumns:teachFirst.entityId===entityId?[]:undefined});
    teaching=false;
    teachFirst=null;
    if(teachBtn) teachBtn.setAttribute('aria-pressed','false');
    refresh();
  }

  function teachJoin(problemKey: string): void {
    var draft=drafts[problemKey];
    if(!draft) return;
    var left=splitValue(draft.left), right=splitValue(draft.right);
    if(!left.id||!right.id||!left.column||!right.column) return;
    manualSeq++;
    var entry: QueryManualJoin={id:'m'+manualSeq,
      leftId:left.id,leftColumn:left.column,
      rightId:right.id,rightColumn:right.column};
    if(draft.usePredicate&&draft.predicate.trim()){
      entry.predicate=draft.predicate.trim();
    }
    manual.push(entry);
    delete drafts[problemKey];
    refresh();
  }

  function crossJoin(problemKey: string): void {
    if(!plan) return;
    var problem=plan.problems.filter(function(entry){
      return entry.entityIds[0]===problemKey;
    })[0];
    if(!problem) return;
    cross[problem.entityIds[0]]=1;
    delete drafts[problemKey];
    refresh();
  }

  function excludeProblem(problemKey: string): void {
    if(!plan) return;
    var problem=plan.problems.filter(function(entry){
      return entry.entityIds[0]===problemKey;
    })[0];
    if(!problem) return;
    problem.entityIds.forEach(function(id){
      excluded[id]=1;
      picks=picks.filter(function(entry){ return entry.entityId!==id; });
      sorts=sorts.filter(function(sort){ return sort.entityId!==id; });
      manual=manual.filter(function(entry){
        return entry.leftId!==id&&entry.rightId!==id;
      });
      delete cross[id];
    });
    delete drafts[problemKey];
    refresh();
  }

  function copySql(): void {
    var text=sqlEl.textContent||'';
    if(!text||text.indexOf('-- Pick')===0) return;
    var done=function(): void {
      if(!copyBtn) return;
      var old=copyBtn.textContent;
      copyBtn.textContent='Copied';
      setTimeout(function(){ copyBtn.textContent=old; },1400);
    };
    copyText(text,done);
  }

  /* ===== mode ===== */
  function setActive(on: boolean): void {
    active=on;
    toggleBtn.setAttribute('aria-pressed',String(on));
    floatEl.hidden=!on;
    document.body.classList.toggle('qb-active',on);
    if(!on){
      floatEl.classList.remove('collapsed');
      teaching=false;
      teachFirst=null;
      if(teachBtn) teachBtn.setAttribute('aria-pressed','false');
      if(collapseBtn){
        collapseBtn.textContent='−';
        collapseBtn.setAttribute('aria-label','Collapse query builder');
        collapseBtn.title='Collapse';
      }
      if(dialectEl) dialectEl.value=dialect;
      if(commentsEl) commentsEl.checked=withComments;
      sqlEl.textContent='';
    }
    document.dispatchEvent(new CustomEvent('procflow-query-mode',{detail:{active:on}}));
    refresh();
  }

  /* ===== schema changes ===== */
  function setSchema(result: SchemaResult): void {
    schema=result||null;
    if(!schema){
      graph=null;
      picks=[]; manual=[]; cross={}; excluded={}; drafts={};
      pathChoices={}; joinTypes={};
      refresh();
      return;
    }
    buildIndexes(schema);
    graph=queryBuildGraph(schema);
    var valid: StringSet={};
    graph.order.forEach(function(id){ valid[id]=1; });
    picks=picks.filter(function(entry){
      return valid[entry.entityId]&&columnKeys[entry.entityId]&&
        columnKeys[entry.entityId][schemaNormColumn(entry.column)];
    });
    sorts=sorts.filter(function(sort){
      return picks.some(function(entry){
        return entry.entityId===sort.entityId&&
          schemaNormColumn(entry.column)===schemaNormColumn(sort.column);
      });
    });
    manual=manual.filter(function(entry){
      return valid[entry.leftId]&&valid[entry.rightId]&&
        columnKeys[entry.leftId][schemaNormColumn(entry.leftColumn)]&&
        columnKeys[entry.rightId][schemaNormColumn(entry.rightColumn)];
    });
    var nextCross: StringSet={};
    Object.keys(cross).forEach(function(id){ if(valid[id]) nextCross[id]=1; });
    cross=nextCross;
    var nextExcluded: StringSet={};
    Object.keys(excluded).forEach(function(id){ if(valid[id]) nextExcluded[id]=1; });
    excluded=nextExcluded;
    var nextDrafts: Record<string, QbDraft>={};
    Object.keys(drafts).forEach(function(key){
      if(valid[key]) nextDrafts[key]=drafts[key];
    });
    drafts=nextDrafts;
    if(teachFirst&&(!valid[teachFirst.entityId]||
       !columnKeys[teachFirst.entityId]||
       !columnKeys[teachFirst.entityId][schemaNormColumn(teachFirst.column)])){
      teachFirst=null;
    }
    refresh();
  }

  /* ===== floating window drag and resize ===== */
  var dragging=false, dragStartX=0, dragStartY=0, dragOriginLeft=0, dragOriginTop=0;
  var resizing=false, resizeStartX=0, resizeStartY=0, resizeStartW=0, resizeStartH=0;
  var QB_MIN_WIDTH=320, QB_MIN_HEIGHT=200;

  /* The panel starts anchored to the right edge; once moved or resized it
     becomes freely positioned so both operations feel the same. */
  function anchorToLeftTop(): void {
    var parent=floatEl.offsetParent as HTMLElement;
    var rect=floatEl.getBoundingClientRect();
    var parentRect=parent?parent.getBoundingClientRect():{left:0,top:0};
    floatEl.style.left=(rect.left-parentRect.left)+'px';
    floatEl.style.top=(rect.top-parentRect.top)+'px';
    floatEl.style.right='auto';
  }

  function beginDrag(event: PointerEvent): void {
    if(event.button!==0) return;
    var target=event.target as HTMLElement;
    if(target&&target.closest&&target.closest('button')) return;
    anchorToLeftTop();
    dragStartX=event.clientX;
    dragStartY=event.clientY;
    dragOriginLeft=parseFloat(floatEl.style.left)||0;
    dragOriginTop=parseFloat(floatEl.style.top)||0;
    dragging=true;
    floatEl.classList.add('dragging');
    try {
      if(dragEl&&dragEl.setPointerCapture) dragEl.setPointerCapture(event.pointerId);
    } catch(_err){ /* pointer capture is best-effort */ }
  }

  function moveDrag(event: PointerEvent): void {
    if(!dragging) return;
    var parent=floatEl.offsetParent as HTMLElement;
    var maxLeft=parent?parent.clientWidth-60:0;
    var maxTop=parent?parent.clientHeight-60:0;
    var left=Math.max(-40,Math.min(maxLeft,dragOriginLeft+event.clientX-dragStartX));
    var top=Math.max(0,Math.min(maxTop,dragOriginTop+event.clientY-dragStartY));
    floatEl.style.left=left+'px';
    floatEl.style.top=top+'px';
  }

  function endDrag(): void {
    if(!dragging) return;
    dragging=false;
    floatEl.classList.remove('dragging');
  }

  function beginResize(event: PointerEvent): void {
    if(event.button!==0) return;
    event.preventDefault();
    var rect=floatEl.getBoundingClientRect();
    anchorToLeftTop();
    floatEl.style.maxHeight='none';
    floatEl.style.width=rect.width+'px';
    floatEl.style.height=rect.height+'px';
    resizeStartX=event.clientX;
    resizeStartY=event.clientY;
    resizeStartW=rect.width;
    resizeStartH=rect.height;
    resizing=true;
    floatEl.classList.add('dragging');
    try {
      if(resizeEl&&resizeEl.setPointerCapture) resizeEl.setPointerCapture(event.pointerId);
    } catch(_err){ /* pointer capture is best-effort */ }
  }

  function moveResize(event: PointerEvent): void {
    if(!resizing) return;
    var parent=floatEl.offsetParent as HTMLElement;
    var maxWidth=parent?parent.clientWidth-20:1200;
    var maxHeight=parent?parent.clientHeight-20:1200;
    var width=Math.max(QB_MIN_WIDTH,
      Math.min(maxWidth,resizeStartW+event.clientX-resizeStartX));
    var height=Math.max(QB_MIN_HEIGHT,
      Math.min(maxHeight,resizeStartH+event.clientY-resizeStartY));
    floatEl.style.width=width+'px';
    floatEl.style.height=height+'px';
  }

  function endResize(): void {
    if(!resizing) return;
    resizing=false;
    floatEl.classList.remove('dragging');
  }

  /* Keyboard resize keeps the grip usable without a pointer. */
  function resizeByKey(event: KeyboardEvent): void {
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].indexOf(event.key)<0) return;
    var step=event.shiftKey?40:16;
    var rect=floatEl.getBoundingClientRect();
    var width=rect.width, height=rect.height;
    if(event.key==='ArrowRight') width+=step;
    else if(event.key==='ArrowLeft') width-=step;
    else if(event.key==='ArrowDown') height+=step;
    else height-=step;
    event.preventDefault();
    anchorToLeftTop();
    floatEl.style.maxHeight='none';
    floatEl.style.width=Math.max(QB_MIN_WIDTH,width)+'px';
    floatEl.style.height=Math.max(QB_MIN_HEIGHT,height)+'px';
  }

  /* Hovering a join card lights up the exact edge and both endpoint cards,
     so the panel and the diagram stay one surface. */
  function highlightJoin(cardEl: HTMLElement, on: boolean): void {
    var edge=cardEl.getAttribute('data-edge');
    if(edge){
      var path=document.querySelector(
        '#erd-overlay path[data-relationship="'+edge+'"]');
      if(path) path.classList.toggle('qb-hover',on);
    }
    ['data-attach','data-entity'].forEach(function(attr){
      var id=cardEl.getAttribute(attr);
      if(!id) return;
      var diagramCard=document.querySelector(
        '#erd-cards .erd-card[data-entity-id="'+id+'"]');
      if(diagramCard) diagramCard.classList.toggle('qb-hover-card',on);
    });
  }

  function init(options?: {focusEntity?: (id: string) => void}): void {
    focusEntity=(options&&options.focusEntity)||null;
    toggleBtn.addEventListener('click',function(){ setActive(!active); });
    if(closeBtn) closeBtn.addEventListener('click',function(){ setActive(false); });
    if(collapseBtn) collapseBtn.addEventListener('click',function(){
      var collapsed=floatEl.classList.toggle('collapsed');
      collapseBtn.textContent=collapsed?'+':'−';
      collapseBtn.setAttribute('aria-label',collapsed?'Expand query builder':'Collapse query builder');
      collapseBtn.title=collapsed?'Expand':'Collapse';
    });
    if(dialectEl) dialectEl.addEventListener('change',function(){
      dialect=dialectEl.value as QueryDialect;
      renderSql();
    });
    if(commentsEl) commentsEl.addEventListener('change',function(){
      withComments=!!commentsEl.checked;
      renderSql();
    });
    if(distinctEl) distinctEl.addEventListener('change',function(){
      distinct=!!distinctEl.checked;
      refresh();
    });
    if(limitEl) limitEl.addEventListener('change',function(){
      rowLimit=parseInt(limitEl.value,10)||0;
      refresh();
    });
    if(onlyUsedEl) onlyUsedEl.addEventListener('change',function(){
      onlyUsed=!!onlyUsedEl.checked;
      refresh();
    });
    if(teachBtn) teachBtn.addEventListener('click',function(){
      if(teaching) cancelTeaching();
      else startTeaching();
    });
    document.addEventListener('keydown',function(event: KeyboardEvent){
      if(event.key==='Escape'){
        if(teaching) cancelTeaching();
        return;
      }
      if(event.key!=='q'&&event.key!=='Q') return;
      if(event.ctrlKey||event.metaKey||event.altKey) return;
      var target=event.target as HTMLElement;
      if(target&&(target.tagName==='INPUT'||target.tagName==='TEXTAREA'||
         target.tagName==='SELECT'||target.isContentEditable)) return;
      setActive(!active);
    });
    if(copyBtn) copyBtn.addEventListener('click',copySql);
    if(clearBtn) clearBtn.addEventListener('click',function(){
      picks=[]; manual=[]; cross={}; excluded={};
      joinTypes={}; pathChoices={}; drafts={}; sorts=[];
      refresh();
    });
    if(dragEl){
      dragEl.addEventListener('pointerdown',beginDrag);
      dragEl.addEventListener('pointermove',moveDrag);
      dragEl.addEventListener('pointerup',endDrag);
      dragEl.addEventListener('pointercancel',endDrag);
    }
    if(resizeEl){
      resizeEl.addEventListener('pointerdown',beginResize);
      resizeEl.addEventListener('pointermove',moveResize);
      resizeEl.addEventListener('pointerup',endResize);
      resizeEl.addEventListener('pointercancel',endResize);
      resizeEl.addEventListener('keydown',resizeByKey);
    }
    if(picksEl) picksEl.addEventListener('click',function(event: Event){
      var target=event.target as HTMLElement;
      if(!target||!target.getAttribute) return;
      var index=parseInt(target.getAttribute('data-index')||'',10);
      var action=target.getAttribute('data-action');
      if(action==='remove') removePickAt(index);
      else if(action==='sort') cycleSort(index);
      else if(action==='reveal'){
        var entry=picks[index];
        if(entry&&focusEntity) focusEntity(entry.entityId);
      }
    });
    planEl.addEventListener('mouseover',function(event: Event){
      var target=event.target as HTMLElement;
      var card=target&&target.closest
        ?target.closest('.qb-join[data-edge]') as HTMLElement:null;
      if(!card) return;
      var related=(event as MouseEvent).relatedTarget as Node;
      if(related&&card.contains(related)) return;
      highlightJoin(card,true);
    });
    planEl.addEventListener('mouseout',function(event: Event){
      var target=event.target as HTMLElement;
      var card=target&&target.closest
        ?target.closest('.qb-join[data-edge]') as HTMLElement:null;
      if(!card) return;
      var related=(event as MouseEvent).relatedTarget as Node;
      if(related&&card.contains(related)) return;
      highlightJoin(card,false);
    });
    planEl.addEventListener('change',function(event: Event){
      var target=event.target as HTMLInputElement;
      if(!target||!target.getAttribute) return;
      var role=target.getAttribute('data-role');
      if(role==='join-type'){
        var joinId=target.getAttribute('data-join');
        if(joinId) joinTypes[joinId]=target.value as QueryJoinType;
        refresh();
        return;
      }
      if(role==='path-choice'){
        var choiceKey=target.getAttribute('data-key');
        if(choiceKey) pathChoices[choiceKey]=parseInt(target.value,10)||0;
        refresh();
        return;
      }
      if(role==='copy-column'){
        var manualId=target.getAttribute('data-join');
        var copyColumn=target.getAttribute('data-column')||'';
        var copyEntry=manual.filter(function(candidate){
          return candidate.id===manualId;
        })[0];
        if(copyEntry){
          var nextColumns=(copyEntry.selfColumns||[]).filter(function(name){
            return schemaNormColumn(name)!==schemaNormColumn(copyColumn);
          });
          if(target.checked) nextColumns.push(copyColumn);
          copyEntry.selfColumns=nextColumns;
          refresh();
        }
        return;
      }
      var problemKey=target.getAttribute('data-problem');
      if(!problemKey) return;
      var draft=drafts[problemKey];
      if(!draft) return;
      if(role==='teach-left') draft.left=target.value;
      else if(role==='teach-right') draft.right=target.value;
      else if(role==='use-predicate'){
        draft.usePredicate=target.checked;
        refresh();
      }
    });
    planEl.addEventListener('input',function(event: Event){
      var target=event.target as HTMLInputElement;
      if(!target||!target.getAttribute) return;
      if(target.getAttribute('data-role')!=='predicate') return;
      var problemKey=target.getAttribute('data-problem');
      var draft=problemKey?drafts[problemKey]:null;
      if(draft) draft.predicate=target.value;
    });
    planEl.addEventListener('click',function(event: Event){
      var target=event.target as HTMLElement;
      if(!target||!target.getAttribute) return;
      var action=target.getAttribute('data-action');
      if(action==='focus'){
        var entityId=target.getAttribute('data-entity');
        if(entityId&&focusEntity) focusEntity(entityId);
        return;
      }
      if(action==='set-distinct'){
        distinct=true;
        if(distinctEl) distinctEl.checked=true;
        refresh();
        return;
      }
      if(action==='teach-click'){
        startTeaching();
        return;
      }
      if(action==='cancel-teach'){
        cancelTeaching();
        return;
      }
      var problemKey=target.getAttribute('data-problem');
      if(!problemKey) return;
      if(action==='teach') teachJoin(problemKey);
      else if(action==='cross') crossJoin(problemKey);
      else if(action==='exclude') excludeProblem(problemKey);
    });
  }

  window.erdQueryPanelInit=init;
  window.erdQueryPanelSetSchema=setSchema;
  window.erdQueryPanelState=state;
  window.erdQueryPanelDecorate=decorate;
  window.erdQueryPanelTogglePick=togglePick;
  window.erdQueryPanelTeachColumn=teachColumn;
})();
