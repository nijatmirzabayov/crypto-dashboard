# Spot Holdings Monitor

A live dashboard for a shared crypto spot portfolio: current value, profit and loss, 24-hour change and each coin's weight.

**Updating holdings:** edit `holdings.json`. Each coin needs its ticker `symbol`, its CoinGecko id (`coingecko_id`, the last part of the coin's coingecko.com URL), the number of coins held (`amount`) and the total USD paid (`invested`).

Prices come from the free CoinGecko API, with Coinbase as a backup, and refresh every minute in the browser. General information only, not financial advice.
