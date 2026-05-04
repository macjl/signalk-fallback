module.exports = function (app) {
  let unsubscribes = []
  let timers = []

  const plugin = {
    id: 'signalk-failback',
    name: 'SignalK Failback',
    description:
      'Publishes a fallback value when a monitored path/source stops being updated',

    schema: {
      type: 'object',
      properties: {
        rules: {
          type: 'array',
          title: 'Failback rules',
          items: {
            type: 'object',
            required: ['watchedPath', 'timeout', 'interval', 'fallbackType'],
            properties: {
              watchedPath: {
                type: 'string',
                title: 'Path to monitor',
                description: 'SignalK path to watch for updates (e.g. navigation.speedOverGround)'
              },
              watchedSource: {
                type: 'string',
                title: 'Source filter (optional)',
                description:
                  'If set, only consider updates from this source ($source identifier)'
              },
              outputPath: {
                type: 'string',
                title: 'Output path (optional)',
                description:
                  'Path to publish the value to. Defaults to the watched path if left empty.'
              },
              timeout: {
                type: 'number',
                title: 'Timeout (seconds)',
                description: 'Duration without update before failback activates',
                default: 30
              },
              interval: {
                type: 'number',
                title: 'Publish interval (seconds)',
                description: 'How often to publish the fallback value while source is inactive',
                default: 10
              },
              fallbackType: {
                type: 'string',
                title: 'Fallback value type',
                enum: ['fixed', 'lastKnown', 'otherPath'],
                enumNames: ['Fixed value', 'Last known value', 'Other path value'],
                default: 'lastKnown'
              }
            },
            dependencies: {
              fallbackType: {
                oneOf: [
                  {
                    properties: {
                      fallbackType: { enum: ['lastKnown'] }
                    }
                  },
                  {
                    properties: {
                      fallbackType: { enum: ['fixed'] },
                      fixedValue: {
                        type: 'number',
                        title: 'Fixed value',
                        description: 'Value to publish when failback is active'
                      }
                    },
                    required: ['fixedValue']
                  },
                  {
                    properties: {
                      fallbackType: { enum: ['otherPath'] },
                      fallbackPath: {
                        type: 'string',
                        title: 'Fallback path',
                        description: 'Path whose current value is used as fallback'
                      }
                    },
                    required: ['fallbackPath']
                  }
                ]
              }
            }
          }
        }
      }
    },

    start: function (options) {
      const rules = (options && options.rules) || []

      // Prefer getUnfilteredBus (SignalK v2+ with sourcePolicy:all) so that
      // updates from every source reach the plugin regardless of configured
      // source priorities. Falls back to getSelfBus on older servers.
      const getBus = (path) =>
        typeof app.streambundle.getUnfilteredBus === 'function'
          ? app.streambundle.getUnfilteredBus(path)
          : app.streambundle.getSelfBus(path)

      rules.forEach((rule) => {
        const {
          watchedPath,
          watchedSource,
          timeout = 30,
          interval = 10,
          fallbackType = 'lastKnown',
          fixedValue,
          fallbackPath
        } = rule

        const outputPath = rule.outputPath && rule.outputPath.trim() !== ''
          ? rule.outputPath.trim()
          : watchedPath

        let lastValue = null
        let lastUpdateTime = null
        let failbackActive = false

        const unsub = getBus(watchedPath).onValue((sv) => {
          if (sv.$source === plugin.id) return

          if (watchedSource && sv.$source !== watchedSource) return

          lastValue = sv.value
          lastUpdateTime = Date.now()

          if (failbackActive) {
            failbackActive = false
            app.debug(`[${watchedPath}] source restored, failback deactivated`)
          }

          publishValue(outputPath, sv.value)
        })

        unsubscribes.push(unsub)

        // Track the fallback path value in real time
        let fallbackPathValue = null
        if (fallbackType === 'otherPath' && fallbackPath) {
          const fbUnsub = getBus(fallbackPath).onValue((sv) => {
            if (sv.$source === plugin.id) return
            fallbackPathValue = sv.value
          })
          unsubscribes.push(fbUnsub)
        }

        const timer = setInterval(() => {
          const elapsed =
            lastUpdateTime !== null
              ? (Date.now() - lastUpdateTime) / 1000
              : Infinity

          if (elapsed <= timeout) return

          if (!failbackActive) {
            failbackActive = true
            app.debug(
              `[${watchedPath}] no update for ${elapsed.toFixed(1)}s — failback activated`
            )
          }

          let value = null
          if (fallbackType === 'fixed') {
            value = fixedValue !== undefined ? fixedValue : null
          } else if (fallbackType === 'lastKnown') {
            value = lastValue
          } else if (fallbackType === 'otherPath') {
            value = fallbackPathValue
          }

          if (value !== null && value !== undefined) {
            publishValue(outputPath, value)
          }
        }, interval * 1000)

        timers.push(timer)
      })

      function publishValue(path, value) {
        app.handleMessage(plugin.id, {
          updates: [
            {
              values: [{ path, value }]
            }
          ]
        })
      }
    },

    stop: function () {
      unsubscribes.forEach((fn) => fn())
      unsubscribes = []
      timers.forEach((t) => clearInterval(t))
      timers = []
    }
  }

  return plugin
}
