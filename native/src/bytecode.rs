// Compiled Moth as a file: the bytecode the compiler makes, written out so it can run later without being
// compiled again, by this engine or by the same bytecode written by compiler.moth (Moth's compiler, in Moth).
// The text is the same whoever writes it, so the two compilers can be compared byte for byte:
//
//   moth bytecode 1
//   function "main"            each function: its name,
//   params                     its inputs,
//   names "total" "f"          the name of each slot from 1,
//   code 2 0 1 0 1 33          its instructions,
//   at 1:5 - 1:9 - - -         where each came from in the code (line:col, or line:col:"file"; - for none),
//   const number 0             and its constants, in order: nothing, yes, no, number, text, fields,
//   const function             or a function made inside it, written out right after,
//   function "f" ... end
//   end
use crate::compiler::{Const, Function};
use crate::error::Pos;
use crate::num;
use crate::value::Value;
use std::rc::Rc;

pub const HEADER: &str = "moth bytecode 1";

// text in double quotes, as compiler.moth's quote() writes it: \" \\ \n \t, and nothing else escaped
fn quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn line(head: &str, items: impl Iterator<Item = String>) -> String {
    let mut out = head.to_string();
    for item in items {
        out.push(' ');
        out += &item;
    }
    out
}

pub fn write(main: &Function) -> String {
    let mut out = vec![HEADER.to_string()];
    write_function(main, &mut out);
    out.join("\n") + "\n"
}

fn write_function(f: &Function, out: &mut Vec<String>) {
    out.push(format!("function {}", quote(&f.name)));
    out.push(line("params", f.params.iter().map(|p| quote(p))));
    out.push(line("names", f.names[1..].iter().map(|n| quote(n))));
    out.push(line("code", f.code.iter().map(|c| c.to_string())));
    out.push(line(
        "at",
        f.at.iter().map(|a| match a {
            None => "-".to_string(),
            Some(Pos { line, col, file: None }) => format!("{line}:{col}"),
            Some(Pos { line, col, file: Some(file) }) => format!("{line}:{col}:{}", quote(file)),
        }),
    ));
    for c in &f.consts {
        match c {
            Const::Val(Value::Nothing) => out.push("const nothing".into()),
            Const::Val(Value::Bool(b)) => out.push(format!("const {}", if *b { "yes" } else { "no" })),
            Const::Val(Value::Num(n)) => out.push(format!("const number {}", num::show(*n))),
            Const::Val(Value::Text(t)) => out.push(format!("const text {}", quote(t))),
            Const::Val(_) => unreachable!("constants are literals"),
            Const::Fields(fields) => out.push(line("const fields", fields.iter().map(|f| quote(f)))),
            Const::Func(g) => {
                out.push("const function".into());
                write_function(g, out);
            }
        }
    }
    out.push("end".into());
}

// ---------- reading it back ----------

struct Reader<'t> {
    lines: Vec<&'t str>,
    at: usize,
}

type R<T> = Result<T, String>;

// a line's pieces after its first word, split at spaces outside quotes, each as written
fn pieces(rest: &str) -> R<Vec<String>> {
    let mut out = Vec::new();
    let mut piece = String::new();
    let mut quoted = false;
    let mut chars = rest.chars();
    while let Some(c) = chars.next() {
        if quoted {
            piece.push(c);
            if c == '\\' {
                piece.push(chars.next().ok_or("a quote ends in \\")?);
            } else if c == '"' {
                quoted = false;
            }
        } else if c == ' ' {
            if !piece.is_empty() {
                out.push(std::mem::take(&mut piece));
            }
        } else {
            quoted = c == '"';
            piece.push(c);
        }
    }
    if quoted {
        return Err("a quote isn't closed".into());
    }
    if !piece.is_empty() {
        out.push(piece);
    }
    Ok(out)
}

fn unquote(q: &str) -> R<String> {
    let inner = q.strip_prefix('"').and_then(|s| s.strip_suffix('"')).ok_or(format!("expected text in quotes, not {q}"))?;
    let mut out = String::new();
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            out.push(match chars.next() {
                Some('n') => '\n',
                Some('t') => '\t',
                Some(c) => c,
                None => return Err("a quote ends in \\".into()),
            });
        } else {
            out.push(c);
        }
    }
    Ok(out)
}

impl<'t> Reader<'t> {
    fn next(&mut self, head: &str) -> R<Vec<String>> {
        let l = self.lines.get(self.at).ok_or(format!("the bytecode ends before its '{head}'"))?;
        self.at += 1;
        let rest = if *l == head {
            ""
        } else {
            l.strip_prefix(head).and_then(|r| r.strip_prefix(' ')).ok_or(format!("line {}: expected '{head}'", self.at))?
        };
        pieces(rest)
    }

    fn function(&mut self) -> R<Function> {
        let name = unquote(self.next("function")?.first().ok_or("a function has no name")?)?;
        let params = self.next("params")?.iter().map(|p| unquote(p)).collect::<R<Vec<_>>>()?;
        let mut names = vec![String::new()];
        for n in self.next("names")? {
            names.push(unquote(&n)?);
        }
        let code = self.next("code")?.iter().map(|c| c.parse::<i32>().map_err(|e| e.to_string())).collect::<R<Vec<_>>>()?;
        let mut at = Vec::new();
        for a in self.next("at")? {
            if a == "-" {
                at.push(None);
                continue;
            }
            let mut parts = a.splitn(3, ':');
            let line = parts.next().unwrap_or("").parse::<u32>().map_err(|e| e.to_string())?;
            let col = parts.next().unwrap_or("").parse::<u32>().map_err(|e| e.to_string())?;
            let file = parts.next().map(unquote).transpose()?.map(|f| Rc::from(f.as_str()));
            at.push(Some(Pos { line, col, file }));
        }
        if at.len() != code.len() {
            return Err(format!("function {name} has {} instructions but {} places", code.len(), at.len()));
        }
        let mut consts = Vec::new();
        loop {
            let l = *self.lines.get(self.at).ok_or("the bytecode ends inside a function")?;
            if l == "end" {
                self.at += 1;
                break;
            }
            let p = self.next("const")?;
            let kind = p.first().map(String::as_str).unwrap_or("");
            consts.push(match kind {
                "nothing" => Const::Val(Value::Nothing),
                "yes" => Const::Val(Value::Bool(true)),
                "no" => Const::Val(Value::Bool(false)),
                "number" => {
                    Const::Val(Value::Num(p.get(1).ok_or("a number constant has no number")?.parse::<f64>().map_err(|e| e.to_string())?))
                }
                "text" => Const::Val(Value::Text(Rc::from(unquote(p.get(1).ok_or("a text constant has no text")?)?.as_str()))),
                "fields" => Const::Fields(Rc::new(p[1..].iter().map(|f| unquote(f).map(|s| Rc::from(s.as_str()))).collect::<R<Vec<_>>>()?)),
                "function" => Const::Func(Rc::new(self.function()?)),
                other => return Err(format!("line {}: a constant can't be '{other}'", self.at)),
            });
        }
        let nslots = names.len() - 1;
        Ok(Function { name, params, nslots, names, code, consts, at })
    }
}

pub fn is_bytecode(text: &str) -> bool {
    text.starts_with(HEADER)
}

pub fn read(text: &str) -> R<Function> {
    let mut r = Reader { lines: text.lines().collect(), at: 0 };
    if r.lines.first() != Some(&HEADER) {
        return Err(format!("this isn't Moth bytecode: it should start with '{HEADER}'"));
    }
    r.at = 1;
    let main = r.function()?;
    if r.at != r.lines.len() {
        return Err(format!("line {}: more after the program's end", r.at + 1));
    }
    Ok(main)
}
