# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/septiadini1996-sudo/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/septiadini1996-sudo/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. The program reads the sealed DefiLlama snapshot (758 protocols), finds every protocol that records no token yet and is not a wrapped, staked, bridged or versioned product of one that trades (198 of them, including all 40 on the house watchlist), and ranks them by an implied launch value derived only from the snapshot's own figures: each protocol's TVL multiplied by its category's median market-cap-to-TVL ratio among the snapshot's traded protocols — blended toward the all-category median in proportion to how few peers priced it — then tilted by seven-day TVL growth and by how long the protocol has run with no token recorded. Every row carries a concrete farm plan with capital, gas costs and timings, and the dashboard shows the ranked board, a per-protocol detail view with the model's own arithmetic, filters and sorting, and the traded protocols the radar sets aside.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=5c10w57m&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
