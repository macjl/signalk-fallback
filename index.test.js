jest.useFakeTimers()

const createPlugin = require('./index')

// Build a minimal mock of the SignalK app object
function makeApp() {
  const buses = {}

  return {
    debug: jest.fn(),

    streambundle: {
      getSelfBus(path) {
        if (!buses[path]) {
          buses[path] = {
            subscribers: [],
            // mirrors BaconJS .onValue(): delivers raw pathValue, returns unsubscribe fn
            onValue(fn) {
              this.subscribers.push(fn)
              return () => { this.subscribers = this.subscribers.filter(s => s !== fn) }
            }
          }
        }
        return buses[path]
      }
    },

    handleMessage: jest.fn(),

    // Helper: simulate an incoming delta on a path from a given source
    _emit(path, value, source = 'sensor.1') {
      const bus = buses[path]
      if (bus) bus.subscribers.forEach(fn => fn({ value, $source: source }))
    }
  }
}

// Extract published values from handleMessage calls
function published(app) {
  return app.handleMessage.mock.calls.map(
    ([, delta]) => delta.updates[0].values[0]
  )
}

// ─────────────────────────────────────────────
// 1. Source active → relay values
// ─────────────────────────────────────────────
test('relays incoming values to the output path', () => {
  const app = makeApp()
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

  const vals = published(app)
  expect(vals).toEqual([
    { path: 'navigation.speedOverGround', value: 3.5 },
    { path: 'navigation.speedOverGround', value: 4.2 }
  ])

  plugin.stop()
})

// ─────────────────────────────────────────────
// 2. Timeout → failback with fixed value
// ─────────────────────────────────────────────
test('publishes fixed fallback value after timeout', () => {
  const app = makeApp()
  const plugin = createPlugin(app)

  plugin.start({ rules: [{
    watchedPath:  'navigation.speedOverGround',
    timeout:      30,
    interval:     10,
    fallbackType: 'fixed',
    fixedValue:   0
  }]})

  // No signal at all — advance past timeout then one interval tick
  jest.advanceTimersByTime(41_000)

  const vals = published(app)
  expect(vals.length).toBeGreaterThan(0)
  vals.forEach(v => {
    expect(v.path).toBe('navigation.speedOverGround')
    expect(v.value).toBe(0)
  })

  plugin.stop()
})

// ─────────────────────────────────────────────
// 3. Timeout → failback with last known value
// ─────────────────────────────────────────────
test('publishes last known value after timeout', () => {
  const app = makeApp()
  const plugin = createPlugin(app)

  plugin.start({ rules: [{
    watchedPath:  'navigation.speedOverGround',
    timeout:      30,
    interval:     10,
    fallbackType: 'lastKnown'
  }]})

  // One good reading, then silence
  app._emit('navigation.speedOverGround', 5.1)
  app.handleMessage.mockClear()

  jest.advanceTimersByTime(41_000)

  const vals = published(app)
  expect(vals.length).toBeGreaterThan(0)
  vals.forEach(v => expect(v.value).toBe(5.1))

  plugin.stop()
})

// ─────────────────────────────────────────────
// 4. Timeout → failback with another path value
// ─────────────────────────────────────────────
test('publishes value from fallback path after timeout', () => {
  const app = makeApp()
  const plugin = createPlugin(app)

  plugin.start({ rules: [{
    watchedPath:  'navigation.speedOverGround',
    timeout:      30,
    interval:     10,
    fallbackType: 'otherPath',
    fallbackPath: 'navigation.speedThroughWater'
  }]})

  // Seed the fallback path
  app._emit('navigation.speedThroughWater', 4.8)
  app.handleMessage.mockClear()

  jest.advanceTimersByTime(41_000)

  const vals = published(app)
  expect(vals.length).toBeGreaterThan(0)
  vals.forEach(v => expect(v.value).toBe(4.8))

  plugin.stop()
})

// ─────────────────────────────────────────────
// 5. Source resumes → failback deactivates
// ─────────────────────────────────────────────
test('stops failback when source resumes and relays live values', () => {
  const app = makeApp()
  const plugin = createPlugin(app)

  plugin.start({ rules: [{
    watchedPath:  'navigation.speedOverGround',
    timeout:      30,
    interval:     10,
    fallbackType: 'fixed',
    fixedValue:   0
  }]})

  // Trigger failback
  jest.advanceTimersByTime(41_000)

  // Source resumes
  app.handleMessage.mockClear()
  app._emit('navigation.speedOverGround', 6.0)

  // One more interval — should NOT produce a fixed=0 publication
  jest.advanceTimersByTime(10_000)

  const vals = published(app)
  // The live relay must be present
  expect(vals.some(v => v.value === 6.0)).toBe(true)
  // No more fallback 0 values after resume
  expect(vals.filter(v => v.value === 0)).toHaveLength(0)

  plugin.stop()
})

// ─────────────────────────────────────────────
// 6. Source filter — ignore other sources
// ─────────────────────────────────────────────
test('ignores updates from sources not matching the filter', () => {
  const app = makeApp()
  const plugin = createPlugin(app)

  plugin.start({ rules: [{
    watchedPath:   'navigation.speedOverGround',
    watchedSource: 'gps.primary',
    timeout:       30,
    interval:      10,
    fallbackType:  'fixed',
    fixedValue:    0
  }]})

  // Update from a different source — should not count
  app._emit('navigation.speedOverGround', 3.0, 'gps.secondary')
  app.handleMessage.mockClear()

  jest.advanceTimersByTime(41_000)

  const vals = published(app)
  // Only fallback (fixed=0) should appear, not the filtered-out value
  vals.forEach(v => expect(v.value).toBe(0))

  plugin.stop()
})

// ─────────────────────────────────────────────
// 7. Source filter — accept matching source
// ─────────────────────────────────────────────
test('accepts updates from the configured source', () => {
  const app = makeApp()
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

  expect(published(app)).toEqual([
    { path: 'navigation.speedOverGround', value: 3.0 }
  ])

  plugin.stop()
})

// ─────────────────────────────────────────────
// 8. Interval controls publication frequency
// ─────────────────────────────────────────────
test('publishes at the configured interval during failback', () => {
  const app = makeApp()
  const plugin = createPlugin(app)

  plugin.start({ rules: [{
    watchedPath:  'navigation.speedOverGround',
    timeout:      10,
    interval:     5,
    fallbackType: 'fixed',
    fixedValue:   99
  }]})

  // Seed lastUpdateTime so the timeout countdown is well-defined
  app._emit('navigation.speedOverGround', 1.0)
  app.handleMessage.mockClear()

  // Advance past timeout, then exactly 3 interval ticks
  // Ticks at t=5s (skip, elapsed≤10), t=10s (skip, elapsed≤10),
  // t=15s (publish), t=20s (publish), t=25s (publish)
  jest.advanceTimersByTime(10_001 + 3 * 5_000)

  const vals = published(app).filter(v => v.value === 99)
  expect(vals.length).toBe(3)

  plugin.stop()
})

// ─────────────────────────────────────────────
// 9. Multiple independent rules
// ─────────────────────────────────────────────
test('handles multiple rules independently', () => {
  const app = makeApp()
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
  jest.advanceTimersByTime(41_000)

  const vals = published(app)
  const sogVals = vals.filter(v => v.path === 'navigation.speedOverGround')
  const hdgVals = vals.filter(v => v.path === 'navigation.headingTrue')

  // SOG: 1 live relay + failback 0s
  expect(sogVals.some(v => v.value === 5.0)).toBe(true)
  expect(sogVals.some(v => v.value === 0)).toBe(true)

  // Heading: only failback 180s (never received a live value)
  expect(hdgVals.every(v => v.value === 180)).toBe(true)

  plugin.stop()
})

// ─────────────────────────────────────────────
// 10. Plugin own messages are ignored (no loop)
// ─────────────────────────────────────────────
test('ignores its own published values to avoid feedback loops', () => {
  const app = makeApp()
  const plugin = createPlugin(app)

  plugin.start({ rules: [{
    watchedPath:  'navigation.speedOverGround',
    timeout:      30,
    interval:     10,
    fallbackType: 'lastKnown'
  }]})

  // Simulate the plugin receiving its own delta
  app._emit('navigation.speedOverGround', 7.7, 'signalk-failback')
  app.handleMessage.mockClear()

  // Should NOT have updated lastUpdateTime — failback must still kick in
  jest.advanceTimersByTime(41_000)
  const vals = published(app)
  // lastValue is still null since own messages are ignored → nothing published
  expect(vals).toHaveLength(0)

  plugin.stop()
})
