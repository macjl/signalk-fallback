# signalk-fallback

SignalK plugin that monitors a path/source and publishes a fallback value when no update has been received within a configurable timeout.

## Features

- Monitors any SignalK path, optionally filtered by source (`$source` identifier)
- Activates fallback when no update is received within the configured timeout
- Three fallback modes:
  - **Fixed value** — publish a constant (number, boolean, or string)
  - **Last known value** — republish the last received value
  - **Other path** — use the current value of another SignalK path
- Multiple independent rules can run simultaneously
- Automatically deactivates fallback when the source resumes

## How it works

The plugin acts as a **transparent relay**: it republishes every incoming update from the monitored path under its own source identifier (`signalk-fallback`). This means the `signalk-fallback` source is always up-to-date during normal operation, and keeps publishing (with the fallback value) when the real source goes silent. The transition is seamless — there is no gap between live and fallback mode.

As a consequence, the Signal K data model will contain two sources for each monitored path: the original source and `signalk-fallback`. To ensure downstream consumers see the plugin's values, configure Signal K's **source priorities** to prefer `signalk-fallback` for those paths.

> **Startup behaviour**: if the plugin starts before a monitored path has received any update, the fallback activates immediately (elapsed time is treated as infinite). This is by design — the plugin cannot distinguish between a slow sensor and an absent one at startup.

## Use cases

### Instruments turned off at the dock

When moored, you may shut down some instruments (log, depth sounder…) while keeping the navigation software running. Without a speed-through-water signal, any plugin that computes **true wind speed** will stop working or produce invalid results, because the formula requires both wind and boat speed.

Configure the plugin to publish `navigation.speedThroughWater = 0` as soon as the log goes silent. True wind calculations keep running correctly, since a stationary boat does indeed have a speed of zero through the water.

### COG fallback to heading at low speed

Most GPS receivers stop publishing a reliable **Course Over Ground** (`navigation.courseOverGroundTrue`) when the boat is stationary or moving very slowly, because COG is meaningless at zero SOG. However, some derived calculations (routing, autopilot, wind correction) expect a continuous COG value.

Configure the plugin to substitute `navigation.headingTrue` for COG whenever the GPS goes silent on that path. When the boat is not moving, heading is the best available approximation of intended course.

### Keeping derived calculations alive at anchor

On anchor watch, some instruments may be switched off to save power (log, wind, depth). Plugins that compute VMG, set & drift, or leeway need continuous input values to function. Using the **last known value** mode keeps those paths populated with the last valid reading, so dashboards and alarm systems remain operational.

### Sensor failure watchdog

If a sensor unexpectedly stops transmitting (hardware fault, NMEA bus issue), the plugin acts as a watchdog: it detects the silence, logs it via SignalK debug output, and substitutes a safe default value so that downstream calculations degrade gracefully rather than crashing.

## Installation

From the SignalK admin UI → Plugin Store, search for `signalk-fallback`.

Or manually:
```bash
npm install signalk-fallback
```

## Configuration

Rules are defined as an array. Each rule accepts the following parameters:

| Parameter | Default | Description |
|---|---|---|
| `watchedPath` | — | SignalK path to monitor |
| `watchedSource` | — | (Optional) Only consider updates from this `$source` |
| `timeout` | `30` s | Duration without update before fallback activates |
| `interval` | `10` s | How often to publish the fallback value while inactive |
| `fallbackType` | `lastKnown` | `fixed`, `lastKnown`, or `otherPath` |
| `fixedValue` | — | Value to publish when type is `fixed`. Enter a number (`0`), boolean (`true`/`false`), or JSON string (`"moored"`). Parsed as JSON. |
| `fallbackPath` | — | Source path when type is `otherPath` |

## Example

```json
{
  "rules": [
    {
      "watchedPath": "navigation.speedThroughWater",
      "timeout": 30,
      "interval": 10,
      "fallbackType": "fixed",
      "fixedValue": 0
    },
    {
      "watchedPath": "navigation.speedOverGround",
      "watchedSource": "gps.primary",
      "timeout": 15,
      "interval": 5,
      "fallbackType": "otherPath",
      "fallbackPath": "navigation.speedThroughWater"
    }
  ]
}
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT
