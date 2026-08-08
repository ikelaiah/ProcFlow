"use strict";
/* ===== v1.9.0 Resolve by catalogue (README post-v1.0.0 item 5) =====
   Accepts table/view/column catalogue metadata (pasted or imported) so
   unmatched object references resolve to their exact identity instead of a
   conservative v1.5.0 'external' label.

   Only full-name and explicit-synonym matches count as 'verified'. Partial
   (suffix-only) and conflicting evidence stays conservative and is reported
   with a region-scoped diagnostic: it is never inferred into a verification.
   Column metadata is accepted and validated now; column lineage uses it in a
   later release. */
var CATALOGUE_KINDS = S(['TABLE', 'VIEW', 'PROC', 'PROCEDURE', 'FUNCTION',
    'TRIGGER', 'SYNONYM', 'TYPE', 'SEQUENCE']);
function normalizeCatalogueName(name) {
    return String(name == null ? '' : name)
        .replace(/[\[\]"]/g, '').replace(/`/g, '')
        .trim().toUpperCase().replace(/\s+/g, ' ');
}
function normalizeCatalogueKind(kind) {
    var k = String(kind == null ? '' : kind).trim().toUpperCase();
    if (k === 'PROCEDURE')
        return 'PROC';
    if (['TABLE', 'VIEW', 'PROC', 'FUNCTION', 'TRIGGER', 'SYNONYM', 'TYPE', 'SEQUENCE']
        .indexOf(k) >= 0)
        return k;
    return 'OTHER';
}
/* Build normalized lookup indexes and record conflicting catalogue entries.
   A conflict is a duplicate normalized object name, or a synonym that collides
   with another object's name or synonym — evidence that is too ambiguous to
   verify against, so resolution of that name stays conservative. */
function buildCatalogueIndex(objects, columns) {
    var byName = {}, bySynonym = {}, conflicts = {};
    (objects || []).forEach(function (o) {
        var n = normalizeCatalogueName(o.name);
        if (!n)
            return;
        var priorName = byName[n], priorSyn = bySynonym[n];
        if (priorName || priorSyn) {
            conflicts[n] = 1;
            return;
        }
        byName[n] = o;
        (o.synonyms || []).forEach(function (raw) {
            var sn = normalizeCatalogueName(raw);
            if (!sn)
                return;
            if ((bySynonym[sn] && bySynonym[sn] !== o) || byName[sn]) {
                conflicts[sn] = 1;
                return;
            }
            bySynonym[sn] = o;
        });
    });
    return { objects: objects || [], columns: columns || [],
        byName: byName, bySynonym: bySynonym, conflicts: conflicts };
}
/* Resolve a referenced object name against the catalogue. Exact full-name and
   explicit-synonym matches are 'verified'; a conflicting name is 'conflict'
   (conservative); otherwise 'external' (unproven, v1.5.0 label retained). */
function resolveCatalogue(cat, name) {
    if (!cat || !(cat.objects && cat.objects.length))
        return { resolution: 'external' };
    var n = normalizeCatalogueName(name);
    if (!n)
        return { resolution: 'external' };
    if (cat.conflicts[n] === 1)
        return { resolution: 'conflict' };
    var exact = cat.byName[n];
    if (exact)
        return { resolution: 'verified', resolvedName: exact.name };
    var syn = cat.bySynonym[n];
    if (syn)
        return { resolution: 'verified', resolvedName: syn.name };
    return { resolution: 'external' };
}
/* Conservative near-match candidates: catalogue objects the reference could
   partially reach (the referenced name carries extra leading server/schema
   parts over a catalogue object, sharing the same trailing identity). These
   are NOT verified — they are reported so a reviewer knows a plausible but
   unproven candidate existed instead of silently staying external. */
function suffixCatalogueMatches(cat, name) {
    if (!cat || !name)
        return [];
    var n = normalizeCatalogueName(name), out = [], seen = {};
    (cat.objects || []).forEach(function (o) {
        var on = normalizeCatalogueName(o.name);
        if (!on || on === n)
            return;
        if (on.length >= n.length)
            return;
        if (n.charAt(n.length - on.length - 1) === '.' &&
            n.slice(n.length - on.length) === on) {
            var key = '#' + o.name.toUpperCase() + ':' + o.kind;
            if (!seen[key]) {
                seen[key] = 1;
                out.push(o.name);
            }
        }
    });
    return out.slice(0, 8);
}
/* Parse a catalogue from text. Accepts either:
     - JSON: {objects:[{name,kind,synonyms[]}], columns:[{table,name}]}
              or a bare array of {name,...} / string names;
     - a simple line format (one object per line):
         # comment
         <object-name> [KIND] [synonym1, synonym2 …]
         COL <table-name>.<column-name>
   Returns a CatalogueParseResult with any parse/conflict diagnostics. */
function parseCatalogue(text, format) {
    var src = String(text == null ? '' : text);
    var trimmed = src.trim();
    var fmt = format ||
        ((trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') ? 'json' : 'text');
    var diagnostics = [];
    var objects = [], columns = [];
    if (fmt === 'json') {
        var raw;
        try {
            raw = JSON.parse(trimmed);
        }
        catch (e) {
            diagnostics.push({ severity: 'error', code: 'catalogue_parse_error',
                message: 'Catalogue JSON could not be parsed: ' + (e instanceof Error ? e.message : String(e)),
                span: null, scope: 'document' });
            return { catalogue: buildCatalogueIndex(objects, columns), diagnostics: diagnostics,
                format: 'json', objectCount: 0, columnCount: 0 };
        }
        if (!raw || typeof raw !== 'object')
            raw = [];
        var list = Array.isArray(raw) ? raw : (Array.isArray(raw.objects) ? raw.objects : []);
        var colList = Array.isArray(raw) ? [] : (Array.isArray(raw.columns) ? raw.columns : []);
        var objSeen = {};
        (list || []).forEach(function (entry) {
            if (typeof entry === 'string') {
                objects.push({ name: entry, kind: 'OTHER', synonyms: [] });
                return;
            }
            if (!entry || typeof entry !== 'object' || !entry.name)
                return;
            var norm = normalizeCatalogueName(entry.name);
            if (objSeen[norm])
                return;
            objSeen[norm] = 1;
            var syns = [];
            if (Array.isArray(entry.synonyms))
                entry.synonyms.forEach(function (s) { syns.push(String(s)); });
            else if (typeof entry.synonyms === 'string' && entry.synonyms)
                syns.push(entry.synonyms);
            objects.push({ name: String(entry.name), kind: normalizeCatalogueKind(entry.kind), synonyms: syns });
        });
        (colList || []).forEach(function (c) {
            if (c && c.table && c.name)
                columns.push({ table: String(c.table), name: String(c.name),
                    kind: normalizeCatalogueKind(c.kind) });
        });
    }
    else {
        src.split(/\r?\n/).forEach(function (line) {
            var l = line.trim();
            if (!l || l.charAt(0) === '#' || l.indexOf('//') === 0)
                return;
            var upper = l.toUpperCase();
            if (upper.indexOf('COL ') === 0 || upper.indexOf('COLUMN ') === 0) {
                var cparts = l.split(/\s+/).slice(1).join('').split('.');
                var colName = cparts.pop() || '';
                columns.push({ table: cparts.join('.'), name: colName, kind: 'OTHER' });
                return;
            }
            var toks = l.split(/[\s,]+/).filter(function (t) { return t.length > 0; });
            if (!toks.length)
                return;
            var name = toks[0], kind = 'OTHER', syns = [];
            var ci = 1;
            if (toks[ci] && CATALOGUE_KINDS[toks[ci].toUpperCase()] === 1) {
                kind = normalizeCatalogueKind(toks[ci]);
                ci++;
            }
            for (; ci < toks.length; ci++)
                syns.push(toks[ci]);
            objects.push({ name: name, kind: kind, synonyms: syns });
        });
    }
    var cat = buildCatalogueIndex(objects, columns);
    Object.keys(cat.conflicts).forEach(function (norm) {
        diagnostics.push({ severity: 'warning', code: 'catalogue_conflict',
            message: 'Conflicting catalogue entries for "' +
                (cat.byName[norm] ? cat.byName[norm].name : norm) + '": metadata is ambiguous, so references to it stay unresolved. ' +
                'Remove the duplicate or ambiguous synonym to verify against it.',
            span: null, scope: 'document' });
    });
    if (!objects.length && !columns.length && fmt === 'text')
        diagnostics.push({ severity: 'warning', code: 'catalogue_empty',
            message: 'No catalogue objects were parsed. Check the format (one object per line, or JSON).',
            span: null, scope: 'document' });
    return { catalogue: cat, diagnostics: diagnostics, format: fmt,
        objectCount: objects.length, columnCount: columns.length };
}
/* Short human-readable summary used by the catalogue status panel. */
function catalogueSummary(cat) {
    if (!cat)
        return 'No catalogue loaded.';
    var n = cat.objects.length, c = cat.columns.length, conf = Object.keys(cat.conflicts || {}).length;
    var bits = [n + ' object' + (n === 1 ? '' : 's')];
    if (c)
        bits.push(c + ' column' + (c === 1 ? '' : 's'));
    if (conf)
        bits.push(conf + ' conflict' + (conf === 1 ? '' : 's'));
    return bits.join(', ');
}
//# sourceMappingURL=catalogue.js.map