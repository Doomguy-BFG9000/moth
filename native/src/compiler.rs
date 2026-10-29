// Syntax tree -> bytecode, as moth.js's Compiler (with scope.js's Scope) does: the same instructions and the
// same constants, in the same order, so `moth-native bytecode` and `moth bytecode` print the same.
use crate::error::{MothError, Pos};
use crate::lexer::tokenize;
use crate::parser::{declarations, parse, Expr, Func, Lit, Reading, Stmt, COMPARISONS};
use crate::value::{closest, Value};
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

// Each opcode and how many operands follow it, in vm.js's order
pub const OPCODES: [(&str, usize); 55] = [
    ("GET", 3),
    ("SET", 2),
    ("CONST", 1),
    ("JUMP", 1),
    ("JUMP_IF_FALSE", 1),
    ("COMPARE", 1),
    ("ADD", 0),
    ("SUB", 0),
    ("MUL", 0),
    ("DIV", 0),
    ("CALL", 2),
    ("GET_FN", 3),
    ("RETURN", 0),
    ("POP", 0),
    ("AND", 1),
    ("OR", 1),
    ("NEG", 0),
    ("NOT", 0),
    ("LIST", 1),
    ("LENGTH", 0),
    ("ITEM", 0),
    ("ITEM_REF", 0),
    ("SET_ITEM", 0),
    ("ADD_TO", 3),
    ("SAY", 1),
    ("CHECK_REPEAT", 0),
    ("REPEAT_NEXT", 1),
    ("CHECK_RANGE", 0),
    ("RANGE_NEXT", 1),
    ("ITER", 0),
    ("ITER_NEXT", 1),
    ("MAKE_FN", 1),
    ("UNDEFINED", 1),
    ("HALT", 0),
    ("LINE", 1),
    ("TURTLE", 1),
    ("RECORD", 1),
    ("FIELD", 1),
    ("RECORD_REF", 1),
    ("SET_FIELD", 1),
    ("FAIL", 0),
    ("BUILTIN", 1),
    ("ASK", 0),
    ("TRY", 1),
    ("END_TRY", 0),
    ("CAUGHT", 0),
    ("DICT", 1),
    ("REMOVE", 0),
    ("READ", 1),
    ("WRITE", 0),
    ("ARGUMENTS", 0),
    ("EXPECT", 2),
    ("RANDOM", 0),
    ("HANDLE", 1),
    ("EVERY", 1),
];
pub mod op {
    pub const GET: i32 = 0;
    pub const SET: i32 = 1;
    pub const CONST: i32 = 2;
    pub const JUMP: i32 = 3;
    pub const JUMP_IF_FALSE: i32 = 4;
    pub const COMPARE: i32 = 5;
    pub const ADD: i32 = 6;
    pub const SUB: i32 = 7;
    pub const MUL: i32 = 8;
    pub const DIV: i32 = 9;
    pub const CALL: i32 = 10;
    pub const GET_FN: i32 = 11;
    pub const RETURN: i32 = 12;
    pub const POP: i32 = 13;
    pub const AND: i32 = 14;
    pub const OR: i32 = 15;
    pub const NEG: i32 = 16;
    pub const NOT: i32 = 17;
    pub const LIST: i32 = 18;
    pub const LENGTH: i32 = 19;
    pub const ITEM: i32 = 20;
    pub const ITEM_REF: i32 = 21;
    pub const SET_ITEM: i32 = 22;
    pub const ADD_TO: i32 = 23;
    pub const SAY: i32 = 24;
    pub const CHECK_REPEAT: i32 = 25;
    pub const REPEAT_NEXT: i32 = 26;
    pub const CHECK_RANGE: i32 = 27;
    pub const RANGE_NEXT: i32 = 28;
    pub const ITER: i32 = 29;
    pub const ITER_NEXT: i32 = 30;
    pub const MAKE_FN: i32 = 31;
    pub const UNDEFINED: i32 = 32;
    pub const HALT: i32 = 33;
    pub const LINE: i32 = 34;
    pub const TURTLE: i32 = 35;
    pub const RECORD: i32 = 36;
    pub const FIELD: i32 = 37;
    pub const RECORD_REF: i32 = 38;
    pub const SET_FIELD: i32 = 39;
    pub const FAIL: i32 = 40;
    pub const BUILTIN: i32 = 41;
    pub const ASK: i32 = 42;
    pub const TRY: i32 = 43;
    pub const END_TRY: i32 = 44;
    pub const CAUGHT: i32 = 45;
    pub const DICT: i32 = 46;
    pub const REMOVE: i32 = 47;
    pub const READ: i32 = 48;
    pub const WRITE: i32 = 49;
    pub const ARGUMENTS: i32 = 50;
    pub const EXPECT: i32 = 51;
    pub const RANDOM: i32 = 52;
    pub const HANDLE: i32 = 53;
    pub const EVERY: i32 = 54;
}
use op::*;

// Moth's built-in operations, in vm.js's BUILTINS order, with how many inputs each takes
pub const BUILTINS: [(&str, usize); 19] = [
    ("uppercase", 1),
    ("lowercase", 1),
    ("split", 2),
    ("join", 2),
    ("number", 1),
    ("position", 2),
    ("keys", 1),
    ("bit and", 2),
    ("bit or", 2),
    ("bit xor", 2),
    ("shift left", 2),
    ("shift right", 2),
    ("bytes", 1),
    ("as bytes", 1),
    ("as text", 1),
    ("as hex", 1),
    ("as binary", 1),
    ("unit", 2), // `5 km`
    ("in", 2),   // `trip in miles`
];
pub const TURTLE_ACTIONS: [&str; 13] =
    ["forward", "back", "left", "right", "up", "down", "color", "width", "to", "clear", "box", "circle", "text"];
pub const EVENTS: [&str; 3] = ["key", "click", "drag"];
const STATEMENT_WORDS: [&str; 20] = [
    "set", "add", "say", "if", "repeat", "for", "to", "return", "move", "turn", "pen", "fail", "stop", "use", "try", "remove", "write",
    "expect", "when", "every",
];

#[derive(Debug)]
pub enum Const {
    Val(Value),
    Func(Rc<Function>),
    Fields(Rc<Vec<Rc<str>>>),
}

#[derive(Debug)]
pub struct Function {
    pub name: String,
    pub params: Vec<String>,
    pub kinds: Vec<i32>, // what each input says it is, by its place in KINDS, or -1; none at all if no input says
    pub nslots: usize,
    pub names: Vec<String>, // each slot's name; slot 0 links to the scope the function was made in
    pub code: Vec<i32>,
    pub consts: Vec<Const>,
    pub at: Vec<Option<Pos>>, // where each instruction came from, at the instruction's own index
    pub written: std::collections::HashMap<usize, Rc<str>>, // each number constant as written, by its place
}

impl Function {
    pub fn text(&self, i: i32) -> Rc<str> {
        match &self.consts[i as usize] {
            Const::Val(Value::Text(t)) => t.clone(),
            _ => panic!("constant {i} isn't text"),
        }
    }
}

struct Loop {
    state: usize,
    stops: Vec<usize>,
    tries: usize,
}

struct Frame {
    func: Function,
    slots: HashMap<String, usize>,
    order: Vec<String>, // the slots' names in the order they were declared
    loops: Vec<Loop>,
    tries: usize,
}

struct Compiler {
    frames: Vec<Frame>,
}

type R<T> = Result<T, MothError>;

// The program's source -> its main function. `files` gives the text of a file the program uses, by name, and
// `file` is the program's own name, if it has one.
pub fn compile(source: &str, files: &dyn Fn(&str) -> Option<String>, file: Option<&str>) -> R<Rc<Function>> {
    let body = parse_program(source, files, file)?;
    let mut c = Compiler { frames: vec![] };
    Ok(Rc::new(c.function("main".into(), vec![], &body)))
}

pub fn parse_program(source: &str, files: &dyn Fn(&str) -> Option<String>, file: Option<&str>) -> R<Vec<Stmt>> {
    let tokens = tokenize(source, None)?;
    let mut reading = Reading {
        files,
        loaded: file.map(|f| HashSet::from([f.to_string()])).unwrap_or_default(),
        open: file.map(|f| vec![f.to_string()]).unwrap_or_default(),
        within: String::new(),
        depth: 0,
    };
    parse(tokens, &mut reading)
}

impl Compiler {
    fn top(&mut self) -> &mut Frame {
        self.frames.last_mut().unwrap()
    }

    fn resolve(&self, name: &str) -> Option<(i32, i32)> {
        for (depth, f) in self.frames.iter().rev().enumerate() {
            if let Some(&slot) = f.slots.get(name) {
                return Some((depth as i32, slot as i32));
            }
        }
        None
    }

    fn declare(frame: &mut Frame, name: &str) {
        frame.func.nslots += 1;
        frame.slots.insert(name.to_string(), frame.func.nslots);
        frame.order.push(name.to_string());
        frame.func.names.push(name.to_string());
    }

    fn function(&mut self, name: String, params: Vec<String>, body: &[Stmt]) -> Function {
        let mut frame = Frame {
            func: Function {
                name,
                params: params.clone(),
                kinds: vec![],
                nslots: 0,
                names: vec![String::new()],
                code: vec![],
                consts: vec![],
                at: vec![],
                written: Default::default(),
            },
            slots: HashMap::new(),
            order: vec![],
            loops: vec![],
            tries: 0,
        };
        for p in &params {
            Self::declare(&mut frame, p);
        }
        let (mut own, mut shared) = (Vec::new(), Vec::new());
        declarations(body, &mut own, &mut shared);
        for n in &own {
            if !frame.slots.contains_key(n) {
                Self::declare(&mut frame, n);
            }
        }
        for n in &shared {
            if !frame.slots.contains_key(n) && self.resolve(n).is_none() {
                Self::declare(&mut frame, n);
            }
        }
        let has_parent = !self.frames.is_empty();
        self.frames.push(frame);
        for s in body {
            self.statement(s);
        }
        if has_parent {
            let k = self.constant(Value::Nothing);
            self.emit(None, &[CONST, k, RETURN]);
        } else {
            self.emit(None, &[HALT]);
        }
        self.frames.pop().unwrap().func
    }

    fn emit(&mut self, at: Option<&Pos>, code: &[i32]) {
        let f = &mut self.top().func;
        let i = f.code.len();
        f.at.resize(i + code.len(), None);
        f.at[i] = at.cloned();
        f.code.extend_from_slice(code);
    }

    fn add_const(&mut self, c: Const) -> i32 {
        let f = &mut self.top().func;
        f.consts.push(c);
        f.consts.len() as i32 - 1
    }
    fn constant(&mut self, v: Value) -> i32 {
        self.add_const(Const::Val(v))
    }
    fn text(&mut self, s: &str) -> i32 {
        self.constant(Value::Text(Rc::from(s)))
    }

    fn here(&mut self) -> i32 {
        self.top().func.code.len() as i32
    }

    fn jump(&mut self, at: &Pos, op: i32, to: i32) -> usize {
        self.emit(Some(at), &[op, to]);
        self.here() as usize - 1
    }

    fn patch(&mut self, i: usize) {
        let here = self.here();
        self.top().func.code[i] = here;
    }

    // What to say when a name nothing ever sets is used (scope.js's undefinedMessage)
    fn undefined_message(&self, name: &str, call: bool, statement: bool) -> String {
        let mut known: Vec<String> = Vec::new();
        for f in self.frames.iter().rev() {
            known.extend(f.order.iter().cloned());
        }
        if statement {
            known.extend(STATEMENT_WORDS.iter().map(|w| w.to_string()));
        }
        let guess = closest(name, &known);
        let message = if let Some(at) = name.find("'s ") {
            format!("'{}' has nothing called '{}'", &name[..at], &name[at + 3..])
        } else if call {
            format!("there is no function called '{name}'")
        } else if guess.is_some() {
            format!("'{name}' has no value yet")
        } else {
            format!("'{name}' has no value yet (give it one with 'set {name} to ...')")
        };
        match guess {
            Some(g) => format!("{message}. Did you mean '{g}'?"),
            None => message,
        }
    }

    fn undefined_name(&mut self, name: &str, at: &Pos, call: bool, statement: bool) {
        let message = self.undefined_message(name, call, statement);
        let k = self.text(&message);
        self.emit(Some(at), &[UNDEFINED, k]);
    }

    fn load(&mut self, name: &str, at: &Pos) {
        match self.resolve(name) {
            Some((d, s)) => {
                let k = self.text(name);
                self.emit(Some(at), &[GET, d, s, k]);
            }
            None => self.undefined_name(name, at, false, false),
        }
    }

    fn store(&mut self, name: &str, at: &Pos) {
        let (d, s) = self.resolve(name).expect("declarations() saw every name that is stored");
        self.emit(Some(at), &[SET, d, s]);
    }

    // `state` is how many values the loop keeps on the stack while it runs, which a `stop` takes off
    fn looped(&mut self, at: &Pos, name: Option<&str>, body: &[Stmt], next: i32, state: usize) {
        let top = self.here();
        let exit = self.jump(at, next, -1);
        if let Some(n) = name {
            self.store(n, at);
        }
        self.body(body, state);
        self.jump(at, JUMP, top);
        self.patch(exit);
        self.patch_stops();
    }

    fn body(&mut self, statements: &[Stmt], state: usize) {
        let tries = self.top().tries;
        self.top().loops.push(Loop { state, stops: vec![], tries });
        for s in statements {
            self.statement(s);
        }
    }

    fn patch_stops(&mut self) {
        let lp = self.top().loops.pop().unwrap();
        for i in lp.stops {
            self.patch(i);
        }
    }

    fn call(&mut self, name: &str, args: &[Expr], at: &Pos, statement: bool) {
        match self.resolve(name) {
            Some((d, s)) => {
                let k = self.text(name);
                self.emit(Some(at), &[GET_FN, d, s, k]);
            }
            None => self.undefined_name(name, at, true, statement),
        }
        for a in args {
            self.expr(a);
        }
        let k = self.text(name);
        self.emit(Some(at), &[CALL, args.len() as i32, k]);
    }

    fn statement(&mut self, s: &Stmt) {
        match s {
            Stmt::Set { name, value, at } => {
                self.expr(value);
                self.store(name, at);
            }
            Stmt::SetItem { of, index, target_at, value } => {
                self.expr(of);
                self.expr(index);
                self.emit(Some(target_at), &[ITEM_REF]);
                self.expr(value);
                self.emit(Some(target_at), &[SET_ITEM]);
            }
            Stmt::Add { value, name, at } => {
                self.expr(value);
                match self.resolve(name) {
                    Some((d, sl)) => {
                        let k = self.text(name);
                        self.emit(Some(at), &[ADD_TO, d, sl, k]);
                    }
                    None => self.undefined_name(name, at, false, false),
                }
            }
            Stmt::Say(parts, at) => {
                for p in parts {
                    self.expr(p);
                }
                self.emit(Some(at), &[SAY, parts.len() as i32]);
            }
            Stmt::If { cond, then, otherwise, at } => {
                self.expr(cond);
                let to_else = self.jump(at, JUMP_IF_FALSE, -1);
                for s in then {
                    self.statement(s);
                }
                let to_end = self.jump(at, JUMP, -1);
                self.patch(to_else);
                for s in otherwise {
                    self.statement(s);
                }
                self.patch(to_end);
            }
            Stmt::While { cond, body, at } => {
                let top = self.here();
                self.expr(cond);
                let exit = self.jump(at, JUMP_IF_FALSE, -1);
                self.body(body, 0);
                self.jump(at, JUMP, top);
                self.patch(exit);
                self.patch_stops();
            }
            Stmt::Repeat { count, body, at } => {
                self.expr(count);
                self.emit(Some(at), &[CHECK_REPEAT]);
                self.looped(at, None, body, REPEAT_NEXT, 1);
            }
            Stmt::Count { name, from, to, body, at } => {
                self.expr(from);
                self.expr(to);
                self.emit(Some(at), &[CHECK_RANGE]);
                self.looped(at, Some(name), body, RANGE_NEXT, 2);
            }
            Stmt::Each { name, list, body, at } => {
                self.expr(list);
                self.emit(Some(at), &[ITER]);
                self.looped(at, Some(name), body, ITER_NEXT, 1);
            }
            Stmt::Define(f) => {
                let made = self.child(f);
                let k = self.add_const(Const::Func(made));
                self.emit(Some(&f.at), &[MAKE_FN, k]);
                self.store(&f.name, &f.at);
            }
            Stmt::When { event, func, at } => {
                let made = self.child(func);
                let k = self.add_const(Const::Func(made));
                self.emit(Some(at), &[MAKE_FN, k]);
                let e = EVENTS.iter().position(|x| x == event).unwrap() as i32;
                self.emit(Some(at), &[HANDLE, e]);
            }
            Stmt::Every { interval, unit, func, at } => {
                let made = self.child(func);
                self.expr(interval);
                let k = self.add_const(Const::Func(made));
                self.emit(Some(at), &[MAKE_FN, k]);
                self.emit(Some(at), &[EVERY, *unit]);
            }
            Stmt::Return(value, at) => {
                match value {
                    Some(v) => self.expr(v),
                    None => {
                        let k = self.constant(Value::Nothing);
                        self.emit(Some(at), &[CONST, k]);
                    }
                }
                self.emit(Some(at), &[RETURN]);
            }
            Stmt::Call(name, args, at) => {
                self.call(name, args, at, true);
                self.emit(Some(at), &[POP]);
            }
            Stmt::Turtle { action, value, at } => {
                if let Some(v) = value {
                    self.expr(v);
                }
                let a = TURTLE_ACTIONS.iter().position(|x| x == action).unwrap() as i32;
                self.emit(Some(at), &[TURTLE, a]);
            }
            Stmt::SetField { name, target, value, at } => {
                self.expr(target);
                let k = self.text(name);
                self.emit(Some(at), &[RECORD_REF, k]);
                self.expr(value);
                let k = self.text(name);
                self.emit(Some(at), &[SET_FIELD, k]);
            }
            Stmt::Fail(value, at) => {
                self.expr(value);
                self.emit(Some(at), &[FAIL]);
            }
            Stmt::Remove { key, target, at } => {
                self.expr(key);
                self.expr(target);
                self.emit(Some(at), &[REMOVE]);
            }
            Stmt::Write { value, target, at } => {
                self.expr(value);
                self.expr(target);
                self.emit(Some(at), &[WRITE]);
            }
            Stmt::Expect(cond, at) => {
                if let Expr::Compare { op, negate, left, right, .. } = cond {
                    self.expr(left);
                    self.expr(right);
                    let o = COMPARISONS.iter().position(|x| x == op).unwrap() as i32;
                    self.emit(Some(at), &[EXPECT, o, if *negate { 1 } else { 0 }]);
                } else {
                    self.expr(cond);
                    self.emit(Some(at), &[EXPECT, -1, 0]);
                }
            }
            Stmt::Try { body, name, handler, at } => {
                let to_handler = self.jump(at, TRY, -1);
                self.top().tries += 1;
                for s in body {
                    self.statement(s);
                }
                self.top().tries -= 1;
                self.emit(Some(at), &[END_TRY]);
                let end = self.jump(at, JUMP, -1);
                self.patch(to_handler);
                self.emit(Some(at), &[CAUGHT]);
                match name {
                    Some(n) => self.store(n, at),
                    None => self.emit(Some(at), &[POP]),
                }
                for s in handler {
                    self.statement(s);
                }
                self.patch(end);
            }
            Stmt::Stop(at) => {
                let (from, state) = {
                    let lp = self.top().loops.last().unwrap();
                    (lp.tries, lp.state)
                };
                let tries = self.top().tries;
                for _ in from..tries {
                    self.emit(Some(at), &[END_TRY]);
                }
                for _ in 0..state {
                    self.emit(Some(at), &[POP]);
                }
                let j = self.jump(at, JUMP, -1);
                self.top().loops.last_mut().unwrap().stops.push(j);
            }
        }
    }

    fn child(&mut self, f: &Func) -> Rc<Function> {
        let mut made = self.function(f.name.clone(), f.params.clone(), &f.body);
        if f.kinds.iter().any(|&k| k >= 0) {
            made.kinds = f.kinds.clone(); // checked at each call
        }
        Rc::new(made)
    }

    fn expr(&mut self, e: &Expr) {
        match e {
            Expr::Value(lit, at) => {
                if let Lit::Num(n, written) = lit {
                    let k = self.constant(Value::Num(*n));
                    self.top().func.written.insert(k as usize, written.clone());
                    self.emit(Some(at), &[CONST, k]);
                    return;
                }
                let v = match lit {
                    Lit::Num(..) => unreachable!(),
                    Lit::Text(t) => Value::Text(t.clone()),
                    Lit::Bool(b) => Value::Bool(*b),
                    Lit::Nothing => Value::Nothing,
                };
                let k = self.constant(v);
                self.emit(Some(at), &[CONST, k]);
            }
            Expr::Name(name, at) => self.load(name, at),
            Expr::Call(name, args, at) => self.call(name, args, at, false),
            Expr::Math(o, l, r, at) => {
                self.expr(l);
                self.expr(r);
                let code = match *o {
                    "+" => ADD,
                    "-" => SUB,
                    "*" => MUL,
                    _ => DIV,
                };
                self.emit(Some(at), &[code]);
            }
            Expr::Compare { op, negate, left, right, at } => {
                self.expr(left);
                self.expr(right);
                let o = COMPARISONS.iter().position(|x| x == op).unwrap() as i32;
                self.emit(Some(at), &[COMPARE, o]);
                if *negate {
                    self.emit(Some(at), &[NOT]);
                }
            }
            Expr::And(l, r, at) | Expr::Or(l, r, at) => {
                self.expr(l);
                let end = self.jump(at, if matches!(e, Expr::And(..)) { AND } else { OR }, -1);
                self.expr(r);
                self.patch(end);
            }
            Expr::Not(a, at) => {
                self.expr(a);
                self.emit(Some(at), &[NOT]);
            }
            Expr::Negate(a, at) => {
                self.expr(a);
                self.emit(Some(at), &[NEG]);
            }
            Expr::List(items, at) => {
                for i in items {
                    self.expr(i);
                }
                self.emit(Some(at), &[LIST, items.len() as i32]);
            }
            Expr::Length(of, at) => {
                self.expr(of);
                self.emit(Some(at), &[LENGTH]);
            }
            Expr::Item { index, of, at } => {
                self.expr(of);
                self.expr(index);
                self.emit(Some(at), &[ITEM]);
            }
            Expr::Record { fields, values, at } => {
                for v in values {
                    self.expr(v);
                }
                let k = self.add_const(Const::Fields(Rc::new(fields.iter().map(|f| Rc::from(f.as_str())).collect())));
                self.emit(Some(at), &[RECORD, k]);
            }
            Expr::Dictionary(items, at) => {
                for i in items {
                    self.expr(i);
                }
                self.emit(Some(at), &[DICT, items.len() as i32]);
            }
            Expr::Field { name, of, at } => {
                self.expr(of);
                let k = self.text(name);
                self.emit(Some(at), &[FIELD, k]);
            }
            Expr::Ask(q, at) => {
                self.expr(q);
                self.emit(Some(at), &[ASK]);
            }
            Expr::Read { bytes, of, at } => {
                self.expr(of);
                self.emit(Some(at), &[READ, if *bytes { 1 } else { 0 }]);
            }
            Expr::Arguments(at) => self.emit(Some(at), &[ARGUMENTS]),
            Expr::Random(l, r, at) => {
                self.expr(l);
                self.expr(r);
                self.emit(Some(at), &[RANDOM]);
            }
            Expr::Builtin(name, args, at) => {
                for a in args {
                    self.expr(a);
                }
                let b = BUILTINS.iter().position(|(n, _)| n == name).unwrap() as i32;
                self.emit(Some(at), &[BUILTIN, b]);
            }
        }
    }
}

// ---------- reading bytecode ----------

// JSON.stringify of a constant, with yes, no and nothing as Moth writes them
fn shown(v: &Value) -> String {
    match v {
        Value::Nothing => "nothing".into(),
        Value::Bool(b) => (if *b { "yes" } else { "no" }).into(),
        Value::Num(n) => {
            if n.is_finite() {
                crate::num::show(*n)
            } else {
                "null".into()
            }
        }
        Value::Text(t) => crate::value::json_string(t),
        _ => String::new(),
    }
}

// what an instruction's operands mean, where a number alone wouldn't say
fn note(f: &Function, name: &str, args: &[i32], scopes: &[&Function]) -> String {
    let text = |i: i32| f.text(i).to_string();
    match name {
        "SET" => scopes[scopes.len() - 1 - args[0] as usize].names[args[1] as usize].clone(),
        "LINE" => format!("line {}", args[0]),
        "CONST" => match &f.consts[args[0] as usize] {
            Const::Val(v) => shown(v),
            _ => String::new(),
        },
        "MAKE_FN" => match &f.consts[args[0] as usize] {
            Const::Func(g) => format!("function {}", g.name),
            _ => String::new(),
        },
        "GET" | "GET_FN" | "ADD_TO" => text(args[2]),
        "CALL" => text(args[1]),
        "UNDEFINED" => text(args[0]),
        "COMPARE" => {
            if args[0] != 0 {
                format!("is {}", COMPARISONS[args[0] as usize])
            } else {
                "is".into()
            }
        }
        "RECORD" => match &f.consts[args[0] as usize] {
            Const::Fields(fs) => fs.iter().map(|s| s.to_string()).collect::<Vec<_>>().join(", "),
            _ => String::new(),
        },
        "FIELD" | "RECORD_REF" | "SET_FIELD" => text(args[0]),
        "BUILTIN" => BUILTINS[args[0] as usize].0.to_string(),
        _ => String::new(),
    }
}

// Bytecode as readable text, as moth.js's disassemble() writes it
pub fn disassemble(f: &Function) -> String {
    let mut out = Vec::new();
    disassemble_into(f, &mut vec![f], &mut out);
    out.join("\n")
}

fn disassemble_into<'a>(f: &'a Function, scopes: &mut Vec<&'a Function>, out: &mut Vec<String>) {
    let inputs: Vec<String> = f
        .params
        .iter()
        .enumerate()
        .map(|(i, p)| match f.kinds.get(i) {
            Some(&k) if k >= 0 => format!("{p} as {}", crate::parser::KINDS[k as usize]),
            _ => p.clone(),
        })
        .collect();
    let with = if inputs.is_empty() { String::new() } else { format!(" with {}", inputs.join(", ")) };
    out.push(format!("{}{}:", f.name, with));
    let mut i = 0;
    while i < f.code.len() {
        let (name, count) = OPCODES[f.code[i] as usize];
        let args = &f.code[i + 1..i + 1 + count];
        let why = note(f, name, args, scopes);
        let args_text = args.iter().map(|a| a.to_string()).collect::<Vec<_>>().join(" ");
        let line = format!("  {:>4}  {:<13} {:<8}{}", i, name, args_text, if why.is_empty() { String::new() } else { format!(" ; {why}") });
        out.push(line.trim_end().to_string());
        i += 1 + count;
    }
    for c in &f.consts {
        if let Const::Func(g) = c {
            scopes.push(g);
            disassemble_into(g, scopes, out);
            scopes.pop();
        }
    }
}
