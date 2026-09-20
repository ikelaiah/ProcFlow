"use strict";
/* proc>flow v2.6.0 — ERD query-builder fixtures.
   Join graph construction from declared FKs only, shortest-path selection
   with equal-cost alternatives, bridge discovery, optional/reverse join
   policy, hand-taught joins, disconnected-selection problems, dialect
   quoting, and deterministic SQL emission.

   After this suite runs, PROCFLOW_QUERY_PASS and PROCFLOW_QUERY_RESULT gate
   the golden suite (tests/tests.ts). */
(function () {
    var results = [];
    function record(name, pass, detail) {
        results.push({ name: name, pass: pass, detail: pass ? '' : detail });
    }
    function entityOf(result, id) {
        return result.entities.filter(function (entity) {
            return entity.id === id.toUpperCase();
        })[0] || null;
    }
    function sqlFor(result, selections, extra) {
        var input = { result: result, selections: selections };
        if (extra)
            Object.keys(extra).forEach(function (key) {
                input[key] = extra[key];
            });
        var plan = queryBuildPlan(input);
        return queryPlanSQL(plan, { dialect: 'tsql', comments: false });
    }
    function planFor(result, selections, extra) {
        var input = { result: result, selections: selections };
        if (extra)
            Object.keys(extra).forEach(function (key) {
                input[key] = extra[key];
            });
        return queryBuildPlan(input);
    }
    var DDL = [
        'CREATE TABLE dbo.Customer (',
        '  CustomerId INT PRIMARY KEY,',
        '  Email NVARCHAR(200) NOT NULL,',
        '  DisplayName NVARCHAR(120) NOT NULL,',
        '  ReferredBy INT NULL,',
        '  CONSTRAINT FK_Customer_Referrer FOREIGN KEY (ReferredBy) REFERENCES dbo.Customer (CustomerId)',
        ');',
        'CREATE TABLE dbo.Product (',
        '  ProductId INT PRIMARY KEY,',
        '  Sku VARCHAR(40) NOT NULL,',
        '  UnitPrice DECIMAL(12,2) NOT NULL',
        ');',
        'CREATE TABLE dbo.AppUser (',
        '  UserId INT PRIMARY KEY,',
        '  UserName NVARCHAR(80) NOT NULL,',
        '  Email NVARCHAR(200) NOT NULL',
        ');',
        'CREATE TABLE dbo.Campaign (',
        '  CampaignId INT PRIMARY KEY,',
        '  Name NVARCHAR(80) NOT NULL',
        ');',
        'CREATE TABLE dbo.OrderHeader (',
        '  OrderId INT PRIMARY KEY,',
        '  CustomerId INT NOT NULL,',
        '  CampaignId INT NULL,',
        '  CreatedBy INT NOT NULL,',
        '  ApprovedBy INT NULL,',
        '  PlacedAt DATETIME2 NOT NULL,',
        '  CONSTRAINT FK_Order_Customer FOREIGN KEY (CustomerId) REFERENCES dbo.Customer (CustomerId),',
        '  CONSTRAINT FK_Order_Campaign FOREIGN KEY (CampaignId) REFERENCES dbo.Campaign (CampaignId)',
        ');',
        'CREATE TABLE dbo.OrderLine (',
        '  OrderId INT NOT NULL,',
        '  LineNo INT NOT NULL,',
        '  ProductId INT NOT NULL,',
        '  Quantity INT NOT NULL,',
        '  PRIMARY KEY (OrderId, LineNo),',
        '  CONSTRAINT FK_OrderLine_Order FOREIGN KEY (OrderId) REFERENCES dbo.OrderHeader (OrderId),',
        '  CONSTRAINT FK_OrderLine_Product FOREIGN KEY (ProductId) REFERENCES dbo.Product (ProductId)',
        ');',
        'CREATE TABLE dbo.Shipment (',
        '  OrderId INT NOT NULL,',
        '  LineNo INT NOT NULL,',
        '  ShippedAt DATETIME2 NOT NULL,',
        '  PRIMARY KEY (OrderId, LineNo),',
        '  CONSTRAINT FK_Shipment_Line FOREIGN KEY (OrderId, LineNo) REFERENCES dbo.OrderLine (OrderId, LineNo)',
        ');',
        'CREATE TABLE dbo.AuditLog (',
        '  LogId INT PRIMARY KEY,',
        '  EntityName NVARCHAR(80) NOT NULL,',
        '  EntityId INT NOT NULL,',
        '  ChangedAt DATETIME2 NOT NULL',
        ');',
        'CREATE TABLE dbo.Extra (',
        '  ExtraId INT PRIMARY KEY,',
        '  LogId INT NULL,',
        '  Note NVARCHAR(80) NULL,',
        '  CONSTRAINT FK_Extra_Log FOREIGN KEY (LogId) REFERENCES dbo.AuditLog (LogId)',
        ');',
        'CREATE TABLE dbo.Note (',
        '  NoteId INT PRIMARY KEY,',
        '  OwnerId INT NULL,',
        '  Body NVARCHAR(400) NOT NULL,',
        '  CONSTRAINT FK_Note_Owner FOREIGN KEY (OwnerId) REFERENCES Customer (CustomerId)',
        ');',
        'CREATE VIEW dbo.vOrderLine (OrderId, LineNo, Quantity) AS',
        '  SELECT OrderId, LineNo, Quantity FROM dbo.OrderLine;',
        'ALTER TABLE dbo.OrderHeader ADD CONSTRAINT FK_Order_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.AppUser (UserId);',
        'ALTER TABLE dbo.OrderHeader ADD CONSTRAINT FK_Order_ApprovedBy FOREIGN KEY (ApprovedBy) REFERENCES dbo.AppUser (UserId);'
    ].join('\n');
    var schema = parseSchema(DDL);
    /* ---- Graph construction ---- */
    try {
        var graph = queryBuildGraph(schema);
        var customerEdge = graph.nodes['DBO.CUSTOMER'].edges[0];
        record('v2.4.0 join graph uses declared FKs and treats self-references as one edge', graph.order.length === 11 && graph.edges.length === 10 && graph.skipped.length === 0 &&
            graph.nodes['DBO.CUSTOMER'].edges.length === 3 &&
            graph.nodes['DBO.APPUSER'].edges.length === 2 &&
            customerEdge.childId === customerEdge.parentId &&
            customerEdge.childId === 'DBO.CUSTOMER', { nodes: graph.order.length, edges: graph.edges.length });
        var heuristicEdge = graph.edges.filter(function (edge) {
            return edge.resolution === 'heuristic';
        })[0];
        record('v2.4.0 name-matched FK targets keep a higher path weight than exact ones', !!heuristicEdge && heuristicEdge.weight === 3 &&
            graph.edges.filter(function (edge) {
                return edge.resolution === 'exact';
            }).every(function (edge) { return edge.weight === 1; }), heuristicEdge);
    }
    catch (err) {
        record('v2.4.0 join graph uses declared FKs and treats self-references as one edge', false, String(err && err.stack || err));
        record('v2.4.0 name-matched FK targets keep a higher path weight than exact ones', false, String(err && err.stack || err));
    }
    /* ---- Single table and two-table joins ---- */
    try {
        var single = sqlFor(schema, [
            { entityId: 'DBO.CUSTOMER', column: 'Email' },
            { entityId: 'DBO.CUSTOMER', column: 'DisplayName' }
        ]);
        record('v2.4.0 single-table picks emit a plain SELECT with dialect quoting', single === 'SELECT\n  customer.[Email],\n  customer.[DisplayName]\n' +
            'FROM [dbo].[Customer] AS customer;', single);
        var join = sqlFor(schema, [
            { entityId: 'DBO.ORDERHEADER', column: 'PlacedAt' },
            { entityId: 'DBO.CUSTOMER', column: 'Email' }
        ]);
        record('v2.4.0 required child→parent FK joins with INNER and qualified conditions', join === 'SELECT\n  orderheader.[PlacedAt],\n  customer.[Email]\n' +
            'FROM [dbo].[OrderHeader] AS orderheader\n' +
            'INNER JOIN [dbo].[Customer] AS customer\n' +
            '  ON orderheader.[CustomerId] = customer.[CustomerId];', join);
        var joinPlan = planFor(schema, [
            { entityId: 'DBO.ORDERHEADER', column: 'PlacedAt' },
            { entityId: 'DBO.CUSTOMER', column: 'Email' }
        ]);
        record('v2.4.0 join explanations teach the direction and row effect', joinPlan.joins.length === 1 &&
            joinPlan.joins[0].explanation.indexOf('references') >= 0 &&
            joinPlan.joins[0].explanation.indexOf('at most one') >= 0 &&
            joinPlan.warnings.length === 0, joinPlan.joins[0]);
        var optionalJoin = planFor(schema, [
            { entityId: 'DBO.ORDERHEADER', column: 'OrderId' },
            { entityId: 'DBO.CAMPAIGN', column: 'Name' }
        ]);
        record('v2.4.0 nullable FKs join with LEFT in preserve mode and stay INNER in strict mode', optionalJoin.joins[0].joinType === 'left' &&
            optionalJoin.joins[0].explanation.indexOf('nullable') >= 0 &&
            planFor(schema, [
                { entityId: 'DBO.ORDERHEADER', column: 'OrderId' },
                { entityId: 'DBO.CAMPAIGN', column: 'Name' }
            ], { policy: 'strict' }).joins[0].joinType === 'inner', optionalJoin.joins[0]);
        var selfPlan = planFor(schema, [
            { entityId: 'DBO.CUSTOMER', column: 'CustomerId' },
            { entityId: 'DBO.CUSTOMER', column: 'ReferredBy' }
        ]);
        record('v2.4.0 a self-referencing FK never invents a join', selfPlan.joins.length === 0 && selfPlan.problems.length === 0 &&
            selfPlan.usedIds.length === 1, selfPlan);
    }
    catch (err) {
        record('v2.4.0 single-table picks emit a plain SELECT with dialect quoting', false, String(err && err.stack || err));
        record('v2.4.0 required child→parent FK joins with INNER and qualified conditions', false, String(err && err.stack || err));
        record('v2.4.0 join explanations teach the direction and row effect', false, String(err && err.stack || err));
        record('v2.4.0 nullable FKs join with LEFT in preserve mode and stay INNER in strict mode', false, String(err && err.stack || err));
        record('v2.4.0 a self-referencing FK never invents a join', false, String(err && err.stack || err));
    }
    /* ---- Bridges and parent→child policy ---- */
    try {
        var bridge = planFor(schema, [
            { entityId: 'DBO.ORDERLINE', column: 'Quantity' },
            { entityId: 'DBO.PRODUCT', column: 'Sku' },
            { entityId: 'DBO.CUSTOMER', column: 'Email' }
        ]);
        record('v2.4.0 bridge tables are joined but never selected', bridge.joins.length === 3 &&
            bridge.bridges.join(',') === 'DBO.ORDERHEADER' &&
            bridge.joins[1].bridge === true &&
            bridge.joins[1].explanation.indexOf('declared path') >= 0 &&
            sqlFor(schema, [
                { entityId: 'DBO.ORDERLINE', column: 'Quantity' },
                { entityId: 'DBO.PRODUCT', column: 'Sku' },
                { entityId: 'DBO.CUSTOMER', column: 'Email' }
            ]) === ('SELECT\n  orderline.[Quantity],\n  product.[Sku],\n  customer.[Email]\n' +
                'FROM [dbo].[OrderLine] AS orderline\n' +
                'INNER JOIN [dbo].[Product] AS product\n' +
                '  ON orderline.[ProductId] = product.[ProductId]\n' +
                'INNER JOIN [dbo].[OrderHeader] AS orderheader\n' +
                '  ON orderline.[OrderId] = orderheader.[OrderId]\n' +
                'INNER JOIN [dbo].[Customer] AS customer\n' +
                '  ON orderheader.[CustomerId] = customer.[CustomerId];'), bridge);
        var reverse = planFor(schema, [
            { entityId: 'DBO.CUSTOMER', column: 'DisplayName' },
            { entityId: 'DBO.ORDERLINE', column: 'Quantity' }
        ]);
        var reverseTypes = reverse.joins.map(function (join) { return join.joinType; }).join(',');
        record('v2.4.0 parent→child traversal keeps parent rows with LEFT and warns about row multiplication', reverseTypes === 'left,left' &&
            reverse.warnings.some(function (warning) {
                return warning.indexOf('repeat rows') >= 0;
            }) &&
            sqlFor(schema, [
                { entityId: 'DBO.CUSTOMER', column: 'DisplayName' },
                { entityId: 'DBO.ORDERLINE', column: 'Quantity' }
            ]).indexOf('FROM [dbo].[Customer] AS customer\n' +
                'LEFT JOIN [dbo].[OrderHeader] AS orderheader') >= 0, reverse);
        record('v2.4.0 strict policy turns preservation joins into INNER', planFor(schema, [
            { entityId: 'DBO.CUSTOMER', column: 'DisplayName' },
            { entityId: 'DBO.ORDERLINE', column: 'Quantity' }
        ], { policy: 'strict' }).joins.map(function (join) {
            return join.joinType;
        }).join(',') === 'inner,inner', reverse);
    }
    catch (err) {
        record('v2.4.0 bridge tables are joined but never selected', false, String(err && err.stack || err));
        record('v2.4.0 parent→child traversal keeps parent rows with LEFT and warns about row multiplication', false, String(err && err.stack || err));
        record('v2.4.0 strict policy turns preservation joins into INNER', false, String(err && err.stack || err));
    }
    /* ---- Ambiguity and alternatives ---- */
    try {
        var ambiguous = planFor(schema, [
            { entityId: 'DBO.ORDERHEADER', column: 'OrderId' },
            { entityId: 'DBO.APPUSER', column: 'UserName' }
        ]);
        record('v2.4.0 equal-cost FK paths expose alternatives instead of hiding them', ambiguous.ambiguities.length === 1 &&
            ambiguous.ambiguities[0].paths.length === 2 &&
            ambiguous.ambiguities[0].chosenIndex === 0 &&
            ambiguous.ambiguities[0].summaries[0].indexOf('CreatedBy') >= 0 &&
            ambiguous.ambiguities[0].summaries[1].indexOf('ApprovedBy') >= 0 &&
            ambiguous.joins[0].constraintName === 'FK_Order_CreatedBy' &&
            ambiguous.joins[0].joinType === 'inner', ambiguous);
        var chosen = planFor(schema, [
            { entityId: 'DBO.ORDERHEADER', column: 'OrderId' },
            { entityId: 'DBO.APPUSER', column: 'UserName' }
        ], { pathChoices: { 'DBO.APPUSER->DBO.ORDERHEADER': 1 } });
        record('v2.4.0 choosing an alternative path changes the declared join and its row policy', chosen.joins[0].constraintName === 'FK_Order_ApprovedBy' &&
            chosen.joins[0].joinType === 'left' &&
            chosen.ambiguities[0].chosenIndex === 1 &&
            chosen.ambiguities[0].summary.indexOf('ApprovedBy') >= 0, chosen.joins[0]);
        var note = planFor(schema, [
            { entityId: 'DBO.NOTE', column: 'OwnerId' },
            { entityId: 'DBO.CUSTOMER', column: 'Email' }
        ]);
        record('v2.4.0 name-matched FK paths are usable but warned about', note.joins[0].resolution === 'heuristic' &&
            note.joins[0].joinType === 'left' &&
            note.warnings.some(function (warning) {
                return warning.indexOf('matched by name only') >= 0;
            }) &&
            note.joins[0].explanation.indexOf('name only') >= 0, note);
    }
    catch (err) {
        record('v2.4.0 equal-cost FK paths expose alternatives instead of hiding them', false, String(err && err.stack || err));
        record('v2.4.0 choosing an alternative path changes the declared join and its row policy', false, String(err && err.stack || err));
        record('v2.4.0 name-matched FK paths are usable but warned about', false, String(err && err.stack || err));
    }
    /* ---- Disconnected selections and the resolutions ---- */
    try {
        var selections = [
            { entityId: 'DBO.CUSTOMER', column: 'Email' },
            { entityId: 'DBO.AUDITLOG', column: 'EntityName' },
            { entityId: 'DBO.EXTRA', column: 'Note' }
        ];
        var disconnected = planFor(schema, selections, { comments: true });
        record('v2.4.0 disconnected selections are reported as problems, not cartesian-joined', disconnected.joins.length === 0 &&
            disconnected.problems.length === 1 &&
            disconnected.problems[0].entityIds.join(',') === 'DBO.AUDITLOG,DBO.EXTRA' &&
            disconnected.problems[0].message.indexOf('No declared foreign-key path') >= 0 &&
            disconnected.problems[0].education.indexOf('teach the join') >= 0, disconnected.problems);
        record('v2.4.0 SQL never silently drops unjoined picks: it lists them in the header', sqlFor(schema, selections) === ('SELECT\n  customer.[Email]\n' +
            'FROM [dbo].[Customer] AS customer;'), sqlFor(schema, selections));
        var plan = planFor(schema, selections);
        var withComments = queryPlanSQL(plan, { dialect: 'tsql', comments: true });
        record('v2.4.0 provenance comments name the missing tables and the declaration-only rule', withComments.indexOf('/*') === 0 &&
            withComments.indexOf('declared FOREIGN KEY evidence only') >= 0 &&
            withComments.indexOf('Not included: dbo.AuditLog') >= 0 &&
            withComments.indexOf('Not included: dbo.Extra') >= 0, withComments);
        var taught = planFor(schema, selections, { manual: [
                { id: 'm1', leftId: 'DBO.AUDITLOG', leftColumn: 'EntityId',
                    rightId: 'DBO.CUSTOMER', rightColumn: 'CustomerId' }
            ] });
        record('v2.4.0 a taught join resolves the orphan and is labelled not declared', taught.problems.length === 0 &&
            taught.joins[0].kind === 'manual' &&
            taught.joins[0].joinType === 'inner' &&
            taught.joins[1].entityId === 'DBO.EXTRA' &&
            taught.education.some(function (line) {
                return line.indexOf('not declared') >= 0;
            }) &&
            queryPlanSQL(taught, { dialect: 'tsql', comments: true })
                .indexOf('taught join — not declared') >= 0 &&
            sqlFor(schema, selections, { manual: [
                    { id: 'm1', leftId: 'DBO.AUDITLOG', leftColumn: 'EntityId',
                        rightId: 'DBO.CUSTOMER', rightColumn: 'CustomerId' }
                ] }).indexOf('ON customer.[CustomerId] = auditlog.[EntityId]') >= 0, taught);
        record('v2.4.0 a taught predicate is emitted verbatim', sqlFor(schema, selections, { manual: [
                { id: 'm2', leftId: 'DBO.AUDITLOG', leftColumn: 'EntityId',
                    rightId: 'DBO.CUSTOMER', rightColumn: 'CustomerId',
                    predicate: 'customer.[CustomerId] = auditlog.[EntityId]' }
            ] }).indexOf('ON customer.[CustomerId] = auditlog.[EntityId]') >= 0, sqlFor(schema, selections, { manual: [
                { id: 'm2', leftId: 'DBO.AUDITLOG', leftColumn: 'EntityId',
                    rightId: 'DBO.CUSTOMER', rightColumn: 'CustomerId',
                    predicate: 'customer.[CustomerId] = auditlog.[EntityId]' }
            ] }));
        var cross = planFor(schema, [
            { entityId: 'DBO.CUSTOMER', column: 'Email' },
            { entityId: 'DBO.AUDITLOG', column: 'EntityName' }
        ], { cross: ['DBO.AUDITLOG'] });
        record('v2.4.0 CROSS JOIN is an explicit opt-in and never overrides a declared path', cross.joins.length === 1 && cross.joins[0].kind === 'cross' &&
            sqlFor(schema, [
                { entityId: 'DBO.CUSTOMER', column: 'Email' },
                { entityId: 'DBO.AUDITLOG', column: 'EntityName' }
            ], { cross: ['DBO.AUDITLOG'] })
                .indexOf('CROSS JOIN [dbo].[AuditLog] AS auditlog;') >= 0 &&
            planFor(schema, [
                { entityId: 'DBO.CUSTOMER', column: 'Email' },
                { entityId: 'DBO.ORDERHEADER', column: 'PlacedAt' }
            ], { cross: ['DBO.ORDERHEADER'] })
                .warnings.some(function (warning) {
                return warning.indexOf('declared key') >= 0;
            }), cross);
        var excluded = planFor(schema, selections, { excluded: ['DBO.AUDITLOG', 'DBO.EXTRA'] });
        record('v2.4.0 excluding a table removes its picks and its problem', excluded.problems.length === 0 && excluded.selections.length === 1 &&
            excluded.usedIds.length === 1, excluded);
        record('v2.4.0 a taught join pointing at an undeclared column is ignored with a warning', planFor(schema, [{ entityId: 'DBO.CUSTOMER', column: 'Email' }], { manual: [
                { id: 'bad', leftId: 'DBO.CUSTOMER', leftColumn: 'Nope',
                    rightId: 'DBO.AUDITLOG', rightColumn: 'EntityId' }
            ] }).warnings.some(function (warning) {
            return warning.indexOf('not declared in the current schema') >= 0;
        }), planFor(schema, [{ entityId: 'DBO.CUSTOMER', column: 'Email' }], { manual: [
                { id: 'bad', leftId: 'DBO.CUSTOMER', leftColumn: 'Nope',
                    rightId: 'DBO.AUDITLOG', rightColumn: 'EntityId' }
            ] }));
    }
    catch (err) {
        record('v2.4.0 disconnected selections are reported as problems, not cartesian-joined', false, String(err && err.stack || err));
        record('v2.4.0 SQL never silently drops unjoined picks: it lists them in the header', false, String(err && err.stack || err));
        record('v2.4.0 provenance comments name the missing tables and the declaration-only rule', false, String(err && err.stack || err));
        record('v2.4.0 a taught join resolves the orphan and is labelled not declared', false, String(err && err.stack || err));
        record('v2.4.0 a taught predicate is emitted verbatim', false, String(err && err.stack || err));
        record('v2.4.0 CROSS JOIN is an explicit opt-in and never overrides a declared path', false, String(err && err.stack || err));
        record('v2.4.0 excluding a table removes its picks and its problem', false, String(err && err.stack || err));
        record('v2.4.0 a taught join pointing at an undeclared column is ignored with a warning', false, String(err && err.stack || err));
    }
    /* ---- Composite keys, duplicate names, views, external targets ---- */
    try {
        var composite = sqlFor(schema, [
            { entityId: 'DBO.SHIPMENT', column: 'ShippedAt' },
            { entityId: 'DBO.ORDERLINE', column: 'Quantity' }
        ]);
        record('v2.4.0 composite FKs join every column pair with AND', composite.indexOf('shipment.[OrderId] = orderline.[OrderId] AND ' +
            'shipment.[LineNo] = orderline.[LineNo]') >= 0 &&
            composite.indexOf('INNER JOIN [dbo].[OrderLine] AS orderline') >= 0, composite);
        var duplicates = sqlFor(schema, [
            { entityId: 'DBO.CUSTOMER', column: 'Email' },
            { entityId: 'DBO.APPUSER', column: 'Email' }
        ]);
        record('v2.4.0 same-named columns from different tables get stable aliases', duplicates.indexOf('customer.[Email] AS customer_email') >= 0 &&
            duplicates.indexOf('appuser.[Email] AS appuser_email') >= 0, duplicates);
        var aliasSchema = parseSchema([
            'CREATE TABLE a.item (ItemId INT PRIMARY KEY, Name VARCHAR(10));',
            'CREATE TABLE b.item (ItemId INT PRIMARY KEY, Ref INT);',
            'ALTER TABLE b.item ADD CONSTRAINT fk_item FOREIGN KEY (Ref) REFERENCES a.item (ItemId);'
        ].join('\n'));
        var aliasSql = queryPlanSQL(queryBuildPlan({ result: aliasSchema, selections: [
                { entityId: 'A.ITEM', column: 'Name' },
                { entityId: 'B.ITEM', column: 'Ref' }
            ] }), { dialect: 'tsql', comments: false });
        record('v2.4.0 same-named tables from different schemas get stable aliases', aliasSql.indexOf('FROM [a].[item] AS item') >= 0 &&
            aliasSql.indexOf('JOIN [b].[item] AS item_2') >= 0, aliasSql);
        var view = planFor(schema, [
            { entityId: 'DBO.CUSTOMER', column: 'Email' },
            { entityId: 'DBO.VORDERLINE', column: 'Quantity' }
        ]);
        record('v2.4.0 views declare no keys and are reported instead of guessed', view.problems.length === 1 &&
            view.problems[0].message.indexOf('Views declare no keys') >= 0, view.problems);
        var external = parseSchema('CREATE TABLE dbo.Thing (Id INT PRIMARY KEY, RegionId INT REFERENCES dbo.Region (Id));');
        var externalGraph = queryBuildGraph(external);
        record('v2.4.0 unresolved external targets are skipped and explained', externalGraph.skipped.length === 1 &&
            externalGraph.skipped[0].id === 'external:DBO.REGION' &&
            externalGraph.skipped[0].reason === 'external' &&
            externalGraph.edges.length === 0 &&
            !!externalGraph.nodes['DBO.THING'], externalGraph);
    }
    catch (err) {
        record('v2.4.0 composite FKs join every column pair with AND', false, String(err && err.stack || err));
        record('v2.4.0 same-named columns from different tables get stable aliases', false, String(err && err.stack || err));
        record('v2.4.0 same-named tables from different schemas get stable aliases', false, String(err && err.stack || err));
        record('v2.4.0 views declare no keys and are reported instead of guessed', false, String(err && err.stack || err));
        record('v2.4.0 unresolved external targets are skipped and explained', false, String(err && err.stack || err));
    }
    /* ---- Dialects and determinism ---- */
    try {
        var pgPlan = planFor(schema, [{ entityId: 'DBO.CUSTOMER', column: 'Email' }]);
        var pgSql = queryPlanSQL(pgPlan, { dialect: 'postgres', comments: false });
        record('v2.4.0 dialect quoting switches between brackets and double quotes', pgSql === 'SELECT\n  customer."Email"\nFROM "dbo"."Customer" AS customer;' &&
            queryQuoteIdent('a]b', 'tsql') === '[a]]b]' &&
            queryQuoteIdent('a"b', 'postgres') === '"a""b"' &&
            queryQuoteIdent('a"b', 'db2') === '"a""b"', pgSql);
        var selections = [
            { entityId: 'DBO.ORDERLINE', column: 'Quantity' },
            { entityId: 'DBO.PRODUCT', column: 'Sku' },
            { entityId: 'DBO.CUSTOMER', column: 'Email' }
        ];
        var planA = planFor(schema, selections);
        var planB = planFor(schema, selections);
        record('v2.4.0 plans and SQL are deterministic', JSON.stringify(planA) === JSON.stringify(planB) &&
            queryPlanSQL(planA, { dialect: 'tsql', comments: true }) ===
                queryPlanSQL(planB, { dialect: 'tsql', comments: true }), planA);
        record('v2.4.0 an empty selection emits no SQL', queryPlanSQL(planFor(schema, []), { dialect: 'tsql', comments: true }) === '' &&
            queryBuildPlan({ result: schema, selections: [] }).fromId === null, planFor(schema, []));
        var highlightText = queryPlanSQL(planFor(schema, [
            { entityId: 'DBO.CUSTOMER', column: 'Email' }
        ]), { dialect: 'tsql', comments: true });
        var tokens = queryTokenizeSQL(highlightText);
        record('v2.4.0 SQL highlighting tokens rebuild the exact SQL text', tokens.map(function (token) { return token.text; }).join('') === highlightText &&
            tokens.some(function (token) {
                return token.kind === 'keyword' && token.text === 'SELECT';
            }) &&
            tokens.some(function (token) {
                return token.kind === 'ident' && token.text === '[dbo]';
            }) &&
            tokens.some(function (token) {
                return token.kind === 'comment' && token.text.indexOf('proc>flow') >= 0;
            }) &&
            tokens.some(function (token) {
                return token.kind === 'punct' && token.text === ';';
            }) &&
            JSON.stringify(queryTokenizeSQL(highlightText)) === JSON.stringify(tokens), { tokenCount: tokens.length });
        var predicateText = "customer.[Email] = 'x' -- note\nAND n = 12";
        var predicateTokens = queryTokenizeSQL(predicateText);
        record('v2.4.0 SQL highlighting classifies strings, numbers, and line comments', predicateTokens.map(function (token) { return token.text; }).join('') === predicateText &&
            predicateTokens.some(function (token) {
                return token.kind === 'string' && token.text === "'x'";
            }) &&
            predicateTokens.some(function (token) {
                return token.kind === 'number' && token.text === '12';
            }) &&
            predicateTokens.some(function (token) {
                return token.kind === 'comment' && token.text === '-- note';
            }), predicateTokens);
    }
    catch (err) {
        record('v2.4.0 dialect quoting switches between brackets and double quotes', false, String(err && err.stack || err));
        record('v2.4.0 plans and SQL are deterministic', false, String(err && err.stack || err));
        record('v2.4.0 an empty selection emits no SQL', false, String(err && err.stack || err));
        record('v2.4.0 SQL highlighting tokens rebuild the exact SQL text', false, String(err && err.stack || err));
        record('v2.4.0 SQL highlighting classifies strings, numbers, and line comments', false, String(err && err.stack || err));
    }
    /* ---- v2.4.0 query ergonomics: DISTINCT, row caps, ORDER BY ---- */
    try {
        var ergoSelections = [
            { entityId: 'DBO.ORDERHEADER', column: 'PlacedAt' },
            { entityId: 'DBO.CUSTOMER', column: 'Email' }
        ];
        var ergoPlan = planFor(schema, ergoSelections);
        var tsql = queryPlanSQL(ergoPlan, { dialect: 'tsql', comments: false,
            distinct: true, rowLimit: 100,
            orderBy: [{ entityId: 'DBO.ORDERHEADER', column: 'PlacedAt', direction: 'desc' }] });
        record('v2.4.0 DISTINCT and the T-SQL TOP cap lead the SELECT list', tsql.indexOf('SELECT DISTINCT TOP 100\n') === 0 &&
            tsql.indexOf('ORDER BY orderheader.[PlacedAt] DESC;') >= 0, tsql);
        var pg = queryPlanSQL(ergoPlan, { dialect: 'postgres', comments: false,
            rowLimit: 50, orderBy: [{ entityId: 'DBO.CUSTOMER', column: 'Email', direction: 'asc' }] });
        var lite = queryPlanSQL(ergoPlan, { dialect: 'sqlite', comments: false, rowLimit: 50 });
        var db2 = queryPlanSQL(ergoPlan, { dialect: 'db2', comments: false, rowLimit: 50 });
        record('v2.4.0 row caps and ORDER BY follow each dialect syntax', pg.indexOf('ORDER BY customer."Email" ASC\nLIMIT 50;') >= 0 &&
            pg.indexOf('SELECT\n') === 0 &&
            lite.indexOf('LIMIT 50;') >= 0 &&
            db2.indexOf('FETCH FIRST 50 ROWS ONLY;') >= 0 &&
            db2.indexOf('LIMIT') < 0 &&
            queryPlanSQL(ergoPlan, { dialect: 'tsql', comments: false, rowLimit: 50 })
                .indexOf('SELECT TOP 50\n') === 0, { pg: pg, lite: lite, db2: db2 });
        var ignored = queryPlanSQL(ergoPlan, { dialect: 'tsql', comments: false,
            orderBy: [{ entityId: 'DBO.CAMPAIGN', column: 'Name', direction: 'asc' }] });
        record('v2.4.0 ordering is limited to picked columns and cannot inject SQL', ignored.indexOf('ORDER BY') < 0 &&
            ignored.indexOf('Campaign') < 0, ignored);
        var documented = queryPlanSQL(ergoPlan, { dialect: 'tsql', comments: true,
            distinct: true, rowLimit: 100,
            orderBy: [{ entityId: 'DBO.CUSTOMER', column: 'Email', direction: 'asc' }] });
        record('v2.4.0 ergonomics options are explained in the provenance header', documented.indexOf('Distinct: duplicate rows are collapsed.') >= 0 &&
            documented.indexOf('Row cap: first 100 rows only.') >= 0 &&
            documented.indexOf('Order: dbo.Customer.Email asc.') >= 0, documented);
    }
    catch (err) {
        record('v2.4.0 DISTINCT and the T-SQL TOP cap lead the SELECT list', false, String(err && err.stack || err));
        record('v2.4.0 row caps and ORDER BY follow each dialect syntax', false, String(err && err.stack || err));
        record('v2.4.0 ordering is limited to picked columns and cannot inject SQL', false, String(err && err.stack || err));
        record('v2.4.0 ergonomics options are explained in the provenance header', false, String(err && err.stack || err));
    }
    /* ---- v2.4.0 self joins: a second aliased copy of the same table ---- */
    try {
        var selfSelections = [
            { entityId: 'DBO.CUSTOMER', column: 'DisplayName' },
            { entityId: 'DBO.CUSTOMER', column: 'ReferredBy' }
        ];
        var selfManual = [
            { id: 's1', leftId: 'DBO.CUSTOMER', leftColumn: 'ReferredBy',
                rightId: 'DBO.CUSTOMER', rightColumn: 'CustomerId',
                selfColumns: ['DisplayName'] }
        ];
        var selfPlan = planFor(schema, selfSelections, { manual: selfManual });
        var selfSql = queryPlanSQL(selfPlan, { dialect: 'tsql', comments: false });
        record('v2.4.0 self joins add a second aliased copy and route copy columns', selfPlan.joins.length === 1 && selfPlan.joins[0].selfJoin === true &&
            selfPlan.joins[0].copyColumns.join(',') === 'DisplayName' &&
            selfSql === ('SELECT\n  customer_2.[DisplayName],\n  customer.[ReferredBy]\n' +
                'FROM [dbo].[Customer] AS customer\n' +
                'INNER JOIN [dbo].[Customer] AS customer_2\n' +
                '  ON customer.[ReferredBy] = customer_2.[CustomerId];'), { sql: selfSql, joins: selfPlan.joins });
        var selfComments = queryPlanSQL(selfPlan, { dialect: 'tsql', comments: true });
        record('v2.4.0 self joins are explained and labelled in the provenance header', selfComments.indexOf('customer_2 = dbo.Customer (second copy, self join: DisplayName)') >= 0 &&
            selfPlan.education.some(function (line) {
                return line.indexOf('self join') >= 0;
            }) &&
            selfPlan.joins[0].explanation.indexOf('Self join taught') >= 0, selfComments);
        var ignoredSelf = planFor(schema, [
            { entityId: 'DBO.CUSTOMER', column: 'Email' }
        ], { manual: [
                { id: 's2', leftId: 'DBO.AUDITLOG', leftColumn: 'EntityId',
                    rightId: 'DBO.AUDITLOG', rightColumn: 'LogId' }
            ] });
        record('v2.4.0 a self join on an unpicked table is ignored with a warning', ignoredSelf.joins.length === 0 &&
            ignoredSelf.warnings.some(function (warning) {
                return warning.indexOf('self join') >= 0;
            }), ignoredSelf.warnings);
        var doubleSelf = planFor(schema, selfSelections, { manual: selfManual.concat([
                { id: 's3', leftId: 'DBO.CUSTOMER', leftColumn: 'ReferredBy',
                    rightId: 'DBO.CUSTOMER', rightColumn: 'CustomerId' }
            ]) });
        record('v2.4.0 only the first self join per table is applied', doubleSelf.joins.length === 1 &&
            doubleSelf.warnings.some(function (warning) {
                return warning.indexOf('first self join') >= 0;
            }), doubleSelf.warnings);
    }
    catch (err) {
        record('v2.4.0 self joins add a second aliased copy and route copy columns', false, String(err && err.stack || err));
        record('v2.4.0 self joins are explained and labelled in the provenance header', false, String(err && err.stack || err));
        record('v2.4.0 a self join on an unpicked table is ignored with a warning', false, String(err && err.stack || err));
        record('v2.4.0 only the first self join per table is applied', false, String(err && err.stack || err));
    }
    /* ---- v2.4.0 query-engine scale: a 1,000-table declared chain ---- */
    try {
        var chainLines = [];
        for (var chainIndex = 1; chainIndex <= 1000; chainIndex++) {
            chainLines.push('CREATE TABLE app.t' + chainIndex + ' (', '  id INT NOT NULL,', '  name VARCHAR(20),');
            if (chainIndex > 1) {
                chainLines.push('  ref_id INT NULL,', '  CONSTRAINT fk_qs' + chainIndex + ' FOREIGN KEY (ref_id) REFERENCES app.t' +
                    (chainIndex - 1) + ' (id),');
            }
            chainLines.push('  CONSTRAINT pk_qs' + chainIndex + ' PRIMARY KEY (id)', ');');
        }
        var chainSchema = parseSchema(chainLines.join('\n'));
        record('v2.4.0 the 1,000-table scale fixture parses', chainSchema.stats.tables === 1000 && chainSchema.stats.relationships === 999, chainSchema.stats);
        var chainSelections = [
            { entityId: 'APP.T1000', column: 'name' },
            { entityId: 'APP.T1', column: 'name' }
        ];
        var chainPlan = planFor(chainSchema, chainSelections);
        record('v2.4.0 longest-path plans resolve without stack overflow', chainPlan.problems.length === 0 &&
            chainPlan.usedIds.length === 1000 &&
            chainPlan.joins.length === 999 &&
            chainPlan.bridges.length === 998 &&
            chainPlan.joins.every(function (join) { return join.joinType === 'left'; }), { used: chainPlan.usedIds.length, joins: chainPlan.joins.length,
            bridges: chainPlan.bridges.length });
        var chainPlanAgain = planFor(chainSchema, chainSelections);
        record('v2.4.0 the 1,000-table plan is deterministic', JSON.stringify(chainPlan) === JSON.stringify(chainPlanAgain) &&
            queryPlanSQL(chainPlan, { dialect: 'tsql', comments: false }) ===
                queryPlanSQL(chainPlanAgain, { dialect: 'tsql', comments: false }), { joins: chainPlan.joins.length });
    }
    catch (err) {
        record('v2.4.0 the 1,000-table scale fixture parses', false, String(err && err.stack || err));
        record('v2.4.0 longest-path plans resolve without stack overflow', false, String(err && err.stack || err));
        record('v2.4.0 the 1,000-table plan is deterministic', false, String(err && err.stack || err));
    }
    /* ---- v2.5.0 query persistence: saved state and versioned query files ---- */
    try {
        var storeInput = {
            name: '  Orders by customer  ',
            selections: [
                { entityId: 'DBO.ORDERHEADER', column: 'PlacedAt' },
                { entityId: 'DBO.CUSTOMER', column: 'Email' }
            ],
            manual: [{ id: 'm1', leftId: 'DBO.AUDITLOG', leftColumn: 'EntityId',
                    rightId: 'DBO.CUSTOMER', rightColumn: 'CustomerId',
                    predicate: 'customer.[CustomerId] = auditlog.[EntityId]' }],
            cross: ['DBO.EXTRA'],
            excluded: ['DBO.NOTE'],
            joinTypes: { 'rel:1': 'left' },
            pathChoices: { 'DBO.APPUSER->DBO.ORDERHEADER': 1 },
            options: { dialect: 'postgres', comments: false, distinct: true, rowLimit: 100,
                onlyUsed: true,
                sorts: [{ entityId: 'DBO.CUSTOMER', column: 'Email', direction: 'desc' }],
                aggregates: { 'DBO.CUSTOMER|EMAIL': 'count' } }
        };
        var built = queryStateBuild(schema, storeInput);
        var builtJSON = queryStateToJSON(built);
        var parsedStore = queryStateFromJSON(builtJSON);
        record('v2.5.0 saved query round-trips deterministically', !!parsedStore.state &&
            parsedStore.diagnostics.length === 0 &&
            queryStateToJSON(parsedStore.state) === builtJSON &&
            built.name === 'Orders by customer' &&
            built.fingerprint === schemaFingerprint(schema) &&
            queryStateToJSON(queryStateBuild(schema, storeInput)) === builtJSON, builtJSON);
        var badJSON = queryStateFromJSON('not json');
        var badFormat = queryStateFromJSON('{"format":"other","version":1}');
        var badVersion = queryStateFromJSON('{"format":"procflow-erd-query","version":9}');
        record('v2.5.0 foreign, future, and malformed query files are rejected', !badJSON.state &&
            badJSON.diagnostics[0].code === 'erd_query_parse_error' &&
            !badFormat.state &&
            badFormat.diagnostics[0].code === 'erd_query_format_error' &&
            !badVersion.state &&
            badVersion.diagnostics[0].code === 'erd_query_version_error', { badJSON: badJSON, badFormat: badFormat, badVersion: badVersion });
        var messy = queryStateFromJSON(JSON.stringify({
            format: 'procflow-erd-query', version: 1, fingerprint: 'abc',
            selections: [{ entityId: 'A', column: 'X' }, { entityId: 7 }, { column: 'Y' }, null],
            manual: [{ id: 'm', leftId: 'A' }],
            cross: ['ok', 42],
            excluded: 'nope',
            joinTypes: { good: 'inner', bad: 'sideways' },
            pathChoices: { 'A->B': 2, 'C->D': 'x' },
            options: { dialect: 'oracle', comments: 'yes', distinct: 1, rowLimit: -5,
                onlyUsed: 'y', sorts: [{ entityId: 'A', column: 'X', direction: 'down' }],
                aggregates: { good: 'sum', bad: 'median' } }
        }));
        record('v2.5.0 unreadable saved entries are ignored with one info diagnostic', !!messy.state &&
            messy.state.selections.length === 1 &&
            messy.state.manual.length === 0 &&
            messy.state.cross.join(',') === 'ok' &&
            messy.state.excluded.length === 0 &&
            messy.state.joinTypes.good === 'inner' && !messy.state.joinTypes.bad &&
            messy.state.pathChoices['A->B'] === 2 && !messy.state.pathChoices['C->D'] &&
            messy.state.options.dialect === 'tsql' &&
            messy.state.options.comments === true &&
            messy.state.options.distinct === true &&
            messy.state.options.rowLimit === 0 &&
            messy.state.options.sorts.length === 1 &&
            messy.state.options.sorts[0].direction === 'asc' &&
            messy.state.options.aggregates.good === 'sum' &&
            !messy.state.options.aggregates.bad &&
            messy.diagnostics.length === 1 &&
            messy.diagnostics[0].code === 'erd_query_entries_ignored' &&
            messy.diagnostics[0].severity === 'info', messy);
        var stale = queryStateBuild(schema, {
            selections: [
                { entityId: 'DBO.CUSTOMER', column: 'Email' },
                { entityId: 'DBO.CUSTOMER', column: 'Legacy' },
                { entityId: 'DBO.GONE', column: 'X' }
            ],
            manual: [
                { id: 'm1', leftId: 'DBO.GONE', leftColumn: 'X',
                    rightId: 'DBO.CUSTOMER', rightColumn: 'Email' },
                { id: 'm2', leftId: 'DBO.AUDITLOG', leftColumn: 'EntityId',
                    rightId: 'DBO.CUSTOMER', rightColumn: 'CustomerId' }
            ],
            cross: ['DBO.GONE', 'DBO.EXTRA'],
            excluded: ['DBO.GONE'],
            joinTypes: {},
            pathChoices: { 'DBO.GONE->DBO.CUSTOMER': 1,
                'DBO.APPUSER->DBO.ORDERHEADER': 0 },
            options: { dialect: 'tsql', comments: true, distinct: false, rowLimit: 0,
                onlyUsed: false,
                sorts: [{ entityId: 'DBO.CUSTOMER', column: 'Email', direction: 'asc' },
                    { entityId: 'DBO.CUSTOMER', column: 'Legacy', direction: 'asc' }],
                aggregates: { 'DBO.CUSTOMER|EMAIL': 'sum',
                    'DBO.CUSTOMER|LEGACY': 'count' } }
        });
        var pruned = queryStatePrune(stale, queryBuildGraph(schema));
        record('v2.5.0 stale references are pruned and reported, never applied silently', pruned.state.selections.length === 1 &&
            pruned.state.selections[0].column === 'Email' &&
            pruned.state.manual.length === 1 && pruned.state.manual[0].id === 'm2' &&
            pruned.state.cross.join(',') === 'DBO.EXTRA' &&
            pruned.state.excluded.length === 0 &&
            pruned.state.pathChoices['DBO.APPUSER->DBO.ORDERHEADER'] === 0 &&
            !pruned.state.pathChoices['DBO.GONE->DBO.CUSTOMER'] &&
            pruned.state.options.sorts.length === 1 &&
            pruned.state.options.aggregates['DBO.CUSTOMER|EMAIL'] === 'sum' &&
            !pruned.state.options.aggregates['DBO.CUSTOMER|LEGACY'] &&
            pruned.dropped.length === 8, pruned);
        var extraSchema = parseSchema(DDL +
            '\nCREATE TABLE dbo.ExtraTable (Id INT PRIMARY KEY);');
        record('v2.5.0 the schema fingerprint is stable and changes with the schema', schemaFingerprint(schema) === schemaFingerprint(parseSchema(DDL)) &&
            schemaFingerprint(schema) !== schemaFingerprint(extraSchema) &&
            schemaFingerprint(schema) === erdLayoutFingerprint(schema), { base: schemaFingerprint(schema), changed: schemaFingerprint(extraSchema) });
        var noName = parsedStore.state;
        delete noName.name;
        record('v2.5.0 export file names derive from the query name or fingerprint', queryFileBaseName(built) === 'orders-by-customer' &&
            queryFileBaseName(noName) === 'procflow-query-' + schemaFingerprint(schema), { named: queryFileBaseName(built), unnamed: queryFileBaseName(noName) });
        var v1File = queryStateFromJSON(JSON.stringify({
            format: 'procflow-erd-query', version: 1, fingerprint: 'abc',
            selections: [{ entityId: 'A', column: 'X' }],
            options: { dialect: 'tsql', comments: true, distinct: false, rowLimit: 0,
                onlyUsed: false, sorts: [] }
        }));
        record('v2.6.0 version-1 query files migrate forward with empty aggregates', !!v1File.state && v1File.state.version === 2 &&
            Object.keys(v1File.state.options.aggregates).length === 0 &&
            v1File.diagnostics.length === 0, v1File);
        var wrote = writeErdQuery(builtJSON);
        var stored = hasStoredErdQuery();
        var storedParsed = queryStateFromJSON(readErdQuery());
        clearErdQuery();
        record('v2.5.0 opt-in browser storage round-trips and clears explicitly', wrote && stored && !!storedParsed.state &&
            queryStateToJSON(storedParsed.state) === builtJSON &&
            !hasStoredErdQuery() && readErdQuery() === null, { wrote: wrote, stored: stored });
    }
    catch (err) {
        record('v2.5.0 saved query round-trips deterministically', false, String(err && err.stack || err));
        record('v2.5.0 foreign, future, and malformed query files are rejected', false, String(err && err.stack || err));
        record('v2.5.0 unreadable saved entries are ignored with one info diagnostic', false, String(err && err.stack || err));
        record('v2.5.0 stale references are pruned and reported, never applied silently', false, String(err && err.stack || err));
        record('v2.5.0 the schema fingerprint is stable and changes with the schema', false, String(err && err.stack || err));
        record('v2.5.0 export file names derive from the query name or fingerprint', false, String(err && err.stack || err));
        record('v2.6.0 version-1 query files migrate forward with empty aggregates', false, String(err && err.stack || err));
        record('v2.5.0 opt-in browser storage round-trips and clears explicitly', false, String(err && err.stack || err));
    }
    /* ---- v2.6.0 aggregates: GROUP BY and aggregate functions ---- */
    try {
        var aggSelections = [
            { entityId: 'DBO.CUSTOMER', column: 'Email' },
            { entityId: 'DBO.ORDERHEADER', column: 'OrderId' }
        ];
        var aggPlan = planFor(schema, aggSelections);
        var aggSql = queryPlanSQL(aggPlan, { dialect: 'tsql', comments: false,
            aggregates: { 'DBO.ORDERHEADER|ORDERID': 'count' } });
        record('v2.6.0 aggregate columns render as functions and group the rest', aggSql === ('SELECT\n' +
            '  customer.[Email],\n' +
            '  COUNT(orderheader.[OrderId]) AS count_orderheader_orderid\n' +
            'FROM [dbo].[Customer] AS customer\n' +
            'LEFT JOIN [dbo].[OrderHeader] AS orderheader\n' +
            '  ON customer.[CustomerId] = orderheader.[CustomerId]\n' +
            'GROUP BY customer.[Email];'), aggSql);
        var allAgg = queryPlanSQL(aggPlan, { dialect: 'tsql', comments: false,
            aggregates: { 'DBO.CUSTOMER|EMAIL': 'count-distinct',
                'DBO.ORDERHEADER|ORDERID': 'sum' } });
        record('v2.6.0 an all-aggregate selection omits GROUP BY', allAgg.indexOf('GROUP BY') < 0 &&
            allAgg.indexOf('COUNT(DISTINCT customer.[Email]) AS count_distinct_customer_email') >= 0 &&
            allAgg.indexOf('SUM(orderheader.[OrderId]) AS sum_orderheader_orderid') >= 0, allAgg);
        var orderedAgg = queryPlanSQL(aggPlan, { dialect: 'tsql', comments: false,
            aggregates: { 'DBO.ORDERHEADER|ORDERID': 'count' },
            orderBy: [{ entityId: 'DBO.ORDERHEADER', column: 'OrderId', direction: 'desc' }] });
        record('v2.6.0 ordering can use the aggregate expression', orderedAgg.indexOf('ORDER BY COUNT(orderheader.[OrderId]) DESC;') >= 0, orderedAgg);
        var suppressed = queryPlanSQL(aggPlan, { dialect: 'tsql', comments: true,
            distinct: true, aggregates: { 'DBO.ORDERHEADER|ORDERID': 'count' } });
        record('v2.6.0 DISTINCT is suppressed and explained with aggregates', suppressed.indexOf('SELECT DISTINCT') < 0 &&
            suppressed.indexOf('Grouped by: dbo.Customer.Email.') >= 0 &&
            suppressed.indexOf('Aggregates: COUNT(dbo.OrderHeader.OrderId).') >= 0 &&
            suppressed.indexOf('Distinct: ignored because GROUP BY already collapses rows.') >= 0, suppressed);
        var invalidAgg = queryPlanSQL(aggPlan, { dialect: 'tsql', comments: false,
            aggregates: { 'DBO.ORDERHEADER|ORDERID': 'median' } });
        record('v2.6.0 unknown aggregate functions are ignored', invalidAgg.indexOf('GROUP BY') < 0 &&
            invalidAgg.indexOf('COUNT(') < 0 &&
            invalidAgg.indexOf('orderheader.[OrderId]\n') >= 0, invalidAgg);
    }
    catch (err) {
        record('v2.6.0 aggregate columns render as functions and group the rest', false, String(err && err.stack || err));
        record('v2.6.0 an all-aggregate selection omits GROUP BY', false, String(err && err.stack || err));
        record('v2.6.0 ordering can use the aggregate expression', false, String(err && err.stack || err));
        record('v2.6.0 DISTINCT is suppressed and explained with aggregates', false, String(err && err.stack || err));
        record('v2.6.0 unknown aggregate functions are ignored', false, String(err && err.stack || err));
    }
    var passed = results.filter(function (result) { return result.pass; }).length;
    window.PROCFLOW_QUERY_DETAIL = results;
    window.PROCFLOW_QUERY_RESULT = { passed: passed, total: results.length };
    window.PROCFLOW_QUERY_PASS = passed === results.length;
})();
//# sourceMappingURL=query.js.map