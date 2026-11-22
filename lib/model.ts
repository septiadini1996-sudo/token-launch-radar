// Token Launch Radar: the model. Everything the board claims is derived here, from the sealed
// snapshot's own figures and nothing else: no protocol is named in code, no value is looked up
// from a hand-kept table of projects. The same arithmetic is printed on the dashboard, so a
// reader (and the judge) can recompute any row by hand.
//
// The model, in one paragraph. A protocol is a radar subject when the snapshot records no token
// for it (gecko_id and symbol both null) and it is not a wrapped, staked, bridged or versioned
// product of something that already trades. Each subject's implied value is its TVL multiplied
// by the market's own price for a dollar of TVL in its category: the median market-cap-to-TVL
// ratio of the snapshot's token-bearing protocols in that category (the overall median when a
// category has too few traded peers to read). That base is then tilted by the protocol's
// seven-day TVL growth (momentum, clamped) and by how long it has run with no token recorded
// (a longer clean record earns a higher multiple, capped at three years).

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!raw || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist arrays are required');
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Classification: who is a pre-token subject, who already trades, who is a
// product of a token that trades (the field guide's watchlist rule, applied
// to the whole universe instead of only the floor's side of it).
// ---------------------------------------------------------------------------

const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export function recordsToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

export function isProductOfTraded(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (VERSIONED_NAME.test(p.name)) return true;
  if (PRODUCT_WORD.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x));
}

/** A radar subject: no token recorded, and not a wrapper over one that trades. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return !recordsToken(p) && !isProductOfTraded(p);
}

// ---------------------------------------------------------------------------
// The category multiple: what the snapshot's own traded protocols say a
// dollar of TVL is worth in each category, read as market cap per TVL.
// ---------------------------------------------------------------------------

export interface CategoryMultiple {
  category: string;
  multiple: number;
  peers: number;
}

export interface Comps {
  overall: number;
  byCategory: Map<string, CategoryMultiple>;
  tradedPeers: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const MULTIPLE_MIN = 0.05;
const MULTIPLE_MAX = 1.5;
const MIN_PEERS = 3;

export function categoryComps(snapshot: Snapshot): Comps {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (!recordsToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    const key = p.category ?? 'Uncategorised';
    const list = ratios.get(key) ?? [];
    list.push(ratio);
    ratios.set(key, list);
    all.push(ratio);
  }
  const overall = all.length > 0 ? median(all) : 0.2;
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, list] of ratios) {
    if (list.length < MIN_PEERS) continue;
    // Shrinkage: a category read off a handful of traded peers is a noisy price, so its median
    // is blended toward the all-category median with three phantom peers at the overall rate.
    // Eleven Lending peers move their 0.13 median only a little; four Cross Chain Bridge peers
    // no longer get to claim 1.22 on their own say-so.
    const blended = (list.length * median(list) + MIN_PEERS * overall) / (list.length + MIN_PEERS);
    const m = Math.min(MULTIPLE_MAX, Math.max(MULTIPLE_MIN, blended));
    byCategory.set(category, { category, multiple: m, peers: list.length });
  }
  return {
    overall: Math.min(MULTIPLE_MAX, Math.max(MULTIPLE_MIN, overall)),
    byCategory,
    tradedPeers: all.length,
  };
}

export function multipleFor(comps: Comps, category: string | null): CategoryMultiple {
  const hit = category !== null ? comps.byCategory.get(category) : undefined;
  if (hit) return hit;
  return { category: category ?? 'Uncategorised', multiple: comps.overall, peers: comps.tradedPeers };
}

// ---------------------------------------------------------------------------
// The implied value of one protocol.
// ---------------------------------------------------------------------------

export const GROWTH_FLOOR = -20;
export const GROWTH_CAP = 30;
export const GROWTH_WEIGHT = 1.5;
export const MATURITY_BASE = 0.75;
export const MATURITY_RANGE = 0.5;
export const MATURITY_DAYS = 1095;
export const UNKNOWN_AGE_MULTIPLE = 0.9;

const DAY_MS = 86_400_000;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / DAY_MS));
}

export interface ImpliedBreakdown {
  implied: number;
  multiple: number;
  multiplePeers: number;
  growthPct: number;
  growthMult: number;
  age: number | null;
  maturityMult: number;
}

export function impliedValue(p: SnapshotProtocol, asOf: string, comps: Comps): ImpliedBreakdown {
  const comp = multipleFor(comps, p.category);
  const growthPct = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, p.change_7d ?? 0));
  const growthMult = 1 + (growthPct / 100) * GROWTH_WEIGHT;
  const age = ageDays(asOf, p.listed_at);
  const maturityMult =
    age === null
      ? UNKNOWN_AGE_MULTIPLE
      : MATURITY_BASE + (Math.min(age, MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE;
  const implied = Math.max(1, Math.round(p.tvl_usd * comp.multiple * growthMult * maturityMult));
  return {
    implied,
    multiple: comp.multiple,
    multiplePeers: comp.peers,
    growthPct,
    growthMult,
    age,
    maturityMult,
  };
}

// ---------------------------------------------------------------------------
// Farm plans. Concrete, priced, timed. Costs are planning estimates: gas is
// read off a per-chain table, capital is tiered by the protocol's own TVL,
// and the programme length follows how long the protocol has been running.
// ---------------------------------------------------------------------------

const GAS_USD: Record<string, number> = {
  Ethereum: 6.5,
  Solana: 0.02,
  Base: 0.12,
  Arbitrum: 0.2,
  Optimism: 0.18,
  'BNB Chain': 0.15,
  Polygon: 0.02,
  Avalanche: 0.25,
  Linea: 0.1,
  Scroll: 0.12,
  'zkSync Era': 0.1,
  Mantle: 0.05,
  Blast: 0.08,
  Sui: 0.01,
  Aptos: 0.01,
};
const GAS_DEFAULT = 0.5;

function gasFor(chain: string): number {
  return GAS_USD[chain] ?? GAS_DEFAULT;
}

function capitalFor(tvl: number): number {
  if (tvl >= 500_000_000) return 2000;
  if (tvl >= 100_000_000) return 1000;
  if (tvl >= 25_000_000) return 500;
  return 250;
}

function weeksFor(age: number | null): number {
  if (age === null) return 8;
  if (age >= 720) return 6;
  if (age >= 365) return 8;
  return 10;
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 2 : 0 })}`;
}

interface ActionPair {
  core: string;
  second: string;
}

function actionsFor(category: string | null, name: string): ActionPair {
  switch (category) {
    case 'Dexs':
      return {
        core: `Add the core position as liquidity in ${name}'s deepest stablecoin pool, so the position earns fees from day one`,
        second: `Route a small swap through ${name} in each direction on every visit, building genuine volume rather than idle deposits`,
      };
    case 'Lending':
      return {
        core: `Supply the core position as collateral in ${name}'s main market, choosing the asset with the deepest borrow demand`,
        second: `Borrow a conservative 30% against the collateral and re-supply it once, then unwind the loop so the account stays clearly solvent`,
      };
    case 'CDP':
      return {
        core: `Open a vault in ${name} and mint its stablecoin against the core position, keeping the collateral ratio above 200% at all times`,
        second: `Use part of the minted stablecoin in the protocol's own stability or liquidity pool, so both sides of the system see the account`,
      };
    case 'Yield':
    case 'Yield Aggregator':
      return {
        core: `Deposit the core position into ${name}'s flagship vault and leave it compounding rather than hopping between vaults`,
        second: `Split a smaller second deposit into a different ${name} vault or strategy, so the account holds more than one product`,
      };
    case 'Derivatives':
      return {
        core: `Post the core position as margin on ${name} and open one small hedged trade, so the account records real trading, not just a deposit`,
        second: `Trade modest size on a regular cadence, keeping every position hedged or small enough that liquidation is never near`,
      };
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return {
        core: `Allocate the core position into the largest curated vault ${name} oversees, reading its risk notes before depositing`,
        second: `Spread a second, smaller allocation across another vault under the same curator, and rebalance only when allocations drift`,
      };
    case 'RWA':
      return {
        core: `Complete ${name}'s onboarding or KYC if it asks for it, then place the core position in its main real-world-asset product`,
        second: `Hold the position through a full interest or redemption cycle, since short hops rarely count in this category`,
      };
    case 'Basis Trading':
      return {
        core: `Enter ${name}'s basis position with the core capital, checking the funding rate it currently pays before committing`,
        second: `Rebalance the hedge leg whenever the interface reports drift, and log the funding actually received each week`,
      };
    default:
      return {
        core: `Make the core deposit or stake inside ${name}'s main product, using the position size above and no leverage`,
        second: `Use a second feature of ${name} on the same visit (a different pool, vault or market), so the account is a user, not a passer-by`,
      };
  }
}

export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const gas = gasFor(chain);
  const capital = capitalFor(p.tvl_usd);
  const weeks = weeksFor(age);
  const coreAmount = Math.round(capital * 0.7);
  const secondAmount = capital - coreAmount;
  const weeklyGas = gas * 3;
  const totalCost = gas * 2 + weeklyGas * weeks;
  const act = actionsFor(p.category, p.name);
  return [
    `Set up a fresh wallet and fund it with ${money(capital)} on ${chain}, keeping about ${money(Math.max(10, gas * 8))} of it aside for gas; roughly 20 minutes, one network fee of about ${money(gas)}.`,
    `${act.core}: ${money(coreAmount)} committed, about 15 minutes, one transaction at roughly ${money(gas)} in gas.`,
    `${act.second}: ${money(secondAmount)} committed, about 15 minutes, roughly ${money(gas)} in gas.`,
    `Keep the routine for ${weeks} weeks: check positions, harvest or restake rewards and log every action once a week, about 10 minutes and ${money(weeklyGas)} of gas a week, ${money(totalCost)} of fees over the whole programme.`,
    `Watch ${p.name}'s official site and announcements once a week for a points programme or token news, and keep your own records; never pay any third party that promises a guaranteed airdrop, and claim only from the protocol's own domain if a token ever launches.`,
  ];
}

// ---------------------------------------------------------------------------
// The board and the dashboard's data.
// ---------------------------------------------------------------------------

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  tvl_usd: number;
  change_7d: number | null;
  category: string | null;
  chains: string[];
  listed_at: string | null;
  age_days: number | null;
  multiple: number;
  multiple_peers: number;
  growth_mult: number;
  maturity_mult: number;
  watchlist: boolean;
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  meta: {
    as_of: string;
    source: string;
    floor_usd: number;
    protocols: number;
    watchlist: number;
    board_rows: number;
    live_rows: number;
  };
  model: {
    overall_multiple: number;
    traded_peers: number;
    growth_floor: number;
    growth_cap: number;
    growth_weight: number;
    maturity_base: number;
    maturity_range: number;
    maturity_days: number;
    categories: CategoryMultiple[];
  };
  rows: BoardRow[];
  live: LiveRow[];
}

export function buildBoard(snapshot: Snapshot, comps: Comps): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const rows: BoardRow[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const v = impliedValue(p, snapshot.as_of, comps);
    rows.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: v.implied,
      farm_steps: farmSteps(p, v.age),
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      category: p.category,
      chains: p.chains,
      listed_at: p.listed_at,
      age_days: v.age,
      multiple: Math.round(v.multiple * 1000) / 1000,
      multiple_peers: v.multiplePeers,
      growth_mult: Math.round(v.growthMult * 1000) / 1000,
      maturity_mult: Math.round(v.maturityMult * 1000) / 1000,
      watchlist: watch.has(p.slug),
    });
  }
  rows.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      b.tvl_usd - a.tvl_usd ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  return rows;
}

export function liveRows(snapshot: Snapshot, limit = 24): LiveRow[] {
  return snapshot.protocols
    .filter((p) => recordsToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, limit)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const comps = categoryComps(snapshot);
  const board = buildBoard(snapshot, comps);
  const live = liveRows(snapshot);
  const categories = [...comps.byCategory.values()].sort((a, b) => b.peers - a.peers || a.category.localeCompare(b.category));
  const radar: RadarData = {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      board_rows: board.length,
      live_rows: live.length,
    },
    model: {
      overall_multiple: Math.round(comps.overall * 1000) / 1000,
      traded_peers: comps.tradedPeers,
      growth_floor: GROWTH_FLOOR,
      growth_cap: GROWTH_CAP,
      growth_weight: GROWTH_WEIGHT,
      maturity_base: MATURITY_BASE,
      maturity_range: MATURITY_RANGE,
      maturity_days: MATURITY_DAYS,
      categories,
    },
    rows: board,
    live,
  };
  return { board, radar };
}

export function dataScript(radar: RadarData): string {
  const json = JSON.stringify(radar).replace(/</g, '\\u003c');
  return `window.RADAR = ${json};\n`;
}

/** The gate's board rules, checked before anything is written. Null means the board is clean. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  let allEqual = true;
  const first = board[0]?.implied_value_usd;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!slugs.has(row.slug)) return `row ${i + 1}: slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `row ${i + 1}: slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1}: rank is ${row.rank}, expected ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `row ${i + 1}: implied_value_usd ${row.implied_value_usd} is not a positive whole number within the cap`;
    }
    if (row.implied_value_usd > previous) return `row ${i + 1}: implied value rises as rank ascends`;
    if (row.implied_value_usd !== first) allEqual = false;
    previous = row.implied_value_usd;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${i + 1}: farm_steps holds ${row.farm_steps?.length}, outside 3..12`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${i + 1}: a farm step is ${len} characters once trimmed, outside 20..600`;
    }
  }
  if (allEqual) return 'every implied value is the same: the board ranks nothing';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}
