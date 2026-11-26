// index.js
import { homedir } from "node:os";
import { join as join5, resolve as resolve3 } from "node:path";
import { readFileSync as readFileSync3 } from "node:fs";

// src/api.js
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { b64, openRequest, sealResponse } from "../web/seal.js";
import { ID } from "../web/protocol.js";
var API = "/api/sealed-files";
var WINDOW_MS = 10 * 6e4;
var HEARTBEAT_MS = 25e3;
var HEADERS = { "cache-control": "no-store, no-transform", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
var json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, "content-type": "application/json" } });
var refuse = (status, code) => json(status, { error: code });
function createApiRoutes({ service, identity, version: version2 }) {
  const seen = /* @__PURE__ */ new Map();
  function fresh(envelope) {
    const now = Date.now();
    if (!Number.isFinite(envelope.t) || Math.abs(now - envelope.t) > WINDOW_MS) return false;
    for (const [nonce, at] of seen) if (now - at > 2 * WINDOW_MS) seen.delete(nonce);
    else break;
    const key = `${envelope.d}:${envelope.n}`;
    if (seen.has(key)) return false;
    seen.set(key, now);
    return true;
  }
  const current = () => service();
  const personOf = (svc) => svc.people.current(identity());
  function deviceOf(svc, person, id, { approved = true } = {}) {
    if (person === null) return { refusal: refuse(403, "not-mapped") };
    const device = typeof id === "string" ? svc.store.device(id) : null;
    if (device === null || device.person !== person.id) return { refusal: refuse(403, "unknown-device") };
    if (approved && device.status !== "approved") return { refusal: refuse(403, "not-approved") };
    return { device };
  }
  const guarded = (handler) => async (request) => {
    const svc = current();
    if (svc === void 0) return refuse(503, "starting");
    try {
      return await handler(request, svc);
    } catch (error) {
      if (typeof error.status === "number") return refuse(error.status, error.message);
      svc.logger?.warn?.("request failed: %s", error.message);
      return refuse(500, "failed");
    }
  };
  const whoami = guarded(async (request, svc) => json(200, { mapped: personOf(svc) !== null, assistant: { pub: b64.encode(svc.identity.pub), recipient: svc.identity.recipient }, version: version2() }));
  const waiting = guarded(async (request, svc) => {
    const person = personOf(svc);
    if (person === null) return json(200, { count: 0 });
    return json(200, { count: svc.store.devicesOf(person.id).filter((d) => d.status === "pending").length });
  });
  const enroll = guarded(async (request, svc) => {
    const person = personOf(svc);
    if (person === null) return refuse(403, "not-mapped");
    const body = await request.json().catch(() => null);
    if (body === null || typeof body.pub !== "string" || typeof body.name !== "string") return refuse(400, "bad request");
    return json(200, await svc.enroll(person, body));
  });
  const call = guarded(async (request, svc) => {
    const envelope = await request.json().catch(() => null);
    if (envelope === null || typeof envelope.d !== "string" || typeof envelope.n !== "string" || typeof envelope.c !== "string") return refuse(400, "bad request");
    const person = personOf(svc);
    const { device, refusal } = deviceOf(svc, person, envelope.d, { approved: false });
    if (refusal) return refusal;
    const key = await svc.identity.pairKey(b64.decode(device.pub));
    let body;
    try {
      body = await openRequest(key, envelope);
    } catch {
      return refuse(400, "bad-seal");
    }
    if (!fresh(envelope)) return refuse(400, "stale");
    svc.store.touchDevice(device);
    let answer;
    try {
      answer = { ok: true, result: await svc.run(String(body.op), { person, device, args: body.args }) };
    } catch (error) {
      if (typeof error.status !== "number") svc.logger?.warn?.("%s failed: %s", body.op, error.message);
      answer = { ok: false, status: error.status ?? 500, error: typeof error.status === "number" ? error.message : "failed" };
    }
    return json(200, await sealResponse(key, device.id, envelope.n, answer));
  });
  const part = guarded(async (request, svc) => {
    const url = new URL(request.url);
    const { device, refusal } = deviceOf(svc, personOf(svc), url.searchParams.get("d"));
    if (refusal) return refusal;
    if (request.body === null) return refuse(400, "no body");
    return json(200, await svc.uploads.part(device, url.searchParams.get("u"), Number(url.searchParams.get("n")), request.body));
  });
  const blob = guarded(async (request, svc) => {
    const url = new URL(request.url);
    const person = personOf(svc);
    const { refusal } = deviceOf(svc, person, url.searchParams.get("d"));
    if (refusal) return refusal;
    const id = url.searchParams.get("id");
    const item = ID.test(String(id)) ? svc.store.visibleItem(person.id, id) : null;
    if (item === null) return refuse(404, "no such file");
    const path = svc.store.itemPath(item.id);
    const size = (await stat(path)).size;
    const range = parseRange(request.headers.get("range"), size);
    if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...HEADERS, "content-range": `bytes */${size}` } });
    const [start, end] = range ?? [0, size - 1];
    const headers = { ...HEADERS, "content-type": "application/octet-stream", "accept-ranges": "bytes", "content-length": String(end - start + 1) };
    if (range) headers["content-range"] = `bytes ${start}-${end}/${size}`;
    const body = request.method === "HEAD" || size === 0 ? null : Readable.toWeb(createReadStream(path, { start, end }));
    return new Response(body, { status: range ? 206 : 200, headers });
  });
  const events = guarded(async (request, svc) => {
    const person = personOf(svc);
    if (person === null) return refuse(403, "not-mapped");
    const encoder = new TextEncoder();
    let stop = () => {
    };
    const stream = new ReadableStream({
      start(controller) {
        const write2 = (chunk) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            stop();
          }
        };
        write2("retry: 4000\n: open\n\n");
        const off = svc.store.subscribe((change) => {
          if (svc.store.concerns(person.id, change)) write2(`data: ${JSON.stringify({ v: change.version, devices: change.persons.includes(person.id) })}

`);
        });
        const beat = setInterval(() => write2(": beat\n\n"), HEARTBEAT_MS);
        stop = () => {
          off();
          clearInterval(beat);
        };
        request.signal?.addEventListener("abort", () => {
          stop();
          try {
            controller.close();
          } catch {
          }
        }, { once: true });
      },
      cancel() {
        stop();
      }
    });
    return new Response(stream, { status: 200, headers: { ...HEADERS, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
  });
  return [
    { path: `${API}/whoami`, methods: ["GET"], requestBody: "buffered", fetch: whoami },
    { path: `${API}/waiting`, methods: ["GET"], requestBody: "buffered", fetch: waiting },
    { path: `${API}/enroll`, methods: ["POST"], requestBody: "buffered", fetch: enroll },
    { path: `${API}/call`, methods: ["POST"], requestBody: "buffered", fetch: call },
    { path: `${API}/part`, methods: ["POST"], requestBody: "streaming", fetch: part },
    { path: `${API}/blob`, methods: ["GET", "HEAD"], requestBody: "buffered", fetch: blob },
    { path: `${API}/events`, methods: ["GET"], requestBody: "buffered", fetch: events }
  ];
}
function parseRange(header, size) {
  if (typeof header !== "string" || header.trim() === "") return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (match === null || size <= 0) return "unsatisfiable";
  const [, rawStart, rawEnd] = match;
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (rawEnd === "" || !(suffix > 0)) return "unsatisfiable";
    return [Math.max(0, size - suffix), size - 1];
  }
  const start = Number(rawStart);
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (start >= size || end < start) return "unsatisfiable";
  return [start, end];
}

// src/app.js
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
var ROUTE = "/sealed-files";
var APP = `${ROUTE}/app/`;
var here = dirname(fileURLToPath(import.meta.url));
var WEB = resolve(here, "../web");
var LOCALE = resolve(here, "../locale");
var TYPES = { js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", html: "text/html; charset=utf-8", json: "application/json; charset=utf-8", svg: "image/svg+xml" };
function admitOwner(connection, request) {
  const admission = connection.admit(request);
  if ("rejection" in admission) return { ok: false, status: admission.rejection };
  if (admission.peer?.principal?.kind !== "owner") return { ok: false, status: 403 };
  return { ok: true };
}
function policy(host) {
  const self = host ? `${host}${APP}` : "'self'";
  return [
    "default-src 'none'",
    `script-src ${self}`,
    `worker-src ${self}`,
    `style-src ${self}`,
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-src 'self' blob:",
    "font-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join("; ");
}
function fileFor(path) {
  if (!path.startsWith(APP)) return null;
  const rest = path.slice(APP.length);
  if (rest === "" || rest === "index.html") return resolve(WEB, "index.html");
  if (/^[a-z][a-z0-9-]*\.(js|css|svg)$/.test(rest)) return resolve(WEB, rest);
  const locale = /^locale\/([a-z]{2,3}(-[a-z0-9]{2,8})*)\.json$/i.exec(rest);
  if (locale) return resolve(LOCALE, `${locale[1].toLowerCase()}.json`);
  return null;
}
async function readLocales() {
  const out = {};
  for (const name2 of (await readdir(LOCALE)).filter((n) => /^[a-z]{2,3}(-[a-z0-9]+)*\.json$/i.test(n)).sort()) {
    try {
      const { ui } = JSON.parse(await readFile(resolve(LOCALE, name2), "utf8"));
      if (ui && typeof ui === "object") out[name2.slice(0, -5)] = ui;
    } catch {
    }
  }
  return out;
}
function createAppHandler({ connection }) {
  return async (req, res) => {
    const admitted = admitOwner(connection, req);
    if (!admitted.ok) {
      res.writeHead(admitted.status, { "content-type": "text/plain" });
      return res.end(admitted.status === 401 ? "Sign in first." : "Forbidden.");
    }
    const path = new URL(req.url ?? "/", "http://local.invalid").pathname;
    if (path === ROUTE || path === `${ROUTE}/` || path === APP.slice(0, -1)) {
      res.writeHead(302, { location: APP });
      return res.end();
    }
    let file = req.method === "GET" || req.method === "HEAD" ? fileFor(path) : null;
    let body;
    try {
      if (path === `${APP}locales.json`) {
        file = "locales.json";
        body = Buffer.from(JSON.stringify(await readLocales()));
      } else {
        body = file === null ? null : await readFile(file);
      }
    } catch {
      body = null;
    }
    if (body === null) {
      res.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" });
      return res.end("Not found.");
    }
    const type = TYPES[file.split(".").pop()] ?? "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "content-length": body.length,
      "cache-control": "no-cache, no-transform",
      "content-security-policy": policy(req.headers.host),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cross-origin-opener-policy": "same-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=()"
    });
    res.end(req.method === "HEAD" ? void 0 : body);
  };
}

// node_modules/@deepseek-ai/cosmokit/lib/index.js
function isNullable(value) {
  return value === null || value === void 0;
}
function isPlainObject(data) {
  return data && typeof data === "object" && !Array.isArray(data);
}
function filterKeys(object, filter) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
function mapValues(object, transform) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
function pick(source, keys, forced) {
  if (!keys) return { ...source };
  const result = {};
  for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
  return result;
}
var write = /* @__PURE__ */ Symbol.for("cosmokit.volatile.write");
function snapshot(value, ancestors = /* @__PURE__ */ new Set()) {
  if (typeof value === "function") throw new TypeError("volatile config cannot contain functions");
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) throw new TypeError("volatile config cannot contain cycles");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return Object.freeze(value.map((item) => snapshot(item, ancestors)));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError("volatile config objects must be plain objects or arrays");
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, ancestors)])));
  } finally {
    ancestors.delete(value);
  }
}
function createVolatile(value) {
  let current = snapshot(value);
  return Object.freeze({
    get: () => current,
    [write]: (value2) => {
      current = value2;
    }
  });
}
function isVolatile(value) {
  return typeof value === "object" && value !== null && write in value;
}
function is(type, value) {
  if (arguments.length === 1) return (value2) => is(type, value2);
  return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
  return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
  return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
var Binary;
(function(Binary2) {
  Binary2.is = isArrayBufferLike;
  Binary2.isSource = isArrayBufferSource;
  function fromSource(source) {
    if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    else return source;
  }
  Binary2.fromSource = fromSource;
  function toBase64(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
    let binary = "";
    const bytes = new Uint8Array(source);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  Binary2.toBase64 = toBase64;
  function fromBase64(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
    return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
  }
  Binary2.fromBase64 = fromBase64;
  function toHex(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
    return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  Binary2.toHex = toHex;
  function fromHex(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
    const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
    const buffer = [];
    for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
    return Uint8Array.from(buffer).buffer;
  }
  Binary2.fromHex = fromHex;
})(Binary || (Binary = {}));
var base64ToArrayBuffer = Binary.fromBase64;
var arrayBufferToBase64 = Binary.toBase64;
var hexToArrayBuffer = Binary.fromHex;
var arrayBufferToHex = Binary.toHex;
function clone(source, refs = /* @__PURE__ */ new Map()) {
  if (!source || typeof source !== "object") return source;
  if (is("Date", source)) return new Date(source.valueOf());
  if (is("RegExp", source)) return new RegExp(source.source, source.flags);
  if (isArrayBufferLike(source)) return source.slice(0);
  if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const cached = refs.get(source);
  if (cached) return cached;
  if (Array.isArray(source)) {
    const result2 = [];
    refs.set(source, result2);
    source.forEach((value, index) => {
      result2[index] = Reflect.apply(clone, null, [value, refs]);
    });
    return result2;
  }
  const result = Object.create(Object.getPrototypeOf(source));
  refs.set(source, result);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
    if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
    Reflect.defineProperty(result, key, descriptor);
  }
  return result;
}
function deepEqual(a, b, strict) {
  const ancestors = /* @__PURE__ */ new Set();
  function compare(a2, b2) {
    if (a2 === b2) return true;
    if (isVolatile(a2) || isVolatile(b2)) return isVolatile(a2) && isVolatile(b2);
    if (!strict && isNullable(a2) && isNullable(b2)) return true;
    if (typeof a2 !== typeof b2 || typeof a2 !== "object" || !a2 || !b2) return false;
    if (ancestors.has(a2)) return false;
    function check(test, then) {
      return test(a2) ? test(b2) ? then(a2, b2) : false : test(b2) ? false : void 0;
    }
    ancestors.add(a2);
    try {
      return check(Array.isArray, (a3, b3) => {
        if (a3.length !== b3.length) return false;
        for (let index = 0; index < a3.length; index++) if (!compare(a3[index], b3[index])) return false;
        return true;
      }) ?? check(is("Date"), (a3, b3) => a3.valueOf() === b3.valueOf()) ?? check(is("URL"), (a3, b3) => a3.href === b3.href) ?? check(is("RegExp"), (a3, b3) => a3.source === b3.source && a3.flags === b3.flags) ?? check(isArrayBufferLike, (a3, b3) => {
        if (a3.byteLength !== b3.byteLength) return false;
        const viewA = new Uint8Array(a3);
        const viewB = new Uint8Array(b3);
        for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
        return true;
      }) ?? ((!strict || [a2, b2].every((value) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) && Object.keys({
        ...a2,
        ...b2
      }).every((key) => compare(a2[key], b2[key])));
    } finally {
      ancestors.delete(a2);
    }
  }
  return compare(a, b);
}
var Time;
(function(Time2) {
  Time2.millisecond = 1;
  Time2.second = 1e3;
  Time2.minute = Time2.second * 60;
  Time2.hour = Time2.minute * 60;
  Time2.day = Time2.hour * 24;
  Time2.week = Time2.day * 7;
  let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
  function setTimezoneOffset(offset) {
    timezoneOffset = offset;
  }
  Time2.setTimezoneOffset = setTimezoneOffset;
  function getTimezoneOffset() {
    return timezoneOffset;
  }
  Time2.getTimezoneOffset = getTimezoneOffset;
  function getDateNumber(date2 = /* @__PURE__ */ new Date(), offset) {
    if (typeof date2 === "number") date2 = new Date(date2);
    if (offset === void 0) offset = timezoneOffset;
    return Math.floor((date2.valueOf() / Time2.minute - offset) / 1440);
  }
  Time2.getDateNumber = getDateNumber;
  function fromDateNumber(value, offset) {
    const date2 = new Date(value * Time2.day);
    if (offset === void 0) offset = timezoneOffset;
    return new Date(+date2 + offset * Time2.minute);
  }
  Time2.fromDateNumber = fromDateNumber;
  const numeric = /\d+(?:\.\d+)?/.source;
  const timeRegExp = new RegExp(`^${[
    "w(?:eek(?:s)?)?",
    "d(?:ay(?:s)?)?",
    "h(?:our(?:s)?)?",
    "m(?:in(?:ute)?(?:s)?)?",
    "s(?:ec(?:ond)?(?:s)?)?"
  ].map((unit) => `(${numeric}${unit})?`).join("")}$`);
  function parseTime(source) {
    const capture = timeRegExp.exec(source);
    if (!capture) return 0;
    return (parseFloat(capture[1]) * Time2.week || 0) + (parseFloat(capture[2]) * Time2.day || 0) + (parseFloat(capture[3]) * Time2.hour || 0) + (parseFloat(capture[4]) * Time2.minute || 0) + (parseFloat(capture[5]) * Time2.second || 0);
  }
  Time2.parseTime = parseTime;
  function parseDate(date2) {
    const parsed = parseTime(date2);
    if (parsed) date2 = Date.now() + parsed;
    else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date2}`;
    else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date2}`;
    return date2 ? new Date(date2) : /* @__PURE__ */ new Date();
  }
  Time2.parseDate = parseDate;
  function format(ms) {
    const abs = Math.abs(ms);
    if (abs >= Time2.day - Time2.hour / 2) return Math.round(ms / Time2.day) + "d";
    else if (abs >= Time2.hour - Time2.minute / 2) return Math.round(ms / Time2.hour) + "h";
    else if (abs >= Time2.minute - Time2.second / 2) return Math.round(ms / Time2.minute) + "m";
    else if (abs >= Time2.second) return Math.round(ms / Time2.second) + "s";
    return ms + "ms";
  }
  Time2.format = format;
  function toDigits(source, length = 2) {
    return source.toString().padStart(length, "0");
  }
  Time2.toDigits = toDigits;
  function template(template2, time = /* @__PURE__ */ new Date()) {
    return template2.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
  }
  Time2.template = template;
})(Time || (Time = {}));

// node_modules/@deepseek-ai/schemastery/lib/index.mjs
var kSchema = /* @__PURE__ */ Symbol.for("schemastery");
var kValidationError = /* @__PURE__ */ Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
  options;
  name = "ValidationError";
  constructor(message, options) {
    let prefix = "$";
    for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
    else if (typeof segment === "number") prefix += "[" + segment + "]";
    else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
    if (prefix.startsWith(".")) prefix = prefix.slice(1);
    super((prefix === "$" ? "" : `${prefix} `) + message);
    this.options = options;
  }
  static is(error) {
    return !!error?.[kValidationError];
  }
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
var Schema = function(options) {
  const schema = function(data, options2 = {}) {
    return Schema.resolve(data, schema, options2)[0];
  };
  if (options.refs) {
    const refs = mapValues(options.refs, (options2) => new Schema(options2));
    const getRef = (uid) => refs[uid];
    for (const key in refs) {
      const options2 = refs[key];
      options2.sKey = getRef(options2.sKey);
      options2.inner = getRef(options2.inner);
      options2.list = options2.list && options2.list.map(getRef);
      options2.dict = options2.dict && mapValues(options2.dict, getRef);
    }
    return refs[options.uid];
  }
  Object.assign(schema, options);
  if (typeof schema.callback === "string") try {
    schema.callback = new Function("return " + schema.callback)();
  } catch {
  }
  Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
  Object.setPrototypeOf(schema, Schema.prototype);
  schema.meta ||= {};
  schema.toString = schema.toString.bind(schema);
  return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
  return {
    version: 1,
    vendor: "schemastery",
    validate: (value) => {
      try {
        return { value: Schema.resolve(value, this, {})[0] };
      } catch (error) {
        if (ValidationError.is(error)) return { issues: [{
          message: error.message,
          path: error.options.path
        }] };
        throw error;
      }
    }
  };
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
  if (globalThis.__schemastery_refs__) {
    globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
    return this.uid;
  }
  globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
  globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
  const result = {
    uid: this.uid,
    refs: globalThis.__schemastery_refs__
  };
  globalThis.__schemastery_refs__ = void 0;
  return result;
};
Schema.prototype.set = function set(key, value) {
  this.dict[key] = value;
  return this;
};
Schema.prototype.push = function push(value) {
  this.list.push(value);
  return this;
};
function mergeDesc(original, messages) {
  const result = typeof original === "string" ? { "": original } : { ...original };
  for (const locale in messages) {
    const value = messages[locale];
    if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
    else if (typeof value === "string") result[locale] = value;
  }
  return result;
}
function getInner(value) {
  return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
  return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
  const schema = Schema(this);
  const desc = mergeDesc(schema.meta.description, messages);
  if (Object.keys(desc).length) schema.meta.description = desc;
  if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
    return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
  });
  if (schema.list) schema.list = schema.list.map((inner, index) => {
    return inner.i18n(mapValues(messages, (data = {}) => {
      if (Array.isArray(getInner(data))) return getInner(data)[index];
      if (Array.isArray(data)) return data[index];
      return extractKeys(data);
    }));
  });
  if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
    if (getInner(data)) return getInner(data);
    return extractKeys(data);
  }));
  if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
  return schema;
};
Schema.prototype.extra = function extra(key, value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
};
for (const key of [
  "required",
  "disabled",
  "collapse",
  "hidden",
  "loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.deprecated = function deprecated() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "deprecated",
    type: "danger"
  });
  return schema;
};
Schema.prototype.experimental = function experimental() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "experimental",
    type: "warning"
  });
  return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
  const schema = Schema(this);
  const pattern2 = pick(regexp, ["source", "flags"]);
  schema.meta = {
    ...schema.meta,
    pattern: pattern2
  };
  return schema;
};
Schema.prototype.simplify = function simplify(value) {
  if (isVolatile(value)) value = value.get();
  if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
  if (isNullable(value)) return value;
  if (this.type === "object" || this.type === "dict") {
    const result = {};
    for (const key in value) {
      const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
      if (this.type === "dict" || !isNullable(item)) result[key] = item;
    }
    if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
    return result;
  } else if (this.type === "array" || this.type === "tuple") {
    const result = [];
    value.forEach((value2, index) => {
      const schema = this.type === "array" ? this.inner : this.list[index];
      const item = schema ? schema.simplify(value2) : value2;
      result.push(item);
    });
    return result;
  } else if (this.type === "intersect") {
    const result = {};
    for (const item of this.list) Object.assign(result, item.simplify(value));
    return result;
  } else if (this.type === "union") for (const schema of this.list) try {
    Schema.resolve(value, schema, {});
    return schema.simplify(value);
  } catch {
  }
  return value;
};
Schema.prototype.toString = function toString(inline) {
  return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra2) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    role,
    extra: extra2
  };
  return schema;
};
for (const key of [
  "default",
  "link",
  "comment",
  "description",
  "max",
  "min",
  "step"
]) Object.assign(Schema.prototype, { [key](value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.volatile = function volatile() {
  if (this.meta.volatile) throw new TypeError("volatile schema is already wrapped");
  return this.extra("volatile", true);
};
var resolvers = {};
var checkedVolatile = /* @__PURE__ */ Symbol("checked-volatile-schema");
function validateVolatileSchema(schema, path = [], blocked = false, seen = /* @__PURE__ */ new Map()) {
  const states = seen.get(schema) ?? /* @__PURE__ */ new Set();
  if (states.has(blocked)) return;
  states.add(blocked);
  seen.set(schema, states);
  if (schema.meta?.volatile && blocked) throw new ValidationError("volatile fields require a fixed object path without an enclosing volatile field", { path });
  const nested = blocked || !!schema.meta?.volatile;
  if (schema.dict) for (const [key, child] of Object.entries(schema.dict)) validateVolatileSchema(child, [...path, key], nested, seen);
  if (schema.sKey) validateVolatileSchema(schema.sKey, [...path, "<key>"], true, seen);
  if (schema.inner && (schema.type !== "lazy" || schema.inner[kSchema])) validateVolatileSchema(schema.inner, [...path, "*"], true, seen);
  if (schema.list) for (let index = 0; index < schema.list.length; index++) validateVolatileSchema(schema.list[index], [...path, String(index)], true, seen);
}
Schema.extend = function extend(type, resolve4) {
  resolvers[type] = resolve4;
};
Schema.resolve = function resolve2(data, schema, options = {}, strict = false) {
  if (!schema) return [data];
  if (!options[checkedVolatile]) {
    validateVolatileSchema(schema, options.path);
    options = {
      ...options,
      [checkedVolatile]: true
    };
  }
  if (schema.meta?.volatile) {
    const inner = Schema(schema);
    inner.meta = {
      ...schema.meta,
      volatile: false
    };
    const [value, adapted] = Schema.resolve(data, inner, options, strict);
    try {
      return [createVolatile(value), adapted];
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : String(error), options);
    }
  }
  if (options.ignore?.(data, schema)) return [data];
  if (isNullable(data) && schema.type !== "lazy") {
    if (schema.meta.required) throw new ValidationError(`missing required value`, options);
    let current = schema;
    let fallback = schema.meta.default;
    while (current?.type === "intersect" && isNullable(fallback)) {
      current = current.list[0];
      fallback = current?.meta.default;
    }
    if (isNullable(fallback)) return [data];
    data = clone(fallback);
  }
  const callback = resolvers[schema.type];
  if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
  try {
    return callback(data, schema, options, strict);
  } catch (error) {
    if (!schema.meta.loose) throw error;
    return [schema.meta.default];
  }
};
Schema.from = function from(source) {
  if (isNullable(source)) return Schema.any();
  else if ([
    "string",
    "number",
    "boolean"
  ].includes(typeof source)) return Schema.const(source).required();
  else if (source[kSchema]) return source;
  else if (typeof source === "function") switch (source) {
    case String:
      return Schema.string().required();
    case Number:
      return Schema.number().required();
    case Boolean:
      return Schema.boolean().required();
    case Function:
      return Schema.function().required();
    default:
      return Schema.is(source).required();
  }
  else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
  const toJSON2 = () => {
    if (!schema.inner[kSchema]) {
      schema.inner = schema.builder();
      schema.inner.meta = {
        ...schema.meta,
        ...schema.inner.meta
      };
    }
    return schema.inner.toJSON();
  };
  const schema = new Schema({
    type: "lazy",
    builder,
    inner: { toJSON: toJSON2 }
  });
  return schema;
};
Schema.natural = function natural() {
  return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
  return Schema.number().step(0.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
  return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
    const date2 = new Date(value);
    if (isNaN(+date2)) throw new ValidationError(`invalid date "${value}"`, options);
    return date2;
  }, true)]);
};
Schema.regExp = function regExp(flag = "") {
  return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
    try {
      return new RegExp(value, flag);
    } catch (e) {
      throw new ValidationError(e.message, options);
    }
  }, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
  return Schema.union([
    Schema.is(ArrayBuffer),
    Schema.is(SharedArrayBuffer),
    Schema.transform(Schema.any(), (value, options) => {
      if (Binary.isSource(value)) return Binary.fromSource(value);
      throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
    }, true),
    ...encoding ? [Schema.transform(Schema.string(), (value, options) => {
      try {
        return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
      } catch (e) {
        throw new ValidationError(e.message, options);
      }
    }, true)] : []
  ]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
  if (!schema.inner[kSchema]) {
    schema.inner = schema.builder();
    schema.inner.meta = {
      ...schema.meta,
      ...schema.inner.meta
    };
    validateVolatileSchema(schema.inner, options.path, true);
  }
  return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
  return [data];
});
Schema.extend("never", (data, _, options) => {
  throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
  if (deepEqual(data, value)) return [value];
  throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
  const { max = Infinity, min = -Infinity } = meta;
  if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
  if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
  if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
  if (meta.pattern) {
    const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
    if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
  }
  checkWithinRange(data.length, meta, "string length", options);
  return [data];
});
function decimalShift(data, digits) {
  const str = data.toString();
  if (str.includes("e")) return data * Math.pow(10, digits);
  const index = str.indexOf(".");
  if (index === -1) return data * Math.pow(10, digits);
  const frac = str.slice(index + 1);
  const integer = str.slice(0, index);
  if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
  return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
  step = Math.abs(step);
  if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
  const index = step.toString().indexOf(".");
  const digits = step.toString().slice(index + 1).length;
  return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
  if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
  checkWithinRange(data, meta, "number", options);
  const { step } = meta;
  if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
  return [data];
});
Schema.extend("boolean", (data, _, options) => {
  if (typeof data === "boolean") return [data];
  throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
  let value = 0, keys = [];
  if (typeof data === "number") {
    value = data;
    for (const key in bits) if (data & bits[key]) keys.push(key);
  } else if (Array.isArray(data)) {
    keys = data;
    for (const key of keys) {
      if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
      if (key in bits) value |= bits[key];
    }
  } else throw new ValidationError(`expected number or array but got ${data}`, options);
  if (value === meta.default) return [value];
  return [value, keys];
});
Schema.extend("function", (data, _, options) => {
  if (typeof data === "function") return [data];
  throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
  if (typeof constructor === "function") {
    if (data instanceof constructor) return [data];
    throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
  } else {
    if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
    let prototype = Object.getPrototypeOf(data);
    while (prototype) {
      if (prototype.constructor?.name === constructor) return [data];
      prototype = Object.getPrototypeOf(prototype);
    }
    throw new ValidationError(`expected ${constructor} but got ${data}`, options);
  }
});
function property(data, key, schema, options) {
  try {
    const [value, adapted] = Schema.resolve(data[key], schema, {
      ...options,
      path: [...options.path || [], key]
    });
    if (adapted !== void 0) data[key] = adapted;
    return value;
  } catch (e) {
    if (!options?.autofix) throw e;
    delete data[key];
    return schema.meta.volatile ? createVolatile(schema.meta.default) : schema.meta.default;
  }
}
Schema.extend("array", (data, { inner, meta }, options) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
  return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in data) {
    let rKey;
    try {
      rKey = Schema.resolve(key, sKey, options)[0];
    } catch (error) {
      if (strict) continue;
      throw error;
    }
    result[rKey] = property(data, key, inner, options);
    data[rKey] = data[key];
    if (key !== rKey) delete data[key];
  }
  return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  const result = list.map((inner, index) => property(data, index, inner, options));
  if (strict) return [result];
  result.push(...data.slice(list.length));
  return [result];
});
function merge(result, data) {
  for (const key in data) {
    if (key in result) continue;
    result[key] = data[key];
  }
}
Schema.extend("object", (data, { dict }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in dict) {
    const value = property(data, key, dict[key], options);
    if (!isNullable(value) || key in data) result[key] = value;
  }
  if (!strict) merge(result, data);
  return [result];
});
Schema.extend("union", (data, { list, toString: toString2 }, options, strict) => {
  const messages = [];
  for (const inner of list) try {
    return Schema.resolve(data, inner, options, strict);
  } catch (error) {
    messages.push(error);
  }
  throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString: toString2 }, options, strict) => {
  if (!list.length) return [data];
  let result;
  for (const inner of list) {
    const value = Schema.resolve(data, inner, options, true)[0];
    if (isNullable(value)) continue;
    if (isNullable(result)) result = value;
    else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
    else if (typeof value === "object") merge(result ??= {}, value);
    else if (result !== value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
  }
  if (!strict && isPlainObject(data)) merge(result, data);
  return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
  const [result, adapted = data] = Schema.resolve(data, inner, options, true);
  if (preserve) return [callback(result)];
  else return [callback(result), callback(adapted)];
});
var formatters = {};
function defineMethod(name2, keys, format) {
  formatters[name2] = format;
  Object.assign(Schema, { [name2](...args) {
    const schema = new Schema({ type: name2 });
    keys.forEach((key, index) => {
      switch (key) {
        case "sKey":
          schema.sKey = args[index] ?? Schema.string();
          break;
        case "inner":
          schema.inner = Schema.from(args[index]);
          break;
        case "list":
          schema.list = args[index].map(Schema.from);
          break;
        case "dict":
          schema.dict = mapValues(args[index], Schema.from);
          break;
        case "bits":
          schema.bits = {};
          for (const key2 in args[index]) {
            if (typeof args[index][key2] !== "number") continue;
            schema.bits[key2] = args[index][key2];
          }
          break;
        case "callback": {
          const callback = schema.callback = args[index];
          callback["toJSON"] ||= () => callback.toString();
          break;
        }
        case "constructor": {
          const constructor = schema.constructor = args[index];
          if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
          break;
        }
        default:
          schema[key] = args[index];
      }
    });
    if (name2 === "object" || name2 === "dict") schema.meta.default = {};
    else if (name2 === "array" || name2 === "tuple") schema.meta.default = [];
    else if (name2 === "bitset") schema.meta.default = 0;
    return schema;
  } });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
  if (typeof constructor === "function") return constructor.name;
  else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
  if (Object.keys(dict).length === 0) return "{}";
  return `{ ${Object.entries(dict).map(([key, inner]) => {
    return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
  }).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
  const result = list.map(({ toString: format }) => format()).join(" | ");
  return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
  return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
  "inner",
  "callback",
  "preserve"
], ({ inner }, isInner) => inner.toString(isInner));

// src/config.js
var GIB = 1024 ** 3;
var Config = Schema.object({
  stateDir: Schema.string().default("~/.dsh/sealed-files").description("Where the encrypted files, the file list and the device list are kept."),
  identityFile: Schema.string().default("").description("The assistant's age identity (an X25519 key, AGE-SECRET-KEY-1...). Made with mode 600 on first start when missing. Empty means <stateDir>/identity.txt. Every stored file opens with `age -d -i <this file>`."),
  people: Schema.dict(Schema.string()).default({}).description("Verified sign-in id (an OIDC subject) -> person id. Each person gets a space of their own; everyone shares the space `shared`."),
  peopleFile: Schema.string().default("").description("A JSON file with more of the same mapping (values are display names; the person id is the lower-cased name), re-read when it changes."),
  peopleKey: Schema.string().default("").description("The top-level key of peopleFile that holds the mapping, such as oidc_users. Empty reads the whole file as the mapping."),
  sharedSpace: Schema.boolean().default(true).description("Give everyone a common space besides their own."),
  maxFileGb: Schema.number().min(1e-3).default(4).description("Largest file one upload may be, in GiB."),
  maxStoreGb: Schema.number().min(0.01).default(10).description("Most the stored files and unfinished uploads may take together, in GiB."),
  minFreeGb: Schema.number().min(0).default(6).description("An upload is refused when it would leave less free space than this on the disk of stateDir, in GiB."),
  retentionDays: Schema.natural().min(1).default(30).description("Files are deleted this many days after they arrive, unless pinned."),
  snippetHours: Schema.natural().min(1).default(24).description("Clipboard snippets (short text sent in one step) are deleted this many hours after they arrive, unless pinned."),
  uploadDays: Schema.natural().min(1).default(3).description("Unfinished uploads are deleted after this many days without a new part."),
  deviceIdleDays: Schema.natural().min(1).default(90).description("A device that has not been used for this many days is removed from the list."),
  notifyCommand: Schema.array(Schema.string()).default([]).description("Program and fixed arguments run when a device asks to be added, with one line of JSON on standard input: { event, person, device: { id, name }, code }. Send the code to that person over a channel that does not pass through the web proxy, such as a chat app. Empty runs nothing."),
  assistantName: Schema.string().default("").description(`The assistant's name as people know it, shown as the sender of what it puts in and on the pairing screen. Empty says "Assistant" in the viewer's language.`),
  label: Schema.string().default("").description("Sidebar label. Empty uses the page's name in the viewer's language.")
});
var limitsOf = (config) => ({
  maxFileBytes: Math.floor(config.maxFileGb * GIB),
  maxStoreBytes: Math.floor(config.maxStoreGb * GIB),
  minFreeBytes: Math.floor(config.minFreeGb * GIB)
});

// src/decisions.js
import { watch } from "node:fs";
import { appendFile, mkdir, readdir as readdir2, readFile as readFile2, rm } from "node:fs/promises";
import { join } from "node:path";
var DECISIONS = "decisions";
async function followDecisions({ stateDir, decide, logger }) {
  const dir = join(stateDir, DECISIONS);
  await mkdir(dir, { recursive: true, mode: 448 });
  let running = Promise.resolve();
  async function take() {
    for (const name2 of (await readdir2(dir)).filter((n) => n.endsWith(".json")).sort()) {
      const path = join(dir, name2);
      let outcome;
      try {
        const decision = JSON.parse(await readFile2(path, "utf8"));
        outcome = await decide(decision);
        logger.info("decision for device %s: %s", decision.device, outcome.applied ? decision.choice : outcome.reason);
        outcome = { decision, ...outcome };
      } catch (error) {
        outcome = { file: name2, error: error.message };
      }
      await appendFile(join(stateDir, "decisions.jsonl"), `${JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), ...outcome })}
`, { mode: 384 });
      await rm(path, { force: true });
    }
  }
  const kick = () => {
    running = running.then(take, take).catch((error) => logger.warn("decisions: %s", error.message));
  };
  const watcher = watch(dir, kick);
  kick();
  return async () => {
    watcher.close();
    await running;
  };
}

// src/service.js
import { spawn } from "node:child_process";
import { join as join4 } from "node:path";
import { b64 as b642, deviceIdOf, openBytes, pairingCode } from "../web/seal.js";
import { ID as ID2, PREVIEW_CHARS, SHARED as SHARED2, SNIPPET as SNIPPET2, SNIPPET_CHARS, TEXT_TYPE, cleanFolder as cleanFolder3, cleanName } from "../web/protocol.js";

// src/files.js
import { open } from "node:fs/promises";
import { createReadStream as createReadStream2 } from "node:fs";
import { CHUNK, CHUNK_CT, NONCE_BYTES, FILE_KEY_BYTES, chunkCount, encodeHeader, openChunk, parseHeader, payloadKey, payloadSize, random, sealChunk, unwrapFileKey } from "../web/age.js";
var HEADER_READ = 64 * 1024;
async function readKey(path, priv) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(HEADER_READ);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_READ, 0);
    return keyOfPrefix(new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead), priv);
  } finally {
    await handle.close();
  }
}
function keyOfPrefix(bytes, priv) {
  const header = parseHeader(bytes);
  if (header === null || bytes.length < header.length + NONCE_BYTES) throw new Error("incomplete age header");
  const fileKey = unwrapFileKey(header, priv);
  const nonce = bytes.slice(header.length, header.length + NONCE_BYTES);
  return { fileKey, nonce, payloadAt: header.length + NONCE_BYTES, key: payloadKey(fileKey, nonce) };
}
function verifyChunks(key, first, final, buffer) {
  for (let at = 0, i = first; at < buffer.length; at += CHUNK_CT, i++) openChunk(key, i, i === final, buffer.subarray(at, Math.min(at + CHUNK_CT, buffer.length)));
}
async function* decryptFile(path, priv, size) {
  const { key, payloadAt } = await readKey(path, priv);
  const final = chunkCount(size) - 1;
  let index = 0;
  let pending = Buffer.alloc(0);
  for await (const piece of createReadStream2(path, { start: payloadAt, highWaterMark: CHUNK_CT * 4 })) {
    pending = pending.length === 0 ? piece : Buffer.concat([pending, piece]);
    while (index < final && pending.length >= CHUNK_CT) {
      yield openChunk(key, index, false, pending.subarray(0, CHUNK_CT));
      pending = pending.subarray(CHUNK_CT);
      index++;
    }
    if (index === final && pending.length > CHUNK_CT) throw new Error("age file longer than its size");
  }
  if (index !== final) throw new Error("age file truncated");
  yield openChunk(key, index, true, pending);
}
async function encryptToFile(pieces, size, dest, recipientPub) {
  const fileKey = random(FILE_KEY_BYTES);
  const nonce = random(NONCE_BYTES);
  const key = payloadKey(fileKey, nonce);
  const header = encodeHeader(fileKey, recipientPub);
  const final = chunkCount(size) - 1;
  const handle = await open(dest, "wx", 384);
  let written = 0;
  const write2 = async (bytes) => {
    await handle.write(bytes, 0, bytes.length, written);
    written += bytes.length;
  };
  try {
    await write2(header);
    await write2(nonce);
    let index = 0;
    let total = 0;
    let pending = Buffer.alloc(0);
    for await (const piece of pieces) {
      total += piece.length;
      if (total > size) throw new Error("more bytes than the stated size");
      pending = pending.length === 0 ? Buffer.from(piece) : Buffer.concat([pending, piece]);
      while (index < final && pending.length >= CHUNK) {
        await write2(sealChunk(key, index, false, pending.subarray(0, CHUNK)));
        pending = pending.subarray(CHUNK);
        index++;
      }
    }
    if (total !== size || index !== final) throw new Error("fewer bytes than the stated size");
    await write2(sealChunk(key, index, true, pending));
    if (written !== header.length + NONCE_BYTES + payloadSize(size)) throw new Error("age file size mismatch");
    return { cipherSize: written, payloadAt: header.length + NONCE_BYTES };
  } finally {
    await handle.close();
  }
}

// src/keys.js
import { createCipheriv, createDecipheriv } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname as dirname2 } from "node:path";
import { decodeIdentity, encodeIdentity, encodeRecipient, setChunkCipher } from "../web/age.js";
import { derivePairKey } from "../web/seal.js";
import { x25519 } from "../web/vendor.js";
setChunkCipher({
  seal(key, nonce, data) {
    const cipher = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
    return Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
  },
  open(key, nonce, data) {
    if (data.length < 16) throw new Error("chunk too short");
    const decipher = createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
    decipher.setAuthTag(data.subarray(data.length - 16));
    return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
  }
});
function loadIdentity(file) {
  if (!existsSync(file)) {
    mkdirSync(dirname2(file), { recursive: true, mode: 448 });
    const priv2 = x25519.utils.randomSecretKey();
    const pub2 = x25519.getPublicKey(priv2);
    writeFileSync(file, `# created: ${(/* @__PURE__ */ new Date()).toISOString()}
# public key: ${encodeRecipient(pub2)}
${encodeIdentity(priv2)}
`, { mode: 384, flag: "wx" });
    chmodSync(file, 384);
  }
  const line = readFileSync(file, "utf8").split("\n").map((l) => l.trim()).find((l) => l.startsWith("AGE-SECRET-KEY-1"));
  if (line === void 0) throw new Error(`no AGE-SECRET-KEY-1 line in ${file}`);
  const priv = decodeIdentity(line);
  const pub = x25519.getPublicKey(priv);
  const pairKeys = /* @__PURE__ */ new Map();
  return {
    priv,
    pub,
    recipient: encodeRecipient(pub),
    /** The AES-GCM key shared with the device whose X25519 public key is `devicePub` (cached). */
    async pairKey(devicePub) {
      const id = Buffer.from(devicePub).toString("base64");
      let key = pairKeys.get(id);
      if (key === void 0) {
        key = await derivePairKey(x25519.getSharedSecret(priv, devicePub), devicePub, pub);
        pairKeys.set(id, key);
      }
      return key;
    }
  };
}

// src/people.js
import { readFileSync as readFileSync2, statSync } from "node:fs";
var PERSON_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
var personIdOf = (name2) => String(name2).trim().toLowerCase().replace(/\s+/g, "-");
function createPeople(config, warn) {
  let fileStamp = "";
  let fromFile = {};
  function readFile5() {
    if (config.peopleFile === "") return {};
    let stamp;
    try {
      const stat3 = statSync(config.peopleFile);
      stamp = `${stat3.mtimeMs}:${stat3.size}`;
    } catch {
      return {};
    }
    if (stamp !== fileStamp) {
      fileStamp = stamp;
      try {
        const data = JSON.parse(readFileSync2(config.peopleFile, "utf8"));
        const map = config.peopleKey === "" ? data : data?.[config.peopleKey];
        fromFile = map !== null && typeof map === "object" ? map : {};
      } catch (error) {
        warn("people file unreadable: %s", error.message);
        fromFile = {};
      }
    }
    return fromFile;
  }
  function table() {
    const out = /* @__PURE__ */ new Map();
    for (const [sub, name2] of [...Object.entries(readFile5()), ...Object.entries(config.people)]) {
      if (typeof name2 !== "string") continue;
      const id = personIdOf(name2);
      if (PERSON_ID.test(id)) out.set(sub, { id, name: name2.trim() });
    }
    return out;
  }
  return {
    /** The person behind the current `/api` request, or null. */
    current(identityService) {
      const who = typeof identityService?.current === "function" ? identityService.current() : null;
      if (who === null || typeof who?.id !== "string" || who.id === "") return null;
      return table().get(who.id) ?? null;
    },
    /** Every person, by id, with a display name. */
    all() {
      const people = /* @__PURE__ */ new Map();
      for (const person of table().values()) if (!people.has(person.id)) people.set(person.id, person);
      return [...people.values()];
    }
  };
}

// src/store.js
import { randomBytes } from "node:crypto";
import { appendFile as appendFile2, mkdir as mkdir2, readFile as readFile3, rename, rm as rm2, stat as stat2, writeFile } from "node:fs/promises";
import { join as join2 } from "node:path";
import { SHARED, SNIPPET, cleanFolder, within } from "../web/protocol.js";
import { base32nopad } from "../web/vendor.js";
var ASSISTANT = "assistant";
var DAY = 864e5;
var HOUR = 36e5;
var PENDING_MS = DAY;
var newId = () => base32nopad.encode(randomBytes(10)).toLowerCase();
async function createStore({ dir, people, sharedSpace, retentionDays, snippetHours, deviceIdleDays, logger }) {
  const itemsDir = join2(dir, "items");
  await mkdir2(itemsDir, { recursive: true, mode: 448 });
  const indexFile = join2(dir, "index.json");
  const devicesFile = join2(dir, "devices.json");
  const rosterLog = join2(dir, "devices.jsonl");
  const index = { items: {}, folders: {}, ...await readJson(indexFile) };
  const clearText = Object.values(index.items).filter((item) => "preview" in item);
  for (const item of clearText) delete item.preview;
  const roster = { devices: {}, ...await readJson(devicesFile) };
  const listeners = /* @__PURE__ */ new Set();
  let version2 = 0;
  let saving = Promise.resolve();
  if (clearText.length > 0) {
    await save([[indexFile, index]]);
    logger.info("removed the stored previews of %d notes from the index", clearText.length);
  }
  async function readJson(file) {
    try {
      return JSON.parse(await readFile3(file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") logger.warn("could not read %s: %s", file, error.message);
      return {};
    }
  }
  function save(which) {
    const run = async () => {
      for (const [file, data] of which) {
        const temp = `${file}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(data), { mode: 384 });
        await rename(temp, file);
      }
    };
    saving = saving.then(run, run);
    return saving;
  }
  function changed({ spaces = [], persons = [] }) {
    version2++;
    for (const listener of listeners) listener({ version: version2, spaces, persons });
  }
  const spacesOf = (person) => person === ASSISTANT ? allSpaces() : [person, ...sharedSpace ? [SHARED] : []];
  const allSpaces = () => [...people.all().map((p) => p.id), ...sharedSpace ? [SHARED] : []];
  const canSee = (person, space) => spacesOf(person).includes(space);
  const concerns = (person, change) => person === ASSISTANT || change.persons.includes(person) || change.spaces.some((space) => canSee(person, space));
  const itemPath = (id) => join2(itemsDir, `${id}.age`);
  const expiresAt = (kind, pinned, now = Date.now()) => pinned ? null : now + (kind === SNIPPET ? snippetHours * HOUR : retentionDays * DAY);
  function itemsFor(person) {
    const spaces = new Set(spacesOf(person));
    return Object.values(index.items).filter((item) => spaces.has(item.space) && !item.derivedOf);
  }
  function foldersFor(person) {
    const out = {};
    for (const space of spacesOf(person)) {
      const set2 = new Set(index.folders[space] ?? []);
      for (const item of Object.values(index.items)) if (item.space === space && item.folder !== "") set2.add(item.folder);
      for (const folder of [...set2]) for (let parts = folder.split("/"); parts.length > 1; parts.pop()) set2.add(parts.slice(0, -1).join("/"));
      out[space] = [...set2].sort();
    }
    return out;
  }
  function visibleItem(person, id) {
    const item = index.items[id];
    if (item === void 0 || !canSee(person, item.space)) return null;
    return item;
  }
  async function addItem(item) {
    index.items[item.id] = item;
    await save([[indexFile, index]]);
    changed({ spaces: [item.space] });
    return item;
  }
  async function updateItem(person, id, patch) {
    const item = visibleItem(person, id);
    if (item === null) throw Object.assign(new Error("no such file"), { status: 404 });
    if (patch.space !== void 0 && !canSee(person, patch.space)) throw Object.assign(new Error("no such space"), { status: 403 });
    const before = item.space;
    Object.assign(item, patch);
    if (patch.pinned !== void 0) item.expires = expiresAt(item.kind, patch.pinned);
    await save([[indexFile, index]]);
    changed({ spaces: [.../* @__PURE__ */ new Set([before, item.space])] });
    return item;
  }
  async function removeItem(person, id) {
    const item = visibleItem(person, id);
    if (item === null) throw Object.assign(new Error("no such file"), { status: 404 });
    const ids = [id, ...Object.values(index.items).filter((other) => other.derivedOf === id).map((other) => other.id)];
    for (const each of ids) delete index.items[each];
    await save([[indexFile, index]]);
    await Promise.all(ids.map((each) => rm2(itemPath(each), { force: true })));
    changed({ spaces: [item.space] });
  }
  async function makeFolder(person, space, path) {
    const folder = cleanFolder(path);
    if (!canSee(person, space) || folder === null || folder === "") throw Object.assign(new Error("bad folder"), { status: 400 });
    const list = new Set(index.folders[space] ?? []);
    list.add(folder);
    index.folders[space] = [...list].sort();
    await save([[indexFile, index]]);
    changed({ spaces: [space] });
  }
  async function moveFolder(person, space, from2, to) {
    const source = cleanFolder(from2);
    if (!canSee(person, space) || source === null || source === "") throw Object.assign(new Error("bad folder"), { status: 400 });
    const inside = Object.values(index.items).filter((item) => item.space === space && within(item.folder, source));
    if (to === null) {
      if (inside.length > 0) throw Object.assign(new Error("folder not empty"), { status: 409 });
      index.folders[space] = (index.folders[space] ?? []).filter((folder) => !within(folder, source));
    } else {
      const target = cleanFolder(to);
      if (target === null || target === "" || within(target, source)) throw Object.assign(new Error("bad folder"), { status: 400 });
      const swap = (folder) => within(folder, source) ? target + folder.slice(source.length) : folder;
      for (const item of inside) item.folder = swap(item.folder);
      index.folders[space] = [...new Set((index.folders[space] ?? []).map(swap))].sort();
    }
    await save([[indexFile, index]]);
    changed({ spaces: [space] });
  }
  async function markSeen(ids) {
    let any = false;
    for (const id of ids) {
      const item = index.items[id];
      if (item !== void 0 && !item.seenByAssistant) {
        item.seenByAssistant = true;
        any = true;
      }
    }
    if (any) await save([[indexFile, index]]);
  }
  const devicesOf = (person) => Object.values(roster.devices).filter((device) => device.person === person);
  function saveRoster(changes) {
    const at = (/* @__PURE__ */ new Date()).toISOString();
    const lines = changes.map(({ event, device, by, ...more }) => `${JSON.stringify({ at, event, device: { id: device.id, person: device.person, name: device.name, status: device.status }, by, ...more })}
`);
    save([[devicesFile, roster]]);
    const run = () => appendFile2(rosterLog, lines.join(""), { mode: 384 });
    saving = saving.then(run, run);
    return saving;
  }
  async function putDevice(device, { event, by }) {
    roster.devices[device.id] = device;
    await saveRoster([{ event, device, by }]);
    changed({ persons: [device.person] });
    return device;
  }
  async function setDevice(id, patch, { event, by }) {
    const device = roster.devices[id];
    if (device === void 0) throw Object.assign(new Error("no such device"), { status: 404 });
    const before = { ...device };
    Object.assign(device, patch);
    const was = Object.fromEntries(Object.keys(patch).filter((key) => before[key] !== device[key]).map((key) => [key, before[key]]));
    await saveRoster([{ event, device, by, was }]);
    changed({ persons: [device.person] });
    return device;
  }
  async function dropDevice(id, { event, by }) {
    const device = roster.devices[id];
    if (device === void 0) return null;
    delete roster.devices[id];
    await saveRoster([{ event, device, by }]);
    changed({ persons: [device.person] });
    return device;
  }
  function touchDevice(device) {
    const now = Date.now();
    if (now - (device.seenAt ?? 0) < 36e5) return;
    device.seenAt = now;
    save([[devicesFile, roster]]).catch(() => {
    });
  }
  async function sweep(now = Date.now()) {
    const gone = Object.values(index.items).filter((item) => item.expires !== null && item.expires <= now);
    for (const item of gone) delete index.items[item.id];
    const orphans = Object.values(index.items).filter((item) => item.derivedOf && index.items[item.derivedOf] === void 0);
    for (const item of orphans) delete index.items[item.id];
    const stale = (device) => device.status === "pending" && now - device.created > PENDING_MS ? "pending over a day" : device.status === "approved" && now - (device.seenAt ?? device.created) > deviceIdleDays * DAY ? `unused ${deviceIdleDays} days` : null;
    const dropped = Object.values(roster.devices).map((device) => ({ device, reason: stale(device) })).filter(({ reason }) => reason !== null);
    for (const { device } of dropped) delete roster.devices[device.id];
    if (gone.length + orphans.length > 0) {
      await save([[indexFile, index]]);
      await Promise.all([...gone, ...orphans].map((item) => rm2(itemPath(item.id), { force: true })));
      changed({ spaces: [...new Set(gone.map((item) => item.space))] });
    }
    if (dropped.length > 0) {
      await saveRoster(dropped.map(({ device, reason }) => ({ event: "sweep", device, by: { kind: "sweep", reason } })));
      changed({ persons: [...new Set(dropped.map(({ device }) => device.person))] });
    }
    const next = Object.values(index.items).map((item) => item.expires).filter((at) => at !== null);
    return next.length === 0 ? null : Math.min(...next);
  }
  async function usedBytes() {
    let total = 0;
    for (const item of Object.values(index.items)) {
      try {
        total += (await stat2(itemPath(item.id))).size;
      } catch {
      }
    }
    return total;
  }
  return {
    dir,
    itemPath,
    spacesOf,
    canSee,
    concerns,
    itemsFor,
    foldersFor,
    visibleItem,
    item: (id) => index.items[id] ?? null,
    derivedOf: (id) => Object.values(index.items).filter((item) => item.derivedOf === id),
    addItem,
    updateItem,
    removeItem,
    makeFolder,
    moveFolder,
    markSeen,
    device: (id) => roster.devices[id] ?? null,
    devicesOf,
    putDevice,
    setDevice,
    dropDevice,
    touchDevice,
    sweep,
    usedBytes,
    expiresAt,
    get version() {
      return version2;
    },
    /** Follow changes: `listener({ version, spaces, persons })`. Returns the unsubscribe. */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush: () => saving
  };
}

// src/preview.js
var OFFICE = /* @__PURE__ */ new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx"]);
var MAX_SOURCE = 100 * 1024 * 1024;
var extensionOf = (name2) => /\.([a-z0-9]+)$/i.exec(name2)?.[1]?.toLowerCase() ?? "";
function createPreviews({ store, identity, officeToPdf, logger }) {
  const running = /* @__PURE__ */ new Map();
  async function make(item, converter) {
    const pieces = [];
    for await (const piece of decryptFile(store.itemPath(item.id), identity.priv, item.size)) pieces.push(piece);
    const bytes = new Uint8Array(Buffer.concat(pieces));
    const result = await converter.convert({
      extension: extensionOf(item.name),
      priority: "foreground",
      source: { key: `sealed-files:${item.id}`, version: String(item.created), bytes: bytes.length, read: async () => ({ bytes, version: String(item.created) }) }
    });
    const id = newId();
    const { cipherSize, payloadAt } = await encryptToFile([Buffer.from(result.pdf)], result.pdf.length, store.itemPath(id), identity.pub);
    await store.addItem({
      id,
      derivedOf: item.id,
      space: item.space,
      folder: item.folder,
      name: `${item.name.replace(/\.[^.]+$/, "")}.pdf`,
      type: "application/pdf",
      kind: "file",
      size: result.pdf.length,
      cipherSize,
      payloadAt,
      from: item.from,
      created: Date.now(),
      pinned: true,
      expires: null,
      seenByAssistant: true
    });
    logger.info("made a PDF preview of %s", item.id);
    return id;
  }
  return {
    /** File extensions a preview can be made for, here. */
    available: () => officeToPdf() ? [...OFFICE] : [],
    /** The id of `item`'s PDF preview, made on first ask. */
    async pdfOf(item) {
      if (item.type === "application/pdf") return item.id;
      const converter = officeToPdf();
      if (!converter || !OFFICE.has(extensionOf(item.name))) throw Object.assign(new Error("no preview for this file"), { status: 415 });
      if (item.size > MAX_SOURCE) throw Object.assign(new Error("file too large to preview"), { status: 413 });
      const existing = store.derivedOf(item.id)[0];
      if (existing !== void 0) return existing.id;
      let job = running.get(item.id);
      if (job === void 0) {
        job = make(item, converter).finally(() => running.delete(item.id));
        running.set(item.id, job);
      }
      return job;
    }
  };
}

// src/uploads.js
import { mkdir as mkdir3, open as open2, readdir as readdir3, readFile as readFile4, rename as rename2, rm as rm3, statfs, writeFile as writeFile2 } from "node:fs/promises";
import { join as join3 } from "node:path";
import { CHUNK_CT as CHUNK_CT2, NONCE_BYTES as NONCE_BYTES2, chunkCount as chunkCount2, parseHeader as parseHeader2, payloadSize as payloadSize2 } from "../web/age.js";
import { cleanFolder as cleanFolder2, partCount, partShape } from "../web/protocol.js";
var DAY2 = 864e5;
var UPLOAD_ID = /^[a-z2-7]{16}$/;
async function createUploads({ dir, store, identity, limits, uploadDays, logger }) {
  const root = join3(dir, "uploads");
  await mkdir3(root, { recursive: true, mode: 448 });
  const metas = /* @__PURE__ */ new Map();
  const keys = /* @__PURE__ */ new Map();
  for (const name2 of await readdir3(root).catch(() => [])) {
    try {
      metas.set(name2, JSON.parse(await readFile4(join3(root, name2, "meta.json"), "utf8")));
    } catch {
      await rm3(join3(root, name2), { recursive: true, force: true });
    }
  }
  const fail2 = (status2, message) => Object.assign(new Error(message), { status: status2 });
  const saving = /* @__PURE__ */ new Map();
  function saveMeta(meta) {
    const write2 = async () => {
      const file = join3(root, meta.id, "meta.json");
      await writeFile2(`${file}.tmp`, JSON.stringify(meta), { mode: 384 });
      await rename2(`${file}.tmp`, file);
    };
    const next = (saving.get(meta.id) ?? Promise.resolve()).then(write2, write2);
    saving.set(meta.id, next);
    return next;
  }
  const dataPath = (id) => join3(root, id, "data.age");
  async function keyOf(meta) {
    let key = keys.get(meta.id);
    if (key === void 0) {
      const handle = await open2(dataPath(meta.id), "r");
      try {
        const prefix = Buffer.alloc(meta.payloadAt);
        await handle.read(prefix, 0, meta.payloadAt, 0);
        key = keyOfPrefix(new Uint8Array(prefix), identity.priv).key;
      } finally {
        await handle.close();
      }
      keys.set(meta.id, key);
    }
    return key;
  }
  function owned(id, device) {
    const meta = UPLOAD_ID.test(String(id)) ? metas.get(id) : void 0;
    if (meta === void 0 || meta.device !== device.id) throw fail2(404, "no such upload");
    return meta;
  }
  async function reservedBytes() {
    let total = 0;
    for (const meta of metas.values()) total += meta.cipherSize;
    return total;
  }
  async function makeRoom(bytes) {
    if (bytes > limits.maxFileBytes + 1024 * 1024) throw fail2(413, "file-too-large");
    const used = await store.usedBytes() + await reservedBytes();
    if (used + bytes > limits.maxStoreBytes) throw fail2(507, "store-full");
    const disk = await statfs(dir);
    if (disk.bavail * disk.bsize - bytes < limits.minFreeBytes) throw fail2(507, "disk-full");
  }
  async function start(person, device, { space, folder, size, prefix }) {
    if (!store.canSee(person, space)) throw fail2(403, "no such space");
    const where = cleanFolder2(folder ?? "");
    if (where === null) throw fail2(400, "bad folder");
    if (!Number.isSafeInteger(size) || size < 0 || size > limits.maxFileBytes) throw fail2(413, "file-too-large");
    const header = parseHeader2(prefix);
    if (header === null || prefix.length !== header.length + NONCE_BYTES2) throw fail2(400, "bad header");
    try {
      keyOfPrefix(prefix, identity.priv);
    } catch {
      throw fail2(400, "header not for this assistant");
    }
    const cipherSize = prefix.length + payloadSize2(size);
    await makeRoom(cipherSize);
    const id = newId().slice(0, 16);
    await mkdir3(join3(root, id), { mode: 448 });
    const handle = await open2(dataPath(id), "wx", 384);
    try {
      await handle.truncate(cipherSize);
      await handle.write(prefix, 0, prefix.length, 0);
    } finally {
      await handle.close();
    }
    const now = Date.now();
    const meta = { id, person, device: device.id, space, folder: where, size, payloadAt: prefix.length, cipherSize, received: new Array(partCount(size)).fill(false), created: now, touched: now };
    await saveMeta(meta);
    metas.set(id, meta);
    return status(meta);
  }
  const status = (meta) => ({ id: meta.id, size: meta.size, parts: meta.received.length, missing: meta.received.flatMap((ok, n) => ok ? [] : [n]) });
  async function part(device, id, n, body) {
    const meta = owned(id, device);
    if (!Number.isInteger(n) || n < 0 || n >= meta.received.length) throw fail2(400, "bad part");
    const shape = partShape(meta.size, n);
    const buffer = Buffer.alloc(shape.bytes);
    let length = 0;
    for await (const piece of body) {
      if (length + piece.length > shape.bytes) throw fail2(400, "part too long");
      buffer.set(piece, length);
      length += piece.length;
    }
    if (length !== shape.bytes) throw fail2(400, "part too short");
    try {
      verifyChunks(await keyOf(meta), shape.first, chunkCount2(meta.size) - 1, buffer);
    } catch {
      throw fail2(422, "part does not decrypt");
    }
    if (!metas.has(id)) throw fail2(404, "no such upload");
    const handle = await open2(dataPath(id), "r+");
    try {
      await handle.write(buffer, 0, buffer.length, meta.payloadAt + shape.first * CHUNK_CT2);
    } finally {
      await handle.close();
    }
    meta.received[n] = true;
    meta.touched = Date.now();
    await saveMeta(meta);
    return { ok: true };
  }
  async function finish(device, id, about) {
    const meta = owned(id, device);
    if (meta.received.some((ok) => !ok)) throw fail2(409, "parts missing");
    const itemId = newId();
    await rename2(dataPath(id), store.itemPath(itemId));
    await saving.get(id)?.catch(() => {
    });
    saving.delete(id);
    metas.delete(id);
    keys.delete(id);
    await rm3(join3(root, id), { recursive: true, force: true });
    const now = Date.now();
    return store.addItem({
      id: itemId,
      space: meta.space,
      folder: meta.folder,
      name: about.name,
      type: about.type,
      kind: about.kind,
      size: meta.size,
      cipherSize: meta.cipherSize,
      payloadAt: meta.payloadAt,
      from: { person: meta.person, device: device.id },
      created: now,
      pinned: false,
      expires: store.expiresAt(about.kind, false, now),
      seenByAssistant: false
    });
  }
  async function cancel(device, id) {
    owned(id, device);
    await drop(id);
  }
  async function drop(id) {
    await saving.get(id)?.catch(() => {
    });
    saving.delete(id);
    metas.delete(id);
    keys.delete(id);
    await rm3(join3(root, id), { recursive: true, force: true });
  }
  async function sweep(now = Date.now()) {
    for (const meta of [...metas.values()]) {
      if (now - meta.touched > uploadDays * DAY2) {
        logger.info("dropping unfinished upload %s", meta.id);
        await drop(meta.id);
      }
    }
  }
  return {
    start,
    part,
    finish,
    cancel,
    sweep,
    status: (device, id) => status(owned(id, device)),
    /** This device's unfinished uploads. */
    listFor: (device) => [...metas.values()].filter((meta) => meta.device === device.id).map((meta) => ({ ...status(meta), space: meta.space, folder: meta.folder, created: meta.created })),
    reservedBytes,
    makeRoom
  };
}

// src/service.js
var fail = (status, message) => Object.assign(new Error(message), { status });
var DEVICE_NAME = 80;
async function createService({ config, limits, stateDir, identityFile, officeToPdf, logger }) {
  const identity = loadIdentity(identityFile);
  const people = createPeople(config, (...args) => logger.warn(...args));
  const store = await createStore({ dir: stateDir, people, sharedSpace: config.sharedSpace, retentionDays: config.retentionDays, snippetHours: config.snippetHours, deviceIdleDays: config.deviceIdleDays, logger });
  const uploads = await createUploads({ dir: stateDir, store, identity, limits, uploadDays: config.uploadDays, logger });
  const previews = createPreviews({ store, identity, officeToPdf, logger });
  const keyCache = /* @__PURE__ */ new Map();
  const textCache = /* @__PURE__ */ new Map();
  const byDevice = (device) => ({ kind: "device", person: device.person, device: device.id, name: device.name });
  const nameOf = (person) => person === ASSISTANT ? null : people.all().find((p) => p.id === person)?.name ?? person;
  function notify(event) {
    const [command, ...args] = config.notifyCommand;
    if (command === void 0) return;
    try {
      const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"], detached: false });
      let errors = "";
      child.stderr.on("data", (chunk) => {
        errors += chunk;
      });
      child.on("error", (error) => logger.warn("notify command failed: %s", error.message));
      child.on("exit", (code) => {
        if (code !== 0) logger.warn("notify command exited %s: %s", code, errors.slice(0, 500));
      });
      child.stdin.end(`${JSON.stringify(event)}
`);
    } catch (error) {
      logger.warn("notify command failed: %s", error.message);
    }
  }
  async function addFile(pieces, size, { space, folder = "", name: name2, type, kind, from: from2 }) {
    const where = cleanFolder3(folder);
    const clean = cleanName(name2);
    if (where === null) throw fail(400, "bad folder");
    if (clean === null) throw fail(400, "bad name");
    if (!store.canSee(from2, space)) throw fail(403, "no such space");
    await uploads.makeRoom(size + 4096);
    const id = newId();
    const { cipherSize, payloadAt } = await encryptToFile(pieces, size, store.itemPath(id), identity.pub);
    const now = Date.now();
    return store.addItem({ id, space, folder: where, name: clean, type, kind, size, cipherSize, payloadAt, from: { person: from2 }, created: now, pinned: false, expires: store.expiresAt(kind, false, now), seenByAssistant: from2 === ASSISTANT });
  }
  const pad = (n) => String(n).padStart(2, "0");
  const localStamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  function addNote(from2, { text, space, folder, title }) {
    if (typeof text !== "string" || text === "") throw fail(400, "no text");
    const bytes = Buffer.from(text, "utf8");
    const name2 = cleanName(title) ?? `${localStamp(/* @__PURE__ */ new Date())}.txt`;
    return addFile([bytes], bytes.length, { space, folder, name: /\.[a-z0-9]+$/i.test(name2) ? name2 : `${name2}.txt`, type: TEXT_TYPE, kind: "text", from: from2 });
  }
  function addSnippet(from2, { text, space }) {
    if (typeof text !== "string" || text.trim() === "") throw fail(400, "no text");
    if (text.length > SNIPPET_CHARS) throw fail(400, "snippet-too-long");
    const bytes = Buffer.from(text, "utf8");
    return addFile([bytes], bytes.length, { space, name: "snippet.txt", type: TEXT_TYPE, kind: SNIPPET2, from: from2 });
  }
  async function shownText(item) {
    let text = textCache.get(item.id);
    if (text === void 0) {
      const limit = item.kind === SNIPPET2 ? item.size : PREVIEW_CHARS * 4;
      const pieces = [];
      let read = 0;
      for await (const piece of decryptFile(store.itemPath(item.id), identity.priv, item.size)) {
        pieces.push(piece);
        read += piece.length;
        if (read >= limit) break;
      }
      const bytes = Buffer.concat(pieces);
      text = bytes.length < item.size ? bytes.toString("utf8").slice(0, PREVIEW_CHARS).replace(/\uFFFD$/, "") : bytes.toString("utf8");
      if (textCache.size > 500) textCache.delete(textCache.keys().next().value);
      textCache.set(item.id, text);
    }
    return text;
  }
  const readable = (item) => shownText(item).catch((error) => {
    logger.warn("could not read %s: %s", item.id, error.message);
    return "";
  });
  async function fullView(item) {
    if (item.kind === SNIPPET2) return { ...itemView(item), text: await readable(item) };
    if (item.kind === "text") return { ...itemView(item), preview: (await readable(item)).slice(0, PREVIEW_CHARS) };
    return itemView(item);
  }
  const itemView = (item) => ({
    id: item.id,
    space: item.space,
    folder: item.folder,
    name: item.name,
    type: item.type,
    kind: item.kind,
    size: item.size,
    from: { person: item.from.person, name: nameOf(item.from.person) },
    created: item.created,
    expires: item.expires,
    pinned: item.pinned
  });
  const deviceView = (device, current) => ({
    id: device.id,
    name: device.name,
    status: device.status,
    created: device.created,
    seenAt: device.seenAt ?? null,
    current: device.id === current,
    ...device.status === "pending" ? { code: device.code } : {}
  });
  async function enroll(person, { pub, name: name2 }) {
    let devicePub;
    try {
      devicePub = b642.decode(pub);
    } catch {
      throw fail(400, "bad key");
    }
    if (devicePub.length !== 32) throw fail(400, "bad key");
    const id = deviceIdOf(devicePub);
    const existing = store.device(id);
    if (existing !== null) {
      if (existing.person !== person.id) throw fail(409, "key in use");
      return { id, status: existing.status };
    }
    let label = "";
    try {
      label = new TextDecoder().decode(await openBytes(await identity.pairKey(devicePub), `sealed-files/v1/enroll
${id}`, b642.decode(name2)));
    } catch {
      throw fail(400, "bad seal");
    }
    label = (cleanName(label) ?? "Browser").slice(0, DEVICE_NAME);
    const code = pairingCode(devicePub, identity.pub);
    const pending = store.devicesOf(person.id).filter((d) => d.status === "pending");
    if (pending.length >= 5) throw fail(429, "too many pending devices");
    await store.putDevice({ id, person: person.id, name: label, pub, status: "pending", code, created: Date.now() }, { event: "pair", by: { kind: "person", person: person.id } });
    notify({ event: "device-pending", person: person.id, personName: person.name, device: { id, name: label }, code });
    return { id, status: "pending" };
  }
  async function fileKey(id) {
    let entry = keyCache.get(id);
    if (entry === void 0) {
      const { fileKey: fileKey2, nonce, payloadAt } = await readKey(store.itemPath(id), identity.priv);
      entry = { fileKey: b642.encode(fileKey2), nonce: b642.encode(nonce), payloadAt };
      if (keyCache.size > 500) keyCache.delete(keyCache.keys().next().value);
      keyCache.set(id, entry);
    }
    return entry;
  }
  const itemId = (value) => {
    if (!ID2.test(String(value))) throw fail(400, "bad id");
    return value;
  };
  async function approve(id, by) {
    const device = store.device(id);
    if (device === null) throw fail(404, "no such device");
    if (device.status === "approved") return deviceView(device);
    const { code: _code, ...rest } = device;
    const approvedBy = by.kind === "device" ? by.device : by.label ?? by.kind;
    return deviceView(await store.putDevice({ ...rest, status: "approved", approvedAt: Date.now(), approvedBy }, { event: "approve", by }));
  }
  async function decide({ device: id, code, choice, person, by }) {
    const device = store.device(String(id));
    if (device === null || device.status !== "pending") return { applied: false, reason: "not pending" };
    if (device.code !== code) return { applied: false, reason: "code does not match" };
    if (person !== void 0 && person !== device.person) return { applied: false, reason: "not this person" };
    const outside = { kind: "outside", label: typeof by === "string" && by !== "" ? by : "outside" };
    if (choice === "yes") return { applied: true, device: await approve(device.id, outside) };
    await store.dropDevice(device.id, { event: "reject", by: outside });
    return { applied: true, removed: device.id };
  }
  const operations = {
    status: ({ device, person }) => ({ status: device.status, assistantName: config.assistantName, person: { id: person.id, name: person.name }, device: { id: device.id, name: device.name } }),
    index: async ({ person, device }) => ({
      person: { id: person.id, name: person.name },
      device: device.id,
      spaces: store.spacesOf(person.id).map((space) => ({ id: space, own: space === person.id, shared: space === SHARED2 })),
      items: await Promise.all(store.itemsFor(person.id).map(fullView)),
      folders: store.foldersFor(person.id),
      uploads: uploads.listFor(device),
      pending: store.devicesOf(person.id).filter((d) => d.status === "pending").map((d) => deviceView(d, device.id)),
      limits: { maxFileBytes: limits.maxFileBytes },
      previews: previews.available(),
      version: store.version
    }),
    key: async ({ person, args }) => {
      const item = store.visibleItem(person.id, itemId(args.id));
      if (item === null) throw fail(404, "no such file");
      return { ...await fileKey(item.id), size: item.size, type: item.type, name: item.name };
    },
    mkdir: ({ person, args }) => store.makeFolder(person.id, args.space, args.path).then(() => ({})),
    "folder.move": ({ person, args }) => store.moveFolder(person.id, args.space, args.from, args.to).then(() => ({})),
    "folder.remove": ({ person, args }) => store.moveFolder(person.id, args.space, args.path, null).then(() => ({})),
    rename: async ({ person, args }) => {
      const name2 = cleanName(args.name);
      if (name2 === null) throw fail(400, "bad name");
      return itemView(await store.updateItem(person.id, itemId(args.id), { name: name2 }));
    },
    move: async ({ person, args }) => {
      const folder = cleanFolder3(args.folder ?? "");
      if (folder === null) throw fail(400, "bad folder");
      return itemView(await store.updateItem(person.id, itemId(args.id), { space: args.space, folder }));
    },
    "snippet.put": async ({ person, args }) => fullView(await addSnippet(person.id, { text: args.text, space: args.space })),
    remove: ({ person, args }) => store.removeItem(person.id, itemId(args.id)).then(() => ({})),
    pin: async ({ person, args }) => itemView(await store.updateItem(person.id, itemId(args.id), { pinned: args.pinned === true })),
    "upload.start": ({ person, device, args }) => uploads.start(person.id, device, { space: args.space, folder: args.folder, size: args.size, prefix: b642.decode(String(args.prefix)) }),
    "upload.status": ({ device, args }) => uploads.status(device, args.id),
    "upload.finish": async ({ device, args }) => {
      const name2 = cleanName(args.name);
      if (name2 === null) throw fail(400, "bad name");
      const type = typeof args.type === "string" && /^[\w.+-]+\/[\w.+-]+(;[\w=.-]+)?$/.test(args.type) ? args.type : "application/octet-stream";
      return fullView(await uploads.finish(device, args.id, { name: name2, type, kind: args.kind === "text" ? "text" : "file" }));
    },
    "upload.cancel": ({ device, args }) => uploads.cancel(device, args.id).then(() => ({})),
    devices: ({ person, device }) => store.devicesOf(person.id).map((d) => deviceView(d, device.id)),
    "device.approve": async ({ person, device, args }) => {
      const other = store.device(String(args.id));
      if (other === null || other.person !== person.id) throw fail(404, "no such device");
      return approve(other.id, byDevice(device));
    },
    "device.reject": async ({ person, device, args }) => {
      const other = store.device(String(args.id));
      if (other === null || other.person !== person.id || other.status !== "pending") throw fail(404, "no such device");
      await store.dropDevice(other.id, { event: "reject", by: byDevice(device) });
      return {};
    },
    "device.remove": async ({ person, device, args }) => {
      const other = store.device(String(args.id));
      if (other === null || other.person !== person.id) throw fail(404, "no such device");
      await store.dropDevice(other.id, { event: "remove", by: byDevice(device) });
      return {};
    },
    "device.rename": async ({ person, device, args }) => {
      const other = store.device(String(args.id));
      const name2 = cleanName(args.name);
      if (other === null || other.person !== person.id || name2 === null) throw fail(400, "bad device");
      return deviceView(await store.setDevice(other.id, { name: name2.slice(0, DEVICE_NAME) }, { event: "rename", by: byDevice(device) }));
    },
    preview: async ({ person, args }) => {
      const item = store.visibleItem(person.id, itemId(args.id));
      if (item === null) throw fail(404, "no such file");
      return { id: await previews.pdfOf(item) };
    }
  };
  return {
    logger,
    identity,
    people,
    store,
    uploads,
    previews,
    enroll,
    approve,
    decide,
    notify,
    itemView,
    fullView,
    addFile,
    addNote,
    addSnippet,
    deviceView,
    fileKey,
    nameOf,
    /** Run a device operation; `device` is the roster entry, `person` its owner. */
    async run(op, context) {
      const handler = Object.hasOwn(operations, op) ? operations[op] : void 0;
      if (handler === void 0) throw fail(400, "unknown operation");
      if (context.device.status !== "approved" && op !== "status") throw fail(403, "not-approved");
      return handler({ ...context, args: context.args ?? {} });
    },
    itemsDir: join4(stateDir, "items")
  };
}

// index.js
var name = "dsh-sealed-files";
var inject = ["webServer", "connection"];
function version() {
  for (const relative of ["./package.json", "../package.json"]) {
    try {
      const manifest = JSON.parse(readFileSync3(new URL(relative, import.meta.url), "utf8"));
      if (manifest.name === "@soffits/dsh-sealed-files") return manifest.version;
    } catch {
    }
  }
  return "0.0.0";
}
var expand = (path) => resolve3(path.replace(/^~(?=$|\/)/, homedir()));
var DAY_MS = 864e5;
function apply(ctx, config) {
  const logger = ctx.logger("sealed-files");
  let current;
  ctx.provide?.("sealedFiles", Object.freeze({ service: () => current }));
  ctx.effect(() => {
    const stateDir = expand(config.stateDir);
    const identityFile = config.identityFile === "" ? join5(stateDir, "identity.txt") : expand(config.identityFile);
    const peopleFile = config.peopleFile === "" ? "" : expand(config.peopleFile);
    let stopped = false;
    let timer;
    let stopDecisions;
    const starting = createService({
      config: { ...config, peopleFile },
      limits: limitsOf(config),
      stateDir,
      identityFile,
      officeToPdf: () => ctx.get("officeToPdf"),
      publicOrigin: () => ctx.get("webApp")?.getAdvertisedUrl?.(),
      logger
    }).then(async (service) => {
      if (stopped) return;
      current = service;
      stopDecisions = await followDecisions({ stateDir, decide: service.decide, logger });
      const sweep = async () => {
        const next = await service.store.sweep().catch((error) => {
          logger.warn("sweep failed: %s", error.message);
          return null;
        });
        await service.uploads.sweep().catch(() => {
        });
        if (stopped) return;
        timer = setTimeout(sweep, Math.min(DAY_MS, Math.max(6e4, (next ?? Infinity) - Date.now())));
      };
      await sweep();
    }).catch((error) => logger.warn("could not start: %s", error.message));
    const routes = createApiRoutes({ service: () => current, identity: () => ctx.get("requestIdentity"), version }).map((route) => ctx.connection.fetch.register(route));
    const disposeHttp = ctx.webServer.register({ kind: "prefix", path: ROUTE, handler: createAppHandler({ connection: ctx.connection }) });
    return async () => {
      stopped = true;
      clearTimeout(timer);
      disposeHttp();
      await Promise.all(routes.map((dispose) => dispose()));
      await starting;
      await stopDecisions?.();
      await current?.store.flush();
      current = void 0;
    };
  }, "sealed-files.service()");
}
export {
  Config,
  apply,
  inject,
  name
};
