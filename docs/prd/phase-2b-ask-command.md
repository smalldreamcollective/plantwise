# PRD — Phase 2B: ask Command (tabled)

## Status
Tabled — revisit after Phase 4 sensor work

## Goal
Allow users to ask natural language questions about a specific plant, with the agent pulling relevant context (species, watering history, health checks) before answering via Claude.

## Proposed usage
```bash
npm run ask -- 1 "Why are my leaves turning yellow?"
npm run ask -- 2 "How often should I water this in winter?"
```

## Rough design
- Accepts a plant ID and a free-text question
- Agent loads plant record + recent health checks + last care events as context
- Claude answers in plain language using that context
- No API call to Plant.id — Claude-only

## Why tabled
- `diagnose` covers the most critical Q&A use case (photo-based, with context)
- IoT sensor integration is higher priority and more differentiating
- Can be added cheaply once the agent pattern is well established
