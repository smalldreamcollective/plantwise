# Phase 3D — Identify + Add Flow with Care Recommendations

## Problem
The `identify` command identifies a plant but doesn't help the user add it to their collection with appropriate care settings. Users have to manually look up moisture thresholds and watering intervals per species.

## Solution
After identification, Claude returns structured care recommendations alongside the identification result. The CLI then prompts the user to add the plant with those values pre-filled.

## Flow

```
plantwise identify ./photo.jpg

Identified: Monstera deliciosa (87% confidence)
Monstera deliciosa is a tropical plant native to...

Recommended care:
  Watering interval : 7 days
  Moisture low      : 40%
  Moisture high     : 80%
  Notes             : Allow soil to dry between waterings...

Add this plant? [Y/n]: y
Name [Monstera deliciosa]: My Monstera
Added "My Monstera" [ID: 5]
```

## Implementation

### Agent system prompt (`graph.ts`)
For the `identify` command, append instructions to include a JSON block at the end of the response:

```
After identifying the plant, append a JSON block with care recommendations:
\`\`\`json
{"name":"...","species":"...","watering_interval_days":7,"moisture_threshold_pct":40,"moisture_upper_threshold_pct":80,"notes":"..."}
\`\`\`
```

### CLI (`src/cli/index.ts`)
1. Run the agent as usual
2. Extract the JSON block from the response (strip it from display output)
3. Display the identification text
4. Prompt: "Add this plant? [Y/n]"
5. If yes, prompt for name (default: identified species name)
6. Call `insertPlant` with pre-filled values
7. Confirm with plant ID

### No new tools needed
`insertPlant` already accepts all required fields.

## Out of Scope
- Editing individual threshold values at the prompt (user can run `plantwise update <id>` after)
- Multiple identification results (use the top match for care recommendations)
