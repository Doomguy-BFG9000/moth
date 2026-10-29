// The Moth virtual machine: runs the bytecode compiler.rs makes, as vm.js's Machine does, with the same
// checks and the same messages.
use crate::compiler::{op::*, Const, Function, BUILTINS, EVENTS, TURTLE_ACTIONS};
use crate::error::{trail_of, MothError, Pos};
use crate::num;
use crate::parser::COMPARISONS;
use crate::value::*;
use std::cell::RefCell;
use std::rc::Rc;

// What the program reaches outside itself through: where `say` and drawing go, who answers `ask`, the files
// `read` and `write` use, its arguments, and where random numbers come from.
pub trait Host {
    fn print(&mut self, line: &str);
    fn draw(&mut self, item: Drawn);
    // None: nothing here can answer; Some(None): the input ended
    fn ask(&mut self, question: &str) -> Option<Option<String>>;
    // None: there are no files here; Some(Err(why)): it couldn't; Some(Ok(None)): there is no such file
    fn read(&mut self, name: &str, bytes: bool) -> Option<Result<Option<FileData>, String>>;
    fn write(&mut self, name: &str, data: FileData) -> Option<Result<(), String>>;
    fn args(&self) -> Vec<String>;
    fn random(&mut self) -> f64;
}

pub enum FileData {
    Text(String),
    Bytes(Vec<u8>),
}

// What the turtle draws, as vm.js's Turtle reports it
#[derive(Clone, Debug)]
pub enum Drawn {
    Line { x1: f64, y1: f64, x2: f64, y2: f64, color: Rc<str>, width: f64 },
    Clear,
    Box { x: f64, y: f64, width: f64, height: f64, color: Rc<str> },
    Circle { x: f64, y: f64, radius: f64, color: Rc<str> },
    Text { text: String, x: f64, y: f64, size: f64, color: Rc<str> },
}

// An app's handler: what it waits for (a terminal can't send it, so the function itself isn't kept)
pub struct Listener {
    pub event: &'static str,
    pub interval: Option<f64>,
}

// A mistake inside the run loop, turned into a MothError at the instruction that was running
pub struct Failure {
    message: String,
    value: Option<Value>,
    last: bool, // can't be caught by `try`, like running out of steps
}
type Res<T> = Result<T, Failure>;
fn oops<T>(message: String) -> Res<T> {
    Err(Failure { message, value: None, last: false })
}
const TOO_BIG: &str = "a value got too big to fit in memory";
impl From<TooBig> for Failure {
    fn from(_: TooBig) -> Failure {
        Failure { message: TOO_BIG.into(), value: None, last: false }
    }
}

// JavaScript's longest string, in UTF-16 units: a longer one is a mistake there, so it is here too
const MAX_TEXT: usize = (1 << 29) - 24;
fn fits(s: String) -> Res<String> {
    if s.len() > MAX_TEXT && s.encode_utf16().count() > MAX_TEXT {
        return Err(TooBig.into());
    }
    Ok(s)
}
fn shown(v: &Value, nested: bool) -> Res<String> {
    fits(try_show(v, nested)?)
}

const MAX_DEPTH: usize = 100_000; // function calls in progress at once
const MAX_BITS: f64 = 9007199254740991.0;

fn plural_n(n: usize, word: &str) -> String {
    plural(n, word)
}
fn no_value(name: &str) -> String {
    format!("'{name}' has no value yet (give it one with 'set {name} to ...')")
}
fn described(v: &Value) -> String {
    match v {
        Value::Num(n) => num::show(*n),
        _ => kind_of(v).into(),
    }
}
fn chars_of(t: &str) -> Vec<Value> {
    t.chars().map(|c| text(&c.to_string())).collect()
}
fn utf16_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

// ---------- what operations do (vm.js's shared helpers) ----------

fn dictionary_key(key: &Value) -> Res<Key> {
    match Key::of(key) {
        Some(k) => Ok(k),
        None => oops(format!("a dictionary's keys are text or numbers, not {}", kind_of(key))),
    }
}

fn not_in(d: &Dict, key: &Value) -> Res<String> {
    let guess = match key {
        Value::Text(t) => {
            let texts: Vec<String> =
                d.keys().into_iter().filter_map(|k| if let Key::Text(s) = k { Some(s.to_string()) } else { None }).collect();
            closest(t, &texts)
        }
        _ => None,
    };
    let mut message = format!("there is no {} in this dictionary", shown(key, true)?);
    if let Some(g) = guess {
        message += &format!(". Did you mean {}?", json_string(&g));
    }
    Ok(message)
}

// Where `item n of target` is: the list (or the bytes, or the dictionary, or a text's letters) and the place
fn item(target: &Value, n: &Value, writing: bool) -> Res<(Value, Value)> {
    if let Value::Dict(d) = target {
        let k = dictionary_key(n)?;
        if !writing && !d.borrow().has(&k) {
            return oops(not_in(&d.borrow(), n)?);
        }
        return Ok((target.clone(), n.clone()));
    }
    let (is_list, is_bytes, is_text) =
        (matches!(target, Value::List(_)), matches!(target, Value::Bytes(_)), matches!(target, Value::Text(_)));
    if writing && !is_list && !is_bytes {
        return oops(format!("can only change items of a list, dictionary or bytes, not {}", kind_of(target)));
    }
    if !is_list && !is_bytes && !is_text {
        return oops(format!("can only take an item of a list, text, dictionary or bytes, not {}", kind_of(target)));
    }
    let (seq, len) = match target {
        Value::Text(t) => {
            let letters = chars_of(t);
            let len = letters.len();
            (list(letters), len)
        }
        Value::List(l) => (target.clone(), l.borrow().len()),
        Value::Bytes(b) => (target.clone(), b.borrow().len()),
        _ => unreachable!(),
    };
    let i = match n {
        Value::Num(i) if num::is_integer(*i) => *i,
        _ => return oops(format!("item numbers must be whole numbers, not {}", shown(n, true)?)),
    };
    if i < 1.0 {
        return oops(format!("there is no item {}, items are counted from 1", num::show(i)));
    }
    if i > len as f64 {
        if is_bytes {
            return oops(format!("there is no item {}, there are only {}", num::show(i), plural_n(len, "byte")));
        }
        let (what, unit) = if is_list { ("list", "item") } else { ("text", "letter") };
        return oops(format!("there is no item {}, the {what} only has {}", num::show(i), plural_n(len, unit)));
    }
    Ok((seq, Value::Num(i - 1.0)))
}

fn item_at(seq: &Value, i: &Value) -> Value {
    match (seq, i) {
        (Value::Dict(d), k) => d.borrow().get(&Key::of(k).unwrap()).unwrap(),
        (Value::List(l), Value::Num(i)) => l.borrow()[*i as usize].clone(),
        (Value::Bytes(b), Value::Num(i)) => Value::Num(b.borrow()[*i as usize] as f64),
        _ => unreachable!(),
    }
}

fn byte(v: &Value) -> Res<u8> {
    match v {
        Value::Num(n) if num::is_integer(*n) && *n >= 0.0 && *n <= 255.0 => Ok(*n as u8),
        _ => oops(format!("a byte is a whole number from 0 to 255, not {}", shown(v, true)?)),
    }
}

fn put_item(seq: &Value, i: &Value, value: Value) -> Res<()> {
    match (seq, i) {
        (Value::Dict(d), k) => d.borrow_mut().set(Key::of(k).unwrap(), value),
        (Value::Bytes(b), Value::Num(i)) => {
            let v = byte(&value)?;
            b.borrow_mut()[*i as usize] = v;
        }
        (Value::List(l), Value::Num(i)) => l.borrow_mut()[*i as usize] = value,
        _ => unreachable!(),
    }
    Ok(())
}

fn is_in(a: &Value, b: &Value) -> Res<bool> {
    match b {
        Value::List(l) => {
            let items = l.borrow().clone();
            for x in &items {
                if equal(a, x)? {
                    return Ok(true);
                }
            }
            Ok(false)
        }
        Value::Bytes(bytes) => Ok(match a {
            Value::Num(n) => bytes.borrow().iter().any(|&x| x as f64 == *n),
            _ => false,
        }),
        Value::Dict(d) => Ok(Key::of(a).is_some_and(|k| d.borrow().has(&k))),
        _ => match (a, b) {
            (Value::Text(x), Value::Text(y)) => Ok(y.contains(&**x)),
            _ => oops(format!("can't check if {} is in {}", kind_of(a), kind_of(b))),
        },
    }
}

fn compare(op: usize, a: &Value, b: &Value) -> Res<bool> {
    let name = COMPARISONS[op];
    if name == "is" {
        return Ok(equal(a, b)?);
    }
    if name == "in" {
        return is_in(a, b);
    }
    let ok = if name == "divisible by" {
        matches!((a, b), (Value::Num(_), Value::Num(_)))
    } else {
        matches!((a, b), (Value::Num(_), Value::Num(_)) | (Value::Text(_), Value::Text(_)))
    };
    if !ok {
        return oops(format!("can't check if {} is {name} {}", kind_of(a), kind_of(b)));
    }
    if let (Value::Num(x), Value::Num(y)) = (a, b) {
        if name == "divisible by" && *y == 0.0 {
            return oops("can't divide by zero".into());
        }
        return Ok(compare_numbers(op, *x, *y));
    }
    let (Value::Text(x), Value::Text(y)) = (a, b) else { unreachable!() };
    let order = utf16_cmp(x, y);
    Ok(match name {
        "less than" => order.is_lt(),
        "greater than" => order.is_gt(),
        "at least" => order.is_ge(),
        _ => order.is_le(),
    })
}

fn compare_numbers(op: usize, a: f64, b: f64) -> bool {
    match op {
        0 => a == b,
        1 => a < b,
        2 => a > b,
        3 => a >= b,
        4 => a <= b,
        _ => a % b == 0.0,
    }
}

fn plus(a: &Value, b: &Value) -> Res<Value> {
    if matches!(a, Value::Text(_)) || matches!(b, Value::Text(_)) {
        let joined = shown(a, false)? + &shown(b, false)?;
        return Ok(Value::Text(Rc::from(fits(joined)?.as_str())));
    }
    oops(format!("can't use '+' on {} and {}", kind_of(a), kind_of(b)))
}

fn arithmetic(op: &str, a: &Value, b: &Value) -> Res<Value> {
    let (Value::Num(x), Value::Num(y)) = (a, b) else {
        return oops(format!("can't use '{op}' on {} and {}", kind_of(a), kind_of(b)));
    };
    if op == "/" && *y == 0.0 {
        return oops("can't divide by zero".into());
    }
    Ok(Value::Num(match op {
        "-" => x - y,
        "*" => x * y,
        _ => x / y,
    }))
}

fn length_of(v: &Value) -> Res<f64> {
    Ok(match v {
        Value::Text(t) => t.chars().count() as f64,
        Value::Dict(d) => d.borrow().len() as f64,
        Value::List(l) => l.borrow().len() as f64,
        Value::Bytes(b) => b.borrow().len() as f64,
        _ => return oops(format!("'length of' needs a list, text, dictionary or bytes, not {}", kind_of(v))),
    })
}

fn add_into(current: &Value, value: &Value, name: &str) -> Res<Value> {
    match current {
        Value::Unset => oops(no_value(name)),
        Value::List(l) => {
            l.borrow_mut().push(value.clone());
            Ok(current.clone())
        }
        Value::Text(t) => {
            let joined = fits(t.to_string() + &shown(value, false)?)?;
            Ok(Value::Text(Rc::from(joined.as_str())))
        }
        Value::Num(x) => match value {
            Value::Num(y) => Ok(Value::Num(x + y)),
            _ => oops(format!("can't add {} to {}", kind_of(value), kind_of(current))),
        },
        _ => oops(format!("can't add {} to {}", kind_of(value), kind_of(current))),
    }
}

fn items_of(v: &Value) -> Res<Vec<Value>> {
    Ok(match v {
        Value::Dict(d) => d.borrow().keys().iter().map(|k| k.value()).collect(),
        Value::List(l) => l.borrow().clone(),
        Value::Bytes(b) => b.borrow().iter().map(|&x| Value::Num(x as f64)).collect(),
        Value::Text(t) => chars_of(t),
        _ => return oops(format!("can only go through a list, text, dictionary or bytes, not {}", kind_of(v))),
    })
}

fn need_text<'v>(what: &str, v: &'v Value) -> Res<&'v str> {
    match v {
        Value::Text(t) => Ok(t),
        _ => oops(format!("{what} needs text, not {}", kind_of(v))),
    }
}

fn bits(what: &str, v: &Value) -> Res<f64> {
    match v {
        Value::Num(n) if num::is_integer(*n) && *n >= 0.0 => {
            if *n > MAX_BITS {
                return oops(format!("{what} works on numbers up to {}, not {}", num::show(MAX_BITS), num::show(*n)));
            }
            Ok(*n)
        }
        _ => oops(format!("{what} needs whole numbers of 0 or more, not {}", described(v))),
    }
}

// JavaScript's Number() on text that looks like a Moth number: white space, a minus, digits, maybe a point
fn number_of(t: &str) -> Option<f64> {
    let units: Vec<u16> = t.encode_utf16().collect();
    let space = |u: &u16| crate::error::js_space(*u);
    let start = units.iter().position(|u| !space(u))?;
    let end = units.iter().rposition(|u| !space(u))? + 1;
    let core = String::from_utf16(&units[start..end]).ok()?;
    let digits = core.strip_prefix('-').unwrap_or(&core);
    let (whole, fraction) = match digits.split_once('.') {
        Some((w, f)) => (w, Some(f)),
        None => (digits, None),
    };
    let all_digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    if !all_digits(whole) || fraction.is_some_and(|f| !all_digits(f)) {
        return None;
    }
    core.parse::<f64>().ok()
}

// TextDecoder: UTF-8, a mistake in it as U+FFFD, and a byte order mark at the start dropped
fn decode(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    String::from_utf8_lossy(bytes).into_owned()
}

fn builtin(index: usize, args: &[Value]) -> Res<Value> {
    let name = BUILTINS[index].0;
    let t = |s: String| -> Res<Value> { Ok(Value::Text(Rc::from(fits(s)?.as_str()))) };
    match name {
        "uppercase" => t(need_text("'uppercase of'", &args[0])?.to_uppercase()),
        "lowercase" => t(need_text("'lowercase of'", &args[0])?.to_lowercase()),
        "split" => {
            let text = need_text("'split'", &args[0])?;
            let by = need_text("'split ... by'", &args[1])?;
            Ok(list(if by.is_empty() { chars_of(text) } else { text.split(by).map(crate::value::text).collect() }))
        }
        "join" => {
            let Value::List(l) = &args[0] else {
                return oops(format!("'join' needs a list, not {}", kind_of(&args[0])));
            };
            let by = need_text("'join ... with'", &args[1])?;
            let items = l.borrow().clone();
            let mut parts = Vec::with_capacity(items.len());
            for x in &items {
                parts.push(shown(x, false)?);
            }
            t(parts.join(by))
        }
        "number" => {
            if let Value::Num(_) = args[0] {
                return Ok(args[0].clone());
            }
            let text = need_text("'number of'", &args[0])?;
            match number_of(text) {
                Some(n) => Ok(Value::Num(n)),
                None => oops(format!("{} isn't a number", shown(&args[0], true)?)),
            }
        }
        "position" => {
            let part = need_text("'position of'", &args[0])?;
            let whole = need_text("'position of ... in'", &args[1])?;
            Ok(Value::Num(match whole.find(part) {
                Some(at) => whole[..at].chars().count() as f64 + 1.0,
                None => 0.0,
            }))
        }
        "keys" => match &args[0] {
            Value::Dict(d) => Ok(list(d.borrow().keys().iter().map(|k| k.value()).collect())),
            other => oops(format!("'keys of' needs a dictionary, not {}", kind_of(other))),
        },
        "bit and" | "bit or" | "bit xor" => {
            let what = match name {
                "bit and" => "'bit and'",
                "bit or" => "'bit or'",
                _ => "'bit xor'",
            };
            let a = bits(what, &args[0])? as u64;
            let b = bits(what, &args[1])? as u64;
            Ok(Value::Num(match name {
                "bit and" => a & b,
                "bit or" => a | b,
                _ => a ^ b,
            } as f64))
        }
        "shift left" => {
            let x = bits("'shift'", &args[0])?;
            let n = bits("'shift ... by'", &args[1])?;
            let shifted = if x == 0.0 { 0.0 } else { x * num::power_of_two(n) };
            if shifted > MAX_BITS {
                return oops(format!(
                    "{} shifted left by {} is too big: bits work on numbers up to {}",
                    num::show(x),
                    num::show(n),
                    num::show(MAX_BITS)
                ));
            }
            Ok(Value::Num(shifted))
        }
        "shift right" => {
            let x = bits("'shift'", &args[0])?;
            let n = bits("'shift ... by'", &args[1])?;
            Ok(Value::Num((x / num::power_of_two(n)).floor()))
        }
        "bytes" => match &args[0] {
            Value::Num(n) if num::is_integer(*n) && *n >= 0.0 => {
                let mut block = Vec::new();
                if *n > 4294967296.0 || block.try_reserve_exact(*n as usize).is_err() {
                    return Err(TooBig.into());
                }
                block.resize(*n as usize, 0u8);
                Ok(Value::Bytes(Rc::new(RefCell::new(block))))
            }
            other => oops(format!("'bytes' needs a whole number in front of it, not {}", described(other))),
        },
        "as bytes" => match &args[0] {
            Value::Text(s) => Ok(Value::Bytes(Rc::new(RefCell::new(s.as_bytes().to_vec())))),
            Value::Bytes(b) => Ok(Value::Bytes(Rc::new(RefCell::new(b.borrow().clone())))),
            Value::List(l) => {
                let items = l.borrow().clone();
                let mut block = Vec::with_capacity(items.len());
                for x in &items {
                    block.push(byte(x)?);
                }
                Ok(Value::Bytes(Rc::new(RefCell::new(block))))
            }
            other => oops(format!("'as bytes' needs text, a list or bytes, not {}", kind_of(other))),
        },
        "as text" => match &args[0] {
            Value::Bytes(b) => t(decode(&b.borrow())),
            other => t(shown(other, false)?),
        },
        "as hex" => Ok(text(&num::radix(bits("'as hex'", &args[0])?, 16))),
        _ => Ok(text(&num::radix(bits("'as binary'", &args[0])?, 2))),
    }
}

// ---------- the turtle ----------

pub struct Turtle {
    x: f64,
    y: f64,
    heading: f64,
    pen: bool,
    color: Rc<str>,
    width: f64,
}

impl Default for Turtle {
    fn default() -> Turtle {
        Turtle { x: 0.0, y: 0.0, heading: 90.0, pen: true, color: Rc::from("#4f8ff7"), width: 2.0 }
    }
}

// 0, not 6.123e-17 or -0, where a line should end at 0
fn round2(n: f64) -> f64 {
    let r = num::round(n * 100.0) / 100.0;
    if r == 0.0 || r.is_nan() {
        0.0
    } else {
        r
    }
}

impl Turtle {
    fn act(&mut self, action: usize, value: Option<Value>, host: &mut dyn Host) -> Res<()> {
        let name = TURTLE_ACTIONS[action];
        let value = value.unwrap_or(Value::Nothing);
        if action < 4 && !matches!(value, Value::Num(_)) {
            let verb = if action < 2 { "move" } else { "turn" };
            return oops(format!("'{verb} {name}' needs a number, not {}", kind_of(&value)));
        }
        let numbers = |what: &str, items: &[Value]| -> Res<Vec<f64>> {
            let mut out = Vec::new();
            for n in items {
                match n {
                    Value::Num(x) => out.push(*x),
                    _ => return oops(format!("{what} needs numbers, not {}", kind_of(n))),
                }
            }
            Ok(out.into_iter().map(round2).collect())
        };
        let items = || match &value {
            Value::List(l) => l.borrow().clone(),
            _ => vec![],
        };
        let n = |v: &Value| if let Value::Num(x) = v { *x } else { 0.0 };
        match name {
            "forward" | "back" | "to" => {
                let (x, y) = if name == "to" {
                    let p = numbers("'move to'", &items())?;
                    (p[0], p[1])
                } else {
                    let steps = if name == "forward" { n(&value) } else { -n(&value) };
                    let angle = (self.heading * std::f64::consts::PI) / 180.0;
                    (self.x + steps * num::cos(angle), self.y + steps * num::sin(angle))
                };
                if self.pen {
                    host.draw(Drawn::Line {
                        x1: round2(self.x),
                        y1: round2(self.y),
                        x2: round2(x),
                        y2: round2(y),
                        color: self.color.clone(),
                        width: self.width,
                    });
                }
                self.x = x;
                self.y = y;
            }
            "clear" => host.draw(Drawn::Clear),
            "box" => {
                let p = numbers("'draw box'", &items())?;
                host.draw(Drawn::Box { x: p[0], y: p[1], width: p[2], height: p[3], color: self.color.clone() });
            }
            "circle" => {
                let p = numbers("'draw circle'", &items())?;
                if p[2] < 0.0 {
                    return oops(format!("a circle's size is 0 or more, not {}", num::show(p[2])));
                }
                host.draw(Drawn::Circle { x: p[0], y: p[1], radius: p[2], color: self.color.clone() });
            }
            "text" => {
                let all = items();
                let mut rest: Vec<Value> = all[1..].to_vec();
                if matches!(rest[2], Value::Nothing) {
                    rest[2] = Value::Num(16.0); // the usual size, when none is given
                }
                let p = numbers("'draw ... at'", &rest)?;
                if p[2] <= 0.0 {
                    return oops(format!("text's size is a number above 0, not {}", num::show(p[2])));
                }
                host.draw(Drawn::Text { text: shown(&all[0], false)?, x: p[0], y: p[1], size: p[2], color: self.color.clone() });
            }
            "left" | "right" => {
                let turn = n(&value);
                self.heading += if name == "left" { turn } else { -turn };
            }
            "color" => match &value {
                Value::Text(t) => self.color = t.clone(),
                other => return oops(format!("'pen color' needs text like \"red\", not {}", kind_of(other))),
            },
            "width" => match &value {
                Value::Num(w) if *w > 0.0 => self.width = *w,
                other => return oops(format!("'pen width' needs a number above 0, not {}", shown(other, true)?)),
            },
            _ => self.pen = name == "down",
        }
        Ok(())
    }
}

// ---------- the machine ----------

pub fn new_env(f: &Function, parent: Option<Rc<Env>>) -> Rc<Env> {
    Rc::new(Env { parent, slots: RefCell::new(vec![Value::Unset; f.nslots + 1]) })
}

struct Frame {
    func: Rc<Function>,
    ip: usize,
    env: Rc<Env>,
    base: usize,
}

struct Handler {
    ip: usize,
    frames: usize,
    stack: usize,
    func: Rc<Function>,
    env: Rc<Env>,
    base: usize,
}

pub struct Machine<'h> {
    host: &'h mut dyn Host,
    max_steps: f64,
    pub listeners: Vec<Listener>,
    pub turtle: Turtle,
}

fn env_at(env: &Rc<Env>, depth: i32) -> &Rc<Env> {
    let mut e = env;
    for _ in 0..depth {
        e = e.parent.as_ref().unwrap();
    }
    e
}

impl<'h> Machine<'h> {
    pub fn new(host: &'h mut dyn Host, max_steps: f64) -> Machine<'h> {
        Machine { host, max_steps, listeners: vec![], turtle: Turtle::default() }
    }

    // Runs `main` (the program, or a function with its inputs in `env`) until it ends or makes a mistake. The
    // loop works on locals, and a mistake leaves it with `break 'run`, which keeps them in registers.
    pub fn run(&mut self, main: Rc<Function>, env: Rc<Env>) -> Result<(), MothError> {
        let mut func = main;
        let mut env = env;
        let mut ip = 0usize;
        let mut base = 0usize;
        let mut steps = 0f64;
        let mut stack: Vec<Value> = Vec::with_capacity(64);
        let mut frames: Vec<Frame> = Vec::new();
        let mut handlers: Vec<Handler> = Vec::new();
        let mut caught = Value::Nothing;
        let max_steps = self.max_steps;
        loop {
            let mut pc;
            let failure: Failure = 'run: loop {
                macro_rules! check {
                    ($e:expr) => {
                        match $e {
                            Ok(v) => v,
                            Err(f) => break 'run f,
                        }
                    };
                }
                macro_rules! fail {
                    ($m:expr) => {
                        break 'run Failure { message: $m, value: None, last: false }
                    };
                }
                macro_rules! pop {
                    () => {
                        stack.pop().unwrap()
                    };
                }
                pc = ip;
                let op = func.code[ip];
                ip += 1;
                match op {
                    GET => {
                        let (d, slot) = (func.code[ip], func.code[ip + 1] as usize);
                        let v = env_at(&env, d).slots.borrow()[slot].clone();
                        if let Value::Unset = v {
                            fail!(no_value(&func.text(func.code[ip + 2])));
                        }
                        ip += 3;
                        stack.push(v);
                    }
                    SET => {
                        let v = pop!();
                        env_at(&env, func.code[ip]).slots.borrow_mut()[func.code[ip + 1] as usize] = v;
                        ip += 2;
                    }
                    CONST => {
                        let Const::Val(v) = &func.consts[func.code[ip] as usize] else { unreachable!() };
                        stack.push(v.clone());
                        ip += 1;
                    }
                    JUMP => {
                        let to = func.code[ip] as usize;
                        if to < ip {
                            steps += 1.0;
                            if steps > max_steps {
                                break 'run stopped(max_steps);
                            }
                        }
                        ip = to;
                    }
                    JUMP_IF_FALSE => {
                        let to = func.code[ip] as usize;
                        ip += 1;
                        if !truthy(&pop!()) {
                            ip = to;
                        }
                    }
                    COMPARE => {
                        let o = func.code[ip] as usize;
                        ip += 1;
                        let b = pop!();
                        let a = pop!();
                        let r = match (&a, &b) {
                            (Value::Num(x), Value::Num(y)) if o < 5 || (o == 5 && *y != 0.0) => compare_numbers(o, *x, *y),
                            _ => check!(compare(o, &a, &b)),
                        };
                        stack.push(Value::Bool(r));
                    }
                    ADD => {
                        let b = pop!();
                        let top = stack.len() - 1;
                        let sum = match (&stack[top], &b) {
                            (Value::Num(x), Value::Num(y)) => Some(x + y),
                            _ => None,
                        };
                        match sum {
                            Some(s) => stack[top] = Value::Num(s),
                            None => {
                                let a = pop!();
                                stack.push(check!(plus(&a, &b)));
                            }
                        }
                    }
                    SUB | MUL | DIV => {
                        let b = pop!();
                        let top = stack.len() - 1;
                        let made = match (&stack[top], &b) {
                            (Value::Num(x), Value::Num(y)) if op != DIV || *y != 0.0 => Some(if op == SUB {
                                x - y
                            } else if op == MUL {
                                x * y
                            } else {
                                x / y
                            }),
                            _ => None,
                        };
                        match made {
                            Some(m) => stack[top] = Value::Num(m),
                            None => {
                                let a = pop!();
                                stack.push(check!(arithmetic(
                                    if op == SUB {
                                        "-"
                                    } else if op == MUL {
                                        "*"
                                    } else {
                                        "/"
                                    },
                                    &a,
                                    &b
                                )));
                            }
                        }
                    }
                    GET_FN => {
                        let f = env_at(&env, func.code[ip]).slots.borrow()[func.code[ip + 1] as usize].clone();
                        match f {
                            Value::Func(_) => stack.push(f),
                            Value::Unset => fail!(format!("there is no function called '{}'", func.text(func.code[ip + 2]))),
                            other => fail!(format!("'{}' is {}, not a function", func.text(func.code[ip + 2]), kind_of(&other))),
                        }
                        ip += 3;
                    }
                    CALL => {
                        let argc = func.code[ip] as usize;
                        let name_at = func.code[ip + 1];
                        ip += 2;
                        let first = stack.len() - argc;
                        let Value::Func(callee) = stack[first - 1].clone() else { unreachable!() };
                        let n = callee.func.params.len();
                        if argc != n {
                            fail!(format!("'{}' needs {} but got {argc}", func.text(name_at), plural(n, "input")));
                        }
                        if frames.len() >= MAX_DEPTH {
                            fail!("too much recursion: a function kept calling itself".into());
                        }
                        steps += 1.0;
                        if steps > max_steps {
                            break 'run stopped(max_steps);
                        }
                        let inner = new_env(&callee.func, Some(callee.env.clone()));
                        {
                            let mut slots = inner.slots.borrow_mut();
                            for (i, v) in stack.drain(first..).enumerate() {
                                slots[i + 1] = v;
                            }
                        }
                        stack.pop();
                        let caller = std::mem::replace(&mut func, callee.func.clone());
                        frames.push(Frame { func: caller, ip, env: std::mem::replace(&mut env, inner), base });
                        ip = 0;
                        base = stack.len();
                    }
                    RETURN => {
                        while handlers.last().is_some_and(|h| h.frames == frames.len()) {
                            handlers.pop(); // its tries end with it
                        }
                        let Some(frame) = frames.pop() else {
                            break 'run Failure { message: String::new(), value: None, last: true }; // the function this machine ran is done
                        };
                        let value = pop!();
                        stack.truncate(base);
                        stack.push(value);
                        func = frame.func;
                        ip = frame.ip;
                        env = frame.env;
                        base = frame.base;
                    }
                    POP => {
                        stack.pop();
                    }
                    AND => {
                        let to = func.code[ip] as usize;
                        ip += 1;
                        if truthy(stack.last().unwrap()) {
                            stack.pop();
                        } else {
                            ip = to;
                        }
                    }
                    OR => {
                        let to = func.code[ip] as usize;
                        ip += 1;
                        if truthy(stack.last().unwrap()) {
                            ip = to;
                        } else {
                            stack.pop();
                        }
                    }
                    NEG => match pop!() {
                        Value::Num(x) => stack.push(Value::Num(-x)),
                        other => fail!(format!("'-' needs a number, not {}", kind_of(&other))),
                    },
                    NOT => {
                        let v = pop!();
                        stack.push(Value::Bool(!truthy(&v)));
                    }
                    LIST => {
                        let n = func.code[ip] as usize;
                        ip += 1;
                        let items = stack.split_off(stack.len() - n);
                        stack.push(list(items));
                    }
                    LENGTH => {
                        let v = pop!();
                        stack.push(Value::Num(check!(length_of(&v))));
                    }
                    ITEM => {
                        let n = pop!();
                        let target = pop!();
                        // the common cases, a whole number in range of a list or bytes, go straight there
                        let fast = match (&target, &n) {
                            (Value::List(l), Value::Num(i)) if *i >= 1.0 && *i <= l.borrow().len() as f64 && i.fract() == 0.0 => {
                                Some(l.borrow()[*i as usize - 1].clone())
                            }
                            (Value::Bytes(b), Value::Num(i)) if *i >= 1.0 && *i <= b.borrow().len() as f64 && i.fract() == 0.0 => {
                                Some(Value::Num(b.borrow()[*i as usize - 1] as f64))
                            }
                            _ => None,
                        };
                        match fast {
                            Some(v) => stack.push(v),
                            None => {
                                let (seq, i) = check!(item(&target, &n, false));
                                stack.push(item_at(&seq, &i));
                            }
                        }
                    }
                    ITEM_REF => {
                        let n = pop!();
                        let target = pop!();
                        let (seq, i) = check!(item(&target, &n, true));
                        stack.push(seq);
                        stack.push(i);
                    }
                    SET_ITEM => {
                        let v = pop!();
                        let i = pop!();
                        let seq = pop!();
                        check!(put_item(&seq, &i, v));
                    }
                    DICT => {
                        let n = func.code[ip] as usize;
                        ip += 1;
                        let start = stack.len() - n;
                        let mut d = Dict::default();
                        for pair in stack[start..].chunks(2) {
                            let k = check!(dictionary_key(&pair[0]));
                            d.set(k, pair[1].clone());
                        }
                        stack.truncate(start);
                        stack.push(Value::Dict(Rc::new(RefCell::new(d))));
                    }
                    REMOVE => {
                        let dictionary = pop!();
                        let key = pop!();
                        let Value::Dict(d) = &dictionary else {
                            fail!(format!("can only remove from a dictionary, not {}", kind_of(&dictionary)));
                        };
                        let k = check!(dictionary_key(&key));
                        if !d.borrow().has(&k) {
                            let message = check!(not_in(&d.borrow(), &key));
                            fail!(message);
                        }
                        d.borrow_mut().remove(&k);
                    }
                    ADD_TO => {
                        let value = pop!();
                        let e = env_at(&env, func.code[ip]);
                        let slot = func.code[ip + 1] as usize;
                        let mut slots = e.slots.borrow_mut();
                        let updated = match (&mut slots[slot], &value) {
                            (Value::Num(x), Value::Num(y)) => {
                                *x += y;
                                None
                            }
                            (Value::List(l), _) => {
                                l.borrow_mut().push(value);
                                None
                            }
                            (current, _) => Some(check!(add_into(current, &value, &func.text(func.code[ip + 2])))),
                        };
                        if let Some(u) = updated {
                            slots[slot] = u;
                        }
                        drop(slots);
                        ip += 3;
                    }
                    SAY => {
                        let n = func.code[ip] as usize;
                        ip += 1;
                        let start = stack.len() - n;
                        let mut line = String::new();
                        for p in &stack[start..] {
                            line += &check!(shown(p, false));
                        }
                        stack.truncate(start);
                        let line = check!(fits(line));
                        self.host.print(&line);
                    }
                    CHECK_REPEAT => match stack.last().unwrap() {
                        Value::Num(x) if num::is_integer(*x) && *x >= 0.0 => {}
                        other => {
                            let shown = check!(shown(other, true));
                            fail!(format!("repeat needs a whole number of times, not {shown}"));
                        }
                    },
                    REPEAT_NEXT => {
                        let exit = func.code[ip] as usize;
                        ip += 1;
                        let top = stack.len() - 1;
                        let Value::Num(left) = stack[top] else { unreachable!() };
                        if left > 0.0 {
                            stack[top] = Value::Num(left - 1.0);
                        } else {
                            stack.pop();
                            ip = exit;
                        }
                    }
                    CHECK_RANGE => {
                        let (from, to) = (&stack[stack.len() - 2], &stack[stack.len() - 1]);
                        if !matches!((from, to), (Value::Num(_), Value::Num(_))) {
                            fail!(format!("'from' and 'to' need numbers, not {} and {}", kind_of(from), kind_of(to)));
                        }
                    }
                    RANGE_NEXT => {
                        let exit = func.code[ip] as usize;
                        ip += 1;
                        let top = stack.len();
                        let (Value::Num(next), Value::Num(last)) = (&stack[top - 2], &stack[top - 1]) else { unreachable!() };
                        let (next, last) = (*next, *last);
                        if next <= last {
                            stack[top - 2] = Value::Num(next + 1.0);
                            stack.push(Value::Num(next));
                        } else {
                            stack.truncate(top - 2);
                            ip = exit;
                        }
                    }
                    ITER => {
                        let v = pop!();
                        let items = check!(items_of(&v));
                        stack.push(Value::Iter(Rc::new(RefCell::new(Iter { items, i: 0 }))));
                    }
                    ITER_NEXT => {
                        let exit = func.code[ip] as usize;
                        ip += 1;
                        let next = {
                            let Value::Iter(it) = stack.last().unwrap() else { unreachable!() };
                            let mut it = it.borrow_mut();
                            if it.i < it.items.len() {
                                it.i += 1;
                                Some(it.items[it.i - 1].clone())
                            } else {
                                None
                            }
                        };
                        match next {
                            Some(v) => stack.push(v),
                            None => {
                                stack.pop();
                                ip = exit;
                            }
                        }
                    }
                    MAKE_FN => {
                        let Const::Func(f) = &func.consts[func.code[ip] as usize] else { unreachable!() };
                        stack.push(Value::Func(Rc::new(Closure { func: f.clone(), env: env.clone() })));
                        ip += 1;
                    }
                    UNDEFINED => fail!(func.text(func.code[ip]).to_string()),
                    RECORD => {
                        let Const::Fields(fields) = &func.consts[func.code[ip] as usize] else { unreachable!() };
                        ip += 1;
                        let start = stack.len() - fields.len();
                        let mut r = Record::default();
                        for (f, v) in fields.iter().zip(stack.drain(start..)) {
                            r.set(f.clone(), v);
                        }
                        stack.push(Value::Record(Rc::new(RefCell::new(r))));
                    }
                    FIELD => {
                        let k = func.code[ip];
                        ip += 1;
                        let record = pop!();
                        let Value::Record(r) = &record else {
                            fail!(format!("can't take '{}' of {}", func.text(k), kind_of(&record)));
                        };
                        let field = func.text(k);
                        let found = r.borrow().get(&field).cloned();
                        match found {
                            Some(v) => stack.push(v),
                            None => {
                                let names: Vec<String> = r.borrow().fields.iter().map(|(n, _)| n.to_string()).collect();
                                let guess = closest(&field, &names).map(|g| format!(". Did you mean '{g}'?")).unwrap_or_default();
                                fail!(format!("this record has no '{field}'{guess}"));
                            }
                        }
                    }
                    RECORD_REF => {
                        let k = func.code[ip];
                        ip += 1;
                        let record = stack.last().unwrap();
                        if !matches!(record, Value::Record(_)) {
                            fail!(format!("can only change '{}' of a record, not {}", func.text(k), kind_of(record)));
                        }
                    }
                    SET_FIELD => {
                        let field = func.text(func.code[ip]);
                        ip += 1;
                        let value = pop!();
                        let Value::Record(r) = pop!() else { unreachable!() };
                        r.borrow_mut().set(field, value);
                    }
                    ASK => {
                        let question = pop!();
                        let q = check!(shown(&question, false));
                        match self.host.ask(&q) {
                            None => fail!("this program asks a question, but nothing can answer it here".into()),
                            Some(None) => fail!("there was no answer to this question: the input ended".into()),
                            Some(Some(answer)) => stack.push(text(&answer)),
                        }
                    }
                    READ => {
                        let bytes = func.code[ip] == 1;
                        ip += 1;
                        let name = pop!();
                        let Value::Text(n) = &name else {
                            fail!(format!("a file name is text, not {}", kind_of(&name)));
                        };
                        match self.host.read(n, bytes) {
                            None => fail!("this program reads a file, but there are no files here".into()),
                            Some(Err(why)) => fail!(format!("can't read '{n}': {why}")),
                            Some(Ok(None)) => fail!(format!("there is no file called '{n}'")),
                            Some(Ok(Some(FileData::Text(t)))) => stack.push(Value::Text(Rc::from(check!(fits(t)).as_str()))),
                            Some(Ok(Some(FileData::Bytes(b)))) => stack.push(Value::Bytes(Rc::new(RefCell::new(b)))),
                        }
                    }
                    WRITE => {
                        let name = pop!();
                        let value = pop!();
                        let Value::Text(n) = &name else {
                            fail!(format!("a file name is text, not {}", kind_of(&name)));
                        };
                        let data = match &value {
                            Value::Bytes(b) => FileData::Bytes(b.borrow().clone()),
                            other => FileData::Text(check!(shown(other, false))),
                        };
                        match self.host.write(n, data) {
                            None => fail!("this program writes a file, but there are no files here".into()),
                            Some(Err(why)) => fail!(format!("can't write '{n}': {why}")),
                            Some(Ok(())) => {}
                        }
                    }
                    HANDLE => {
                        let event = EVENTS[func.code[ip] as usize];
                        ip += 1;
                        stack.pop(); // the handler
                        self.listeners.push(Listener { event, interval: None });
                    }
                    EVERY => {
                        let unit = func.code[ip] as f64;
                        ip += 1;
                        stack.pop(); // the handler
                        match pop!() {
                            Value::Num(x) if x > 0.0 && x != f64::INFINITY => self.listeners.push(Listener { event: "every", interval: Some(x * unit) }),
                            other => fail!(format!("'every' needs a number above 0, not {}", described(&other))),
                        }
                    }
                    RANDOM => {
                        let high = pop!();
                        let low = pop!();
                        for n in [&low, &high] {
                            if !matches!(n, Value::Num(x) if num::is_integer(*x)) {
                                fail!(format!("'random number from' needs whole numbers, not {}", described(n)));
                            }
                        }
                        let (Value::Num(lo), Value::Num(hi)) = (low, high) else { unreachable!() };
                        if lo > hi {
                            fail!(format!("there is no number from {} to {}", num::show(lo), num::show(hi)));
                        }
                        let r = self.host.random();
                        stack.push(Value::Num(lo + (r * (hi - lo + 1.0)).floor()));
                    }
                    ARGUMENTS => {
                        let args = self.host.args();
                        stack.push(list(args.iter().map(|a| text(a)).collect()));
                    }
                    EXPECT => {
                        let o = func.code[ip];
                        let negate = func.code[ip + 1] == 1;
                        ip += 2;
                        if o < 0 {
                            let v = pop!();
                            if !truthy(&v) {
                                let shown = check!(shown(&v, true));
                                fail!(format!("expected yes, but got {shown}"));
                            }
                        } else {
                            let b = pop!();
                            let a = pop!();
                            if check!(compare(o as usize, &a, &b)) == negate {
                                let name = COMPARISONS[o as usize];
                                let op_text = if name == "is" { String::new() } else { format!(" {name}") };
                                let (sa, sb) = (check!(shown(&a, true)), check!(shown(&b, true)));
                                fail!(format!("expected {sa} {}to be{op_text} {sb}", if negate { "not " } else { "" }));
                            }
                        }
                    }
                    TRY => {
                        handlers.push(Handler {
                            ip: func.code[ip] as usize,
                            frames: frames.len(),
                            stack: stack.len(),
                            func: func.clone(),
                            env: env.clone(),
                            base,
                        });
                        ip += 1;
                    }
                    END_TRY => {
                        handlers.pop();
                    }
                    CAUGHT => stack.push(caught.clone()),
                    BUILTIN => {
                        let index = func.code[ip] as usize;
                        ip += 1;
                        let start = stack.len() - BUILTINS[index].1;
                        let made = check!(builtin(index, &stack[start..]));
                        stack.truncate(start);
                        stack.push(made);
                    }
                    FAIL => {
                        let v = pop!();
                        let message = check!(shown(&v, false));
                        break 'run Failure { message, value: Some(v), last: false };
                    }
                    TURTLE => {
                        let action = func.code[ip] as usize;
                        ip += 1;
                        let bare = matches!(TURTLE_ACTIONS[action], "up" | "down" | "clear");
                        let value = if bare { None } else { stack.pop() };
                        check!(self.turtle.act(action, value, self.host));
                    }
                    LINE => ip += 1,
                    HALT => break 'run Failure { message: String::new(), value: None, last: true },
                    _ => unreachable!("opcode {op}"),
                }
            };
            if failure.last && failure.message.is_empty() {
                return Ok(()); // HALT, or the end of the function this machine ran
            }
            let handler = if failure.last { None } else { handlers.pop() };
            let Some(h) = handler else {
                let at = func.at[pc].clone().unwrap_or(Pos { line: 0, col: 0, file: None });
                let mut err = MothError::at(&at, failure.message);
                err.value = failure.value;
                err.trail = trail(&func, &frames);
                return Err(err);
            };
            // back to where the `try` began: its function, its stack, then on to its `if it fails`
            frames.truncate(h.frames);
            func = h.func;
            env = h.env;
            base = h.base;
            stack.truncate(h.stack);
            ip = h.ip;
            caught = match failure.value {
                Some(v) => v,
                None => text(&failure.message),
            };
        }
    }
}

fn stopped(max_steps: f64) -> Failure {
    Failure {
        message: format!("stopped after {} steps (is there a loop that never ends?)", num::grouped(max_steps)),
        value: None,
        last: true,
    }
}

// The calls in progress, for a mistake, while `func` runs: each frame was saved by a CALL, which has two
// operands, so the call it made is the instruction three before where it returns to.
fn trail(func: &Rc<Function>, frames: &[Frame]) -> Vec<crate::error::Call> {
    let mut calls = Vec::new();
    let mut f = func.clone();
    for caller in frames.iter().rev() {
        let at = caller.func.at[caller.ip - 3].clone().unwrap();
        calls.push((f.name.clone(), at));
        f = caller.func.clone();
    }
    trail_of(calls)
}
