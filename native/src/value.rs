// Moth's values, and what vm.js does with them that doesn't need the machine: showing, comparing, kinds.
use crate::compiler::Function;
use crate::num;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::rc::Rc;

#[derive(Clone)]
pub enum Value {
    Nothing,
    Bool(bool),
    Num(f64),
    Text(Rc<str>),
    List(Rc<RefCell<Vec<Value>>>),
    Record(Rc<RefCell<Record>>),
    Dict(Rc<RefCell<Dict>>),
    Bytes(Rc<RefCell<Vec<u8>>>),
    Func(Rc<Closure>),
    Qty(f64, u8),            // an amount of a unit, by its place in UNITS: 5 km
    Unset,                   // a variable that is declared but hasn't been given a value yet
    Iter(Rc<RefCell<Iter>>), // what `for each` goes through, on the stack while it runs
}

impl fmt::Debug for Value {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", show(self, true))
    }
}

pub struct Closure {
    pub func: Rc<Function>,
    pub env: Rc<Env>,
}

// A function's variables: slot 0 is the scope it was made in, then its inputs, then the rest
pub struct Env {
    pub parent: Option<Rc<Env>>,
    pub slots: RefCell<Vec<Value>>,
}

pub struct Iter {
    pub items: Vec<Value>,
    pub i: usize,
}

// ---------- amounts with units: 5 km, 2 hours, 300 g (vm.js's UNITS, in the same order) ----------

pub const MEASURES: [&str; 4] = ["a distance", "a time", "a weight", "a volume"];
// each unit: how it is written for one and for many, what it measures, and how many of that measure's base
// unit (a metre, a second, a gram, a litre) it is
pub const UNITS: [(&str, &str, u8, f64); 36] = [
    ("mm", "mm", 0, 0.001),
    ("cm", "cm", 0, 0.01),
    ("m", "m", 0, 1.0),
    ("km", "km", 0, 1000.0),
    ("millimetre", "millimetres", 0, 0.001),
    ("centimetre", "centimetres", 0, 0.01),
    ("metre", "metres", 0, 1.0),
    ("kilometre", "kilometres", 0, 1000.0),
    ("millimeter", "millimeters", 0, 0.001),
    ("centimeter", "centimeters", 0, 0.01),
    ("meter", "meters", 0, 1.0),
    ("kilometer", "kilometers", 0, 1000.0),
    ("inch", "inches", 0, 0.0254),
    ("foot", "feet", 0, 0.3048),
    ("yard", "yards", 0, 0.9144),
    ("mile", "miles", 0, 1609.344),
    ("millisecond", "milliseconds", 1, 0.001),
    ("second", "seconds", 1, 1.0),
    ("minute", "minutes", 1, 60.0),
    ("hour", "hours", 1, 3600.0),
    ("day", "days", 1, 86400.0),
    ("week", "weeks", 1, 604800.0),
    ("mg", "mg", 2, 0.001),
    ("g", "g", 2, 1.0),
    ("kg", "kg", 2, 1000.0),
    ("milligram", "milligrams", 2, 0.001),
    ("gram", "grams", 2, 1.0),
    ("kilogram", "kilograms", 2, 1000.0),
    ("ounce", "ounces", 2, 28.349523125),
    ("pound", "pounds", 2, 453.59237),
    ("tonne", "tonnes", 2, 1000000.0),
    ("ml", "ml", 3, 0.001),
    ("millilitre", "millilitres", 3, 0.001),
    ("litre", "litres", 3, 1.0),
    ("milliliter", "milliliters", 3, 0.001),
    ("liter", "liters", 3, 1.0),
];

// a unit's place in UNITS, by either way it is written
pub fn unit_named(w: &str) -> Option<u8> {
    UNITS.iter().position(|u| u.0 == w || u.1 == w).map(|i| i as u8)
}
pub fn measure_of(unit: u8) -> u8 {
    UNITS[unit as usize].2
}
// an amount of one unit in another that measures the same: 5 (km) is 5000 (m)
pub fn amount_in(amount: f64, from: u8, to: u8) -> f64 {
    if from == to {
        amount
    } else {
        amount * UNITS[from as usize].3 / UNITS[to as usize].3
    }
}

pub fn text(s: &str) -> Value {
    Value::Text(Rc::from(s))
}
pub fn list(items: Vec<Value>) -> Value {
    Value::List(Rc::new(RefCell::new(items)))
}

// ---------- records: fields in the order they were added ----------

#[derive(Default)]
pub struct Record {
    pub fields: Vec<(Rc<str>, Value)>,
}

impl Record {
    pub fn get(&self, name: &str) -> Option<&Value> {
        self.fields.iter().find(|(n, _)| &**n == name).map(|(_, v)| v)
    }
    pub fn set(&mut self, name: Rc<str>, value: Value) {
        match self.fields.iter_mut().find(|(n, _)| *n == name) {
            Some(slot) => slot.1 = value,
            None => self.fields.push((name, value)),
        }
    }
}

// ---------- dictionaries: JavaScript Maps, keyed by text or numbers, in the order keys were added ----------

#[derive(Clone, PartialEq, Eq, Hash)]
pub enum Key {
    Num(u64), // the number's bits, with -0 as 0 and every NaN as one, as a Map sees them
    Text(Rc<str>),
}

impl Key {
    pub fn of(v: &Value) -> Option<Key> {
        match v {
            Value::Num(n) => Some(Key::Num(if *n == 0.0 {
                0
            } else if n.is_nan() {
                f64::NAN.to_bits()
            } else {
                num::canon(*n).to_bits() // to 15 digits: 0.1 + 0.2 finds the key 0.3
            })),
            Value::Text(t) => Some(Key::Text(t.clone())),
            _ => None,
        }
    }
    pub fn value(&self) -> Value {
        match self {
            Key::Num(b) => Value::Num(f64::from_bits(*b)),
            Key::Text(t) => Value::Text(t.clone()),
        }
    }
}

#[derive(Default)]
pub struct Dict {
    entries: Vec<Option<(Key, Value)>>,
    index: FastMap<Key, usize>,
}

impl Dict {
    pub fn len(&self) -> usize {
        self.index.len()
    }
    pub fn has(&self, k: &Key) -> bool {
        self.index.contains_key(k)
    }
    pub fn get(&self, k: &Key) -> Option<Value> {
        self.index.get(k).map(|&i| self.entries[i].as_ref().unwrap().1.clone())
    }
    pub fn set(&mut self, k: Key, v: Value) {
        match self.index.get(&k) {
            Some(&i) => self.entries[i].as_mut().unwrap().1 = v,
            None => {
                self.index.insert(k.clone(), self.entries.len());
                self.entries.push(Some((k, v)));
            }
        }
    }
    pub fn remove(&mut self, k: &Key) {
        if let Some(i) = self.index.remove(k) {
            self.entries[i] = None;
            if self.entries.len() > 32 && self.index.len() * 2 < self.entries.len() {
                self.entries.retain(|e| e.is_some());
                for (i, e) in self.entries.iter().enumerate() {
                    self.index.insert(e.as_ref().unwrap().0.clone(), i);
                }
            }
        }
    }
    pub fn keys(&self) -> Vec<Key> {
        self.entries.iter().flatten().map(|(k, _)| k.clone()).collect()
    }
    pub fn entries(&self) -> Vec<(Key, Value)> {
        self.entries.iter().flatten().cloned().collect()
    }
}

// ---------- kinds, truth, showing ----------

pub fn kind_of(v: &Value) -> &'static str {
    match v {
        Value::Nothing => "nothing",
        Value::Bool(_) => "yes/no",
        Value::Text(_) => "text",
        Value::List(_) => "a list",
        Value::Func(_) => "a function",
        Value::Record(_) => "a record",
        Value::Dict(_) => "a dictionary",
        Value::Bytes(_) => "bytes",
        Value::Qty(_, u) => MEASURES[measure_of(*u) as usize],
        _ => "a number",
    }
}

pub fn truthy(v: &Value) -> bool {
    !matches!(v, Value::Nothing | Value::Bool(false))
}

pub fn plural(n: usize, word: &str) -> String {
    format!("{n} {word}{}", if n == 1 { "" } else { "s" })
}

// JSON.stringify of text
pub fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

// How deep a value may hold values before showing or comparing it gives up: JavaScript gives up somewhere
// past 1,000 levels; this engine goes at least as far.
pub const MAX_DEPTH: usize = if cfg!(target_family = "wasm") { 1_000 } else { 100_000 }; // a WebAssembly runtime's stack is smaller

pub struct TooBig; // a value too big (or too deep) to show

fn address(v: &Value) -> usize {
    match v {
        Value::List(l) => Rc::as_ptr(l) as *const u8 as usize,
        Value::Record(r) => Rc::as_ptr(r) as *const u8 as usize,
        Value::Dict(d) => Rc::as_ptr(d) as *const u8 as usize,
        _ => 0,
    }
}

// `say` shows a value this way; `nested` shows text in quotes, as inside a list. A list that holds itself shows
// as [...] where it comes round again, a record or dictionary as (...).
pub fn show(v: &Value, nested: bool) -> String {
    let mut out = String::new();
    let _ = show_into(v, nested, &mut HashSet::new(), &mut out, 0);
    out
}

pub fn try_show(v: &Value, nested: bool) -> Result<String, TooBig> {
    let mut out = String::new();
    show_into(v, nested, &mut HashSet::new(), &mut out, 0)?;
    Ok(out)
}

fn show_into(v: &Value, nested: bool, showing: &mut HashSet<usize>, out: &mut String, depth: usize) -> Result<(), TooBig> {
    if depth > MAX_DEPTH {
        return Err(TooBig);
    }
    match v {
        Value::Nothing => out.push_str("nothing"),
        Value::Bool(b) => out.push_str(if *b { "yes" } else { "no" }),
        Value::Text(t) => {
            if nested {
                out.push_str(&json_string(t))
            } else {
                out.push_str(t)
            }
        }
        Value::Num(n) => out.push_str(&num::display(*n)), // to 15 digits
        Value::Qty(n, u) => {
            let (one, many, _, _) = UNITS[*u as usize];
            out.push_str(&format!("{} {}", num::display(*n), if num::canon(*n).abs() == 1.0 { one } else { many })); // 1 mile, 2 miles
        }
        Value::Func(c) => out.push_str(&format!("<function {}>", c.func.name)),
        Value::Bytes(b) => {
            let b = b.borrow();
            out.push('(');
            out.push_str(&plural(b.len(), "byte"));
            if !b.is_empty() {
                out.push_str(": ");
                for (i, x) in b.iter().enumerate() {
                    if i > 0 {
                        out.push_str(", ");
                    }
                    out.push_str(&x.to_string());
                }
            }
            out.push(')');
        }
        Value::List(_) | Value::Record(_) | Value::Dict(_) => {
            let me = address(v);
            if showing.contains(&me) {
                out.push_str(if matches!(v, Value::List(_)) { "[...]" } else { "(...)" });
                return Ok(());
            }
            showing.insert(me);
            match v {
                Value::List(l) => {
                    out.push('[');
                    let items = l.borrow().clone();
                    for (i, x) in items.iter().enumerate() {
                        if i > 0 {
                            out.push_str(", ");
                        }
                        show_into(x, true, showing, out, depth + 1)?;
                    }
                    out.push(']');
                }
                Value::Record(r) => {
                    let fields = r.borrow().fields.clone();
                    if fields.is_empty() {
                        out.push_str("(empty record)");
                    } else {
                        out.push_str("(record with ");
                        for (i, (f, x)) in fields.iter().enumerate() {
                            if i > 0 {
                                out.push_str(", ");
                            }
                            out.push_str(f);
                            out.push(' ');
                            show_into(x, true, showing, out, depth + 1)?;
                        }
                        out.push(')');
                    }
                }
                Value::Dict(d) => {
                    let entries = d.borrow().entries();
                    if entries.is_empty() {
                        out.push_str("(empty dictionary)");
                    } else {
                        out.push_str("(dictionary where ");
                        for (i, (k, x)) in entries.iter().enumerate() {
                            if i > 0 {
                                out.push_str(", ");
                            }
                            show_into(&k.value(), true, showing, out, depth + 1)?;
                            out.push_str(" is ");
                            show_into(x, true, showing, out, depth + 1)?;
                        }
                        out.push(')');
                    }
                }
                _ => unreachable!(),
            }
            showing.remove(&me); // the same value twice side by side, not inside itself, shows in full both times
        }
        Value::Unset | Value::Iter(_) => out.push_str("<internal>"),
    }
    Ok(())
}

// ---------- equality: `is` ----------

// `comparing` holds the pairs being compared further up: a list that holds itself comes round to the same pair
// again, which counts as equal so far, instead of going round for ever.
pub fn equal(a: &Value, b: &Value) -> Result<bool, TooBig> {
    equal_in(a, b, &mut HashSet::new(), 0)
}

fn same_object(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::List(x), Value::List(y)) => Rc::ptr_eq(x, y),
        (Value::Record(x), Value::Record(y)) => Rc::ptr_eq(x, y),
        (Value::Dict(x), Value::Dict(y)) => Rc::ptr_eq(x, y),
        (Value::Bytes(x), Value::Bytes(y)) => Rc::ptr_eq(x, y),
        (Value::Func(x), Value::Func(y)) => Rc::ptr_eq(x, y),
        _ => false,
    }
}

fn equal_in(a: &Value, b: &Value, comparing: &mut HashSet<(usize, usize)>, depth: usize) -> Result<bool, TooBig> {
    if depth > MAX_DEPTH {
        return Err(TooBig);
    }
    match (a, b) {
        (Value::Nothing, Value::Nothing) => return Ok(true),
        (Value::Bool(x), Value::Bool(y)) => return Ok(x == y),
        (Value::Num(x), Value::Num(y)) => return Ok(num::order(*x, *y) == Some(std::cmp::Ordering::Equal)), // to 15 digits
        (Value::Text(x), Value::Text(y)) => return Ok(x == y),
        (Value::Qty(x, u), Value::Qty(y, v)) => {
            // 1 km is 1000 m
            return Ok(measure_of(*u) == measure_of(*v) && num::order(*x, amount_in(*y, *v, *u)) == Some(std::cmp::Ordering::Equal));
        }
        (Value::Qty(..), _) | (_, Value::Qty(..)) => return Ok(false),
        _ => {}
    }
    if same_object(a, b) {
        return Ok(true);
    }
    if let (Value::Bytes(x), Value::Bytes(y)) = (a, b) {
        return Ok(*x.borrow() == *y.borrow());
    }
    let pair = (address(a), address(b));
    let same = match (a, b) {
        (Value::List(x), Value::List(y)) => {
            if comparing.contains(&pair) {
                return Ok(true);
            }
            comparing.insert(pair);
            let (x, y) = (x.borrow().clone(), y.borrow().clone());
            let mut same = x.len() == y.len();
            if same {
                for (p, q) in x.iter().zip(y.iter()) {
                    if !equal_in(p, q, comparing, depth + 1)? {
                        same = false;
                        break;
                    }
                }
            }
            same
        }
        (Value::Dict(x), Value::Dict(y)) => {
            if comparing.contains(&pair) {
                return Ok(true);
            }
            comparing.insert(pair);
            let (ex, yd) = (x.borrow().entries(), y.clone());
            let mut same = ex.len() == yd.borrow().len();
            if same {
                for (k, v) in ex.iter() {
                    let other = yd.borrow().get(k);
                    match other {
                        Some(w) if equal_in(v, &w, comparing, depth + 1)? => {}
                        _ => {
                            same = false;
                            break;
                        }
                    }
                }
            }
            same
        }
        (Value::Record(x), Value::Record(y)) => {
            if comparing.contains(&pair) {
                return Ok(true);
            }
            comparing.insert(pair);
            let (fx, yr) = (x.borrow().fields.clone(), y.clone());
            let mut same = fx.len() == yr.borrow().fields.len();
            if same {
                for (f, v) in fx.iter() {
                    let other = yr.borrow().get(f).cloned();
                    match other {
                        Some(w) if equal_in(v, &w, comparing, depth + 1)? => {}
                        _ => {
                            same = false;
                            break;
                        }
                    }
                }
            }
            same
        }
        _ => return Ok(false),
    };
    comparing.remove(&pair);
    Ok(same)
}

// ---------- names: the closest a misspelled one most likely meant ----------

// Edits needed to turn one word into another, counting a swap of two neighbours as one, in UTF-16 units
fn distance(a: &[u16], b: &[u16]) -> usize {
    let mut d = vec![vec![0usize; b.len() + 1]; a.len() + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in d[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=a.len() {
        for j in 1..=b.len() {
            d[i][j] = (d[i - 1][j] + 1).min(d[i][j - 1] + 1).min(d[i - 1][j - 1] + usize::from(a[i - 1] != b[j - 1]));
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                d[i][j] = d[i][j].min(d[i - 2][j - 2] + 1);
            }
        }
    }
    d[a.len()][b.len()]
}

// The candidate a misspelled name most likely meant, or None if none is close: 1 edit for short names, 2 otherwise
pub fn closest<S: AsRef<str>>(name: &str, candidates: &[S]) -> Option<String> {
    let n: Vec<u16> = name.encode_utf16().collect();
    let mut best: Option<String> = None;
    let mut best_distance = if n.len() <= 3 { 1 } else { 2 } + 1;
    for c in candidates {
        let units: Vec<u16> = c.as_ref().encode_utf16().collect();
        let d = distance(&n, &units);
        if d < best_distance {
            best = Some(c.as_ref().to_string());
            best_distance = d;
        }
    }
    best
}

// A fast hash for dictionary keys (FxHash, as rustc uses): the standard one guards against hash flooding,
// which a program's own dictionary doesn't need
#[derive(Default, Clone, Copy)]
pub struct Fx(u64);
impl std::hash::Hasher for Fx {
    fn finish(&self) -> u64 {
        // murmur3's last mix, so every bit of the key reaches the low bits the table uses (a whole number's
        // float has all its low bits 0)
        let mut h = self.0;
        h ^= h >> 33;
        h = h.wrapping_mul(0xff51afd7ed558ccd);
        h ^= h >> 33;
        h = h.wrapping_mul(0xc4ceb9fe1a85ec53);
        h ^ (h >> 33)
    }
    fn write(&mut self, bytes: &[u8]) {
        for chunk in bytes.chunks(8) {
            let mut word = [0u8; 8];
            word[..chunk.len()].copy_from_slice(chunk);
            self.write_u64(u64::from_le_bytes(word));
        }
    }
    fn write_u64(&mut self, n: u64) {
        self.0 = (self.0.rotate_left(5) ^ n).wrapping_mul(0x51_7c_c1_b7_27_22_0a_95);
    }
    fn write_u8(&mut self, n: u8) {
        self.write_u64(n as u64);
    }
    fn write_usize(&mut self, n: usize) {
        self.write_u64(n as u64);
    }
}
pub type FastMap<K, V> = HashMap<K, V, std::hash::BuildHasherDefault<Fx>>;
