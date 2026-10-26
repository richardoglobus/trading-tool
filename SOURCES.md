# Tickwise source notes

## Deriv public market data

The dashboard uses Deriv's public WebSocket market-data interface and never supplies an account token. The browser first connects to the documented public WebSocket endpoint, then requests a live tick subscription for the selected synthetic-index symbol. The app includes fallback WebSocket hosts and shows a disconnected state if none returns fresh ticks.

- Public WebSocket usage and authentication notes: <https://developers.deriv.com/docs/options/ws-public/>
- Tick subscription request: <https://developers.deriv.com/docs/data/ticks/>
- Tick request schema: <https://developers.deriv.com/schemas/ticks_request.schema.json>
- Active-symbols discovery documentation: <https://developers.deriv.com/docs/data/active-symbols/>
- Active-symbols request schema: <https://developers.deriv.com/schemas/active_symbols_request.schema.json>
- Tick history documentation: <https://developers.deriv.com/docs/data/ticks-history/>
- API workflow guide: <https://developers.deriv.com/docs/workflows/>

The selector currently offers Volatility 100 (1s), Volatility 75 (1s), Volatility 50 (1s), Volatility 25 (1s), and Volatility 10 (1s), defaulting to Volatility 100 (1s). The tick stream is live market data, not a price forecast. The SMA 5/20 comparison describes recent quotes only, and the paper simulator never sends a trade order.

## Privacy and account boundary

Only the allowlisted Manus identity is authorized to view extensionless/HTML page routes. Deriv data remains unauthenticated public market data. USD balance and risk-percent inputs live only in the browser's in-memory component state and are not submitted to the server, saved to browser storage, or used to choose Rise/Fall.
