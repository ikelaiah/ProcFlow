/* ===== v2.1.0 ERD export (declared constraints only) =====
   Renders the schema IR as a Mermaid `erDiagram`. Relationships are derived
   only from declared FOREIGN KEY constraints; the exporter never infers an
   edge. Sanitized identifiers keep Mermaid syntax valid while `%%` provenance
   comments preserve the original entity, column, and type names. */

function erdToken(value: string): string {
  var s=String(value==null?'':value).replace(/[^A-Za-z0-9_]/g,'_')
    .replace(/_+/g,'_').replace(/^_+|_+$/g,'');
  return s||'unknown';
}

function erdTypeToken(value: string): string {
  var s=erdToken(value);
  return s==='unknown'?'unknown':s;
}

/* Deterministic, collision-free Mermaid entity identifiers. */
function erdEntityIds(result: SchemaResult): Record<string, string> {
  var used: Record<string, number>={}, map: Record<string, string>={};
  result.entities.forEach(function(entity){
    var base=erdToken(entity.id).toUpperCase();
    if(/^[0-9]/.test(base)) base='E_'+base;
    var count=used[base]||0;
    var candidate=base;
    if(count>0){
      do { count++; candidate=base+'_'+count; } while(used[candidate]);
      used[base]=count;
    }
    used[candidate]=1;
    map[entity.id]=candidate;
  });
  return map;
}

function erdHasColumn(key: SchemaKey, column: string): boolean {
  var norm=schemaNormColumn(column);
  return key.columns.some(function(name){ return schemaNormColumn(name)===norm; });
}

function erdColumnKeys(entity: SchemaEntity, column: SchemaColumn): string[] {
  var keys: string[]=[];
  var pk=column.primaryKey||entity.keys.some(function(k){
    return k.kind==='pk'&&erdHasColumn(k,column.name);
  });
  if(pk) keys.push('PK');
  var fk=entity.keys.some(function(k){
    return k.kind==='fk'&&erdHasColumn(k,column.name);
  });
  if(fk) keys.push('FK');
  var uk=column.unique||entity.keys.some(function(k){
    return k.kind==='unique'&&erdHasColumn(k,column.name);
  });
  if(uk) keys.push('UK');
  return keys;
}

/* Cardinality notation, read as "how many <parent> per <child>" on the left
   and "how many <child> per <parent>" on the right:
     mandatory one-to-many:  PARENT ||--o{ CHILD
     optional  one-to-many:  PARENT o|--o{
     mandatory one-to-one:   PARENT ||--||
     optional  one-to-one:   PARENT o|--||                             */
function erdRelationshipCardinality(rel: SchemaRelationship): {left: string; right: string} {
  return {left:rel.optional?'o|':'||',right:rel.unique?'||':'o{'};
}

function erdRelationshipLabel(rel: SchemaRelationship, child: SchemaEntity): string {
  if(rel.name) return erdToken(rel.name);
  var columns=rel.toColumns.length?rel.toColumns:['fk'];
  return erdToken('fk_'+child.name.replace(/\./g,'_')+'_'+columns.join('_'));
}

/* Mermaid `erDiagram` text. Entity blocks come first, then relationship lines,
   then the provenance map as comments. Deterministic for a given schema. */
function toMermaidER(result: SchemaResult): string {
  var ids=erdEntityIds(result);
  var lines: string[]=['erDiagram'];
  lines.push('  %% procflow:erd v1 — declared constraints only; no inferred relationships');
  lines.push('  %% schema tables='+result.stats.tables+' views='+result.stats.views+
             ' columns='+result.stats.columns+' relationships='+result.stats.relationships+
             ' unresolved='+result.stats.unresolved);
  result.entities.forEach(function(entity){
    var id=ids[entity.id];
    if(entity.columns.length){
      lines.push('  '+id+' {');
      entity.columns.forEach(function(column){
        var keys=erdColumnKeys(entity,column);
        var line='    '+erdTypeToken(column.type)+' '+erdToken(column.name)+
          (keys.length?' '+keys.join(', '):'');
        var rawType=(column.type||'').trim();
        if(rawType&&rawType!==erdTypeToken(rawType)){
          line+=' "'+rawType.replace(/"/g,"'")+'"';
        }
        lines.push(line);
      });
      lines.push('  }');
    } else {
      lines.push('  %% '+id+' has no declared columns'+(entity.unresolved?' (unresolved reference)':''));
    }
  });
  result.relationships.forEach(function(rel){
    var from=ids[rel.fromId], to=ids[rel.toId];
    if(!from||!to) return;
    var child=result.entities.filter(function(entity){ return entity.id===rel.toId; })[0];
    var card=erdRelationshipCardinality(rel);
    lines.push('  '+from+' '+card.left+'--'+card.right+' '+to+' : '+
               erdRelationshipLabel(rel,child||({name:'entity'} as SchemaEntity)));
  });
  result.entities.forEach(function(entity){
    lines.push('  %% entity '+ids[entity.id]+' = "'+entity.name+'" ('+entity.kind+
               (entity.unresolved?', unresolved':'')+')');
  });
  result.entities.forEach(function(entity){
    entity.columns.forEach(function(column){
      lines.push('  %% column '+ids[entity.id]+'.'+column.name+' : '+
                 (column.type||'(no declared type)'));
    });
  });
  result.relationships.forEach(function(rel){
    lines.push('  %% relationship '+ids[rel.fromId]+' -> '+ids[rel.toId]+' '+
               rel.cardinality+(rel.optional?' optional':' mandatory')+
               ' ['+(rel.fromColumns.join(',')||'?')+' -> '+rel.toColumns.join(',')+']'+
               (rel.name?' constraint '+rel.name:'')+' resolution='+rel.resolution);
  });
  return lines.join('\n');
}

/* ===== v2.2.0 deterministic ERD layout =====
   Pure geometry over the schema IR: no DOM, no randomness. Card sizes come
   from the page so positions never overlap; the default layout preserves
   declaration order, and Auto-arrange uses a layered parent→child flow with
   bounded barycenter crossing reduction. Cycles and self-references are
   broken deterministically (first unassigned node by declaration order). */

function erdLayoutFingerprint(result: SchemaResult): string {
  var text=result.entities.map(function(entity){
    return entity.id+'|'+entity.kind;
  }).sort().join(';');
  var hash=2166136261;
  for(var i=0;i<text.length;i++){
    hash^=text.charCodeAt(i);
    hash=Math.imul(hash,16777619);
  }
  return ('0000000'+((hash>>>0).toString(16))).slice(-8);
}

function erdResolvedSourceId(result: SchemaResult, norm: string): string | null {
  for(var i=0;i<result.entities.length;i++){
    if(result.entities[i].id===norm) return norm;
  }
  var last=norm.split('.').pop(), match: string | null=null;
  for(var j=0;j<result.entities.length;j++){
    var parts=result.entities[j].id.split('.');
    if(parts[parts.length-1]===last){
      if(match) return null; /* ambiguous: no layout claim */
      match=result.entities[j].id;
    }
  }
  return match;
}

function erdSizeOf(sizes: Record<string, ErdLayoutSize>, id: string): ErdLayoutSize {
  var size=sizes[id];
  return size&&size.w>0&&size.h>0?size:{w:260,h:140};
}

/* Declaration-order packing into fixed columns (initial and Reset layout). */
function erdDefaultLayout(result: SchemaResult,
                          sizes: Record<string, ErdLayoutSize>,
                          columns?: number): ErdLayoutResult {
  var entities=result.entities;
  var count=entities.length;
  var cols=Math.max(1,Math.min(columns||Math.ceil(Math.sqrt(count||1)),8));
  var gapX=64, gapY=56, width=0;
  for(var s=0;s<count;s++) width=Math.max(width,erdSizeOf(sizes,entities[s].id).w);
  var colHeights: number[]=[];
  for(var c=0;c<cols;c++) colHeights.push(0);
  var positions: Record<string, ErdLayoutPosition>={};
  var layoutColumns: string[][]=[];
  for(var k=0;k<cols;k++) layoutColumns.push([]);
  entities.forEach(function(entity,index){
    var col=index%cols;
    var size=erdSizeOf(sizes,entity.id);
    positions[entity.id]={x:col*(width+gapX),y:colHeights[col]};
    layoutColumns[col].push(entity.id);
    colHeights[col]+=size.h+gapY;
  });
  var height=0;
  colHeights.forEach(function(h){ height=Math.max(height,h); });
  return {positions:positions,columns:layoutColumns,
          width:cols*(width+gapX)-(count?gapX:0),
          height:Math.max(height-gapY,0)};
}

/* Layered parent→child flow with bounded crossing reduction. */
function erdAutoLayout(result: SchemaResult,
                       sizes: Record<string, ErdLayoutSize>): ErdLayoutResult {
  var entities=result.entities, count=entities.length;
  if(!count) return {positions:{},columns:[],width:0,height:0};
  var indexOf: Record<string, number>={};
  entities.forEach(function(entity,index){ indexOf[entity.id]=index; });
  var parents: number[][]=[], children: number[][]=[], seen: StringSet={};
  for(var a=0;a<count;a++){ parents.push([]); children.push([]); }
  function edge(parentId: string, childId: string): void {
    var p=indexOf[parentId], c=indexOf[childId];
    if(p===undefined||c===undefined||p===c) return;
    var key=Math.min(p,c)+'>'+Math.max(p,c);
    if(seen[key]) return;
    seen[key]=1;
    parents[c].push(p);
    children[p].push(c);
  }
  result.relationships.forEach(function(rel){ edge(rel.fromId,rel.toId); });
  entities.forEach(function(entity){
    if(entity.kind!=='view') return;
    (entity.sources||[]).forEach(function(source){
      var id=erdResolvedSourceId(result,source);
      if(id) edge(id,entity.id);
    });
  });
  var layer: number[]=[], assigned: boolean[]=[];
  for(var z=0;z<count;z++){ layer.push(0); assigned.push(false); }
  var done=0, guard=0;
  while(done<count&&guard++<count*2+4){
    var progressed=false;
    for(var i=0;i<count;i++){
      if(assigned[i]) continue;
      var ready=true;
      for(var q=0;q<parents[i].length;q++){
        if(!assigned[parents[i][q]]){ ready=false; break; }
      }
      if(ready){
        var depth=0;
        parents[i].forEach(function(p){ depth=Math.max(depth,layer[p]+1); });
        layer[i]=depth; assigned[i]=true; done++; progressed=true;
      }
    }
    if(!progressed){
      /* Cycle or self-lock: break deterministically at the earliest entity. */
      for(var b=0;b<count;b++){
        if(assigned[b]) continue;
        var base=0;
        parents[b].forEach(function(p){ if(assigned[p]) base=Math.max(base,layer[p]+1); });
        layer[b]=Math.max(1,base); assigned[b]=true; done++;
        break;
      }
    }
  }
  var maxLayer=0;
  layer.forEach(function(value){ maxLayer=Math.max(maxLayer,value); });
  /* Views with no declared sources sit in their own downstream band. */
  entities.forEach(function(entity,index){
    if(entity.kind==='view'&&!parents[index].length) layer[index]=maxLayer+1;
  });
  var distinct: number[]=[];
  layer.forEach(function(value){ if(distinct.indexOf(value)<0) distinct.push(value); });
  distinct.sort(function(x,y){ return x-y; });
  var layerToColumn: Record<string, number>={};
  distinct.forEach(function(value,index){ layerToColumn[String(value)]=index; });
  var columnCount=distinct.length;
  var order: number[][]=[];
  for(var col=0;col<columnCount;col++) order.push([]);
  entities.forEach(function(entity,index){
    order[layerToColumn[String(layer[index])]].push(index);
  });
  var rowOf: number[]=[];
  entities.forEach(function(){ rowOf.push(0); });
  function refreshRows(): void {
    order.forEach(function(column){
      column.forEach(function(index,row){ rowOf[index]=row; });
    });
  }
  refreshRows();
  function barycenter(index: number, neighbor: number[][]): number {
    var list=neighbor[index];
    if(!list||!list.length) return rowOf[index];
    var sum=0;
    list.forEach(function(other){ sum+=rowOf[other]; });
    return sum/list.length;
  }
  for(var pass=0;pass<4;pass++){
    var forward=pass%2===0;
    if(forward){
      for(var c=1;c<columnCount;c++){
        var colList=order[c];
        colList.sort(function(x,y){
          var diff=barycenter(x,parents)-barycenter(y,parents);
          return diff!==0?diff:x-y;
        });
        refreshRows();
      }
    } else {
      for(var d=columnCount-2;d>=0;d--){
        var backList=order[d];
        backList.sort(function(x,y){
          var diff=barycenter(x,children)-barycenter(y,children);
          return diff!==0?diff:x-y;
        });
        refreshRows();
      }
    }
  }
  /* Tall columns are chunked before banding: a 799-leaf fan becomes a readable
     grid instead of one 128,000-pixel column. Chunks stay in the same layer,
     so declared parent→child order is preserved. */
  var maxRowsPerColumn=14;
  var chunkedOrder: number[][]=[];
  order.forEach(function(column){
    if(column.length<=maxRowsPerColumn){ chunkedOrder.push(column); return; }
    for(var start=0;start<column.length;start+=maxRowsPerColumn){
      chunkedOrder.push(column.slice(start,start+maxRowsPerColumn));
    }
  });
  order=chunkedOrder;
  var columnCountExpanded=order.length;
  /* Wide estates wrap into bands (snake layout): a 800-long chain becomes a
     readable grid instead of one 200,000-pixel line. Bands are deterministic
     and keep parent→child order inside each band. */
  var gapX=72, gapY=56, bandGapY=140, maxColumnsPerBand=12;
  var positions: Record<string, ErdLayoutPosition>={}, placedColumns: string[][]=[];
  var bandStart=0, bandY=0;
  while(bandStart<columnCountExpanded){
    var bandEnd=Math.min(columnCountExpanded,bandStart+maxColumnsPerBand);
    var localWidth: number[]=[], localHeight: number[]=[];
    for(var bandColumn=bandStart;bandColumn<bandEnd;bandColumn++){
      var widthMax=0, heightSum=0;
      order[bandColumn].forEach(function(index,row){
        var size=erdSizeOf(sizes,entities[index].id);
        if(size.w>widthMax) widthMax=size.w;
        heightSum+=size.h+(row?gapY:0);
      });
      localWidth.push(widthMax);
      localHeight.push(heightSum);
    }
    var bandTallest=0;
    localHeight.forEach(function(value){ bandTallest=Math.max(bandTallest,value); });
    var x=0;
    for(var column=bandStart;column<bandEnd;column++){
      var local=column-bandStart;
      var y=bandY+Math.max(0,(bandTallest-localHeight[local])/2), ids: string[]=[];
      order[column].forEach(function(index,row){
        var entity=entities[index], size=erdSizeOf(sizes,entity.id);
        if(row) y+=gapY;
        positions[entity.id]={x:x+(localWidth[local]-size.w)/2,y:y};
        ids.push(entity.id);
        y+=size.h;
      });
      placedColumns.push(ids);
      x+=localWidth[local]+gapX;
    }
    bandY+=bandTallest+bandGapY;
    bandStart=bandEnd;
  }
  var width=0, height=0;
  Object.keys(positions).forEach(function(id){
    var size=erdSizeOf(sizes,id);
    width=Math.max(width,positions[id].x+size.w);
    height=Math.max(height,positions[id].y+size.h);
  });
  return {positions:positions,columns:placedColumns,width:width,height:height};
}

/* Layout files are explicit, versioned, and keyed by schema fingerprint so a
   stale layout cannot silently mismatch a changed schema. */
function erdLayoutToJSON(result: SchemaResult,
                         positions: Record<string, ErdLayoutPosition>): string {
  var ordered: Record<string, ErdLayoutPosition>={};
  result.entities.forEach(function(entity){
    var position=positions[entity.id];
    if(position) ordered[entity.id]={x:Math.round(position.x),y:Math.round(position.y)};
  });
  var file: ErdLayoutFile={format:'procflow-erd-layout',version:1,
                           fingerprint:erdLayoutFingerprint(result),
                           positions:ordered};
  return JSON.stringify(file,null,1);
}

function erdLayoutFromJSON(text: string): ErdLayoutParseResult {
  var diagnostics: Diagnostic[]=[];
  function fail(code: string, message: string): ErdLayoutParseResult {
    diagnostics.push({severity:'error',code:code,message:message,span:null,
                      scope:'document'});
    return {file:null,diagnostics:diagnostics};
  }
  var parsed: any;
  try {
    parsed=JSON.parse(text);
  } catch(err){
    return fail('erd_layout_parse_error','Layout file is not valid JSON.');
  }
  if(!parsed||typeof parsed!=='object'||parsed.format!=='procflow-erd-layout'){
    return fail('erd_layout_format_error','Layout file is not a ProcFlow ERD layout.');
  }
  if(parsed.version!==1){
    return fail('erd_layout_version_error',
      'Layout file version '+String(parsed.version)+' is not supported.');
  }
  if(!parsed.positions||typeof parsed.positions!=='object'){
    return fail('erd_layout_format_error','Layout file has no positions.');
  }
  var positions: Record<string, ErdLayoutPosition>={};
  Object.keys(parsed.positions).forEach(function(id){
    var value=parsed.positions[id];
    if(value&&typeof value.x==='number'&&typeof value.y==='number'&&
       isFinite(value.x)&&isFinite(value.y)){
      positions[id]={x:value.x,y:value.y};
    }
  });
  return {file:{format:'procflow-erd-layout',version:1,
                fingerprint:String(parsed.fingerprint||''),
                positions:positions},
          diagnostics:diagnostics};
}


/* Bundled ERD samples (local-only, deterministic, and also used by the
   v2.1.0 fixtures so the demo path is covered by tests). */
var PROCFLOW_ERD_SAMPLE_TSQL=[
  '/* Sample retail schema — declared constraints only. */',
  'CREATE TABLE dbo.Customer (',
  '  CustomerId  INT IDENTITY(1,1) PRIMARY KEY,',
  '  Email       NVARCHAR(200) NOT NULL UNIQUE,',
  '  DisplayName NVARCHAR(120) NOT NULL,',
  '  ReferredBy  INT NULL,',
  '  CONSTRAINT FK_Customer_Referrer FOREIGN KEY (ReferredBy)',
  '    REFERENCES dbo.Customer (CustomerId)',
  ');',
  'GO',
  'CREATE TABLE dbo.Product (',
  '  ProductId INT IDENTITY(1,1) PRIMARY KEY,',
  '  Sku       VARCHAR(40) NOT NULL,',
  '  UnitPrice DECIMAL(12,2) NOT NULL,',
  '  CONSTRAINT UQ_Product_Sku UNIQUE (Sku)',
  ');',
  'GO',
  'CREATE TABLE dbo.OrderHeader (',
  '  OrderId    INT IDENTITY(1,1) PRIMARY KEY,',
  '  CustomerId INT NOT NULL,',
  '  PlacedAt   DATETIME2 NOT NULL DEFAULT (SYSUTCDATETIME()),',
  '  Status     VARCHAR(20) NOT NULL,',
  '  CONSTRAINT FK_Order_Customer FOREIGN KEY (CustomerId)',
  '    REFERENCES dbo.Customer (CustomerId),',
  '  CONSTRAINT UQ_Order_Customer UNIQUE (CustomerId)',
  ');',
  'GO',
  'CREATE TABLE dbo.OrderLine (',
  '  OrderId   INT NOT NULL,',
  '  LineNo    INT NOT NULL,',
  '  ProductId INT NOT NULL,',
  '  Quantity  INT NOT NULL,',
  '  CONSTRAINT PK_OrderLine PRIMARY KEY (OrderId, LineNo),',
  '  CONSTRAINT FK_OrderLine_Order FOREIGN KEY (OrderId)',
  '    REFERENCES dbo.OrderHeader (OrderId),',
  '  CONSTRAINT FK_OrderLine_Product FOREIGN KEY (ProductId)',
  '    REFERENCES dbo.Product (ProductId) ON DELETE CASCADE',
  ');',
  'GO',
  'CREATE VIEW dbo.vOrderValue (OrderId, LineCount, TotalValue) AS',
  '  SELECT OrderId, COUNT(*), SUM(1) FROM dbo.OrderLine GROUP BY OrderId;'
].join('\n');

/* 8 tables, 4 views. EMPLOYEE (table 2) and ORDERS (table 4) are related
   through the employee who took the order. AUDIT_LOG and APP_SETTINGS are
   standalone: nothing references them and they reference nothing. */
var PROCFLOW_ERD_SAMPLE_DB2=[
  '/* DB2 schema sample — declared constraints only. */',
  'CREATE SCHEMA sales;',
  '',
  'CREATE TABLE sales.department (',
  '  dept_id      INTEGER       NOT NULL GENERATED ALWAYS AS IDENTITY (START WITH 10 INCREMENT BY 10),',
  '  dept_name    VARCHAR(80)   NOT NULL,',
  '  location     VARCHAR(80),',
  '  CONSTRAINT pk_department PRIMARY KEY (dept_id),',
  '  CONSTRAINT uq_department_name UNIQUE (dept_name)',
  ');',
  '',
  'CREATE TABLE sales.employee (',
  '  emp_id       INTEGER       NOT NULL GENERATED BY DEFAULT AS IDENTITY,',
  '  dept_id      INTEGER       NOT NULL,',
  '  manager_id   INTEGER,',
  '  full_name    CHARACTER VARYING(120) NOT NULL,',
  '  hired_on     DATE          NOT NULL DEFAULT CURRENT DATE,',
  '  salary       DECIMAL(11,2) NOT NULL,',
  '  CONSTRAINT pk_employee PRIMARY KEY (emp_id),',
  '  CONSTRAINT fk_employee_dept FOREIGN KEY (dept_id)',
  '    REFERENCES sales.department (dept_id) ON DELETE RESTRICT,',
  '  CONSTRAINT fk_employee_manager FOREIGN KEY (manager_id)',
  '    REFERENCES sales.employee (emp_id) ON DELETE SET NULL',
  ');',
  '',
  'CREATE TABLE sales.customer (',
  '  customer_id  INTEGER       NOT NULL GENERATED ALWAYS AS IDENTITY,',
  '  customer_name VARCHAR(120) NOT NULL,',
  '  email        VARCHAR(200)  NOT NULL,',
  '  country      CHAR(2),',
  '  CONSTRAINT pk_customer PRIMARY KEY (customer_id)',
  ');',
  '',
  'CREATE TABLE sales.orders (',
  '  order_id     INTEGER       NOT NULL GENERATED ALWAYS AS IDENTITY,',
  '  customer_id  INTEGER       NOT NULL,',
  '  emp_id       INTEGER       NOT NULL,',
  '  order_date   TIMESTAMP     NOT NULL DEFAULT CURRENT TIMESTAMP,',
  '  status       VARCHAR(20)   NOT NULL,',
  '  CONSTRAINT pk_orders PRIMARY KEY (order_id),',
  '  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id)',
  '    REFERENCES sales.customer (customer_id) ON DELETE CASCADE,',
  '  CONSTRAINT fk_orders_employee FOREIGN KEY (emp_id)',
  '    REFERENCES sales.employee (emp_id) ON DELETE RESTRICT,',
  '  CONSTRAINT ck_orders_status CHECK (status IN (\'OPEN\',\'SHIPPED\',\'CANCELLED\'))',
  ');',
  '',
  'CREATE TABLE sales.product (',
  '  product_id   INTEGER       NOT NULL GENERATED ALWAYS AS IDENTITY,',
  '  sku          VARCHAR(40)   NOT NULL,',
  '  product_name VARCHAR(160)  NOT NULL,',
  '  unit_price   DECIMAL(9,2)  NOT NULL,',
  '  CONSTRAINT pk_product PRIMARY KEY (product_id)',
  ');',
  'CREATE UNIQUE INDEX sales.uq_product_sku ON sales.product (sku);',
  '',
  'CREATE TABLE sales.order_line (',
  '  order_id     INTEGER       NOT NULL,',
  '  line_no      SMALLINT      NOT NULL,',
  '  product_id   INTEGER       NOT NULL,',
  '  quantity     INTEGER       NOT NULL,',
  '  unit_price   DECIMAL(9,2)  NOT NULL,',
  '  CONSTRAINT pk_order_line PRIMARY KEY (order_id, line_no),',
  '  CONSTRAINT fk_order_line_order FOREIGN KEY (order_id)',
  '    REFERENCES sales.orders (order_id) ON DELETE CASCADE,',
  '  CONSTRAINT fk_order_line_product FOREIGN KEY (product_id)',
  '    REFERENCES sales.product (product_id) ON DELETE RESTRICT',
  ');',
  '',
  '/* Standalone table 7: audit trail, no foreign keys in or out. */',
  'CREATE TABLE sales.audit_log (',
  '  log_id       BIGINT        NOT NULL GENERATED ALWAYS AS IDENTITY,',
  '  message      VARCHAR(500)  NOT NULL,',
  '  created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT TIMESTAMP,',
  '  CONSTRAINT pk_audit_log PRIMARY KEY (log_id)',
  ');',
  '',
  '/* Standalone table 8: application settings, no foreign keys in or out. */',
  'CREATE TABLE sales.app_settings (',
  '  setting_key   VARCHAR(100) NOT NULL,',
  '  setting_value VARCHAR(500),',
  '  CONSTRAINT pk_app_settings PRIMARY KEY (setting_key)',
  ');',
  '',
  'CREATE VIEW sales.v_order_summary (order_id, customer_name, total_value) AS',
  '  SELECT o.order_id, c.customer_name, SUM(l.quantity * l.unit_price)',
  '  FROM sales.orders o',
  '  JOIN sales.customer c ON c.customer_id = o.customer_id',
  '  JOIN sales.order_line l ON l.order_id = o.order_id',
  '  GROUP BY o.order_id, c.customer_name;',
  '',
  'CREATE VIEW sales.v_employee_directory (emp_id, full_name, dept_name) AS',
  '  SELECT e.emp_id, e.full_name, d.dept_name',
  '  FROM sales.employee e',
  '  JOIN sales.department d ON d.dept_id = e.dept_id;',
  '',
  'CREATE VIEW sales.v_product_catalog (product_id, sku, product_name, unit_price) AS',
  '  SELECT product_id, sku, product_name, unit_price FROM sales.product;',
  '',
  'CREATE VIEW sales.v_audit_recent (log_id, message, created_at) AS',
  '  SELECT log_id, message, created_at FROM sales.audit_log;'
].join('\n');
