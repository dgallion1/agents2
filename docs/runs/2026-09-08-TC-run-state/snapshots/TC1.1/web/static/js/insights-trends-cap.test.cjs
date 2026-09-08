// TC1: unit tests for the two pure helpers behind "the trends chart
// follows the table cap" -- visibleTrendCategories / filterTrendTraces,
// exposed on window.insightsTrends. Loads insights.js in a vm with a
// minimal fake document/window (no real DOM), same pattern as
// page-refresh.test.cjs: the harness only needs to survive insights.js's
// top-level statements (event-listener registration, the init call to
// applyTrendsCap()); the functions under test are called directly with
// plain-object fixtures, not through the DOM.
const {test} = require('node:test');
// Loose (non-strict) assert: filterTrendTraces runs inside a vm context, so
// its return values (including nested arrays built with `[]`/JSON.parse
// inside that sandbox) belong to a different realm than the array/object
// literals this file writes to compare against. deepStrictEqual additionally
// checks prototype identity and would fail on realm alone even when every
// value matches; deepEqual compares structurally, which is what's under test.
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function load() {
    const window = {
        addEventListener() {},
        localStorage: {getItem() { return null; }, setItem() {}}
    };
    const document = {
        readyState: 'complete',
        body: {addEventListener() {}},
        addEventListener() {},
        getElementById() { return null; } // no live table/chart in this harness
    };
    // Leave Array/JSON/Object/Math unset: vm.createContext gives every
    // sandbox its own consistent set of these intrinsics automatically.
    // Injecting the host's would make JSON.parse (host-realm objects) and
    // array literals (still sandbox-realm, syntax always binds to the
    // executing realm) disagree within the SAME value insights.js builds.
    const context = {document, window, console};
    vm.createContext(context);
    const source = fs.readFileSync(__dirname + '/insights.js', 'utf8');
    vm.runInContext(source, context);
    return context.window.insightsTrends;
}

const trends = load();

function fakeTable(rows) {
    // rows: [{category, hidden}]
    const trs = rows.map(r => ({hidden: !!r.hidden, dataset: {category: r.category}}));
    return {
        querySelector(sel) {
            if (sel !== 'tbody') return null;
            return {querySelectorAll(s) { return s === 'tr' ? trs : []; }};
        }
    };
}

function fixture5() {
    return {
        period: {},
        data: [
            {
                type: 'bar', name: 'Current', x: ['A', 'B', 'C', 'D', 'E'], y: [10, 20, 30, 40, 50],
                marker: {color: ['red', 'green', 'gray', 'red', 'green']}
            },
            {
                type: 'bar', name: 'Prior', x: ['A', 'B', 'C', 'D', 'E'], y: [1, 2, 3, 4, 5],
                marker: {color: '#94a3b8'}
            }
        ],
        layout: {barmode: 'group'}
    };
}

test('exposes the two pure functions on window.insightsTrends', () => {
    assert.equal(typeof trends.visibleTrendCategories, 'function');
    assert.equal(typeof trends.filterTrendTraces, 'function');
});

test('filterTrendTraces: 3-of-5 subset in a different order filters+reorders both traces, x/y/colours together, height = max(360, n*38+120)', () => {
    const raw = fixture5();
    const before = JSON.stringify(raw);
    const result = trends.filterTrendTraces(raw, ['C', 'A', 'D']);

    assert.deepEqual(result.data[0].x, ['C', 'A', 'D']);
    assert.deepEqual(result.data[0].y, [30, 10, 40]);
    assert.deepEqual(result.data[0].marker.color, ['gray', 'red', 'red']);

    assert.deepEqual(result.data[1].x, ['C', 'A', 'D']);
    assert.deepEqual(result.data[1].y, [3, 1, 4]);
    assert.equal(result.data[1].marker.color, '#94a3b8'); // scalar marker untouched, not filtered as an array

    assert.equal(result.layout.height, Math.max(360, 3 * 38 + 120));

    // raw is not mutated
    assert.equal(JSON.stringify(raw), before);
    assert.notEqual(result, raw);
    assert.notEqual(result.data[0], raw.data[0]);
});

test('filterTrendTraces: empty subset returns empty traces at height 360', () => {
    const raw = fixture5();
    const before = JSON.stringify(raw);
    const result = trends.filterTrendTraces(raw, []);

    assert.deepEqual(result.data[0].x, []);
    assert.deepEqual(result.data[0].y, []);
    assert.deepEqual(result.data[0].marker.color, []);
    assert.deepEqual(result.data[1].x, []);
    assert.deepEqual(result.data[1].y, []);
    assert.equal(result.layout.height, 360);

    assert.equal(JSON.stringify(raw), before);
});

test('filterTrendTraces: full set in original order round-trips (table-absent fallback shape) at the full-count height', () => {
    const raw = fixture5();
    const result = trends.filterTrendTraces(raw, raw.data[0].x);
    assert.deepEqual(result.data[0].x, ['A', 'B', 'C', 'D', 'E']);
    assert.deepEqual(result.data[0].y, [10, 20, 30, 40, 50]);
    assert.deepEqual(result.data[0].marker.color, ['red', 'green', 'gray', 'red', 'green']);
    assert.equal(result.layout.height, Math.max(360, 5 * 38 + 120));
});

test('visibleTrendCategories: only non-hidden rows, in DOM order', () => {
    const table = fakeTable([
        {category: 'A', hidden: false},
        {category: 'B', hidden: true},
        {category: 'C', hidden: false},
        {category: 'D', hidden: true},
        {category: 'E', hidden: false}
    ]);
    assert.deepEqual(trends.visibleTrendCategories(table), ['A', 'C', 'E']);
});

test('visibleTrendCategories: all-visible table returns every category in order', () => {
    const table = fakeTable([
        {category: 'Groceries', hidden: false},
        {category: 'Utilities', hidden: false}
    ]);
    assert.deepEqual(trends.visibleTrendCategories(table), ['Groceries', 'Utilities']);
});
