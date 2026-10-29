// Tokens -> syntax tree, as moth.js's parse() does: the same tree, and the same mistakes at the same spots.
use crate::error::{MothError, Pos};
use crate::lexer::{tokenize, Kind, Token};
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone, Debug)]
pub enum Lit {
    Num(f64),
    Text(Rc<str>),
    Bool(bool),
    Nothing,
}

#[derive(Clone, Debug)]
pub enum Expr {
    Value(Lit, Pos),
    Name(String, Pos),
    Call(String, Vec<Expr>, Pos),
    Math(&'static str, Box<Expr>, Box<Expr>, Pos),
    Compare { op: &'static str, negate: bool, left: Box<Expr>, right: Box<Expr>, at: Pos },
    And(Box<Expr>, Box<Expr>, Pos),
    Or(Box<Expr>, Box<Expr>, Pos),
    Not(Box<Expr>, Pos),
    Negate(Box<Expr>, Pos),
    List(Vec<Expr>, Pos),
    Length(Box<Expr>, Pos),
    Item { index: Box<Expr>, of: Box<Expr>, at: Pos },
    Record { fields: Vec<String>, values: Vec<Expr>, at: Pos },
    Dictionary(Vec<Expr>, Pos),
    Field { name: String, of: Box<Expr>, at: Pos },
    Ask(Box<Expr>, Pos),
    Read { bytes: bool, of: Box<Expr>, at: Pos },
    Arguments(Pos),
    Random(Box<Expr>, Box<Expr>, Pos),
    Builtin(String, Vec<Expr>, Pos),
}

#[derive(Clone, Debug)]
pub struct Func {
    pub name: String,
    pub params: Vec<String>,
    pub kinds: Vec<i32>, // what each input says it is (`with width as a number`), by its place in KINDS; -1 if it doesn't
    pub body: Vec<Stmt>,
    pub at: Pos,
}

#[derive(Clone, Debug)]
pub enum Stmt {
    Set { name: String, value: Expr, at: Pos },
    SetItem { of: Expr, index: Expr, target_at: Pos, value: Expr },
    SetField { name: String, target: Expr, value: Expr, at: Pos },
    Add { value: Expr, name: String, at: Pos },
    Say(Vec<Expr>, Pos),
    If { cond: Expr, then: Vec<Stmt>, otherwise: Vec<Stmt>, at: Pos },
    While { cond: Expr, body: Vec<Stmt>, at: Pos },
    Repeat { count: Expr, body: Vec<Stmt>, at: Pos },
    Count { name: String, from: Expr, to: Expr, body: Vec<Stmt>, at: Pos },
    Each { name: String, list: Expr, body: Vec<Stmt>, at: Pos },
    Define(Func),
    When { event: &'static str, func: Func, at: Pos },
    Every { interval: Expr, unit: i32, func: Func, at: Pos },
    Return(Option<Expr>, Pos),
    Fail(Expr, Pos),
    Try { body: Vec<Stmt>, name: Option<String>, handler: Vec<Stmt>, at: Pos },
    Stop(Pos),
    Remove { key: Expr, target: Expr, at: Pos },
    Expect(Expr, Pos),
    Write { value: Expr, target: Expr, at: Pos },
    Turtle { action: &'static str, value: Option<Expr>, at: Pos },
    Call(String, Vec<Expr>, Pos),
}

// words that start a statement or a value, so they can't name a variable
pub const RESERVED: &[&str] = &[
    "set",
    "add",
    "say",
    "if",
    "else",
    "end",
    "repeat",
    "while",
    "for",
    "to",
    "return",
    "and",
    "or",
    "not",
    "is",
    "yes",
    "no",
    "nothing",
    "list",
    "empty",
    "length",
    "item",
    "move",
    "turn",
    "pen",
    "record",
    "fail",
    "stop",
    "uppercase",
    "lowercase",
    "split",
    "join",
    "number",
    "position",
    "ask",
    "use",
    "try",
    "dictionary",
    "remove",
    "keys",
    "in",
    "byte",
    "bytes",
    "as",
    "shift",
    "read",
    "write",
    "arguments",
    "expect",
    "clear",
    "draw",
    "when",
    "every",
];
pub fn reserved(w: &str) -> bool {
    RESERVED.contains(&w)
}

// the comparisons that take two words: `is less than`, `is at least`...
pub const COMPARISONS: [&str; 7] = ["is", "less than", "greater than", "at least", "at most", "divisible by", "in"];

// built-in operations by the word that starts them: the word after it, if any, then one input, or two with a word between
fn builtin_syntax(w: &str) -> Option<(Option<&'static str>, Option<&'static str>)> {
    Some(match w {
        "uppercase" | "lowercase" | "number" | "keys" => (Some("of"), None),
        "split" => (None, Some("by")),
        "join" => (None, Some("with")),
        "position" => (Some("of"), Some("in")),
        _ => return None,
    })
}
const BIT_WORDS: [&str; 3] = ["and", "or", "xor"];
// what an input can say it is, in the order of KINDS in vm.js
pub const KINDS: [&str; 8] = ["a number", "text", "yes or no", "a list", "a record", "a dictionary", "bytes", "a function"];
const AS_WORDS: [&str; 4] = ["bytes", "text", "hex", "binary"];
fn turtle_words(w: &str) -> Option<&'static [&'static str]> {
    match w {
        "move" => Some(&["forward", "back", "to"]),
        "turn" => Some(&["left", "right"]),
        "pen" => Some(&["up", "down", "color", "width"]),
        _ => None,
    }
}

// How deep the parser may go: JavaScript's own stack runs out somewhere between 900 and 3,750 levels,
// depending on what is nested; this engine always goes at least as deep, then stops the same way.
const MAX_NESTING: u32 = if cfg!(target_family = "wasm") { 500 } else { 12_000 }; // a WebAssembly runtime's stack is smaller

// What files the program uses: `files` gives a file's text by name, `loaded` is every file read so far (each is
// read once for each set of names), `open` the files being read right now, `within` the alias they're read as.
pub struct Reading<'f> {
    pub files: &'f dyn Fn(&str) -> Option<String>,
    pub loaded: HashSet<String>,
    pub open: Vec<String>,
    pub within: String,
    pub depth: u32,
}

type R<T> = Result<T, MothError>;

pub fn nested_too_deeply() -> MothError {
    MothError::at(&Pos { line: 1, col: 1, file: None }, "the code is nested too deeply".into())
}

#[allow(clippy::large_enum_variant)] // made once per statement, so boxing would only add work
enum Parsed {
    One(Stmt),
    Many(Vec<Stmt>), // a used file's statements, in its place
}

struct Parser<'a, 'f> {
    tokens: Vec<Token>,
    pos: usize,
    at_top: bool,
    fn_depth: u32,
    loop_depth: u32,
    indexing: bool,
    reading: &'a mut Reading<'f>,
}

pub fn parse(tokens: Vec<Token>, reading: &mut Reading) -> R<Vec<Stmt>> {
    let mut p = Parser { tokens, pos: 0, at_top: false, fn_depth: 0, loop_depth: 0, indexing: false, reading };
    p.statements(None, false)
}

impl<'a, 'f> Parser<'a, 'f> {
    fn peek(&self) -> &Token {
        &self.tokens[self.pos]
    }
    fn ahead(&self, n: usize) -> Option<&Token> {
        self.tokens.get(self.pos + n)
    }
    fn check(&self, kind: Kind) -> bool {
        self.peek().kind == kind
    }
    fn matches(&mut self, kind: Kind) -> Option<Token> {
        if self.check(kind) {
            self.pos += 1;
            Some(self.tokens[self.pos - 1].clone())
        } else {
            None
        }
    }
    fn sym(&mut self, s: &'static str) -> Option<Token> {
        self.matches(Kind::Sym(s))
    }
    fn is_word(&self, w: &str) -> bool {
        self.peek().is_word(w)
    }
    fn word(&mut self, w: &str) -> Option<Token> {
        if self.is_word(w) {
            self.pos += 1;
            Some(self.tokens[self.pos - 1].clone())
        } else {
            None
        }
    }
    fn word_ahead(&self, n: usize, w: &str) -> bool {
        self.ahead(n).is_some_and(|t| t.is_word(w))
    }
    fn describe(t: &Token) -> String {
        match t.kind {
            Kind::Eof => "the end of the code".into(),
            Kind::Str => format!("\"{}\"", t.text),
            _ => format!("'{}'", t.text),
        }
    }
    fn fail<T>(&self, t: &Token, message: String) -> R<T> {
        Err(MothError::at(&t.pos(), message))
    }
    fn expected<T>(&self, what: &str) -> R<T> {
        let t = self.peek();
        self.fail(t, format!("expected {what} but found {}", Self::describe(t)))
    }
    fn expect_word(&mut self, w: &str) -> R<Token> {
        match self.word(w) {
            Some(t) => Ok(t),
            None => self.expected(&format!("'{w}'")),
        }
    }
    fn deeper(&mut self) -> R<()> {
        self.reading.depth += 1;
        if self.reading.depth > MAX_NESTING {
            return Err(nested_too_deeply());
        }
        Ok(())
    }
    fn shallower(&mut self) {
        self.reading.depth -= 1;
    }

    fn name(&mut self, what: &str) -> R<String> {
        let t = self.peek().clone();
        if t.kind != Kind::Word {
            return self.expected(what);
        }
        if reserved(&t.text) {
            return self.fail(&t, format!("'{}' is a Moth word, so it can't be used as {what}", t.text));
        }
        self.pos += 1;
        Ok(t.text)
    }

    // the line that starts a `try`'s handler: `if it fails`
    fn is_if_it_fails(&self) -> bool {
        self.is_word("if") && self.word_ahead(1, "it") && self.word_ahead(2, "fails")
    }

    // `in_try`: the statements of a `try`, which also end at its `if it fails`
    fn statements(&mut self, opener: Option<&Token>, in_try: bool) -> R<Vec<Stmt>> {
        self.deeper()?;
        let mut body = Vec::new();
        let outside = self.at_top;
        self.at_top = opener.is_none();
        loop {
            let more = match opener {
                Some(_) => !(self.is_word("end") || self.is_word("else") || in_try && self.is_if_it_fails()),
                None => !self.check(Kind::Eof),
            };
            if !more {
                break;
            }
            if self.check(Kind::Eof) {
                let o = opener.unwrap();
                return self.fail(self.peek(), format!("'{}' from line {} is missing its 'end'", o.text, o.line));
            }
            match self.statement()? {
                Parsed::One(s) => body.push(s),
                Parsed::Many(v) => body.extend(v),
            }
            if !self.peek().nl {
                return self.expected("a new line");
            }
        }
        self.at_top = outside;
        self.shallower();
        Ok(body)
    }

    // The statements of a file the program uses, or none if it was read already (see moth.js's useFile)
    fn use_file(&mut self, name_token: &Token, alias: Option<String>) -> R<Vec<Stmt>> {
        let name = name_token.text.clone();
        let within = self.reading.within.clone();
        let key = match &alias {
            Some(a) => format!("{within}{name} as {a}"),
            None => format!("{within}{name}"),
        };
        if self.reading.open.contains(&name) {
            return self.fail(
                name_token,
                format!("'{name}' is already being read, so it can't be used here: files can't use each other in a circle"),
            );
        }
        if self.reading.loaded.contains(&key) {
            return Ok(vec![]);
        }
        let Some(text) = (self.reading.files)(&name) else {
            return self.fail(name_token, format!("there is no file called '{name}'"));
        };
        self.reading.loaded.insert(key);
        self.reading.open.push(name.clone());
        if let Some(a) = &alias {
            self.reading.within = format!("{within}{a}'s ");
        }
        let file: Rc<str> = Rc::from(name.as_str());
        let tokens = tokenize(&text, Some(&file))?;
        let body = parse(tokens, self.reading)?;
        self.reading.within = within;
        self.reading.open.pop();
        Ok(match alias {
            Some(a) => prefixed(body, &a),
            None => body,
        })
    }

    // `math's sine`: a name the file used `as math` makes
    fn member(&mut self, first: String) -> R<String> {
        if self.sym("'s").is_some() {
            let n = self.name("a name")?;
            Ok(format!("{first}'s {n}"))
        } else {
            Ok(first)
        }
    }

    fn block(&mut self, opener: &Token) -> R<Vec<Stmt>> {
        if !self.peek().nl {
            return self.expected("a new line");
        }
        self.statements(Some(opener), false)
    }

    fn loop_body(&mut self, opener: &Token) -> R<Vec<Stmt>> {
        self.loop_depth += 1;
        let body = self.block_end(opener)?;
        self.loop_depth -= 1;
        Ok(body)
    }

    fn block_end(&mut self, opener: &Token) -> R<Vec<Stmt>> {
        let body = self.block(opener)?;
        self.expect_word("end")?;
        Ok(body)
    }

    fn statement(&mut self) -> R<Parsed> {
        let t = self.peek().clone();
        let at = t.pos();
        let one = |s: Stmt| Ok(Parsed::One(s));
        if self.word("set").is_some() {
            if self.is_word("item") || self.is_word("byte") {
                let target = self.primary()?;
                self.expect_word("to")?;
                let value = self.expression()?;
                let Expr::Item { index, of, at: target_at } = target else { unreachable!() };
                return one(Stmt::SetItem { of: *of, index: *index, target_at, value });
            }
            let variable = self.name("a variable name")?;
            if self.word("of").is_some() {
                let target = self.unary()?;
                self.expect_word("to")?;
                let value = self.expression()?;
                return one(Stmt::SetField { name: variable, target, value, at });
            }
            self.expect_word("to")?;
            let value = self.expression()?;
            return one(Stmt::Set { name: variable, value, at });
        }
        if self.word("add").is_some() {
            let value = self.expression()?;
            self.expect_word("to")?;
            let name = self.name("a variable name")?;
            return one(Stmt::Add { value, name, at });
        }
        if self.word("say").is_some() {
            let mut parts = vec![self.expression()?];
            while !self.peek().nl {
                parts.push(self.expression()?);
            }
            return one(Stmt::Say(parts, at));
        }
        if self.word("if").is_some() {
            return one(self.if_rest(&t)?);
        }
        if self.word("repeat").is_some() {
            if self.word("while").is_some() {
                let cond = self.expression()?;
                let body = self.loop_body(&t)?;
                return one(Stmt::While { cond, body, at });
            }
            let count = self.expression()?;
            self.expect_word("times")?;
            let body = self.loop_body(&t)?;
            return one(Stmt::Repeat { count, body, at });
        }
        if self.word("for").is_some() {
            self.expect_word("each")?;
            let variable = self.name("a variable name")?;
            if self.word("from").is_some() {
                let from = self.expression()?;
                self.expect_word("to")?;
                let to = self.expression()?;
                let body = self.loop_body(&t)?;
                return one(Stmt::Count { name: variable, from, to, body, at });
            }
            if self.word("in").is_none() {
                return self.expected("'in' or 'from'");
            }
            let list = self.expression()?;
            let body = self.loop_body(&t)?;
            return one(Stmt::Each { name: variable, list, body, at });
        }
        if self.word("to").is_some() {
            let fn_name = self.name("a function name")?;
            let mut params = Vec::new();
            let mut kinds = Vec::new(); // what each input says it is: `with width as a number`
            if self.word("with").is_some() {
                loop {
                    params.push(self.name("an input name")?);
                    kinds.push(if self.word("as").is_some() { self.kind()? } else { -1 });
                    if self.sym(",").is_none() && self.word("and").is_none() {
                        break;
                    }
                }
            }
            let mut f = self.func(fn_name, params, &t)?;
            f.kinds = kinds;
            return one(Stmt::Define(f));
        }
        if self.word("when").is_some() {
            let start = self.pos;
            let mut words = Vec::new();
            while self.check(Kind::Word) && !self.is_word("with") && !self.peek().nl {
                words.push(self.peek().text.clone());
                self.pos += 1;
            }
            let phrase = words.join(" ");
            let known = match phrase.as_str() {
                "a key is pressed" => Some(("key", 1)),
                "the mouse is clicked" => Some(("click", 2)),
                "the mouse is dragged" => Some(("drag", 2)),
                _ => None,
            };
            let Some((event, gives)) = known else {
                self.pos = start;
                return self.expected("'a key is pressed', 'the mouse is clicked' or 'the mouse is dragged'");
            };
            let mut params = Vec::new();
            if self.word("with").is_some() {
                loop {
                    params.push(self.name("an input name")?);
                    if self.sym(",").is_none() && self.word("and").is_none() {
                        break;
                    }
                }
            }
            if !params.is_empty() && params.len() != gives {
                let values = if gives == 1 { "1 value".to_string() } else { format!("{gives} values") };
                let inputs = if gives == 1 { "one input".to_string() } else { format!("{gives} inputs") };
                return self.fail(&t, format!("'when {phrase}' gives {values}, so name {inputs} or none, not {}", params.len()));
            }
            if !self.at_top {
                return self.fail(&t, "'when' only works at the top level of a program".into());
            }
            let func = self.func(format!("when {phrase}"), params, &t)?;
            return one(Stmt::When { event, func, at });
        }
        if self.word("every").is_some() {
            let interval = self.additive()?;
            let unit = ["milliseconds", "millisecond", "seconds", "second"].into_iter().find(|w| self.is_word(w));
            let Some(unit) = unit else { return self.expected("'milliseconds' or 'seconds'") };
            self.pos += 1;
            if !self.at_top {
                return self.fail(&t, "'every' only works at the top level of a program".into());
            }
            let func = self.func("every".into(), vec![], &t)?;
            return one(Stmt::Every { interval, unit: if unit.starts_with("milli") { 1 } else { 1000 }, func, at });
        }
        if self.word("return").is_some() {
            if self.fn_depth == 0 {
                return self.fail(&t, "'return' only works inside a function (one made with 'to')".into());
            }
            let value = if self.peek().nl { None } else { Some(self.expression()?) };
            return one(Stmt::Return(value, at));
        }
        if self.word("fail").is_some() {
            self.expect_word("with")?;
            return one(Stmt::Fail(self.expression()?, at));
        }
        if self.word("try").is_some() {
            if !self.peek().nl {
                return self.expected("a new line");
            }
            let body = self.statements(Some(&t), true)?;
            if !self.is_if_it_fails() {
                return self.expected("'if it fails'");
            }
            self.pos += 3;
            let name = if self.word("with").is_some() { Some(self.name("a variable name")?) } else { None };
            let handler = self.block_end(&t)?;
            return one(Stmt::Try { body, name, handler, at });
        }
        if self.word("use").is_some() {
            let Some(name_token) = self.matches(Kind::Str) else {
                return self.expected("a file name in quotes, like \"shapes.moth\"");
            };
            let alias = if self.word("as").is_some() { Some(self.name("a name for the file")?) } else { None };
            if !self.at_top {
                return self.fail(&t, "'use' only works at the top level of a program".into());
            }
            return Ok(Parsed::Many(self.use_file(&name_token, alias)?));
        }
        if self.word("stop").is_some() {
            if self.loop_depth == 0 {
                return self.fail(&t, "'stop' only works inside a loop (one made with 'repeat' or 'for each')".into());
            }
            return one(Stmt::Stop(at));
        }
        if self.word("remove").is_some() {
            let key = self.additive()?;
            self.expect_word("from")?;
            let target = self.unary()?;
            return one(Stmt::Remove { key, target, at });
        }
        if self.word("expect").is_some() {
            return one(Stmt::Expect(self.expression()?, at));
        }
        if self.word("write").is_some() {
            let value = self.expression()?;
            self.expect_word("to")?;
            let target = self.expression()?;
            return one(Stmt::Write { value, target, at });
        }
        if t.kind == Kind::Word {
            if let Some(actions) = turtle_words(&t.text) {
                self.pos += 1;
                let Some(action) = actions.iter().find(|w| self.is_word(w)).copied() else {
                    let options: Vec<String> = actions.iter().map(|w| format!("'{w}'")).collect();
                    return self.expected(&options.join(" or "));
                };
                self.pos += 1;
                if action == "to" {
                    let value = self.several(2, &t)?;
                    return one(Stmt::Turtle { action, value: Some(value), at });
                }
                let value = if action == "up" || action == "down" { None } else { Some(self.expression()?) };
                return one(Stmt::Turtle { action, value, at });
            }
        }
        if self.word("clear").is_some() {
            return one(Stmt::Turtle { action: "clear", value: None, at });
        }
        if self.word("draw").is_some() {
            let shape = ["box", "circle"].into_iter().find(|w| self.is_word(w) && self.word_ahead(1, "at"));
            if let Some(shape) = shape {
                self.pos += 2;
                let Expr::List(mut items, place_at) = self.several(2, &t)? else { unreachable!() };
                self.expect_word("size")?;
                if shape == "box" {
                    items.push(self.additive()?);
                    self.expect_word("by")?;
                    items.push(self.expression()?);
                } else {
                    items.push(self.expression()?);
                }
                return one(Stmt::Turtle { action: shape, value: Some(Expr::List(items, place_at)), at });
            }
            let text = self.expression()?;
            self.expect_word("at")?;
            let Expr::List(place, place_at) = self.several(2, &t)? else { unreachable!() };
            let size = if self.word("size").is_some() { self.expression()? } else { Expr::Value(Lit::Nothing, at.clone()) };
            let mut items = vec![text];
            items.extend(place);
            items.push(size);
            return one(Stmt::Turtle { action: "text", value: Some(Expr::List(items, place_at)), at });
        }
        if t.kind == Kind::Word && !reserved(&t.text) {
            // a line that starts with a name calls it: `greet "Sam"` or `greet("Sam")`
            self.pos += 1;
            let called = self.member(t.text.clone())?;
            if self.is_word("is") {
                return self.fail(&t, format!("to give '{called}' a value write 'set {called} to ...'"));
            }
            let mut args = Vec::new();
            if self.sym("(").is_some() {
                args = self.arg_list()?;
            } else if !self.peek().nl {
                loop {
                    args.push(self.expression()?);
                    if self.sym(",").is_none() {
                        break;
                    }
                }
            }
            return one(Stmt::Call(called, args, at));
        }
        self.fail(&t, format!("a line can't start with {}", Self::describe(&t)))
    }

    // `a number`, `text`, `yes or no`...: what an input says it is (its place in KINDS), after its `as`
    fn kind(&mut self) -> R<i32> {
        for (k, phrase) in KINDS.iter().enumerate() {
            let words: Vec<&str> = phrase.split(' ').collect();
            if words.iter().enumerate().all(|(i, w)| self.ahead(i).is_some_and(|t| t.is_word(w))) {
                self.pos += words.len();
                return Ok(k as i32);
            }
        }
        self.expected(
            "what kind of value it is ('a number', 'text', 'yes or no', 'a list', 'a record', 'a dictionary', 'bytes' or 'a function')",
        )
    }

    // the body of a function, made with `to`, or an app's handler (`when`, `every`), which starts outside any loop
    fn func(&mut self, name: String, params: Vec<String>, t: &Token) -> R<Func> {
        let outside = self.loop_depth;
        self.fn_depth += 1;
        self.loop_depth = 0;
        let body = self.block_end(t)?;
        self.fn_depth -= 1;
        self.loop_depth = outside;
        Ok(Func { name, params, kinds: vec![], body, at: t.pos() })
    }

    fn if_rest(&mut self, t: &Token) -> R<Stmt> {
        let cond = self.expression()?;
        let then = self.block(t)?;
        let mut otherwise = Vec::new();
        if self.word("else").is_some() {
            // an `if` on the next line starts a new if inside the else
            if !self.peek().nl {
                if let Some(else_if) = self.word("if") {
                    self.deeper()?;
                    let inner = self.if_rest(&else_if)?;
                    self.shallower();
                    return Ok(Stmt::If { cond, then, otherwise: vec![inner], at: t.pos() });
                }
            }
            otherwise = self.block(t)?;
        }
        self.expect_word("end")?;
        Ok(Stmt::If { cond, then, otherwise, at: t.pos() })
    }

    fn expression(&mut self) -> R<Expr> {
        self.deeper()?;
        let mut left = self.and()?;
        while let Some(t) = self.word("or") {
            let right = self.and()?;
            left = Expr::Or(Box::new(left), Box::new(right), t.pos());
        }
        self.shallower();
        Ok(left)
    }

    fn and(&mut self) -> R<Expr> {
        let mut left = self.not()?;
        while let Some(t) = self.word("and") {
            let right = self.not()?;
            left = Expr::And(Box::new(left), Box::new(right), t.pos());
        }
        Ok(left)
    }

    fn not(&mut self) -> R<Expr> {
        match self.word("not") {
            Some(t) => {
                self.deeper()?;
                let operand = self.not()?;
                self.shallower();
                Ok(Expr::Not(Box::new(operand), t.pos()))
            }
            None => self.comparison(),
        }
    }

    fn comparison(&mut self) -> R<Expr> {
        let left = self.bitwise()?;
        let Some(t) = self.word("is") else { return Ok(left) };
        let negate = self.word("not").is_some();
        let phrase = if self.check(Kind::Word) && self.ahead(1).is_some_and(|n| n.kind == Kind::Word) {
            format!("{} {}", self.peek().text, self.tokens[self.pos + 1].text)
        } else {
            String::new()
        };
        let op = if let Some(op) = COMPARISONS.iter().find(|c| **c == phrase) {
            self.pos += 2;
            *op
        } else if self.word("in").is_some() {
            "in"
        } else {
            "is"
        };
        let right = self.bitwise()?;
        Ok(Expr::Compare { op, negate, left: Box::new(left), right: Box::new(right), at: t.pos() })
    }

    fn bitwise(&mut self) -> R<Expr> {
        let mut left = self.additive()?;
        while self.is_word("bit") && self.ahead(1).is_some_and(|n| n.kind == Kind::Word && BIT_WORDS.contains(&n.text.as_str())) {
            let t = self.peek().clone();
            let name = format!("bit {}", self.tokens[self.pos + 1].text);
            self.pos += 2;
            let right = self.additive()?;
            left = Expr::Builtin(name, vec![left, right], t.pos());
        }
        Ok(left)
    }

    fn additive(&mut self) -> R<Expr> {
        let mut left = self.multiplicative()?;
        while let Some(t) = self.sym("+").or_else(|| self.sym("-")) {
            let right = self.multiplicative()?;
            let op = if t.text == "+" { "+" } else { "-" };
            left = Expr::Math(op, Box::new(left), Box::new(right), t.pos());
        }
        Ok(left)
    }

    fn multiplicative(&mut self) -> R<Expr> {
        let first = self.unary()?;
        let mut left = self.postfix(first)?;
        while let Some(t) = self.sym("*").or_else(|| self.sym("/")) {
            let operand = self.unary()?;
            let right = self.postfix(operand)?;
            let op = if t.text == "*" { "*" } else { "/" };
            left = Expr::Math(op, Box::new(left), Box::new(right), t.pos());
        }
        Ok(left)
    }

    // `100 bytes`, `block as text`
    fn postfix(&mut self, mut e: Expr) -> R<Expr> {
        loop {
            let t = self.peek().clone();
            if self.word("bytes").is_some() {
                e = Expr::Builtin("bytes".into(), vec![e], t.pos());
            } else if self.word("as").is_some() {
                let Some(to) = AS_WORDS.iter().find(|w| self.is_word(w)).copied() else {
                    let options: Vec<String> = AS_WORDS.iter().map(|w| format!("'{w}'")).collect();
                    return self.expected(&options.join(" or "));
                };
                self.pos += 1;
                e = Expr::Builtin(format!("as {to}"), vec![e], t.pos());
            } else {
                return Ok(e);
            }
        }
    }

    fn unary(&mut self) -> R<Expr> {
        match self.sym("-") {
            Some(t) => {
                self.deeper()?;
                let operand = self.unary()?;
                self.shallower();
                Ok(Expr::Negate(Box::new(operand), t.pos()))
            }
            None => self.primary(),
        }
    }

    fn primary(&mut self) -> R<Expr> {
        let t = self.peek().clone();
        let at = t.pos();
        if let Some(n) = self.matches(Kind::Number) {
            return Ok(Expr::Value(Lit::Num(n.num), at));
        }
        if let Some(s) = self.matches(Kind::Str) {
            return Ok(Expr::Value(Lit::Text(Rc::from(s.text.as_str())), at));
        }
        if self.word("yes").is_some() || self.word("no").is_some() {
            return Ok(Expr::Value(Lit::Bool(t.text == "yes"), at));
        }
        if self.word("nothing").is_some() {
            return Ok(Expr::Value(Lit::Nothing, at));
        }
        if self.word("list").is_some() {
            self.expect_word("of")?;
            let mut items = Vec::new();
            loop {
                items.push(self.expression()?);
                if self.sym(",").is_none() {
                    break;
                }
            }
            return Ok(Expr::List(items, at));
        }
        if self.word("record").is_some() {
            self.expect_word("with")?;
            let (mut fields, mut values) = (Vec::new(), Vec::new());
            loop {
                fields.push(self.name("a field name")?);
                values.push(self.expression()?);
                if self.sym(",").is_none() {
                    break;
                }
            }
            return Ok(Expr::Record { fields, values, at });
        }
        if self.word("dictionary").is_some() {
            self.expect_word("where")?;
            let mut items = Vec::new();
            loop {
                items.push(self.additive()?);
                self.expect_word("is")?;
                items.push(self.expression()?);
                if self.sym(",").is_none() {
                    break;
                }
            }
            return Ok(Expr::Dictionary(items, at));
        }
        if self.word("empty").is_some() {
            if self.word("record").is_some() {
                return Ok(Expr::Record { fields: vec![], values: vec![], at });
            }
            if self.word("dictionary").is_some() {
                return Ok(Expr::Dictionary(vec![], at));
            }
            if self.word("list").is_none() {
                return self.expected("'list', 'record' or 'dictionary'");
            }
            return Ok(Expr::List(vec![], at));
        }
        if self.word("length").is_some() {
            self.expect_word("of")?;
            let of = self.unary()?;
            return Ok(Expr::Length(Box::new(of), at));
        }
        if self.word("ask").is_some() {
            let question = self.additive()?;
            return Ok(Expr::Ask(Box::new(question), at));
        }
        if self.word("read").is_some() {
            let bytes = self.word("bytes").is_some();
            let of = self.additive()?;
            return Ok(Expr::Read { bytes, of: Box::new(of), at });
        }
        if self.word("arguments").is_some() {
            return Ok(Expr::Arguments(at));
        }
        // `random number from 1 to 6`: `random` alone is still a name
        if self.is_word("random") && self.word_ahead(1, "number") && self.word_ahead(2, "from") {
            self.pos += 3;
            let low = self.additive()?;
            self.expect_word("to")?;
            let high = self.additive()?;
            return Ok(Expr::Random(Box::new(low), Box::new(high), at));
        }
        if t.kind == Kind::Word {
            if let Some((first, second)) = builtin_syntax(&t.text) {
                self.pos += 1;
                if let Some(w) = first {
                    self.expect_word(w)?;
                }
                let Some(between) = second else {
                    let arg = self.unary()?;
                    return Ok(Expr::Builtin(t.text.clone(), vec![arg], at));
                };
                let a = self.additive()?;
                self.expect_word(between)?;
                let b = self.additive()?;
                return Ok(Expr::Builtin(t.text.clone(), vec![a, b], at));
            }
        }
        if self.word("shift").is_some() {
            let value = self.additive()?;
            let Some(way) = ["left", "right"].into_iter().find(|w| self.is_word(w)) else {
                return self.expected("'left' or 'right'");
            };
            self.pos += 1;
            self.expect_word("by")?;
            let by = self.additive()?;
            return Ok(Expr::Builtin(format!("shift {way}"), vec![value, by], at));
        }
        if self.word("item").is_some() || self.word("byte").is_some() {
            let outside = self.indexing;
            self.indexing = true;
            let index = self.additive()?;
            self.indexing = outside;
            self.expect_word("of")?;
            let of = self.unary()?;
            return Ok(Expr::Item { index: Box::new(index), of: Box::new(of), at });
        }
        if self.sym("(").is_some() {
            let outside = self.indexing;
            self.indexing = false;
            let inner = self.expression()?;
            self.indexing = outside;
            if self.sym(")").is_none() {
                return self.expected("')'");
            }
            return Ok(inner);
        }
        if t.kind == Kind::Word && !reserved(&t.text) {
            self.pos += 1;
            let full = self.member(t.text.clone())?;
            if self.sym("(").is_some() {
                let args = self.arg_list()?;
                return Ok(Expr::Call(full, args, at));
            }
            if full == t.text && !self.indexing && self.word("of").is_some() {
                let of = self.unary()?;
                return Ok(Expr::Field { name: t.text.clone(), of: Box::new(of), at });
            }
            return Ok(Expr::Name(full, at));
        }
        self.expected("a value")
    }

    // `n` values with commas between them, as a list: the x, y of `move to x, y` and the like
    fn several(&mut self, n: usize, t: &Token) -> R<Expr> {
        let mut items = vec![self.expression()?];
        while items.len() < n {
            if self.sym(",").is_none() {
                return self.expected("','");
            }
            items.push(self.expression()?);
        }
        Ok(Expr::List(items, t.pos()))
    }

    fn arg_list(&mut self) -> R<Vec<Expr>> {
        let outside = self.indexing;
        self.indexing = false;
        let mut args = Vec::new();
        while !self.check(Kind::Sym(")")) {
            args.push(self.expression()?);
            if self.sym(",").is_none() {
                break;
            }
        }
        if self.sym(")").is_none() {
            return self.expected("')'");
        }
        self.indexing = outside;
        Ok(args)
    }
}

// ---------- names ----------

// Names each function sets: inputs and functions made with `to` always belong to the function itself; a name it
// `set`s (or loops over) belongs to the outermost enclosing function, or the top level, that also sets it.
pub fn declarations(body: &[Stmt], own: &mut Vec<String>, shared: &mut Vec<String>) {
    for s in body {
        match s {
            Stmt::Define(f) => own.push(f.name.clone()),
            Stmt::Set { name, .. } | Stmt::Count { name, .. } | Stmt::Each { name, .. } => shared.push(name.clone()),
            Stmt::Try { name: Some(name), .. } => shared.push(name.clone()),
            _ => {}
        }
        match s {
            Stmt::If { then, otherwise, .. } => {
                declarations(then, own, shared);
                declarations(otherwise, own, shared);
            }
            Stmt::While { body, .. } | Stmt::Repeat { body, .. } | Stmt::Count { body, .. } | Stmt::Each { body, .. } => {
                declarations(body, own, shared)
            }
            Stmt::Try { body, handler, .. } => {
                declarations(body, own, shared);
                declarations(handler, own, shared);
            }
            _ => {}
        }
    }
}

// `use "math.moth" as math`: each name the file's top level makes becomes `math's pi`, `math's sine`, where it
// means the top level's: not where an input of a function, or a function a function makes, has the same name.
fn prefixed(mut body: Vec<Stmt>, alias: &str) -> Vec<Stmt> {
    let (mut own, mut shared) = (Vec::new(), Vec::new());
    declarations(&body, &mut own, &mut shared);
    let top: HashSet<String> = own.into_iter().chain(shared).collect();
    let rename = |name: &mut String, hidden: &HashSet<String>| {
        if top.contains(name.as_str()) && !hidden.contains(name.as_str()) {
            *name = format!("{alias}'s {name}");
        }
    };
    fn walk_stmt(s: &mut Stmt, hidden: &HashSet<String>, rename: &dyn Fn(&mut String, &HashSet<String>)) {
        let body_hidden = |f: &Func| {
            let (mut own, mut shared) = (Vec::new(), Vec::new());
            declarations(&f.body, &mut own, &mut shared);
            let mut inside = hidden.clone();
            inside.extend(f.params.iter().cloned());
            inside.extend(own);
            inside
        };
        match s {
            Stmt::Set { name, value, .. } => {
                rename(name, hidden);
                walk_expr(value, hidden, rename);
            }
            Stmt::SetItem { of, index, value, .. } => {
                walk_expr(of, hidden, rename);
                walk_expr(index, hidden, rename);
                walk_expr(value, hidden, rename);
            }
            Stmt::SetField { target, value, .. } => {
                walk_expr(target, hidden, rename);
                walk_expr(value, hidden, rename);
            }
            Stmt::Add { value, name, .. } => {
                rename(name, hidden);
                walk_expr(value, hidden, rename);
            }
            Stmt::Say(parts, _) => parts.iter_mut().for_each(|p| walk_expr(p, hidden, rename)),
            Stmt::If { cond, then, otherwise, .. } => {
                walk_expr(cond, hidden, rename);
                then.iter_mut().chain(otherwise.iter_mut()).for_each(|s| walk_stmt(s, hidden, rename));
            }
            Stmt::While { cond, body, .. } => {
                walk_expr(cond, hidden, rename);
                body.iter_mut().for_each(|s| walk_stmt(s, hidden, rename));
            }
            Stmt::Repeat { count, body, .. } => {
                walk_expr(count, hidden, rename);
                body.iter_mut().for_each(|s| walk_stmt(s, hidden, rename));
            }
            Stmt::Count { name, from, to, body, .. } => {
                rename(name, hidden);
                walk_expr(from, hidden, rename);
                walk_expr(to, hidden, rename);
                body.iter_mut().for_each(|s| walk_stmt(s, hidden, rename));
            }
            Stmt::Each { name, list, body, .. } => {
                rename(name, hidden);
                walk_expr(list, hidden, rename);
                body.iter_mut().for_each(|s| walk_stmt(s, hidden, rename));
            }
            Stmt::Define(f) => {
                rename(&mut f.name, hidden);
                let inside = body_hidden(f);
                f.body.iter_mut().for_each(|s| walk_stmt(s, &inside, rename));
            }
            Stmt::When { func, .. } => {
                let inside = body_hidden(func);
                rename(&mut func.name, hidden);
                func.body.iter_mut().for_each(|s| walk_stmt(s, &inside, rename));
            }
            Stmt::Every { interval, func, .. } => {
                walk_expr(interval, hidden, rename);
                let inside = body_hidden(func);
                rename(&mut func.name, hidden);
                func.body.iter_mut().for_each(|s| walk_stmt(s, &inside, rename));
            }
            Stmt::Return(value, _) => {
                if let Some(v) = value {
                    walk_expr(v, hidden, rename)
                }
            }
            Stmt::Fail(v, _) | Stmt::Expect(v, _) => walk_expr(v, hidden, rename),
            Stmt::Try { body, name, handler, .. } => {
                if let Some(n) = name {
                    rename(n, hidden);
                }
                body.iter_mut().chain(handler.iter_mut()).for_each(|s| walk_stmt(s, hidden, rename));
            }
            Stmt::Stop(_) => {}
            Stmt::Remove { key, target, .. } => {
                walk_expr(key, hidden, rename);
                walk_expr(target, hidden, rename);
            }
            Stmt::Write { value, target, .. } => {
                walk_expr(value, hidden, rename);
                walk_expr(target, hidden, rename);
            }
            Stmt::Turtle { value, .. } => {
                if let Some(v) = value {
                    walk_expr(v, hidden, rename)
                }
            }
            Stmt::Call(name, args, _) => {
                rename(name, hidden);
                args.iter_mut().for_each(|a| walk_expr(a, hidden, rename));
            }
        }
    }
    fn walk_expr(e: &mut Expr, hidden: &HashSet<String>, rename: &dyn Fn(&mut String, &HashSet<String>)) {
        match e {
            Expr::Value(..) | Expr::Arguments(_) => {}
            Expr::Name(name, _) => rename(name, hidden),
            Expr::Call(name, args, _) => {
                rename(name, hidden);
                args.iter_mut().for_each(|a| walk_expr(a, hidden, rename));
            }
            Expr::Math(_, a, b, _) | Expr::And(a, b, _) | Expr::Or(a, b, _) | Expr::Random(a, b, _) => {
                walk_expr(a, hidden, rename);
                walk_expr(b, hidden, rename);
            }
            Expr::Compare { left, right, .. } => {
                walk_expr(left, hidden, rename);
                walk_expr(right, hidden, rename);
            }
            Expr::Not(a, _) | Expr::Negate(a, _) | Expr::Length(a, _) | Expr::Ask(a, _) => walk_expr(a, hidden, rename),
            Expr::Read { of, .. } | Expr::Field { of, .. } => walk_expr(of, hidden, rename),
            Expr::List(items, _) | Expr::Dictionary(items, _) | Expr::Builtin(_, items, _) => {
                items.iter_mut().for_each(|a| walk_expr(a, hidden, rename))
            }
            Expr::Item { index, of, .. } => {
                walk_expr(index, hidden, rename);
                walk_expr(of, hidden, rename);
            }
            Expr::Record { values, .. } => values.iter_mut().for_each(|a| walk_expr(a, hidden, rename)),
        }
    }
    let empty = HashSet::new();
    for s in body.iter_mut() {
        walk_stmt(s, &empty, &rename);
    }
    body
}
