# Tickwise — approved outcomes

- [x] **Live public Deriv data and index selection.** Connect to Deriv’s public price feed without an API token, login, or account credentials. Show clear live, connecting, disconnected, and error states and recover gracefully when the feed is unavailable. Let users select a supported synthetic index, default to Volatility 100 (1s), and display the continuously updating live price.

- [x] **Tick statistics and SMA indicator.** Display last-digit frequencies over a user-selectable recent tick window and calculate Even versus Odd counts for that same window. Compute fast SMA 5 and slow SMA 20 from live tick prices; show both values and the resulting Rise/Fall trend signal with a prominent “indicator, not prediction” label.

- [x] **Demo-only paper trading and base risk calculator.** Simulate the SMA rule without placing real trades or requesting Deriv credentials. Show wins, losses, win rate, and hypothetical profit/loss, clearly marked as simulated performance. Provide stake, payout, loss exposure, and stop-limit calculations.

- [x] **Responsible-use boundary.** Keep persistent messaging visible that the page is for analysis and demo testing only, does not trade a Deriv account, and does not promise earnings.

- [ ] **Private Manus login with a sole administrator.** Require Manus sign-in before any dashboard page is rendered; allow only the one account whose email is held in the protected `TICKWISE_ADMIN_EMAIL` setting; reject all other sign-ins before saving their user record or issuing a session. Grant that account the `admin` role, and enforce the role on server-rendered page requests. Use the existing OAuth nonce/state checks, HS256 session validation bound to `MANUS_PROJECT_ID`, exact `webdev_app_session` cookie name, and `HttpOnly; Secure; SameSite=None` session-cookie settings. Include sign-out and an access-denied state. Do not implement passwords or public sign-up.

- [ ] **Balance-based, browser-only risk sizing.** Let the signed-in admin optionally enter a USD balance and select a hypothetical risk percentage. Show the resulting example risk amount/stake for paper testing only. Keep the balance and percentage in page memory only—do not send or persist them. Explain that balance-based sizing does not predict Rise/Fall or the next tick; never present it as a profitable prediction or an instruction for a real Deriv trade.

- [ ] **Private deployment and launch boundary.** Serve the app through the authenticated server, retain a public unauthenticated health endpoint for deployment readiness, and disable site analytics. Publish only after the login gate and sole-admin authorization are implemented and verified; never connect to or place Deriv orders.
