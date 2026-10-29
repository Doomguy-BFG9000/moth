// fdlibm's constants are written as fdlibm writes them, and its `x - x` makes NaN on purpose
#![allow(clippy::excessive_precision, clippy::eq_op, clippy::needless_range_loop)]
// Numbers exactly as JavaScript has them: Moth's numbers are 64-bit floats, and every engine must show,
// round and draw them alike, so this engine does what V8 does, bit for bit.

// ---------- showing a number: Number.prototype.toString ----------

// The shortest digits that read back as `x` (a positive, finite number), and where the decimal point goes:
// x = 0.digits * 10^point. Rust's `{:e}` gives the shortest digits that read back, and the closest of them,
// as JavaScript does, but where two are exactly as close it takes the higher, and JavaScript the even one.
fn digits(x: f64) -> (String, i32) {
    let (s, n) = split(&format!("{:e}", x));
    // Two equally close candidates both read back only when they're 16 or 17 digits long: with fewer, the
    // gap between candidates is wider than all the numbers that read back as x.
    if s.len() < 16 && x >= f64::MIN_POSITIVE {
        return (s, n);
    }
    for step in [-1i32, 1] {
        let Some(other) = neighbour(&s, step) else { continue };
        if format!("0.{other}e{n}").parse::<f64>() != Ok(x) {
            continue; // the other one doesn't read back as x, so it can't be a tie
        }
        let lower = if step < 0 { &other } else { &s };
        if tie(x, lower, n) && other.ends_with(['0', '2', '4', '6', '8']) {
            return (other, n);
        }
    }
    (s, n)
}

// "1.2345e-7" as ("12345", -6)
fn split(e: &str) -> (String, i32) {
    let (mantissa, exp) = e.split_once('e').unwrap();
    (mantissa.chars().filter(|c| *c != '.').collect(), exp.parse::<i32>().unwrap() + 1)
}

// the digits one more or one less in the last place, if that keeps how many there are
fn neighbour(s: &str, step: i32) -> Option<String> {
    let mut d: Vec<u8> = s.bytes().map(|b| b - b'0').collect();
    let mut i = d.len();
    loop {
        if i == 0 {
            return None;
        }
        i -= 1;
        let v = d[i] as i32 + step;
        if (0..=9).contains(&v) {
            d[i] = v as u8;
            break;
        }
        d[i] = if step > 0 { 0 } else { 9 };
    }
    if d[0] == 0 {
        return None;
    }
    Some(d.iter().map(|v| (v + b'0') as char).collect())
}

// whether x is exactly halfway between `lower` and the digits one above it (at the same point)
fn tie(x: f64, lower: &str, n: i32) -> bool {
    let (exact, point) = split(&format!("{:.800e}", x)); // every digit a double has
    let k = lower.len();
    point == n && &exact[..k] == lower && exact.as_bytes()[k] == b'5' && exact[k + 1..].bytes().all(|b| b == b'0')
}

// String(x) for a number, by the steps of the JavaScript spec (Number::toString)
pub fn show(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x == 0.0 {
        return "0".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if x.fract() == 0.0 && x.abs() < 9007199254740992.0 {
        return (x as i64).to_string(); // a whole number that fits: as it is
    }
    if x < 0.0 {
        return format!("-{}", show(-x));
    }
    let (s, n) = digits(x);
    let k = s.len() as i32;
    if k <= n && n <= 21 {
        return format!("{}{}", s, "0".repeat((n - k) as usize));
    }
    if 0 < n && n <= 21 {
        return format!("{}.{}", &s[..n as usize], &s[n as usize..]);
    }
    if -6 < n && n <= 0 {
        return format!("0.{}{}", "0".repeat((-n) as usize), s);
    }
    let e = n - 1;
    let sign = if e < 0 { '-' } else { '+' };
    if k == 1 {
        format!("{}e{}{}", s, sign, e.abs())
    } else {
        format!("{}.{}e{}{}", &s[..1], &s[1..], sign, e.abs())
    }
}

// (n).toLocaleString("en") for the whole numbers Moth shows that way: steps and counts, with commas
pub fn grouped(n: f64) -> String {
    let text = show(n);
    if !n.is_finite() || n.fract() != 0.0 || text.contains('e') {
        return text;
    }
    let (sign, digits) = if let Some(rest) = text.strip_prefix('-') { ("-", rest) } else { ("", text.as_str()) };
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    format!("{sign}{out}")
}

// n.toString(radix) for a whole number from 0 to 2^53 - 1
pub fn radix(n: f64, radix: u32) -> String {
    let mut v = n as u64;
    if v == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while v > 0 {
        out.push(std::char::from_digit((v % radix as u64) as u32, radix).unwrap());
        v /= radix as u64;
    }
    out.iter().rev().collect()
}

// Math.round: the closest whole number, halves going up (towards +infinity), -0 kept
pub fn round(x: f64) -> f64 {
    if !x.is_finite() || x == 0.0 {
        return x;
    }
    let r = x.floor();
    let v = if x - r >= 0.5 { r + 1.0 } else { r };
    if v == 0.0 && x < 0.0 {
        -0.0
    } else {
        v
    }
}

// Number.isInteger
pub fn is_integer(x: f64) -> bool {
    x.is_finite() && x.floor() == x
}

// 2 ** n for a whole n of 0 or more: exact, and Infinity once it's too big
pub fn power_of_two(n: f64) -> f64 {
    if n > 1023.0 {
        f64::INFINITY
    } else {
        f64::from_bits(((n as u64) + 1023) << 52)
    }
}

// ---------- sine and cosine: V8's Math.sin and Math.cos (fdlibm) ----------

fn high(x: f64) -> i32 {
    (x.to_bits() >> 32) as i32
}
fn low(x: f64) -> u32 {
    x.to_bits() as u32
}
fn from_words(hi: i32, lo: u32) -> f64 {
    f64::from_bits(((hi as u32 as u64) << 32) | lo as u64)
}
fn scalbn(x: f64, n: i32) -> f64 {
    // the values here are never near the edges, so multiplying by an exact power of two is the same
    let mut x = x;
    let mut n = n;
    while n > 1023 {
        x *= f64::from_bits(2046u64 << 52);
        n -= 1023;
    }
    while n < -1022 {
        x *= f64::from_bits(1u64 << 52);
        n += 1022;
    }
    x * f64::from_bits(((n + 1023) as u64) << 52)
}

const S1: f64 = -1.66666666666666324348e-01;
const S2: f64 = 8.33333333332248946124e-03;
const S3: f64 = -1.98412698298579493134e-04;
const S4: f64 = 2.75573137070700676789e-06;
const S5: f64 = -2.50507602534068634195e-08;
const S6: f64 = 1.58969099521155010221e-10;

fn kernel_sin(x: f64, y: f64, iy: i32) -> f64 {
    let ix = high(x) & 0x7FFF_FFFF;
    if ix < 0x3E40_0000 && x as i32 == 0 {
        return x;
    }
    let z = x * x;
    let v = z * x;
    let r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
    if iy == 0 {
        x + v * (S1 + z * r)
    } else {
        x - ((z * (0.5 * y - v * r) - y) - v * S1)
    }
}

const C1: f64 = 4.16666666666666019037e-02;
const C2: f64 = -1.38888888888741095749e-03;
const C3: f64 = 2.48015872894767294178e-05;
const C4: f64 = -2.75573143513906633035e-07;
const C5: f64 = 2.08757232129817482790e-09;
const C6: f64 = -1.13596475577881948265e-11;

fn kernel_cos(x: f64, y: f64) -> f64 {
    let ix = high(x) & 0x7FFF_FFFF;
    if ix < 0x3E40_0000 && x as i32 == 0 {
        return 1.0;
    }
    let z = x * x;
    let r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
    if ix < 0x3FD3_3333 {
        1.0 - (0.5 * z - (z * r - x * y))
    } else {
        let qx = if ix > 0x3FE9_0000 { 0.28125 } else { from_words(ix - 0x0020_0000, 0) };
        let iz = 0.5 * z - qx;
        let a = 1.0 - qx;
        a - (iz - (z * r - x * y))
    }
}

const TWO_OVER_PI: [i32; 66] = [
    0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62, 0x95993C, 0x439041, 0xFE5163, 0xABDEBB, 0xC561B7, 0x246E3A, 0x424DD2,
    0xE00649, 0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129, 0xA73EE8, 0x8235F5, 0x2EBB44, 0x84E99C, 0x7026B4, 0x5F7E41, 0x3991D6, 0x398353,
    0x39F49C, 0x845F8B, 0xBDF928, 0x3B1FF8, 0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D, 0x367ECF, 0x27CB09, 0xB74F46, 0x3F669E,
    0x5FEA2D, 0x7527BA, 0xC7EBE5, 0xF17B3D, 0x0739F7, 0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08, 0x560330, 0x46FC7B, 0x6BABF0, 0xCFBC20,
    0x9AF436, 0x1DA9E3, 0x91615E, 0xE61B08, 0x659985, 0x5F14A0, 0x68408D, 0xFFD880, 0x4D7327, 0x310606, 0x1556CA, 0x73A8C9, 0x60E27B,
    0xC08C6B,
];
const NPIO2_HW: [i32; 32] = [
    0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A, 0x4031475C,
    0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C,
    0x4042106C, 0x4042D97C, 0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB,
];
const PIO2: [f64; 8] = [
    1.57079625129699707031e+00,
    7.54978941586159635335e-08,
    5.39030252995776476554e-15,
    3.28200341580791294123e-22,
    1.27065575308067607349e-29,
    1.22933308981111328932e-36,
    2.73370053816464559624e-44,
    2.16741683877804819444e-51,
];
const TWO24: f64 = 1.67772160000000000000e+07;
const TWON24: f64 = 5.96046447753906250000e-08;

fn kernel_rem_pio2(x: &[f64; 3], y: &mut [f64; 2], e0: i32, nx: usize) -> i32 {
    let jk: i32 = 4; // init_jk[prec] for prec 2
    let jp = jk;
    let jx = nx as i32 - 1;
    let mut jv = (e0 - 3) / 24;
    if jv < 0 {
        jv = 0;
    }
    let mut q0 = e0 - 24 * (jv + 1);
    let mut f = [0f64; 20];
    let mut q = [0f64; 20];
    let mut fq = [0f64; 20];
    let mut iq = [0i32; 20];
    let mut j = jv - jx;
    let m = jx + jk;
    for i in 0..=m {
        f[i as usize] = if j < 0 { 0.0 } else { TWO_OVER_PI[j as usize] as f64 };
        j += 1;
    }
    for i in 0..=jk {
        let mut fw = 0.0;
        for j in 0..=jx {
            fw += x[j as usize] * f[(jx + i - j) as usize];
        }
        q[i as usize] = fw;
    }
    let mut jz = jk;
    let (mut z, mut n, mut ih);
    loop {
        // distill q[] into iq[] reversingly
        let mut i = 0usize;
        let mut j = jz;
        z = q[jz as usize];
        while j > 0 {
            let fw = ((TWON24 * z) as i32) as f64;
            iq[i] = (z - TWO24 * fw) as i32;
            z = q[(j - 1) as usize] + fw;
            i += 1;
            j -= 1;
        }
        z = scalbn(z, q0);
        z -= 8.0 * (z * 0.125).floor();
        n = z as i32;
        z -= n as f64;
        ih = 0;
        if q0 > 0 {
            let i = iq[(jz - 1) as usize] >> (24 - q0);
            n += i;
            iq[(jz - 1) as usize] -= i << (24 - q0);
            ih = iq[(jz - 1) as usize] >> (23 - q0);
        } else if q0 == 0 {
            ih = iq[(jz - 1) as usize] >> 23;
        } else if z >= 0.5 {
            ih = 2;
        }
        if ih > 0 {
            n += 1;
            let mut carry = 0;
            for i in 0..jz as usize {
                let j = iq[i];
                if carry == 0 {
                    if j != 0 {
                        carry = 1;
                        iq[i] = 0x100_0000 - j;
                    }
                } else {
                    iq[i] = 0xFF_FFFF - j;
                }
            }
            if q0 > 0 {
                match q0 {
                    1 => iq[(jz - 1) as usize] &= 0x7F_FFFF,
                    2 => iq[(jz - 1) as usize] &= 0x3F_FFFF,
                    _ => {}
                }
            }
            if ih == 2 {
                z = 1.0 - z;
                if carry != 0 {
                    z -= scalbn(1.0, q0);
                }
            }
        }
        if z == 0.0 {
            let mut j = 0;
            let mut i = jz - 1;
            while i >= jk {
                j |= iq[i as usize];
                i -= 1;
            }
            if j == 0 {
                let mut k = 1;
                while jk >= k && iq[(jk - k) as usize] == 0 {
                    k += 1;
                }
                for i in (jz + 1)..=(jz + k) {
                    f[(jx + i) as usize] = TWO_OVER_PI[(jv + i) as usize] as f64;
                    let mut fw = 0.0;
                    for j in 0..=jx {
                        fw += x[j as usize] * f[(jx + i - j) as usize];
                    }
                    q[i as usize] = fw;
                }
                jz += k;
                continue;
            }
        }
        break;
    }
    if z == 0.0 {
        jz -= 1;
        q0 -= 24;
        while iq[jz as usize] == 0 {
            jz -= 1;
            q0 -= 24;
        }
    } else {
        z = scalbn(z, -q0);
        if z >= TWO24 {
            let fw = ((TWON24 * z) as i32) as f64;
            iq[jz as usize] = (z - TWO24 * fw) as i32;
            jz += 1;
            q0 += 24;
            iq[jz as usize] = fw as i32;
        } else {
            iq[jz as usize] = z as i32;
        }
    }
    let mut fw = scalbn(1.0, q0);
    let mut i = jz;
    while i >= 0 {
        q[i as usize] = fw * iq[i as usize] as f64;
        fw *= TWON24;
        i -= 1;
    }
    let mut i = jz;
    while i >= 0 {
        let mut fw = 0.0;
        let mut k = 0;
        while k <= jp && k <= jz - i {
            fw += PIO2[k as usize] * q[(i + k) as usize];
            k += 1;
        }
        fq[(jz - i) as usize] = fw;
        i -= 1;
    }
    let mut fw = 0.0;
    let mut i = jz;
    while i >= 0 {
        fw += fq[i as usize];
        i -= 1;
    }
    y[0] = if ih == 0 { fw } else { -fw };
    fw = fq[0] - fw;
    for i in 1..=jz {
        fw += fq[i as usize];
    }
    y[1] = if ih == 0 { fw } else { -fw };
    n & 7
}

const INVPIO2: f64 = 6.36619772367581382433e-01;
const PIO2_1: f64 = 1.57079632673412561417e+00;
const PIO2_1T: f64 = 6.07710050650619224932e-11;
const PIO2_2: f64 = 6.07710050630396597660e-11;
const PIO2_2T: f64 = 2.02226624879595063154e-21;
const PIO2_3: f64 = 2.02226624871116645580e-21;
const PIO2_3T: f64 = 8.47842766036889956997e-32;

fn rem_pio2(x: f64, y: &mut [f64; 2]) -> i32 {
    let hx = high(x);
    let ix = hx & 0x7FFF_FFFF;
    if ix <= 0x3FE9_21FB {
        y[0] = x;
        y[1] = 0.0;
        return 0;
    }
    if ix < 0x4002_D97C {
        if hx > 0 {
            let mut z = x - PIO2_1;
            if ix != 0x3FF9_21FB {
                y[0] = z - PIO2_1T;
                y[1] = (z - y[0]) - PIO2_1T;
            } else {
                z -= PIO2_2;
                y[0] = z - PIO2_2T;
                y[1] = (z - y[0]) - PIO2_2T;
            }
            return 1;
        } else {
            let mut z = x + PIO2_1;
            if ix != 0x3FF9_21FB {
                y[0] = z + PIO2_1T;
                y[1] = (z - y[0]) + PIO2_1T;
            } else {
                z += PIO2_2;
                y[0] = z + PIO2_2T;
                y[1] = (z - y[0]) + PIO2_2T;
            }
            return -1;
        }
    }
    if ix <= 0x4139_21FB {
        let t = x.abs();
        let n = (t * INVPIO2 + 0.5) as i32;
        let f = n as f64;
        let mut r = t - f * PIO2_1;
        let mut w = f * PIO2_1T;
        if n < 32 && ix != NPIO2_HW[(n - 1) as usize] {
            y[0] = r - w;
        } else {
            let j = ix >> 20;
            y[0] = r - w;
            let mut i = j - ((high(y[0]) >> 20) & 0x7FF);
            if i > 16 {
                let t = r;
                w = f * PIO2_2;
                r = t - w;
                w = f * PIO2_2T - ((t - r) - w);
                y[0] = r - w;
                i = j - ((high(y[0]) >> 20) & 0x7FF);
                if i > 49 {
                    let t = r;
                    w = f * PIO2_3;
                    r = t - w;
                    w = f * PIO2_3T - ((t - r) - w);
                    y[0] = r - w;
                }
            }
        }
        y[1] = (r - y[0]) - w;
        if hx < 0 {
            y[0] = -y[0];
            y[1] = -y[1];
            return -n;
        }
        return n;
    }
    if ix >= 0x7FF0_0000 {
        y[0] = x - x;
        y[1] = y[0];
        return 0;
    }
    // large arguments: z = scalbn(|x|, ilogb(x) - 23)
    let e0 = (ix >> 20) - 1046;
    let mut z = from_words(ix - (e0 << 20), low(x));
    let mut tx = [0f64; 3];
    for t in tx.iter_mut().take(2) {
        *t = (z as i32) as f64;
        z = (z - *t) * TWO24;
    }
    tx[2] = z;
    let mut nx = 3;
    while tx[nx - 1] == 0.0 {
        nx -= 1;
    }
    let n = kernel_rem_pio2(&tx, y, e0, nx);
    if hx < 0 {
        y[0] = -y[0];
        y[1] = -y[1];
        return -n;
    }
    n
}

pub fn sin(x: f64) -> f64 {
    let ix = high(x) & 0x7FFF_FFFF;
    if ix <= 0x3FE9_21FB {
        return kernel_sin(x, 0.0, 0);
    }
    if ix >= 0x7FF0_0000 {
        return x - x;
    }
    let mut y = [0f64; 2];
    match rem_pio2(x, &mut y) & 3 {
        0 => kernel_sin(y[0], y[1], 1),
        1 => kernel_cos(y[0], y[1]),
        2 => -kernel_sin(y[0], y[1], 1),
        _ => -kernel_cos(y[0], y[1]),
    }
}

pub fn cos(x: f64) -> f64 {
    let ix = high(x) & 0x7FFF_FFFF;
    if ix <= 0x3FE9_21FB {
        return kernel_cos(x, 0.0);
    }
    if ix >= 0x7FF0_0000 {
        return x - x;
    }
    let mut y = [0f64; 2];
    match rem_pio2(x, &mut y) & 3 {
        0 => kernel_cos(y[0], y[1]),
        1 => -kernel_sin(y[0], y[1], 1),
        2 => -kernel_cos(y[0], y[1]),
        _ => kernel_sin(y[0], y[1], 1),
    }
}
