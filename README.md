# Spot Holdings Monitor

A live dashboard for a shared crypto spot portfolio: current value, profit and loss, 24-hour change and each coin's weight.

**Updating holdings:** edit `holdings.json`. Each coin needs its ticker `symbol`, its CoinGecko id (`coingecko_id`, the last part of the coin's coingecko.com URL), the number of coins held (`amount`) and the total USD paid (`invested`).

Prices come from the free CoinGecko API, with Coinbase as a backup, and refresh every minute in the browser. General information only, not financial advice.

## Futures dashboard

`futures/` is a second page at https://nijatmirzabayov.github.io/crypto-dashboard/futures/. Trades live in `futures/positions.json`: `starting_balance`, optional `deposits` (`{time, amount, note}`), and `trades` with `symbol`, `side` (long/short), `size` (coin quantity), `entry`, `opened`, and once closed `exit` and `closed`. Optional: `leverage`, `fees`, `funding`, `notes`, `coingecko_id`. Times are ISO 8601; a bare date (`2026-10-20`) shows as a date only.
