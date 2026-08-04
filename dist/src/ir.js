"use strict";
/* proc>flow: graph construction and shared intermediate representation */
/* ---------- label helpers ---------- */
function joinToks(toks, max) {
    var s = '';
    for (var i = 0; i < toks.length; i++) {
        var v = toks[i].v, prev = i ? toks[i - 1].v : '';
        var noSpace = i === 0 || v === ',' || v === ')' || v === '.' || v === ';' || v === '::'
            || prev === '(' || prev === '.' || prev === '::'
            || (v === '(' && toks[i - 1].type === 'word' && !CONT_M[toks[i - 1].u]);
        if (!noSpace && (prev === '-' || prev === '+')) {
            var pp = i >= 2 ? toks[i - 2] : null;
            if (!pp || (pp.type === 'op' && pp.v !== ')') ||
                (pp.type === 'word' && ['RETURN', 'THROW', 'WHEN', 'THEN', 'ELSE', 'BY', 'TOP'].indexOf(pp.u) >= 0))
                noSpace = true;
        }
        s += (noSpace ? '' : ' ') + v;
        if (max && s.length > max + 40)
            break;
    }
    return s.trim();
}
function spanOfTokens(toks) {
    if (!toks || !toks.length)
        return null;
    return { start: toks[0].pos, end: toks[toks.length - 1].end };
}
var PG_ERROR_CODES = {
    RAISE_EXCEPTION: 'P0001', NO_DATA_FOUND: 'P0002', TOO_MANY_ROWS: 'P0003',
    ASSERT_FAILURE: 'P0004', QUERY_CANCELED: '57014',
    DIVISION_BY_ZERO: '22012', NUMERIC_VALUE_OUT_OF_RANGE: '22003',
    INVALID_TEXT_REPRESENTATION: '22P02',
    INTEGRITY_CONSTRAINT_VIOLATION: '23000', RESTRICT_VIOLATION: '23001',
    NOT_NULL_VIOLATION: '23502', FOREIGN_KEY_VIOLATION: '23503',
    UNIQUE_VIOLATION: '23505', CHECK_VIOLATION: '23514',
    EXCLUSION_VIOLATION: '23P01'
};
function pgErrorFromRaise(toks) {
    if (!toks.length || toks[0].u !== 'RAISE' || toks.length === 1)
        return null;
    var first = toks[1];
    if (first.u === 'SQLSTATE' && toks[2])
        return { name: '', code: toks[2].v.replace(/^'/, '').replace(/'$/, '').toUpperCase() };
    if (first.u === 'EXCEPTION' || first.u === 'USING' || first.type !== 'word')
        return { name: 'RAISE_EXCEPTION', code: 'P0001' };
    return { name: first.u, code: PG_ERROR_CODES[first.u] || '' };
}
function pgHandlerAlternatives(cond) {
    var out = [[]], depth = 0;
    (cond || []).forEach(function (tok) {
        if (tok.v === '(')
            depth++;
        else if (tok.v === ')')
            depth--;
        if (tok.u === 'OR' && depth === 0)
            out.push([]);
        else
            out[out.length - 1].push(tok);
    });
    return out;
}
function pgHandlerMatches(cond, error) {
    return pgHandlerAlternatives(cond).some(function (part) {
        if (!part.length)
            return false;
        var name = part[0].u;
        if (name === 'OTHERS')
            return ['ASSERT_FAILURE', 'QUERY_CANCELED'].indexOf(error.name) < 0 &&
                ['P0004', '57014'].indexOf(error.code) < 0;
        var code = name === 'SQLSTATE' && part[1]
            ? part[1].v.replace(/^'/, '').replace(/'$/, '').toUpperCase()
            : (PG_ERROR_CODES[name] || '');
        if (error.name && name === error.name)
            return true;
        if (!code || !error.code)
            return false;
        return code === error.code ||
            (code.length === 5 && code.slice(2) === '000' && code.slice(0, 2) === error.code.slice(0, 2));
    });
}
function pgHandlerHasOthers(cond) {
    return pgHandlerAlternatives(cond).some(function (part) {
        return !!part.length && part[0].u === 'OTHERS';
    });
}
function pgTransactionAssessment(toks, headerKind, inExceptionScope) {
    if (!toks.length)
        return null;
    var head = toks[0].u;
    if (['COMMIT', 'ROLLBACK', 'SAVE', 'SAVEPOINT', 'RELEASE', 'BEGIN', 'START'].indexOf(head) < 0)
        return null;
    var savepoint = head === 'SAVE' || head === 'SAVEPOINT' || head === 'RELEASE' ||
        (head === 'ROLLBACK' && toks.some(function (tok) { return tok.u === 'TO'; }));
    if (savepoint)
        return {
            invalid: true,
            label: 'invalid: PL/pgSQL does not support savepoints',
            code: 'plpgsql_savepoint_unsupported',
            severity: 'error',
            message: 'PL/pgSQL does not support SAVEPOINT, ROLLBACK TO SAVEPOINT, or RELEASE SAVEPOINT; use a block with EXCEPTION instead.'
        };
    if (head === 'BEGIN' || head === 'START')
        return {
            invalid: true,
            label: 'invalid: transactions start automatically',
            code: 'plpgsql_transaction_start_unsupported',
            severity: 'error',
            message: 'PL/pgSQL has no separate transaction-start command; BEGIN starts a block and transactions begin automatically after eligible COMMIT or ROLLBACK.'
        };
    if (inExceptionScope)
        return {
            invalid: true,
            label: 'invalid inside EXCEPTION subtransaction',
            code: 'plpgsql_transaction_in_exception_scope',
            severity: 'error',
            message: 'Transaction control is not allowed inside a block with EXCEPTION because that block forms a subtransaction.'
        };
    var kind = String(headerKind || '').toUpperCase();
    if (kind !== 'PROCEDURE' && kind !== 'PROC' && kind !== 'DO')
        return {
            invalid: true,
            label: 'invalid: requires eligible CALL or DO context',
            code: 'plpgsql_transaction_context',
            severity: 'error',
            message: 'Transaction control is only allowed in procedures reached through an eligible CALL chain or in DO blocks.'
        };
    if (kind === 'DO')
        return {
            invalid: false,
            label: 'eligible DO transaction control',
            code: null,
            severity: null,
            message: ''
        };
    return {
        invalid: false,
        label: 'requires eligible CALL context',
        code: 'plpgsql_transaction_context_required',
        severity: 'warning',
        message: 'Transaction control in a procedure requires an uninterrupted top-level or nested CALL/DO invocation chain; an intervening command makes it invalid.'
    };
}
function addPgTransactionDiagnostics(list, header, diagnostics, inExceptionScope) {
    (list || []).forEach(function (st) {
        if (st.type === 'stmt') {
            var assessment = pgTransactionAssessment(st.toks, header.kind || '', inExceptionScope === true);
            if (assessment && assessment.code && assessment.severity)
                diagnostics.push({
                    severity: assessment.severity,
                    code: assessment.code,
                    message: assessment.message,
                    span: spanOfTokens(st.toks)
                });
        }
        if (st.type === 'block')
            addPgTransactionDiagnostics(st.body, header, diagnostics, inExceptionScope);
        else if (st.type === 'if') {
            if (st.then)
                addPgTransactionDiagnostics([st.then], header, diagnostics, inExceptionScope);
            if (st.else)
                addPgTransactionDiagnostics([st.else], header, diagnostics, inExceptionScope);
        }
        else if (st.type === 'case') {
            st.branches.forEach(function (branch) {
                addPgTransactionDiagnostics(branch.body, header, diagnostics, inExceptionScope);
            });
            if (st.else)
                addPgTransactionDiagnostics(st.else, header, diagnostics, inExceptionScope);
        }
        else if ((st.type === 'while' || st.type === 'for' || st.type === 'loop' ||
            st.type === 'repeat') && st.body)
            addPgTransactionDiagnostics([st.body], header, diagnostics, inExceptionScope);
        else if (st.type === 'try') {
            addPgTransactionDiagnostics(st.body, header, diagnostics, true);
            st.handlers.forEach(function (handler) {
                addPgTransactionDiagnostics(handler.body, header, diagnostics, true);
            });
        }
        else if (st.type === 'handler' && st.body)
            addPgTransactionDiagnostics([st.body], header, diagnostics, inExceptionScope);
    });
}
function clip(s, max) { return s.length > max ? s.slice(0, max - 1).trim() + '…' : s; }
function qname(toks, i) {
    if (!toks[i])
        return '';
    var s = toks[i].v, k = i + 1;
    while (toks[k] && toks[k].v === '.' && toks[k + 1]) {
        s += '.' + toks[k + 1].v;
        k += 2;
    }
    return s;
}
function summarise(toks, max) {
    var u = function (i) { return toks[i] ? toks[i].u : ''; };
    var v = function (i) { return qname(toks, i); };
    var head = u(0), out = null, i;
    if (head === 'INSERT' || head === 'REPLACE') {
        i = 1;
        while (['INTO', 'OR', 'IGNORE', 'REPLACE'].indexOf(u(i)) >= 0)
            i++;
        out = 'INSERT INTO ' + v(i);
    }
    else if (head === 'UPDATE') {
        i = u(1) === 'TOP' ? 3 : (u(1) === 'OR' ? 3 : 1);
        out = 'UPDATE ' + v(i);
    }
    else if (head === 'DELETE') {
        i = u(1) === 'FROM' ? 2 : 1;
        out = 'DELETE FROM ' + v(i);
    }
    else if (head === 'MERGE') {
        i = u(1) === 'INTO' ? 2 : 1;
        out = 'MERGE ' + v(i);
    }
    else if (head === 'EXEC' || head === 'EXECUTE' || head === 'CALL' || head === 'PERFORM') {
        i = 1;
        if (v(1) && v(1).charAt(0) === '@' && toks[2] && toks[2].v === '=')
            i = 3;
        out = (head === 'PERFORM' ? 'PERFORM ' : (head === 'CALL' ? 'CALL ' : 'EXEC ')) + v(i);
    }
    else if (head === 'SELECT') {
        var into = -1, from = -1, d = 0;
        for (var k = 0; k < toks.length; k++) {
            if (toks[k].v === '(')
                d++;
            else if (toks[k].v === ')')
                d--;
            else if (d === 0 && toks[k].u === 'INTO' && into < 0)
                into = k;
            else if (d === 0 && toks[k].u === 'FROM' && from < 0)
                from = k;
        }
        if (into >= 0)
            out = 'SELECT … INTO ' + v(into + 1);
        else if (v(1) && v(1).charAt(0) === '@')
            out = clip(joinToks(toks.slice(0, from > 0 ? from : 6)), max);
        else if (from >= 0)
            out = 'SELECT … FROM ' + v(from + 1);
    }
    else if (head === 'DECLARE') {
        var cursor = -1;
        for (var c = 2; c < toks.length; c++)
            if (u(c) === 'CURSOR') {
                cursor = c;
                break;
            }
        if (cursor >= 0)
            out = 'DECLARE CURSOR ' + v(1);
        var vars = [];
        for (var j = 1; j < toks.length && vars.length < 4; j++)
            if (toks[j].v.charAt(0) === '@' && (j === 1 || toks[j - 1].v === ','))
                vars.push(toks[j].v);
        if (!out && vars.length)
            out = 'DECLARE ' + vars.join(', ') + (vars.length > 3 ? ' …' : '');
    }
    else if (head === 'RAISE' || head === 'SIGNAL' || head === 'RESIGNAL' || head === 'RAISERROR') {
        out = clip(joinToks(toks, max), max);
    }
    if (!out)
        out = joinToks(toks, max);
    return clip(out, max);
}
function escLabel(s) {
    return String(s)
        .replace(/#/g, '#35;')
        .replace(/&/g, '#amp;')
        .replace(/"/g, '#quot;')
        .replace(/</g, '#lt;')
        .replace(/>/g, '#gt;')
        .replace(/\|/g, '#124;')
        .replace(/%%/g, '#37;#37;')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\u0001/g, '<BR>')
        .replace(/\s+/g, ' ');
}
var TSQL_XACT_UNCOMMITTABLE = 1, TSQL_XACT_NONE = 2, TSQL_XACT_COMMITTABLE = 4, TSQL_XACT_ALL = 7;
function tsqlSignedStateAt(toks, start, end) {
    var sign = 1, i = start;
    if (i < end && (toks[i].v === '-' || toks[i].v === '+')) {
        if (toks[i].v === '-')
            sign = -1;
        i++;
    }
    if (i >= end || toks[i].type !== 'num' || !/^\d+$/.test(toks[i].v))
        return null;
    return { value: sign * parseInt(toks[i].v, 10), next: i + 1 };
}
function tsqlXactFunctionAt(toks, start, end) {
    return start + 2 < end && toks[start].u === 'XACT_STATE' &&
        toks[start + 1].v === '(' && toks[start + 2].v === ')';
}
function tsqlXactStateTest(toks) {
    var start = 0, end = toks.length, changed = true;
    while (changed && end - start >= 2 && toks[start].v === '(' && toks[end - 1].v === ')') {
        changed = false;
        var depth = 0;
        for (var w = start; w < end; w++) {
            if (toks[w].v === '(')
                depth++;
            else if (toks[w].v === ')')
                depth--;
            if (depth === 0) {
                if (w === end - 1) {
                    start++;
                    end--;
                    changed = true;
                }
                break;
            }
        }
    }
    var op = '', state = null;
    if (tsqlXactFunctionAt(toks, start, end) && start + 3 < end) {
        op = toks[start + 3].v;
        state = tsqlSignedStateAt(toks, start + 4, end);
        if (!state || state.next !== end)
            return null;
    }
    else {
        state = tsqlSignedStateAt(toks, start, end);
        if (!state || state.next >= end)
            return null;
        op = toks[state.next].v;
        if (!tsqlXactFunctionAt(toks, state.next + 1, end) || state.next + 4 !== end)
            return null;
    }
    if (['=', '<>', '!='].indexOf(op) < 0 ||
        [-1, 0, 1].indexOf(state.value) < 0)
        return null;
    var bit = state.value === -1 ? TSQL_XACT_UNCOMMITTABLE :
        (state.value === 0 ? TSQL_XACT_NONE : TSQL_XACT_COMMITTABLE);
    var equal = op === '=';
    var description = state.value === -1 ? 'uncommittable' :
        (state.value === 0 ? 'no active transaction' : 'committable');
    var question = !equal && state.value === 0
        ? 'transaction active?'
        : (equal ? description + '?' : 'not ' + description + '?');
    return {
        text: clip(joinToks(toks, 42), 42) + ' · ' + question,
        trueStates: equal ? bit : (TSQL_XACT_ALL ^ bit),
        falseStates: equal ? (TSQL_XACT_ALL ^ bit) : bit
    };
}
function tsqlTranCountTest(toks) {
    var start = 0, end = toks.length, changed = true;
    while (changed && end - start >= 2 && toks[start].v === '(' && toks[end - 1].v === ')') {
        changed = false;
        var depth = 0;
        for (var w = start; w < end; w++) {
            if (toks[w].v === '(')
                depth++;
            else if (toks[w].v === ')')
                depth--;
            if (depth === 0) {
                if (w === end - 1) {
                    start++;
                    end--;
                    changed = true;
                }
                break;
            }
        }
    }
    var op = '', value = null, countFirst = false;
    if (toks[start] && toks[start].u === '@@TRANCOUNT' && start + 2 < end) {
        op = toks[start + 1].v;
        value = tsqlSignedStateAt(toks, start + 2, end);
        countFirst = true;
    }
    else {
        value = tsqlSignedStateAt(toks, start, end);
        if (value && value.next + 1 < end && toks[value.next + 1].u === '@@TRANCOUNT') {
            op = toks[value.next].v;
            if (value.next + 2 !== end)
                return null;
        }
    }
    if (!value || value.value < 0 ||
        ['=', '<>', '!=', '>', '>=', '<', '<='].indexOf(op) < 0)
        return null;
    if (!countFirst) {
        var reversed = {
            '=': '=', '<>': '<>', '!=': '!=', '>': '<', '>=': '<=', '<': '>', '<=': '>='
        };
        op = reversed[op];
    }
    else if (value.next !== end)
        return null;
    var n = value.value, any = { min: 0, max: null };
    var trueDepth = any, falseDepth = any;
    if (op === '=') {
        trueDepth = { min: n, max: n };
        falseDepth = n === 0 ? { min: 1, max: null } : any;
    }
    else if (op === '<>' || op === '!=') {
        trueDepth = n === 0 ? { min: 1, max: null } : any;
        falseDepth = { min: n, max: n };
    }
    else if (op === '>') {
        trueDepth = { min: n + 1, max: null };
        falseDepth = { min: 0, max: n };
    }
    else if (op === '>=') {
        trueDepth = { min: n, max: null };
        falseDepth = { min: 0, max: n - 1 };
    }
    else if (op === '<') {
        trueDepth = { min: 0, max: n - 1 };
        falseDepth = { min: n, max: null };
    }
    else {
        trueDepth = { min: 0, max: n };
        falseDepth = { min: n + 1, max: null };
    }
    var question = n === 0 && (op === '=')
        ? 'no active transaction?'
        : (n === 0 && (op === '>' || op === '<>' || op === '!=')
            ? 'transaction active?'
            : (n === 1 && op === '>' ? 'nested transaction?' : 'transaction depth?'));
    return {
        text: clip(joinToks(toks, 42), 42) + ' · ' + question,
        trueDepth: trueDepth,
        falseDepth: falseDepth
    };
}
/* ---------- graph builder ---------- */
function buildGraph(ast, header, opts) {
    opts = opts || {};
    var detail = opts.detail || 'summary', group = opts.group !== false;
    var dialect = opts.dialect || 'tsql';
    var fanIn = opts.fanIn === true, number = opts.number === true;
    var guarded = {}; /* nodes already wired to an inner handler */
    var unreachable = {}; /* parsed nodes with no incoming control path */
    var PROTECTABLE = ['stmt', 'io', 'call', 'tran', 'cursor', 'opaque'];
    var HANDLER_SOURCES = ['stmt', 'io', 'call', 'tran', 'cursor', 'opaque', 'cond', 'loop'];
    var handlerWires = {}, handlerProcessed = {};
    var db2Handlers = [];
    var pgErrors = {};
    var maxLen = detail === 'full' ? 110 : 52;
    var nodes = [], edges = [], seq = 0;
    var stats = { stmt: 0, branch: 0, loop: 0, cat: 0, exit: 0, depth: 0, opaque: 0 };
    var labels = {}, gotos = [];
    var constructCounts = {};
    function edgeKindFor(cls, style) {
        if (style === 'dotted')
            return 'exception';
        if (cls === 'call')
            return 'call';
        if (cls === 'io' || cls === 'src')
            return 'data';
        return 'control';
    }
    function add(shape, text, cls, source) {
        var id = 'n' + (++seq);
        nodes.push({ id: id, shape: shape, text: (text && String(text).trim()) || '…',
            cls: cls, source: source || null,
            provenance: source ? 'source' : 'synthetic' });
        return id;
    }
    function link(from, to, label, style) {
        if (!from || !to)
            return;
        var fromNode = nodes.filter(function (n) { return n.id === from; })[0];
        var kind = fromNode ? edgeKindFor(fromNode.cls, style || 'solid') : 'control';
        edges.push({ from: from, to: to, label: label || '', style: style || 'solid', kind: kind });
    }
    function trackConstruct(kind, resolved, opaque) {
        var c = constructCounts[kind] = constructCounts[kind] || { detected: 0, resolved: 0, opaque: 0 };
        c.detected++;
        if (opaque)
            c.opaque++;
        else if (resolved)
            c.resolved++;
    }
    function joinExits(exits, to) {
        for (var i = 0; i < exits.length; i++)
            link(exits[i].id, to, exits[i].label);
    }
    function textOf(st) {
        return detail === 'full' ? clip(joinToks(st.toks, maxLen), maxLen) : summarise(st.toks, maxLen);
    }
    function kindOf(st) {
        var h = st.toks && st.toks[0] ? st.toks[0].u : '';
        if (h === 'RAISERROR') {
            var severity = staticRaiserrorSeverity(st.toks);
            if (severity !== null && severity <= 10)
                return 'notice';
        }
        if (h === 'RAISE' && st.toks[1] &&
            ['NOTICE', 'WARNING', 'INFO', 'DEBUG', 'LOG'].indexOf(st.toks[1].u) >= 0)
            return 'notice';
        if (['FETCH', 'OPEN', 'CLOSE', 'ALLOCATE', 'DEALLOCATE'].indexOf(h) >= 0)
            return 'cursor';
        if (h === 'DECLARE' && st.toks.some(function (tok) { return tok.u === 'CURSOR'; }))
            return 'cursor';
        if (['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'TRUNCATE', 'REPLACE', 'COPY'].indexOf(h) >= 0)
            return 'io';
        if (['EXEC', 'EXECUTE', 'CALL', 'PERFORM'].indexOf(h) >= 0)
            return 'call';
        if (['COMMIT', 'ROLLBACK', 'SAVE', 'SAVEPOINT', 'RELEASE', 'BEGIN', 'START'].indexOf(h) >= 0)
            return 'tran';
        return 'stmt';
    }
    function currentXactStates(ctx) {
        while (ctx) {
            if (ctx.xactStates !== undefined)
                return ctx.xactStates;
            ctx = ctx.parent;
        }
        return TSQL_XACT_ALL;
    }
    function currentTranDepth(ctx) {
        while (ctx) {
            if (ctx.tranDepth !== undefined)
                return ctx.tranDepth;
            ctx = ctx.parent;
        }
        return { min: 0, max: null };
    }
    function currentXactAbort(ctx) {
        while (ctx) {
            if (ctx.xactAbort !== undefined)
                return ctx.xactAbort;
            ctx = ctx.parent;
        }
        return undefined;
    }
    function currentSavepoints(ctx) {
        while (ctx) {
            if (ctx.savepoints !== undefined)
                return ctx.savepoints;
            ctx = ctx.parent;
        }
        return {};
    }
    function currentPgSubtransaction(ctx) {
        while (ctx) {
            if (ctx.pgSubtransaction)
                return true;
            ctx = ctx.parent;
        }
        return false;
    }
    function withTsqlState(ctx, states, tranDepth) {
        return { parent: ctx, handlers: [], handlerExits: [],
            xactStates: states, tranDepth: tranDepth };
    }
    function xactStatesLabel(states) {
        if (states === TSQL_XACT_UNCOMMITTABLE)
            return '-1 · uncommittable';
        if (states === TSQL_XACT_NONE)
            return '0 · no transaction';
        if (states === TSQL_XACT_COMMITTABLE)
            return '1 · committable';
        if (states === (TSQL_XACT_UNCOMMITTABLE | TSQL_XACT_COMMITTABLE))
            return 'active · commit status unknown';
        if (states === (TSQL_XACT_NONE | TSQL_XACT_COMMITTABLE))
            return 'not uncommittable';
        if (states === (TSQL_XACT_UNCOMMITTABLE | TSQL_XACT_NONE))
            return 'not committable';
        return states === 0 ? 'impossible' : 'any state';
    }
    function depthRangeLabel(range) {
        if (range.max !== null && range.min > range.max)
            return 'impossible';
        if (range.max === 0)
            return 'depth 0 · no transaction';
        if (range.min === 1 && range.max === 1)
            return 'depth 1 · outermost transaction';
        if (range.min >= 2 && range.max === null)
            return 'depth ≥' + range.min + ' · nested transaction';
        if (range.min === 1 && range.max === null)
            return 'depth ≥1 · active transaction';
        if (range.max === null)
            return 'depth ≥' + range.min;
        if (range.min === range.max)
            return 'depth ' + range.min;
        return 'depth ' + range.min + '–' + range.max;
    }
    function intersectDepth(a, b) {
        var max = a.max === null ? b.max : (b.max === null ? a.max : Math.min(a.max, b.max));
        return { min: Math.max(a.min, b.min), max: max };
    }
    function statesForDepth(range) {
        if (range.max !== null && range.min > range.max)
            return 0;
        if (range.max === 0)
            return TSQL_XACT_NONE;
        if (range.min >= 1)
            return TSQL_XACT_UNCOMMITTABLE | TSQL_XACT_COMMITTABLE;
        return TSQL_XACT_ALL;
    }
    function depthForStates(range, states) {
        if (states === 0)
            return { min: 1, max: 0 };
        if ((states & TSQL_XACT_NONE) === 0)
            return intersectDepth(range, { min: 1, max: null });
        if ((states & (TSQL_XACT_UNCOMMITTABLE | TSQL_XACT_COMMITTABLE)) === 0)
            return intersectDepth(range, { min: 0, max: 0 });
        return range;
    }
    function tsqlTransactionAction(st) {
        var toks = st.toks, head = toks.length ? toks[0].u : '', i = 1, target = '';
        if (head === 'BEGIN' && toks[i] && toks[i].u === 'DISTRIBUTED')
            i++;
        if (toks[i] && (toks[i].u === 'TRAN' || toks[i].u === 'TRANSACTION' || toks[i].u === 'WORK'))
            i++;
        if ((head === 'ROLLBACK' || head === 'SAVE' || head === 'SAVEPOINT') && toks[i])
            target = toks[i].v;
        return {
            kind: head === 'BEGIN' ? 'begin' : (head === 'COMMIT' ? 'commit' :
                (head === 'ROLLBACK' ? 'rollback' :
                    ((head === 'SAVE' || head === 'SAVEPOINT') ? 'save' : ''))),
            target: target,
            staticTarget: !!target && target.charAt(0) !== '@'
        };
    }
    function tsqlTransactionText(st, ctx) {
        var out = textOf(st), states = currentXactStates(ctx), depth = currentTranDepth(ctx);
        if (!st.toks.length)
            return out;
        var action = tsqlTransactionAction(st), head = st.toks[0].u;
        if (head === 'ROLLBACK') {
            var full = !action.target;
            if (states === TSQL_XACT_UNCOMMITTABLE)
                return out + (full ? ' — required full rollback' : ' — full rollback required');
            if (states === TSQL_XACT_NONE)
                return out + ' — invalid: no active transaction';
            if (full && (states & TSQL_XACT_NONE) === 0)
                return out + ' — roll back active transaction; reset depth to 0';
            if (full)
                return out + ' — full rollback; reset depth to 0';
            if (action.staticTarget && currentSavepoints(ctx)[action.target])
                return out + ' — roll back to savepoint ' + action.target + '; depth unchanged';
            return out + ' — named target unresolved; full or savepoint rollback';
        }
        if (head === 'COMMIT') {
            if (states === TSQL_XACT_UNCOMMITTABLE)
                return out + ' — invalid: transaction uncommittable';
            if (states === TSQL_XACT_NONE)
                return out + ' — invalid: no active transaction';
            if (depth.min === 1 && depth.max === 1 &&
                (states & TSQL_XACT_UNCOMMITTABLE) === 0)
                return out + ' — commit outer transaction; depth 1 → 0';
            if (depth.min >= 2 && (states & TSQL_XACT_UNCOMMITTABLE) === 0)
                return out + ' — nested commit only; decrement depth';
            if (states === TSQL_XACT_COMMITTABLE)
                return out + ' — commit committable transaction; decrement depth';
            if (depth.min >= 2)
                return out + ' — nested commit attempt; outer transaction remains if valid';
            return out + ' — decrement depth; durable only at outermost';
        }
        if (head === 'SAVE' || head === 'SAVEPOINT') {
            if (states === TSQL_XACT_UNCOMMITTABLE)
                return out + ' — invalid: full rollback required';
            if (states === TSQL_XACT_NONE)
                return out + ' — invalid: no active transaction';
            return out + ' — create savepoint' + (action.target ? ' ' + action.target : '') +
                (states & TSQL_XACT_UNCOMMITTABLE ? ' if committable' : '') +
                '; depth unchanged';
        }
        if (head === 'BEGIN') {
            if (depth.max === 0)
                return out + ' — start outer transaction; depth 0 → 1';
            if (depth.min >= 1)
                return out + ' — begin nested transaction; increment depth';
            return out + ' — increment transaction depth';
        }
        return out;
    }
    function tsqlStatementText(st, ctx) {
        if (kindOf(st) === 'tran')
            return tsqlTransactionText(st, ctx);
        if (st.toks.length >= 3 && st.toks[0].u === 'SET' && st.toks[1].u === 'XACT_ABORT') {
            if (st.toks[2].u === 'ON')
                return textOf(st) + ' — runtime errors abort transactions';
            if (st.toks[2].u === 'OFF')
                return textOf(st) + ' — statement errors may leave transaction active';
        }
        return textOf(st);
    }
    function invalidTsqlTransactionAction(st, ctx) {
        var states = currentXactStates(ctx), head = st.toks.length ? st.toks[0].u : '';
        if (head === 'COMMIT')
            return states === TSQL_XACT_UNCOMMITTABLE || states === TSQL_XACT_NONE;
        if (head === 'ROLLBACK')
            return states === TSQL_XACT_NONE;
        if (head === 'SAVE' || head === 'SAVEPOINT')
            return states === TSQL_XACT_UNCOMMITTABLE || states === TSQL_XACT_NONE;
        return false;
    }
    function tsqlStatefulStatement(st) {
        return st.toks.length >= 2 && st.toks[0].u === 'SET' && st.toks[1].u === 'XACT_ABORT';
    }
    function applyTsqlStatementState(st, ctx) {
        if (st.toks.length >= 3 && st.toks[0].u === 'SET' && st.toks[1].u === 'XACT_ABORT') {
            if (st.toks[2].u === 'ON')
                ctx.xactAbort = true;
            else if (st.toks[2].u === 'OFF')
                ctx.xactAbort = false;
            return;
        }
        if (kindOf(st) !== 'tran')
            return;
        var action = tsqlTransactionAction(st), depth = currentTranDepth(ctx);
        var states = currentXactStates(ctx);
        if (action.kind === 'begin') {
            ctx.tranDepth = {
                min: depth.min + 1,
                max: depth.max === null ? null : depth.max + 1
            };
            ctx.xactStates = depth.max === 0
                ? TSQL_XACT_COMMITTABLE
                : (states & TSQL_XACT_NONE
                    ? TSQL_XACT_UNCOMMITTABLE | TSQL_XACT_COMMITTABLE
                    : states);
        }
        else if (action.kind === 'commit') {
            ctx.tranDepth = {
                min: Math.max(0, depth.min - 1),
                max: depth.max === null ? null : Math.max(0, depth.max - 1)
            };
            if (ctx.tranDepth.max === 0)
                ctx.xactStates = TSQL_XACT_NONE;
            else if (ctx.tranDepth.min >= 1)
                ctx.xactStates = TSQL_XACT_COMMITTABLE;
            else
                ctx.xactStates = TSQL_XACT_NONE | TSQL_XACT_COMMITTABLE;
            if (ctx.tranDepth.max === 0)
                ctx.savepoints = {};
        }
        else if (action.kind === 'rollback' && !action.target) {
            ctx.tranDepth = { min: 0, max: 0 };
            ctx.xactStates = TSQL_XACT_NONE;
            ctx.savepoints = {};
        }
        else if (action.kind === 'save' && action.staticTarget) {
            var saved = {}, inherited = currentSavepoints(ctx);
            Object.keys(inherited).forEach(function (name) { saved[name] = 1; });
            saved[action.target] = 1;
            ctx.savepoints = saved;
            ctx.xactStates = TSQL_XACT_COMMITTABLE;
            ctx.tranDepth = intersectDepth(depth, { min: 1, max: null });
        }
    }
    function findLoop(ctx, target) {
        while (ctx) {
            if (ctx.loop && (!target ||
                (ctx.loop.label && ctx.loop.label.toUpperCase() === target.toUpperCase())))
                return ctx.loop;
            ctx = ctx.parent;
        }
        return null;
    }
    function isNotFoundHandler(handler) {
        return handler.conditionKey.indexOf('NOT FOUND') >= 0 ||
            handler.conditionKey.indexOf('02000') >= 0;
    }
    function handlerAcceptsNode(handler, node) {
        if (!isNotFoundHandler(handler))
            return true;
        return /^FETCH\b/i.test(node.text) || /^SELECT\b.+\bINTO\b/i.test(node.text);
    }
    function activeHandlers(ctx) {
        var found = [], seen = {};
        while (ctx) {
            for (var i = 0; i < ctx.handlers.length; i++) {
                var handler = ctx.handlers[i];
                if (!seen[handler.conditionKey]) {
                    seen[handler.conditionKey] = 1;
                    found.push(handler);
                }
            }
            ctx = ctx.parent;
        }
        return found;
    }
    function wireHandlerSources(created, ctx) {
        var sources = created.filter(function (node) {
            return HANDLER_SOURCES.indexOf(node.cls) >= 0 && !handlerProcessed[node.id] &&
                !unreachable[node.id];
        });
        if (!sources.length)
            return;
        sources.forEach(function (node) { handlerProcessed[node.id] = 1; });
        activeHandlers(ctx).forEach(function (handler) {
            var accepted = sources.filter(function (node) { return handlerAcceptsNode(handler, node); });
            var selected = fanIn ? accepted : (handler.summarySource ? [] : accepted.slice(0, 1));
            selected.forEach(function (source) {
                var key = handler.id + '>' + source.id;
                if (handlerWires[key])
                    return;
                handlerWires[key] = 1;
                link(source.id, handler.id, handler.label, 'dotted');
                if (!handler.summarySource)
                    handler.summarySource = source.id;
                handler.resumeSources.push(source.id);
            });
        });
    }
    function wireContinueResumes() {
        db2Handlers.forEach(function (handler) {
            if (handler.kind !== 'CONTINUE' || !isNotFoundHandler(handler))
                return;
            var targets = {};
            handler.resumeSources.forEach(function (source) {
                edges.forEach(function (edge) {
                    if (edge.from === source && edge.style === 'solid' && !targets[edge.to]) {
                        targets[edge.to] = 1;
                        link(handler.terminal, edge.to, 'resume', 'dotted');
                    }
                });
            });
        });
    }
    function emitList(list, ctx, depth) {
        if (depth > stats.depth)
            stats.depth = depth;
        var local = { parent: ctx, handlers: [], handlerExits: [] };
        var entry = null, exits = [], i = 0, reachable = true;
        while (i < list.length) {
            var st = list[i], res, mark = nodes.length;
            if (st.type === 'go') {
                i++;
                continue;
            }
            var statementReachable = reachable || st.type === 'label';
            if (group && st.type === 'stmt' && kindOf(st) === 'stmt' &&
                !(dialect === 'tsql' && tsqlStatefulStatement(st))) {
                var run = [st], j = i + 1;
                while (j < list.length && run.length < 6) {
                    var candidate = list[j];
                    if (candidate.type !== 'stmt' || kindOf(candidate) !== 'stmt' ||
                        (dialect === 'tsql' && tsqlStatefulStatement(candidate)))
                        break;
                    run.push(candidate);
                    j++;
                }
                if (run.length > 1) {
                    var runSpan = { start: run[0].toks[0].pos,
                        end: run[run.length - 1].toks[run[run.length - 1].toks.length - 1].end };
                    var id = add('rect', run.map(textOf).join('\u0001'), 'stmt', runSpan);
                    stats.stmt += run.length;
                    res = { entry: id, exits: [{ id: id }] };
                    i = j;
                }
                else {
                    res = emitOne(st, local, depth);
                    i++;
                }
            }
            else {
                res = emitOne(st, local, depth);
                i++;
            }
            if (!statementReachable)
                nodes.slice(mark).forEach(function (node) { unreachable[node.id] = 1; });
            if (st.type !== 'handler' && statementReachable)
                wireHandlerSources(nodes.slice(mark), local);
            if (!res || !res.entry)
                continue;
            if (!entry)
                entry = res.entry;
            if (!statementReachable)
                continue;
            if (!reachable)
                exits = [];
            joinExits(exits, res.entry);
            exits = res.exits;
            if (dialect === 'tsql' && st.type === 'stmt' && exits.length)
                applyTsqlStatementState(st, local);
            reachable = exits.length > 0;
        }
        exits = exits.concat(local.handlerExits);
        return { entry: entry, exits: exits };
    }
    function emitOne(st, ctx, depth) {
        switch (st.type) {
            case 'block': return emitList(st.body, ctx, depth);
            case 'stmt': {
                stats.stmt++;
                var statementKind = kindOf(st);
                var pgTransaction = dialect === 'plpgsql' && statementKind === 'tran'
                    ? pgTransactionAssessment(st.toks, header.kind || '', currentPgSubtransaction(ctx))
                    : null;
                var statementText = dialect === 'tsql' ? tsqlStatementText(st, ctx) : textOf(st);
                if (pgTransaction)
                    statementText += ' — ' + pgTransaction.label;
                var invalidTransaction = statementKind === 'tran' &&
                    ((dialect === 'tsql' && invalidTsqlTransactionAction(st, ctx)) ||
                        (dialect === 'plpgsql' && !!pgTransaction && pgTransaction.invalid));
                var id = add(invalidTransaction ? 'round' : 'rect', statementText, invalidTransaction ? 'err' : statementKind, spanOfTokens(st.toks));
                return { entry: id, exits: invalidTransaction ? [] : [{ id: id }] };
            }
            case 'dynamic': {
                stats.stmt++;
                stats.opaque++;
                var dyn = add('rect', 'Dynamic SQL — ' + clip(joinToks(st.toks, 42), 42), 'opaque', spanOfTokens(st.toks));
                return { entry: dyn, exits: [{ id: dyn }] };
            }
            case 'unknown': {
                stats.stmt++;
                stats.opaque++;
                var unknown = add('rect', 'Unresolved SQL — ' + clip(joinToks(st.toks, 42), 42), 'opaque', spanOfTokens(st.toks));
                return { entry: unknown, exits: [{ id: unknown }] };
            }
            case 'if': {
                stats.branch++;
                var xactTest = dialect === 'tsql' ? tsqlXactStateTest(st.cond) : null;
                var depthTest = dialect === 'tsql' && !xactTest ? tsqlTranCountTest(st.cond) : null;
                var incomingStates = currentXactStates(ctx);
                var incomingDepth = currentTranDepth(ctx);
                var trueDepth = xactTest
                    ? depthForStates(incomingDepth, incomingStates & xactTest.trueStates)
                    : (depthTest ? intersectDepth(incomingDepth, depthTest.trueDepth) : incomingDepth);
                var falseDepth = xactTest
                    ? depthForStates(incomingDepth, incomingStates & xactTest.falseStates)
                    : (depthTest ? intersectDepth(incomingDepth, depthTest.falseDepth) : incomingDepth);
                var trueStates = xactTest
                    ? incomingStates & xactTest.trueStates
                    : (depthTest ? incomingStates & statesForDepth(trueDepth) : incomingStates);
                var falseStates = xactTest
                    ? incomingStates & xactTest.falseStates
                    : (depthTest ? incomingStates & statesForDepth(falseDepth) : incomingStates);
                var conditionText = xactTest ? xactTest.text :
                    (depthTest ? depthTest.text : clip(joinToks(st.cond, 60), 60));
                var c = add('diamond', conditionText, 'cond', spanOfTokens(st.cond));
                var trueCtx = xactTest || depthTest
                    ? withTsqlState(ctx, trueStates, trueDepth) : ctx;
                var falseCtx = xactTest || depthTest
                    ? withTsqlState(ctx, falseStates, falseDepth) : ctx;
                var t = st.then ? emitOne(st.then, trueCtx, depth + 1) : null;
                var e = st.else ? emitOne(st.else, falseCtx, depth + 1) : null;
                var ex = [];
                var yesLabel = xactTest ? 'yes · ' + xactStatesLabel(trueStates) :
                    (depthTest ? 'yes · ' + depthRangeLabel(trueDepth) : 'yes');
                var noLabel = xactTest ? 'no · ' + xactStatesLabel(falseStates) :
                    (depthTest ? 'no · ' + depthRangeLabel(falseDepth) : 'no');
                if (t && t.entry) {
                    link(c, t.entry, yesLabel);
                    ex = ex.concat(t.exits);
                }
                else
                    ex.push({ id: c, label: yesLabel });
                if (e && e.entry) {
                    link(c, e.entry, noLabel);
                    ex = ex.concat(e.exits);
                }
                else
                    ex.push({ id: c, label: noLabel });
                return { entry: c, exits: ex };
            }
            case 'case': {
                if (!st.branches.length) {
                    stats.stmt++;
                    var cs = add('rect', clip('CASE ' + joinToks(st.sel || [], 44), 52), 'stmt', spanOfTokens(st.sel));
                    return { entry: cs, exits: [{ id: cs }] };
                }
                var selTxt = st.sel && st.sel.length ? joinToks(st.sel, 40) : '';
                var entry = null, prev = null, exits = [];
                for (var b = 0; b < st.branches.length; b++) {
                    stats.branch++;
                    var br = st.branches[b];
                    var lab = (selTxt ? selTxt + ' = ' : '') + clip(joinToks(br.cond, 44), 44);
                    var d = add('diamond', clip(lab, 58), 'cond', spanOfTokens(br.cond));
                    if (!entry)
                        entry = d;
                    if (prev)
                        link(prev, d, 'no');
                    var bb = emitList(br.body, ctx, depth + 1);
                    if (bb.entry) {
                        link(d, bb.entry, 'yes');
                        exits = exits.concat(bb.exits);
                    }
                    else
                        exits.push({ id: d, label: 'yes' });
                    prev = d;
                }
                if (st.else) {
                    var eb = emitList(st.else, ctx, depth + 1);
                    if (eb.entry) {
                        link(prev, eb.entry, 'else');
                        exits = exits.concat(eb.exits);
                    }
                }
                else if (prev)
                    exits.push({ id: prev, label: 'no' });
                return { entry: entry, exits: exits };
            }
            case 'while':
            case 'for':
            case 'loop': {
                stats.loop++;
                var txt = st.type === 'while' ? clip(joinToks(st.cond, 58), 58)
                    : st.type === 'for' ? clip('for ' + joinToks(st.head, 54), 58)
                        : 'loop';
                var wc = add('hex', txt, 'loop', spanOfTokens(st.cond || st.head));
                var inner = {
                    loop: { cond: wc, breaks: [], label: st.label || null },
                    parent: ctx, handlers: [], handlerExits: []
                };
                var body = st.body ? emitOne(st.body, inner, depth + 1) : null;
                if (body && body.entry) {
                    link(wc, body.entry, st.type === 'loop' ? '' : 'yes');
                    joinExits(body.exits, wc);
                }
                else
                    link(wc, wc, 'loop');
                var outs = inner.loop.breaks.slice();
                if (st.type !== 'loop')
                    outs.push({ id: wc, label: 'done' });
                return { entry: wc, exits: outs };
            }
            case 'repeat': {
                stats.loop++;
                var rc = add('diamond', 'until ' + clip(joinToks(st.cond, 50), 50), 'loop', spanOfTokens(st.cond));
                var inner2 = {
                    loop: { cond: rc, breaks: [], label: st.label || null },
                    parent: ctx, handlers: [], handlerExits: []
                };
                var body2 = st.body ? emitOne(st.body, inner2, depth + 1) : null;
                if (body2 && body2.entry) {
                    joinExits(body2.exits, rc);
                    link(rc, body2.entry, 'no');
                    var repeatExits = [{ id: rc, label: 'yes' }];
                    return { entry: body2.entry, exits: repeatExits.concat(inner2.loop.breaks) };
                }
                return { entry: rc, exits: [{ id: rc, label: 'yes' }] };
            }
            case 'try': {
                stats.cat += st.handlers.length || 1;
                var tstart = add('marker', dialect === 'tsql' ? 'BEGIN TRY' :
                    (dialect === 'plpgsql' ? 'BEGIN exception block · subtransaction' : 'BEGIN block'), 'try');
                var mark = nodes.length;
                var exceptionCtx = dialect === 'plpgsql'
                    ? { parent: ctx, handlers: [], handlerExits: [], pgSubtransaction: true }
                    : ctx;
                var tb = emitList(st.body, exceptionCtx, depth + 1);
                if (tb.entry)
                    link(tstart, tb.entry);
                var exits = tb.entry ? tb.exits.slice() : [{ id: tstart }];
                /* Explicit errors always identify their source; fan-in adds potential raisers. */
                var explicitRaisers = [], raisers = [];
                nodes.slice(mark).forEach(function (n) {
                    if (n.cls === 'err' && !guarded[n.id] && !unreachable[n.id])
                        explicitRaisers.push(n.id);
                });
                raisers = explicitRaisers.slice();
                if (fanIn)
                    nodes.slice(mark).forEach(function (n) {
                        if (PROTECTABLE.indexOf(n.cls) >= 0 && !guarded[n.id] && !unreachable[n.id] &&
                            raisers.indexOf(n.id) < 0)
                            raisers.push(n.id);
                    });
                var handlerMarkers = [], handlerLabels = [];
                for (var hh = 0; hh < st.handlers.length; hh++) {
                    var h = st.handlers[hh];
                    var lab2 = h.cond && h.cond.length ? clip(joinToks(h.cond, 40), 40) : 'CATCH';
                    var catchText = lab2 === 'CATCH' ? 'BEGIN CATCH' : ('WHEN ' + lab2);
                    if (dialect === 'tsql' && lab2 === 'CATCH' && currentXactAbort(ctx) === true)
                        catchText += ' · XACT_ABORT ON at TRY entry; inspect XACT_STATE';
                    var cm = add('marker', catchText, 'catch');
                    if (lab2 !== 'CATCH' && dialect !== 'tsql')
                        nodes[nodes.length - 1].text = 'EXCEPTION WHEN ' + lab2;
                    handlerMarkers.push(cm);
                    handlerLabels.push(lab2);
                }
                var handlerReachable = handlerMarkers.map(function () { return false; });
                var junction = null, handledRaisers = {};
                if (dialect === 'plpgsql') {
                    var unknownRaisers = raisers.filter(function (id) { return !pgErrors[id]; });
                    explicitRaisers.forEach(function (id) {
                        var error = pgErrors[id];
                        if (!error)
                            return;
                        for (var hi = 0; hi < st.handlers.length; hi++) {
                            if (pgHandlerMatches(st.handlers[hi].cond, error)) {
                                link(id, handlerMarkers[hi], '', 'dotted');
                                handlerReachable[hi] = true;
                                handledRaisers[id] = 1;
                                break;
                            }
                        }
                    });
                    if (unknownRaisers.length && handlerMarkers.length > 1) {
                        junction = add('marker', 'on error', 'catch');
                        unknownRaisers.forEach(function (id) { link(id, junction, '', 'dotted'); });
                        handlerMarkers.forEach(function (id, index) {
                            link(junction, id, handlerLabels[index], 'dotted');
                            handlerReachable[index] = true;
                        });
                    }
                    else if (unknownRaisers.length && handlerMarkers.length) {
                        unknownRaisers.forEach(function (id) { link(id, handlerMarkers[0], '', 'dotted'); });
                        handlerReachable[0] = true;
                    }
                    if (st.handlers.some(function (handler) { return pgHandlerHasOthers(handler.cond); }))
                        unknownRaisers.forEach(function (id) { handledRaisers[id] = 1; });
                    if (!fanIn || !raisers.length)
                        handlerMarkers.forEach(function (id, index) {
                            link(tstart, id, 'error', 'dotted');
                            handlerReachable[index] = true;
                        });
                }
                else {
                    if (fanIn && raisers.length && handlerMarkers.length > 1)
                        junction = add('marker', 'on error', 'catch');
                    handlerMarkers.forEach(function (cm, index) {
                        if (junction) {
                            link(junction, cm, handlerLabels[index] === 'CATCH' ? '' : handlerLabels[index], 'dotted');
                            handlerReachable[index] = true;
                        }
                        else if (fanIn && raisers.length) {
                            raisers.forEach(function (id) { link(id, cm, '', 'dotted'); });
                            handlerReachable[index] = true;
                        }
                        else {
                            link(tstart, cm, 'error', 'dotted');
                            explicitRaisers.forEach(function (id) { link(id, cm, '', 'dotted'); });
                            handlerReachable[index] = true;
                        }
                    });
                    if (junction)
                        raisers.forEach(function (id) { link(id, junction, '', 'dotted'); });
                    (fanIn ? raisers : explicitRaisers).forEach(function (id) { handledRaisers[id] = 1; });
                }
                for (var hbIndex = 0; hbIndex < st.handlers.length; hbIndex++) {
                    var handlerScopeMark = nodes.length;
                    var rollbackMarker = null;
                    if (dialect === 'plpgsql')
                        rollbackMarker = add('marker', 'Implicit rollback · ' + clip(handlerLabels[hbIndex], 32) +
                            '\u0001Persistent changes undone · variables preserved', 'tran');
                    var cb2 = emitList(st.handlers[hbIndex].body, exceptionCtx, depth + 1);
                    if (handlerReachable[hbIndex] && cb2.entry) {
                        if (rollbackMarker) {
                            link(handlerMarkers[hbIndex], rollbackMarker);
                            link(rollbackMarker, cb2.entry);
                        }
                        else
                            link(handlerMarkers[hbIndex], cb2.entry);
                        exits = exits.concat(cb2.exits);
                    }
                    else if (handlerReachable[hbIndex]) {
                        if (rollbackMarker) {
                            link(handlerMarkers[hbIndex], rollbackMarker);
                            exits.push({ id: rollbackMarker });
                        }
                        else
                            exits.push({ id: handlerMarkers[hbIndex] });
                    }
                    else {
                        unreachable[handlerMarkers[hbIndex]] = 1;
                        nodes.slice(handlerScopeMark).forEach(function (node) { unreachable[node.id] = 1; });
                    }
                }
                Object.keys(handledRaisers).forEach(function (id) { guarded[id] = 1; });
                return { entry: tstart, exits: exits };
            }
            case 'handler': {
                stats.cat++;
                var condition = clip(joinToks(st.conds, 34), 34);
                var hm = add('marker', st.kind + ' HANDLER FOR ' + condition, 'catch', spanOfTokens(st.conds));
                /* Same-scope handlers do not handle conditions raised by one another. */
                var hb = st.body ? emitList([st.body], ctx ? ctx.parent : null, depth + 1) : null;
                if (hb && hb.entry)
                    link(hm, hb.entry);
                var terminalText = st.kind === 'CONTINUE'
                    ? 'Resume after raising statement'
                    : (st.kind === 'UNDO' ? 'Undo and exit compound block' : 'Exit compound block');
                var terminal = add('marker', terminalText, st.kind === 'CONTINUE' ? 'flowctl' : 'catch');
                joinExits(hb && hb.entry ? hb.exits : [{ id: hm }], terminal);
                if (ctx) {
                    var handlerFlow = {
                        id: hm, kind: st.kind, label: condition || 'condition',
                        conditionKey: (condition || 'condition').toUpperCase(),
                        scopeExit: st.kind === 'CONTINUE' ? null : terminal,
                        summarySource: null, terminal: terminal, resumeSources: []
                    };
                    ctx.handlers.push(handlerFlow);
                    db2Handlers.push(handlerFlow);
                    if (st.kind !== 'CONTINUE')
                        ctx.handlerExits.push({ id: terminal, label: st.kind === 'UNDO' ? 'undo' : 'handler exit' });
                }
                return { entry: null, exits: [] };
            }
            case 'return': {
                var r = add('round', clip(joinToks(st.toks, 40), 40) || 'RETURN', 'ret', spanOfTokens(st.toks));
                return { entry: r, exits: [] };
            }
            case 'throw': {
                var th = add('round', clip(joinToks(st.toks, 46), 46), 'err', spanOfTokens(st.toks));
                if (dialect === 'plpgsql')
                    pgErrors[th] = pgErrorFromRaise(st.toks);
                return { entry: th, exits: [] };
            }
            case 'sqlite_raise': {
                var effects = {
                    IGNORE: 'abandon trigger/query; no rollback',
                    FAIL: 'stop statement; keep prior changes',
                    ABORT: 'roll back statement changes',
                    ROLLBACK: 'roll back transaction'
                };
                var sr = add('round', 'RAISE ' + st.action + ' — ' + effects[st.action], st.action === 'IGNORE' ? 'halt' : 'err', spanOfTokens(st.toks));
                return { entry: sr, exits: [] };
            }
            case 'break':
            case 'continue': {
                var isBreak = st.type === 'break';
                var L = findLoop(ctx, st.target);
                var word = (st.word || (isBreak ? 'BREAK' : 'CONTINUE')).toUpperCase() + (st.target ? ' ' + st.target : '');
                if (st.when && st.when.length) {
                    stats.branch++;
                    var dq = add('diamond', word + ' WHEN ' + clip(joinToks(st.when, 40), 40), 'cond', st.span);
                    if (L) {
                        if (isBreak)
                            L.breaks.push({ id: dq, label: 'yes' });
                        else
                            link(dq, L.cond, 'yes');
                    }
                    return { entry: dq, exits: [{ id: dq, label: 'no' }] };
                }
                var bn = add('rect', word, 'flowctl', st.span);
                if (L) {
                    if (isBreak)
                        L.breaks.push({ id: bn });
                    else
                        link(bn, L.cond, 'continue');
                }
                return { entry: bn, exits: [] };
            }
            case 'label': {
                var lb = add('marker', st.label + ':', 'flowctl');
                labels[st.label.toUpperCase()] = lb;
                return { entry: lb, exits: [{ id: lb }] };
            }
            case 'goto': {
                var g = add('rect', 'GOTO ' + st.label, 'flowctl');
                gotos.push({ from: g, to: st.label.toUpperCase() });
                return { entry: g, exits: [] };
            }
        }
        return null;
    }
    var startText = header.name
        ? header.name + (header.params ? '(' + clip(header.params, 44) + ')' : '')
        : (header.kind ? header.kind.toLowerCase() : 'Script start');
    var start = add('round', startText, 'start');
    var head = start;
    if (header.gate && header.gate.length) { /* SQLite trigger WHEN clause */
        stats.branch++;
        var gd = add('diamond', clip(joinToks(header.gate, 58), 58), 'cond', spanOfTokens(header.gate));
        link(start, gd);
        head = gd;
    }
    var body = emitList(ast, null, 1);
    var end = add('round', 'End', 'start');
    if (head !== start) {
        if (body.entry)
            link(head, body.entry, 'yes');
        else
            link(head, end, 'yes');
        link(head, end, 'no');
    }
    else if (body.entry)
        link(start, body.entry);
    joinExits(body.entry ? body.exits : [{ id: head }], end);
    wireContinueResumes();
    for (var i2 = 0; i2 < nodes.length; i2++)
        if (nodes[i2].cls === 'ret')
            link(nodes[i2].id, end, '', 'dotted');
    for (var g2 = 0; g2 < gotos.length; g2++)
        if (labels[gotos[g2].to])
            link(gotos[g2].from, labels[gotos[g2].to], 'goto', 'dotted');
    if (number) {
        var step = 0;
        nodes.forEach(function (n) {
            if (PROTECTABLE.indexOf(n.cls) >= 0 || n.cls === 'notice')
                n.text = (++step) + '. ' + n.text;
        });
        stats.steps = step;
    }
    stats.exit = nodes.filter(function (n) {
        return n.cls === 'ret' || n.cls === 'err' || n.cls === 'halt';
    }).length;
    stats.cc = 1 + stats.branch + stats.loop + stats.cat;
    return { nodes: nodes, edges: edges, stats: stats };
}
/* ---------- shared object/dependency model ---------- */
function uniqueNames(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (v) {
        if (!v)
            return;
        var key = v.toUpperCase();
        if (!seen[key]) {
            seen[key] = 1;
            out.push(v);
        }
    });
    return out;
}
function statementFacts(toks, dynamic) {
    toks = toks || [];
    var split = splitCTEs(toks), cteNames = split.ctes.map(function (c) { return c.name.toUpperCase(); });
    var work = split.ctes.length ? toks.slice(split.finalStart) : toks;
    var head = work[0] ? work[0].u : '';
    var reads = refsIn(toks).refs.filter(function (r) { return cteNames.indexOf(r.toUpperCase()) < 0; });
    var writes = [], calls = [];
    toks = work;
    var i = 1;
    if (head === 'INSERT' || head === 'REPLACE') {
        while (toks[i] && ['INTO', 'OR', 'IGNORE', 'REPLACE'].indexOf(toks[i].u) >= 0)
            i++;
        if (toks[i])
            writes.push(qname(toks, i));
    }
    else if (head === 'UPDATE') {
        if (toks[i] && toks[i].u === 'TOP') {
            i++;
            if (toks[i] && toks[i].v === '(') {
                while (toks[i] && toks[i].v !== ')')
                    i++;
                i++;
            }
            else
                i++;
        }
        if (toks[i])
            writes.push(qname(toks, i));
    }
    else if (head === 'DELETE') {
        if (toks[i] && toks[i].u === 'FROM')
            i++;
        if (toks[i])
            writes.push(qname(toks, i));
    }
    else if (head === 'MERGE') {
        if (toks[i] && toks[i].u === 'INTO')
            i++;
        if (toks[i])
            writes.push(qname(toks, i));
    }
    else if (head === 'TRUNCATE') {
        if (toks[i] && toks[i].u === 'TABLE')
            i++;
        if (toks[i])
            writes.push(qname(toks, i));
    }
    else if (head === 'SELECT') {
        var depth = 0;
        for (var si = 1; si < toks.length; si++) {
            if (toks[si].v === '(')
                depth++;
            else if (toks[si].v === ')')
                depth--;
            else if (depth === 0 && toks[si].u === 'INTO' && toks[si + 1] &&
                toks[si + 1].v.charAt(0) !== '@') {
                writes.push(qname(toks, si + 1));
                break;
            }
        }
    }
    else if (head === 'CREATE' && toks[i] && toks[i].u === 'TABLE' && toks[i + 1]) {
        writes.push(qname(toks, i + 1));
    }
    if (['EXEC', 'EXECUTE', 'CALL', 'PERFORM'].indexOf(head) >= 0 && !dynamic) {
        if (toks[i] && toks[i].v.charAt(0) === '@' && toks[i + 1] && toks[i + 1].v === '=')
            i += 2;
        if (toks[i])
            calls.push(qname(toks, i));
    }
    var resultSet = head === 'SELECT' && !toks.some(function (t) { return t.u === 'INTO'; });
    return { reads: uniqueNames(reads), writes: uniqueNames(writes), calls: uniqueNames(calls),
        resultSet: resultSet, dynamic: !!dynamic };
}
function walkAst(list, visit, depth) {
    (list || []).forEach(function (st) {
        visit(st, depth || 0);
        if (st.type === 'block')
            walkAst(st.body, visit, (depth || 0) + 1);
        else if (st.type === 'if') {
            if (st.then)
                walkAst([st.then], visit, (depth || 0) + 1);
            if (st.else)
                walkAst([st.else], visit, (depth || 0) + 1);
        }
        else if (st.type === 'case') {
            st.branches.forEach(function (b) { walkAst(b.body, visit, (depth || 0) + 1); });
            walkAst(st.else, visit, (depth || 0) + 1);
        }
        else if (['while', 'for', 'loop', 'repeat'].indexOf(st.type) >= 0 && st.body)
            walkAst([st.body], visit, (depth || 0) + 1);
        else if (st.type === 'try') {
            walkAst(st.body, visit, (depth || 0) + 1);
            st.handlers.forEach(function (h) { walkAst(h.body, visit, (depth || 0) + 1); });
        }
        else if (st.type === 'handler' && st.body)
            walkAst([st.body], visit, (depth || 0) + 1);
    });
}
function buildObjectIR(result, unit) {
    var statements = [], branches = [], reads = [], writes = [], calls = [], resultSets = [];
    walkAst(result.ast, function (st, depth) {
        var condition = null;
        if (st.type === 'if' || st.type === 'while' || st.type === 'repeat')
            condition = st.cond || null;
        else if (st.type === 'for')
            condition = st.head || null;
        else if (st.type === 'case')
            condition = st.sel;
        if (['if', 'case', 'while', 'for', 'loop', 'repeat'].indexOf(st.type) >= 0) {
            branches.push({ type: st.type, depth: depth, span: spanOfTokens(condition) });
        }
        if ('toks' in st) {
            var facts = st.type === 'unknown'
                ? { reads: [], writes: [], calls: [], resultSet: false, dynamic: false }
                : statementFacts(st.toks, st.type === 'dynamic');
            var item = { type: st.type, text: joinToks(st.toks), span: spanOfTokens(st.toks),
                depth: depth, reads: facts.reads, writes: facts.writes,
                calls: facts.calls, resultSet: facts.resultSet, dynamic: facts.dynamic };
            statements.push(item);
            reads = reads.concat(facts.reads);
            writes = writes.concat(facts.writes);
            calls = calls.concat(facts.calls);
            if (facts.resultSet)
                resultSets.push({ statement: statements.length - 1, span: item.span });
        }
    }, 0);
    return {
        id: unit && unit.id || '', name: result.header.name || (unit && unit.name) || 'Script',
        kind: (result.header.kind || unit && unit.kind || 'SCRIPT').replace(/^PROC$/, 'PROCEDURE'),
        dialect: result.dialect, file: unit && unit.file || '', source: unit && unit.sql || '',
        sql: unit && unit.sql || '',
        span: { start: 0, end: (unit && unit.sql || '').length }, statements: statements,
        branches: branches, reads: uniqueNames(reads), writes: uniqueNames(writes),
        calls: uniqueNames(calls), resultSets: resultSets,
        diagnostics: result.diagnostics || []
    };
}
function objectStartAt(toks, i) {
    var t = toks[i], j = i;
    if (!t || ['CREATE', 'ALTER', 'REPLACE'].indexOf(t.u) < 0)
        return null;
    j++;
    if (t.u === 'CREATE' && toks[j] && toks[j].u === 'OR' && toks[j + 1] &&
        ['ALTER', 'REPLACE'].indexOf(toks[j + 1].u) >= 0)
        j += 2;
    while (toks[j] && ['TEMP', 'TEMPORARY', 'MATERIALIZED', 'UNIQUE', 'CLUSTERED'].indexOf(toks[j].u) >= 0)
        j++;
    if (!toks[j] || OBJ_KINDS.indexOf(toks[j].u) < 0)
        return null;
    return { token: j, kind: toks[j].u, pos: t.pos };
}
function splitSqlObjects(sql, fileName) {
    sql = String(sql || '');
    var toks = tokenize(sql), starts = [];
    for (var i = 0; i < toks.length; i++) {
        var found = objectStartAt(toks, i);
        if (found) {
            starts.push(found);
            i = found.token;
        }
    }
    if (!starts.length)
        return [{ id: '', file: fileName || 'Pasted SQL', kind: 'SCRIPT',
                name: fileName || 'Script', start: 0, end: sql.length, sql: sql }];
    return starts.map(function (s, index) {
        var start = index === 0 ? 0 : s.pos, end = index + 1 < starts.length ? starts[index + 1].pos : sql.length;
        return { id: '', file: fileName || 'Pasted SQL', kind: s.kind, name: '', start: start, end: end,
            sql: sql.slice(start, end) };
    });
}
function dependencyGraph(objects) {
    var nodes = [], edges = [], ids = {}, ext = {}, seq = 0;
    function add(text, cls, source, objectId) {
        var id = 'd' + (++seq);
        nodes.push({ id: id, shape: cls === 'src' ? 'io' : 'rect', text: text, cls: cls,
            source: source || null, objectId: objectId || null,
            provenance: source ? 'source' : (objectId ? 'external' : 'synthetic') });
        return id;
    }
    objects.forEach(function (o) {
        var cls = o.kind === 'VIEW' ? 'cte' : (o.kind === 'SCRIPT' ? 'final' : 'call');
        ids[o.name.toUpperCase()] = add(o.name + '\u0001' + o.kind, cls, o.span, o.id);
    });
    function target(name, type) {
        var known = ids[name.toUpperCase()];
        if (known)
            return known;
        var key = type + ':' + name.toUpperCase();
        if (!ext[key])
            ext[key] = add(name, type === 'call' ? 'call' : 'src', null, null);
        return ext[key];
    }
    objects.forEach(function (o) {
        var from = ids[o.name.toUpperCase()];
        [{ items: o.reads, label: 'reads', type: 'read' },
            { items: o.writes, label: 'writes', type: 'write' },
            { items: o.calls, label: 'calls', type: 'call' }].forEach(function (group) {
            group.items.forEach(function (name) {
                var kind = group.type === 'call' ? 'call' :
                    (group.type === 'write' ? 'data' : 'dependency');
                edges.push({ from: from, to: target(name, group.type), label: group.label,
                    style: group.type === 'write' ? 'dotted' : 'solid', kind: kind });
            });
        });
    });
    return { nodes: nodes, edges: edges, stats: {
            objects: objects.length,
            reads: objects.reduce(function (n, o) { return n + o.reads.length; }, 0),
            writes: objects.reduce(function (n, o) { return n + o.writes.length; }, 0),
            calls: objects.reduce(function (n, o) { return n + o.calls.length; }, 0),
            external: Object.keys(ext).length
        } };
}
function analyseEstate(files, opts) {
    opts = opts || {};
    var units = [];
    (files || []).forEach(function (file) {
        units = units.concat(splitSqlObjects(file.text, file.name));
    });
    var objects = units.map(function (unit, index) {
        unit.id = 'object-' + (index + 1);
        var result = analyse(unit.sql, opts);
        unit.name = result.header.name || unit.name || ('Script ' + (index + 1));
        var ir = buildObjectIR(result, unit);
        ir.result = result;
        return ir;
    });
    var graph = dependencyGraph(objects);
    return { objects: objects, graph: graph, stats: graph.stats,
        diagnostics: objects.reduce(function (a, o) { return a.concat(o.diagnostics); }, []) };
}
function analyse(sql, opts) {
    opts = opts || {};
    sql = String(sql || '');
    var det = detectDialect(sql);
    var dialect = (opts.dialect && opts.dialect !== 'auto') ? opts.dialect : det.dialect;
    var toks = tokenize(sql);
    var diagnostics = (toks.diagnostics || []).slice();
    var header = findBody(toks, dialect, sql);
    var bodyToks;
    if (header.inner !== undefined) {
        bodyToks = tokenize(header.inner);
        var innerOffset = header.innerOffset || 0;
        bodyToks.forEach(function (t) { t.pos += innerOffset; t.end += innerOffset; });
        (bodyToks.diagnostics || []).forEach(function (d) {
            var shifted = { severity: d.severity, code: d.code, message: d.message, span: d.span };
            if (d.span)
                shifted.span = { start: d.span.start + innerOffset, end: d.span.end + innerOffset };
            diagnostics.push(shifted);
        });
    }
    else
        bodyToks = toks.slice(header.index < 0 ? 0 : header.index);
    var p = P(bodyToks, dialect);
    var ast = parseBlock(p, []);
    while (ast.length === 1 && ast[0].type === 'block')
        ast = ast[0].body;
    diagnostics = diagnostics.concat(p.diagnostics || []);
    var remaining = bodyToks.slice(p.i).filter(function (t) { return t.v !== ';'; });
    if (remaining.length) {
        if (['END', 'ELSE', 'ELSEIF', 'ELSIF', 'WHEN', 'EXCEPTION', 'THEN', 'UNTIL'].
            indexOf(remaining[0].u) >= 0) {
            diagnostics.push({ severity: 'warning', code: 'unexpected_end',
                message: 'Block-terminating keyword "' + remaining[0].u + '" appears without a matching opener. The diagram may be incomplete.',
                span: { start: remaining[0].pos, end: remaining[0].end }, scope: 'region' });
        }
        diagnostics.push({ severity: 'error', code: 'unconsumed_input',
            message: 'Parser stopped before ' + remaining.length + ' token' + (remaining.length === 1 ? ' was' : 's were') +
                ' consumed. The diagram may be incomplete.',
            span: { start: remaining[0].pos, end: remaining[remaining.length - 1].end },
            scope: 'region' });
        ast.push({ type: 'unknown', toks: remaining, reason: 'Parser stopped before this input.' });
    }
    var totalTokens = bodyToks.length, consumedTokens = Math.min(p.i, totalTokens);
    var coverage = totalTokens ? consumedTokens / totalTokens : 1;
    if ((!opts.dialect || opts.dialect === 'auto') && !det.confident) {
        diagnostics.push({ severity: 'warning', code: 'dialect_low_confidence',
            message: 'Dialect detection is uncertain; select the dialect manually if the diagram looks wrong.',
            span: { start: 0, end: Math.min(String(sql || '').length, 1) },
            scope: 'document' });
        if (det.tied)
            diagnostics.push({ severity: 'warning', code: 'dialect_ambiguous',
                message: 'Dialect detection is ambiguous: several dialects scored equally. Select the dialect manually.',
                span: null, scope: 'document' });
    }
    walkAst(ast, function (st) {
        if (st.type === 'dynamic')
            diagnostics.push({ severity: 'warning', code: 'dynamic_sql',
                message: 'Dynamic SQL is opaque and its internal reads, writes, calls, and branches are not resolved.',
                span: spanOfTokens(st.toks), scope: 'region' });
    }, 0);
    if (dialect === 'plpgsql')
        addPgTransactionDiagnostics(ast, header, diagnostics, false);
    diagnostics.forEach(function (d) {
        if (!d.scope)
            d.scope = 'region';
    });
    var gopts = { detail: opts.detail, group: opts.group, dialect: dialect, sources: opts.sources,
        fanIn: opts.fanIn, number: opts.number };
    var graph = buildGraph(ast, header, gopts);
    var mode = opts.mode || 'auto';
    var flat = graph.stats.branch + graph.stats.loop + graph.stats.cat === 0;
    var single = ast.length === 1 && ast[0].type === 'stmt';
    var q = null;
    if (mode === 'query') {
        q = buildObjectQueryGraph(ast, header, gopts);
    }
    else if (single && mode === 'auto' && flat) {
        q = buildQueryGraph(ast[0].toks, header, gopts);
        if (q.empty || q.nodes.length < 2)
            q = null;
    }
    var selected = q || graph, selectedMode = q ? 'query' : 'flow';
    var dialectConfidence = (opts.dialect && opts.dialect !== 'auto') ? 1 : Math.min(1, (det.score || 0) / 7);
    var hasErrors = diagnostics.some(function (d) { return d.severity === 'error'; });
    var confidence = Math.max(0, Math.min(1, dialectConfidence * coverage * (hasErrors ? 0.55 : 1)));
    /* Token attribution: every body token is resolved, deliberately ignored, or opaque/unresolved. */
    var attribution = { total: totalTokens, resolved: 0, ignored: 0,
        unresolved: 0, opaque: 0, ignoredCategories: {} };
    var attributed = new Array(totalTokens).fill(false);
    function markAttributed(toks) {
        if (!toks || !toks.length)
            return;
        for (var ai = 0; ai < totalTokens; ai++) {
            if (attributed[ai])
                continue;
            for (var ti = 0; ti < toks.length; ti++)
                if (toks[ti] === bodyToks[ai]) {
                    attributed[ai] = true;
                    break;
                }
        }
    }
    walkAst(ast, function (st) {
        if ('toks' in st && st.toks && st.toks.length) {
            markAttributed(st.toks);
            if (st.type === 'dynamic' || st.type === 'unknown')
                attribution.opaque += st.toks.length;
            else
                attribution.resolved += st.toks.length;
        }
        if (st.type === 'if' && st.cond && st.cond.length) {
            markAttributed(st.cond);
            attribution.resolved += st.cond.length;
        }
        if ((st.type === 'while' || st.type === 'repeat') && st.cond && st.cond.length) {
            markAttributed(st.cond);
            attribution.resolved += st.cond.length;
        }
        if (st.type === 'for' && st.head && st.head.length) {
            markAttributed(st.head);
            attribution.resolved += st.head.length;
        }
        if (st.type === 'case' && st.sel && st.sel.length) {
            markAttributed(st.sel);
            attribution.resolved += st.sel.length;
        }
    }, 0);
    /* Semicolons and block keywords are deliberately ignored syntax. */
    for (var bi = 0; bi < totalTokens; bi++) {
        if (attributed[bi])
            continue;
        var bt = bodyToks[bi];
        if (!bt)
            continue;
        if (bt.v === ';') {
            attribution.ignored++;
            attribution.ignoredCategories['semicolon'] = (attribution.ignoredCategories['semicolon'] || 0) + 1;
        }
        else if (['BEGIN', 'END', 'THEN', 'ELSE', 'ELSEIF', 'ELSIF', 'DO', 'LOOP', 'WHEN', 'EXCEPTION',
            'UNTIL', 'TRY', 'CATCH', 'ATOMIC', 'NOT'].indexOf(bt.u) >= 0) {
            attribution.ignored++;
            attribution.ignoredCategories['block_keyword'] = (attribution.ignoredCategories['block_keyword'] || 0) + 1;
        }
        else {
            attribution.unresolved++;
        }
    }
    /* Construct coverage: branches, loops, handlers, CTEs, source refs. */
    var constructCoverage = { constructs: 0, resolved: 0, opaque: 0, byKind: {} };
    function trackC(kind, resolved, opaque) {
        var c = constructCoverage.byKind[kind] = constructCoverage.byKind[kind] ||
            { detected: 0, resolved: 0, opaque: 0 };
        c.detected++;
        if (opaque)
            c.opaque++;
        else if (resolved)
            c.resolved++;
        constructCoverage.constructs++;
        if (opaque)
            constructCoverage.opaque++;
        else if (resolved)
            constructCoverage.resolved++;
    }
    walkAst(ast, function (st) {
        if (st.type === 'if' || st.type === 'case')
            trackC('branch', true);
        else if (['while', 'for', 'loop', 'repeat'].indexOf(st.type) >= 0)
            trackC('loop', true);
        else if (st.type === 'try')
            trackC('handler', true);
        else if (st.type === 'handler')
            trackC('handler', true);
        else if (st.type === 'dynamic')
            trackC('dynamic', false, true);
        else if (st.type === 'unknown')
            trackC('unresolved', false, true);
    }, 0);
    walkAst(ast, function (st) {
        if ('toks' in st && st.toks) {
            var split = splitCTEs(st.toks);
            split.ctes.forEach(function (c) { trackC('cte', true); });
            var info = refsIn(st.toks);
            info.refs.forEach(function () { trackC('source_ref', true); });
        }
    }, 0);
    return { dialect: dialect, detected: det, confidence: confidence,
        dialectConfidence: dialectConfidence, coverage: coverage,
        consumedTokens: consumedTokens, totalTokens: totalTokens,
        diagnostics: diagnostics, header: header, ast: ast, mode: selectedMode,
        graph: selected, stats: selected.stats,
        mermaid: toMermaid(selected, opts.dir || 'TD'),
        attribution: attribution, constructCoverage: constructCoverage };
}
//# sourceMappingURL=ir.js.map