// Just enough JSON for `moth-native conform`, which the tests drive: they send programs, it sends back what
// each one did.
use std::collections::BTreeMap;

#[derive(Clone, Debug)]
pub enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(BTreeMap<String, Json>),
}

impl Json {
    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Obj(m) => m.get(key).filter(|v| !matches!(v, Json::Null)),
            _ => None,
        }
    }
    pub fn str(&self) -> Option<&str> {
        if let Json::Str(s) = self {
            Some(s)
        } else {
            None
        }
    }
    pub fn num(&self) -> Option<f64> {
        if let Json::Num(n) = self {
            Some(*n)
        } else {
            None
        }
    }
}

pub fn parse(text: &str) -> Result<Json, String> {
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    let v = value(&chars, &mut i)?;
    Ok(v)
}

fn skip(c: &[char], i: &mut usize) {
    while *i < c.len() && c[*i].is_whitespace() {
        *i += 1;
    }
}

fn value(c: &[char], i: &mut usize) -> Result<Json, String> {
    skip(c, i);
    match c.get(*i) {
        Some('{') => {
            *i += 1;
            let mut m = BTreeMap::new();
            skip(c, i);
            if c.get(*i) == Some(&'}') {
                *i += 1;
                return Ok(Json::Obj(m));
            }
            loop {
                skip(c, i);
                let Json::Str(k) = value(c, i)? else { return Err("a key must be text".into()) };
                skip(c, i);
                if c.get(*i) != Some(&':') {
                    return Err("expected ':'".into());
                }
                *i += 1;
                let v = value(c, i)?;
                m.insert(k, v);
                skip(c, i);
                match c.get(*i) {
                    Some(',') => *i += 1,
                    Some('}') => {
                        *i += 1;
                        return Ok(Json::Obj(m));
                    }
                    _ => return Err("expected ',' or '}'".into()),
                }
            }
        }
        Some('[') => {
            *i += 1;
            let mut a = Vec::new();
            skip(c, i);
            if c.get(*i) == Some(&']') {
                *i += 1;
                return Ok(Json::Arr(a));
            }
            loop {
                a.push(value(c, i)?);
                skip(c, i);
                match c.get(*i) {
                    Some(',') => *i += 1,
                    Some(']') => {
                        *i += 1;
                        return Ok(Json::Arr(a));
                    }
                    _ => return Err("expected ',' or ']'".into()),
                }
            }
        }
        Some('"') => {
            *i += 1;
            let mut units: Vec<u16> = Vec::new();
            loop {
                let Some(&ch) = c.get(*i) else { return Err("unfinished text".into()) };
                *i += 1;
                match ch {
                    '"' => break,
                    '\\' => {
                        let e = c.get(*i).copied().ok_or("unfinished escape")?;
                        *i += 1;
                        match e {
                            'n' => units.push(10),
                            't' => units.push(9),
                            'r' => units.push(13),
                            'b' => units.push(8),
                            'f' => units.push(12),
                            'u' => {
                                let hex: String = c[*i..*i + 4].iter().collect();
                                *i += 4;
                                units.push(u16::from_str_radix(&hex, 16).map_err(|e| e.to_string())?);
                            }
                            other => {
                                let mut buf = [0u16; 2];
                                units.extend_from_slice(other.encode_utf16(&mut buf));
                            }
                        }
                    }
                    other => {
                        let mut buf = [0u16; 2];
                        units.extend_from_slice(other.encode_utf16(&mut buf));
                    }
                }
            }
            Ok(Json::Str(String::from_utf16_lossy(&units)))
        }
        Some('t') => {
            *i += 4;
            Ok(Json::Bool(true))
        }
        Some('f') => {
            *i += 5;
            Ok(Json::Bool(false))
        }
        Some('n') => {
            *i += 4;
            Ok(Json::Null)
        }
        Some(_) => {
            let start = *i;
            while *i < c.len() && matches!(c[*i], '-' | '+' | '.' | 'e' | 'E' | '0'..='9') {
                *i += 1;
            }
            let s: String = c[start..*i].iter().collect();
            s.parse::<f64>().map(Json::Num).map_err(|_| format!("not a number: {s}"))
        }
        None => Err("nothing to read".into()),
    }
}

// Writing JSON, as JSON.stringify would
pub fn num(n: f64) -> String {
    if n.is_finite() {
        crate::num::show(n)
    } else {
        "null".into()
    }
}
pub fn text(s: &str) -> String {
    crate::value::json_string(s)
}
pub fn obj(fields: &[(&str, String)]) -> String {
    let inner: Vec<String> = fields.iter().map(|(k, v)| format!("{}:{}", text(k), v)).collect();
    format!("{{{}}}", inner.join(","))
}
pub fn arr(items: &[String]) -> String {
    format!("[{}]", items.join(","))
}
