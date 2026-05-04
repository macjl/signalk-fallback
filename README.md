# signalk-failback

SignalK plugin that monitors a path/source and publishes a fallback value when no update has been received within a configurable timeout.

## Features

- Monitors any SignalK path, optionally filtered by source (`$source` identifier)
- Activates failback when no update is received within the configured timeout
- Three failback modes:
  - **Fixed value** — publish a constant
  - **Last known value** — republish the last received value
  - **Other path** — use the current value of another SignalK path
- Multiple independent rules can run simultaneously
- Automatically deactivates failback when the source resumes

## Use cases

### Instruments turned off at the dock

When moored, you may shut down some instruments (log, depth sounder…) while keeping the navigation software running. Without a speed-through-water signal, any plugin that computes **true wind speed** will stop working or produce invalid results, because the formula requires both wind and boat speed.

Configure the plugin to publish `navigation.speedThroughWater = 0` as soon as the log goes silent. True wind calculations keep running correctly, since a stationary boat does indeed have a speed of zero through the water.

### Redundant GPS source

If your primary GPS stops sending data, the plugin can automatically fall back to a secondary GPS by reading `navigation.position` from a different `$source` — or from a completely different path — and republishing it on the expected output path. Your chart plotter, AIS transponder and autopilot keep receiving a position without any manual intervention.

### Keeping derived calculations alive at anchor

On anchor watch, some instruments may be switched off to save power (log, wind, depth). Plugins that compute VMG, set & drift, or leeway need continuous input values to function. Using the **last known value** mode keeps those paths populated with the last valid reading, so dashboards and alarm systems remain operational.

### Sensor failure watchdog

If a sensor unexpectedly stops transmitting (hardware fault, NMEA bus issue), the plugin acts as a watchdog: it detects the silence, logs it via SignalK debug output, and substitutes a safe default value so that downstream calculations degrade gracefully rather than crashing.

## Installation

From the SignalK admin UI → Plugin Store, search for `signalk-failback`.

Or manually:
```bash
npm install signalk-failback
```

## Configuration

Rules are defined as an array. Each rule accepts the following parameters:

| Parameter | Default | Description |
|---|---|---|
| `watchedPath` | — | SignalK path to monitor |
| `watchedSource` | — | (Optional) Only consider updates from this `$source` |
| `outputPath` | same as `watchedPath` | Path to publish the value to |
| `timeout` | `30` s | Duration without update before failback activates |
| `interval` | `10` s | How often to publish the fallback value while inactive |
| `fallbackType` | `lastKnown` | `fixed`, `lastKnown`, or `otherPath` |
| `fixedValue` | — | Value to publish when type is `fixed` |
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
      "outputPath": "navigation.speedOverGround",
      "timeout": 15,
      "interval": 5,
      "fallbackType": "otherPath",
      "fallbackPath": "navigation.speedThroughWater"
    }
  ]
}
```

## License

MIT
