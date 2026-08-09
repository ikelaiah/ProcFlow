/* proc>flow: column lineage foundations (v1.10.0)
   Column scopes and bindings for qualified references, aliases, projections,
   CTEs, derived tables, and catalogue-backed wildcard expansion; expression-
   level provenance within one query statement; explicit ambiguous and opaque
   column references.

   This module analyses a single query statement. It never invents a binding a
   reviewer could not prove: an unqualified reference that matches several
   sources is left unresolvable (`column_ambiguous`, no edge), and an expression
   or reference that cannot be resolved statically becomes opaque with a
   region-scoped `column_opaque` diagnostic. Multi-statement temporary-table
   flow and inter-object column flow (v1.11.0) and the final column export
   contract are deferred. */

var COL_CLAUSE_START: StringSet = S(['FROM','WHERE','GROUP','HAVING','ORDER','LIMIT',
                                     'OFFSET','FETCH','UNION','EXCEPT','INTERSECT',
                                     'INTO','FOR','OPTION','RETURNING']);
var COL_ARM_SEP: StringSet = S(['UNION','EXCEPT','INTERSECT']);
var COL_JOIN_PREFIX: StringSet = S(['JOIN','APPLY','CROSS','INNER','LEFT','RIGHT',
                                    'FULL','OUTER','LATERAL']);
/* Words inside an expression that are never column references. */
var COL_REF_SKIP: StringSet = S(['SELECT','WHERE','GROUP','HAVING','ORDER','LIMIT',
  'OFFSET','FETCH','UNION','EXCEPT','INTERSECT','INTO','FOR','OPTION','RETURNING',
  'BY','ASC','DESC','ALL','ANY','AND','OR','NOT','AS','ON','IN','IS','NULL','WHEN',
  'THEN','ELSE','END','CASE','BETWEEN','LIKE','ILIKE','SIMILAR','DISTINCT','TOP',
  'VALUE','VALUES','EXISTS','LATERAL','OVER','PARTITION','WINDOW','CURRENT',
  'ROW','ROWS','RANGE','SET','FROM','JOIN','USING','ARRAY','FILTER','WITHIN',
  'TRUE','FALSE','INTERVAL','COLLATE',
  /* data types cast inside expressions */
  'INT','INTEGER','BIGINT','SMALLINT','TINYINT','DECIMAL','NUMERIC','FLOAT','REAL',
  'DOUBLE','PRECISION','CHAR','NCHAR','VARCHAR','NVARCHAR','TEXT','CLOB','DATE',
  'DATETIME','DATETIME2','SMALLDATETIME','TIMESTAMP','TIME','BOOLEAN','BOOL','BIT',
  'BINARY','VARBINARY','BYTEA','UUID','GUID','MONEY','SMALLMONEY','JSON','XML','BLOB']);

interface ColCtx {
  cteColumns: Record<string, string[]>;
  catalogue?: Catalogue | null;
  dialect?: Dialect;
  depth: number;
}

/* CTE split that retains the explicit column list so CTE scopes can carry
   provable columns (`WITH r(n) AS …` → r has exactly [n]). */
function splitCtesColumn(toks: Token[]): {ctes: Array<{name: string; colToks: Token[];
    body: Token[]; bodySpan: SourceSpan | null}>; finalStart: number; recursive?: boolean} {
  var res: {ctes: Array<{name: string; colToks: Token[]; body: Token[]; bodySpan: SourceSpan | null}>;
            finalStart: number; recursive?: boolean}={ctes:[], finalStart:0};
  if(!toks.length||toks[0].u!=='WITH') return res;
  var i=1;
  if(toks[i]&&toks[i].u==='RECURSIVE'){ res.recursive=true; i++; }
  while(i<toks.length){
    var nameTok=toks[i];
    if(!nameTok||nameTok.type!=='word') break;
    var name=nameTok.v; i++;
    var colToks: Token[]=[];
    if(toks[i]&&toks[i].v==='('){
      var d0=0;
      while(i<toks.length){
        var tk=toks[i];
        if(tk.v==='(') d0++;
        else if(tk.v===')'){ d0--; if(d0===0){ i++; break; } }
        else if(d0===1) colToks.push(tk);
        i++;
      }
    }
    if(!(toks[i]&&toks[i].u==='AS')) break;
    i++;
    while(toks[i]&&['MATERIALIZED','NOT'].indexOf(toks[i].u)>=0) i++;
    if(!(toks[i]&&toks[i].v==='(')) break;
    var start=i, d=0;
    while(i<toks.length){
      if(toks[i].v==='(') d++;
      else if(toks[i].v===')'){ d--; if(d===0){ i++; break; } }
      i++;
    }
    var body=toks.slice(start+1,i-1);
    res.ctes.push({name:name, colToks:colToks, body:body, bodySpan:spanOfTokens(body)});
    if(toks[i]&&toks[i].v===','){ i++; continue; }
    break;
  }
  res.finalStart=i;
  return res;
}

function colNamesOf(toks: Token[]): string[] {
  var out: string[]=[];
  for(var i=0;i<toks.length;i++){
    var t=toks[i];
    if(t.type==='word'&&!(i>0&&toks[i-1].v==='.')&&
       t.v.charAt(0)!=='@'&&COL_REF_SKIP[t.u]===undefined){
      out.push(t.v);
    }
  }
  return out;
}

function catalogueColumnsFor(cat: Catalogue | null | undefined,
    tableName: string): string[] {
  if(!cat||!cat.columns||!cat.columns.length||!tableName) return [];
  var resolved=resolveCatalogue(cat, tableName);
  var canonical=resolved.resolution==='verified'&&resolved.resolvedName
    ? resolved.resolvedName : tableName;
  var norm=normalizeCatalogueName(canonical);
  var out: string[]=[], seen: StringSet={};
  cat.columns.forEach(function(c){
    if(normalizeCatalogueName(c.table)!==norm) return;
    var n=normalizeCatalogueName(c.name);
    if(n&&!seen[n]){ seen[n]=1; out.push(c.name); }
  });
  return out;
}

function colTokensInSpan(toks: Token[], span: SourceSpan | null): number {
  if(!span) return 0;
  var n=0;
  for(var i=0;i<toks.length;i++){
    var t=toks[i];
    if(t.pos<span.end&&t.end>span.start) n++;
  }
  return n;
}

function colSplitArms(toks: Token[]): Token[][] {
  var arms: Token[][]=[], cur: Token[]=[], d=0;
  for(var i=0;i<toks.length;i++){
    var t=toks[i];
    if(t.v==='('){ d++; cur.push(t); continue; }
    if(t.v===')'){ d--; cur.push(t); continue; }
    if(d===0&&COL_ARM_SEP[t.u]===1){ arms.push(cur); cur=[]; continue; }
    cur.push(t);
  }
  arms.push(cur);
  return arms;
}

/* Locate the projection and FROM regions of one SELECT arm. */
function colRegionsOf(toks: Token[]): {proj: [number, number]; from: [number, number]} {
  var proj=(function(){
    var j=1, guard=0;
    while(j<toks.length&&guard++<40){
      var u=toks[j].u;
      if(u==='DISTINCT'||u==='ALL'){ j++; continue; }
      if(u==='TOP'){
        j++;
        if(toks[j]&&toks[j].v==='('){ var dd=0;
          while(j<toks.length){ if(toks[j].v==='(') dd++; else if(toks[j].v===')'){
            dd--; if(dd===0){ j++; break; } } j++; }
        } else { if(toks[j]&&toks[j].type==='num') j++; if(toks[j]&&toks[j].u==='PERCENT')
                 j++; }
        continue;
      }
      break;
    }
    return j;
  })();
  var projStart=proj, d2=0, projEnd=toks.length, fromStart=-1, firstBoundary=toks.length;
  for(var k=proj; k<toks.length && d2>=0; k++){
    var t2=toks[k];
    if(t2.v==='(') d2++;
    else if(t2.v===')') d2--;
    if(d2===0&&k>=proj&&COL_CLAUSE_START[t2.u]===1){
      if(firstBoundary===toks.length) firstBoundary=k;
      if(t2.u==='FROM'){ fromStart=k+1; break; }
      /* INTO / FOR / OPTION may be followed by FROM — keep scanning */
    }
  }
  projEnd=firstBoundary;
  var fromEnd=toks.length;
  if(fromStart>=0){
    var d3=0;
    for(var m=fromStart; m<toks.length; m++){
      var t3=toks[m];
      if(t3.v==='(') d3++;
      else if(t3.v===')') d3--;
      if(d3===0&&m>fromStart&&COL_CLAUSE_START[t3.u]===1){ fromEnd=m; break; }
    }
  }
  return {proj:[projStart, projEnd<projStart?toks.length:projEnd],
          from:[fromStart, fromStart<0?toks.length:fromEnd]};
}

/* Parse the FROM region into scope sources; returns ON/USING predicate regions
   to scan as references. */
function colParseSources(fromToks: Token[], ctx: ColCtx):
    {sources: ColumnSource[]; predicates: Token[][]} {
  var sources: ColumnSource[]=[], predicates: Token[][]=[];
  var i=0, guard=0;

  function predEnd(after: number): number {
    var d=0;
    for(var k=after;k<fromToks.length;k++){
      var t=fromToks[k];
      if(t.v==='(') d++;
      else if(t.v===')') d--;
      if(d===0&&k>after&&(COL_CLAUSE_START[t.u]===1||
         (t.type==='word'&&COL_JOIN_PREFIX[t.u]===1&&t.u!=='CASCADE')||t.v===',')) return k;
    }
    return fromToks.length;
  }

  while(i<fromToks.length&&guard++<400){
    var t=fromToks[i];
    if(t.type==='word'&&COL_JOIN_PREFIX[t.u]===1){ i++; continue; }
    if(t.v===','){ i++; continue; }
    var source: ColumnSource | null=null;
    var start=i;

    if(t.v==='('){
      var d=1, j=i+1, innerStart=j;
      while(j<fromToks.length&&d>0){
        if(fromToks[j].v==='(') d++;
        else if(fromToks[j].v===')') d--;
        j++;
      }
      var inner=fromToks.slice(innerStart,j-1);
      var k2=j;
      while(k2<fromToks.length&&fromToks[k2].u==='AS') k2++;
      var alias: string | null=null;
      var colAliasTok: Token[] | null=null;
      if(k2<fromToks.length&&fromToks[k2].type==='word'&&
         COL_CLAUSE_START[fromToks[k2].u]===undefined){
        alias=fromToks[k2].v;
        k2++;
        if(fromToks[k2]&&fromToks[k2].v==='('){
          var dd=1, g=k2+1;
          var innerAlias: Token[]=[];
          while(g<fromToks.length&&dd>0){
            if(fromToks[g].v==='(') dd++;
            else if(fromToks[g].v===')') dd--;
            if(dd>=1) innerAlias.push(fromToks[g]);
            g++;
          }
          colAliasTok=innerAlias;
          k2=g;
        }
      }
      var headT=inner[0]?inner[0].u:'';
      var kind: ColumnSourceKind='derived';
      var derivedCols: string[]=[];
      if(headT==='SELECT'){
        var innerRes=colAnalyseToks(inner, {cteColumns:ctx.cteColumns,
          catalogue:ctx.catalogue, dialect:ctx.dialect, depth:ctx.depth+1});
        if(innerRes) derivedCols=innerRes.outputs.map(function(o){return o.name;});
      } else if(headT==='VALUES'){
        kind='opaque';
      } else {
        kind='opaque';
      }
      var columns=derivedCols.slice();
      if(colAliasTok&&colAliasTok.length){
        columns=colNamesOf(colAliasTok);
        if(headT!=='SELECT'&&columns.length) kind='derived';
      }
      source={key:alias||'(derived)', name:alias||'(derived)', alias:alias,
              kind:kind, columns:columns,
              columnsKnown:kind==='derived'||columns.length>0,
              span:spanOfTokens(fromToks.slice(start,k2))};
      i=k2;
    } else {
      var q: string[]=[], kq=i;
      while(kq<fromToks.length&&fromToks[kq].type==='word'){
        q.push(fromToks[kq].v);
        if(fromToks[kq+1]&&fromToks[kq+1].v==='.'&&fromToks[kq+2]&&fromToks[kq+2].type==='word'){
          kq+=2; continue;
        }
        break;
      }
      if(!q.length){ i++; continue; }
      var name=q.join('.');
      var k3=kq+1;
      while(k3<fromToks.length&&['FULLTEXT','WINDOW'].indexOf(fromToks[k3].u)>=0) k3++;
      var alias2: string | null=null;
      var colAlias2: Token[] | null=null;
      if(fromToks[k3]&&fromToks[k3].u==='AS') k3++;
      if(fromToks[k3]&&fromToks[k3].type==='word'&&
         COL_CLAUSE_START[fromToks[k3].u]===undefined&&
         COL_JOIN_PREFIX[fromToks[k3].u]===undefined&&fromToks[k3].v!==';'){
        alias2=fromToks[k3].v; k3++;
        if(fromToks[k3]&&fromToks[k3].v==='('){
          var dd2=1, g2=k3+1, innerAlias2: Token[]=[];
          while(g2<fromToks.length&&dd2>0){
            if(fromToks[g2].v==='(') dd2++;
            else if(fromToks[g2].v===')') dd2--;
            if(dd2>=1) innerAlias2.push(fromToks[g2]);
            g2++;
          }
          colAlias2=innerAlias2;
          k3=g2;
        }
      }
      var kind2: ColumnSourceKind='table';
      var cols2: string[]=[];
      var uppers=name.toUpperCase();
      if(ctx.cteColumns&&ctx.cteColumns[uppers]){
        kind2='cte';
        cols2=ctx.cteColumns[uppers].slice();
      } else if(TABULAR_FUNCS[uppers]===1){
        kind2='tabfunc';
      } else if(ctx.catalogue){
        cols2=catalogueColumnsFor(ctx.catalogue,name);
      }
      if(colAlias2&&colAlias2.length) cols2=colNamesOf(colAlias2);
      source={key:alias2||name, name:name, alias:alias2, kind:kind2,
              columns:cols2,
              columnsKnown:kind2==='cte'||cols2.length>0||
                (kind2==='tabfunc'&&!!(colAlias2&&colAlias2.length)),
              span:spanOfTokens(fromToks.slice(start,k3))};
      i=k3;
    }

    if(source) sources.push(source);

    if(i<fromToks.length&&(fromToks[i].u==='ON'||fromToks[i].u==='USING')){
      var isUsing=fromToks[i].u==='USING'&&fromToks[i+1]&&fromToks[i+1].v==='(';
      var predE=predEnd(i+1);
      var predToks=fromToks.slice(i+1,predE);
      if(isUsing){
        var pu: Token[]=[], dd3=1, g3=1;
        while(g3<predToks.length&&dd3>0){
          if(predToks[g3].v==='(') dd3++;
          else if(predToks[g3].v===')') dd3--;
          if(dd3>=1) pu.push(predToks[g3]);
          g3++;
        }
        predToks=pu;
      }
      if(predToks.length) predicates.push(predToks);
      i=predE;
    } else if(i<fromToks.length&&fromToks[i].v===','){
      i++;
    }
  }
  return {sources:sources, predicates:predicates};
}

function colBind(qualifier: string | null, col: string, span: SourceSpan,
    sources: ColumnSource[], diagnostics: Diagnostic[]):
    {resolution: ColumnResolution; source: string | null} {
  var colUp=col.toUpperCase();
  if(qualifier){
    var qUp=qualifier.toUpperCase();
    var matches=sources.filter(function(s){return s.key.toUpperCase()===qUp;});
    if(!matches.length){
      diagnostics.push({severity:'warning', code:'column_opaque',
        message:'Column reference "'+qualifier+'.'+col+'" does not match any source in this query; its binding is opaque. Check the source alias or table name.',
        span:span, scope:'region'});
      return {resolution:'opaque', source:null};
    }
    if(matches.length>1){
      diagnostics.push({severity:'warning', code:'column_ambiguous',
        message:'Column reference "'+qualifier+'.'+col+'" matches more than one source; the binding is left unresolved.',
        span:span, scope:'region'});
      return {resolution:'ambiguous', source:null};
    }
    var src=matches[0];
    if(src.columnsKnown){
      var known=src.columns.some(function(c){return c.toUpperCase()===colUp;});
      if(!known){
        diagnostics.push({severity:'warning', code:'column_opaque',
          message:'Column "'+col+'" is not among the known columns of "'+src.name+'"; the binding is opaque.',
          span:span, scope:'region'});
        return {resolution:'opaque', source:null};
      }
    }
    return {resolution:'exact', source:src.key};
  }
  var candidates=sources.filter(function(s){
    if(!s.columnsKnown) return true;
    return s.columns.some(function(c){return c.toUpperCase()===colUp;});
  });
  if(candidates.length===1)
    return {resolution:'exact', source:candidates[0].key};
  if(candidates.length===0){
    diagnostics.push({severity:'warning', code:'column_opaque',
      message:'Column reference "'+col+'" matches no provable column in this query; the binding is opaque.',
      span:span, scope:'region'});
    return {resolution:'opaque', source:null};
  }
  var names=candidates.slice(0,4).map(function(s){return '"'+s.key+'"';}).join(', ');
  diagnostics.push({severity:'warning', code:'column_ambiguous',
    message:'Column reference "'+col+'" is ambiguous: it matches '+candidates.length+
      ' sources ('+names+'…); no binding is invented.',
    span:span, scope:'region'});
  return {resolution:'ambiguous', source:null};
}

/* Scan an expression region for column references, binding each against the
   scope. Scalar subqueries are opaque and skipped. */
function colScanRefs(toks: Token[], sources: ColumnSource[], diagnostics: Diagnostic[]):
    {refs: ColumnReference[]; bound: Array<{qualifier: string | null; name: string;
     span: SourceSpan | null; resolution: ColumnResolution; source: string | null}>;
     opaqueSpans: SourceSpan[]} {
  var refs: ColumnReference[]=[], bound: Array<{qualifier: string | null; name: string;
      span: SourceSpan | null; resolution: ColumnResolution; source: string | null}>=[];
  var opaqueSpans: SourceSpan[]=[];
  function addRef(qualifier: string | null, name: string, span: SourceSpan): void {
    var res=colBind(qualifier,name,span,sources,diagnostics);
    refs.push({qualifier:qualifier,name:name,span:span,resolution:res.resolution});
    bound.push({qualifier:qualifier,name:name,span:span,resolution:res.resolution,
                source:res.source});
  }
  var i=0;
  while(i<toks.length){
    var t=toks[i];
    if(t.v==='('){
      if(toks[i+1]&&toks[i+1].u==='SELECT'){
        var d=1, e=i+1;
        while(e<toks.length&&d>0){
          if(toks[e].v==='(') d++;
          else if(toks[e].v===')') d--;
          e++;
        }
        var subSpan: SourceSpan={start:t.pos,end:toks[e-1].end};
        opaqueSpans.push(subSpan);
        diagnostics.push({severity:'warning', code:'column_opaque',
          message:'A subquery expression cannot be resolved at column level in this version; its binding is opaque.',
          span:subSpan, scope:'region'});
        i=e;
        continue;
      }
      i++; continue;
    }
    if(t.v==='*'||t.type!=='word'){ i++; continue; }
    var u=t.u;
    if(t.v.charAt(0)==='@'){ i++; continue; }
    if(COL_REF_SKIP[u]===1){ i++; continue; }
    if(toks[i+1]&&toks[i+1].v==='('){ i++; continue; }   /* function call */
    if(!(i>0&&toks[i-1].v==='.')){
      if(toks[i+1]&&toks[i+1].v==='.'&&toks[i+2]&&toks[i+2].type==='word'){
        var parts: string[]=[t.v], k=i+2;
        while(toks[k+1]&&toks[k+1].v==='.'&&toks[k+2]&&toks[k+2].type==='word'){
          parts.push(toks[k].v); k+=2;
        }
        parts.push(toks[k].v);
        var last=parts[parts.length-1];
        var q=parts.slice(0,parts.length-1).join('.');
        addRef(q,last,{start:t.pos,end:toks[k].end});
        i=k+1;
        continue;
      }
      addRef(null,t.v,{start:t.pos,end:t.end});
    }
    i++;
  }
  return {refs:refs, bound:bound, opaqueSpans:opaqueSpans};
}

function colParseItems(projToks: Token[]):
    Array<{expr: Token[]; alias: string | null; span: SourceSpan | null}> {
  var items: Array<{expr: Token[]; alias: string | null; span: SourceSpan | null}>=[];
  var cur: Token[]=[], d=0;
  projToks.forEach(function(t){
    if(t.v==='(') d++;
    else if(t.v===')') d--;
    if(t.v===','&&d===0){ items.push({expr:cur,alias:null,span:null}); cur=[]; return; }
    cur.push(t);
  });
  items.push({expr:cur,alias:null,span:null});
  var out: Array<{expr: Token[]; alias: string | null; span: SourceSpan | null}>=[];
  items.forEach(function(item){
    var toks=item.expr;
    if(!toks.length) return;
    var alias: string | null=null, expr: Token[]=toks.slice();
    var asIx=-1, d2=0;
    for(var i=0;i<toks.length;i++){
      if(toks[i].v==='(') d2++;
      else if(toks[i].v===')') d2--;
      if(d2===0&&toks[i].u==='AS'){ asIx=i; break; }
    }
    if(asIx>=0&&toks[asIx+1]){
      alias=toks[asIx+1].v;
      expr=toks.slice(0,asIx);
    } else if(toks.length>=2){
      var last=toks[toks.length-1];
      var prev=toks[toks.length-2];
      if(last.type==='word'&&prev.v!=='.'&&COL_REF_SKIP[last.u]===undefined&&
         COL_CLAUSE_START[last.u]===undefined&&last.v!==';'){
        alias=last.v;
        expr=toks.slice(0,toks.length-1);
      }
    }
    out.push({expr:expr, alias:alias, span:spanOfTokens(toks)});
  });
  return out;
}

function colOutputName(expr: Token[], refs: ColumnReference[]): string {
  if(!expr.length) return '';
  if(expr.length===1) return expr[0].v;
  var lastWord: string | null=null;
  for(var i=0;i<expr.length;i++){
    var t=expr[i];
    if(t.type==='word'&&COL_REF_SKIP[t.u]===undefined&&
       !(expr[i+1]&&expr[i+1].v==='(')) lastWord=t.v;
  }
  if(lastWord) return lastWord;
  return clip(joinToks(expr,40),40);
}

function colSourceByKey(sources: ColumnSource[], key: string): ColumnSource | null {
  var up=key.toUpperCase();
  for(var i=0;i<sources.length;i++)
    if(sources[i].key.toUpperCase()===up) return sources[i];
  return null;
}

/* Analyse one SELECT arm. */
function colAnalyseArm(toks: Token[], ctx: ColCtx, first: boolean):
    {outputs: ColumnOutput[]; sources: ColumnSource[]; references: ColumnReference[];
     wildcards: ColumnWildcard[]; opaqueCount: number; diagnostics: Diagnostic[]} | null {
  if(!toks.length||toks[0].u!=='SELECT') return null;
  var regions=colRegionsOf(toks);
  var projToks=toks.slice(regions.proj[0],regions.proj[1]);
  var fromToks=regions.from[0]>=0 ? toks.slice(regions.from[0],regions.from[1]) : [];
  var diagnostics: Diagnostic[]=[];
  var parsed=colParseSources(fromToks,ctx);
  var sources=parsed.sources;
  var references: ColumnReference[]=[];
  var wildcards: ColumnWildcard[]=[];
  var opaqueCount=0;
  var outputs: ColumnOutput[]=[];

  function scanRegion(region: Token[]): void {
    if(!region||!region.length) return;
    var scan=colScanRefs(region,sources,diagnostics);
    references=references.concat(scan.refs);
    scan.opaqueSpans.forEach(function(sp){ opaqueCount+=Math.max(1,colTokensInSpan(toks,sp)); });
  }

  if(regions.from[0]>=0){
    parsed.predicates.forEach(function(pred){ scanRegion(pred); });
    var d=0;
    for(var cl=regions.from[1]; cl<toks.length; cl++){
      var t=toks[cl];
      if(t.type!=='word'){
        if(t.v==='(') d++;
        else if(t.v===')') d--;
        continue;
      }
      if(d>0) continue;
      if(COL_CLAUSE_START[t.u]===1&&
         ['WHERE','GROUP','HAVING','ORDER','LIMIT','OFFSET','FETCH'].indexOf(t.u)>=0){
        var dd=0, e=cl+1;
        while(e<toks.length){
          if(toks[e].v==='(') dd++;
          else if(toks[e].v===')') dd--;
          if(dd===0&&e>cl+1&&((toks[e].type==='word'&&COL_CLAUSE_START[toks[e].u]===1)||
             toks[e].v===',')) break;
          e++;
        }
        while(e>cl+1&&toks[e-1].v===',') e--;
        scanRegion(toks.slice(cl+1,e));
        cl=e-1;
      }
    }
  }

  var items=colParseItems(projToks);
  items.forEach(function(item){
    var itemSpan=item.span||spanOfTokens(item.expr);
    var starCount=0;
    for(var w=0;w<item.expr.length;w++){
      var wt=item.expr[w];
      if(wt.v!=='*') continue;
      /* a `*` is a wildcard only at the start of an item or after '.';
         anywhere else it is the multiplication operator */
      if(w>0&&item.expr[w-1].v!=='.') continue;
      starCount++;
      var srcName: string | null=null;
      var exp: ColumnSource | null=null;
      if(w>=1&&item.expr[w-1].v==='.'&&item.expr[w-2]&&item.expr[w-2].type==='word'){
        srcName=item.expr[w-2].v;
        exp=colSourceByKey(sources,srcName);
        if(!exp){
          diagnostics.push({severity:'warning', code:'column_opaque',
            message:'Wildcard "'+srcName+'.*" does not match any source; it is not expanded.',
            span:{start:item.expr[w-2].pos,end:wt.end}, scope:'region'});
        }
      }
      var span: SourceSpan={start:wt.pos,end:wt.end};
      var wc: ColumnWildcard={source:exp?exp.key:null, span:span, expanded:false, columns:[]};
      if(exp&&exp.columnsKnown){
        wc.expanded=true;
        wc.columns=exp.columns.slice();
      } else if(!exp){
        if(sources.length&&sources.every(function(s){return s.columnsKnown;})){
          wc.expanded=true;
          var cols: string[]=[], seen: StringSet={};
          sources.forEach(function(s){
            s.columns.forEach(function(c){
              var cu=c.toUpperCase();
              if(!seen[cu]){ seen[cu]=1; cols.push(c); }
            });
          });
          wc.columns=cols;
        }
      }
      wildcards.push(wc);
      if(wc.expanded){
        var owner=exp;
        if(!owner&&sources.length===1) owner=sources[0];
        if(owner){
          owner.columns.forEach(function(c){
            if(exp){   /* qualified expansion: provable per-source columns */
              outputs.push({name:c, label:owner.key+'.*', span:itemSpan, resolution:'exact',
                bindings:[{source:owner.key, column:c, span:span}]});
            } else {
              outputs.push({name:c, label:'*', span:itemSpan, resolution:'exact',
                bindings:[{source:owner.key, column:c, span:span}]});
            }
          });
        }
      }
    }
    if(starCount) return;

    if(!item.expr.length) return;
    var scan=colScanRefs(item.expr,sources,diagnostics);
    references=references.concat(scan.refs);
    var resolution: ColumnResolution='exact';
    var bindings: ColumnBinding[]=[];
    var reason: string | undefined=undefined;
    scan.bound.forEach(function(b){
      if(b.resolution==='opaque'){ resolution='opaque'; reason='unsupported or unresolvable expression'; }
      else if(b.resolution==='ambiguous'&&resolution==='exact'){ resolution='ambiguous';
        reason='ambiguous column reference; no binding invented'; }
      if(b.resolution==='exact'&&b.source&&b.span)
        bindings.push({source:b.source,column:b.name,span:b.span});
    });
    if(scan.opaqueSpans.length){ resolution='opaque'; reason='subquery expression is opaque'; }
    scan.opaqueSpans.forEach(function(sp){ opaqueCount+=Math.max(1,colTokensInSpan(toks,sp)); });
    var name=item.alias||colOutputName(item.expr,scan.refs);
    outputs.push({name:name, label:item.alias||clip(joinToks(item.expr,40),40),
                  span:itemSpan, bindings:bindings, resolution:resolution,
                  reason:reason});
  });

  return {outputs:outputs, sources:sources, references:references,
          wildcards:wildcards, opaqueCount:opaqueCount, diagnostics:diagnostics};
}

/* Analyse one query (WITH … SELECT or plain SELECT) down to column level. */
function colAnalyseToks(toks: Token[], ctx: ColCtx): ColumnLineage | null {
  if(!toks.length) return null;
  if(ctx.depth>8) return null;
  var split=splitCtesColumn(toks);
  var diagnostics: Diagnostic[]=[];
  var references: ColumnReference[]=[];
  var wildcards: ColumnWildcard[]=[];
  var opaqueCount=0;
  var sourcesAll: ColumnSource[]=[];
  var outputs: ColumnOutput[]=[];

  var cteMap: Record<string, string[]>={};
  if(ctx.cteColumns)
    Object.keys(ctx.cteColumns).forEach(function(k){ cteMap[k]=ctx.cteColumns[k]; });
  split.ctes.forEach(function(cte){
    var child: ColCtx={cteColumns:cteMap, catalogue:ctx.catalogue,
                       dialect:ctx.dialect, depth:ctx.depth+1};
    var inner=colAnalyseToks(cte.body,child);
    var cols=cte.colToks&&cte.colToks.length
      ? colNamesOf(cte.colToks)
      : ((inner&&inner.outputs.map(function(o){return o.name;}))||[]);
    cteMap[cte.name.toUpperCase()]=cols;
    if(inner){
      references=references.concat(inner.references);
      wildcards=wildcards.concat(inner.wildcards);
      opaqueCount+=inner.opaqueCount;
      inner.diagnostics.forEach(function(d){ diagnostics.push(d); });
      inner.sources.forEach(function(s){ if(!colSourceByKey(sourcesAll,s.key)) sourcesAll.push(s); });
    }
  });

  var finalToks=toks.slice(split.finalStart);
  if(!finalToks.length||finalToks[0].u!=='SELECT') return null;
  var arms=colSplitArms(finalToks);
  var firstDone=false;
  for(var a=0;a<arms.length;a++){
    var arm=colAnalyseArm(arms[a],{cteColumns:cteMap, catalogue:ctx.catalogue,
      dialect:ctx.dialect, depth:ctx.depth+1}, a===0);
    if(!arm) continue;
    references=references.concat(arm.references);
    wildcards=wildcards.concat(arm.wildcards);
    opaqueCount+=arm.opaqueCount;
    arm.diagnostics.forEach(function(d){ diagnostics.push(d); });
    arm.sources.forEach(function(s){ if(!colSourceByKey(sourcesAll,s.key)) sourcesAll.push(s); });
    if(!firstDone){ outputs=arm.outputs; firstDone=true; }
  }

  return {sources:sourcesAll, outputs:outputs, wildcards:wildcards,
          references:references, tokensConsumed:toks.length,
          tokensOpaque:opaqueCount, opaqueCount:opaqueCount,
          diagnostics:diagnostics};
}

/* Public entry point: analyse one query statement's column lineage. Returns
   null when the tokens do not represent a SELECT query. */
function analyseColumns(toks: Token[], opts?: {catalogue?: Catalogue | null;
    dialect?: Dialect}): ColumnLineage | null {
  opts=opts||{};
  var ctx: ColCtx={cteColumns:{}, catalogue:opts.catalogue||null,
                   dialect:opts.dialect, depth:0};
  return colAnalyseToks(toks||[],ctx);
}
