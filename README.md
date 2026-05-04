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
