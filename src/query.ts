/* proc>flow v2.4.1 — ERD query builder (picked columns → declared-FK joins → SQL).
   Picked columns define a set of tables. The builder follows declared
   FOREIGN KEY constraints to connect those tables, preferring exact
   resolutions over name-matched ones, and emits a SELECT ready to paste into
   a SQL client such as DBeaver.

   Honesty rules (matches the v2 accuracy contract):
   - Only declared constraints become join edges. Column names never imply a
     relationship.
   - Tables the declared graph cannot reach are reported as problems with
     explicit resolutions: teach the join by hand, opt into a cartesian
     product, or leave the columns out. ProcFlow never silently cross-joins.
   - Hand-taught joins are labelled "not declared" in the plan and in the SQL
     header, and ProcFlow says it cannot verify them.
   - When two declared paths tie, the first declaration is used and the
     alternatives are surfaced, never hidden.
   - Same schema + picks + options → identical plan and SQL. */

var QUERY_MAX_PATHS = 8;
var QUERY_MAX_STEPS = 512;
var QUERY_VERSION = 'v2.5.0';

var QUERY_DIALECT_LABELS: Record<QueryDialect, string> = {
  tsql: 'T-SQL (SQL Server)',
  postgres: 'PostgreSQL',
  db2: 'DB2',
  sqlite: 'SQLite'
};

/* ===== join graph =====
   Nodes are selectable tables/views with declared columns. Edges are declared
   foreign keys: child = FK holder, parent = referenced key. External
   (unresolved) targets and objects without declared columns cannot be picked
   or joined; they are listed in `skipped` so the UI can explain why. */
function queryBuildGraph(result: SchemaResult): QueryGraph {
  var graph: QueryGraph={nodes:{},order:[],edges:[],skipped:[]};
  var entities=(result&&result.entities)||[];
  entities.forEach(function(entity){
    if(entity.unresolved){
      graph.skipped.push({id:entity.id,name:entity.name,reason:'external'});
      return;
    }
    if(!entity.columns.length){
      graph.skipped.push({id:entity.id,name:entity.name,reason:'no-columns'});
      return;
    }
    graph.nodes[entity.id]={id:entity.id,name:entity.name,kind:entity.kind,
      columns:entity.columns.map(function(column){ return column.name; }),
      edges:[]};
    graph.order.push(entity.id);
  });
  var relationships=(result&&result.relationships)||[];
  relationships.forEach(function(rel,index){
    var child=graph.nodes[rel.toId], parent=graph.nodes[rel.fromId];
    if(!child||!parent) return;
    var edge: QueryGraphEdge={
      id:rel.id,
      childId:rel.toId,
      parentId:rel.fromId,
      childColumns:(rel.toColumns||[]).slice(),
      parentColumns:(rel.fromColumns||[]).slice(),
      cardinality:rel.cardinality,
      optional:rel.optional,
      unique:rel.unique,
      resolution:rel.resolution,
      name:rel.name,
      weight:rel.resolution==='heuristic'?3:1,
      index:index
    };
    graph.edges.push(edge);
    child.edges.push(edge);
    if(parent.id!==child.id) parent.edges.push(edge);
  });
  return graph;
}

function queryNameOf(graph: QueryGraph, id: string): string {
  var node=graph.nodes[id];
  return node?node.name:id;
}

function queryNodeHasColumn(node: QueryGraphNode, column: string): boolean {
  var wanted=schemaNormColumn(column);
  return node.columns.some(function(name){
    return schemaNormColumn(name)===wanted;
  });
}

function queryEdgeById(graph: QueryGraph, edgeId: string): QueryGraphEdge | null {
  for(var i=0;i<graph.edges.length;i++){
    if(graph.edges[i].id===edgeId) return graph.edges[i];
  }
  return null;
}

function queryOtherEnd(edge: QueryGraphEdge, nodeId: string): string | null {
  if(edge.childId===nodeId) return edge.parentId;
  if(edge.parentId===nodeId) return edge.childId;
  return null;
}

/* ===== pathfinding =====
   Shortest paths by declared-evidence weight: exact FK = 1, name-matched =
   3, hand-taught join = 5. Ties keep declaration order, so the plan is
   reproducible. All shortest paths are enumerated up to a small cap so the
   UI can offer a choice when a selection is ambiguous. */
interface QueryPathFrame {
  node: string;
  edgeIndex: number;
}

function queryDijkstra(graph: QueryGraph, sourceId: string): Record<string, number> {
  var dist: Record<string, number>={};
  var done: StringSet={};
  if(!graph.nodes[sourceId]) return dist;
  dist[sourceId]=0;
  while(true){
    var node: string | null=null;
    graph.order.forEach(function(id){
      if(done[id]||dist[id]===undefined) return;
      if(node===null||dist[id]<dist[node]||
         (dist[id]===dist[node]&&id<(node as string))) node=id;
    });
    if(node===null) break;
    done[node]=1;
    graph.nodes[node].edges.forEach(function(edge){
      var other=queryOtherEnd(edge,node);
      if(other===null) return;
      var step=dist[node]+edge.weight;
      if(dist[other]===undefined||step<dist[other]) dist[other]=step;
    });
  }
  return dist;
}

/* Iterative backtracking: a path can span every table in an estate, and this
   runs on the UI thread, so it must not consume the call stack. */
function queryEnumeratePaths(graph: QueryGraph, fromId: string, toId: string,
                             dist: Record<string, number>,
                             maxPaths: number): QueryPath[] {
  var paths: QueryPath[]=[];
  if(!graph.nodes[fromId]||!graph.nodes[toId]) return paths;
  if(dist[fromId]!==0||dist[toId]===undefined) return paths;
  var acc: QueryPathStep[]=[];
  var visited: StringSet={};
  visited[toId]=1;
  var stack: QueryPathFrame[]=[{node:toId,edgeIndex:0}];
  while(stack.length&&paths.length<maxPaths){
    var frame=stack[stack.length-1];
    if(frame.node===fromId){
      var steps=acc.slice().reverse();
      paths.push({steps:steps,cost:dist[toId],
        entityIds:steps.map(function(step){ return step.fromId; }).concat([toId])});
      stack.pop();
      delete visited[frame.node];
      if(stack.length) acc.pop();
      continue;
    }
    var edges=graph.nodes[frame.node].edges;
    if(frame.edgeIndex>=edges.length){
      stack.pop();
      delete visited[frame.node];
      if(stack.length) acc.pop();
      continue;
    }
    var edge=edges[frame.edgeIndex];
    frame.edgeIndex++;
    var other=queryOtherEnd(edge,frame.node);
    if(other===null||visited[other]) continue;
    if(dist[other]===undefined||dist[other]+edge.weight!==dist[frame.node]) continue;
    acc.push({edgeId:edge.id,fromId:other,toId:frame.node,
      reverse:edge.parentId===other});
    visited[other]=1;
    stack.push({node:other,edgeIndex:0});
  }
  return paths;
}

function queryGraphComponents(graph: QueryGraph, ids: string[]): string[][] {
  var wanted: StringSet={};
  ids.forEach(function(id){ if(graph.nodes[id]) wanted[id]=1; });
  var seen: StringSet={}, out: string[][]=[];
  ids.forEach(function(id){
    if(!graph.nodes[id]||seen[id]) return;
    var queue: string[]=[id], component: string[]=[];
    seen[id]=1;
    while(queue.length){
      var node=queue.shift();
      component.push(node);
      graph.nodes[node].edges.forEach(function(edge){
        var other=queryOtherEnd(edge,node);
        if(other===null||!wanted[other]||seen[other]) return;
        seen[other]=1;
        queue.push(other);
      });
    }
    out.push(component);
  });
  return out;
}

/* A taught join becomes a regular graph edge with the lowest preference, so a
   declared path always wins when one exists. */
function queryManualEdges(graph: QueryGraph, manual: QueryManualJoin[]): string[] {
  var warnings: string[]=[];
  (manual||[]).forEach(function(entry){
    if(entry.leftId===entry.rightId) return; /* self joins are handled in the plan */
    var left=graph.nodes[entry.leftId], right=graph.nodes[entry.rightId];
    if(!left||!right){
      warnings.push('A taught join pointed at a table that is not declared in the current schema; it was ignored.');
      return;
    }
    if(!queryNodeHasColumn(left,entry.leftColumn)||
       !queryNodeHasColumn(right,entry.rightColumn)){
      warnings.push('A taught join pointed at a column that is not declared in the current schema; it was ignored.');
      return;
    }
    var edge: QueryGraphEdge={
      id:'manual:'+entry.id,
      childId:entry.leftId,
      parentId:entry.rightId,
      childColumns:[entry.leftColumn],
      parentColumns:[entry.rightColumn],
      cardinality:'one-to-many',
      optional:true,
      unique:false,
      resolution:'opaque',
      weight:5,
      index:graph.edges.length,
      manualId:entry.id,
      predicate:entry.predicate
    };
    graph.edges.push(edge);
    left.edges.push(edge);
    if(right.id!==left.id) right.edges.push(edge);
  });
  return warnings;
}

/* ===== join plan ===== */
function queryDefaultJoinType(edge: QueryGraphEdge, reverse: boolean,
                              policy: QueryPolicy): QueryJoinType {
  if(edge.manualId) return 'inner';
  if(policy==='strict') return 'inner';
  if(reverse) return 'left';
  return edge.optional?'left':'inner';
}

function queryJoinExplanation(graph: QueryGraph, join: QueryJoin,
                              attachToId: string, entityId: string): string {
  var attachName=queryNameOf(graph,attachToId);
  var entityName=queryNameOf(graph,entityId);
  var bits: string[]=[];
  if(join.kind==='cross'){
    bits.push('Every '+attachName+' row is paired with every '+entityName+
      ' row (cartesian product); the row count multiplies.');
    return bits.join(' ');
  }
  if(join.selfJoin){
    bits.push('Self join taught in the builder: '+attachName+'.'+
      join.leftColumns.join(',')+' matches a second copy of '+attachName+
      ' on '+join.rightColumns.join(',')+'.');
    if(join.copyColumns&&join.copyColumns.length){
      bits.push('Columns read from the second copy: '+
        join.copyColumns.join(', ')+'.');
    }
    bits.push('No declared foreign key backs this condition, so ProcFlow cannot verify it.');
    return bits.join(' ');
  }
  if(join.kind==='manual'){
    bits.push('Taught in the builder: '+(join.predicate||
      (attachName+'.'+join.leftColumns.join(',')+' = '+entityName+'.'+
       join.rightColumns.join(',')))+'.');
    bits.push('No declared foreign key backs this condition, so ProcFlow cannot verify it.');
    return bits.join(' ');
  }
  var childName=join.reverse?entityName:attachName;
  var parentName=join.reverse?attachName:entityName;
  var childColumns=join.reverse?join.rightColumns:join.leftColumns;
  var parentColumns=join.reverse?join.leftColumns:join.rightColumns;
  bits.push((join.constraintName?join.constraintName+': ':'')+
    childName+'.'+childColumns.join(',')+' references '+parentName+'.'+
    parentColumns.join(',')+'.');
  if(join.resolution==='heuristic'){
    bits.push('The target matched by name only (its schema was not declared); verify that it points at '+parentName+'.');
  }
  if(join.reverse){
    bits.push(join.cardinality==='one-to-one'
      ? 'The key is unique, so at most one '+childName+' row matches each '+parentName+' row.'
      : 'One '+parentName+' row can match many '+childName+' rows, so joined values repeat and aggregate totals can multiply.');
    bits.push(join.joinType==='left'
      ? 'LEFT JOIN keeps '+parentName+' rows that have no '+childName+' match.'
      : 'INNER JOIN drops '+parentName+' rows that have no '+childName+' match.');
  } else {
    bits.push('Each '+childName+' row references at most one '+parentName+' row.');
    if(join.optional){
      bits.push(join.joinType==='left'
        ? 'The foreign key is nullable, so unmatched '+childName+' rows are kept with NULLs.'
        : 'The foreign key is nullable; INNER JOIN drops '+childName+' rows without a match.');
    }
  }
  if(join.bridge){
    bits.push(entityName+' was added as the declared path between the picked tables; its own columns are not selected.');
  }
  return bits.join(' ');
}

function queryPathSummary(graph: QueryGraph, path: QueryPath): string {
  return path.steps.map(function(step){
    var edge=queryEdgeById(graph,step.edgeId);
    if(!edge) return '';
    var child=queryNameOf(graph,edge.childId);
    var parent=queryNameOf(graph,edge.parentId);
    return child+'.'+edge.childColumns.join(',')+' → '+parent+'.'+
      edge.parentColumns.join(',');
  }).join(' then ');
}

function queryBuildPlan(input: QueryBuildInput): QueryPlan {
  var graph=queryBuildGraph(input.result);
  var warnings=queryManualEdges(graph,input.manual||[]);
  var plan: QueryPlan={graph:graph,selections:[],fromId:null,usedIds:[],joins:[],
    bridges:[],problems:[],ambiguities:[],warnings:warnings,education:[]};

  var selections: QueryColumnRef[]=[], seenSelection: StringSet={}, dropped=0;
  (input.selections||[]).forEach(function(sel){
    var node=graph.nodes[sel.entityId];
    if(!node||!queryNodeHasColumn(node,sel.column)){ dropped++; return; }
    var key=sel.entityId+'|'+schemaNormColumn(sel.column);
    if(seenSelection[key]) return;
    seenSelection[key]=1;
    selections.push({entityId:sel.entityId,column:sel.column});
  });
  if(dropped){
    plan.warnings.push(dropped+' picked column'+(dropped===1?' was':'s were')+
      ' ignored because it is not declared in the current schema.');
  }
  var excluded: StringSet={};
  (input.excluded||[]).forEach(function(id){ excluded[id]=1; });
  selections=selections.filter(function(sel){ return !excluded[sel.entityId]; });
  plan.selections=selections;
  if(!selections.length) return plan;

  var selectedIds: string[]=[];
  selections.forEach(function(sel){
    if(selectedIds.indexOf(sel.entityId)<0) selectedIds.push(sel.entityId);
  });
  var selected: StringSet={};
  selectedIds.forEach(function(id){ selected[id]=1; });
  var policy: QueryPolicy=input.policy==='strict'?'strict':'preserve';
  var fromId=selections[0].entityId;
  plan.fromId=fromId;

  var used: StringSet={};
  used[fromId]=1;
  var usedOrder: string[]=[fromId];

  (input.cross||[]).forEach(function(id){
    if(!graph.nodes[id]||used[id]) return;
    if(excluded[id]) return;
    var reachable=queryDijkstra(graph,id);
    if(usedOrder.some(function(treeId){ return reachable[treeId]!==undefined; })){
      plan.warnings.push(queryNameOf(graph,id)+
        ' is connected by a declared key, so the CROSS JOIN request was ignored.');
      return;
    }
    used[id]=1;
    usedOrder.push(id);
    var join: QueryJoin={id:'cross:'+id,kind:'cross',attachToId:fromId,
      entityId:id,leftColumns:[],rightColumns:[],joinType:'cross',
      resolution:null,cardinality:null,optional:null,bridge:false,reverse:false,
      explanation:''};
    join.bridge=!selected[id];
    join.explanation=queryJoinExplanation(graph,join,fromId,id);
    plan.joins.push(join);
    if(join.bridge&&plan.bridges.indexOf(id)<0) plan.bridges.push(id);
  });

  var remaining=selectedIds.filter(function(id){ return !used[id]; });
  var guard=0;
  while(remaining.length&&guard++<QUERY_MAX_STEPS){
    var best: {entityId: string; treeId: string; treeIndex: number;
               cost: number; paths: QueryPath[]} | null=null;
    remaining.forEach(function(id){
      var dist=queryDijkstra(graph,id);
      usedOrder.forEach(function(treeId,index){
        var cost=dist[treeId];
        if(cost===undefined) return;
        if(best===null||cost<best.cost||
           (cost===best.cost&&id===best.entityId&&index<best.treeIndex)){
          var paths=queryEnumeratePaths(graph,id,treeId,dist,QUERY_MAX_PATHS);
          if(!paths.length) return;
          best={entityId:id,treeId:treeId,treeIndex:index,cost:cost,paths:paths};
        }
      });
    });
    if(best===null) break;
    var choiceIndex=0;
    var choiceKey=best.entityId+'->'+best.treeId;
    if(input.pathChoices&&
       input.pathChoices[choiceKey]>0&&
       input.pathChoices[choiceKey]<best.paths.length){
      choiceIndex=input.pathChoices[choiceKey];
    }
    if(best.paths.length>1){
      plan.ambiguities.push({fromId:best.entityId,toId:best.treeId,
        chosenIndex:choiceIndex,
        paths:best.paths.slice(),
        summaries:best.paths.map(function(path){
          return queryPathSummary(graph,path);
        }),
        summary:queryPathSummary(graph,best.paths[choiceIndex])});
    }
    var path=best.paths[choiceIndex];
    for(var stepIndex=path.steps.length-1;stepIndex>=0;stepIndex--){
      var step=path.steps[stepIndex];
      var edge=queryEdgeById(graph,step.edgeId);
      if(!edge) continue;
      var attachToId=step.toId, entityId=step.fromId;
      var attachIsChild=edge.childId===attachToId;
      var joinId=edge.manualId?('manual:'+edge.manualId):('rel:'+edge.id);
      var joinType=(input.joinTypes&&input.joinTypes[joinId])||
        queryDefaultJoinType(edge,!attachIsChild,policy);
      var join: QueryJoin={id:joinId,
        kind:edge.manualId?'manual':'declared',
        attachToId:attachToId,entityId:entityId,
        leftColumns:attachIsChild?edge.childColumns.slice():edge.parentColumns.slice(),
        rightColumns:attachIsChild?edge.parentColumns.slice():edge.childColumns.slice(),
        joinType:joinType,
        resolution:edge.manualId?null:edge.resolution,
        cardinality:edge.cardinality,
        optional:edge.optional,
        constraintName:edge.manualId?undefined:edge.name,
        predicate:edge.predicate,
        edgeId:edge.manualId?undefined:edge.id,
        bridge:!selected[entityId],
        reverse:!attachIsChild,
        explanation:''};
      join.explanation=queryJoinExplanation(graph,join,attachToId,entityId);
      plan.joins.push(join);
      if(!used[entityId]){
        used[entityId]=1;
        usedOrder.push(entityId);
      }
      if(join.bridge&&plan.bridges.indexOf(entityId)<0) plan.bridges.push(entityId);
    }
    remaining=remaining.filter(function(id){ return !used[id]; });
  }
  plan.usedIds=usedOrder;

  /* Taught self joins run the table against a second aliased copy. They need
     a picked column from that table to be meaningful, and only the first one
     per table is applied. */
  var selfJoined: StringSet={};
  (input.manual||[]).forEach(function(entry){
    if(entry.leftId!==entry.rightId) return;
    var node=graph.nodes[entry.leftId];
    if(!node||excluded[entry.leftId]) return;
    if(!selected[entry.leftId]||!used[entry.leftId]){
      plan.warnings.push('A self join on '+queryNameOf(graph,entry.leftId)+
        ' was ignored because no column from that table is picked.');
      return;
    }
    if(!queryNodeHasColumn(node,entry.leftColumn)||
       !queryNodeHasColumn(node,entry.rightColumn)) return;
    if(selfJoined[entry.leftId]){
      plan.warnings.push('Only the first self join on '+
        queryNameOf(graph,entry.leftId)+' is applied.');
      return;
    }
    selfJoined[entry.leftId]=1;
    var copyColumns: string[]=[];
    (entry.selfColumns||[]).forEach(function(name){
      if(queryNodeHasColumn(node,name)&&!copyColumns.some(function(existing){
        return schemaNormColumn(existing)===schemaNormColumn(name);
      })){
        copyColumns.push(name);
      }
    });
    var join: QueryJoin={id:'manual:'+entry.id,kind:'manual',
      attachToId:entry.leftId,entityId:entry.leftId,
      leftColumns:[entry.leftColumn],rightColumns:[entry.rightColumn],
      joinType:'inner',resolution:null,cardinality:null,optional:null,
      predicate:entry.predicate,manualId:entry.id,selfJoin:true,
      copyColumns:copyColumns,bridge:false,reverse:false,explanation:''};
    join.explanation=queryJoinExplanation(graph,join,entry.leftId,entry.leftId);
    plan.joins.push(join);
  });

  var unjoined=selectedIds.filter(function(id){ return !used[id]; });
  if(unjoined.length){
    var fromName=queryNameOf(graph,fromId);
    queryGraphComponents(graph,unjoined).forEach(function(component){
      var names=component.map(function(id){ return queryNameOf(graph,id); });
      var views=component.filter(function(id){
        return graph.nodes[id].kind==='view';
      }).length>0;
      plan.problems.push({entityIds:component.slice(),code:'disconnected',
        title:names.join(' and ')+' cannot be joined',
        message:'No declared foreign-key path connects '+names.join(', ')+
          ' to '+fromName+'.'+
          (views?' Views declare no keys, so they can only join through keys declared on other tables.':''),
        education:'If the database has an implicit relationship (matching columns without a declared foreign key), teach the join below and ProcFlow will label it as not declared. You can also add a CROSS JOIN for every combination, or leave the table out of the query.'});
    });
  }

  plan.education.push('Joins follow declared FOREIGN KEY constraints only; ProcFlow never guesses a relationship from column names.');
  if(plan.bridges.length){
    plan.education.push('Bridge tables connect picked tables through declared keys; they appear in FROM but not in SELECT.');
  }
  if(plan.joins.some(function(join){ return join.kind==='manual'; })){
    plan.education.push('Taught joins are not declared in the DDL, and the generated SQL says so.');
  }
  if(plan.joins.some(function(join){ return join.kind==='cross'; })){
    plan.education.push('CROSS JOIN pairs every row with every row; check the row estimate before running it.');
  }
  if(plan.joins.some(function(join){ return join.selfJoin; })){
    plan.education.push('A self join compares rows of the same table; ProcFlow adds a second alias, and the ON condition is the one you taught.');
  }
  if(plan.joins.some(function(join){
    return join.reverse&&join.cardinality==='one-to-many';
  })){
    plan.warnings.push('One-to-many joins can repeat rows; counts and sums over these columns may multiply.');
  }
  if(plan.joins.some(function(join){ return join.resolution==='heuristic'; })){
    plan.warnings.push('Some joins follow foreign keys whose target matched by name only; verify the target tables.');
  }
  return plan;
}

/* ===== SQL emission ===== */
function queryQuoteIdent(name: string, dialect: QueryDialect): string {
  var s=String(name==null?'':name);
  if(dialect==='tsql') return '['+s.replace(/\]/g,']]')+']';
  return '"'+s.replace(/"/g,'""')+'"';
}

function queryQuoteTable(name: string, dialect: QueryDialect): string {
  return String(name||'').split('.').map(function(part){
    return queryQuoteIdent(part,dialect);
  }).join('.');
}

function queryAliasBase(name: string): string {
  var parts=String(name||'').split('.');
  var last=parts[parts.length-1]||'';
  var alias=last.replace(/[^A-Za-z0-9_]/g,'').toLowerCase();
  if(!alias||/^[0-9]/.test(alias)) alias='t'+alias;
  return alias;
}

function queryAliasFor(name: string, taken: StringSet): string {
  var base=queryAliasBase(name)||'t', alias=base, suffix=2;
  while(taken[alias]){
    alias=base+'_'+suffix;
    suffix++;
  }
  taken[alias]=1;
  return alias;
}

function queryColumnAlias(tableAlias: string, column: string): string {
  return tableAlias+'_'+String(column||'').replace(/[^A-Za-z0-9_]/g,'').toLowerCase();
}

function querySafeComment(text: string): string {
  return String(text==null?'':text).replace(/\*\//g,'* /');
}

/* ===== generated-SQL highlighting =====
   A small deterministic scanner for the SQL this module emits plus the
   predicates users type. Concatenating the token texts always reproduces the
   input exactly, so copy and paste never depends on the renderer. */
var QUERY_SQL_KEYWORDS: Record<string, 1>={};
['SELECT','FROM','AS','JOIN','INNER','LEFT','RIGHT','FULL','OUTER','CROSS',
 'ON','WHERE','AND','OR','NOT','NULL','IS','IN','DISTINCT','ORDER','BY','GROUP',
 'HAVING','UNION','ALL','CASE','WHEN','THEN','ELSE','END','TOP','LIMIT','OFFSET',
 'ASC','DESC','WITH','EXISTS','BETWEEN','LIKE','CAST','COUNT','SUM','AVG','MIN',
 'MAX','COALESCE','NULLIF','OVER','PARTITION','FETCH','NEXT','ROWS','ONLY'
].forEach(function(word){ QUERY_SQL_KEYWORDS[word]=1; });

function queryTokenizeSQL(text: string): QuerySqlToken[] {
  var sql=String(text==null?'':text);
  var tokens: QuerySqlToken[]=[], i=0;
  function push(kind: QuerySqlTokenKind, start: number, end: number): void {
    if(end>start) tokens.push({text:sql.slice(start,end),kind:kind});
  }
  while(i<sql.length){
    var ch=sql.charAt(i);
    if(ch==='/'&&sql.charAt(i+1)==='*'){
      var blockClose=sql.indexOf('*/',i+2);
      var blockEnd=blockClose<0?sql.length:blockClose+2;
      push('comment',i,blockEnd);
      i=blockEnd;
      continue;
    }
    if(ch==='-'&&sql.charAt(i+1)==='-'){
      var newline=sql.indexOf('\n',i+2);
      var lineEnd=newline<0?sql.length:newline;
      push('comment',i,lineEnd);
      i=lineEnd;
      continue;
    }
    if(ch==="'"||ch==='"'||ch==='`'){
      var quote=ch, j=i+1;
      while(j<sql.length){
        if(sql.charAt(j)===quote){
          if(sql.charAt(j+1)===quote){ j+=2; continue; }
          j++;
          break;
        }
        j++;
      }
      push(ch==="'"?'string':'ident',i,j);
      i=j;
      continue;
    }
    if(ch==='['){
      var bracket=i+1;
      while(bracket<sql.length){
        if(sql.charAt(bracket)===']'){
          if(sql.charAt(bracket+1)===']'){ bracket+=2; continue; }
          bracket++;
          break;
        }
        bracket++;
      }
      push('ident',i,bracket);
      i=bracket;
      continue;
    }
    if(ch>='0'&&ch<='9'){
      var digits=i;
      while(digits<sql.length&&/[0-9.]/.test(sql.charAt(digits))) digits++;
      push('number',i,digits);
      i=digits;
      continue;
    }
    if(/[A-Za-z_]/.test(ch)){
      var wordEnd=i;
      while(wordEnd<sql.length&&/[A-Za-z0-9_$]/.test(sql.charAt(wordEnd))) wordEnd++;
      var word=sql.slice(i,wordEnd);
      push(QUERY_SQL_KEYWORDS[word.toUpperCase()]?'keyword':'plain',i,wordEnd);
      i=wordEnd;
      continue;
    }
    if(/\s/.test(ch)){
      var spaceEnd=i;
      while(spaceEnd<sql.length&&/\s/.test(sql.charAt(spaceEnd))) spaceEnd++;
      push('plain',i,spaceEnd);
      i=spaceEnd;
      continue;
    }
    push('punct',i,i+1);
    i++;
  }
  return tokens;
}

function queryJoinCondition(join: QueryJoin, dialect: QueryDialect,
                            aliasOf: (id: string) => string): string {
  if(join.predicate) return join.predicate;
  var parts: string[]=[];
  var count=Math.min(join.leftColumns.length,join.rightColumns.length);
  for(var i=0;i<count;i++){
    parts.push(aliasOf(join.attachToId)+'.'+
      queryQuoteIdent(join.leftColumns[i],dialect)+' = '+
      aliasOf(join.entityId)+'.'+
      queryQuoteIdent(join.rightColumns[i],dialect));
  }
  return parts.join(' AND ')||'1 = 1';
}

function queryPlanSQL(plan: QueryPlan, options: QuerySQLOptions): string {
  if(!plan||!plan.fromId) return '';
  var dialect: QueryDialect=options&&options.dialect?options.dialect:'tsql';
  var withComments=!options||options.comments!==false;
  var distinct=!!(options&&options.distinct);
  var rowLimit=options&&options.rowLimit&&options.rowLimit>0
    ?Math.floor(options.rowLimit):0;
  var graph=plan.graph;
  var aliases: Record<string, string>={}, taken: StringSet={};
  plan.usedIds.forEach(function(id){
    aliases[id]=queryAliasFor(queryNameOf(graph,id),taken);
  });
  function aliasOf(id: string): string {
    return aliases[id]||queryAliasBase(queryNameOf(graph,id));
  }
  /* A self join adds a second alias for the same table; picked columns listed
     in copyColumns resolve against that copy. */
  var selfJoins=plan.joins.filter(function(join){ return join.selfJoin; });
  var copyAliases: Record<string, string>={};
  var copyColumns: Record<string, StringSet>={};
  selfJoins.forEach(function(join){
    if(copyAliases[join.entityId]) return;
    copyAliases[join.entityId]=queryAliasFor(queryNameOf(graph,join.entityId),taken);
    var set: StringSet={};
    (join.copyColumns||[]).forEach(function(name){
      set[schemaNormColumn(name)]=1;
    });
    copyColumns[join.entityId]=set;
  });
  function selectionAlias(entityId: string, column: string): string {
    var set=copyColumns[entityId];
    return set&&set[schemaNormColumn(column)]
      ?copyAliases[entityId]
      :aliasOf(entityId);
  }
  var visible=plan.selections.filter(function(sel){
    return plan.usedIds.indexOf(sel.entityId)>=0;
  });
  function selectedKey(entityId: string, column: string): string {
    return entityId+'|'+schemaNormColumn(column);
  }
  var selected: StringSet={};
  visible.forEach(function(sel){ selected[selectedKey(sel.entityId,sel.column)]=1; });
  var sorts: QuerySort[]=[], seenSort: StringSet={};
  ((options&&options.orderBy)||[]).forEach(function(sort){
    if(!sort||!sort.entityId||!sort.column) return;
    var key=selectedKey(sort.entityId,sort.column);
    if(!selected[key]||seenSort[key]) return;
    seenSort[key]=1;
    sorts.push({entityId:sort.entityId,column:sort.column,
      direction:sort.direction==='desc'?'desc':'asc'});
  });
  var counts: Record<string, number>={};
  visible.forEach(function(sel){
    var key=schemaNormColumn(sel.column);
    counts[key]=(counts[key]||0)+1;
  });
  var seen: StringSet={}, items: string[]=[];
  visible.forEach(function(sel){
    var key=sel.entityId+'|'+schemaNormColumn(sel.column);
    if(seen[key]) return;
    seen[key]=1;
    var alias=selectionAlias(sel.entityId,sel.column);
    var item=alias+'.'+queryQuoteIdent(sel.column,dialect);
    if(counts[schemaNormColumn(sel.column)]>1){
      item+=' AS '+queryColumnAlias(alias,sel.column);
    }
    items.push(item);
  });
  var lines: string[]=[];
  var top=dialect==='tsql'&&rowLimit?' TOP '+rowLimit:'';
  lines.push('SELECT'+(distinct?' DISTINCT':'')+top);
  items.forEach(function(item,index){
    lines.push('  '+item+(index<items.length-1?',':''));
  });
  lines.push('FROM '+queryQuoteTable(queryNameOf(graph,plan.fromId),dialect)+
    ' AS '+aliasOf(plan.fromId));
  plan.joins.forEach(function(join){
    if(join.selfJoin){
      lines.push('INNER JOIN '+
        queryQuoteTable(queryNameOf(graph,join.entityId),dialect)+' AS '+
        copyAliases[join.entityId]);
      var selfCondition=join.predicate||
        (aliasOf(join.attachToId)+'.'+
         queryQuoteIdent(join.leftColumns[0],dialect)+' = '+
         copyAliases[join.entityId]+'.'+
         queryQuoteIdent(join.rightColumns[0],dialect));
      lines.push('  ON '+selfCondition);
      return;
    }
    var keyword=join.joinType==='cross'?'CROSS JOIN':
      (join.joinType==='left'?'LEFT JOIN':'INNER JOIN');
    lines.push(keyword+' '+
      queryQuoteTable(queryNameOf(graph,join.entityId),dialect)+' AS '+
      aliasOf(join.entityId));
    if(join.joinType!=='cross'){
      lines.push('  ON '+queryJoinCondition(join,dialect,aliasOf));
    }
  });
  if(sorts.length){
    var sortParts=sorts.map(function(sort){
      return selectionAlias(sort.entityId,sort.column)+'.'+
        queryQuoteIdent(sort.column,dialect)+
        (sort.direction==='desc'?' DESC':' ASC');
    });
    lines.push('ORDER BY '+sortParts.join(', '));
  }
  if(rowLimit){
    if(dialect==='postgres'||dialect==='sqlite') lines.push('LIMIT '+rowLimit);
    else if(dialect==='db2') lines.push('FETCH FIRST '+rowLimit+' ROWS ONLY');
  }
  lines[lines.length-1]+=';';
  var body=lines.join('\n');
  if(!withComments) return body;

  var missing: string[]=[];
  plan.selections.forEach(function(sel){
    if(plan.usedIds.indexOf(sel.entityId)>=0) return;
    var name=queryNameOf(graph,sel.entityId);
    if(missing.indexOf(name)<0) missing.push(name);
  });
  var header: string[]=[];
  header.push('proc>flow '+QUERY_VERSION+' query builder — joins use declared FOREIGN KEY evidence only.');
  header.push('Dialect: '+QUERY_DIALECT_LABELS[dialect]+'.');
  if(distinct) header.push('Distinct: duplicate rows are collapsed.');
  if(rowLimit) header.push('Row cap: first '+rowLimit+' rows only.');
  if(sorts.length){
    header.push('Order: '+sorts.map(function(sort){
      return queryNameOf(graph,sort.entityId)+'.'+sort.column+' '+sort.direction;
    }).join(', ')+'.');
  }
  plan.usedIds.forEach(function(id){
    var role=id===plan.fromId?'FROM':(plan.bridges.indexOf(id)>=0?'bridge':'join');
    var join=plan.joins.filter(function(entry){ return entry.entityId===id; })[0];
    var note='';
    if(join&&join.kind==='manual') note=', taught join — not declared';
    if(join&&join.kind==='cross') note=', CROSS JOIN — approve the row count';
    if(join&&join.kind==='declared'){
      note=', via '+(join.constraintName||'declared foreign key');
    }
    header.push('  '+aliasOf(id)+' = '+queryNameOf(graph,id)+' ('+role+note+')');
  });
  selfJoins.forEach(function(join){
    var alias=copyAliases[join.entityId];
    if(!alias) return;
    header.push('  '+alias+' = '+queryNameOf(graph,join.entityId)+
      ' (second copy, self join'+
      (join.copyColumns&&join.copyColumns.length
        ?': '+join.copyColumns.join(', '):'')+')');
  });
  plan.warnings.forEach(function(warning){
    header.push('Warning: '+warning);
  });
  missing.forEach(function(name){
    header.push('Not included: '+name+' — no declared join path; teach a join or add a CROSS JOIN.');
  });
  return '/*\n'+header.map(querySafeComment).join('\n')+'\n*/\n'+body;
}

