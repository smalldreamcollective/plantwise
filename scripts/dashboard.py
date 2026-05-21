#!/usr/bin/env python3
"""
PlantWise iTerm2 dashboard

Opens a new tab with 4 panes:
  top-left     npm run sensor -- history
  top-right    npm run serve  (MQTT subscriber)
  bottom-left  shell (project root)
  bottom-right docker compose up

One-time setup:
  iTerm2 → Settings → General → Magic → Enable Python API
  pip install iterm2

Usage:
  python3 scripts/dashboard.py
"""

import os
import iterm2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


async def main(connection):
    app = await iterm2.async_get_app(connection)
    window = app.current_window

    if window is None:
        print("No open iTerm2 window found.")
        return

    tab = await window.async_create_tab()
    if tab is None:
        print("Failed to create tab.")
        return

    # Layout:
    #   ┌──────────────┬──────────────┐
    #   │   top-left   │  top-right   │
    #   ├──────────────┼──────────────┤
    #   │ bottom-left  │ bottom-right │
    #   └──────────────┴──────────────┘

    top_left = tab.current_session
    top_right = await top_left.async_split_pane(vertical=True)
    bottom_left = await top_left.async_split_pane(vertical=False)
    bottom_right = await top_right.async_split_pane(vertical=False)

    commands = {
        top_left:     "npm run sensor -- history\n",
        top_right:    "npm run serve\n",
        bottom_left:  None,
        bottom_right: "docker compose up\n",
    }

    for pane, cmd in commands.items():
        await pane.async_send_text(f"cd '{ROOT}'\n")
        if cmd:
            await pane.async_send_text(cmd)

    await top_left.async_activate()


iterm2.run_until_complete(main)
