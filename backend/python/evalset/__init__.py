"""Jasper's quality + latency test set: checkable tasks, a scorer, a runner, run-to-run comparison.

`tasks.py`   the tasks (what to ask, how to check the answer)
`runner.py`  scoring, summary, comparison, the HTTP caller and the command line
`nightly.py` the scheduled run (skips itself when the PC is busy) and the regression alert
"""
