"use strict";
/* ===== v2.5.0 ERD / schema foundation (DDL → declared constraint model) =====
   Parses CREATE TABLE / CREATE VIEW / CREATE [UNIQUE] INDEX / ALTER TABLE
   across T-SQL, PostgreSQL, DB2, and SQLite into a conservative schema IR for
   the ERD page.

   Honesty rules (matches the v2 accuracy contract):
   - Only declared constraints become relationship edges. Nothing is inferred
     from query text.
   - Raw column type text is preserved verbatim (dialect types are not
     normalized); the ERD treats type as a display attribute.
   - Composite keys are grouped and never exploded into per-column edges.
   - Unresolved foreign-key targets become explicit external entities with a
     region-scoped diagnostic, never a silent drop.
   - Entity, column, and key spans point back into the source DDL.

   Views and CTAS tables without a declared column list have unknown columns;
   that is reported, not invented. */
var SCHEMA_IGNORED_CREATE = S([
    'PROCEDURE', 'PROC', 'FUNCTION', 'TRIGGER', 'SEQUENCE', 'SCHEMA', 'DATABASE',
    'TYPE', 'DOMAIN', 'EXTENSION', 'ROLE', 'USER', 'LOGIN', 'SYNONYM', 'TABLESPACE',
    'SERVER', 'PUBLICATION', 'SUBSCRIPTION', 'POLICY', 'RULE', 'AGGREGATE',
    'OPERATOR', 'CAST', 'LANGUAGE', 'COLLATION', 'STATISTICS', 'ASSEMBLY', 'XML',
    'CREDENTIAL', 'ENDPOINT', 'EVENT', 'FULLTEXT', 'MASTER', 'MESSAGE', 'PARTITION',
    'QUEUE', 'REMOTE', 'RESOURCE', 'SECURITY', 'SERVICE', 'SYMMETRIC', 'CERTIFICATE',
    'BROKER', 'CONTRACT', 'DIALOG', 'APPLICATION'
]);
/* Clause keywords that terminate a column's raw type text. `WITH`/`WITHOUT`
   stay out so multi-word types like `timestamp with time zone` and
   `character varying` are preserved. */
var SCHEMA_STOP = S([
    'NOT', 'NULL', 'DEFAULT', 'PRIMARY', 'UNIQUE', 'REFERENCES', 'CHECK', 'CONSTRAINT',
    'GENERATED', 'IDENTITY', 'AUTO_INCREMENT', 'AUTOINCREMENT', 'COLLATE', 'COMMENT',
    'AS', 'ENCODE', 'INLINE', 'PERIOD', 'ON', 'MASKED', 'ROWGUIDCOL', 'SPARSE',
    'FILESTREAM', 'PERSISTED', 'STORED', 'VIRTUAL'
]);
function schemaUnquote(part) {
    var s = part || '';
    if (s.length >= 2) {
        var a = s.charAt(0), b = s.charAt(s.length - 1);
        if (a === '[' && b === ']')
            s = s.slice(1, -1).replace(/\]\]/g, ']');
        else if (a === '"' && b === '"')
            s = s.slice(1, -1).replace(/""/g, '"');
        else if (a === '`' && b === '`')
            s = s.slice(1, -1).replace(/``/g, '`');
    }
    return s;
}
function schemaNormName(parts) {
    return parts.map(schemaUnquote).join('.').replace(/\s+/g, ' ').trim().toUpperCase();
}
function schemaNormColumn(name) {
    return String(name || '').toUpperCase();
}
/* v2.5.0 — stable FNV-1a hash of the declared entity set, shared by ERD layout
   files and query files so a stale payload can be detected without blocking a
   load. Pure and deterministic: entity ids and kinds only. */
function schemaFingerprint(result) {
    var text = ((result && result.entities) || []).map(function (entity) {
        return entity.id + '|' + entity.kind;
    }).sort().join(';');
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return ('0000000' + ((hash >>> 0).toString(16))).slice(-8);
}
function schemaIssue(ctx, severity, code, message, span) {
    ctx.diagnostics.push({ severity: severity, code: code, message: message,
        span: span, scope: 'region' });
}
function schemaSpan(start, end) {
    return { start: start, end: Math.max(start + 1, end) };
}
/* A dotted identifier written with any of the supported quoting styles.
   Returns unquoted parts so `[dbo].[Order]` and "dbo"."Order" compare equal. */
function schemaIdent(toks, i) {
    if (i >= toks.length || toks[i].type !== 'word')
        return null;
    var parts = [schemaUnquote(toks[i].v)];
    var start = toks[i].pos, end = toks[i].end, j = i + 1;
    while (j + 1 < toks.length && toks[j].v === '.' && toks[j + 1].type === 'word') {
        parts.push(schemaUnquote(toks[j + 1].v));
        end = toks[j + 1].end;
        j += 2;
    }
    return { parts: parts, start: start, end: end, next: j };
}
/* Index after the parenthesis matching the one at `open`. */
function schemaSkipParens(toks, open) {
    var depth = 0, i = open;
    while (i < toks.length) {
        if (toks[i].v === '(')
            depth++;
        else if (toks[i].v === ')') {
            depth--;
            if (depth <= 0)
                return i + 1;
        }
        i++;
    }
    return i;
}
function schemaSkipDefault(toks, i) {
    var depth = 0;
    while (i < toks.length) {
        var t = toks[i];
        if (t.v === '(') {
            depth++;
            i++;
            continue;
        }
        if (t.v === ')') {
            if (depth === 0)
                break;
            depth--;
            i++;
            continue;
        }
        if (depth === 0) {
            if (t.v === ',')
                break;
            if (t.type === 'word' && SCHEMA_STOP[t.u])
                break;
        }
        i++;
    }
    return i;
}
function schemaParseAction(toks, i) {
    var words = [];
    while (i < toks.length && toks[i].type === 'word' && words.length < 2) {
        var u = toks[i].u;
        if (words.length === 1 && /^(CASCADE|NULL|DEFAULT|ACTION)$/.test(u))
            words.push(u);
        else if (words.length === 0 && /^(CASCADE|RESTRICT|SET|NO)$/.test(u))
            words.push(u);
        else
            break;
        i++;
    }
    return { text: words.join(' '), end: i };
}
/* FOREIGN KEY / inline REFERENCES target with optional columns and actions. */
function schemaParseReference(toks, i) {
    if (!toks[i] || toks[i].type !== 'word' || toks[i].u !== 'REFERENCES')
        return null;
    var id = schemaIdent(toks, i + 1);
    if (!id)
        return null;
    var target = { name: id.parts.join('.'),
        columns: [],
        resolution: 'opaque',
        norm: schemaNormName(id.parts) };
    var j = id.next;
    if (toks[j] && toks[j].v === '(') {
        var parsed = schemaParseColumns(toks, j);
        if (parsed) {
            target.columns = parsed.names;
            j = parsed.end;
        }
    }
    var onDelete, onUpdate, deferrable;
    while (j < toks.length) {
        var t = toks[j];
        if (t.type === 'word' && t.u === 'ON' && toks[j + 1] && toks[j + 1].type === 'word' &&
            (toks[j + 1].u === 'DELETE' || toks[j + 1].u === 'UPDATE')) {
            var action = schemaParseAction(toks, j + 2);
            if (toks[j + 1].u === 'DELETE')
                onDelete = action.text;
            else
                onUpdate = action.text;
            j = action.end;
            continue;
        }
        if (t.type === 'word' && t.u === 'MATCH') {
            j += 2;
            continue;
        }
        if (t.type === 'word' && t.u === 'DEFERRABLE') {
            deferrable = true;
            j++;
            continue;
        }
        if (t.type === 'word' && t.u === 'NOT' && toks[j + 1] && toks[j + 1].u === 'DEFERRABLE') {
            deferrable = false;
            j += 2;
            continue;
        }
        if (t.type === 'word' && t.u === 'INITIALLY') {
            j += 2;
            continue;
        }
        break;
    }
    return { target: target, onDelete: onDelete, onUpdate: onUpdate,
        deferrable: deferrable, end: j };
}
/* Comma-separated column list inside parentheses; returns names and the index
   after the closing parenthesis. */
function schemaParseColumns(toks, i) {
    if (!toks[i] || toks[i].v !== '(')
        return null;
    var names = [], j = i + 1;
    while (j < toks.length) {
        var t = toks[j];
        if (t.v === ')')
            return { names: names, end: j + 1 };
        if (t.v === ',') {
            j++;
            continue;
        }
        if (t.type === 'word') {
            var id = schemaIdent(toks, j);
            if (!id)
                return null;
            names.push(id.parts[id.parts.length - 1]);
            j = id.next;
            while (j < toks.length && toks[j].type === 'word' && (toks[j].u === 'ASC' || toks[j].u === 'DESC'))
                j++;
            continue;
        }
        return null;
    }
    return null;
}
function schemaAddEntity(ctx, entity) {
    if (ctx.byKey[entity.id]) {
        schemaIssue(ctx, 'warning', 'schema_duplicate_entity', 'Table or view "' + entity.name + '" is defined more than once; the first definition is kept.', entity.span);
        return false;
    }
    ctx.byKey[entity.id] = entity;
    ctx.entities.push(entity);
    return true;
}
function schemaAddColumn(ctx, entity, col) {
    if (entity.columns.some(function (c) { return schemaNormColumn(c.name) === schemaNormColumn(col.name); })) {
        schemaIssue(ctx, 'warning', 'schema_duplicate_column', 'Column "' + col.name + '" appears more than once in "' + entity.name + '"; the first definition is kept.', col.span);
        return;
    }
    entity.columns.push(col);
}
function schemaAddKey(entity, key) {
    var signature = key.kind + '|' + key.columns.map(schemaNormColumn).join('|') + '|' +
        (key.referenced ? key.referenced.norm : '');
    var duplicate = entity.keys.some(function (existing) {
        return existing.kind + '|' + existing.columns.map(schemaNormColumn).join('|') + '|' +
            (existing.referenced ? existing.referenced.norm : '') === signature;
    });
    if (!duplicate)
        entity.keys.push(key);
}
/* Split a statement on commas at the top level of the parentheses opened at
   `open`. The opening parenthesis is not part of any item. */
function schemaSplitItems(toks, open) {
    var items = [], cur = [], depth = 1, i = open + 1;
    while (i < toks.length) {
        var t = toks[i];
        if (t.v === '(')
            depth++;
        else if (t.v === ')') {
            depth--;
            if (depth === 0) {
                if (cur.length)
                    items.push(cur);
                return { items: items, end: i + 1 };
            }
        }
        if (depth === 1 && t.v === ',') {
            if (cur.length)
                items.push(cur);
            cur = [];
            i++;
            continue;
        }
        cur.push(t);
        i++;
    }
    if (cur.length)
        items.push(cur);
    return { items: items, end: i };
}
/* Split a whole DDL document into statements. Semicolons and T-SQL `GO`
   batches are authoritative; a new top-level CREATE/ALTER recovers when
   semicolons are omitted, matching the parser's newline-independent goal. */
function schemaStatements(toks) {
    var out = [], cur = [], depth = 0;
    function flush() {
        if (cur.length)
            out.push(cur);
        cur = [];
    }
    for (var i = 0; i < toks.length; i++) {
        var t = toks[i];
        if (t.v === '(')
            depth++;
        else if (t.v === ')')
            depth = Math.max(0, depth - 1);
        if (depth === 0) {
            if (t.v === ';') {
                flush();
                continue;
            }
            if (t.type === 'word' && t.u === 'GO') {
                flush();
                continue;
            }
            /* Missing-semicolon recovery: a new top-level CREATE/ALTER starts a
               statement. Semicolons and GO remain authoritative. */
            if (cur.length && t.type === 'word' && (t.u === 'CREATE' || t.u === 'ALTER'))
                flush();
        }
        cur.push(t);
    }
    flush();
    return out;
}
function schemaMarkPrimaryKey(entity, columns) {
    columns.forEach(function (name) {
        entity.columns.forEach(function (col) {
            if (schemaNormColumn(col.name) === schemaNormColumn(name)) {
                col.primaryKey = true;
                col.nullable = false;
            }
        });
    });
}
function schemaMarkUnique(entity, columns) {
    if (columns.length !== 1)
        return;
    entity.columns.forEach(function (col) {
        if (schemaNormColumn(col.name) === schemaNormColumn(columns[0]))
            col.unique = true;
    });
}
/* Column definition: name, raw type, inline constraints, inline FK. */
function schemaParseColumnItem(ctx, entity, item, constraintName) {
    if (!item.length || item[0].type !== 'word')
        return;
    var nameTok = item[0];
    var col = {
        name: schemaUnquote(nameTok.v),
        type: '',
        nullable: true,
        primaryKey: false,
        unique: false,
        identity: false,
        generated: false,
        computed: false,
        ordinal: entity.columns.length + 1,
        span: schemaSpan(nameTok.pos, nameTok.end)
    };
    var i = 1, typeStart = -1, typeEnd = -1;
    while (i < item.length) {
        var t = item[i];
        if (t.type === 'word' && SCHEMA_STOP[t.u])
            break;
        if (t.v === '(') {
            var afterParen = schemaSkipParens(item, i);
            if (typeStart >= 0 && afterParen > i)
                typeEnd = item[afterParen - 1].end;
            i = afterParen;
            continue;
        }
        if (t.v === ',')
            break;
        if (typeStart < 0)
            typeStart = t.pos;
        typeEnd = t.end;
        i++;
    }
    if (typeStart >= 0 && typeEnd > typeStart) {
        col.type = ctx.text.slice(typeStart, typeEnd).replace(/\s+/g, ' ').trim();
        if (/^(BIGSERIAL|SERIAL|SMALLSERIAL)$/i.test(col.type))
            col.identity = true;
    }
    while (i < item.length) {
        var c = item[i];
        if (c.type === 'word' && c.u === 'CONSTRAINT') {
            i += 2;
            continue;
        }
        if (c.type === 'word' && c.u === 'NOT' && item[i + 1] && item[i + 1].u === 'NULL') {
            col.nullable = false;
            i += 2;
            continue;
        }
        if (c.type === 'word' && c.u === 'NULL') {
            col.nullable = true;
            i++;
            continue;
        }
        if (c.type === 'word' && c.u === 'DEFAULT') {
            i = schemaSkipDefault(item, i + 1);
            continue;
        }
        if (c.type === 'word' && c.u === 'PRIMARY' && item[i + 1] && item[i + 1].u === 'KEY') {
            col.primaryKey = true;
            col.nullable = false;
            schemaAddKey(entity, { kind: 'pk', columns: [col.name], name: constraintName,
                span: schemaSpan(c.pos, item[i + 1].end) });
            i += 2;
            continue;
        }
        if (c.type === 'word' && c.u === 'UNIQUE') {
            col.unique = true;
            schemaAddKey(entity, { kind: 'unique', columns: [col.name], name: constraintName,
                span: schemaSpan(c.pos, c.end) });
            i++;
            continue;
        }
        if (c.type === 'word' && c.u === 'REFERENCES') {
            var refStart = c;
            var ref = schemaParseReference(item, i);
            if (ref) {
                schemaAddKey(entity, { kind: 'fk', columns: [col.name], name: constraintName,
                    referenced: ref.target, onDelete: ref.onDelete,
                    onUpdate: ref.onUpdate, deferrable: ref.deferrable,
                    span: schemaSpan(refStart.pos, item[ref.end - 1].end) });
                i = ref.end;
            }
            else
                i++;
            continue;
        }
        if (c.type === 'word' && c.u === 'CHECK') {
            i = schemaSkipParens(item, i + 1);
            continue;
        }
        if (c.type === 'word' && c.u === 'GENERATED') {
            var g = i + 1;
            if (item[g] && item[g].type === 'word' && (item[g].u === 'ALWAYS' || item[g].u === 'BY')) {
                if (item[g].u === 'BY') {
                    g++;
                    if (item[g] && item[g].u === 'DEFAULT')
                        g++;
                    if (item[g] && item[g].u === 'ON' && item[g + 1] && item[g + 1].u === 'NULL')
                        g += 2;
                }
                else
                    g++;
            }
            if (item[g] && item[g].u === 'AS') {
                g++;
                if (item[g] && item[g].u === 'IDENTITY') {
                    col.identity = true;
                    g = (item[g + 1] && item[g + 1].v === '(') ? schemaSkipParens(item, g + 1) : g + 1;
                }
                else if (item[g] && item[g].v === '(') {
                    col.generated = true;
                    g = schemaSkipParens(item, g);
                }
            }
            else if (item[g] && item[g].u === 'IDENTITY') {
                col.identity = true;
                g = (item[g + 1] && item[g + 1].v === '(') ? schemaSkipParens(item, g + 1) : g + 1;
            }
            i = g;
            continue;
        }
        if (c.type === 'word' && c.u === 'IDENTITY') {
            col.identity = true;
            i = (item[i + 1] && item[i + 1].v === '(') ? schemaSkipParens(item, i + 1) : i + 1;
            continue;
        }
        if (c.type === 'word' && c.u === 'AUTO_INCREMENT') {
            col.identity = true;
            i++;
            continue;
        }
        if (c.type === 'word' && c.u === 'AUTOINCREMENT') {
            col.identity = true;
            i++;
            continue;
        }
        if (c.type === 'word' && c.u === 'COLLATE') {
            i += 2;
            continue;
        }
        if (c.type === 'word' && c.u === 'COMMENT') {
            i += 2;
            continue;
        }
        if (c.type === 'word' && c.u === 'AS' && item[i + 1] && item[i + 1].v === '(') {
            col.computed = true;
            i = schemaSkipParens(item, i + 1);
            continue;
        }
        if (c.v === '(') {
            i = schemaSkipParens(item, i);
            continue;
        }
        i++;
    }
    col.span = schemaSpan(nameTok.pos, item[item.length - 1].end);
    schemaAddColumn(ctx, entity, col);
}
/* PRIMARY KEY / UNIQUE / FOREIGN KEY / CHECK item inside a table body. */
function schemaParseTableItem(ctx, entity, item, constraintName) {
    if (!item.length)
        return;
    var i = 0, spanStart = item[0].pos;
    if (item[0].type === 'word' && item[0].u === 'CONSTRAINT') {
        if (item[1])
            constraintName = schemaUnquote(item[1].v);
        i = 2;
    }
    var head = item[i];
    if (!head || head.type !== 'word') {
        schemaParseColumnItem(ctx, entity, item, constraintName);
        return;
    }
    var u = head.u;
    if (u === 'PRIMARY' || u === 'UNIQUE') {
        var kind = u === 'UNIQUE' ? 'unique' : 'pk';
        var j = i + 1;
        if (item[j] && item[j].u === 'KEY')
            j++;
        if (u === 'UNIQUE' && item[j] && (item[j].u === 'INDEX'))
            j++;
        if (item[j] && (item[j].u === 'CLUSTERED' || item[j].u === 'NONCLUSTERED'))
            j++;
        var cols = schemaParseColumns(item, j);
        if (!cols) {
            schemaIssue(ctx, 'warning', 'schema_unparsed_statement', 'Could not read the column list of a ' + u + ' constraint on "' + entity.name + '".', schemaSpan(spanStart, item[item.length - 1].end));
            return;
        }
        var key = { kind: kind, columns: cols.names, name: constraintName,
            span: schemaSpan(spanStart, item[item.length - 1].end) };
        schemaAddKey(entity, key);
        if (kind === 'pk')
            schemaMarkPrimaryKey(entity, cols.names);
        else
            schemaMarkUnique(entity, cols.names);
        return;
    }
    if (u === 'FOREIGN') {
        var k = i + 1;
        if (item[k] && item[k].u === 'KEY')
            k++;
        var fkCols = schemaParseColumns(item, k);
        if (!fkCols || !item[fkCols.end] || item[fkCols.end].u !== 'REFERENCES') {
            schemaIssue(ctx, 'warning', 'schema_unparsed_statement', 'Could not read a FOREIGN KEY constraint on "' + entity.name + '".', schemaSpan(spanStart, item[item.length - 1].end));
            return;
        }
        var ref = schemaParseReference(item, fkCols.end);
        if (!ref) {
            schemaIssue(ctx, 'warning', 'schema_unparsed_statement', 'Could not read the REFERENCES target of a FOREIGN KEY on "' + entity.name + '".', schemaSpan(spanStart, item[item.length - 1].end));
            return;
        }
        schemaAddKey(entity, { kind: 'fk', columns: fkCols.names, name: constraintName,
            referenced: ref.target, onDelete: ref.onDelete,
            onUpdate: ref.onUpdate, deferrable: ref.deferrable,
            span: schemaSpan(spanStart, item[item.length - 1].end) });
        return;
    }
    if (u === 'CHECK' || u === 'PERIOD' || u === 'LIKE' || u === 'INHERITS' || u === 'PARTITION' ||
        u === 'DISTRIBUTE' || u === 'ORGANIZE' || u === 'EXCLUDE' || u === 'INDEX' || u === 'KEY' ||
        u === 'FULLTEXT' || u === 'SPATIAL') {
        return;
    }
    schemaParseColumnItem(ctx, entity, item, constraintName);
}
function schemaParseCreateTable(ctx, toks) {
    var i = 1;
    while (i < toks.length && toks[i].type === 'word' &&
        (toks[i].u === 'TEMP' || toks[i].u === 'TEMPORARY' || toks[i].u === 'GLOBAL' ||
            toks[i].u === 'LOCAL' || toks[i].u === 'UNLOGGED' || toks[i].u === 'VIRTUAL'))
        i++;
    if (!toks[i] || toks[i].u !== 'TABLE')
        return false;
    i++;
    if (toks[i] && toks[i].u === 'IF' && toks[i + 1] && toks[i + 1].u === 'NOT' && toks[i + 2] && toks[i + 2].u === 'EXISTS')
        i += 3;
    var id = schemaIdent(toks, i);
    if (!id) {
        schemaIssue(ctx, 'warning', 'schema_unparsed_statement', 'Could not read the table name in a CREATE TABLE statement.', schemaSpan(toks[0].pos, toks[toks.length - 1].end));
        return true;
    }
    var entity = {
        id: schemaNormName(id.parts),
        name: id.parts.join('.'),
        schema: id.parts.length > 1 ? id.parts.slice(0, -1).join('.') : null,
        kind: 'table',
        columns: [],
        keys: [],
        unresolved: false,
        span: schemaSpan(toks[0].pos, id.end)
    };
    if (toks[id.next] && toks[id.next].v === '(') {
        var split = schemaSplitItems(toks, id.next);
        split.items.forEach(function (item) { schemaParseTableItem(ctx, entity, item); });
        if (split.end > 0 && toks[split.end - 1])
            entity.span = schemaSpan(toks[0].pos, toks[split.end - 1].end);
    }
    else {
        schemaIssue(ctx, 'info', 'schema_columns_unknown', 'Columns of "' + entity.name + '" are not declared in this DDL (CTAS or LIKE); the entity is shown without attributes.', schemaSpan(id.start, id.end));
    }
    schemaAddEntity(ctx, entity);
    return true;
}
/* Normalized FROM/JOIN object names inside a view body. Declared evidence
   only, used as a layout hint (views sit downstream of their sources); these
   never create relationship edges. Comma-separated sources are included. */
function schemaViewSources(toks, start) {
    var out = [], seen = {}, i = start;
    function add(id) {
        if (!id)
            return;
        var norm = schemaNormName(id.parts);
        if (norm && !seen[norm]) {
            seen[norm] = 1;
            out.push(norm);
        }
    }
    while (i < toks.length) {
        var t = toks[i];
        if (t.type === 'word' && (t.u === 'FROM' || t.u === 'JOIN')) {
            var id = schemaIdent(toks, i + 1);
            if (id) {
                add(id);
                i = id.next;
                if (t.u === 'FROM') {
                    while (toks[i] && toks[i].v === ',' && toks[i + 1] && toks[i + 1].type === 'word') {
                        var more = schemaIdent(toks, i + 1);
                        if (!more)
                            break;
                        add(more);
                        i = more.next;
                    }
                }
                continue;
            }
        }
        i++;
    }
    return out;
}
function schemaParseCreateView(ctx, toks) {
    var i = 1;
    while (i < toks.length && toks[i].type === 'word' &&
        (toks[i].u === 'OR' || toks[i].u === 'REPLACE' || toks[i].u === 'MATERIALIZED' ||
            toks[i].u === 'TEMP' || toks[i].u === 'TEMPORARY'))
        i++;
    if (!toks[i] || toks[i].u !== 'VIEW')
        return false;
    i++;
    if (toks[i] && toks[i].u === 'IF' && toks[i + 1] && toks[i + 1].u === 'NOT' && toks[i + 2] && toks[i + 2].u === 'EXISTS')
        i += 3;
    var id = schemaIdent(toks, i);
    if (!id) {
        schemaIssue(ctx, 'warning', 'schema_unparsed_statement', 'Could not read the view name in a CREATE VIEW statement.', schemaSpan(toks[0].pos, toks[toks.length - 1].end));
        return true;
    }
    var entity = {
        id: schemaNormName(id.parts),
        name: id.parts.join('.'),
        schema: id.parts.length > 1 ? id.parts.slice(0, -1).join('.') : null,
        kind: 'view',
        columns: [],
        keys: [],
        unresolved: false,
        span: schemaSpan(toks[0].pos, id.end)
    };
    var j = id.next;
    if (toks[j] && toks[j].v === '(') {
        var cols = schemaParseColumns(toks, j);
        if (cols) {
            cols.names.forEach(function (name, ordinal) {
                entity.columns.push({ name: name, type: '', nullable: true, primaryKey: false,
                    unique: false, identity: false, generated: false, computed: false,
                    ordinal: ordinal + 1, span: schemaSpan(toks[j].pos, toks[j].end) });
            });
            j = cols.end;
        }
    }
    if (toks[j] && toks[j].u === 'AS') {
        entity.span = schemaSpan(toks[0].pos, toks[j].end);
        if (!entity.columns.length) {
            schemaIssue(ctx, 'info', 'schema_columns_unknown', 'Columns of view "' + entity.name + '" are not declared in this DDL; the view is shown without attributes.', schemaSpan(id.start, id.end));
        }
        var sources = schemaViewSources(toks, j + 1);
        if (sources.length)
            entity.sources = sources;
    }
    schemaAddEntity(ctx, entity);
    return true;
}
function schemaParseCreateIndex(ctx, toks) {
    var i = 1, unique = false;
    while (i < toks.length && toks[i].type === 'word' &&
        (toks[i].u === 'UNIQUE' || toks[i].u === 'CLUSTERED' || toks[i].u === 'NONCLUSTERED' ||
            toks[i].u === 'COLUMNSTORE')) {
        if (toks[i].u === 'UNIQUE')
            unique = true;
        i++;
    }
    if (!toks[i] || toks[i].u !== 'INDEX')
        return false;
    i++;
    if (toks[i] && toks[i].u === 'IF' && toks[i + 1] && toks[i + 1].u === 'NOT' && toks[i + 2] && toks[i + 2].u === 'EXISTS')
        i += 3;
    var name = schemaIdent(toks, i);
    if (name)
        i = name.next;
    if (!toks[i] || toks[i].u !== 'ON')
        return false;
    var table = schemaIdent(toks, i + 1);
    if (!table)
        return false;
    var cols = [];
    if (toks[table.next] && toks[table.next].v === '(') {
        var parsed = schemaParseColumns(toks, table.next);
        if (parsed)
            cols = parsed.names;
    }
    if (unique && cols.length) {
        ctx.pendingIndexes.push({
            tableNorm: schemaNormName(table.parts),
            tableName: table.parts.join('.'),
            columns: cols,
            name: name ? name.parts.join('.') : undefined,
            span: schemaSpan(toks[0].pos, toks[toks.length - 1].end)
        });
    }
    return true;
}
function schemaParseAlterTable(ctx, toks) {
    if (!toks[1] || toks[1].u !== 'TABLE')
        return false;
    var id = schemaIdent(toks, 2);
    if (!id)
        return false;
    var entity = ctx.byKey[schemaNormName(id.parts)];
    var i = id.next;
    while (i < toks.length) {
        if (toks[i].u !== 'ADD') {
            /* ALTER/DROP/etc. actions do not change the declared entity model. */
            while (i < toks.length && !(toks[i].v === ',' && true))
                i++;
            if (toks[i] && toks[i].v === ',') {
                i++;
                continue;
            }
            break;
        }
        i++;
        if (toks[i] && toks[i].u === 'COLUMN')
            i++;
        /* Collect one ADD item up to the next depth-0 comma. */
        var item = [], depth = 0;
        while (i < toks.length) {
            var t = toks[i];
            if (t.v === '(')
                depth++;
            else if (t.v === ')')
                depth = Math.max(0, depth - 1);
            if (depth === 0 && t.v === ',')
                break;
            item.push(t);
            i++;
        }
        if (!item.length)
            continue;
        if (!entity) {
            schemaIssue(ctx, 'warning', 'schema_alter_unknown_table', 'ALTER TABLE targets "' + id.parts.join('.') + '", which is not defined in this DDL; the change is not applied.', schemaSpan(item[0].pos, item[item.length - 1].end));
            if (toks[i] && toks[i].v === ',')
                i++;
            continue;
        }
        var head = item[0];
        if (head.type === 'word' && (head.u === 'CONSTRAINT' || head.u === 'PRIMARY' ||
            head.u === 'UNIQUE' || head.u === 'FOREIGN' || head.u === 'CHECK')) {
            schemaParseTableItem(ctx, entity, item);
        }
        else {
            schemaParseColumnItem(ctx, entity, item);
        }
        if (toks[i] && toks[i].v === ',')
            i++;
    }
    return true;
}
function schemaParseStatement(ctx, toks) {
    var head = toks[0];
    if (!head || head.type !== 'word') {
        schemaIssue(ctx, 'info', 'schema_ignored_statement', 'Statement is not a schema definition and was ignored.', schemaSpan(head ? head.pos : 0, toks[toks.length - 1].end));
        return;
    }
    if (head.u === 'CREATE') {
        var i = 1;
        if (toks[i] && toks[i].u === 'OR')
            i++;
        if (toks[i] && toks[i].u === 'REPLACE')
            i++;
        if (toks[i] && (toks[i].u === 'INDEX' || toks[i].u === 'UNIQUE')) {
            if (schemaParseCreateIndex(ctx, toks))
                return;
        }
        var kind = toks[i] ? toks[i].u : '';
        if (kind === 'TABLE') {
            schemaParseCreateTable(ctx, toks);
            return;
        }
        if (kind === 'VIEW') {
            schemaParseCreateView(ctx, toks);
            return;
        }
        if (SCHEMA_IGNORED_CREATE[kind])
            return;
        if (kind)
            schemaIssue(ctx, 'info', 'schema_ignored_statement', 'CREATE ' + kind + ' is not part of the ERD schema model and was ignored.', schemaSpan(head.pos, toks[toks.length - 1].end));
        return;
    }
    if (head.u === 'ALTER') {
        if (schemaParseAlterTable(ctx, toks))
            return;
        return;
    }
    /* SET / USE / GO / INSERT / … are outside the schema model. */
}
/* Apply pending UNIQUE INDEX declarations once every entity is known. */
function schemaApplyIndexes(ctx) {
    ctx.pendingIndexes.forEach(function (index) {
        var entity = ctx.byKey[index.tableNorm];
        if (!entity)
            return; /* defined nowhere; not an ERD claim */
        if (entity.unresolved)
            return;
        entity.keys.push({ kind: 'unique', columns: index.columns, name: index.name,
            span: index.span });
        schemaMarkUnique(entity, index.columns);
    });
}
/* True when the referencing column set is covered by any declared primary or
   unique key (a unique key whose columns are a subset makes the FK rows
   unique, so the relationship is one-to-one). */
function schemaForeignKeyIsUnique(entity, fkColumns) {
    var fk = fkColumns.map(schemaNormColumn);
    if (!fk.length)
        return false;
    return entity.keys.some(function (key) {
        if (key.kind === 'fk' || !key.columns.length)
            return false;
        var keyCols = key.columns.map(schemaNormColumn);
        return keyCols.every(function (c) { return fk.indexOf(c) >= 0; });
    });
}
function schemaEnsureExternal(ctx, ref, span) {
    var id = 'external:' + ref.norm;
    if (ctx.byKey[id])
        return ctx.byKey[id];
    var entity = {
        id: id,
        name: ref.name,
        schema: null,
        kind: 'table',
        columns: [],
        keys: [],
        unresolved: true,
        span: span
    };
    ctx.byKey[id] = entity;
    ctx.entities.push(entity);
    return entity;
}
/* Resolve every FOREIGN KEY against the defined entities and derive
   relationships. Exact full-name matches win; a unique last-part match is a
   labelled heuristic; anything else stays an explicit external entity. */
function schemaResolve(ctx) {
    var relationships = [], relIndex = 0;
    ctx.entities.slice().forEach(function (entity) {
        if (entity.unresolved)
            return;
        entity.keys.forEach(function (key) {
            if (key.kind !== 'fk' || !key.referenced)
                return;
            var ref = key.referenced;
            var target = ctx.byKey[ref.norm];
            var resolution = 'opaque';
            if (target) {
                resolution = 'exact';
            }
            else {
                var last = schemaNormColumn(ref.norm.split('.').pop() || '');
                var candidates = ctx.entities.filter(function (candidate) {
                    if (candidate.unresolved)
                        return false;
                    var parts = candidate.id.split('.');
                    return parts[parts.length - 1] === last;
                });
                if (candidates.length === 1) {
                    target = candidates[0];
                    resolution = 'heuristic';
                    schemaIssue(ctx, 'warning', 'schema_unresolved_reference', 'Foreign key on "' + entity.name + '" references "' + ref.name + '"; resolved by name only to "' +
                        target.name + '" — verify schema qualification.', key.span);
                }
                else if (candidates.length > 1) {
                    schemaIssue(ctx, 'warning', 'schema_ambiguous_reference', 'Foreign key on "' + entity.name + '" references "' + ref.name + '", which matches ' + candidates.length +
                        ' tables; the relationship is not drawn.', key.span);
                    return;
                }
            }
            if (!target) {
                target = schemaEnsureExternal(ctx, ref, key.span);
                schemaIssue(ctx, 'warning', 'schema_unresolved_reference', 'Foreign key on "' + entity.name + '" references "' + ref.name + '", which is not defined in this DDL; shown as an unresolved entity.', key.span);
            }
            ref.entityId = target.id;
            ref.resolution = resolution;
            var unique = schemaForeignKeyIsUnique(entity, key.columns);
            var optional = key.columns.some(function (name) {
                var col = entity.columns.filter(function (c) { return schemaNormColumn(c.name) === schemaNormColumn(name); })[0];
                return !col || col.nullable;
            });
            var fromColumns = ref.columns.length ? ref.columns : target.keys
                .filter(function (k) { return k.kind === 'pk'; })
                .map(function (k) { return k.columns; })[0] || [];
            relationships.push({
                id: 'rel:' + (relIndex++),
                fromId: target.id,
                toId: entity.id,
                fromColumns: fromColumns,
                toColumns: key.columns,
                cardinality: unique ? 'one-to-one' : 'one-to-many',
                optional: optional,
                unique: unique,
                name: key.name,
                resolution: resolution,
                span: key.span
            });
        });
    });
    return relationships;
}
function schemaStats(result) {
    var tables = 0, views = 0, columns = 0, unresolved = 0;
    result.entities.forEach(function (entity) {
        if (entity.unresolved)
            unresolved++;
        else if (entity.kind === 'view')
            views++;
        else
            tables++;
        columns += entity.columns.length;
    });
    return { tables: tables, views: views, columns: columns,
        relationships: result.relationships.length, unresolved: unresolved };
}
/* Parse DDL text into the schema model. Declared constraints only. */
function parseSchema(text) {
    var source = String(text == null ? '' : text);
    var toks = tokenize(source);
    var ctx = { text: source, entities: [], byKey: {},
        diagnostics: (toks.diagnostics || []).slice(),
        pendingIndexes: [] };
    if (source.trim()) {
        schemaStatements(toks).forEach(function (statement) {
            schemaParseStatement(ctx, statement);
        });
        schemaApplyIndexes(ctx);
    }
    else {
        ctx.diagnostics.push({ severity: 'info', code: 'schema_empty',
            message: 'Paste or import DDL to draw an entity relationship diagram.',
            span: null, scope: 'document' });
    }
    var relationships = schemaResolve(ctx);
    var result = { text: source, entities: ctx.entities,
        relationships: relationships,
        diagnostics: ctx.diagnostics, stats: null };
    result.stats = schemaStats(result);
    return result;
}
//# sourceMappingURL=schema.js.map