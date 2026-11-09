// Load .env before any module below reads process.env at import time.
import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import path from 'path';
import { Readable } from 'node:stream';
import compression from "compression";
import adminRoutes from "./routes/admin/index.route";
import clientRoutes from "./routes/client/index.route";
import { pathAdmin, domainCDN, mediaBase } from './configs/variable.config';
import { getGeneral } from './configs/setting.config';
import cookieParser from "cookie-parser";
import passport from "passport";
import { RequestAccount } from './interfaces/request.interface';
import { Server } from 'socket.io';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import * as adminAuth from './middlewares/admin/auth.middleware';
import { validateEnv } from './configs/env.config';
import { requestLogger } from './middlewares/request-logger.middleware';
import { secureCookies } from './middlewares/secure-cookie.middleware';
import { formatDate, formatDateTime, formatPrice, formatNumber, priceHtml } from './helpers/format.helper';
import { safeHtml, safeJson, safeUrl, safeColor, readableTextOn } from './helpers/html-sanitize.helper';
import { FEATURES } from './configs/features.config';
import { paymentMethodLabel, isOnlinePayment } from './configs/payment-methods.config';
import { SOCIAL_LINKS } from './configs/social-links.config';
import { loadStorefront, currencyDigits, STOREFRONT_DEFAULTS } from './configs/storefront.config';
import { absoluteUrl } from './helpers/seo.helper';

validateEnv();

axios.defaults.timeout = 15000;

const app = express();
app.disable('x-powered-by');
const server = createServer(app);

// A request Node's HTTP parser rejects (bad header bytes, malformed request line, ...) never
// reaches Express; without this handler the client gets a raw, bodyless 400 instead of JSON.
server.on('clientError', (err: NodeJS.ErrnoException, socket: Socket) => {
  if (err.code === 'ECONNRESET' || !socket.writable) return;
  const body = JSON.stringify({ code: 'error', message: 'Bad Request' });
  socket.end(
    `HTTP/1.1 400 Bad Request\r\n` +
    `Content-Type: application/json; charset=utf-8\r\n` +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    `Connection: close\r\n\r\n${body}`
  );
});

const io = new Server(server, {
  pingInterval: 25000,
  pingTimeout: 60000,
  maxHttpBufferSize: 1e6,
  transports: ["websocket", "polling"],
});

app.use(compression());

app.use((_req, res, next) => {
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.use(requestLogger);
app.use(secureCookies);

app.use((req, res, next) => {
  if (req.path === `/${pathAdmin}` || req.path.startsWith(`/${pathAdmin}/`)) {
    next();
    return;
  }
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// The API documentation changes with the specification, so browsers revalidate it (ETag) instead of caching it for a week.
app.use('/api-docs', express.static(path.join(process.cwd(), 'public', 'api-docs'), { maxAge: 0 }));

app.use(express.static(path.join(process.cwd(), 'public'), {
  maxAge: 7 * 24 * 60 * 60 * 1000
}));

app.use('/admin/assets/libs/tinymce', express.static(path.join(process.cwd(), 'node_modules', 'tinymce'), {
  maxAge: 7 * 24 * 60 * 60 * 1000,
  index: false,
  dotfiles: 'deny'
}));

app.get('/manifest.webmanifest', async (_req, res) => {
  try {
    const [general, storefront] = await Promise.all([getGeneral(), loadStorefront()]);
    const name = (general?.websiteName || '').trim() || 'OpenEcom';
    const iconUrl = general?.favicon
      ? `${mediaBase}${general.favicon}`
      : '/images/favicon.svg';

    const spaceIdx = name.lastIndexOf(' ', 12);
    const shortName = name.length > 12
      ? name.slice(0, spaceIdx <= 0 ? 12 : spaceIdx).trim()
      : name;

    const iconUrlLower = iconUrl.toLowerCase();
    const iconMimeType = iconUrlLower.endsWith('.ico')
      ? 'image/x-icon'
      : iconUrlLower.endsWith('.svg')
        ? 'image/svg+xml'
        : iconUrlLower.endsWith('.webp')
          ? 'image/webp'
          : iconUrlLower.endsWith('.jpg') || iconUrlLower.endsWith('.jpeg')
            ? 'image/jpeg'
            : 'image/png';

    const manifest = {
      name,
      short_name: shortName,
      description: `${name} - Online Shopping`,
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: storefront.primaryColor,
      icons: [
        { src: iconUrl, sizes: '192x192', type: iconMimeType, purpose: 'any' },
        { src: iconUrl, sizes: '512x512', type: iconMimeType, purpose: 'any' },
      ],
    };

    res.set('Content-Type', 'application/manifest+json');
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(manifest);
  } catch (err) {
    console.error('[PWA] manifest error:', err instanceof Error ? err.message : err);
    res.status(500).json({});
  }
});

app.get(/^\/+media\//, async (req, res) => {
  const upstreamPath = req.originalUrl.replace(/^\/+/, "/");
  try {
    const upstream = await fetch(`${domainCDN}${upstreamPath}`, { signal: AbortSignal.timeout(15000) });
    res.status(upstream.status);
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.type(contentType);
    const contentDisposition = upstream.headers.get("content-disposition");
    if (contentDisposition) res.set("Content-Disposition", contentDisposition);
    res.set("X-Content-Type-Options", "nosniff");

    res.set("Cache-Control", upstream.ok ? "public, max-age=31536000, immutable" : "no-store");
    if (upstream.body) {
      Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    console.error("[Media] proxy to FileManager failed:", err instanceof Error ? err.message : err);
    res.status(502).end();
  }
});

app.use((req, res, next) => {
  if (req.method === 'GET') {
    res.set('Cache-Control', 'private, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

app.set('views', path.join(process.cwd(), 'views'));
app.set('view engine', 'pug');
app.enable('view cache');

const trustProxyEnv = process.env.TRUST_PROXY;
app.set('trust proxy', trustProxyEnv === undefined
  ? (process.env.NODE_ENV === 'production' ? 1 : false)
  : (Number.isNaN(Number(trustProxyEnv)) ? trustProxyEnv : Number(trustProxyEnv)));


const buildFullUrl = (cdn: string, url?: string): string => {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/client/") || url.startsWith("client/")) return url;
  if (url.startsWith("/images/") || url.startsWith("images/")) return url;
  return `${cdn}${url.startsWith("/") ? "" : "/"}${url}`;
};

app.locals.pathAdmin = pathAdmin;
app.locals.domainCDN = mediaBase;
app.locals.getFullUrl = (url: string) => buildFullUrl(mediaBase, url);
app.locals.formatDate = formatDate;
app.locals.formatDateTime = formatDateTime;
app.locals.formatPrice = formatPrice;
app.locals.formatNumber = formatNumber;
app.locals.priceHtml = priceHtml;
app.locals.safeHtml = safeHtml;
app.locals.safeJson = safeJson;
app.locals.safeUrl = safeUrl;
app.locals.safeColor = safeColor;
app.locals.readableTextOn = readableTextOn;
app.locals.absoluteUrl = absoluteUrl;
app.locals.FEATURES = FEATURES;
app.locals.STOREFRONT_DEFAULTS = STOREFRONT_DEFAULTS;
app.locals.SOCIAL_LINKS = SOCIAL_LINKS;
app.locals.paymentMethodLabel = paymentMethodLabel;
app.locals.isOnlinePayment = isOnlinePayment;

// Theme, currency, locale and time zone for this request (cached setting, see Settings > Storefront).
app.use(async (_req, res, next) => {
  try {
    const storefront = await loadStorefront();
    res.locals.storefront = storefront;
    res.locals.currencyDigits = currencyDigits(storefront.currency);
    next();
  } catch (err) {
    next(err);
  }
});

app.use(cookieParser());

app.use(passport.initialize());

app.use(`/${pathAdmin}`, adminRoutes);
app.use("/", clientRoutes);

app.use((req, res) => {
  if (req.path.startsWith(`/${pathAdmin}`)) {
    adminAuth.verifyToken(req as RequestAccount, res, () => {
      res.status(404).render("admin/pages/404", { pageTitle: "404 | Admin" });
    });
    return;
  }

  res.status(404).render("client/pages/404", { pageTitle: "Page not found", noindex: true });
});

app.use((err: { name?: string; message?: string; status?: number; statusCode?: number }, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[UnhandledError]', err?.message || err);
  if (res.headersSent) return;
  const isUploadError = err.name === 'MulterError' || err.name === 'UploadRejectedError';
  const status = isUploadError ? 400 : (err.status || err.statusCode || 500);
  const isApiRequest = isUploadError || req.xhr || req.originalUrl.includes('/api/') || (req.headers.accept || '').includes('application/json');
  if (isApiRequest) {
    const message = status < 500 && err.message ? err.message : 'Internal Server Error';
    res.status(status).json({ code: 'error', message });
  } else {
    res.status(status).render('client/pages/404', { pageTitle: `${status} | Error`, noindex: true });
  }
});

export { app, server, io };
