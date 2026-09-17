/* proc>flow v2.1.0 — ERD / schema foundation fixtures.
   DDL parsing across T-SQL, PostgreSQL, DB2, and SQLite: declared keys and
   foreign keys only, composite-key grouping, raw type preservation,
   conservative unresolved references, source spans, deterministic output,
   and the Mermaid erDiagram export.

   After this suite runs, PROCFLOW_SCHEMA_PASS and PROCFLOW_SCHEMA_RESULT gate
   the golden suite (tests/tests.ts). */
(function(){
  var results: Array<{name: string; pass: boolean; detail: unknown}>=[];
  var mermaidPassed=0, mermaidTotal=0;
  function record(name: string, pass: boolean, detail?: unknown): void {
    results.push({name:name,pass:pass,detail:pass?'':detail});
  }
  function recordMermaid(name: string, pass: boolean, detail?: unknown): void {
    mermaidTotal++;
    if(pass) mermaidPassed++;
    record(name,pass,detail);
  }
  function has(list: string[], value: string): boolean {
    return (list||[]).some(function(v){ return v.toUpperCase()===value.toUpperCase(); });
  }
  function entity(result: SchemaResult, id: string): SchemaEntity | null {
    return result.entities.filter(function(e){ return e.id===id.toUpperCase(); })[0]||null;
  }
  function column(result: SchemaResult, id: string, name: string): SchemaColumn | null {
    var e=entity(result,id);
    return e&&e.columns.filter(function(c){ return c.name.toUpperCase()===name.toUpperCase(); })[0]||null;
  }
  function key(result: SchemaResult, id: string, kind: string, columns: string[]): SchemaKey | null {
    var e=entity(result,id);
    if(!e) return null;
    return e.keys.filter(function(k){
      return k.kind===kind&&
        k.columns.join('|').toUpperCase()===columns.join('|').toUpperCase();
    })[0]||null;
  }
  function relationship(result: SchemaResult, fromId: string, toId: string): SchemaRelationship | null {
    return result.relationships.filter(function(r){
      return r.fromId.toUpperCase()===fromId.toUpperCase()&&
        r.toId.toUpperCase()===toId.toUpperCase();
    })[0]||null;
  }
  function spansValid(result: SchemaResult): boolean {
    function ok(span: SourceSpan | null | undefined): boolean {
      return !!span&&span.start>=0&&span.end>span.start&&span.end<=result.text.length;
    }
    return result.entities.every(function(e){
      return ok(e.span)&&e.columns.every(function(c){ return ok(c.span); })&&
        e.keys.every(function(k){ return ok(k.span); });
    })&&result.relationships.every(function(r){ return ok(r.span); });
  }

  var TSQL=[
    'CREATE TABLE dbo.Student (',
    '  StudentId INT IDENTITY(1,1) PRIMARY KEY,',
    '  Name NVARCHAR(100) NOT NULL,',
    '  MentorId INT NULL,',
    '  CONSTRAINT FK_Student_Mentor FOREIGN KEY (MentorId)',
    '    REFERENCES dbo.Student (StudentId) ON DELETE SET NULL',
    ');',
    'GO',
    'CREATE TABLE dbo.Course (',
    '  CourseId INT PRIMARY KEY,',
    '  Title NVARCHAR(200) NOT NULL',
    ');',
    'CREATE TABLE dbo.Enrollment (',
    '  StudentId INT NOT NULL,',
    '  CourseId INT NOT NULL,',
    '  PRIMARY KEY (StudentId, CourseId),',
    '  FOREIGN KEY (StudentId) REFERENCES dbo.Student (StudentId),',
    '  FOREIGN KEY (CourseId) REFERENCES dbo.Course (CourseId)',
    ');',
    'ALTER TABLE dbo.Student ADD CONSTRAINT UQ_Student_Name UNIQUE (Name);'
  ].join('\n');

  var PGSQL=[
    'CREATE TABLE public.customer (',
    '  customer_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,',
    '  email text NOT NULL,',
    '  CONSTRAINT uq_customer_email UNIQUE (email)',
    ');',
    'CREATE TABLE public."Order" (',
    '  "Order Id" serial PRIMARY KEY,',
    '  "Customer Id" integer NOT NULL REFERENCES public.customer(customer_id) ON DELETE CASCADE,',
    '  placed_at timestamp with time zone NOT NULL DEFAULT now(),',
    '  total numeric(12,2) GENERATED ALWAYS AS (1) STORED,',
    '  note text',
    ');',
    'CREATE UNIQUE INDEX uq_order_customer ON public."Order" ("Customer Id");'
  ].join('\n');

  var SQLITE=[
    'CREATE TABLE IF NOT EXISTS gadget (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  label VARCHAR(50) NOT NULL UNIQUE,',
    '  owner_id INTEGER REFERENCES owner(id),',
    '  oddity TYPO_TYPE',
    ');',
    'CREATE TABLE owner (id INTEGER PRIMARY KEY);'
  ].join('\n');

  var DB2=[
    'CREATE TABLE sales (',
    '  sale_id INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY,',
    '  amount DECIMAL(31,0) NOT NULL,',
    '  region VARCHAR(10),',
    '  PRIMARY KEY (sale_id),',
    '  FOREIGN KEY (region) REFERENCES region(code) ON DELETE SET NULL',
    ');'
  ].join('\n');

  /* ---- T-SQL: declared keys, composite grouping, actions, ALTER ---- */
  try{
    var t=parseSchema(TSQL);
    var enrollment=key(t,'DBO.ENROLLMENT','pk',['StudentId','CourseId']);
    var mentorFk=key(t,'DBO.STUDENT','fk',['MentorId']);
    var studentPk=key(t,'DBO.STUDENT','pk',['StudentId']);
    var studentName=key(t,'DBO.STUDENT','unique',['Name']);
    var selfRel=relationship(t,'DBO.STUDENT','DBO.STUDENT');
    var studentToEnrollment=relationship(t,'DBO.STUDENT','DBO.ENROLLMENT');
    var courseToEnrollment=relationship(t,'DBO.COURSE','DBO.ENROLLMENT');
    record('v2.1.0 T-SQL tables, composite PK, and declared FK relationships',
      t.stats.tables===3&&t.stats.views===0&&t.stats.columns===7&&
        t.stats.relationships===3&&t.stats.unresolved===0&&
        !!enrollment&&!!studentPk&&!!studentName&&!!mentorFk&&
        !!selfRel&&selfRel.optional===true&&selfRel.cardinality==='one-to-many'&&
        !!studentToEnrollment&&studentToEnrollment.optional===false&&
        studentToEnrollment.toColumns.join(',')==='StudentId'&&
        !!courseToEnrollment&&courseToEnrollment.resolution==='exact'&&
        mentorFk.onDelete==='SET NULL'&&
        !t.diagnostics.some(function(d){ return d.severity==='error'; }),
      {stats:t.stats,diagnostics:t.diagnostics,keys:entity(t,'DBO.ENROLLMENT')});
    record('v2.1.0 T-SQL identity, NOT NULL, and composite column flags',
      !!column(t,'DBO.STUDENT','StudentId')&&column(t,'DBO.STUDENT','StudentId').identity===true&&
        column(t,'DBO.STUDENT','StudentId').primaryKey===true&&
        column(t,'DBO.STUDENT','StudentId').nullable===false&&
        column(t,'DBO.STUDENT','MentorId').nullable===true&&
        column(t,'DBO.ENROLLMENT','StudentId').primaryKey===true&&
        column(t,'DBO.ENROLLMENT','CourseId').primaryKey===true&&
        column(t,'DBO.STUDENT','Name').type==='NVARCHAR(100)',
      entity(t,'DBO.STUDENT'));
    record('v2.1.0 schema spans stay inside the source DDL',spansValid(t),t);
    record('v2.1.0 DDL parsing is deterministic',JSON.stringify(t)===JSON.stringify(parseSchema(TSQL)),t);
  }catch(err){
    record('v2.1.0 T-SQL tables, composite PK, and declared FK relationships',false,String(err&&err.stack||err));
    record('v2.1.0 T-SQL identity, NOT NULL, and composite column flags',false,String(err&&err.stack||err));
    record('v2.1.0 schema spans stay inside the source DDL',false,String(err&&err.stack||err));
    record('v2.1.0 DDL parsing is deterministic',false,String(err&&err.stack||err));
  }

  /* ---- PostgreSQL: quoting, serial/identity, generated, unique index ---- */
  try{
    var p=parseSchema(PGSQL);
    var orderRel=relationship(p,'PUBLIC.CUSTOMER','PUBLIC.ORDER');
    record('v2.1.0 PostgreSQL quoted identifiers, serial, and unique-index one-to-one',
      p.stats.tables===2&&p.stats.relationships===1&&
        !!column(p,'PUBLIC.ORDER','Order Id')&&
        column(p,'PUBLIC.ORDER','Order Id').identity===true&&
        column(p,'PUBLIC.ORDER','Order Id').primaryKey===true&&
        column(p,'PUBLIC.ORDER','Customer Id').type==='integer'&&
        !!orderRel&&orderRel.cardinality==='one-to-one'&&orderRel.optional===false&&
        orderRel.unique===true&&
        orderRel.fromColumns.join(',')==='customer_id'&&
        orderRel.toColumns.join(',')==='Customer Id'&&
        !!key(p,'PUBLIC.ORDER','unique',['Customer Id']),
      {stats:p.stats,rel:orderRel,entity:entity(p,'PUBLIC.ORDER')});
    record('v2.1.0 PostgreSQL raw type fidelity and generated columns',
      column(p,'PUBLIC.ORDER','placed_at').type==='timestamp with time zone'&&
        column(p,'PUBLIC.ORDER','total').type==='numeric(12,2)'&&
        column(p,'PUBLIC.ORDER','total').generated===true&&
        column(p,'PUBLIC.ORDER','total').computed===false,
      entity(p,'PUBLIC.ORDER'));
  }catch(err){
    record('v2.1.0 PostgreSQL quoted identifiers, serial, and unique-index one-to-one',false,String(err&&err.stack||err));
    record('v2.1.0 PostgreSQL raw type fidelity and generated columns',false,String(err&&err.stack||err));
  }

  /* ---- SQLite: affinities preserved, inline REFERENCES, AUTOINCREMENT ---- */
  try{
    var s=parseSchema(SQLITE);
    var ownerRel=relationship(s,'OWNER','GADGET');
    record('v2.1.0 SQLite AUTOINCREMENT, inline REFERENCES, and raw affinity text',
      s.stats.tables===2&&s.stats.relationships===1&&
        column(s,'GADGET','id').identity===true&&
        column(s,'GADGET','label').unique===true&&
        column(s,'GADGET','label').nullable===false&&
        column(s,'GADGET','oddity').type==='TYPO_TYPE'&&
        !!ownerRel&&ownerRel.optional===true&&
        ownerRel.fromColumns.join(',')==='id'&&ownerRel.toColumns.join(',')==='owner_id',
      {stats:s.stats,rel:ownerRel,entity:entity(s,'GADGET')});
  }catch(err){
    record('v2.1.0 SQLite AUTOINCREMENT, inline REFERENCES, and raw affinity text',false,String(err&&err.stack||err));
  }

  /* ---- DB2: generated identity, precise types, unresolved target ---- */
  try{
    var d=parseSchema(DB2);
    var sales=entity(d,'SALES');
    var regionRel=relationship(d,'EXTERNAL:REGION','SALES');
    record('v2.1.0 DB2 identity, DECIMAL precision, and explicit unresolved target',
      d.stats.tables===1&&d.stats.unresolved===1&&d.stats.relationships===1&&
        column(d,'SALES','sale_id').identity===true&&
        column(d,'SALES','sale_id').primaryKey===true&&
        column(d,'SALES','amount').type==='DECIMAL(31,0)'&&
        !!regionRel&&regionRel.resolution==='opaque'&&
        d.diagnostics.some(function(x){ return x.code==='schema_unresolved_reference'; })&&
        entity(d,'SALES').unresolved===false,
      {stats:d.stats,rel:regionRel,diagnostics:d.diagnostics});
  }catch(err){
    record('v2.1.0 DB2 identity, DECIMAL precision, and explicit unresolved target',false,String(err&&err.stack||err));
  }

  /* ---- Views and unknown-column honesty ---- */
  try{
    var v=parseSchema([
      'CREATE VIEW dbo.vActive (Id, Name) AS SELECT Id, Name FROM dbo.Student;',
      'CREATE VIEW dbo.vUnknown AS SELECT 1;'
    ].join('\n'));
    var known=entity(v,'DBO.VACTIVE'), unknown=entity(v,'DBO.VUNKNOWN');
    record('v2.1.0 views keep declared columns and report unknown ones',
      v.stats.tables===0&&v.stats.views===2&&
        !!known&&known.kind==='view'&&known.columns.length===2&&known.keys.length===0&&
        !!unknown&&unknown.columns.length===0&&
        v.diagnostics.some(function(x){ return x.code==='schema_columns_unknown'; }),
      {stats:v.stats,diagnostics:v.diagnostics});
  }catch(err){
    record('v2.1.0 views keep declared columns and report unknown ones',false,String(err&&err.stack||err));
  }

  /* ---- Conservative resolution: duplicate, anonymous ALTER, ambiguity ---- */
  try{
    var dup=parseSchema([
      'CREATE TABLE a (id INT PRIMARY KEY);',
      'CREATE TABLE a (id INT PRIMARY KEY);',
      'ALTER TABLE ghost ADD COLUMN x INT;'
    ].join('\n'));
    record('v2.1.0 duplicate entities and unknown ALTER targets are reported, not merged',
      dup.entities.length===1&&
        dup.diagnostics.some(function(x){ return x.code==='schema_duplicate_entity'; })&&
        dup.diagnostics.some(function(x){ return x.code==='schema_alter_unknown_table'; }),
      {entities:dup.entities,diagnostics:dup.diagnostics});
    var ambiguous=parseSchema([
      'CREATE TABLE s1.users (id INT PRIMARY KEY);',
      'CREATE TABLE s2.users (id INT PRIMARY KEY);',
      'CREATE TABLE t (id INT PRIMARY KEY, user_id INT REFERENCES users (id));'
    ].join('\n'));
    record('v2.1.0 ambiguous FK targets are never guessed into an edge',
      ambiguous.relationships.length===0&&
        ambiguous.diagnostics.some(function(x){ return x.code==='schema_ambiguous_reference'; }),
      {relationships:ambiguous.relationships,diagnostics:ambiguous.diagnostics});
    var heuristic=parseSchema([
      'CREATE TABLE s1.users (id INT PRIMARY KEY);',
      'CREATE TABLE t (id INT PRIMARY KEY, user_id INT REFERENCES users (id));'
    ].join('\n'));
    var heuristicRel=heuristic.relationships[0];
    record('v2.1.0 unqualified FK targets resolve by name with a labelled warning',
      !!heuristicRel&&heuristicRel.resolution==='heuristic'&&
        heuristic.diagnostics.some(function(x){ return x.code==='schema_unresolved_reference'; }),
      {relationships:heuristic.relationships,diagnostics:heuristic.diagnostics});
    var empty=parseSchema('');
    record('v2.1.0 empty DDL is reported, not treated as a schema',
      empty.entities.length===0&&empty.stats.relationships===0&&
        empty.diagnostics.some(function(x){ return x.code==='schema_empty'; }),
      empty);
  }catch(err){
    record('v2.1.0 duplicate entities and unknown ALTER targets are reported, not merged',false,String(err&&err.stack||err));
    record('v2.1.0 ambiguous FK targets are never guessed into an edge',false,String(err&&err.stack||err));
    record('v2.1.0 unqualified FK targets resolve by name with a labelled warning',false,String(err&&err.stack||err));
    record('v2.1.0 empty DDL is reported, not treated as a schema',false,String(err&&err.stack||err));
  }

  /* ---- Bundled DB2 ERD sample: 8 tables, 4 views, 6 relationships ---- */
  try{
    var db2Sample=parseSchema(PROCFLOW_ERD_SAMPLE_DB2);
    function hasNoRelationships(id: string): boolean {
      return !db2Sample.relationships.some(function(rel){
        return rel.fromId===id||rel.toId===id;
      });
    }
    record('v2.1.0 DB2 ERD sample parses 8 tables, 4 views, and 6 relationships',
      db2Sample.stats.tables===8&&db2Sample.stats.views===4&&
        db2Sample.stats.relationships===6&&db2Sample.stats.unresolved===0&&
        !!entity(db2Sample,'SALES.AUDIT_LOG')&&!!entity(db2Sample,'SALES.APP_SETTINGS')&&
        hasNoRelationships('SALES.AUDIT_LOG')&&hasNoRelationships('SALES.APP_SETTINGS')&&
        !!relationship(db2Sample,'SALES.EMPLOYEE','SALES.ORDERS')&&
        !!key(db2Sample,'SALES.PRODUCT','unique',['sku'])&&
        !db2Sample.diagnostics.some(function(x){ return x.severity==='error'; }),
      {stats:db2Sample.stats,diagnostics:db2Sample.diagnostics});
  }catch(err){
    record('v2.1.0 DB2 ERD sample parses 8 tables, 4 views, and 6 relationships',false,String(err&&err.stack||err));
  }

  /* ---- Bulk estate: a generated 300-table chain parses without drops ---- */
  try{
    var bulkLines=[];
    for(var bulkIndex=1;bulkIndex<=300;bulkIndex++){
      bulkLines.push('CREATE TABLE app.t'+bulkIndex+' (');
      bulkLines.push('  id INT NOT NULL,');
      bulkLines.push('  ref_id INT,');
      bulkLines.push('  CONSTRAINT pk_t'+bulkIndex+' PRIMARY KEY (id),');
      bulkLines.push('  CONSTRAINT fk_t'+bulkIndex+' FOREIGN KEY (ref_id) REFERENCES app.t'+
        (bulkIndex===1?300:bulkIndex-1)+' (id)');
      bulkLines.push(');');
    }
    var bulkResult=parseSchema(bulkLines.join('\n'));
    record('v2.1.0 bulk DDL estate parses without silent drops',
      bulkResult.stats.tables===300&&bulkResult.stats.relationships===300&&
        bulkResult.stats.columns===600&&bulkResult.stats.unresolved===0&&
        !bulkResult.diagnostics.some(function(x){ return x.severity!=='info'; })&&
        spansValid(bulkResult),
      bulkResult.stats);
  }catch(err){
    record('v2.1.0 bulk DDL estate parses without silent drops',false,String(err&&err.stack||err));
  }

  /* ---- Mermaid erDiagram export ---- */
  try{
    var tm=toMermaidER(parseSchema(TSQL));
    recordMermaid('mermaid erDiagram declares entities with PK/FK/UK attributes',
      tm.indexOf('erDiagram')===0&&
        tm.indexOf('DBO_STUDENT {')>=0&&
        tm.indexOf('INT StudentId PK')>=0&&
        tm.indexOf('INT MentorId FK')>=0&&
        /DBO_ENROLLMENT \{\n(\s+.*\n)*?\s+\}/.test(tm)&&
        tm.indexOf('StudentId PK, FK')>=0&&
        tm.indexOf('Name UK')>=0,
      tm);
    recordMermaid('mermaid relationships encode declared cardinality and optionality',
      tm.indexOf('DBO_STUDENT o|--o{ DBO_STUDENT : FK_Student_Mentor')>=0&&
        tm.indexOf('DBO_STUDENT ||--o{ DBO_ENROLLMENT')>=0&&
        tm.indexOf('DBO_COURSE ||--o{ DBO_ENROLLMENT')>=0,
      tm);
    recordMermaid('mermaid provenance comments preserve original names and raw types',
      tm.indexOf('%% entity DBO_STUDENT = "dbo.Student" (table)')>=0&&
        tm.indexOf('%% column DBO_STUDENT.Name : NVARCHAR(100)')>=0&&
        tm.indexOf('%% relationship DBO_STUDENT -> DBO_ENROLLMENT')>=0,
      tm);
    var pg=toMermaidER(parseSchema(PGSQL));
    recordMermaid('mermaid sanitizes identifiers and types, keeping raw text in a comment',
      pg.indexOf('timestamp_with_time_zone placed_at "timestamp with time zone"')>=0&&
        pg.indexOf('Order_Id')>=0&&
        pg.indexOf('PUBLIC_CUSTOMER ||--|| PUBLIC_ORDER')>=0&&
        pg.indexOf('PUBLIC_ORDER {')>=0,
      pg);
    var db2=toMermaidER(parseSchema(DB2));
    recordMermaid('mermaid exports unresolved targets as explicit external entities',
      db2.indexOf('EXTERNAL_REGION')>=0&&
        /EXTERNAL_REGION o\|--o\{ SALES/.test(db2)&&
        db2.indexOf('%% entity EXTERNAL_REGION = "region"')>=0,
      db2);
    var collisions=toMermaidER(parseSchema([
      'CREATE TABLE a.b (id INT PRIMARY KEY);',
      'CREATE TABLE a_b (id INT PRIMARY KEY);'
    ].join('\n')));
    var idLines=collisions.split('\n').filter(function(line){
      return /\{/.test(line);
    });
    recordMermaid('mermaid entity identifiers are deterministic and collision-free',
      idLines.length===2&&idLines[0].trim()!==idLines[1].trim()&&
        idLines[0].trim()==='A_B {'&&idLines[1].trim()==='A_B_2 {',
      collisions);
    recordMermaid('mermaid export is deterministic',
      tm===toMermaidER(parseSchema(TSQL)),
      tm);
  }catch(err){
    recordMermaid('mermaid erDiagram declares entities with PK/FK/UK attributes',false,String(err&&err.stack||err));
    recordMermaid('mermaid relationships encode declared cardinality and optionality',false,String(err&&err.stack||err));
    recordMermaid('mermaid provenance comments preserve original names and raw types',false,String(err&&err.stack||err));
    recordMermaid('mermaid sanitizes identifiers and types, keeping raw text in a comment',false,String(err&&err.stack||err));
    recordMermaid('mermaid exports unresolved targets as explicit external entities',false,String(err&&err.stack||err));
    recordMermaid('mermaid entity identifiers are deterministic and collision-free',false,String(err&&err.stack||err));
    recordMermaid('mermaid export is deterministic',false,String(err&&err.stack||err));
  }

  var passed=results.filter(function(r){ return r.pass; }).length;
  window.PROCFLOW_SCHEMA_DETAIL=results;
  window.PROCFLOW_SCHEMA_RESULT={passed:passed,total:results.length,
                                  mermaidPassed:mermaidPassed,mermaidTotal:mermaidTotal};
  window.PROCFLOW_SCHEMA_PASS=passed===results.length;
})();
