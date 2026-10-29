// Source text -> tokens, as moth.js's tokenize() does. Columns count UTF-16 units, as JavaScript's do, so
// both engines point at the same spot.
use crate::error::{MothError, Pos};
use std::rc::Rc;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Number,
    Word,
    Str,
    Sym(&'static str), // - + * / ( ) , 's
    Eof,
}

#[derive(Clone, Debug)]
pub struct Token {
    pub kind: Kind,
    pub num: f64,
    pub text: String, // a word (lower case), a string (its text), a number as written, or a symbol
    pub line: u32,
    pub col: u32,
    pub file: Option<Rc<str>>,
    pub nl: bool, // does it start a new line?
}

impl Token {
    pub fn pos(&self) -> Pos {
        Pos { line: self.line, col: self.col, file: self.file.clone() }
    }
    pub fn is_word(&self, w: &str) -> bool {
        self.kind == Kind::Word && self.text == w
    }
}

// symbols people type out of habit from other languages, and what Moth says instead
fn hint(c: &str) -> Option<&'static str> {
    Some(match c {
        "=" => "to store a value write 'set x to 5', to compare write 'x is 5'",
        "!" => "write 'is not'",
        "<" => "write 'is less than'",
        ">" => "write 'is greater than'",
        "%" => "write 'is divisible by'",
        "[" | "]" => "make a list with 'list of 1, 2, 3'",
        "{" | "}" => "blocks finish with 'end', not braces",
        "'" => "put text in double quotes",
        "." => "to get a field write 'name of person'",
        _ => return None,
    })
}

const fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

// a character text can hold: anything but a control character other than tab
fn text_char(c: char) -> bool {
    !(c <= '\u{8}' || ('\n'..='\u{1f}').contains(&c))
}

// `0x...` and `0b...` as JavaScript's Number() reads them: the whole number, rounded to the nearest float
fn based(digits: &str, bits_per_digit: u32) -> f64 {
    let mut bits: Vec<u8> = Vec::new();
    for d in digits.chars() {
        let v = d.to_digit(1 << bits_per_digit).unwrap();
        for i in (0..bits_per_digit).rev() {
            bits.push(((v >> i) & 1) as u8);
        }
    }
    let first = bits.iter().position(|&b| b == 1);
    let Some(first) = first else { return 0.0 };
    let bits = &bits[first..];
    if bits.len() <= 53 {
        return bits.iter().fold(0f64, |n, &b| n * 2.0 + b as f64);
    }
    // keep 53 bits, rounding half to even on the rest
    let mut mantissa = bits[..53].iter().fold(0u64, |n, &b| n * 2 + b as u64);
    let rest = &bits[53..];
    let half = rest[0] == 1;
    let more = rest[1..].contains(&1);
    if half && (more || mantissa & 1 == 1) {
        mantissa += 1;
    }
    let exponent = rest.len() as i32;
    let mut value = mantissa as f64;
    for _ in 0..exponent {
        value *= 2.0;
    }
    value
}

pub fn tokenize(src: &str, file: Option<&Rc<str>>) -> Result<Vec<Token>, MothError> {
    let chars: Vec<char> = src.chars().collect();
    let mut tokens = Vec::new();
    let mut line = 1u32;
    let mut line_start = 0u32; // in UTF-16 units
    let mut nl = true;
    let mut i = 0usize; // in chars
    let mut at = 0u32; // the same place, in UTF-16 units
    let units = |c: char| c.len_utf16() as u32;
    while i < chars.len() {
        let c = chars[i];
        let col = at - line_start + 1;
        let start = i;
        let start_at = at;
        let advance = |i: &mut usize, at: &mut u32| {
            *at += units(chars[*i]);
            *i += 1;
        };
        if c <= ' ' {
            while i < chars.len() && chars[i] <= ' ' {
                if chars[i] == '\n' {
                    line += 1;
                    line_start = at + 1;
                    nl = true;
                }
                advance(&mut i, &mut at);
            }
            continue;
        }
        if c == '#' {
            while i < chars.len() && chars[i] != '\n' {
                advance(&mut i, &mut at);
            }
            continue;
        }
        let fail = |message: String| MothError::at(&Pos { line, col, file: file.cloned() }, message);
        let token = |kind: Kind, num: f64, text: String| Token { kind, num, text, line, col, file: file.cloned(), nl };
        if c.is_ascii_digit() {
            let next = chars.get(i + 1).copied();
            let hex = c == '0' && next == Some('x') && chars.get(i + 2).is_some_and(|d| d.is_ascii_hexdigit());
            let bin = c == '0' && next == Some('b') && chars.get(i + 2).is_some_and(|d| *d == '0' || *d == '1');
            if hex || bin {
                i += 2;
                at += 2;
                while i < chars.len() && (if hex { chars[i].is_ascii_hexdigit() } else { chars[i] == '0' || chars[i] == '1' }) {
                    advance(&mut i, &mut at);
                }
                let written: String = chars[start..i].iter().collect();
                let value = based(&written[2..], if hex { 4 } else { 1 });
                tokens.push(token(Kind::Number, value, written));
            } else {
                while i < chars.len() && chars[i].is_ascii_digit() {
                    advance(&mut i, &mut at);
                }
                if i + 1 < chars.len() && chars[i] == '.' && chars[i + 1].is_ascii_digit() {
                    advance(&mut i, &mut at);
                    while i < chars.len() && chars[i].is_ascii_digit() {
                        advance(&mut i, &mut at);
                    }
                }
                let written: String = chars[start..i].iter().collect();
                tokens.push(token(Kind::Number, written.parse::<f64>().unwrap(), written));
            }
            nl = false;
            continue;
        }
        if c.is_ascii_alphabetic() || c == '_' {
            while i < chars.len() && is_word_char(chars[i]) {
                advance(&mut i, &mut at);
            }
            let word: String = chars[start..i].iter().collect::<String>().to_ascii_lowercase();
            tokens.push(token(Kind::Word, 0.0, word));
            nl = false;
            continue;
        }
        if c == '"' {
            let mut j = i + 1;
            let mut text = String::new();
            let mut closed = false;
            while j < chars.len() {
                let d = chars[j];
                if d == '"' {
                    closed = true;
                    break;
                }
                if d == '\\' {
                    match chars.get(j + 1) {
                        Some(&e) if text_char(e) => {
                            text.push(match e {
                                'n' => '\n',
                                't' => '\t',
                                other => other,
                            });
                            j += 2;
                        }
                        _ => break,
                    }
                    continue;
                }
                if !text_char(d) {
                    break;
                }
                text.push(d);
                j += 1;
            }
            if !closed {
                return Err(fail("this text is missing its closing quote".into()));
            }
            while i <= j {
                advance(&mut i, &mut at);
            }
            tokens.push(token(Kind::Str, 0.0, text));
            nl = false;
            continue;
        }
        let symbol = match c {
            '-' => Some("-"),
            '+' => Some("+"),
            '*' => Some("*"),
            '/' => Some("/"),
            '(' => Some("("),
            ')' => Some(")"),
            ',' => Some(","),
            '\'' if chars.get(i + 1) == Some(&'s') && !chars.get(i + 2).is_some_and(|&d| is_word_char(d)) => Some("'s"),
            _ => None,
        };
        if let Some(s) = symbol {
            for _ in 0..s.len() {
                advance(&mut i, &mut at);
            }
            tokens.push(token(Kind::Sym(s), 0.0, s.to_string()));
            nl = false;
            continue;
        }
        let _ = (start, start_at);
        let shown = c.to_string();
        let message = match hint(&shown) {
            Some(h) => format!("I don't understand '{shown}' ({h})"),
            None => format!("I don't understand '{shown}'"),
        };
        return Err(fail(message));
    }
    tokens.push(Token { kind: Kind::Eof, num: 0.0, text: String::new(), line, col: at - line_start + 1, file: file.cloned(), nl: true });
    Ok(tokens)
}
