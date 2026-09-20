/* proc>flow v2.4.1 — ERD query-builder view builders.
   Pure DOM construction for the floating window: chips, join cards, problem
   cards, ambiguity choices, the teaching banner, and the learn list. These
   functions hold no state and attach no listeners; every interaction is wired
   through data-* attributes by src/ui/erd-query.ts. */
interface QbDraft {
  left: string;
  right: string;
  predicate: string;
  usePredicate: boolean;
}

function qbViewTag(text: string, className?: string): HTMLElement {
  var tagEl=document.createElement('span');
  tagEl.className='qb-tag'+(className?' '+className:'');
  tagEl.textContent=text;
  return tagEl;
}

function qbViewShowButton(entityId: string): HTMLElement {
  var button=document.createElement('button');
  button.type='button';
  button.className='btn quiet';
  button.textContent='Show';
  button.setAttribute('data-action','focus');
  button.setAttribute('data-entity',entityId);
  button.title='Show this table on the diagram';
  return button;
}

function qbViewEmptyPlan(): HTMLElement {
  var box=document.createElement('div');
  box.className='qb-empty';
  var title=document.createElement('h4');
  title.textContent='Pick columns on the diagram';
  var line=document.createElement('p');
  line.textContent='Every table card now shows a checkbox per column. ProcFlow follows declared FOREIGN KEY constraints to work out the joins while you pick.';
  var steps=document.createElement('ol');
  steps.className='qb-steps';
  ['Tick the columns you need.',
   'Watch the highlighted edges and the join plan below.',
   'Copy the SQL into your database client.'].forEach(function(text){
    var item=document.createElement('li');
    item.textContent=text;
    steps.appendChild(item);
  });
  var hint=document.createElement('p');
  hint.className='qb-hint';
  hint.textContent='No foreign key between two tables? ProcFlow says so and lets you teach the join. It never invents one.';
  box.appendChild(title);
  box.appendChild(line);
  box.appendChild(steps);
  box.appendChild(hint);
  return box;
}

function qbViewTeachBanner(graph: QueryGraph,
                           teachFirst: QueryColumnRef | null): HTMLElement {
  var banner=document.createElement('div');
  banner.className='qb-teach-banner';
  var text=document.createElement('span');
  text.textContent=teachFirst
    ?'First column set ('+queryNameOf(graph,teachFirst.entityId)+'.'+
      teachFirst.column+'). Click the matching column on the other table — or on the same table for a self join.'
    :'Click the first column of the join condition on the diagram.';
  var cancel=document.createElement('button');
  cancel.type='button';
  cancel.className='qb-tip-action';
  cancel.textContent='Cancel';
  cancel.setAttribute('data-action','cancel-teach');
  banner.appendChild(text);
  banner.appendChild(cancel);
  return banner;
}

function qbViewChip(entityName: string, entry: QueryColumnRef, index: number,
                    sort: QuerySort | null): HTMLElement {
  var chip=document.createElement('span');
  chip.className='qb-chip';
  var label=document.createElement('button');
  label.type='button';
  label.className='qb-chip-name';
  label.textContent=entityName+'.'+entry.column;
  label.title='Show '+entityName+' on the diagram';
  label.setAttribute('data-action','reveal');
  label.setAttribute('data-index',String(index));
  var sortBtn=document.createElement('button');
  sortBtn.type='button';
  sortBtn.className='qb-chip-sort'+(sort?' active':'');
  sortBtn.textContent=sort?(sort.direction==='asc'?'↑':'↓'):'⇅';
  sortBtn.title=sort
    ?(sort.direction==='asc'
      ?'Sorted ascending — click for descending'
      :'Sorted descending — click to clear')
    :'Sort by this column';
  sortBtn.setAttribute('aria-label',sortBtn.title);
  sortBtn.setAttribute('data-action','sort');
  sortBtn.setAttribute('data-index',String(index));
  var remove=document.createElement('button');
  remove.type='button';
  remove.className='qb-chip-x';
  remove.textContent='×';
  remove.setAttribute('aria-label','Remove '+entityName+'.'+entry.column);
  remove.setAttribute('data-action','remove');
  remove.setAttribute('data-index',String(index));
  chip.appendChild(label);
  chip.appendChild(sortBtn);
  chip.appendChild(remove);
  return chip;
}

function qbViewJoinConditionText(graph: QueryGraph, join: QueryJoin): string {
  if(join.kind==='cross') return 'every row × every row';
  if(join.predicate) return join.predicate;
  var attachName=queryNameOf(graph,join.attachToId);
  var targetName=queryNameOf(graph,join.entityId);
  var parts: string[]=[];
  var count=Math.min(join.leftColumns.length,join.rightColumns.length);
  for(var i=0;i<count;i++){
    parts.push(attachName+'.'+join.leftColumns[i]+' = '+
      targetName+'.'+join.rightColumns[i]);
  }
  return parts.join(' AND ');
}

function qbViewAmbiguityCard(graph: QueryGraph,
                             ambiguity: QueryAmbiguity): HTMLElement {
  var card=document.createElement('div');
  card.className='qb-join';
  var head=document.createElement('div');
  head.className='qb-join-head';
  var title=document.createElement('strong');
  title.className='qb-join-title';
  title.textContent='Two declared paths reach '+queryNameOf(graph,ambiguity.fromId);
  head.appendChild(title);
  head.appendChild(qbViewTag('choose a path','qb-tag-heuristic'));
  card.appendChild(head);
  var list=document.createElement('ul');
  list.className='qb-choices';
  var choiceKey=ambiguity.fromId+'=>'+ambiguity.toId;
  ambiguity.paths.forEach(function(path,index){
    var item=document.createElement('li');
    var label=document.createElement('label');
    var radio=document.createElement('input');
    radio.type='radio';
    radio.name='qb-ambiguity-'+choiceKey;
    radio.checked=index===ambiguity.chosenIndex;
    radio.setAttribute('data-role','path-choice');
    radio.setAttribute('data-key',choiceKey);
    radio.value=String(index);
    var text=document.createElement('span');
    text.textContent=ambiguity.summaries[index];
    label.appendChild(radio);
    label.appendChild(text);
    item.appendChild(label);
    list.appendChild(item);
  });
  card.appendChild(list);
  var note=document.createElement('p');
  note.className='qb-join-note';
  note.textContent='These joins mean different things. The first declared constraint is used until you pick another path.';
  card.appendChild(note);
  return card;
}

function qbViewJoinCard(graph: QueryGraph, join: QueryJoin,
                        picks: QueryColumnRef[]): HTMLElement {
  var card=document.createElement('div');
  card.className='qb-join';
  card.setAttribute('data-edge',join.edgeId||'');
  card.setAttribute('data-attach',join.attachToId);
  card.setAttribute('data-entity',join.entityId);
  var head=document.createElement('div');
  head.className='qb-join-head';
  if(join.kind==='cross'){
    head.appendChild(qbViewTag('cross join','qb-tag-cross'));
  } else {
    var select=document.createElement('select');
    select.setAttribute('data-role','join-type');
    select.setAttribute('data-join',join.id);
    select.setAttribute('aria-label','Join type');
    [['inner','INNER JOIN'],['left','LEFT JOIN']].forEach(function(option){
      var item=document.createElement('option');
      item.value=option[0];
      item.textContent=option[1];
      select.appendChild(item);
    });
    select.value=join.joinType;
    head.appendChild(select);
  }
  var title=document.createElement('span');
  title.className='qb-join-title';
  title.textContent=queryNameOf(graph,join.attachToId)+' → '+
    queryNameOf(graph,join.entityId);
  head.appendChild(title);
  if(join.bridge) head.appendChild(qbViewTag('bridge','qb-tag-bridge'));
  if(join.kind==='manual'){
    head.appendChild(qbViewTag('taught · not declared','qb-tag-manual'));
  }
  if(join.kind==='declared'&&join.resolution==='heuristic'){
    head.appendChild(qbViewTag('name-matched FK','qb-tag-heuristic'));
  }
  head.appendChild(qbViewShowButton(join.entityId));
  card.appendChild(head);
  var condition=document.createElement('p');
  condition.className='qb-join-cond';
  condition.textContent=qbViewJoinConditionText(graph,join);
  card.appendChild(condition);
  var note=document.createElement('p');
  note.className='qb-join-note';
  note.textContent=join.explanation;
  card.appendChild(note);
  if(join.selfJoin) card.appendChild(qbViewCopyEditor(join,picks));
  return card;
}

/* Self joins list the table's picked columns so the user can route each one to
   the second alias. */
function qbViewCopyEditor(join: QueryJoin, picks: QueryColumnRef[]): HTMLElement {
  var box=document.createElement('div');
  box.className='qb-copy';
  var pickedColumns=picks.filter(function(entry){
    return entry.entityId===join.entityId;
  });
  if(!pickedColumns.length) return box;
  var label=document.createElement('p');
  label.className='qb-copy-label';
  label.textContent='Read from the second copy:';
  box.appendChild(label);
  var list=document.createElement('ul');
  list.className='qb-copy-list';
  pickedColumns.forEach(function(entry){
    var item=document.createElement('li');
    var option=document.createElement('label');
    var checkbox=document.createElement('input');
    checkbox.type='checkbox';
    checkbox.checked=(join.copyColumns||[]).some(function(name){
      return schemaNormColumn(name)===schemaNormColumn(entry.column);
    });
    checkbox.setAttribute('data-role','copy-column');
    checkbox.setAttribute('data-join',join.manualId||'');
    checkbox.setAttribute('data-column',entry.column);
    var text=document.createElement('span');
    text.textContent=entry.column;
    option.appendChild(checkbox);
    option.appendChild(text);
    item.appendChild(option);
    list.appendChild(item);
  });
  box.appendChild(list);
  if(!join.copyColumns||!join.copyColumns.length){
    var hint=document.createElement('p');
    hint.className='qb-join-note';
    hint.textContent='All picked columns currently come from the first copy.';
    box.appendChild(hint);
  }
  return box;
}

function qbViewColumnOptions(graph: QueryGraph): DocumentFragment {
  var frag=document.createDocumentFragment();
  graph.order.forEach(function(id){
    var node=graph.nodes[id];
    var group=document.createElement('optgroup');
    group.label=node.name;
    node.columns.forEach(function(column){
      var option=document.createElement('option');
      option.value=id+'|'+column;
      option.textContent=column;
      group.appendChild(option);
    });
    frag.appendChild(group);
  });
  return frag;
}

function qbViewProblemCard(graph: QueryGraph, problem: QueryProblem,
                           draft: QbDraft, teaching: boolean): HTMLElement {
  var key=problem.entityIds[0];
  var card=document.createElement('div');
  card.className='qb-problem';
  var title=document.createElement('h4');
  title.textContent=problem.title;
  var message=document.createElement('p');
  message.textContent=problem.message;
  var education=document.createElement('p');
  education.textContent=problem.education;
  card.appendChild(title);
  card.appendChild(message);
  card.appendChild(education);
  var row=document.createElement('div');
  row.className='qb-resolve';
  var left=document.createElement('select');
  left.setAttribute('data-role','teach-left');
  left.setAttribute('data-problem',key);
  left.setAttribute('aria-label','Table and column on the left');
  left.appendChild(qbViewColumnOptions(graph));
  left.value=draft.left;
  var equals=document.createElement('span');
  equals.textContent='=';
  var right=document.createElement('select');
  right.setAttribute('data-role','teach-right');
  right.setAttribute('data-problem',key);
  right.setAttribute('aria-label','Table and column on the right');
  right.appendChild(qbViewColumnOptions(graph));
  right.value=draft.right;
  var teach=document.createElement('button');
  teach.type='button';
  teach.className='btn primary';
  teach.textContent='Add taught join';
  teach.setAttribute('data-action','teach');
  teach.setAttribute('data-problem',key);
  row.appendChild(left);
  row.appendChild(equals);
  row.appendChild(right);
  row.appendChild(teach);
  card.appendChild(row);
  var sameHint=document.createElement('p');
  sameHint.className='qb-join-note';
  sameHint.textContent='Choosing the same table on both sides creates a self join; tick which picked columns read from the second copy after adding it.';
  card.appendChild(sameHint);
  var predicateToggle=document.createElement('label');
  predicateToggle.className='opt';
  var predicateBox=document.createElement('input');
  predicateBox.type='checkbox';
  predicateBox.checked=!!draft.usePredicate;
  predicateBox.setAttribute('data-role','use-predicate');
  predicateBox.setAttribute('data-problem',key);
  var predicateText=document.createElement('span');
  predicateText.textContent='Use a typed predicate instead';
  predicateToggle.appendChild(predicateBox);
  predicateToggle.appendChild(predicateText);
  card.appendChild(predicateToggle);
  if(draft.usePredicate){
    var predicate=document.createElement('input');
    predicate.type='text';
    predicate.className='qb-predicate';
    predicate.placeholder='e.g. a.CustomerId = b.CustomerId';
    predicate.value=draft.predicate;
    predicate.setAttribute('data-role','predicate');
    predicate.setAttribute('data-problem',key);
    predicate.setAttribute('aria-label','Join predicate');
    card.appendChild(predicate);
  }
  var actions=document.createElement('div');
  actions.className='qb-resolve';
  if(!teaching){
    var teachClick=document.createElement('button');
    teachClick.type='button';
    teachClick.className='btn';
    teachClick.textContent='Teach by clicking columns';
    teachClick.setAttribute('data-action','teach-click');
    actions.appendChild(teachClick);
  }
  var crossBtn=document.createElement('button');
  crossBtn.type='button';
  crossBtn.className='btn';
  crossBtn.textContent='Every combination (CROSS JOIN)';
  crossBtn.setAttribute('data-action','cross');
  crossBtn.setAttribute('data-problem',key);
  var leaveBtn=document.createElement('button');
  leaveBtn.type='button';
  leaveBtn.className='btn quiet';
  leaveBtn.textContent='Leave these columns out';
  leaveBtn.setAttribute('data-action','exclude');
  leaveBtn.setAttribute('data-problem',key);
  actions.appendChild(crossBtn);
  actions.appendChild(leaveBtn);
  card.appendChild(actions);
  return card;
}

function qbViewLearn(education: string[]): HTMLElement | null {
  if(!education.length) return null;
  var details=document.createElement('details');
  details.className='qb-learn';
  var summary=document.createElement('summary');
  summary.textContent='How these joins were chosen';
  details.appendChild(summary);
  var list=document.createElement('ul');
  education.forEach(function(line){
    var item=document.createElement('li');
    item.textContent=line;
    list.appendChild(item);
  });
  details.appendChild(list);
  return details;
}

