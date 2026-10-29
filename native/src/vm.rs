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
        Value::Num(n) => num::display(*n),
        _ => kind_of(v).into(),
    }
}
// a number to 15 digits (see num::canon); anything else as it is
fn canon(v: &Value) -> Value {
    match v {
        Value::Num(n) => Value::Num(num::canon(*n)),
        _ => v.clone(),
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
    let n = &canon(n); // 0.1 * 30 is item 3
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
        return oops(format!("there is no item {}, items are counted from 1", num::display(i)));
    }
    if i > len as f64 {
        if is_bytes {
            return oops(format!("there is no item {}, there are only {}", num::display(i), plural_n(len, "byte")));
        }
        let (what, unit) = if is_list { ("list", "item") } else { ("text", "letter") };
        return oops(format!("there is no item {}, the {what} only has {}", num::display(i), plural_n(len, unit)));
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
    match &canon(v) {
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
            Value::Num(n) => bytes.borrow().iter().any(|&x| x as f64 == num::canon(*n)),
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
            || matches!((a, b), (Value::Qty(_, u), Value::Qty(_, v)) if measure_of(*u) == measure_of(*v))
    };
    if !ok {
        return oops(format!("can't check if {} is {name} {}", kind_of(a), kind_of(b)));
    }
    if let (Value::Qty(x, u), Value::Qty(y, v)) = (a, b) {
        return Ok(compare_numbers(op, *x, amount_in(*y, *v, *u))); // in a's unit
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

// numbers compare to 15 digits (see num::order)
#[inline]
fn compare_numbers(op: usize, a: f64, b: f64) -> bool {
    use std::cmp::Ordering::*;
    match op {
        0 => num::order(a, b) == Some(Equal),
        1 => num::order(a, b) == Some(Less),
        2 => num::order(a, b) == Some(Greater),
        3 => matches!(num::order(a, b), Some(Greater | Equal)),
        4 => matches!(num::order(a, b), Some(Less | Equal)),
        _ => num::divisible(a, b),
    }
}

fn plus(a: &Value, b: &Value) -> Res<Value> {
    if matches!(a, Value::Text(_)) || matches!(b, Value::Text(_)) {
        let joined = shown(a, false)? + &shown(b, false)?;
        return Ok(Value::Text(Rc::from(fits(joined)?.as_str())));
    }
    if let (Value::Qty(x, u), Value::Qty(y, v)) = (a, b) {
        if measure_of(*u) == measure_of(*v) {
            return Ok(Value::Qty(x + amount_in(*y, *v, *u), *u)); // 5 km + 300 m is 5.3 km
        }
    }
    oops(format!("can't use '+' on {} and {}", kind_of(a), kind_of(b)))
}

// `-`, `*` and `/`: on numbers, and on amounts: less an amount of the same measure, times a number, or over a
// number (or an amount of the same measure, which gives how many times it goes in)
fn arithmetic(op: &str, a: &Value, b: &Value) -> Res<Value> {
    let zero = || oops("can't divide by zero".into());
    Ok(match (a, b) {
        (Value::Num(x), Value::Num(y)) => {
            if op == "/" && *y == 0.0 {
                return zero();
            }
            Value::Num(match op {
                "-" => x - y,
                "*" => x * y,
                _ => x / y,
            })
        }
        (Value::Qty(x, u), Value::Qty(y, v)) if op != "*" && measure_of(*u) == measure_of(*v) => {
            let y = amount_in(*y, *v, *u);
            if op == "-" {
                Value::Qty(x - y, *u)
            } else if y == 0.0 {
                return zero();
            } else {
                Value::Num(x / y)
            }
        }
        (Value::Qty(x, u), Value::Num(y)) if op != "-" => {
            if op == "/" && *y == 0.0 {
                return zero();
            }
            Value::Qty(if op == "*" { x * y } else { x / y }, *u)
        }
        (Value::Num(x), Value::Qty(y, v)) if op == "*" => Value::Qty(x * y, *v),
        _ => return oops(format!("can't use '{op}' on {} and {}", kind_of(a), kind_of(b))),
    })
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
        Value::Qty(x, u) => match value {
            Value::Qty(y, v) if measure_of(*u) == measure_of(*v) => Ok(Value::Qty(x + amount_in(*y, *v, *u), *u)),
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
    match &canon(v) {
        Value::Num(n) if num::is_integer(*n) && *n >= 0.0 => {
            if *n > MAX_BITS {
                return oops(format!("{what} works on numbers up to {}, not {}", num::display(MAX_BITS), num::display(*n)));
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
            match args[0] {
                Value::Num(_) => return Ok(args[0].clone()),
                Value::Qty(n, _) => return Ok(Value::Num(n)), // the number alone: `number of (trip in miles)`
                _ => {}
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
                    num::display(x),
                    num::display(n),
                    num::display(MAX_BITS)
                ));
            }
            Ok(Value::Num(shifted))
        }
        "shift right" => {
            let x = bits("'shift'", &args[0])?;
            let n = bits("'shift ... by'", &args[1])?;
            Ok(Value::Num((x / num::power_of_two(n)).floor()))
        }
        "bytes" => match &canon(&args[0]) {
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
        "table" => table_of(need_text("'read table'", &args[0])?),
        "column" => {
            let field = need_text("a column", &args[0])?;
            let Value::List(rows) = &args[1] else {
                return oops(format!("'{field} in' needs a list of records, not {}", kind_of(&args[1])));
            };
            let rows = rows.borrow().clone();
            let mut column = Vec::with_capacity(rows.len());
            for row in &rows {
                column.push(field_of(row, field)?);
            }
            Ok(list(column))
        }
        "total" => sum_of("total", &present("total", &args[0])?),
        "average" => {
            let items = present("average", &args[0])?;
            let sum = sum_of("average", &items)?;
            let n = items.len() as f64;
            match sum {
                _ if items.is_empty() => oops("'average of' needs a list with something in it".into()),
                Value::Qty(a, u) => Ok(Value::Qty(a / n, u)),
                Value::Num(a) => Ok(Value::Num(a / n)),
                _ => unreachable!(),
            }
        }
        "largest" | "smallest" => extreme(name, &args[0]),
        // `5 km` (the parser makes these) and `trip in miles`
        "unit" => {
            let word = need_text("a unit", &args[1])?;
            match args[0] {
                Value::Num(n) => Ok(Value::Qty(n, unit_named(word).unwrap())),
                _ => oops(format!("'{word}' needs a number in front of it, not {}", kind_of(&args[0]))),
            }
        }
        "in" => {
            let word = need_text("a unit", &args[1])?;
            let unit = unit_named(word).unwrap();
            match args[0] {
                Value::Qty(n, u) if measure_of(u) == measure_of(unit) => Ok(Value::Qty(amount_in(n, u, unit), unit)),
                _ => oops(format!("'in {word}' needs {}, not {}", MEASURES[measure_of(unit) as usize], kind_of(&args[0]))),
            }
        }
        _ => Ok(text(&num::radix(bits("'as binary'", &args[0])?, 2))),
    }
}

// ---------- tables: `read table "sales.csv"`, `total of price in sales` (vm.js's tableOf and the rest) ----------

// A CSV file's text as a table: a list of records, one for each row after the first, whose cells name the
// fields (in lower case, with _ for anything but letters, digits and _). A cell that is a number is that
// number, an empty one (or one the row is missing) is nothing, and any other is text. Cells in "quotes" can
// hold commas, line breaks and "" for a quote; blank lines are skipped.
fn table_of(csv: &str) -> Res<Value> {
    let chars: Vec<char> = csv.chars().collect();
    let mut rows: Vec<Vec<String>> = Vec::new();
    let (mut row, mut cell, mut quoted) = (Vec::new(), String::new(), false);
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if quoted {
            if c != '"' {
                cell.push(c);
            } else if chars.get(i + 1) == Some(&'"') {
                cell.push('"');
                i += 1;
            } else {
                quoted = false;
            }
        } else if c == '"' && cell.is_empty() {
            quoted = true;
        } else if c == ',' {
            row.push(std::mem::take(&mut cell));
        } else if c == '\n' || c == '\r' {
            row.push(std::mem::take(&mut cell));
            rows.push(std::mem::take(&mut row));
            if c == '\r' && chars.get(i + 1) == Some(&'\n') {
                i += 1;
            }
        } else {
            cell.push(c);
        }
        i += 1;
    }
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        rows.push(row);
    }
    let mut rows = rows.into_iter().filter(|r| r.len() > 1 || !r[0].is_empty());
    let Some(header) = rows.next() else { return Ok(list(vec![])) };
    let mut names: Vec<Rc<str>> = Vec::new();
    for (i, cell) in header.iter().enumerate() {
        let mut made = String::new();
        let mut in_run = false;
        for c in cell.chars().map(|c| c.to_ascii_lowercase()) {
            if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' {
                made.push(c);
                in_run = false;
            } else if !in_run {
                made.push('_');
                in_run = true;
            }
        }
        let mut name = made.trim_matches('_').to_string();
        if name.is_empty() {
            name = format!("column_{}", i + 1);
        } else if name.starts_with(|c: char| c.is_ascii_digit()) {
            name = format!("column_{name}");
        }
        while names.iter().any(|n| **n == *name) {
            name += &format!("_{}", i + 1);
        }
        names.push(Rc::from(name.as_str()));
    }
    let mut table = Vec::new();
    for r in rows {
        let mut record = Record::default();
        for (j, name) in names.iter().enumerate() {
            let value = match r.get(j) {
                None => Value::Nothing,
                Some(c) if c.is_empty() => Value::Nothing,
                Some(c) => match number_of(c) {
                    Some(n) => Value::Num(n),
                    None => text(c),
                },
            };
            record.fields.push((name.clone(), value));
        }
        table.push(Value::Record(Rc::new(RefCell::new(record))));
    }
    Ok(list(table))
}

// `price of row`, for a table's column
fn field_of(record: &Value, field: &str) -> Res<Value> {
    let Value::Record(r) = record else {
        return oops(format!("can't take '{field}' of {}", kind_of(record)));
    };
    let found = r.borrow().get(field).cloned();
    match found {
        Some(v) => Ok(v),
        None => {
            let names: Vec<String> = r.borrow().fields.iter().map(|(n, _)| n.to_string()).collect();
            let guess = closest(field, &names).map(|g| format!(". Did you mean '{g}'?")).unwrap_or_default();
            oops(format!("this record has no '{field}'{guess}"))
        }
    }
}

// What `total of`, `average of`, `largest of` and `smallest of` work on: the items that aren't nothing (as a
// spreadsheet skips empty cells)
fn present(what: &str, v: &Value) -> Res<Vec<Value>> {
    match v {
        Value::List(l) => Ok(l.borrow().iter().filter(|x| !matches!(x, Value::Nothing)).cloned().collect()),
        _ => oops(format!("'{what} of' needs a list, not {}", kind_of(v))),
    }
}

// `total of`, and `average of` before it divides: numbers, or amounts of one measure (in the first one's unit)
fn sum_of(what: &str, items: &[Value]) -> Res<Value> {
    let mut sum = Value::Num(0.0);
    for (i, x) in items.iter().enumerate() {
        if !matches!(x, Value::Num(_) | Value::Qty(..)) {
            return oops(format!("'{what} of' needs numbers, not {}", kind_of(x)));
        }
        sum = match (&sum, x) {
            _ if i == 0 => x.clone(),
            (Value::Num(a), Value::Num(b)) => Value::Num(a + b),
            (Value::Qty(a, u), Value::Qty(b, v)) if measure_of(*u) == measure_of(*v) => Value::Qty(a + amount_in(*b, *v, *u), *u),
            _ => return oops(format!("'{what} of' can't add {} to {}", kind_of(x), kind_of(&sum))),
        };
    }
    Ok(sum)
}

// `largest of`, `smallest of`: the first of the items no other beats
fn extreme(what: &str, v: &Value) -> Res<Value> {
    let items = present(what, v)?;
    if items.is_empty() {
        return oops(format!("'{what} of' needs a list with something in it"));
    }
    let op = if what == "largest" { 2 } else { 1 }; // greater than, less than
    let mut best = items[0].clone();
    for x in &items[1..] {
        if compare(op, x, &best)? {
            best = x.clone();
        }
    }
    Ok(best)
}

// whether a value is what an input says it is (a place in KINDS; -1 says nothing)
fn fits_kind(kind: i32, v: &Value) -> bool {
    match kind {
        0 => matches!(v, Value::Num(_)),
        1 => matches!(v, Value::Text(_)),
        2 => matches!(v, Value::Bool(_)),
        3 => matches!(v, Value::List(_)),
        4 => matches!(v, Value::Record(_)),
        5 => matches!(v, Value::Dict(_)),
        6 => matches!(v, Value::Bytes(_)),
        7 => matches!(v, Value::Func(_)),
        _ => true,
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
                    return oops(format!("a circle's size is 0 or more, not {}", num::display(p[2])));
                }
                host.draw(Drawn::Circle { x: p[0], y: p[1], radius: p[2], color: self.color.clone() });
            }
            "chart" => {
                // `draw chart of sales`: a bar for each number (or amount) in a list, or each value of a dictionary,
                // labelled with its place in the list or its key. The longest bar is 200 long, each 30 wide and 10
                // from the next, from (0, 0), with its value at its end; nothing has a label and no bar.
                let (values, labels): (Vec<Value>, Vec<String>) = match &value {
                    Value::Dict(d) => {
                        let d = d.borrow();
                        let keys = d.keys();
                        let mut labels = Vec::with_capacity(keys.len());
                        for k in &keys {
                            labels.push(shown(&k.value(), false)?);
                        }
                        (keys.iter().map(|k| d.get(k).unwrap()).collect(), labels)
                    }
                    Value::List(l) => {
                        let items = l.borrow().clone();
                        let labels = (1..=items.len()).map(|i| i.to_string()).collect();
                        (items, labels)
                    }
                    other => return oops(format!("'draw chart of' needs a list or a dictionary, not {}", kind_of(other))),
                };
                let first = values.iter().find(|v| !matches!(v, Value::Nothing));
                let mut sizes = Vec::with_capacity(values.len());
                for v in &values {
                    sizes.push(match (v, first) {
                        (Value::Nothing, _) => None,
                        (Value::Num(n), Some(Value::Num(_))) => Some(*n),
                        (Value::Qty(n, u), Some(Value::Qty(_, f))) if measure_of(*u) == measure_of(*f) => Some(amount_in(*n, *u, *f)),
                        _ => return oops(format!("'draw chart of' needs numbers, or amounts of one measure, not {}", kind_of(v))),
                    });
                }
                let mut biggest = 0.0f64;
                for n in sizes.iter().flatten() {
                    if n.abs() > biggest {
                        biggest = n.abs();
                    }
                }
                let scale = if biggest == 0.0 { 0.0 } else { 200.0 / biggest };
                for (i, n) in sizes.iter().enumerate() {
                    let x = (i * 40) as f64;
                    let height = n.map_or(0.0, |n| round2(n * scale));
                    if n.is_some() {
                        host.draw(Drawn::Box { x, y: height.min(0.0), width: 30.0, height: height.abs(), color: self.color.clone() });
                        let text = shown(&values[i], false)?;
                        host.draw(Drawn::Text { text, x, y: height.max(0.0) + 4.0, size: 12.0, color: self.color.clone() });
                    }
                    host.draw(Drawn::Text { text: labels[i].clone(), x, y: height.min(0.0) - 18.0, size: 12.0, color: self.color.clone() });
                }
            }
            "text" => {
                let all = items();
                let mut rest: Vec<Value> = all[1..].to_vec();
                if matches!(rest[2], Value::Nothing) {
                    rest[2] = Value::Num(16.0); // the usual size, when none is given
                }
                let p = numbers("'draw ... at'", &rest)?;
                if p[2] <= 0.0 {
                    return oops(format!("text's size is a number above 0, not {}", num::display(p[2])));
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

// ---------- what instructions do, for the machine and for compiled programs alike ----------
// A program `moth-native build --exe` makes (exe.rs) runs its own code, not this machine, but every check and
// every message comes from these, which the machine uses too, so the two can't drift apart.

// GET's value, or that the variable has none yet
#[allow(dead_code)] // used by compiled programs (exe.rs)
#[inline]
fn got(v: Value, func: &Function, name: i32) -> Res<Value> {
    if let Value::Unset = v {
        return oops(no_value(&func.text(name)));
    }
    Ok(v)
}

// GET_FN's value, which must be a function
#[inline]
fn got_fn(v: Value, func: &Function, name: i32) -> Res<Value> {
    match v {
        Value::Func(_) => Ok(v),
        Value::Unset => oops(format!("there is no function called '{}'", func.text(name))),
        other => oops(format!("'{}' is {}, not a function", func.text(name), kind_of(&other))),
    }
}

// whether a call gives a function the inputs it needs: as many as it has, each what it says it is
#[inline]
fn check_call(callee: &Closure, args: &[Value], func: &Function, name_at: i32) -> Res<()> {
    let n = callee.func.params.len();
    if args.len() != n {
        return oops(format!("'{}' needs {} but got {}", func.text(name_at), plural(n, "input"), args.len()));
    }
    for (i, &k) in callee.func.kinds.iter().enumerate() {
        if !fits_kind(k, &args[i]) {
            return oops(format!(
                "'{}' needs {} to be {}, not {}",
                func.text(name_at),
                callee.func.params[i],
                crate::parser::KINDS[k as usize],
                kind_of(&args[i])
            ));
        }
    }
    Ok(())
}

// COMPARE: numbers straight away, anything else by compare()
#[inline]
fn compare_values(o: usize, a: &Value, b: &Value) -> Res<bool> {
    match (a, b) {
        (Value::Num(x), Value::Num(y)) if o < 5 || (o == 5 && *y != 0.0) => Ok(compare_numbers(o, *x, *y)),
        _ => compare(o, a, b),
    }
}

// ADD, SUB, MUL or DIV (by opcode): numbers straight away, anything else by plus() or arithmetic()
#[allow(dead_code)] // used by compiled programs (exe.rs)
#[inline]
fn math_values(op: i32, a: &Value, b: &Value) -> Res<Value> {
    match (a, b) {
        (Value::Num(x), Value::Num(y)) if op != DIV || *y != 0.0 => Ok(Value::Num(match op {
            ADD => x + y,
            SUB => x - y,
            MUL => x * y,
            _ => x / y,
        })),
        _ if op == ADD => plus(a, b),
        _ => arithmetic(
            if op == SUB {
                "-"
            } else if op == MUL {
                "*"
            } else {
                "/"
            },
            a,
            b,
        ),
    }
}

#[inline]
fn negate_value(v: Value) -> Res<Value> {
    match v {
        Value::Num(x) => Ok(Value::Num(-x)),
        Value::Qty(x, u) => Ok(Value::Qty(-x, u)),
        other => oops(format!("'-' needs a number, not {}", kind_of(&other))),
    }
}

// ITEM: a whole number in range of a list or bytes goes straight there; anything else through item()
#[inline]
fn item_value(target: &Value, n: &Value) -> Res<Value> {
    match (target, n) {
        (Value::List(l), Value::Num(i)) if *i >= 1.0 && *i <= l.borrow().len() as f64 && i.fract() == 0.0 => {
            Ok(l.borrow()[*i as usize - 1].clone())
        }
        (Value::Bytes(b), Value::Num(i)) if *i >= 1.0 && *i <= b.borrow().len() as f64 && i.fract() == 0.0 => {
            Ok(Value::Num(b.borrow()[*i as usize - 1] as f64))
        }
        _ => {
            let (seq, i) = item(target, n, false)?;
            Ok(item_at(&seq, &i))
        }
    }
}

// DICT: each key, then its value
fn make_dict(pairs: &[Value]) -> Res<Value> {
    let mut d = Dict::default();
    for pair in pairs.chunks(2) {
        let k = dictionary_key(&pair[0])?;
        d.set(k, pair[1].clone());
    }
    Ok(Value::Dict(Rc::new(RefCell::new(d))))
}

// REMOVE: `remove key from dictionary`
fn remove_key(key: &Value, dictionary: &Value) -> Res<()> {
    let Value::Dict(d) = dictionary else {
        return oops(format!("can only remove from a dictionary, not {}", kind_of(dictionary)));
    };
    let k = dictionary_key(key)?;
    if !d.borrow().has(&k) {
        return oops(not_in(&d.borrow(), key)?);
    }
    d.borrow_mut().remove(&k);
    Ok(())
}

// ADD_TO: `add value to` the variable in `slot`, whose name is the constant `name`
#[inline]
fn add_to_value(slot: &mut Value, value: Value, func: &Function, name: i32) -> Res<()> {
    let updated = match (&mut *slot, &value) {
        (Value::Num(x), Value::Num(y)) => {
            *x += y;
            None
        }
        (Value::List(l), _) => {
            l.borrow_mut().push(value);
            None
        }
        (current, _) => Some(add_into(current, &value, &func.text(name))?),
    };
    if let Some(u) = updated {
        *slot = u;
    }
    Ok(())
}

// SAY: the line its parts make
fn said(parts: &[Value]) -> Res<String> {
    let mut line = String::new();
    for p in parts {
        line += &shown(p, false)?;
    }
    fits(line)
}

// CHECK_REPEAT: how many times a `repeat` goes round
fn repeat_count(v: &Value) -> Res<Value> {
    match canon(v) {
        Value::Num(x) if num::is_integer(x) && x >= 0.0 => Ok(Value::Num(x)), // 0.1 * 30 is 3 times
        other => {
            let shown = shown(&other, true)?;
            oops(format!("repeat needs a whole number of times, not {shown}"))
        }
    }
}

// CHECK_RANGE: `for each i from a to b`
fn check_range(from: &Value, to: &Value) -> Res<()> {
    if !matches!((from, to), (Value::Num(_), Value::Num(_))) {
        return oops(format!("'from' and 'to' need numbers, not {} and {}", kind_of(from), kind_of(to)));
    }
    Ok(())
}

// ITER, and ITER_NEXT: what `for each x in` goes through, and its next item, if there's one
fn iter_of(v: &Value) -> Res<Value> {
    let items = items_of(v)?;
    Ok(Value::Iter(Rc::new(RefCell::new(Iter { items, i: 0 }))))
}
#[inline]
fn iter_next(iter: &Value) -> Option<Value> {
    let Value::Iter(it) = iter else { unreachable!() };
    let mut it = it.borrow_mut();
    if it.i < it.items.len() {
        it.i += 1;
        Some(it.items[it.i - 1].clone())
    } else {
        None
    }
}

// RECORD: its fields' names, and their values in the same order
fn make_record(fields: &[Rc<str>], values: impl Iterator<Item = Value>) -> Value {
    let mut r = Record::default();
    for (f, v) in fields.iter().zip(values) {
        r.set(f.clone(), v);
    }
    Value::Record(Rc::new(RefCell::new(r)))
}

// FIELD: `name of person`
fn field_value(record: &Value, field: Rc<str>) -> Res<Value> {
    let Value::Record(r) = record else {
        return oops(format!("can't take '{}' of {}", field, kind_of(record)));
    };
    let found = r.borrow().get(&field).cloned();
    match found {
        Some(v) => Ok(v),
        None => {
            let names: Vec<String> = r.borrow().fields.iter().map(|(n, _)| n.to_string()).collect();
            let guess = closest(&field, &names).map(|g| format!(". Did you mean '{g}'?")).unwrap_or_default();
            oops(format!("this record has no '{field}'{guess}"))
        }
    }
}

// RECORD_REF, then SET_FIELD: `set name of person to ...`
fn record_ref(record: &Value, field: &str) -> Res<()> {
    if !matches!(record, Value::Record(_)) {
        return oops(format!("can only change '{field}' of a record, not {}", kind_of(record)));
    }
    Ok(())
}
fn set_field(record: Value, field: Rc<str>, value: Value) {
    let Value::Record(r) = record else { unreachable!() };
    r.borrow_mut().set(field, value);
}

// ASK: the answer, as text
fn ask_answer(host: &mut dyn Host, question: &Value) -> Res<Value> {
    let q = shown(question, false)?;
    match host.ask(&q) {
        None => oops("this program asks a question, but nothing can answer it here".into()),
        Some(None) => oops("there was no answer to this question: the input ended".into()),
        Some(Some(answer)) => Ok(text(&answer)),
    }
}

// READ: a file's (or site's) text, or its bytes
fn read_value(host: &mut dyn Host, name: &Value, bytes: bool) -> Res<Value> {
    let Value::Text(n) = name else {
        return oops(format!("a file name is text, not {}", kind_of(name)));
    };
    match host.read(n, bytes) {
        None => oops("this program reads a file, but there are no files here".into()),
        Some(Err(why)) => oops(format!("can't read '{n}': {why}")),
        Some(Ok(None)) => oops(format!("there is no file called '{n}'")),
        Some(Ok(Some(FileData::Text(t)))) => Ok(Value::Text(Rc::from(fits(t)?.as_str()))),
        Some(Ok(Some(FileData::Bytes(b)))) => Ok(Value::Bytes(Rc::new(RefCell::new(b)))),
    }
}

// WRITE: bytes as they are, anything else as `say` shows it
fn write_value(host: &mut dyn Host, value: &Value, name: &Value) -> Res<()> {
    let Value::Text(n) = name else {
        return oops(format!("a file name is text, not {}", kind_of(name)));
    };
    let data = match value {
        Value::Bytes(b) => FileData::Bytes(b.borrow().clone()),
        other => FileData::Text(shown(other, false)?),
    };
    match host.write(n, data) {
        None => oops("this program writes a file, but there are no files here".into()),
        Some(Err(why)) => oops(format!("can't write '{n}': {why}")),
        Some(Ok(())) => Ok(()),
    }
}

// EVERY: how often, in milliseconds
fn every_listener(interval: Value, unit: f64) -> Res<Listener> {
    match interval {
        Value::Num(x) if x > 0.0 && x != f64::INFINITY => Ok(Listener { event: "every", interval: Some(x * unit) }),
        other => oops(format!("'every' needs a number above 0, not {}", described(&other))),
    }
}

// RANDOM: `random number from low to high`
fn random_value(host: &mut dyn Host, low: &Value, high: &Value) -> Res<Value> {
    let (low, high) = (canon(low), canon(high));
    for n in [&low, &high] {
        if !matches!(n, Value::Num(x) if num::is_integer(*x)) {
            return oops(format!("'random number from' needs whole numbers, not {}", described(n)));
        }
    }
    let (Value::Num(lo), Value::Num(hi)) = (low, high) else { unreachable!() };
    if lo > hi {
        return oops(format!("there is no number from {} to {}", num::display(lo), num::display(hi)));
    }
    let r = host.random();
    Ok(Value::Num(lo + (r * (hi - lo + 1.0)).floor()))
}

// EXPECT: `expect x` (o below 0), or `expect a is b` and the other comparisons, `is not` if negate
fn expect_yes(v: &Value) -> Res<()> {
    if !truthy(v) {
        let shown = shown(v, true)?;
        return oops(format!("expected yes, but got {shown}"));
    }
    Ok(())
}
fn expect_that(o: usize, negate: bool, a: &Value, b: &Value) -> Res<()> {
    if compare(o, a, b)? == negate {
        let name = COMPARISONS[o];
        let op_text = if name == "is" { String::new() } else { format!(" {name}") };
        let (sa, sb) = (shown(a, true)?, shown(b, true)?);
        return oops(format!("expected {sa} {}to be{op_text} {sb}", if negate { "not " } else { "" }));
    }
    Ok(())
}

// FAIL: `fail with value`, which `try` gets back as it was
fn fail_with(v: Value) -> Failure {
    match shown(&v, false) {
        Ok(message) => Failure { message, value: Some(v), last: false },
        Err(f) => f,
    }
}

// BUILTIN: `bit and`, `bit or` and `bit xor` (7, 8, 9) on whole numbers from 0 to 2^53 - 1 straight away,
// anything else by builtin()
fn builtin_value(index: usize, args: &[Value]) -> Res<Value> {
    if (7..=9).contains(&index) {
        if let (Value::Num(x), Value::Num(y)) = (&args[0], &args[1]) {
            let whole = |n: f64| num::is_integer(n) && (0.0..=MAX_BITS).contains(&n);
            if whole(*x) && whole(*y) {
                let (a, b) = (*x as u64, *y as u64);
                return Ok(Value::Num(match index {
                    7 => a & b,
                    8 => a | b,
                    _ => a ^ b,
                } as f64));
            }
        }
    }
    builtin(index, args)
}

// ---------- a compiled program's own code (exe.rs), and what it runs with ----------

// A Moth function as a compiled program's own code: what it runs with, its bytecode (for its constants and
// places), the environment it was made in, and its inputs, each taken as it starts
pub type NativeFn = for<'a, 'b> fn(&'a mut Rt<'b>, &Rc<Function>, &Rc<Env>, &mut [Value]) -> Out;
// what a compiled function gives back: its value, or its mistake (boxed, so a value comes back in registers)
pub type Out = Result<Value, Box<Fail>>;

// What a compiled program runs with: what the machine has, without the machine
#[allow(dead_code)] // used by compiled programs (exe.rs)
pub struct Rt<'h> {
    pub host: &'h mut dyn Host,
    pub turtle: Turtle,
    pub listeners: Vec<Listener>,
    pub depth: usize,             // calls in progress
    pub funcs: Vec<Rc<Function>>, // every function, in the order exe.rs numbers them: their constants and places
}

#[allow(dead_code)] // used by compiled programs (exe.rs)
impl<'h> Rt<'h> {
    pub fn new(host: &'h mut dyn Host, main: &Rc<Function>) -> Rt<'h> {
        let mut funcs = vec![];
        fn walk(f: &Rc<Function>, out: &mut Vec<Rc<Function>>) {
            out.push(f.clone());
            for c in &f.consts {
                if let Const::Func(g) = c {
                    walk(g, out);
                }
            }
        }
        walk(main, &mut funcs);
        Rt { host, turtle: Turtle::default(), listeners: vec![], depth: 0, funcs }
    }
}

// A mistake in a compiled program: what went wrong, where, and the calls it has come back through so far
#[allow(dead_code)] // used by compiled programs (exe.rs)
pub struct Fail {
    pub failure: Failure,
    pub at: Pos,
    pub calls: Vec<(String, Pos)>,
}

#[allow(dead_code)] // used by compiled programs (exe.rs)
impl Fail {
    // a mistake at instruction `pc` of `func`
    pub fn at(failure: Failure, func: &Function, pc: usize) -> Box<Fail> {
        Box::new(Fail { failure, at: func.at[pc].clone().unwrap_or(Pos { line: 0, col: 0, file: None }), calls: vec![] })
    }
    // whether `try` can catch it
    pub fn catchable(&self) -> bool {
        !self.failure.last
    }
    // what `if it fails with why` gets
    pub fn caught(self) -> Value {
        match self.failure.value {
            Some(v) => v,
            None => text(&self.failure.message),
        }
    }
    // as the machine would have stopped with it
    pub fn into_error(self) -> MothError {
        let mut err = MothError::at(&self.at, self.failure.message);
        err.value = self.failure.value;
        err.trail = trail_of(self.calls);
        err
    }
}

// a call, from instruction `pc` of `func` (its name is constant `name_at`): checked as the machine checks one
#[allow(dead_code)] // used by compiled programs (exe.rs)
pub fn call(rt: &mut Rt, callee: &Value, args: &mut [Value], func: &Function, name_at: i32, pc: usize) -> Out {
    let Value::Func(c) = callee else { unreachable!() };
    if let Err(f) = check_call(c, args, func, name_at) {
        return Err(Fail::at(f, func, pc));
    }
    if rt.depth >= MAX_DEPTH {
        return Err(Fail::at(
            Failure { message: "too much recursion: a function kept calling itself".into(), value: None, last: false },
            func,
            pc,
        ));
    }
    rt.depth += 1;
    let made = (c.native.expect("a compiled program's functions are all compiled"))(rt, &c.func, &c.env, args);
    rt.depth -= 1;
    made.map_err(|mut e| {
        e.calls.push((c.func.name.clone(), func.at[pc].clone().unwrap()));
        e
    })
}

// a function made inside a compiled one: its own code, and the environment it was made in
#[allow(dead_code)] // used by compiled programs (exe.rs)
pub fn make_fn(func: &Function, k: usize, env: &Rc<Env>, native: NativeFn) -> Value {
    let Const::Func(f) = &func.consts[k] else { unreachable!() };
    Value::Func(Rc::new(Closure { func: f.clone(), env: env.clone(), native: Some(native) }))
}

// a constant of `func`, as a value
#[allow(dead_code)] // used by compiled programs (exe.rs)
// the number in a value exe.rs knows is one
#[inline]
pub fn number(v: Value) -> f64 {
    match v {
        Value::Num(x) => x,
        _ => unreachable!("exe.rs knew this was a number"),
    }
}

#[allow(dead_code)] // used by compiled programs (exe.rs)
// a value off a compiled function's stack, or out of its inputs, leaving nothing there
#[inline]
pub fn take(v: &mut Value) -> Value {
    std::mem::replace(v, Value::Nothing)
}

#[allow(dead_code)] // used by compiled programs (exe.rs)
#[inline]
pub fn constant(func: &Function, k: usize) -> Value {
    let Const::Val(v) = &func.consts[k] else { unreachable!() };
    v.clone()
}

// HANDLE and EVERY, in a compiled program: listeners it sets up, which a terminal never calls
#[allow(dead_code)] // used by compiled programs (exe.rs)
pub fn handle(rt: &mut Rt, event: usize) {
    rt.listeners.push(Listener { event: EVENTS[event], interval: None });
}
#[allow(dead_code)] // used by compiled programs (exe.rs)
pub fn every(rt: &mut Rt, interval: Value, unit: f64) -> Res<()> {
    let l = every_listener(interval, unit)?;
    rt.listeners.push(l);
    Ok(())
}

// ---------- the machine ----------

pub fn new_env(f: &Function, parent: Option<Rc<Env>>) -> Rc<Env> {
    Rc::new(Env { parent, slots: RefCell::new(vec![Value::Unset; f.nslots + 1]) })
}

// A call in progress, saved while the function it called runs. A flat function (Function::is_flat) keeps its
// variables in `locals` from `lbase` on, and `env` is then the environment it was made in; any other has an
// environment of its own, made for the call.
struct Frame {
    func: Rc<Function>,
    ip: usize,
    env: Rc<Env>,
    base: usize,
    lbase: usize,
    flat: bool,
}

struct Handler {
    ip: usize,
    frames: usize,
    stack: usize,
    func: Rc<Function>,
    env: Rc<Env>,
    base: usize,
    lbase: usize,
    flat: bool,
    locals: usize,
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
        let mut code = func.decoded(); // func's code, as the machine runs it
        let mut env = env;
        let mut ip = 0usize;
        let mut base = 0usize;
        let mut steps = 0f64;
        let mut stack: Vec<Value> = Vec::with_capacity(64);
        let mut locals: Vec<Value> = Vec::with_capacity(64); // flat functions' variables (see Frame)
        let mut lbase = 0usize;
        let mut flat = false;
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
                // a variable's value, by its depth and slot (see Frame for where a flat function keeps them)
                macro_rules! var {
                    ($d:expr, $slot:expr) => {{
                        let (d, slot) = ($d, $slot as usize);
                        if !flat {
                            env_at(&env, d).slots.borrow()[slot].clone()
                        } else if d == 0 {
                            locals[lbase + slot].clone()
                        } else {
                            env_at(&env, d - 1).slots.borrow()[slot].clone()
                        }
                    }};
                }
                macro_rules! set_var {
                    ($d:expr, $slot:expr, $v:expr) => {{
                        let (d, slot, v) = ($d, $slot as usize, $v);
                        if !flat {
                            env_at(&env, d).slots.borrow_mut()[slot] = v;
                        } else if d == 0 {
                            locals[lbase + slot] = v;
                        } else {
                            env_at(&env, d - 1).slots.borrow_mut()[slot] = v;
                        }
                    }};
                }
                // GET's value, or its mistake
                macro_rules! got {
                    ($ins:expr) => {{
                        let v = var!($ins.a, $ins.b);
                        if let Value::Unset = v {
                            fail!(no_value(&func.text($ins.c)));
                        }
                        v
                    }};
                }
                // ADD_TO's work: adds `value` to the variable at depth and slot, named by constant `name`
                macro_rules! add_to {
                    ($d:expr, $slot:expr, $name:expr, $value:expr) => {{
                        let (d, slot, value) = ($d, $slot as usize, $value);
                        let e = if flat && d > 0 { env_at(&env, d - 1) } else { env_at(&env, d) };
                        let mut slots_of_env;
                        let (slots, slot): (&mut [Value], usize) = if flat && d == 0 {
                            (&mut locals[..], lbase + slot)
                        } else {
                            slots_of_env = e.slots.borrow_mut();
                            (&mut slots_of_env[..], slot)
                        };
                        check!(add_to_value(&mut slots[slot], value, &func, $name));
                    }};
                }
                // ADD, SUB, MUL or DIV (by its opcode) of two values
                macro_rules! math {
                    ($op:expr, $a:expr, $b:expr) => {{
                        let (op, a, b) = ($op, $a, $b);
                        match (&a, &b) {
                            (Value::Num(x), Value::Num(y)) if op != DIV || *y != 0.0 => Value::Num(match op {
                                ADD => x + y,
                                SUB => x - y,
                                MUL => x * y,
                                _ => x / y,
                            }),
                            _ if op == ADD => check!(plus(&a, &b)),
                            _ => check!(arithmetic(
                                if op == SUB {
                                    "-"
                                } else if op == MUL {
                                    "*"
                                } else {
                                    "/"
                                },
                                &a,
                                &b
                            )),
                        }
                    }};
                }
                pc = ip;
                let ins = code[ip];
                let op = ins.op as i32;
                ip = ins.next as usize;
                match op {
                    GET => {
                        let (d, slot) = (ins.a, ins.b as usize);
                        let v = if !flat {
                            env_at(&env, d).slots.borrow()[slot].clone()
                        } else if d == 0 {
                            locals[lbase + slot].clone()
                        } else {
                            env_at(&env, d - 1).slots.borrow()[slot].clone()
                        };
                        if let Value::Unset = v {
                            fail!(no_value(&func.text(ins.c)));
                        }
                        stack.push(v);
                    }
                    SET => {
                        let v = pop!();
                        let (d, slot) = (ins.a, ins.b as usize);
                        if !flat {
                            env_at(&env, d).slots.borrow_mut()[slot] = v;
                        } else if d == 0 {
                            locals[lbase + slot] = v;
                        } else {
                            env_at(&env, d - 1).slots.borrow_mut()[slot] = v;
                        }
                    }
                    CONST => {
                        let Const::Val(v) = &func.consts[ins.a as usize] else { unreachable!() };
                        stack.push(v.clone());
                    }
                    JUMP => {
                        let to = ins.a as usize;
                        if to < ip {
                            steps += 1.0;
                            if steps > max_steps {
                                break 'run stopped(max_steps);
                            }
                        }
                        ip = to;
                    }
                    JUMP_IF_FALSE => {
                        let to = ins.a as usize;
                        if !truthy(&pop!()) {
                            ip = to;
                        }
                    }
                    COMPARE => {
                        let b = pop!();
                        let a = pop!();
                        stack.push(Value::Bool(check!(compare_values(ins.a as usize, &a, &b))));
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
                        let (d, slot) = (ins.a, ins.b as usize);
                        let f = if !flat {
                            env_at(&env, d).slots.borrow()[slot].clone()
                        } else if d == 0 {
                            locals[lbase + slot].clone()
                        } else {
                            env_at(&env, d - 1).slots.borrow()[slot].clone()
                        };
                        stack.push(check!(got_fn(f, &func, ins.c)));
                    }
                    CALL => {
                        let argc = ins.a as usize;
                        let name_at = ins.b;
                        let first = stack.len() - argc;
                        let Value::Func(callee) = stack[first - 1].clone() else { unreachable!() };
                        check!(check_call(&callee, &stack[first..], &func, name_at));
                        if frames.len() >= MAX_DEPTH {
                            fail!("too much recursion: a function kept calling itself".into());
                        }
                        steps += 1.0;
                        if steps > max_steps {
                            break 'run stopped(max_steps);
                        }
                        let callee_flat = callee.func.is_flat();
                        let (inner, inner_lbase) = if callee_flat {
                            // its variables on `locals`, its inputs first after slot 0
                            let lb = locals.len();
                            locals.push(Value::Unset);
                            locals.extend(stack.drain(first..));
                            locals.resize(lb + callee.func.nslots + 1, Value::Unset);
                            (callee.env.clone(), lb)
                        } else {
                            let inner = new_env(&callee.func, Some(callee.env.clone()));
                            {
                                let mut slots = inner.slots.borrow_mut();
                                for (i, v) in stack.drain(first..).enumerate() {
                                    slots[i + 1] = v;
                                }
                            }
                            (inner, lbase)
                        };
                        stack.pop();
                        let caller = std::mem::replace(&mut func, callee.func.clone());
                        code = func.decoded();
                        frames.push(Frame {
                            func: caller,
                            ip,
                            env: std::mem::replace(&mut env, inner),
                            base,
                            lbase: std::mem::replace(&mut lbase, inner_lbase),
                            flat: std::mem::replace(&mut flat, callee_flat),
                        });
                        ip = 0;
                        base = stack.len();
                    }
                    RETURN => {
                        while handlers.last().is_some_and(|h| h.frames == frames.len()) {
                            handlers.pop(); // its tries end with it
                        }
                        let Some(frame) = frames.pop() else {
                            break 'run Failure { message: String::new(), value: None, last: true };
                            // the function this machine ran is done
                        };
                        let value = pop!();
                        stack.truncate(base);
                        stack.push(value);
                        if flat {
                            locals.truncate(lbase);
                        }
                        func = frame.func;
                        code = func.decoded();
                        ip = frame.ip;
                        env = frame.env;
                        base = frame.base;
                        lbase = frame.lbase;
                        flat = frame.flat;
                    }
                    POP => {
                        stack.pop();
                    }
                    AND => {
                        let to = ins.a as usize;
                        if truthy(stack.last().unwrap()) {
                            stack.pop();
                        } else {
                            ip = to;
                        }
                    }
                    OR => {
                        let to = ins.a as usize;
                        if truthy(stack.last().unwrap()) {
                            ip = to;
                        } else {
                            stack.pop();
                        }
                    }
                    NEG => {
                        let v = pop!();
                        stack.push(check!(negate_value(v)));
                    }
                    NOT => {
                        let v = pop!();
                        stack.push(Value::Bool(!truthy(&v)));
                    }
                    LIST => {
                        let n = ins.a as usize;
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
                        stack.push(check!(item_value(&target, &n)));
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
                        let n = ins.a as usize;
                        let start = stack.len() - n;
                        let d = check!(make_dict(&stack[start..]));
                        stack.truncate(start);
                        stack.push(d);
                    }
                    REMOVE => {
                        let dictionary = pop!();
                        let key = pop!();
                        check!(remove_key(&key, &dictionary));
                    }
                    ADD_TO => {
                        let value = pop!();
                        add_to!(ins.a, ins.b, ins.c, value);
                    }
                    // the instructions fuse() makes: each does what its parts would, and fails as they would
                    RANGE_SET => {
                        let top = stack.len();
                        let (Value::Num(next), Value::Num(last)) = (&stack[top - 2], &stack[top - 1]) else { unreachable!() };
                        let (next, last) = (*next, *last);
                        if num::at_most(next, last) {
                            stack[top - 2] = Value::Num(next + 1.0);
                            set_var!(ins.b, ins.c, Value::Num(next));
                        } else {
                            stack.truncate(top - 2);
                            ip = ins.a as usize;
                        }
                    }
                    GET_ADD_TO => {
                        let value = got!(ins);
                        pc = ins.f as usize;
                        add_to!(ins.d, ins.e, code[pc].c, value);
                    }
                    GET_SET => {
                        let value = got!(ins);
                        set_var!(ins.d, ins.e, value);
                    }
                    ITER_SET => match iter_next(stack.last().unwrap()) {
                        Some(v) => set_var!(ins.b, ins.c, v),
                        None => {
                            stack.pop();
                            ip = ins.a as usize;
                        }
                    },
                    GET_GET_COMPARE => {
                        let a = got!(ins);
                        pc = ins.e as usize;
                        let b = got!(code[pc]);
                        pc = ins.f as usize;
                        stack.push(Value::Bool(check!(compare_values(ins.d as usize, &a, &b))));
                    }
                    GET_GET_MATH => {
                        let a = got!(ins);
                        pc = ins.e as usize;
                        let b = got!(code[pc]);
                        pc = ins.f as usize;
                        stack.push(math!(ins.d, a, b));
                    }
                    CONST_SET => {
                        let Const::Val(v) = &func.consts[ins.a as usize] else { unreachable!() };
                        set_var!(ins.b, ins.c, v.clone());
                    }
                    GET_CONST_COMPARE => {
                        let a = got!(ins);
                        let Const::Val(b) = &func.consts[ins.d as usize] else { unreachable!() };
                        pc = ins.f as usize;
                        stack.push(Value::Bool(check!(compare_values(ins.e as usize, &a, b))));
                    }
                    GET_CONST_MATH => {
                        let a = got!(ins);
                        let Const::Val(b) = &func.consts[ins.d as usize] else { unreachable!() };
                        pc = ins.f as usize;
                        stack.push(math!(ins.e, a, b.clone()));
                    }
                    SAY => {
                        let n = ins.a as usize;
                        let start = stack.len() - n;
                        let line = check!(said(&stack[start..]));
                        stack.truncate(start);
                        self.host.print(&line);
                    }
                    CHECK_REPEAT => {
                        let n = check!(repeat_count(stack.last().unwrap()));
                        *stack.last_mut().unwrap() = n;
                    }
                    REPEAT_NEXT => {
                        let exit = ins.a as usize;
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
                        check!(check_range(&stack[stack.len() - 2], &stack[stack.len() - 1]));
                    }
                    RANGE_NEXT => {
                        let exit = ins.a as usize;
                        let top = stack.len();
                        let (Value::Num(next), Value::Num(last)) = (&stack[top - 2], &stack[top - 1]) else { unreachable!() };
                        let (next, last) = (*next, *last);
                        if num::at_most(next, last) {
                            stack[top - 2] = Value::Num(next + 1.0);
                            stack.push(Value::Num(next));
                        } else {
                            stack.truncate(top - 2);
                            ip = exit;
                        }
                    }
                    ITER => {
                        let v = pop!();
                        stack.push(check!(iter_of(&v)));
                    }
                    ITER_NEXT => {
                        let exit = ins.a as usize;
                        match iter_next(stack.last().unwrap()) {
                            Some(v) => stack.push(v),
                            None => {
                                stack.pop();
                                ip = exit;
                            }
                        }
                    }
                    MAKE_FN => {
                        let Const::Func(f) = &func.consts[ins.a as usize] else { unreachable!() };
                        stack.push(Value::Func(Rc::new(Closure { func: f.clone(), env: env.clone(), native: None })));
                    }
                    UNDEFINED => fail!(func.text(ins.a).to_string()),
                    RECORD => {
                        let Const::Fields(fields) = &func.consts[ins.a as usize] else { unreachable!() };
                        let start = stack.len() - fields.len();
                        let r = make_record(fields, stack.drain(start..));
                        stack.push(r);
                    }
                    FIELD => {
                        let record = pop!();
                        stack.push(check!(field_value(&record, func.text(ins.a))));
                    }
                    RECORD_REF => {
                        check!(record_ref(stack.last().unwrap(), &func.text(ins.a)));
                    }
                    SET_FIELD => {
                        let value = pop!();
                        let record = pop!();
                        set_field(record, func.text(ins.a), value);
                    }
                    ASK => {
                        let question = pop!();
                        stack.push(check!(ask_answer(self.host, &question)));
                    }
                    READ => {
                        let name = pop!();
                        stack.push(check!(read_value(self.host, &name, ins.a == 1)));
                    }
                    WRITE => {
                        let name = pop!();
                        let value = pop!();
                        check!(write_value(self.host, &value, &name));
                    }
                    HANDLE => {
                        let event = EVENTS[ins.a as usize];
                        stack.pop(); // the handler
                        self.listeners.push(Listener { event, interval: None });
                    }
                    EVERY => {
                        stack.pop(); // the handler
                        let interval = pop!();
                        let l = check!(every_listener(interval, ins.a as f64));
                        self.listeners.push(l);
                    }
                    RANDOM => {
                        let high = pop!();
                        let low = pop!();
                        stack.push(check!(random_value(self.host, &low, &high)));
                    }
                    ARGUMENTS => {
                        let args = self.host.args();
                        stack.push(list(args.iter().map(|a| text(a)).collect()));
                    }
                    EXPECT => {
                        let o = ins.a;
                        let negate = ins.b == 1;
                        if o < 0 {
                            let v = pop!();
                            check!(expect_yes(&v));
                        } else {
                            let b = pop!();
                            let a = pop!();
                            check!(expect_that(o as usize, negate, &a, &b));
                        }
                    }
                    TRY => {
                        handlers.push(Handler {
                            ip: ins.a as usize,
                            frames: frames.len(),
                            stack: stack.len(),
                            func: func.clone(),
                            env: env.clone(),
                            base,
                            lbase,
                            flat,
                            locals: locals.len(),
                        });
                    }
                    END_TRY => {
                        handlers.pop();
                    }
                    CAUGHT => stack.push(caught.clone()),
                    BUILTIN => {
                        let index = ins.a as usize;
                        let start = stack.len() - BUILTINS[index].1;
                        let made = check!(builtin_value(index, &stack[start..]));
                        stack.truncate(start);
                        stack.push(made);
                    }
                    FAIL => {
                        let v = pop!();
                        break 'run fail_with(v);
                    }
                    TURTLE => {
                        let action = ins.a as usize;
                        let bare = matches!(TURTLE_ACTIONS[action], "up" | "down" | "clear");
                        let value = if bare { None } else { stack.pop() };
                        check!(self.turtle.act(action, value, self.host));
                    }
                    LINE => {}
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
            code = func.decoded();
            env = h.env;
            base = h.base;
            lbase = h.lbase;
            flat = h.flat;
            locals.truncate(h.locals);
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
