(() => {
  // web/vendor.js
  function ae(e) {
    return e instanceof Uint8Array || ArrayBuffer.isView(e) && e.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in e && e.BYTES_PER_ELEMENT === 1;
  }
  var Ct = (e) => e ? `"${e}" ` : "";
  function Nt(e, t = "") {
    if (typeof e != "boolean") throw new TypeError(Ct(t) + "expected boolean, got type=" + typeof e);
    return e;
  }
  function lt(e, t = "") {
    if (typeof e != "number") throw new TypeError(Ct(t) + "expected number, got " + typeof e);
    if (!Number.isSafeInteger(e) || e < 0) throw new RangeError(Ct(t) + "expected integer >= 0, got " + e);
    return e;
  }
  function $(e, t, n = "") {
    if (ae(e) && (t === void 0 || e.length === t)) return e;
    t !== void 0 && lt(t, "length");
    let o = ae(e), r = t !== void 0 ? ` of length ${t}` : "", s = o ? `length=${e.length}` : `type=${typeof e}`, i = Ct(n) + "expected Uint8Array" + r + ", got " + s;
    throw o ? new RangeError(i) : new TypeError(i);
  }
  var ke = (e, t) => {
    if (e === null || typeof e != "object" || Array.isArray(e)) throw new TypeError(t === "object" ? "expected valid options object" : `"${t}" expected object, got type=${typeof e}`);
  };
  function ue(e, t = true) {
    if (e.destroyed) throw new Error("hash was destroyed");
    if (t && e.finished) throw new Error("digest() was already called");
  }
  function qe(e, t) {
    $(e, void 0, "output");
    let n = t.outputLen;
    if (!(e.length >= n)) throw new RangeError('"output" expected length >= ' + n);
  }
  function tt(e) {
    return new Uint32Array(e.buffer, e.byteOffset, Math.floor(e.byteLength / 4));
  }
  function X(...e) {
    for (let t = 0; t < e.length; t++) e[t].fill(0);
  }
  function Vn(e) {
    return new DataView(e.buffer, e.byteOffset, e.byteLength);
  }
  var ft = new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68;
  function Qn(e) {
    return e << 24 & 4278190080 | e << 8 & 16711680 | e >>> 8 & 65280 | e >>> 24 & 255;
  }
  function Jn(e) {
    for (let t = 0; t < e.length; t++) e[t] = Qn(e[t]);
    return e;
  }
  var ot = ft ? (e) => e : Jn;
  function tr(e, t) {
    return !e.byteLength || !t.byteLength ? false : e.buffer === t.buffer && e.byteOffset < t.byteOffset + t.byteLength && t.byteOffset < e.byteOffset + e.byteLength;
  }
  function je(e, t) {
    if (tr(e, t) && e.byteOffset < t.byteOffset) throw new Error("complex overlap of input and output is not supported");
  }
  function $e(e, t) {
    return ke(e, "defaults"), ke(t, "opts"), Object.assign(e, t);
  }
  function ze(e, t) {
    if (e = $(e), t = $(t), e.length !== t.length) return false;
    let n = 0;
    for (let o = 0; o < e.length; o++) n |= e[o] ^ t[o];
    return n === 0;
  }
  function Ze(e, t, n) {
    let o = t, r = n || (() => []), s = (c, f) => o(f, ...r(c)).update(c).digest(), i = o(new Uint8Array(e), ...r(new Uint8Array(0)));
    return s.outputLen = i.outputLen, s.blockLen = i.blockLen, s.create = (c, ...f) => o(c, ...f), s;
  }
  var Pe = (e, t) => {
    function n(o, ...r) {
      if ($(o, void 0, "key"), e.nonceLength !== void 0) {
        let u = r[0];
        $(u, e.varSizeNonce ? void 0 : e.nonceLength, "nonce");
      }
      let s = e.tagLength, i = e.nonceLength !== void 0 ? 1 : 0;
      if (!e.withAAD) {
        for (let u = i; u < r.length; u++) if (ae(r[u])) throw new Error("AAD not supported");
      }
      e.withAAD && r[i] !== void 0 && $(r[i], void 0, "AAD");
      let c = t(o, ...r), f = (u, l) => {
        if (l !== void 0) {
          if (u !== 2) throw new Error("cipher output not supported");
          $(l, void 0, "output");
        }
      }, a = false;
      return { encrypt(u, l) {
        if (a) throw new Error("cannot encrypt() twice with same key + nonce");
        return a = true, $(u, void 0, "data"), f(c.encrypt.length, l), c.encrypt(u, l);
      }, decrypt(u, l) {
        if ($(u, void 0, "data"), s && u.length < s) throw new Error('"ciphertext" expected length >= tagLength=' + s);
        return f(c.decrypt.length, l), c.decrypt(u, l);
      } };
    }
    return Object.assign(n, e), n;
  };
  function _t(e, t, n = true) {
    if (t === void 0) return new Uint8Array(e);
    if ($(t, e, "output"), n && !Tt(t)) throw new Error("invalid output, must be aligned");
    return t;
  }
  function Ye(e, t, n) {
    lt(e), lt(t), Nt(n);
    let o = new Uint8Array(16), r = Vn(o);
    return r.setBigUint64(0, BigInt(t), n), r.setBigUint64(8, BigInt(e), n), o;
  }
  function Tt(e) {
    return e.byteOffset % 4 === 0;
  }
  function Et(e) {
    return Uint8Array.from($(e));
  }
  var We = (e) => Uint8Array.from(e.split(""), (t) => t.charCodeAt(0));
  var er = ot(tt(We("expand 16-byte k")));
  var nr = ot(tt(We("expand 32-byte k")));
  function D(e, t) {
    return e << t | e >>> 32 - t;
  }
  var St = 64;
  var rr = 16;
  var de = 2 ** 32 - 1;
  var Ge = Uint32Array.of();
  function or(e, t, n, o, r, s, i, c) {
    let f = r.length, a = new Uint8Array(St), d = tt(a), u = ft && Tt(r) && Tt(s), l = u ? tt(r) : Ge, p = u ? tt(s) : Ge;
    if (!ft) {
      for (let x = 0; x < f; i++) {
        if (e(t, n, o, d, i, c), ot(d), i >= de) throw new Error("arx: counter overflow");
        let h = Math.min(St, f - x);
        for (let y = 0, B; y < h; y++) B = x + y, s[B] = r[B] ^ a[y];
        x += h;
      }
      return;
    }
    for (let x = 0; x < f; i++) {
      if (e(t, n, o, d, i, c), i >= de) throw new Error("arx: counter overflow");
      let h = Math.min(St, f - x);
      if (u && h === St) {
        let y = x / 4;
        if (x % 4 !== 0) throw new Error("arx: invalid block position");
        for (let B = 0, m; B < rr; B++) m = y + B, p[m] = l[m] ^ d[B];
        x += St;
        continue;
      }
      for (let y = 0, B; y < h; y++) B = x + y, s[B] = r[B] ^ a[y];
      x += h;
    }
  }
  function Xe(e, t) {
    let { allowShortKeys: n, extendNonceFn: o, counterLength: r, counterRight: s, rounds: i } = $e({ allowShortKeys: false, counterLength: 8, counterRight: false, rounds: 20 }, t);
    if (typeof e != "function") throw new Error("core must be a function");
    return lt(r), lt(i), Nt(s), Nt(n), (c, f, a, d, u = 0) => {
      $(c, void 0, "key"), $(f, void 0, "nonce"), $(a, void 0, "data");
      let l = a.length, p = d !== void 0;
      if (d = _t(l, d, false), p && je(a, d), lt(u), u < 0 || u >= de) throw new Error("arx: counter overflow");
      let x = [], h = c.length, y, B;
      if (h === 32) x.push(y = Et(c)), B = nr;
      else if (h === 16 && n) y = new Uint8Array(32), y.set(c), y.set(c, 16), B = er, x.push(y);
      else throw $(c, 32, "arx key"), new Error("invalid key size");
      (!ft || !Tt(f)) && x.push(f = Et(f));
      let m = tt(y);
      if (o) {
        if (f.length !== 24) throw new Error("arx: extended nonce must be 24 bytes");
        let E = f.subarray(0, 16);
        if (ft) o(B, m, tt(E), m);
        else {
          let R = ot(Uint32Array.from(B));
          o(R, m, tt(E), m), X(R), ot(m);
        }
        f = f.subarray(16);
      } else ft || ot(m);
      let b = 16 - r;
      if (b !== f.length) throw new Error(`arx: nonce must be ${b} or 16 bytes`);
      if (b !== 12) {
        let E = new Uint8Array(12);
        E.set(f, s ? 0 : 12 - f.length), f = E, x.push(f);
      }
      let A = ot(tt(f));
      try {
        return or(e, B, m, A, a, d, u, i), d;
      } finally {
        X(...x);
      }
    };
  }
  function P(e, t) {
    return e[t++] & 255 | (e[t++] & 255) << 8;
  }
  var le = class {
    blockLen = 16;
    outputLen = 16;
    buffer = new Uint8Array(16);
    r = new Uint16Array(10);
    h = new Uint16Array(10);
    pad = new Uint16Array(8);
    pos = 0;
    finished = false;
    destroyed = false;
    constructor(t) {
      t = Et($(t, 32, "key"));
      let n = P(t, 0), o = P(t, 2), r = P(t, 4), s = P(t, 6), i = P(t, 8), c = P(t, 10), f = P(t, 12), a = P(t, 14);
      this.r[0] = n & 8191, this.r[1] = (n >>> 13 | o << 3) & 8191, this.r[2] = (o >>> 10 | r << 6) & 7939, this.r[3] = (r >>> 7 | s << 9) & 8191, this.r[4] = (s >>> 4 | i << 12) & 255, this.r[5] = i >>> 1 & 8190, this.r[6] = (i >>> 14 | c << 2) & 8191, this.r[7] = (c >>> 11 | f << 5) & 8065, this.r[8] = (f >>> 8 | a << 8) & 8191, this.r[9] = a >>> 5 & 127;
      for (let d = 0; d < 8; d++) this.pad[d] = P(t, 16 + 2 * d);
    }
    process(t, n, o = false) {
      let r = o ? 0 : 2048, { h: s, r: i } = this, c = i[0], f = i[1], a = i[2], d = i[3], u = i[4], l = i[5], p = i[6], x = i[7], h = i[8], y = i[9], B = P(t, n + 0), m = P(t, n + 2), b = P(t, n + 4), A = P(t, n + 6), E = P(t, n + 8), R = P(t, n + 10), F = P(t, n + 12), N = P(t, n + 14), _ = s[0] + (B & 8191), O = s[1] + ((B >>> 13 | m << 3) & 8191), v = s[2] + ((m >>> 10 | b << 6) & 8191), L = s[3] + ((b >>> 7 | A << 9) & 8191), I = s[4] + ((A >>> 4 | E << 12) & 8191), U = s[5] + (E >>> 1 & 8191), C = s[6] + ((E >>> 14 | R << 2) & 8191), w = s[7] + ((R >>> 11 | F << 5) & 8191), T = s[8] + ((F >>> 8 | N << 8) & 8191), S = s[9] + (N >>> 5 | r), g = 0, H = g + _ * c + O * (5 * y) + v * (5 * h) + L * (5 * x) + I * (5 * p);
      g = H >>> 13, H &= 8191, H += U * (5 * l) + C * (5 * u) + w * (5 * d) + T * (5 * a) + S * (5 * f), g += H >>> 13, H &= 8191;
      let k = g + _ * f + O * c + v * (5 * y) + L * (5 * h) + I * (5 * x);
      g = k >>> 13, k &= 8191, k += U * (5 * p) + C * (5 * l) + w * (5 * u) + T * (5 * d) + S * (5 * a), g += k >>> 13, k &= 8191;
      let M = g + _ * a + O * f + v * c + L * (5 * y) + I * (5 * h);
      g = M >>> 13, M &= 8191, M += U * (5 * x) + C * (5 * p) + w * (5 * l) + T * (5 * u) + S * (5 * d), g += M >>> 13, M &= 8191;
      let z = g + _ * d + O * a + v * f + L * c + I * (5 * y);
      g = z >>> 13, z &= 8191, z += U * (5 * h) + C * (5 * x) + w * (5 * p) + T * (5 * l) + S * (5 * u), g += z >>> 13, z &= 8191;
      let V = g + _ * u + O * d + v * a + L * f + I * c;
      g = V >>> 13, V &= 8191, V += U * (5 * y) + C * (5 * h) + w * (5 * x) + T * (5 * p) + S * (5 * l), g += V >>> 13, V &= 8191;
      let nt = g + _ * l + O * u + v * d + L * a + I * f;
      g = nt >>> 13, nt &= 8191, nt += U * c + C * (5 * y) + w * (5 * h) + T * (5 * x) + S * (5 * p), g += nt >>> 13, nt &= 8191;
      let ct = g + _ * p + O * l + v * u + L * d + I * a;
      g = ct >>> 13, ct &= 8191, ct += U * f + C * c + w * (5 * y) + T * (5 * h) + S * (5 * x), g += ct >>> 13, ct &= 8191;
      let Q = g + _ * x + O * p + v * l + L * u + I * d;
      g = Q >>> 13, Q &= 8191, Q += U * a + C * f + w * c + T * (5 * y) + S * (5 * h), g += Q >>> 13, Q &= 8191;
      let rt = g + _ * h + O * x + v * p + L * l + I * u;
      g = rt >>> 13, rt &= 8191, rt += U * d + C * a + w * f + T * c + S * (5 * y), g += rt >>> 13, rt &= 8191;
      let J = g + _ * y + O * h + v * x + L * p + I * l;
      g = J >>> 13, J &= 8191, J += U * u + C * d + w * a + T * f + S * c, g += J >>> 13, J &= 8191, g = (g << 2) + g | 0, g = g + H | 0, H = g & 8191, g = g >>> 13, k += g, s[0] = H, s[1] = k, s[2] = M, s[3] = z, s[4] = V, s[5] = nt, s[6] = ct, s[7] = Q, s[8] = rt, s[9] = J;
    }
    finalize() {
      let { h: t, pad: n } = this, o = new Uint16Array(10), r = t[1] >>> 13;
      t[1] &= 8191;
      for (let c = 2; c < 10; c++) t[c] += r, r = t[c] >>> 13, t[c] &= 8191;
      t[0] += r * 5, r = t[0] >>> 13, t[0] &= 8191, t[1] += r, r = t[1] >>> 13, t[1] &= 8191, t[2] += r, o[0] = t[0] + 5, r = o[0] >>> 13, o[0] &= 8191;
      for (let c = 1; c < 10; c++) o[c] = t[c] + r, r = o[c] >>> 13, o[c] &= 8191;
      o[9] -= 8192;
      let s = (r ^ 1) - 1;
      for (let c = 0; c < 10; c++) o[c] &= s;
      s = ~s;
      for (let c = 0; c < 10; c++) t[c] = t[c] & s | o[c];
      t[0] = (t[0] | t[1] << 13) & 65535, t[1] = (t[1] >>> 3 | t[2] << 10) & 65535, t[2] = (t[2] >>> 6 | t[3] << 7) & 65535, t[3] = (t[3] >>> 9 | t[4] << 4) & 65535, t[4] = (t[4] >>> 12 | t[5] << 1 | t[6] << 14) & 65535, t[5] = (t[6] >>> 2 | t[7] << 11) & 65535, t[6] = (t[7] >>> 5 | t[8] << 8) & 65535, t[7] = (t[8] >>> 8 | t[9] << 5) & 65535;
      let i = t[0] + n[0];
      t[0] = i & 65535;
      for (let c = 1; c < 8; c++) i = (t[c] + n[c] | 0) + (i >>> 16) | 0, t[c] = i & 65535;
      X(o);
    }
    update(t) {
      ue(this), $(t), t = Et(t);
      let { buffer: n, blockLen: o } = this, r = t.length;
      for (let s = 0; s < r; ) {
        let i = Math.min(o - this.pos, r - s);
        if (i === o) {
          for (; o <= r - s; s += o) this.process(t, s);
          continue;
        }
        n.set(t.subarray(s, s + i), this.pos), this.pos += i, s += i, this.pos === o && (this.process(n, 0, false), this.pos = 0);
      }
      return this;
    }
    destroy() {
      this.destroyed = true, X(this.h, this.r, this.buffer, this.pad);
    }
    digestInto(t) {
      ue(this), qe(t, this), this.finished = true;
      let { buffer: n, h: o } = this, { pos: r } = this;
      if (r) {
        for (n[r++] = 1; r < 16; r++) n[r] = 0;
        this.process(n, 0, true);
      }
      this.finalize();
      let s = 0;
      for (let i = 0; i < 8; i++) t[s++] = o[i] >>> 0, t[s++] = o[i] >>> 8;
    }
    digest() {
      let { buffer: t, outputLen: n } = this;
      this.digestInto(t);
      let o = t.slice(0, n);
      return this.destroy(), o;
    }
  };
  var Ke = Ze(32, (e) => new le(e));
  function sr(e, t, n, o, r, s = 20) {
    let i = e[0], c = e[1], f = e[2], a = e[3], d = t[0], u = t[1], l = t[2], p = t[3], x = t[4], h = t[5], y = t[6], B = t[7], m = r, b = n[0], A = n[1], E = n[2], R = i, F = c, N = f, _ = a, O = d, v = u, L = l, I = p, U = x, C = h, w = y, T = B, S = m, g = b, H = A, k = E;
    for (let z = 0; z < s; z += 2) R = R + O | 0, S = D(S ^ R, 16), U = U + S | 0, O = D(O ^ U, 12), R = R + O | 0, S = D(S ^ R, 8), U = U + S | 0, O = D(O ^ U, 7), F = F + v | 0, g = D(g ^ F, 16), C = C + g | 0, v = D(v ^ C, 12), F = F + v | 0, g = D(g ^ F, 8), C = C + g | 0, v = D(v ^ C, 7), N = N + L | 0, H = D(H ^ N, 16), w = w + H | 0, L = D(L ^ w, 12), N = N + L | 0, H = D(H ^ N, 8), w = w + H | 0, L = D(L ^ w, 7), _ = _ + I | 0, k = D(k ^ _, 16), T = T + k | 0, I = D(I ^ T, 12), _ = _ + I | 0, k = D(k ^ _, 8), T = T + k | 0, I = D(I ^ T, 7), R = R + v | 0, k = D(k ^ R, 16), w = w + k | 0, v = D(v ^ w, 12), R = R + v | 0, k = D(k ^ R, 8), w = w + k | 0, v = D(v ^ w, 7), F = F + L | 0, S = D(S ^ F, 16), T = T + S | 0, L = D(L ^ T, 12), F = F + L | 0, S = D(S ^ F, 8), T = T + S | 0, L = D(L ^ T, 7), N = N + I | 0, g = D(g ^ N, 16), U = U + g | 0, I = D(I ^ U, 12), N = N + I | 0, g = D(g ^ N, 8), U = U + g | 0, I = D(I ^ U, 7), _ = _ + O | 0, H = D(H ^ _, 16), C = C + H | 0, O = D(O ^ C, 12), _ = _ + O | 0, H = D(H ^ _, 8), C = C + H | 0, O = D(O ^ C, 7);
    let M = 0;
    o[M++] = i + R | 0, o[M++] = c + F | 0, o[M++] = f + N | 0, o[M++] = a + _ | 0, o[M++] = d + O | 0, o[M++] = u + v | 0, o[M++] = l + L | 0, o[M++] = p + I | 0, o[M++] = x + U | 0, o[M++] = h + C | 0, o[M++] = y + w | 0, o[M++] = B + T | 0, o[M++] = m + S | 0, o[M++] = b + g | 0, o[M++] = A + H | 0, o[M++] = E + k | 0;
  }
  var ir = Xe(sr, { counterRight: false, counterLength: 4, allowShortKeys: false });
  var cr = new Uint8Array(16);
  var Ve = (e, t) => {
    e.update(t);
    let n = t.length % 16;
    n && e.update(cr.subarray(n));
  };
  var fr = new Uint8Array(32);
  function Qe(e, t, n, o, r) {
    r !== void 0 && $(r, void 0, "AAD");
    let s = e(t, n, fr), i = Ye(o.length, r ? r.length : 0, true), c = Ke.create(s);
    r && Ve(c, r), Ve(c, o), c.update(i);
    let f = c.digest();
    return X(s, i), f;
  }
  var ar = (e) => (t, n, o) => ({ encrypt(s, i) {
    let c = s.length;
    i = _t(c + 16, i, false), i.set(s);
    let f = i.subarray(0, -16);
    e(t, n, f, f, 1);
    let a = Qe(e, t, n, f, o);
    return i.set(a, c), X(a), i;
  }, decrypt(s, i) {
    i = _t(s.length - 16, i, false);
    let c = s.subarray(0, -16), f = s.subarray(-16), a = Qe(e, t, n, c, o);
    if (!ze(f, a)) throw X(a), new Error("invalid tag");
    return i.set(s.subarray(0, -16)), e(t, n, i, i, 1), X(a), i;
  } });
  var ur = Pe({ blockSize: 64, nonceLength: 12, tagLength: 16, withAAD: true }, ar(ir));
  var dr = (e) => e / 2 ** 32 | 0;
  var lr = (e) => e >>> 0;
  function Je(e, t, n, o) {
    let r = dr(n), s = lr(n);
    e.setUint32(t, o ? s : r, o), e.setUint32(t + 4, o ? r : s, o);
  }
  function Ht(e) {
    return e instanceof Uint8Array || ArrayBuffer.isView(e) && e.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in e && e.BYTES_PER_ELEMENT === 1;
  }
  var he = (e) => e ? `"${e}" ` : "";
  function st(e, t = "") {
    if (typeof e != "number") throw new TypeError(he(t) + "expected number, got " + typeof e);
    if (!Number.isSafeInteger(e) || e < 0) throw new RangeError(he(t) + "expected integer >= 0, got " + e);
    return e;
  }
  function Y(e, t, n = "") {
    if (Ht(e) && (t === void 0 || e.length === t)) return e;
    t !== void 0 && st(t, "length");
    let o = Ht(e), r = t !== void 0 ? ` of length ${t}` : "", s = o ? `length=${e.length}` : `type=${typeof e}`, i = he(n) + "expected Uint8Array" + r + ", got " + s;
    throw o ? new RangeError(i) : new TypeError(i);
  }
  function Ot(e) {
    if (typeof e != "function" || typeof e.create != "function") throw new TypeError("expected hash wrapped by utils.createHasher");
    if (st(e.outputLen), st(e.blockLen), e.outputLen < 1 || e.blockLen < 1) throw new Error("hash blockLen / outputLen must be >= 1");
  }
  var hr = (e, t) => {
    if (e === null || typeof e != "object" || Array.isArray(e)) throw new TypeError((t === "object" ? "" : `"${t}" `) + "expected object, got type=" + typeof e);
  };
  var tn = (e, t) => {
    hr(e, t);
    let n = Object.getPrototypeOf(e);
    if (n !== Object.prototype && n !== null) throw new TypeError(`"${t}" expected plain object`);
    if (Object.hasOwn(e, "__proto__")) throw new TypeError(`"${t}.__proto__" is not allowed`);
  };
  function Bt(e, t = true) {
    if (e.destroyed) throw new Error("hash was destroyed");
    if (t && e.finished) throw new Error("digest() was already called");
  }
  function Ft(e, t) {
    Y(e, void 0, "output");
    let n = t.outputLen;
    if (!(e.length >= n)) throw new RangeError('"output" expected length >= ' + n);
  }
  function et(...e) {
    for (let t = 0; t < e.length; t++) e[t].fill(0);
  }
  function Mt(e) {
    return new DataView(e.buffer, e.byteOffset, e.byteLength);
  }
  function K(e, t) {
    return e << 32 - t | e >>> t;
  }
  var nn = typeof Uint8Array.from([]).toHex == "function" && typeof Uint8Array.fromHex == "function";
  var pr = Array.from({ length: 256 }, (e, t) => t.toString(16).padStart(2, "0"));
  function Dt(e) {
    if (Y(e), nn) return e.toHex();
    let t = "";
    for (let n = 0; n < e.length; n++) t += pr[e[n]];
    return t;
  }
  function en(e) {
    return e >= 48 && e <= 57 ? e - 48 : e >= 65 && e <= 70 ? e - 55 : e >= 97 && e <= 102 ? e - 87 : void 0;
  }
  function pe(e) {
    if (typeof e != "string") throw new TypeError("hex string expected, got " + typeof e);
    if (nn) try {
      return Uint8Array.fromHex(e);
    } catch (r) {
      throw r instanceof SyntaxError ? new RangeError(r.message) : r;
    }
    let t = e.length, n = t / 2;
    if (t % 2) throw new RangeError("hex string expected, got unpadded hex of length " + t);
    let o = new Uint8Array(n);
    for (let r = 0, s = 0; r < n; r++, s += 2) {
      let i = en(e.charCodeAt(s)), c = en(e.charCodeAt(s + 1));
      if (i === void 0 || c === void 0) {
        let f = e[s] + e[s + 1];
        throw new RangeError('hex string expected, got non-hex character "' + f + '" at index ' + s);
      }
      o[r] = i * 16 + c;
    }
    return o;
  }
  function xr(e, t, n = "opts") {
    return tn(e, "defaults"), t !== void 0 && tn(t, n), Object.assign(/* @__PURE__ */ Object.create(null), e, t);
  }
  function rn(e, t = {}) {
    if (typeof e != "function") throw new TypeError('"hashCons" expected function, got type=' + typeof e);
    t = xr({}, t, "info");
    let n = (r, s) => e(s).update(r).digest(), o = e(void 0);
    return n.outputLen = o.outputLen, n.blockLen = o.blockLen, n.canXOF = o.canXOF, n.create = (r) => e(r), Object.assign(n, t), Object.freeze(n);
  }
  function on(e = 32) {
    st(e, "bytesLength");
    let t = typeof globalThis == "object" ? globalThis.crypto : null;
    if (typeof t?.getRandomValues != "function") throw new Error("crypto.getRandomValues must be defined");
    if (e > 65536) throw new RangeError(`"bytesLength" expected <= 65536, got ${e}`);
    return t.getRandomValues(new Uint8Array(e));
  }
  var sn = (e) => ({ oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, e]) });
  function cn(e, t, n) {
    return e & t ^ ~e & n;
  }
  function fn(e, t, n) {
    return e & t ^ e & n ^ t & n;
  }
  var kt = class {
    blockLen;
    outputLen;
    canXOF = false;
    padOffset;
    isLE;
    buffer;
    view;
    finished = false;
    length = 0;
    pos = 0;
    destroyed = false;
    constructor(t, n, o, r) {
      this.blockLen = t, this.outputLen = n, this.padOffset = o, this.isLE = r, this.buffer = new Uint8Array(t), this.view = Mt(this.buffer);
    }
    update(t) {
      Bt(this), Y(t);
      let { view: n, buffer: o, blockLen: r } = this, s = t.length, i = false;
      for (let c = 0; c < s; ) {
        let f = Math.min(r - this.pos, s - c);
        if (f === r) {
          let a = Mt(t);
          for (; r <= s - c; c += r) this.process(a, c);
          i = true;
          continue;
        }
        o.set(c === 0 && f === s ? t : t.subarray(c, c + f), this.pos), this.pos += f, c += f, this.pos === r && (this.process(n, 0), this.pos = 0, i = true);
      }
      return this.length += t.length, i && this.roundClean(), this;
    }
    digestInto(t) {
      Bt(this), Ft(t, this), this.finished = true;
      let { buffer: n, view: o, blockLen: r, isLE: s } = this, { pos: i } = this;
      n[i++] = 128, n.fill(0, i), this.padOffset > r - i && (this.process(o, 0), n.fill(0)), Je(o, r - 8, this.length * 8, s), this.process(o, 0), this.roundClean();
      let c = t === n ? o : Mt(t), f = this.outputLen, a = f / 4, d = this.get();
      if (f % 4 || a > d.length) throw new Error("invalid outputLen");
      for (let u = 0; u < a; u++) c.setUint32(4 * u, d[u], s);
    }
    digest() {
      let { buffer: t, outputLen: n } = this;
      this.digestInto(t);
      let o = t.slice(0, n);
      return this.destroy(), o;
    }
    _cloneIntoMeta(t) {
      let { buffer: n, length: o, finished: r, destroyed: s, pos: i } = this;
      return t.destroyed = s, t.finished = r, t.length = o, t.pos = i, i && t.buffer.set(n), t;
    }
    clone() {
      return this._cloneInto();
    }
  };
  var an = Uint32Array.from([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]);
  var br = Uint32Array.from([1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298]);
  var at = new Uint32Array(64);
  var xe = class extends kt {
    A = 0;
    B = 0;
    C = 0;
    D = 0;
    E = 0;
    F = 0;
    G = 0;
    H = 0;
    constructor(t, n) {
      super(64, t, 8, false), this.A = n[0] | 0, this.B = n[1] | 0, this.C = n[2] | 0, this.D = n[3] | 0, this.E = n[4] | 0, this.F = n[5] | 0, this.G = n[6] | 0, this.H = n[7] | 0;
    }
    get() {
      let { A: t, B: n, C: o, D: r, E: s, F: i, G: c, H: f } = this;
      return [t, n, o, r, s, i, c, f];
    }
    set(t, n, o, r, s, i, c, f) {
      this.A = t | 0, this.B = n | 0, this.C = o | 0, this.D = r | 0, this.E = s | 0, this.F = i | 0, this.G = c | 0, this.H = f | 0;
    }
    _cloneInto(t) {
      return (t ||= new this.constructor()).set(...this.get()), this._cloneIntoMeta(t);
    }
    process(t, n) {
      for (let u = 0; u < 16; u++, n += 4) at[u] = t.getUint32(n, false);
      for (let u = 16; u < 64; u++) {
        let l = at[u - 15], p = at[u - 2], x = K(l, 7) ^ K(l, 18) ^ l >>> 3, h = K(p, 17) ^ K(p, 19) ^ p >>> 10;
        at[u] = h + at[u - 7] + x + at[u - 16] | 0;
      }
      let { A: o, B: r, C: s, D: i, E: c, F: f, G: a, H: d } = this;
      for (let u = 0; u < 64; u++) {
        let l = K(c, 6) ^ K(c, 11) ^ K(c, 25), p = d + l + cn(c, f, a) + br[u] + at[u] | 0, h = (K(o, 2) ^ K(o, 13) ^ K(o, 22)) + fn(o, r, s) | 0;
        d = a, a = f, f = c, c = i + p | 0, i = s, s = r, r = o, o = p + h | 0;
      }
      o = o + this.A | 0, r = r + this.B | 0, s = s + this.C | 0, i = i + this.D | 0, c = c + this.E | 0, f = f + this.F | 0, a = a + this.G | 0, d = d + this.H | 0, this.set(o, r, s, i, c, f, a, d);
    }
    roundClean() {
      et(at);
    }
    destroy() {
      this.destroyed = true, this.set(0, 0, 0, 0, 0, 0, 0, 0), et(this.buffer);
    }
  };
  var be = class extends xe {
    constructor() {
      super(32, an);
    }
  };
  var gr = rn(() => new be(), sn(1));
  function jt(e, t, n = () => {
  }) {
    if (!Array.isArray(e)) throw new TypeError(`"${t}" expected array, got type=${typeof e}`);
    for (let o = 0; o < e.length; o++) n(e[o], `${t}[${o}]`);
    return e;
  }
  var it = (e, t, n) => Y(e, t, n);
  var ge = st;
  function ut(e, t = "object") {
    if (e === null || typeof e != "object" || Array.isArray(e)) throw new TypeError(t === "object" ? "expected valid options object" : `"${t}" expected object, got type=${typeof e}`);
    return e;
  }
  function ht(e, t) {
    if (typeof e != "function") throw new TypeError(`"${t}" is invalid: expected function, got ${typeof e}`);
    return e;
  }
  var dn = Dt;
  var ln = (e) => pe(e);
  var $t = Ht;
  var zt = (e) => on(e);
  var qt = BigInt(0);
  var un = BigInt(1);
  var yr = (e) => e ? `"${e}" ` : "";
  function pt(e, t = "") {
    if (typeof e != "boolean") throw new TypeError(yr(t) + "expected boolean, got type=" + typeof e);
    return e;
  }
  function wr(e) {
    if (typeof e == "bigint") {
      if (!dt(e)) throw new RangeError("positive bigint expected, got " + e);
    } else ge(e);
    return e;
  }
  function Lt(e, t = "") {
    if (typeof e != "number") {
      let n = t && `"${t}" `;
      throw new TypeError(n + "expected number, got type=" + typeof e);
    }
    if (!Number.isSafeInteger(e)) {
      let n = t && `"${t}" `;
      throw new RangeError(n + "expected safe integer, got " + e);
    }
  }
  function hn(e) {
    if (typeof e != "string") throw new TypeError("hex string expected, got " + typeof e);
    return e === "" ? qt : BigInt("0x" + e);
  }
  function Zt(e) {
    return hn(Dt(e));
  }
  function xt(e) {
    return hn(Dt(bt(Y(e)).reverse()));
  }
  function ye(e, t) {
    if (st(t), t === 0) throw new Error("zero output length is invalid");
    e = wr(e);
    let n = t * 2, o = e.toString(16);
    if (o.length > n) throw new RangeError("number is too large");
    return pe(o.padStart(n, "0"));
  }
  function Pt(e, t) {
    return ye(e, t).reverse();
  }
  function bt(e) {
    return Uint8Array.from(it(e));
  }
  function dt(e) {
    return typeof e == "bigint" && qt <= e;
  }
  function we(e, t, n) {
    return dt(e) && dt(t) && dt(n) && t <= e && e < n;
  }
  function gt(e, t, n, o) {
    if (!we(t, n, o)) throw new RangeError("expected valid " + e + ": " + n + " <= n < " + o + ", got " + t);
  }
  function me(e) {
    if (e < qt) throw new Error("expected non-negative bigint, got " + e);
    return e === qt ? 0 : e.toString(2).length;
  }
  var pn = (e) => (Lt(e, "n"), (un << BigInt(e)) - un);
  function yt(e, t = {}, n = {}, o = "object") {
    ut(e, o), ut(t, "fields"), ut(n, "optFields");
    function r(i, c, f) {
      let a = o === "object" ? `param "${String(i)}"` : `"${o}.${String(i)}"`, d = e[i];
      if (!Object.hasOwn(e, i) && (f ? d !== void 0 : c !== "function")) throw new TypeError(`${a} is invalid: expected own property`);
      if (f && d === void 0) return;
      let u = typeof d;
      if (u !== c || d === null) throw new TypeError(`${a} is invalid: expected ${c}, got ${u}`);
    }
    let s = (i, c) => Object.entries(i).forEach(([f, a]) => r(f, a, c));
    s(t, false), s(n, true);
  }
  var Z = BigInt(0);
  var j = BigInt(1);
  var wt = BigInt(2);
  var gn = BigInt(3);
  var Ee = BigInt(4);
  var yn = BigInt(5);
  var mr = BigInt(7);
  var wn = BigInt(8);
  var Er = BigInt(9);
  var Br = BigInt(15);
  var mn = BigInt(16);
  var Ar = BigInt("0x10000000000000000");
  function q(e, t) {
    if (t <= Z) throw new Error("mod: expected positive modulus, got " + t);
    let n = e % t;
    return n >= Z ? n : t + n;
  }
  function _r(e, t, n) {
    if (n <= j) throw new Error("pow: expected modulus > 1, got " + n);
    if (typeof t != "bigint") throw new TypeError("invalid exponent: expected bigint, got " + typeof t);
    if (t < Z) throw new Error("invalid exponent, negatives unsupported");
    if (t === Z) return j;
    if (t === j) return e;
    let o = e % n;
    if (o < Z && (o += n), t < Ar) {
      let c = j;
      for (; t > Z; ) t & j && (c = c * o % n), o = o * o % n, t >>= j;
      return c;
    }
    let r = [];
    for (; t > Z; ) r.push(Number(t & Br)), t >>= Ee;
    let s = new Array(16);
    s[0] = j, s[1] = o;
    for (let c = 2; c < 16; c++) s[c] = s[c - 1] * o % n;
    let i = s[r[r.length - 1]];
    for (let c = r.length - 2; c >= 0; c--) {
      i = i * i % n, i = i * i % n, i = i * i % n, i = i * i % n;
      let f = r[c];
      f !== 0 && (i = i * s[f] % n);
    }
    return i;
  }
  function G(e, t, n) {
    if (n <= j) throw new Error("pow2: expected modulus > 1, got " + n);
    if (t < Z) throw new Error("pow2: expected non-negative exponent, got " + t);
    let o = e;
    for (; t-- > Z; ) o *= o, o %= n;
    return o;
  }
  function xn(e, t) {
    if (e === Z) throw new Error("invert: expected non-zero number");
    if (t <= j) throw new Error("invert: expected modulus > 1, got " + t);
    let n = q(e, t), o = t, r = Z, s = j;
    for (; n !== Z; ) {
      let c = o / n, f = o - n * c, a = r - s * c;
      o = n, n = f, r = s, s = a;
    }
    if (o !== j) throw new Error("invert: does not exist");
    return q(r, t);
  }
  function Be(e, t, n) {
    let o = e;
    if (!o.eql(o.sqr(t), n)) throw new Error("Cannot find square root");
  }
  function Ae(e, t) {
    if ((e & j) === Z) throw new Error(t + ": expected odd modulus, got " + e);
  }
  function En(e, t) {
    let n = e, o = (n.ORDER + j) / Ee, r = n.pow(t, o);
    return Be(n, r, t), r;
  }
  function Tr(e, t) {
    let n = e, o = (n.ORDER - yn) / wn, r = n.mul(t, wt), s = n.pow(r, o), i = n.mul(t, s), c = n.mul(n.mul(i, wt), s), f = n.mul(i, n.sub(c, n.ONE));
    return Be(n, f, t), f;
  }
  function Sr(e) {
    let t = Wt(e), n = Bn(e), o = n(t, t.neg(t.ONE)), r = n(t, o), s = n(t, t.neg(o)), i = (e + mr) / mn;
    return ((c, f) => {
      let a = c, d = a.pow(f, i), u = a.mul(d, o), l = a.mul(d, r), p = a.mul(d, s), x = a.eql(a.sqr(u), f), h = a.eql(a.sqr(l), f);
      d = a.cmov(d, u, x), u = a.cmov(p, l, h);
      let y = a.eql(a.sqr(u), f), B = a.cmov(d, u, y);
      return Be(a, B, f), B;
    });
  }
  function Bn(e) {
    if (e < gn) throw new Error("sqrt is not defined for small field");
    Ae(e, "tonelliShanks");
    let t = e - j, n = 0;
    for (; t % wt === Z; ) t /= wt, n++;
    let o = wt, r = Wt(e);
    for (; Rt(r, o) === 1; ) if (o++ > 1e3) throw new Error("Cannot find square root: probably non-prime P");
    if (n === 1) return En;
    let s = r.pow(o, t), i = (t + j) / wt;
    return function(f, a) {
      let d = f;
      if (d.is0(a)) return a;
      if (Rt(d, a) !== 1) throw new Error("Cannot find square root");
      let u = n, l = d.mul(d.ONE, s), p = d.pow(a, t), x = d.pow(a, i);
      for (; !d.eql(p, d.ONE); ) {
        if (d.is0(p)) throw new Error("Cannot find square root: probably non-prime P");
        let h = 1, y = d.sqr(p);
        for (; !d.eql(y, d.ONE); ) if (h++, y = d.sqr(y), h === u) throw new Error("Cannot find square root");
        let B = j << BigInt(u - h - 1), m = d.pow(l, B);
        u = h, l = d.sqr(m), p = d.mul(p, l), x = d.mul(x, m);
      }
      return x;
    };
  }
  function Or(e) {
    return Ae(e, "Fp.sqrt"), e % Ee === gn ? En : e % wn === yn ? Tr : e % mn === Er ? Sr(e) : Bn(e);
  }
  var An = (e, t) => (q(e, t) & j) === j;
  var Lr = ["create", "isValid", "is0", "neg", "inv", "sqrt", "sqr", "eql", "add", "sub", "mul", "pow", "div", "addN", "subN", "mulN", "sqrN"];
  function At(e) {
    if (ut(e, "field"), typeof e.ORDER != "bigint") throw new TypeError('param "ORDER" is invalid: expected bigint, got ' + typeof e.ORDER);
    Lt(e.BYTES, "BYTES"), Lt(e.BITS, "BITS");
    for (let t of Lr) ht(e[t], "field." + t);
    if (e.BYTES < 1 || e.BITS < 1) throw new Error("invalid field: expected BYTES/BITS > 0");
    if (e.ORDER <= j) throw new Error("invalid field: expected ORDER > 1, got " + e.ORDER);
    return e;
  }
  function Gt(e, t, n = false) {
    At(e), jt(t, "nums"), pt(n, "passZero");
    let o = e, r = new Array(t.length).fill(n ? o.ZERO : void 0), s = t.reduce((c, f, a) => o.is0(f) ? c : (r[a] = c, o.mul(c, f)), o.ONE), i = o.inv(s);
    return t.reduceRight((c, f, a) => o.is0(f) ? c : (r[a] = o.mul(c, r[a]), o.mul(c, f)), i), r;
  }
  function Rt(e, t) {
    At(e);
    let n = e;
    Ae(n.ORDER, "FpLegendre");
    let o = (n.ORDER - j) / wt, r = n.pow(t, o), s = n.eql(r, n.ONE), i = n.eql(r, n.ZERO), c = n.eql(r, n.neg(n.ONE));
    if (!s && !i && !c) throw new Error("invalid Legendre symbol result");
    return s ? 1 : i ? 0 : -1;
  }
  function Rr(e, t) {
    if (t !== void 0 && ge(t), e <= Z) throw new Error("invalid n length: expected positive n, got " + e);
    if (t !== void 0 && t < 1) throw new Error("invalid n length: expected positive bit length, got " + t);
    let n = me(e);
    if (t !== void 0 && t < n) throw new Error(`invalid n length: expected nBitLength (${t}) >= bitLen(n) (${n})`);
    let o = t !== void 0 ? t : n, r = Math.ceil(o / 8);
    return { nBitLength: o, nByteLength: r };
  }
  var bn = /* @__PURE__ */ new WeakMap();
  var Yt = class {
    ORDER;
    BITS;
    BYTES;
    isLE;
    ZERO = Z;
    ONE = j;
    _lengths;
    _mod;
    constructor(t, n = {}) {
      if (t <= j) throw new Error("invalid field: expected ORDER > 1, got " + t);
      let o;
      this.isLE = false, n != null && typeof n == "object" && (typeof n.BITS == "number" && (o = n.BITS), typeof n.sqrt == "function" && Object.defineProperty(this, "sqrt", { value: n.sqrt, enumerable: true }), typeof n.isLE == "boolean" && (this.isLE = n.isLE), n.allowedLengths && (this._lengths = Object.freeze(n.allowedLengths.slice())), typeof n.modFromBytes == "boolean" && (this._mod = n.modFromBytes));
      let { nBitLength: r, nByteLength: s } = Rr(t, o);
      if (s > 2048) throw new Error("invalid field: expected ORDER of <= 2048 bytes");
      this.ORDER = t, this.BITS = r, this.BYTES = s, Object.freeze(this);
    }
    create(t) {
      return q(t, this.ORDER);
    }
    isValid(t) {
      if (typeof t != "bigint") throw new TypeError("invalid field element: expected bigint, got " + typeof t);
      return Z <= t && t < this.ORDER;
    }
    is0(t) {
      return t === Z;
    }
    isValidNot0(t) {
      return !this.is0(t) && this.isValid(t);
    }
    isOdd(t) {
      return (t & j) === j;
    }
    neg(t) {
      return q(-t, this.ORDER);
    }
    eql(t, n) {
      return t === n;
    }
    sqr(t) {
      return q(t * t, this.ORDER);
    }
    add(t, n) {
      return q(t + n, this.ORDER);
    }
    sub(t, n) {
      return q(t - n, this.ORDER);
    }
    mul(t, n) {
      return q(t * n, this.ORDER);
    }
    pow(t, n) {
      return _r(t, n, this.ORDER);
    }
    div(t, n) {
      return q(t * xn(n, this.ORDER), this.ORDER);
    }
    sqrN(t) {
      return t * t;
    }
    addN(t, n) {
      return t + n;
    }
    subN(t, n) {
      return t - n;
    }
    mulN(t, n) {
      return t * n;
    }
    inv(t) {
      return xn(t, this.ORDER);
    }
    sqrt(t) {
      let n = bn.get(this);
      return n || bn.set(this, n = Or(this.ORDER)), n(this, t);
    }
    toBytes(t) {
      return this.isLE ? Pt(t, this.BYTES) : ye(t, this.BYTES);
    }
    fromBytes(t, n = false) {
      it(t);
      let { _lengths: o, BYTES: r, isLE: s, ORDER: i, _mod: c } = this;
      if (o) {
        if (t.length < 1 || !o.includes(t.length) || t.length > r) throw new Error("Field.fromBytes: expected " + o + " bytes, got " + t.length);
        let a = new Uint8Array(r);
        a.set(t, s ? 0 : a.length - t.length), t = a;
      }
      if (t.length !== r) throw new Error("Field.fromBytes: expected " + r + " bytes, got " + t.length);
      let f = s ? xt(t) : Zt(t);
      if (c && (f = q(f, i)), !n && !this.isValid(f)) throw new Error("invalid field element: outside of range 0..ORDER");
      return f;
    }
    invertBatch(t) {
      return Gt(this, t, true);
    }
    cmov(t, n, o) {
      return pt(o, "condition"), o ? n : t;
    }
  };
  function Wt(e, t = {}) {
    return Object.freeze(Yt.prototype), new Yt(e, t);
  }
  var Se = BigInt(0);
  var vt = BigInt(1);
  var vr = BigInt(4);
  var _e = 16;
  var _n = 128;
  var Ir = 5;
  var Tn = 2 ** 31;
  function Kt(e) {
    let t = e;
    if (typeof t != "function") throw new TypeError('"Point" expected constructor, got type=' + typeof e);
    ht(t.fromAffine, "Point.fromAffine"), ht(t.fromBytes, "Point.fromBytes"), ht(t.fromHex, "Point.fromHex"), ut(t.BASE, "Point.BASE"), ut(t.ZERO, "Point.ZERO"), At(t.Fp), At(t.Fn);
  }
  function On(e, t) {
    Kt(e), Ln(t, e);
    let n = Gt(e.Fp, t.map((o) => o.Z));
    return t.map((o, r) => e.fromAffine(o.toAffine(n[r])));
  }
  function Ur(e, t, n = 1) {
    if (!Number.isSafeInteger(e) || e < n || e > t) throw new Error("invalid window size, expected [" + n + ".." + t + "], got W=" + e);
  }
  function Cr(e, t) {
    let n = e * (4 * t + 128);
    if (n > Tn) throw new Error("invalid window size: table would need ~" + Math.ceil(n / 2 ** 20) + " MiB, max " + Tn / 2 ** 20 + " MiB");
  }
  function Nr(e, t) {
    if (e !== void 0) {
      ht(e, "randomBytes");
      try {
        let n = e(t);
        if (!$t(n) || n.length !== t) return;
      } catch {
        return;
      }
      return e;
    }
  }
  function Ln(e, t) {
    jt(e, "points"), e.forEach((n, o) => {
      if (!(n instanceof t)) throw new Error("invalid point at index " + o);
    });
  }
  function Hr(e, t, n) {
    if (!Array.isArray(e)) throw new Error("array of scalars expected");
    e.forEach((o, r) => {
      if (!(n === void 0 ? t.isValid(o) : dt(o) && o < n)) throw new Error("invalid scalar at index " + r);
    });
  }
  var Rn = /* @__PURE__ */ new WeakMap();
  function Te(e) {
    return Rn.get(e) || 1;
  }
  function Fr(e, t) {
    let n = e.double(), o = [e];
    for (let r = 1; r < t; r++) o.push(o[r - 1].add(n));
    return o;
  }
  function Mr(e, t) {
    let n = 2 ** t, o = n / 2, r = BigInt(n - 1), s = [];
    for (; e > Se; ) {
      let i = 0;
      e & vt && (i = Number(e & r), i >= o && (i -= n), e -= BigInt(i)), s.push(i), e >>= vt;
    }
    return s;
  }
  function Dr(e, t, n) {
    let o = 2 ** t, r = o / 2, s = BigInt(o - 1), i = BigInt(t), c = [];
    for (let f = 0; f < n; f++) {
      let a = Number(e & s);
      e >>= i, a > r && (a -= o, e += vt), c.push(a);
    }
    if (e !== Se) throw new Error("invalid wnaf");
    return c;
  }
  function kr(e, t, n) {
    let o = 0;
    for (let s of n) o = Math.max(o, s.length);
    let r = e;
    for (let s = o - 1; s >= 0; s--) {
      s !== o - 1 && (r = r.double());
      for (let i = 0; i < n.length; i++) {
        let c = n[i][s];
        if (c) {
          let f = t[i][Math.abs(c) - 1 >> 1];
          r = r.add(c < 0 ? f.negate() : f);
        }
      }
    }
    return r;
  }
  var Xt = class {
    Point;
    BASE;
    ZERO;
    randomBytes;
    wnafPrecomputes = /* @__PURE__ */ new WeakMap();
    baseCanBeBlinded;
    bits;
    constructor(t, n) {
      Kt(t), this.randomBytes = Nr(n, _e), this.Point = t, this.BASE = t.BASE, this.ZERO = t.ZERO, this.bits = t.Fn.BITS;
    }
    buildWnafTable(t, n, o) {
      let r = Math.ceil(o / n) + 1, s = 2 ** (n - 1), i = [], c = t;
      for (let f = 0; f < r; f++) {
        let a = c;
        for (let d = 0; d < s; d++) i.push(a), a = a.add(c);
        c = i[i.length - 1].double();
      }
      return { W: n, bits: o, windows: r, comp: i };
    }
    wnafCachedCT(t, n) {
      let { W: o, windows: r, comp: s } = t, i = 2 ** (o - 1), c = Dr(n, o, r), f = this.ZERO, a = this.BASE;
      for (let d = 0; d < r; d++) {
        let u = c[d], l = d * i, p = Math.abs(u) - 1, x = s[l];
        for (let y = 1; y < i; y++) x = y === p ? s[l + y] : x;
        let h = x.negate();
        u === 0 ? a = a.add(s[l]) : f = f.add(u < 0 ? h : x);
      }
      return { p: f, f: a };
    }
    getWnafPrecomputes(t, n, o, r) {
      let s = this.wnafPrecomputes.get(n), i = s?.find((c) => c.W === t && c.bits === o);
      return i || (i = this.buildWnafTable(n, t, o), typeof r == "function" && (i = { ...i, comp: r(i.comp) }), s || (s = [], this.wnafPrecomputes.set(n, s)), s.push(i)), i;
    }
    assertPoint(t) {
      if (!(t instanceof this.Point)) throw new TypeError('"point" expected Point instance, got type=' + typeof t);
    }
    validateMulInput(t, n) {
      if (this.assertPoint(t), !we(n, vt, this.Point.Fn.ORDER)) throw new Error("invalid scalar");
    }
    runCT(t, n, o, r) {
      let s = Te(t);
      return s === 1 ? this.fixedWindowCT(t, n, o) : this.wnafCachedCT(this.getWnafPrecomputes(s, t, o, r), n);
    }
    mulCT(t, n, o) {
      return this.validateMulInput(t, n), this.runCT(t, n, this.bits, o);
    }
    mulCTBlinded(t, n, o) {
      if (this.validateMulInput(t, n), this.randomBytes === void 0) throw new Error("randomBytes is required for scalar blinding");
      let r = this.Point.Fn.BITS + _n, s = this.randomBytes(_e);
      if (!$t(s) || s.length !== _e) throw new Error("randomBytes returned invalid byte array");
      s[0] = s[0] & 63 | 128;
      let i = n + Zt(s) * this.Point.Fn.ORDER;
      return this.runCT(t, i, r, o);
    }
    fixedWindowCT(t, n, o) {
      let r = Ir, s = 1 << r, i = pn(r), c = new Array(s);
      c[0] = this.ZERO;
      for (let d = 1; d < s; d++) c[d] = c[d - 1].add(t);
      let f = Math.ceil(o / r), a = this.ZERO;
      for (let d = f - 1; d >= 0; d--) {
        if (d !== f - 1) for (let p = 0; p < r; p++) a = a.double();
        let u = Number(n >> BigInt(d * r) & i), l = c[0];
        for (let p = 1; p < s; p++) l = p === u ? c[p] : l;
        a = a.add(l);
      }
      return { p: a, f: a };
    }
    shouldBlind(t, n) {
      return this.randomBytes === void 0 ? false : n === vt ? true : t !== this.BASE ? false : (this.baseCanBeBlinded === void 0 && (this.baseCanBeBlinded = this.mulUnsafe(this.BASE, this.Point.Fn.ORDER).is0()), this.baseCanBeBlinded);
    }
    mulSecret(t, n, o, r) {
      return this.shouldBlind(t, o) ? this.mulCTBlinded(t, n, r) : this.mulCT(t, n, r);
    }
    mulUnsafe(t, n, o) {
      if (this.assertPoint(t), !dt(n)) throw new Error("invalid scalar");
      let r = Te(t);
      if (r === 1 || n >= this.Point.Fn.ORDER) return qr(this.Point, [t], [n], true);
      let s = this.getWnafPrecomputes(r, t, this.bits, o);
      return this.wnafCachedCT(s, n).p;
    }
    setWindowSize(t, n) {
      this.assertPoint(t), Ur(n, this.bits);
      let o = Math.ceil((this.bits + _n) / n) + 1;
      Cr(o * 2 ** (n - 1), this.Point.Fp.BYTES), Rn.set(t, n), this.wnafPrecomputes.delete(t);
    }
    hasWindowSize(t) {
      return Te(t) !== 1;
    }
  };
  function qr(e, t, n, o = false) {
    if (Kt(e), Ln(t, e), pt(o, "allowOversized"), Hr(n, e.Fn, o ? e.Fn.ORDER ** vr : void 0), t.length !== n.length) throw new Error("arrays of points and scalars must have equal length");
    let r = t.map((i) => Fr(i, 4)), s = n.map((i) => Mr(i, 4));
    return kr(e.ZERO, r, s);
  }
  function Sn(e, t, n) {
    if (t) {
      if (t.ORDER !== e) throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
      return At(t), t;
    } else return Wt(e, { isLE: n });
  }
  function vn(e, t, n = {}, o) {
    if (e !== "weierstrass" && e !== "edwards") throw new Error('expected curve type "weierstrass" or "edwards"');
    if (o === void 0 && (o = e === "edwards"), !t || typeof t != "object") throw new Error(`expected valid ${e} CURVE object`);
    yt(n);
    for (let f of ["p", "n", "h"]) {
      let a = t[f];
      if (!(dt(a) && a !== Se)) throw new Error(`CURVE.${f} must be positive bigint`);
    }
    let r = Sn(t.p, n.Fp, o), s = Sn(t.n, n.Fn, o), c = ["Gx", "Gy", "a", e === "weierstrass" ? "b" : "d"];
    for (let f of c) if (!r.isValid(t[f])) throw new Error(`CURVE.${f} must be valid field element of CURVE.Fp`);
    return t = Object.freeze(Object.assign({}, t)), { CURVE: t, Fp: r, Fn: s };
  }
  function Oe(e, t) {
    return function(o) {
      let r = e(o);
      return { secretKey: r, publicKey: t(r) };
    };
  }
  var Vt = BigInt(0);
  var Qt = BigInt(1);
  var Jt = BigInt(2);
  var jr = BigInt(4);
  var In = BigInt(8);
  function $r(e, t, n, o) {
    let r = e.sqr(n), s = e.sqr(o), i = e.add(e.mul(t.a, r), s), c = e.add(e.ONE, e.mul(t.d, e.mul(r, s)));
    return e.eql(i, c);
  }
  function Un(e, t = {}) {
    yt(t, {}, {}, "extraOpts");
    let n = t, o = vn("edwards", e, n, n.FpFnLE), { Fp: r, Fn: s } = o, i = o.CURVE, { h: c } = i;
    if (Rt(r, i.a) !== 1) throw new Error("edwards: CURVE.a must be a square in Fp for complete addition formulas");
    if (Rt(r, i.d) !== -1) throw new Error("edwards: CURVE.d must be a non-square in Fp for complete addition formulas");
    yt(n, {}, { uvRatio: "function", randomBytes: "function" });
    let f = n.randomBytes === void 0 ? zt : n.randomBytes, a = Jt << BigInt(r.BYTES * 8) - Qt;
    function d(m) {
      if (!r.isOdd) throw new Error("Field does not have .isOdd()");
      return r.isOdd(m);
    }
    let u = n.uvRatio === void 0 ? (m, b) => {
      try {
        return { isValid: true, value: r.sqrt(r.div(m, b)) };
      } catch {
        return { isValid: false, value: Vt };
      }
    } : n.uvRatio;
    if (!$r(r, i, i.Gx, i.Gy)) throw new Error("bad curve params: generator point");
    let l = r.eql(i.a, r.neg(r.ONE)) ? (m) => r.neg(m) : r.eql(i.a, r.ONE) ? (m) => m : (m) => r.mul(i.a, m);
    function p(m, b, A = false) {
      let E = A ? Qt : Vt;
      return gt("coordinate " + m, b, E, a), b;
    }
    function x(m) {
      if (!(m instanceof h)) throw new Error("EdwardsPoint expected");
    }
    class h {
      static BASE = new h(i.Gx, i.Gy, r.ONE, r.mul(i.Gx, i.Gy));
      static ZERO = new h(r.ZERO, r.ONE, r.ONE, r.ZERO);
      static Fp = r;
      static Fn = s;
      X;
      Y;
      Z;
      T;
      constructor(b, A, E, R) {
        this.X = p("x", b), this.Y = p("y", A), this.Z = p("z", E, true), this.T = p("t", R), Object.freeze(this);
      }
      static CURVE() {
        return i;
      }
      static fromAffine(b) {
        if (b instanceof h) throw new Error("extended point not allowed");
        let { x: A, y: E } = b || {};
        return p("x", A), p("y", E), new h(A, E, r.ONE, r.mul(A, E));
      }
      static fromBytes(b, A = false) {
        let E = r.BYTES, { a: R, d: F } = i;
        b = bt(it(b, E, "point")), pt(A, "zip215");
        let N = bt(b), _ = b[E - 1];
        N[E - 1] = _ & -129;
        let O = xt(N), v = A ? a : r.ORDER;
        gt("point.y", O, Vt, v);
        let L = r.sqr(O), I = r.sub(L, r.ONE), U = r.sub(r.mulN(F, L), R), { isValid: C, value: w } = u(I, U);
        if (!C) throw new Error("bad point: invalid y coordinate");
        let T = d(w), S = (_ & 128) !== 0;
        if (!A && r.is0(w) && S) throw new Error("bad point: x=0 and x_0=1");
        return S !== T && (w = r.neg(w)), h.fromAffine({ x: w, y: O });
      }
      static fromHex(b, A = false) {
        return h.fromBytes(ln(b), A);
      }
      get x() {
        return this.toAffine().x;
      }
      get y() {
        return this.toAffine().y;
      }
      precompute(b = 6, A = true) {
        return B.setWindowSize(this, b), A || this.multiply(Jt), this;
      }
      assertValidity() {
        let b = this, { a: A, d: E } = i;
        if (b.is0()) throw new Error("bad point: ZERO");
        let { X: R, Y: F, Z: N, T: _ } = b, O = r.sqr(R), v = r.sqr(F), L = r.sqr(N), I = r.sqr(L), U = r.mul(O, A), C = r.mul(r.add(U, v), L), w = r.add(I, r.mul(E, r.mul(O, v)));
        if (!r.eql(C, w)) throw new Error("bad point: equation left != right (1)");
        let T = r.mul(R, F), S = r.mul(N, _);
        if (!r.eql(T, S)) throw new Error("bad point: equation left != right (2)");
      }
      equals(b) {
        x(b);
        let { X: A, Y: E, Z: R } = this, { X: F, Y: N, Z: _ } = b, O = r.mul(A, _), v = r.mul(F, R), L = r.mul(E, _), I = r.mul(N, R);
        return r.eql(O, v) && r.eql(L, I);
      }
      is0() {
        return this.equals(h.ZERO);
      }
      negate() {
        return new h(r.neg(this.X), this.Y, this.Z, r.neg(this.T));
      }
      double() {
        let { X: b, Y: A, Z: E } = this, R = r.sqr(b), F = r.sqr(A), N = r.mul(r.sqr(E), Jt), _ = l(R), O = r.addN(b, A), v = r.sub(r.subN(r.sqr(O), R), F), L = r.addN(_, F), I = r.subN(L, N), U = r.subN(_, F), C = r.mul(v, I), w = r.mul(L, U), T = r.mul(v, U), S = r.mul(I, L);
        return new h(C, w, S, T);
      }
      add(b) {
        x(b);
        let { d: A } = i, { X: E, Y: R, Z: F, T: N } = this, { X: _, Y: O, Z: v, T: L } = b, I = r.mul(E, _), U = r.mul(R, O), C = r.mul(r.mulN(N, A), L), w = r.mul(F, v), T = r.sub(r.subN(r.mulN(r.addN(E, R), r.addN(_, O)), I), U), S = r.subN(w, C), g = r.addN(w, C), H = r.sub(U, l(I)), k = r.mul(T, S), M = r.mul(g, H), z = r.mul(T, H), V = r.mul(S, g);
        return new h(k, M, V, z);
      }
      subtract(b) {
        return x(b), this.add(b.negate());
      }
      multiply(b) {
        if (!s.isValidNot0(b)) throw new RangeError("invalid scalar: expected 1 <= sc < curve.n");
        let { p: A, f: E } = B.mulSecret(this, b, c, y);
        return y([A, E])[0];
      }
      multiplyUnsafe(b) {
        if (!s.isValid(b)) throw new RangeError("invalid scalar: expected 0 <= sc < curve.n");
        return b === Vt ? h.ZERO : this.is0() || b === Qt ? this : B.mulUnsafe(this, b, y);
      }
      isSmallOrder() {
        return this.clearCofactor().is0();
      }
      isTorsionFree() {
        return B.mulUnsafe(this, i.n).is0();
      }
      toAffine(b) {
        let A = this, E = b;
        if (E != null && typeof E != "bigint") throw new TypeError('"invertedZ" expected bigint, got type=' + typeof E);
        let { X: R, Y: F, Z: N } = A, _ = A.is0();
        E == null && (E = _ ? r.create(In) : r.inv(N));
        let O = r.mul(R, E), v = r.mul(F, E), L = r.mul(N, E);
        if (_) return { x: r.ZERO, y: r.ONE };
        if (!r.eql(L, r.ONE)) throw new Error("invZ was invalid");
        return { x: O, y: v };
      }
      clearCofactor() {
        return c === Qt ? this : c === Jt ? this.double() : c === jr ? this.double().double() : c === In ? this.double().double().double() : this.multiplyUnsafe(c);
      }
      toBytes() {
        let { x: b, y: A } = this.toAffine(), E = r.toBytes(A);
        return E[E.length - 1] |= d(b) ? 128 : 0, E;
      }
      toHex() {
        return dn(this.toBytes());
      }
      toString() {
        return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
      }
    }
    let y = (m) => On(h, m), B = new Xt(h, f);
    return B.bits >= 6 && h.BASE.precompute(6), Object.freeze(h.prototype), Object.freeze(h), h;
  }
  var mt = BigInt(0);
  var W = BigInt(1);
  var te = BigInt(2);
  function Cn(e, t) {
    return e + t - (t >> W << W);
  }
  function zr(e) {
    let t = BigInt(6) * e;
    return (n, o, r) => {
      let s = o + r, c = ((t + r - o) * n + o) % e;
      return { x_2: c, x_3: s - c };
    };
  }
  function Zr(e) {
    return yt(e, { P: "bigint", type: "string", adjustScalarBytes: "function", powPminus2: "function" }, { randomBytes: "function", scalarMultBase: "function" }), Object.freeze({ ...e });
  }
  function Nn(e) {
    let t = Zr(e), { P: n, type: o, adjustScalarBytes: r, powPminus2: s, randomBytes: i } = t, c = t.scalarMultBase, f = o === "x25519";
    if (!f && o !== "x448") throw new Error("invalid type");
    let a = i === void 0 ? zt : i, d = f ? 255 : 448, u = zr(n), l = f ? 32 : 56, p = BigInt(f ? 9 : 5), x = BigInt(f ? 121665 : 39081), h = f ? te ** BigInt(254) : te ** BigInt(447), y = f ? BigInt(8) * (te ** BigInt(251) - W) : BigInt(4) * (te ** BigInt(445) - W), B = h + y + W, m = (w) => q(w, n), b = A(p);
    function A(w) {
      return Pt(m(w), l);
    }
    function E(w) {
      let T = bt(it(w, l, "uCoordinate"));
      return f && (T[31] &= 127), m(xt(T));
    }
    function R(w) {
      return xt(r(bt(it(w, l, "scalar"))));
    }
    let F = new Set(f ? [mt, W, n - W, BigInt("325606250916557431795983626356110631294008115727848805560023387167927233504"), BigInt("39382357235489614581723060781553021112529911719440698176882885853963445705823")] : [mt, W, n - W]);
    function N(w, T) {
      let S = E(T);
      if (F.has(S)) throw new Error("invalid private or public key received");
      let g = L(S, R(w));
      if (g === mt) throw new Error("invalid private or public key received");
      return A(g);
    }
    function _(w) {
      if (c === void 0) return N(w, b);
      let T = R(w);
      gt("scalar", T, h, B);
      let S = m(c(T));
      if (S === mt) throw new Error("invalid private or public key received");
      return A(S);
    }
    let O = _, v = N;
    function L(w, T) {
      gt("u", w, mt, n), gt("scalar", T, h, B);
      let S = T, g = w, H = W, k = mt, M = w, z = W, V = S ^ S >> W;
      for (let Q = BigInt(d - 1); Q >= mt; Q--) {
        let rt = Cn(n, V >> Q);
        ({ x_2: H, x_3: M } = u(rt, H, M)), { x_2: k, x_3: z } = u(rt, k, z);
        let J = H + k, ce = m(J * J), fe = H - k, Ce = m(fe * fe), Ne = ce - Ce, Xn = M + z, Kn = M - z, He = m(Kn * J), Fe = m(Xn * fe), Me = He + Fe, De = He - Fe;
        M = m(Me * Me), z = m(g * m(De * De)), H = m(ce * Ce), k = m(Ne * (ce + m(x * Ne)));
      }
      let nt = Cn(n, S);
      ({ x_2: H, x_3: M } = u(nt, H, M)), { x_2: k, x_3: z } = u(nt, k, z);
      let ct = s(k);
      return m(H * ct);
    }
    let I = { secretKey: l, publicKey: l, seed: l }, U = (w) => (w = w === void 0 ? a(l) : w, it(w, I.seed, "seed"), w), C = { randomSecretKey: U };
    return Object.freeze(I), Object.freeze(C), Object.freeze({ keygen: Oe(U, O), getSharedSecret: v, getPublicKey: O, scalarMult: N, scalarMultBase: _, utils: C, GuBytes: b.slice(), lengths: I });
  }
  var Hn = BigInt(0);
  var Pr = BigInt(1);
  var Fn = BigInt(2);
  var Yr = BigInt(3);
  var Gr = BigInt(5);
  var Wr = BigInt(8);
  var ee = BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed");
  var Xr = { p: ee, n: BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed"), h: Wr, a: BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffec"), d: BigInt("0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3"), Gx: BigInt("0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a"), Gy: BigInt("0x6666666666666666666666666666666666666666666666666666666666666658") };
  function kn(e) {
    let t = BigInt(10), n = BigInt(20), o = BigInt(40), r = BigInt(80), s = ee, c = e * e % s * e % s, f = G(c, Fn, s) * c % s, a = G(f, Pr, s) * e % s, d = G(a, Gr, s) * a % s, u = G(d, t, s) * d % s, l = G(u, n, s) * u % s, p = G(l, o, s) * l % s, x = G(p, r, s) * p % s, h = G(x, r, s) * p % s, y = G(h, t, s) * d % s;
    return { pow_p_5_8: G(y, Fn, s) * e % s, b2: c };
  }
  function Kr(e) {
    return e[0] &= 248, e[31] &= 127, e[31] |= 64, e;
  }
  var Mn = BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
  function Vr(e, t) {
    let n = ee, o = q(t * t * t, n), r = q(o * o * t, n), s = kn(e * r).pow_p_5_8, i = q(e * o * s, n), c = q(t * i * i, n), f = i, a = q(i * Mn, n), d = c === e, u = c === q(-e, n), l = c === q(-e * Mn, n);
    return d && (i = f), (u || l) && (i = a), An(i, n) && (i = q(-i, n)), { isValid: d || u, value: i };
  }
  var Dn = Un(Xr, { uvRatio: Vr });
  var Qr = (() => {
    let e = ee, t = (n) => {
      let { pow_p_5_8: o, b2: r } = kn(n);
      return q(G(o, Yr, e) * r, e);
    };
    return Nn({ P: e, type: "x25519", powPminus2: t, adjustScalarBytes: Kr, scalarMultBase: (n) => {
      let o = q(n, Dn.Fn.ORDER);
      if (o === Hn) return Hn;
      let r = Dn.BASE.multiply(o);
      return q((r.Z + r.Y) * t(q(r.Z - r.Y, e)), e);
    } });
  })();
  var ne = class {
    oHash;
    iHash;
    blockLen;
    outputLen;
    canXOF = false;
    finished = false;
    destroyed = false;
    constructor(t, n) {
      if (Ot(t), Y(n, void 0, "key"), this.iHash = t.create(), typeof this.iHash.update != "function") throw new Error("expected Hash instance");
      this.blockLen = this.iHash.blockLen, this.outputLen = this.iHash.outputLen;
      let o = this.blockLen, r = new Uint8Array(o);
      r.set(n.length > o ? t.create().update(n).digest() : n);
      for (let s = 0; s < r.length; s++) r[s] ^= 54;
      this.iHash.update(r), this.oHash = t.create();
      for (let s = 0; s < r.length; s++) r[s] ^= 106;
      this.oHash.update(r), et(r);
    }
    update(t) {
      return Bt(this), this.iHash.update(t), this;
    }
    digestInto(t) {
      Bt(this), Ft(t, this), this.finished = true;
      let n = t.subarray(0, this.outputLen);
      this.iHash.digestInto(n), this.oHash.update(n), this.oHash.digestInto(n), this.destroy();
    }
    digest() {
      let t = new Uint8Array(this.oHash.outputLen);
      return this.digestInto(t), t;
    }
    _cloneInto(t) {
      t ||= Object.create(Object.getPrototypeOf(this), {});
      let { oHash: n, iHash: o, finished: r, destroyed: s, blockLen: i, outputLen: c, canXOF: f } = this;
      return t = t, t.finished = r, t.destroyed = s, t.blockLen = i, t.outputLen = c, t.canXOF = f, t.oHash = n._cloneInto(t.oHash), t.iHash = o._cloneInto(t.iHash), t;
    }
    clone() {
      return this._cloneInto();
    }
    destroy() {
      this.destroyed = true, this.oHash.destroy(), this.iHash.destroy();
    }
  };
  var re = (() => {
    let e = ((t, n, o) => new ne(t, n).update(o).digest());
    return e.create = (t, n) => new ne(t, n), e;
  })();
  var It = Uint8Array.of(0);
  var Jr = Uint8Array.of();
  function to(e, t, n, o = 32, r) {
    Ot(e), st(o, "length"), Y(t, void 0, "prk");
    let s = e.outputLen;
    if (t.length < s) throw new Error('"prk" must be at least HashLen octets');
    if (o > 255 * s) throw new Error("Length must be <= 255*HashLen");
    let i = Math.ceil(o / s);
    if (n === void 0 ? n = Jr : Y(n, void 0, "info"), !i) return r && et(t), new Uint8Array();
    let c = r && i === 1 ? t : new Uint8Array(i * s), { iHash: f, oHash: a } = re.create(e, t), d = r ? t : new Uint8Array(s), u = i > 1 ? r?.iHash || e.create() : void 0;
    for (let p = 0; p < i - 1; p++) {
      It[0] = p + 1;
      let x = f._cloneInto(u);
      p && x.update(d), x.update(n).update(It).digestInto(d), a._cloneInto(u).update(d).digestInto(d), c.set(d, s * p);
    }
    if (It[0] = i, i > 1 && f.update(d), f.update(n).update(It).digestInto(d), a.update(d).digestInto(d), c.set(d, s * (i - 1)), f.destroy(), a.destroy(), u?.destroy(), d !== c && et(d), et(It), o === c.length) return c;
    let l = c.slice(0, o);
    return et(c), l;
  }
  var eo = (e, t, n, o, r) => {
    Ot(e), n === void 0 && (n = new Uint8Array(e.outputLen));
    let s = re.create(e, n).update(t);
    return to(e, s.digest(), o, r, s);
  };
  var oe = (e) => Object.freeze(e());
  function Gn(e) {
    return e instanceof Uint8Array || ArrayBuffer.isView(e) && e.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in e && e.BYTES_PER_ELEMENT === 1;
  }
  function Wn(e) {
    if (!Gn(e)) throw new TypeError("Uint8Array expected");
  }
  function no(e, t) {
    return Array.isArray(t) ? t.length === 0 ? true : e ? t.every((n) => typeof n == "string") : t.every((n) => Number.isSafeInteger(n)) : false;
  }
  function ro(e) {
    if (typeof e != "function") throw new TypeError("function expected");
    return true;
  }
  function Re(e, t) {
    if (typeof t != "string") throw new TypeError(`${e}: string expected`);
    return true;
  }
  function ve(e, t = "number") {
    if (typeof e != "number") throw new TypeError(`${t}: expected number, got ${typeof e}`);
    if (!Number.isSafeInteger(e)) throw new RangeError(`${t}: expected safe integer, got ${e}`);
  }
  function qn(e, t) {
    if (!no(false, t)) throw new TypeError(`${e}: array of numbers expected`);
  }
  function Ue(...e) {
    let t = (s) => s, n = (s, i) => (c) => s(i(c)), o = e.map((s) => s.encode).reduceRight(n, t), r = e.map((s) => s.decode).reduce(n, t);
    return { encode: o, decode: r };
  }
  var oo = (() => {
    let e = [];
    for (let t = 0; t < 40; t++) e.push(2 ** t);
    return e;
  })();
  function jn(e, t = e.length) {
    let n = new Array(t);
    for (let o = 0; o < t; o++) n[o] = e[o];
    return n;
  }
  var $n = (() => {
    try {
      let e = new TextDecoder();
      return e.decode(Uint8Array.of(65, 48, 43, 127)) === "A0+\x7F" ? e : void 0;
    } catch {
      return;
    }
  })();
  var Le = 8192;
  function so(e) {
    let t = e.length;
    if ($n !== void 0 && t >= 12) return $n.decode(e);
    if (t <= Le) return String.fromCharCode.apply(null, e);
    let n = "";
    for (let o = 0; o < t; o += Le) n += String.fromCharCode.apply(null, e.subarray(o, o + Le));
    return n;
  }
  function se(e) {
    if (ve(e), e <= 0 || e > 8) throw new RangeError("radix2: bits should be in (0..8]");
    let t = oo[e] - 1;
    return { encode: (n) => {
      Wn(n);
      let o = n.length, r = new Uint8Array(Math.ceil(o * 8 / e)), s = 0, i = 0, c = 0;
      for (let f = 0; f < o; ) for (f + 2 < o ? (s = s << 24 | n[f] << 16 | n[f + 1] << 8 | n[f + 2], i += 24, f += 3) : (s = (s << 8 | n[f]) & 65535, i += 8, f++); i -= e, r[c++] = s >> i & t, !(i < e); ) ;
      return i > 0 && (r[c] = s << e - i & t), r;
    }, decode: (n) => {
      let o = n.length, r = new Uint8Array(Math.floor(o * e / 8)), s = 0, i = 0, c = 0;
      for (let f = 0; f < o; f++) for (s = (s << e | n[f]) & 65535, i += e; i >= 8; i -= 8) r[c++] = s >> i - 8 & 255;
      if (s = s << 8 - i & 255, i >= e) throw new Error("Excess padding");
      if (s > 0) throw new Error(`Non-zero padding: ${s}`);
      return r;
    } };
  }
  function ie(e, t) {
    let n = e.length;
    if (n > 128) throw new Error("alphabet: max 128 letters");
    let o = new Uint8Array(n), r = new Int8Array(128).fill(-1);
    for (let s = 0; s < n; s++) {
      let i = e.charCodeAt(s);
      if (e.codePointAt(s) !== i || i > 127) throw new Error("alphabet: single-char ASCII letters only");
      o[s] = i, r[i] = s;
    }
    if (t !== void 0) for (let s of Object.keys(t)) {
      let i = s.charCodeAt(0), c = r[t[s].charCodeAt(0)];
      if (s.length !== 1 || i > 127 || c === void 0 || c === -1) throw new Error(`alphabet: invalid alias ${s}`);
      r[i] = c;
    }
    return { encode: (s) => {
      let i = new Uint8Array(s.length);
      for (let c = 0; c < s.length; c++) {
        let f = s[c], a = o[f];
        if (a === void 0) throw new Error(`alphabet.encode: invalid digit ${f}`);
        i[c] = a;
      }
      return so(i);
    }, decode: (s) => {
      Re("decode", s);
      let i = s.length, c = new Uint8Array(i);
      for (let f = 0; f < i; f++) {
        let a = s.charCodeAt(f), d = a < 128 ? r[a] : -1;
        if (d === -1) throw new Error(`Unknown letter "${s[f]}". Allowed: ${e}`);
        c[f] = d;
      }
      return c;
    } };
  }
  function zn(e) {
    return ro(e), function(...t) {
      try {
        return e.apply(null, t);
      } catch {
      }
    };
  }
  var io = oe(() => Ue(se(5), ie("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")));
  var co = oe(() => Ue(se(6), ie("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")));
  var fo = oe(() => Ue(se(6), ie("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")));
  var Ie = ie("qpzry9x8gf2tvdw0s3jn54khce6mua7l");
  var ao = /^[\x21-\x60\x7b-\x7e]+$/;
  function Zn(e, t) {
    for (let n = 0; n < t.length; n++) {
      let o = t.charCodeAt(n);
      if (o < 33 || o > 126) throw new Error(`${e}: printable ASCII expected`);
    }
  }
  function uo(e) {
    let t = e.length, n = new Uint8Array(t);
    for (let o = 0; o < t; o++) {
      let r = e[o];
      if (r < 0 || r >= 32) throw new Error(`alphabet.encode: invalid digit ${r}`);
      n[o] = r;
    }
    return n;
  }
  var Pn = [996825010, 642813549, 513874426, 1027748829, 705979059];
  function Ut(e) {
    let t = e >> 25, n = (e & 33554431) << 5;
    for (let o = 0; o < Pn.length; o++) (t >> o & 1) === 1 && (n ^= Pn[o]);
    return n;
  }
  function Yn(e, t, n = 1) {
    let o = e.length, r = 1;
    for (let i = 0; i < o; i++) {
      let c = e.charCodeAt(i);
      if (c < 33 || c > 126) throw new Error(`Invalid prefix (${e})`);
      r = Ut(r) ^ c >> 5;
    }
    r = Ut(r);
    for (let i = 0; i < o; i++) r = Ut(r) ^ e.charCodeAt(i) & 31;
    for (let i of t) r = Ut(r) ^ i;
    for (let i = 0; i < 6; i++) r = Ut(r);
    r ^= n;
    let s = new Uint8Array(6);
    for (let i = 0; i < 6; i++) s[i] = r >>> 5 * (5 - i) & 31;
    return Ie.encode(s);
  }
  function lo(e) {
    let t = e === "bech32" ? 1 : 734539939, n = se(5), o = (u) => {
      Wn(u);
      let l = u.length, p = new Array(Math.ceil(l * 8 / 5)), x = 0, h = 0, y = 0;
      for (let B = 0; B < l; B++) for (x = x << 8 | u[B], h += 8; h >= 5; h -= 5) p[y++] = x >> h - 5 & 31;
      return h > 0 && (p[y] = x << 5 - h & 31), p;
    }, r = (u) => {
      qn("radix2.decode", u);
      let l = u.length, p = new Uint8Array(l);
      for (let x = 0; x < l; x++) {
        let h = u[x];
        if (h < 0 || h >= 32) throw new Error(`convertRadix2: invalid word=${h}`);
        p[x] = h;
      }
      return n.decode(p);
    }, s = zn(r);
    function i(u, l, p = 90) {
      Re("bech32.encode prefix", u), p !== false && ve(p, "limit"), Gn(l) && (l = jn(l)), qn("bech32.encode", l);
      let x = u.length;
      if (x === 0) throw new TypeError(`Invalid prefix length ${x}`);
      let h = x + 7 + l.length;
      if (p !== false && h > p) throw new TypeError(`Length ${h} exceeds limit ${p}`);
      Zn("bech32.encode prefix", u);
      let y = u.toLowerCase(), B = Yn(y, l, t);
      return `${y}1${Ie.encode(uo(l))}${B}`;
    }
    function c(u, l = 90) {
      Re("bech32.decode input", u), l !== false && ve(l, "limit");
      let p = u.length;
      if (p < 8 || l !== false && p > l) throw new TypeError(`invalid string length ${p}, expected (8..${l})`);
      let x = u.toLowerCase();
      if (u !== x && !ao.test(u)) throw Zn("bech32.decode input", u), new Error("mixed-case string not allowed");
      let h = x.lastIndexOf("1");
      if (h === 0 || h === -1) throw new Error('invalid separator "1"');
      let y = x.slice(0, h), B = x.slice(h + 1);
      if (B.length < 6) throw new Error("invalid data length");
      let m = Ie.decode(B), b = jn(m, m.length - 6), A = Yn(y, b, t);
      if (!B.endsWith(A)) throw new Error(`Invalid checksum in ${u}`);
      return { prefix: y, words: b };
    }
    let f = zn(c);
    function a(u, l = 90) {
      let { prefix: p, words: x } = c(u, l);
      return { prefix: p, words: x, bytes: r(x) };
    }
    function d(u, l) {
      return i(u, o(l));
    }
    return { encode: i, decode: c, encodeFromBytes: d, decodeToBytes: a, decodeUnsafe: f, fromWords: r, fromWordsUnsafe: s, toWords: o };
  }
  var ho = oe(() => lo("bech32"));

  // web/age.js
  var CHUNK = 64 * 1024;
  var TAG = 16;
  var CHUNK_CT = CHUNK + TAG;
  var encoder = new TextEncoder();
  var decoder = new TextDecoder();
  var chunkCipher = { seal: (key, nonce, data) => ur(key, nonce).encrypt(data), open: (key, nonce, data) => ur(key, nonce).decrypt(data) };
  var chunkCount = (size) => size === 0 ? 1 : Math.ceil(size / CHUNK);
  var payloadSize = (size) => size + chunkCount(size) * TAG;
  function chunkNonce(i, last) {
    const nonce = new Uint8Array(12);
    let n = i;
    for (let at2 = 10; at2 >= 0 && n > 0; at2--) {
      nonce[at2] = n % 256;
      n = Math.floor(n / 256);
    }
    nonce[11] = last ? 1 : 0;
    return nonce;
  }
  var payloadKey = (fileKey, nonce) => eo(gr, fileKey, nonce, encoder.encode("payload"), 32);
  var openChunk = (key, i, last, ciphertext) => chunkCipher.open(key, chunkNonce(i, last), ciphertext);
  function cipherSpan(payloadAt, size, start, end) {
    const first = Math.floor(start / CHUNK);
    const last = Math.floor(end / CHUNK);
    const total = chunkCount(size);
    return {
      first,
      last,
      final: total - 1,
      from: payloadAt + first * CHUNK_CT,
      to: payloadAt + Math.min((last + 1) * CHUNK_CT, payloadSize(size)) - 1
    };
  }

  // web/seal.js
  var subtle = globalThis.crypto.subtle;
  var encoder2 = new TextEncoder();
  var decoder2 = new TextDecoder();
  var VERSION = "sealed-files/v1";
  var b64 = { encode: (bytes) => fo.encode(bytes), decode: (text) => fo.decode(text) };
  var join = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at2 = 0;
    for (const p of parts) {
      out.set(p, at2);
      at2 += p.length;
    }
    return out;
  };
  async function sealBytes(key, aad, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder2.encode(aad) }, key, bytes));
    return join(iv, ct);
  }
  async function openBytes(key, aad, sealed) {
    if (sealed.length < 28) throw new Error("sealed data too short");
    return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: sealed.subarray(0, 12), additionalData: encoder2.encode(aad) }, key, sealed.subarray(12)));
  }
  var requestAad = (device, time, nonce) => `${VERSION}/request
${device}
${time}
${nonce}`;
  var responseAad = (device, nonce) => `${VERSION}/response
${device}
${nonce}`;
  async function sealRequest(key, device, body, now = Date.now()) {
    const n = b64.encode(crypto.getRandomValues(new Uint8Array(16)));
    const c = b64.encode(await sealBytes(key, requestAad(device, now, n), encoder2.encode(JSON.stringify(body))));
    return { d: device, t: now, n, c };
  }
  async function openResponse(key, device, n, envelope) {
    const plain = await openBytes(key, responseAad(device, n), b64.decode(envelope.c));
    return JSON.parse(decoder2.decode(plain));
  }

  // web/device.js
  var DB_NAME = "sealed-files";
  var STORES = ["device", "meta", "uploads"];
  var subtle2 = globalThis.crypto.subtle;
  var base = (() => {
    const path = globalThis.location?.pathname ?? "/";
    const at2 = path.indexOf("/sealed-files/app/");
    return at2 < 0 ? "/" : path.slice(0, at2 + 1);
  })();
  var api = (path) => `${base}api/sealed-files/${path}`;
  var dbPromise;
  function db() {
    dbPromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }
  function tx(store, mode, run) {
    return db().then((database) => new Promise((resolve, reject) => {
      const t = database.transaction(store, mode);
      const result = run(t.objectStore(store));
      t.oncomplete = () => resolve(result?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  var idb = {
    get: (store, key) => tx(store, "readonly", (s) => s.get(key)),
    put: (store, key, value) => tx(store, "readwrite", (s) => s.put(value, key)),
    delete: (store, key) => tx(store, "readwrite", (s) => s.delete(key)),
    all: (store) => tx(store, "readonly", (s) => s.getAll()),
    keys: (store) => tx(store, "readonly", (s) => s.getAllKeys())
  };
  var loadDevice = () => idb.get("device", "self").then((record) => record ?? null);
  async function call(device, op, args = {}) {
    const envelope = await sealRequest(device.pairKey, device.id, { op, args });
    const response = await fetch(api("call"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope), credentials: "same-origin", cache: "no-store" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw Object.assign(new Error(body.error ?? `HTTP ${response.status}`), { status: response.status, code: body.error });
    }
    const answer2 = await openResponse(device.pairKey, device.id, envelope.n, await response.json());
    if (!answer2.ok) throw Object.assign(new Error(answer2.error), { status: answer2.status, code: answer2.error });
    return answer2.result;
  }

  // web/sw-main.js
  var STREAM = "/sealed-files/app/stream/";
  var INLINE = /^(image\/(png|jpeg|gif|webp|avif|heic|heif|bmp)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf|text\/plain)$/;
  var keys = /* @__PURE__ */ new Map();
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
  self.addEventListener("message", (event) => {
    if (event.data?.type === "forget") keys.clear();
  });
  self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    const at2 = url.pathname.indexOf(STREAM);
    if (at2 < 0 || url.origin !== self.location.origin) return;
    event.respondWith(answer(event.request, url, url.pathname.slice(at2 + STREAM.length).split("/")[0]).catch((error) => new Response(`Could not open this file: ${error.message}`, { status: error.status ?? 500, headers: { "content-type": "text/plain; charset=utf-8" } })));
  });
  async function keyFor(device, id) {
    let entry = keys.get(id);
    if (entry === void 0) {
      const result = await call(device, "key", { id });
      entry = { ...result, key: payloadKey(b64.decode(result.fileKey), b64.decode(result.nonce)) };
      keys.set(id, entry);
    }
    return entry;
  }
  function parseRange(header, size) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
    if (match === null) return null;
    const [, rawStart, rawEnd] = match;
    if (rawStart === "") return rawEnd === "" ? null : [Math.max(0, size - Number(rawEnd)), size - 1];
    return [Number(rawStart), rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1)];
  }
  var disposition = (kind, name) => `${kind}; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  async function answer(request, url, id) {
    const device = await loadDevice();
    if (device === null || device.id === null) throw Object.assign(new Error("this device is not set up"), { status: 403 });
    const entry = await keyFor(device, id);
    const meta = await idb.get("meta", id) ?? {};
    const name = meta.name ?? entry.name;
    const download = url.searchParams.has("download");
    const inline = !download && INLINE.test(entry.type.split(";")[0]);
    const size = entry.size;
    const headers = {
      "content-type": inline ? entry.type.startsWith("text/plain") ? "text/plain; charset=utf-8" : entry.type : "application/octet-stream",
      "content-disposition": disposition(inline ? "inline" : "attachment", name),
      "accept-ranges": "bytes",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    };
    if (inline && !entry.type.startsWith("application/pdf")) headers["content-security-policy"] = "sandbox; default-src 'none'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'unsafe-inline'";
    if (size === 0) return new Response(null, { status: 200, headers: { ...headers, "content-length": "0" } });
    const asked = parseRange(request.headers.get("range"), size);
    if (asked !== null && (asked[0] >= size || asked[1] < asked[0])) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const [start, end] = asked ?? [0, size - 1];
    headers["content-length"] = String(end - start + 1);
    if (asked !== null) headers["content-range"] = `bytes ${start}-${end}/${size}`;
    if (request.method === "HEAD") return new Response(null, { status: asked ? 206 : 200, headers });
    return new Response(plaintext(device, id, entry, start, end), { status: asked ? 206 : 200, headers });
  }
  function plaintext(device, id, entry, start, end) {
    const span = cipherSpan(entry.payloadAt, entry.size, start, end);
    let reader;
    let buffer = new Uint8Array(0);
    let index = span.first;
    const take = (controller, chunk) => {
      const plain = openChunk(entry.key, index, index === span.final, chunk);
      const from = index === span.first ? start - index * CHUNK : 0;
      const to2 = index === span.last ? end - index * CHUNK + 1 : plain.length;
      controller.enqueue(plain.subarray(from, to2));
      index++;
    };
    return new ReadableStream({
      async start() {
        const response = await fetch(`${api("blob")}?d=${device.id}&id=${id}`, { headers: { range: `bytes=${span.from}-${span.to}` }, credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        reader = response.body.getReader();
      },
      async pull(controller) {
        for (; ; ) {
          const whole = index === span.final ? null : CHUNK_CT;
          if (whole !== null && buffer.length >= whole) {
            take(controller, buffer.subarray(0, whole));
            buffer = buffer.subarray(whole);
            if (index > span.last) {
              controller.close();
              reader.cancel().catch(() => {
              });
            }
            return;
          }
          const { value, done } = await reader.read();
          if (done) {
            if (index === span.final && index <= span.last) take(controller, buffer);
            else if (index <= span.last) throw new Error("file ended early");
            controller.close();
            return;
          }
          const joined = new Uint8Array(buffer.length + value.length);
          joined.set(buffer);
          joined.set(value, buffer.length);
          buffer = joined;
        }
      },
      cancel() {
        reader?.cancel().catch(() => {
        });
      }
    });
  }
})();
/*! Bundled license information:

@noble/ciphers/utils.js:
  (*! noble-ciphers - MIT License (c) 2023 Paul Miller (paulmillr.com) *)

@noble/curves/utils.js:
@noble/curves/abstract/modular.js:
@noble/curves/abstract/curve.js:
@noble/curves/abstract/edwards.js:
@noble/curves/abstract/montgomery.js:
@noble/curves/ed25519.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@scure/base/index.js:
  (*! scure-base - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
