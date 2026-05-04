'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const createPlugin = require('./index')

function makeApp(t) {
  const buses = {}
  return {
    debug: t.mock.fn(),

    streambundle: {
      getSelfBus(path) {
        if (!buses[path]) {
          buses[path] = {
            subscribers: [],
            onValue(fn) {
              this.subscribers.push(fn)
              return () => { this.subscribers = this.subscribers.filter(s => s !== fn) }
            }
          }
        }
        return buses[path]
      }
    },

    handleMessage: t.mock.fn(),

    _emit(path, value, source = 'sensor.1') {
      const bus = buses[path]
      if (bus) bus.subscribers.forEach(fn => fn({ value, $source: source }))
    }
  }
}

function published(app) {
  return app.handleMessage.mock.calls.map(
    call => call.arguments[1].updates[0].values[0]
  )
}

// ─────────────────────────────────────────────
// 1. Source active → relay values
// ─────────────────────────────────────────────
test('relays incoming values to the output path', (t) => {
  const app = makeApp(t)
  const plugin = createPlugin(app)

  plugin.start({ rules: [{
    watchedPath: 'navigation.speedOverGround',
    outputPath:  'navigation.speedOverGround',
    timeout:     30,
    interval:    10,
    fallbackType: 'lastKnown'
  }]})

  app._emit('navigation.speedOverGround', 3.5)
  app._emit('navigation.speedOverGround', 4.2)

  assert.deepStrictEqual(published(app), [
    { path: 'navigation.speedOverGround', value: 3.5 },
    { path: 'navigation.speedOverGround', value: 4.2 }
  ])

  plugin.stop()
})

// ─────────────────────────────────────────────
// 2. Timeout → failback with fixed value
// ─────────────────────────────────────────────
test('publishes fixed fallback value after timeout', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const app = makeApp(t)
  const plugin = createPlugin(app)

  plugin.start({ rules: [{
    watchedPath:  'navigation.speedOverGround',
    timeout:      30,
    interval:     10,
    fallbackType: 'fixed',
    fixedValue:   0
  }]})

  // No signal — elapsed = Infinity > timeout from the first tick
  t.mock.timers.tick(41_000)

  const vals = published(app)
  assert.ok(vals.length > 0)
  vals.forEach(v => {
    assert.strictEqual(v.path, 'navigation.speedOverGround')
    assert.strictEqual(v.value, 0)
  })

  plugin.stop()
})

// ─────────────────────────────────────────────
// 3. Timeout → failback with last known value
// ─────────────────────────────────────────────
test('publishes last known value after timeout', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const app = makeApp(t)
  const plugin = createPlugin(app)

  plugin.start({ rules: [{
    watchedPath:  'navigation.speedOverGround',
    timeout:      30,
    interval:     10,
    fallbackType: 'lastKnown'
  }]})

  app._emit('navigation.speedOverGround', 5.1)
  app.handleMessage.mock.resetCalls()

  t.mock.timers.tick(41_000)

  const vals = published(app)
  assert.ok(vals.length > 0)
  vals.forEach(v => assert.strictEqual(v.value, 5.1))

  plugin.stop()
})

// ─────────────────────────────────────────────
// 4. Timeout → failback with another path value
// ─────────────────────────────────────────────
test('publishes value from fallback path after timeout', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const app = makeApp(t)
  const plugin = createPlugin(app)

  plugin.start({ rules: [{
    watchedPath:  'navigation.speedOverGround',
    timeout:      30,
    interval:     10,
    fallbackType: 'otherPath',
    fallbackPath: 'navigation.speedThroughWater'
  }]})

  app._emit('navigation.speedThroughWater', 4.8)
  app.handleMessage.mock.resetCalls()

  t.mock.timers.tick(41_000)

  const vals = published(app)
  assert.ok(vals.length > 0)
  vals.forEach(v => assert.strictEqual(v.value, 4.8))

  plugin.stop()
})

// ─────────────────────────────────────────────
// 5. Source resumes → failback deactivates
// ─────────────────────────────────────────────
test('stops failback when source resumes and relays live values', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const app = makeApp(t)
  const plugin = createPlugin(app)

  plugin.start({ rules: [{
    watchedPath:  'navigation.speedOverGround',
    timeout:      30,
    interval:     10,
    fallbackType: 'fixed',
    fixedValue:   0
  }]})

  t.mock.timers.tick(41_000)

  app.handleMessage.mock.resetCalls()
  app._emit('navigation.speedOverGround', 6.0)

  t.mock.timers.tick(10_000)

  const vals = published(app)
  assert.ok(vals.some(v => v.value === 6.0))
  assert.strictEqual(vals.filter(v => v.value === 0).length, 0)

  plugin.stop()
})

// ─────────────────────────────────────────────
// 6. Source filter — ignore other sources
// ─────────────────────────────────────────────
test('ignores updates from sources not matching the filter', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const app = makeApp(t)
  const plugin = createPlugin(app)

  plugin.start({ rules: [{
    watchedPath:   'navigation.speedOverGround',
    watchedSource: 'gps.primary',
    timeout:       30,
    interval:      10,
    fallbackType:  'fixed',
    fixedValue:    0
  }]})

  app._emit('navigation.speedOverGround', 3.0, 'gps.secondary')
  app.handleMessage.mock.resetCalls()

  t.mock.timers.tick(41_000)

  published(app).forEach(v => assert.strictEqual(v.value, 0))

  plugin.stop()
})

// ─────────────────────────────────────────────
// 7. Source filter — accept matching source
// ─────────────────────────────────────────────
test('accepts updates from the configured source', (t) => {
  const app = makeApp(t)
  const plugin = createPlugin(app)

  plugin.start({ rules: [{
    watchedPath:   'navigation.speedOverGround',
    watchedSource: 'gps.primary',
    timeout:       30,
    interval:      10,
    fallbackType:  'fixed',
    fixedValue:    0
  }]})

  app._emit('navigation.speedOverGround', 3.0, 'gps.primary')

  assert.deepStrictEqual(published(app), [
    { path: 'navigation.speedOverGround', value: 3.0 }
  ])

  plugin.stop()
})

// ─────────────────────────────────────────────
// 8. Interval controls publication frequency
// ─────────────────────────────────────────────
test('publishes at the configured interval during failback', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const app = makeApp(t)
  const plugin = createPlugin(app)

  plugin.start({ rules: [{
    watchedPath:  'navigation.speedOverGround',
    timeout:      10,
    interval:     5,
    fallbackType: 'fixed',
    fixedValue:   99
  }]})

  // No emit → lastUpdateTime = null → elapsed = Infinity → failback active immediately
  // Tick exactly 3 interval periods → exactly 3 callbacks
  t.mock.timers.tick(3 * 5_000)

  const vals = published(app).filter(v => v.value === 99)
  assert.strictEqual(vals.length, 3)

  plugin.stop()
})

// ─────────────────────────────────────────────
// 9. Multiple independent rules
// ─────────────────────────────────────────────
test('handles multiple rules independently', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const app = makeApp(t)
  const plugin = createPlugin(app)

  plugin.start({ rules: [
    {
      watchedPath:  'navigation.speedOverGround',
      outputPath:   'navigation.speedOverGround',
      timeout:      30,
      interval:     10,
      fallbackType: 'fixed',
      fixedValue:   0
    },
    {
      watchedPath:  'navigation.headingTrue',
      outputPath:   'navigation.headingTrue',
      timeout:      30,
      interval:     10,
      fallbackType: 'fixed',
      fixedValue:   180
    }
  ]})

  app._emit('navigation.speedOverGround', 5.0)
  t.mock.timers.tick(41_000)

  const vals = published(app)
  const sogVals = vals.filter(v => v.path === 'navigation.speedOverGround')
  const hdgVals = vals.filter(v => v.path === 'navigation.headingTrue')

  assert.ok(sogVals.some(v => v.value === 5.0))
  assert.ok(sogVals.some(v => v.value === 0))
  assert.ok(hdgVals.every(v => v.value === 180))

  plugin.stop()
})

// ─────────────────────────────────────────────
// 10. Plugin own messages are ignored (no loop)
// ─────────────────────────────────────────────
test('ignores its own published values to avoid feedback loops', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const app = makeApp(t)
  const plugin = createPlugin(app)

  plugin.start({ rules: [{
    watchedPath:  'navigation.speedOverGround',
    timeout:      30,
    interval:     10,
    fallbackType: 'lastKnown'
  }]})

  app._emit('navigation.speedOverGround', 7.7, 'signalk-failback')
  app.handleMessage.mock.resetCalls()

  // lastValue is null (own message was ignored) → nothing published during failback
  t.mock.timers.tick(41_000)
  assert.strictEqual(published(app).length, 0)

  plugin.stop()
})
