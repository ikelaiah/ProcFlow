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
