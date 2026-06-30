module.exports = function (app) {
  let unsubscribes = []
  let timers = []

  const plugin = {
    id: 'signalk-fallback',
    name: 'SignalK Fallback',
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
              sourceSelection: {
                type: 'string',
                title: 'Source selection',
                enum: ['preferred', 'specific'],
                enumNames: ['Signal K source priorities', 'Specific source'],
                default: 'preferred',
                description:
                  'Choose whether to monitor the preferred source selected by Signal K priorities, or one specific $source.'
              },
              timeout: {
                type: 'number',
                title: 'Timeout (seconds)',
                description: 'Duration without update before fallback activates',
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
              sourceSelection: {
                oneOf: [
                  {
                    properties: {
                      sourceSelection: { enum: ['preferred'] }
                    }
                  },
                  {
                    properties: {
                      sourceSelection: { enum: ['specific'] },
                      watchedSource: {
                        type: 'string',
                        title: 'Specific source',
                        description: '$source identifier to monitor'
                      }
                    },
                    required: ['watchedSource']
                  }
                ]
              },
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
                        type: 'string',
                        title: 'Fixed value',
                        description: 'Value to publish when fallback is active. Enter a number (e.g. 0), a boolean (true/false), or a quoted string (e.g. "moored"). Parsed as JSON.'
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

    uiSchema: {
      rules: {
        items: {
          'ui:order': [
            'watchedPath',
            'sourceSelection',
            'watchedSource',
            'timeout',
            'interval',
            'fallbackType',
            'fixedValue',
            'fallbackPath'
          ]
        }
      }
    },

    start: function (options) {
      const rules = (options && options.rules) || []

      rules.forEach((rule) => {
        const {
          watchedPath,
          watchedSource,
          sourceSelection: configuredSourceSelection,
          timeout = 30,
          interval = 10,
          fallbackType = 'lastKnown',
          fixedValue,
          fallbackPath
        } = rule

        let lastValue = null
        let lastUpdateTime = null
        let fallbackActive = false
        const sourceSelection =
          configuredSourceSelection || (watchedSource ? 'specific' : 'preferred')
        const effectiveWatchedSource =
          sourceSelection === 'specific' ? watchedSource : undefined

        // Preferred-source rules should follow Signal K source
        // priorities while excluding this plugin's own republished value.
        // Specific-source rules need sourcePolicy:'all', otherwise a
        // non-preferred explicitly configured source may never be delivered.
        app.subscriptionmanager.subscribe(
          {
            context: 'vessels.self',
            subscribe: [{ path: watchedPath, period: 0 }],
            ...getSourceSubscriptionOptions(sourceSelection, watchedSource)
          },
          unsubscribes,
          err => app.error(err),
          delta => {
            delta.updates.forEach(update => {
              if (update.$source === plugin.id) return
              if (effectiveWatchedSource && update.$source !== effectiveWatchedSource) return
              update.values
                .filter(pv => pv.path === watchedPath)
                .forEach(pv => {
                  lastValue = pv.value
                  lastUpdateTime = Date.now()
                  if (fallbackActive) {
                    fallbackActive = false
                    app.debug(`[${watchedPath}] source restored, fallback deactivated`)
                  }
                  publishValue(watchedPath, pv.value)
                })
            })
          }
        )

        // Track the fallback path value in real time
        let fallbackPathValue = null
        if (fallbackType === 'otherPath' && fallbackPath) {
          app.subscriptionmanager.subscribe(
            {
              context: 'vessels.self',
              subscribe: [{ path: fallbackPath, period: 0 }],
              sourcePolicy: 'preferred',
              excludeSelf: true
            },
            unsubscribes,
            err => app.error(err),
            delta => {
              delta.updates.forEach(update => {
                if (update.$source === plugin.id) return
                update.values
                  .filter(pv => pv.path === fallbackPath)
                  .forEach(pv => { fallbackPathValue = pv.value })
              })
            }
          )
        }

        const timer = setInterval(() => {
          const elapsed =
            lastUpdateTime !== null
              ? (Date.now() - lastUpdateTime) / 1000
              : Infinity

          if (elapsed <= timeout) return

          if (!fallbackActive) {
            fallbackActive = true
            app.debug(
              `[${watchedPath}] no update for ${elapsed.toFixed(1)}s — fallback activated`
            )
          }

          let value = null
          if (fallbackType === 'fixed') {
            if (fixedValue !== undefined) {
              if (typeof fixedValue === 'string') {
                try { value = JSON.parse(fixedValue) } catch { value = fixedValue }
              } else {
                value = fixedValue
              }
            }
          } else if (fallbackType === 'lastKnown') {
            value = lastValue
          } else if (fallbackType === 'otherPath') {
            value = fallbackPathValue
          }

          if (value !== null && value !== undefined) {
            publishValue(watchedPath, value)
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

      function getSourceSubscriptionOptions(sourceSelection, watchedSource) {
        if (sourceSelection === 'specific' && watchedSource) {
          return { sourcePolicy: 'all' }
        }
        return { sourcePolicy: 'preferred', excludeSelf: true }
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
