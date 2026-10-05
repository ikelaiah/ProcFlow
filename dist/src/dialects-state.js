"use strict";
/* sql-cartographer v3.1.0 — dialect transaction and error-state model.
   (Role introduced v2.7.0; the pure T-SQL transaction algebra moved here from
   src/ir.ts in v3.1.0 so the bitmask model and the functions that operate on
   it live together and can be tested without building a graph.)
   PL/pgSQL error-code mapping and handler matching, PL/pgSQL transaction
   legality assessment, and the T-SQL transaction-depth/XACT_STATE model.
   These are pure token/AST utilities extracted from ir.ts so the graph builder
   is smaller and the dialect rules can be reviewed on their own. Depends on
   token-utils.ts (spanOfTokens, clip, joinToks) and the ambient types. */
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
/* Narrow a token range by stripping balanced outer parentheses. Shared by the
   XACT_STATE and @@TRANCOUNT condition tests so the two cannot drift apart in
   how they read `((XACT_STATE() = 0))`. */
function tsqlStripOuterParens(toks, start, end) {
    var changed = true;
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
    return { start: start, end: end };
}
function tsqlXactStateTest(toks) {
    var outer = tsqlStripOuterParens(toks, 0, toks.length), start = outer.start, end = outer.end;
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
    var outer = tsqlStripOuterParens(toks, 0, toks.length), start = outer.start, end = outer.end;
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
    /* `anyDepth` is the unconstrained reading: the statement tells us nothing
       about @@TRANCOUNT here, so both branches inherit an open range. */
    var n = value.value, anyDepth = { min: 0, max: null };
    var trueDepth = anyDepth, falseDepth = anyDepth;
    if (op === '=') {
        trueDepth = { min: n, max: n };
        falseDepth = n === 0 ? { min: 1, max: null } : anyDepth;
    }
    else if (op === '<>' || op === '!=') {
        trueDepth = n === 0 ? { min: 1, max: null } : anyDepth;
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
/* ===== T-SQL transaction state model =====
   Pure functions over FlowContext, StatementNode, and TsqlTransactionDepth.
   Extracted from src/ir.ts (v3.1.0) so the transaction algebra lives with the
   TSQL_XACT_* bitmask model it operates on, and is testable without a graph.

   The bitmask: TSQL_XACT_UNCOMMITTABLE=1, TSQL_XACT_NONE=2,
   TSQL_XACT_COMMITTABLE=4, and TSQL_XACT_ALL is their union. @@TRANCOUNT can
   be any of these, or a set of them when a branch is not statically resolved,
   so states are held as a bit set and depth as an inclusive range. */
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
function currentInCatch(ctx) {
    while (ctx) {
        if (ctx.inCatch)
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
    if (head === 'ROLLBACK' || head === 'SAVE' || head === 'SAVEPOINT') {
        /* `ROLLBACK [TRAN[SACTION]] TO <savepoint>` spells its target after the
           TO keyword, while SAVE/SAVEPOINT take it directly. Skipping TO here is
           what makes `ROLLBACK TO my_sp` name `my_sp`; without it the keyword is
           read as the savepoint name. */
        if (toks[i] && toks[i].u === 'TO')
            i++;
        if (toks[i])
            target = toks[i].v;
    }
    return {
        kind: head === 'BEGIN' ? 'begin' : (head === 'COMMIT' ? 'commit' :
            (head === 'ROLLBACK' ? 'rollback' :
                ((head === 'SAVE' || head === 'SAVEPOINT') ? 'save' : ''))),
        target: target,
        staticTarget: !!target && target.charAt(0) !== '@'
    };
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
//# sourceMappingURL=dialects-state.js.map