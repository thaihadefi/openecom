# OpenEcom

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express%205-000000?style=flat-square&logo=express)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

An open-source e-commerce baseline for Vietnamese SMEs: one codebase, configured per client instead of forked. Vietnamese payments (VNPay, ZaloPay) and shipping (GoShip) are built in.

Every store gets a storefront, an admin panel and a JSON API. For a new client you switch modules on or off, set the look, currency and page content in the admin panel, and plug in payment gateways or shipping carriers through small interfaces. [Customizing for a client](#customizing-for-a-client) shows where each kind of request goes.

The baseline also includes live chat between customers and staff (with optional AI helpers for staff), product recommendations, suspicious-order detection and stock forecasting; each of them can be switched off.

## Contents

- [Getting started](#getting-started)
- [Customizing for a client](#customizing-for-a-client)
- [Features](#features)
- [Business rules](#business-rules)
- [Architecture](#architecture)
- [Payments in development](#payments-in-development)
- [Search and AI discovery](#search-and-ai-discovery)
- [API documentation](#api-documentation)
- [Deployment and security notes](#deployment-and-security-notes)
- [Development](#development)
- [License](#license)

## Getting started

### Prerequisites

- Node.js 22+ and Yarn 1 (to run locally), or Docker
- A MongoDB database (MongoDB Atlas, or a local MongoDB)

### 1. Configure

```bash
git clone https://github.com/thaihadefi/openecom.git
cd openecom
cp Web/.env.example Web/.env
cp FileManager/.env.example FileManager/.env
```

Fill in at least these values (the app refuses to start without the first three, see [env.config.ts](Web/configs/env.config.ts)); the other variables are optional and explained in the two `.env.example` files.

| File | Variable | Purpose |
|---|---|---|
| `Web/.env` | `DATABASE` | MongoDB connection string |
| `Web/.env` | `JWT_SECRET` | Signs login tokens |
| `Web/.env` and `FileManager/.env` | `FILE_MANAGER_SECRET` | Shared secret between Web and FileManager; must be the same in both files |
| `Web/.env` | `GROQ_API_KEY` | Optional; enables the AI helpers staff use in the admin chat |

Search uses the Atlas Search index named by `ATLAS_SEARCH_INDEX` when it exists, and a regex match otherwise. Create or update that index on `products` and `blogs` with `cd Web && yarn db:search-index` (definitions in [search-index.config.ts](Web/configs/search-index.config.ts)); it adds typo tolerance, search-as-you-type, accent-insensitive matching and relevance ranking. Storefront searches are counted anonymously in `search-queries` to offer popular searches; a term appears there only after several visitors searched it and it found products.

Optional modules are switched with feature flags; see [Feature flags](#feature-flags).

### 2a. Run locally

```bash
# Terminal 1
cd FileManager && yarn install && yarn dev

# Terminal 2
cd Web && yarn install && yarn dev
```

The store runs at `http://localhost:3000` and the admin panel at `http://localhost:3000/admin`. `yarn dev` restarts on changes; `yarn debug` also opens the Node inspector.

### 2b. Or run with Docker

```bash
docker compose up -d --build
```

nginx serves the site at `http://localhost` (also on port 3000). The database is not part of the stack; `DATABASE` points at your MongoDB.

### 3. Initialize the database

```bash
cd Web && yarn db:seed
```

On an empty database this creates a **Super Admin** role and the first admin account, `admin@openecom.local` / `Admin@123` (change the password right after the first login, or choose the credentials up front with `SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... yarn db:seed`). It also writes the default settings.

The seed is safe to run again, including on a store that is already live: it never creates the default admin when an admin account exists, and it only adds the settings fields a store is missing, without changing any value already saved. Run it after updating the code so new settings get their defaults.

Sign in to the admin panel with that account; other staff accounts and their role permissions are managed there.

### 4. Configure the store

Everything else is set in **Admin → Settings**; each page explains its fields. The rules the pages do not spell out:

- **General Settings**: the store phone, address and map pin are also the GoShip sender, so checkout cannot ship until they are set. The pin also drives the map link in the footer and on the contact page, and the starting view of customers' address maps.
- **App API Password**: a Gmail account with an [app password](https://support.google.com/accounts/answer/185833) sends the OTP and order emails.
- **Payment Gateway API**: a method is offered only when it is ticked and its keys are filled in.
- **Social Login API**: a login button appears only once its keys are saved.
- **Page Content**: an empty page keeps its default text.

## Customizing for a client

Where each kind of client request goes; most need no code.

| The client wants to... | Where | Code change |
|---|---|---|
| Drop a module (blog, wishlist, compare, reviews, coupons, loyalty points, chat, AI, recommendations, fraud scoring, stock forecast, Google Translate) | `FEATURE_*` in `Web/.env` | None |
| Change colors and fonts | Admin → Settings → Storefront | None |
| Set the currency, number and date format, time zone, page language | Admin → Settings → Storefront | None |
| Show prices in other currencies for reference | Admin → Settings → Storefront → Display currencies | None |
| Change the loyalty point rates | Admin → Settings → Storefront | None |
| Change the promises beside every product, or show the store name next to the logo | Admin → Settings → Storefront | None |
| Edit About, FAQ and policy pages | Admin → Settings → Page Content | None |
| Set the logo, contact details, store map pin, footer text and social links | Admin → Settings → General Settings | None |
| Rearrange the homepage | Admin → Block Management and Template Management | None |
| Choose which payment methods checkout offers | Admin → Settings → Payment Gateway API | None |
| Offer Google or Facebook login | Admin → Settings → Social Login API (buttons appear once keys are saved) | None |
| Move the admin panel to another URL | `ADMIN_PATH` in `Web/.env` | None |
| Add a payment gateway (e.g. SePay, MoMo) | See [Adding a payment gateway](#adding-a-payment-gateway) | Small |
| Add a shipping carrier | One `ShippingProvider` file like [goship.provider.ts](Web/services/shipping/goship.provider.ts), listed in [shipping.service.ts](Web/services/shipping/shipping.service.ts); implement its optional `cancelShipment` so cancelled orders release the booking | Small |
| Add a module of their own | Routes behind `requireFeature(...)` ([feature.middleware.ts](Web/middlewares/feature.middleware.ts)), a flag in [features.config.ts](Web/configs/features.config.ts) | Yes |
| Replace the storefront design | Pug views in `Web/views/client`, keeping the CSS variables and the element attributes that `main.js` hooks into; a fully separate frontend can use the [JSON API](#api-documentation) instead | Yes |

### Feature flags

All flags default to on. A module that is off hides its UI, answers 404 on its pages and APIs, and skips its scheduled jobs.

| Variable | Module |
|---|---|
| `FEATURE_CHAT=false` | Live chat (storefront widget, admin inbox, Socket.IO, chat cleanup job) |
| `FEATURE_AI=false` | Groq AI helpers in the admin chat; also off when chat is off or `GROQ_API_KEY` is empty |
| `FEATURE_ML_FRAUD=false` | Suspicious-order scoring, the flagged-order queue and its retraining job |
| `FEATURE_RECOMMENDATIONS=false` | "Frequently bought together" from order history; product pages fall back to related products |
| `FEATURE_STOCK_FORECAST=false` | The inventory forecast report |
| `FEATURE_BLOG=false` | Articles: storefront blog, admin editor, homepage blog block, search results and sitemap entries |
| `FEATURE_WISHLIST=false` | Wishlist page, header icon and product buttons |
| `FEATURE_COMPARE=false` | Product comparison page, header icon and product buttons |
| `FEATURE_REVIEWS=false` | Product reviews, ratings, review reports and the admin review queue |
| `FEATURE_COUPONS=false` | Coupon codes at checkout and the admin coupon pages; checkout refuses a coupon |
| `FEATURE_LOYALTY=false` | Loyalty points: none are earned or spent |
| `FEATURE_TRANSLATE=false` | The Google Translate widget |

### Adding a payment gateway

Cash on delivery, VNPay and ZaloPay ship with the baseline; other gateways plug in the same way:

1. Describe the method (label, icon, online or not, accepted currencies, which keys it needs) in [payment-methods.config.ts](Web/configs/payment-methods.config.ts). Checkout, order labels, the admin method picker and the unpaid-order job all read this list.
2. Write a `PaymentProvider` file like [vnpay.provider.ts](Web/services/payment/vnpay.provider.ts) that returns the gateway URL for an order, and register it in [payment-gateway.service.ts](Web/services/payment/payment-gateway.service.ts). Offline methods need no provider.
3. Add the gateway's callback or webhook to [order.route.ts](Web/routes/client/order.route.ts) above the generic `/payment-:method` route, and mark orders paid through `applyGatewayPayment` ([payment-order.helper.ts](Web/services/payment/payment-order.helper.ts)), which checks the amount and applies a repeated callback only once.
4. Add its keys to `ISettingApiPayment` ([setting.interface.ts](Web/interfaces/models/setting.interface.ts)), the `apiPayment` schema in [setting.validate.ts](Web/validates/admin/setting.validate.ts), the Payment Gateway API page ([setting-api-payment.pug](Web/views/admin/pages/setting-api-payment.pug)) and [seed.ts](Web/seed.ts). The validator drops unknown fields, so a key missing from the schema is silently not saved.

### Currency and locale

The **store currency** (VND by default) is what prices are entered in and what every order is charged in. Pick it when the store is set up: changing it later does not convert existing prices. **Display currencies** only let shoppers view converted prices with live exchange rates; the cart then notes that the charge is in the store currency. Payment methods that cannot charge the store currency are hidden (VNPay and ZaloPay only take VND).

The store **locale** sets number and date formats, and the map address search looks only in the locale's country, in its language (`vi-VN` searches Vietnam in Vietnamese).

### Limitations

- UI and email text is in English in the code (Pug views, [mail.helper.ts](Web/helpers/mail.helper.ts)); a multi-language interface is planned, and Google Translate covers other languages on the storefront for now.
- The baseline targets stores in Vietnam: shipping uses GoShip, and customer phone numbers must be Vietnamese mobile numbers ([auth.validate.ts](Web/validates/client/auth.validate.ts)). Selling abroad needs another payment gateway and shipping provider (see [Customizing for a client](#customizing-for-a-client)).

### Setting up a new client store

1. Follow [Getting started](#getting-started), setting the `FEATURE_*` flags for the modules the client wants.
2. Fill in the Settings pages ([Configure the store](#4-configure-the-store)), then build the homepage from blocks.
3. After any code change, run the checks in [Development](#development).

## Features

Modules marked *(optional)* can be switched off with a feature flag.

**Customers**
- Sign up, log in (email/password, plus Google and Facebook once configured) and reset the password with an email OTP.
- Browse, filter, sort and search products (with live suggestions). For products with variants such as size and color, shoppers choose their options before adding to cart; only groups with a single value are preselected. The picker updates price, stock and images.
- Cart (kept in the browser), wishlist *(optional)* and product comparison *(optional)*.
- Checkout with coupons *(optional)*, loyalty points *(optional)*, a map address picker and GoShip rates from several carriers, cheapest first (weight per product, with a store default).
- Pay by cash on delivery, VNPay or ZaloPay out of the box, with room for [more gateways](#adding-a-payment-gateway) (only the methods the store has set up are offered), and a retry button when an online payment did not finish.
- Order emails and order status in the customer account; reviews on purchased products and reports on abusive reviews *(optional)*.
- Live chat with the store: typing and online status, attachments, and a rating at the end *(optional)*.
- Blog *(optional)*, editable About/FAQ/policy pages, flash sales, contact form, prices viewable in other currencies, Google Translate *(optional)* and an installable PWA.

**Store staff**
- Manage products (rich-text editor, variants, shipping weight), categories, attributes (color, dropdown or text), coupons, orders, articles, customers and staff accounts.
- Moderate reviews, answer contact messages, and reply to or lock customer chats.
- Role-based permissions, an audit log, and a trash bin to restore deleted records.
- Dashboards for revenue over time, top-selling products, orders and customer growth in the store time zone; CSV import/export; SEO fields, social cards, structured data, a sitemap and Markdown copies of pages for AI assistants ([Search and AI discovery](#search-and-ai-discovery)); homepage blocks and page templates; store settings.
- A file manager; renaming or deleting a file updates every record that uses it (products, articles, categories, avatars, reviews, chat messages, homepage blocks and settings).

**AI helpers for staff** *(optional)*
- There is no AI chatting with customers. In the admin chat, staff can ask an LLM (through the Groq API) to summarize a chat, suggest or polish a reply, and read the customer's sentiment. When a model is retired, rate-limited or failing, the request moves on to another available Groq model ([ai.helper.ts](Web/helpers/ai.helper.ts)).

**Machine learning** *(each optional)*
- **Recommendations** ("frequently bought together"): staff can hand-pick the list per product; otherwise item-based collaborative filtering where recent orders weigh more and results are mixed across categories; products with too few co-purchases are topped up with items sharing their categories, always listed after the co-purchase matches, and products without data fall back to the most viewed items of the same category ([recommendation.helper.ts](Web/helpers/recommendation.helper.ts)).
- **Suspicious-order detection**: each order gets an Isolation Forest score from order speed, coupon use, discount ratio, account age, guest checkout and how many other accounts share its phone number or public IP address (IPs only within the last day; private, proxy and local addresses are ignored), combined with simple rules; flagged orders go to a review queue ([isolation-forest.helper.ts](Web/helpers/isolation-forest.helper.ts)).
- **Stock forecasting**: Holt's linear trend method with sales spikes (such as flash sales) capped, giving each product a reorder point and safety stock ([forecast.helper.ts](Web/helpers/forecast.helper.ts)).

Recommendations and the fraud model are recomputed every night and can also be run on demand from the admin panel.

## Business rules

- The cart lives in the browser, so the server re-checks every price, variant and stock level when the order is placed.
- Stock is reserved when an order is placed. Cancelling or returning an order gives back the stock, the coupon use and the spent points, and takes back the points it earned. These changes run inside a MongoDB transaction.
- The shipment is booked with the carrier when the order is placed. It is cancelled with the carrier when the order then fails to save, when staff cancel the order and when an unpaid online order times out; if the carrier refuses, the booking is queued in `shipment-cancel-tasks` and [shipping.job.ts](Web/jobs/shipping.job.ts) retries it every 10 minutes with a growing wait. After the last attempt the task is kept as `failed` and logged for staff to cancel by hand.
- Points can pay part of an order, up to the customer's balance and the amount due.
- Loyalty points are earned only once an order is paid, never for cancelled or returned orders. How much order value earns a point, and what a point is worth, are set in Settings → Storefront.
- Completed, cancelled and returned orders can no longer change status, and a paid order cannot be set back to unpaid; only cancelled or returned orders can be deleted.
- An order placed with an online gateway (VNPay, ZaloPay) and never paid is cancelled after a timeout ([order.job.ts](Web/jobs/order.job.ts)). Idle chat rooms are deleted with their files ([chat.job.ts](Web/jobs/chat.job.ts)).
- A product can be reviewed only after its order is completed, once per purchased item.
- A new chat goes to the online staff member who can reply to chats and has the fewest open conversations; if nobody is online, to any staff member with that permission. When the assigned staff member loses the permission, the chat moves to someone else the next time the customer connects ([chat.socket.service.ts](Web/services/socket/chat.socket.service.ts)).
- Coupons are a percentage or a fixed amount, with an optional minimum order, maximum discount, usage limit, validity dates, and public or private visibility.
- Reports, order dates, coupon days and the nightly jobs follow the store time zone (Settings → Storefront, default `Asia/Ho_Chi_Minh`). VNPay and ZaloPay timestamps are always sent in Vietnam time, as those gateways require.
- A scheduled job never starts again while its previous run is still going.
- An account registered with an email that was never verified loses its password the first time the real owner links Google or Facebook; they can then use the social login or "Forgot password".

## Architecture

```text
Browser ──> nginx ──> Web ──> MongoDB Atlas
                       │
                       ├──> FileManager (stores files on disk, not public)
                       └──> Groq, GoShip, Gmail, VNPay, ZaloPay

VNPay / ZaloPay ──(payment callbacks through the public domain)──> nginx ──> Web
```

- **Web** serves the storefront, the admin panel (at `/admin`, configurable with `ADMIN_PATH`), the JSON API (`/api`, `/admin/api`) and Socket.IO chat. Code is layered: routes → controllers → services → models.
- **FileManager** keeps uploaded files. Only Web talks to it; browsers load media through Web at `/media`.
- **nginx** is the public entry point in Docker and upgrades `/socket.io/` to WebSocket.

### Where to look

| Looking for | Start at |
|---|---|
| The Express app and its startup | [Web/app.ts](Web/app.ts) builds the app; [Web/index.ts](Web/index.ts) connects the database, starts jobs and Socket.IO, and shuts down |
| A request's path through the code | `Web/routes` → `Web/controllers` → `Web/services` → `Web/models`, split into `admin/` and `client/` |
| Store settings and feature flags | [Web/configs](Web/configs) |
| Payment gateways | [payment-methods.config.ts](Web/configs/payment-methods.config.ts), [PaymentProvider](Web/services/payment/payment-provider.interface.ts) and [Web/services/payment](Web/services/payment) |
| Shipping carriers | [Web/services/shipping](Web/services/shipping) |
| Scheduled jobs | [Web/jobs](Web/jobs) |
| Storefront and admin pages | `Web/views` (Pug) and `Web/public` (CSS, JS, service worker) |
| Uploaded files | [FileManager](FileManager) |
| The Docker stack | [docker-compose.yml](docker-compose.yml) and [nginx](nginx) |

## Payments in development

VNPay and ZaloPay confirm payments by calling the app from their own servers, which cannot reach `localhost`. Expose nginx with a tunnel and use that URL as the store domain:

```bash
ngrok http --url=<your-ngrok-domain> 80
```

Then set **Settings → General Settings → Website Domain** to the ngrok URL. Payment return pages, the ZaloPay callback, canonical links and the sitemap are all built from this domain. Without the tunnel, ZaloPay orders are never marked as paid, and VNPay orders only when the customer's browser comes back to the store.

Once the site is hosted, register the VNPay IPN (`/order/payment-vnpay-ipn`) and ZaloPay callback (`/order/payment-zalopay-callback`) URLs in the merchant portals.

## Search and AI discovery

Search engines and AI assistants read the store from the same data the pages show; nothing here needs its own content.

- **Indexing:** public pages are `index, follow`. Cart, checkout, account, order, wishlist, compare, search and error pages are `noindex` ([seo.middleware.ts](Web/middlewares/client/seo.middleware.ts)). A product or article is hidden only when its SEO page in the admin unticks "Allow index".
- **Metadata:** each page's title, description and social card come from its saved SEO fields, then its own text and first image, then Settings > General (store name, description, logo). Set **Website Domain** there: canonical links, the sitemap and social cards use it.
- **Structured data:** Organization and WebSite on every page, Product (price, stock, rating) and breadcrumbs on product pages, BlogPosting on articles ([structured-data.helper.ts](Web/helpers/structured-data.helper.ts)).
- **`/robots.txt` and `/sitemap.xml`:** robots.txt blocks only the admin panel and allows every crawler, AI ones included; restricting AI crawlers is a per-store choice made in [home.service.ts](Web/services/client/home.service.ts).
- **Markdown copies:** add `.md` to a product, article, category, listing or store page URL (the home page is `/index.md`) for a Markdown version; `/llms.txt` lists them and `/llms-full.txt` holds all of them in one file ([markdown.service.ts](Web/services/client/markdown.service.ts)). They send `X-Robots-Tag: noindex` so they never compete with the real pages in search.
- **Page actions:** product and article pages offer Copy page (as Markdown), View as Markdown, Copy link, Ask ChatGPT, Claude or Perplexity about the page, and share links.

## API documentation

- Swagger UI: [openecom-api-docs.vercel.app](https://openecom-api-docs.vercel.app), or `http://localhost:3000/api-docs/` while the app is running (use this one to try requests, since it can send the login cookies).
- JSON endpoints live under `/api` (customers) and `/admin/api` (staff). They accept the login cookies or `Authorization: Bearer <accessToken>` from the login endpoints. Errors return `{ "code": "error", "message": "..." }` with the matching HTTP status.
- FileManager accepts `Authorization: Bearer <FILE_MANAGER_SECRET>`.
- The spec lives in [thaihadefi/openecom-api-docs](https://github.com/thaihadefi/openecom-api-docs), whose `yarn sync-web` refreshes the copy in `Web/public/api-docs`.

## Deployment and security notes

- **Keep FileManager private.** Only Web needs to reach it. If you must publish it, use HTTPS, a long random secret (`openssl rand -hex 32`) and `FILE_MANAGER_CORS_ORIGINS`; a client that keeps sending wrong secrets is blocked with HTTP 429 ([auth-failure-limit.middleware.ts](FileManager/middlewares/auth-failure-limit.middleware.ts)).
- **Set `TRUST_PROXY`** to the real number of proxies in front of the app; a wrong value lets clients fake their IP and bypass the login rate limits.
- **Cookies and tokens:** login cookies are `HttpOnly`, and marked `Secure` automatically over HTTPS. Refresh tokens rotate on every use, and reusing an old one logs that account out everywhere.
- **File paths:** FileManager resolves every path inside its media folder and rejects anything that would leave it.
- **Uploads** are checked by type and size; avatars and review photos must be real images. The limits live in [upload.helper.ts](Web/helpers/upload.helper.ts) and [FileManager/config](FileManager/config).
- **Redeploys:** the web app shuts down gracefully on `SIGTERM` ([Web/index.ts](Web/index.ts)), and Compose gives it time to finish (`stop_grace_period`).
- **A proxy in front of Compose** (for example the host's nginx that serves the domain and forwards to port 8030) must allow uploads as large as the app does: set `client_max_body_size 200M;` in its `server` block, as [nginx/nginx.conf](nginx/nginx.conf) does. Its default of 1 MB refuses larger product images and avatars with HTTP 413 before they reach the app.
- **nginx config** is mounted as a directory; after editing `nginx/nginx.conf`, run `docker compose exec nginx nginx -s reload`.

## Development

Each service defines its scripts in its own `package.json`; run them with `yarn <script>` inside `Web` or `FileManager`. Before pushing:

- `yarn typecheck`, `yarn lint:any` (no `any` types), `yarn test` (unit tests in `Web/tests`, Web only) and `yarn build`. [CI](.github/workflows/ci.yml) runs these and builds each service's Docker image on every push and pull request to `main`. On a push to `main`, its last job deploys that same commit to the VPS over SSH, and only after both services pass.
- When a route, method or payload changes, update the [API spec](#api-documentation) and run `yarn verify` in its repository; it compares the spec with this code.
- When a setting gains a field, give it a default in [seed.ts](Web/seed.ts) so `yarn db:seed` fills it on existing stores.

## License

[MIT](LICENSE) © OpenEcom Team
