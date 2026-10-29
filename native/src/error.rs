// Where something is in the code, and a mistake: what vm.js's MothError holds.
use crate::num;
use crate::value::Value;
use std::rc::Rc;

#[derive(Clone, Debug, PartialEq)]
pub struct Pos {
    pub line: u32,
    pub col: u32,
    pub file: Option<Rc<str>>, // a file the program uses; the program's own file has none
}

// One call in progress when a mistake happened: the function it ran, where it was called from, and how many
// times in a row, for a function that called itself from the same spot.
#[derive(Clone, Debug, PartialEq)]
pub struct Call {
    pub name: String,
    pub line: u32,
    pub col: u32,
    pub file: Option<Rc<str>>,
    pub times: u64,
}

#[derive(Clone, Debug)]
pub struct MothError {
    pub line: u32,
    pub col: u32,
    pub file: Option<Rc<str>>,
    pub reason: String,
    pub value: Option<Value>, // what `fail with` gave
    pub trail: Vec<Call>,
}

impl MothError {
    pub fn at(pos: &Pos, reason: String) -> MothError {
        MothError { line: pos.line, col: pos.col, file: pos.file.clone(), reason, value: None, trail: vec![] }
    }

    // "line 3: ..." or "math.moth, line 3: ..."
    pub fn message(&self) -> String {
        match &self.file {
            Some(f) => format!("{f}, line {}: {}", self.line, self.reason),
            None => format!("line {}: {}", self.line, self.reason),
        }
    }
}

// The calls in progress, innermost first, with a function that called itself from one spot many times in a
// row as one entry: vm.js's trailOf
pub fn trail_of(calls: Vec<(String, Pos)>) -> Vec<Call> {
    let mut trail: Vec<Call> = Vec::new();
    for (name, at) in calls {
        if let Some(last) = trail.last_mut() {
            if last.name == name && last.line == at.line && last.col == at.col && last.file == at.file {
                last.times += 1;
                continue;
            }
        }
        trail.push(Call { name, line: at.line, col: at.col, file: at.file, times: 1 });
    }
    trail
}

// A trail as lines to show under the mistake, at most `limit` of them
pub fn describe_trail(trail: &[Call], limit: usize) -> String {
    let mut lines: Vec<String> = trail
        .iter()
        .take(limit)
        .map(|c| {
            let file = c.file.as_ref().map(|f| format!("{f}, ")).unwrap_or_default();
            let times = if c.times > 1 { format!(" ({} times)", num::grouped(c.times as f64)) } else { String::new() };
            format!("  in '{}', called from {}line {}{}", c.name, file, c.line, times)
        })
        .collect();
    if trail.len() > limit {
        lines.push(format!("  ... and {} more", trail.len() - limit));
    }
    lines.join("\n")
}

// JavaScript's \s: what a regular expression counts as white space
pub fn js_space(c: u16) -> bool {
    matches!(c, 0x09..=0x0D | 0x20 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x2029 | 0x202F | 0x205F | 0x3000 | 0xFEFF)
}

// The line a mistake points at, with a ^ under the exact spot (columns count UTF-16 units, as JavaScript's do)
pub fn excerpt(source: &str, line: u32, col: u32) -> String {
    let text = split_lines(source).into_iter().nth(line as usize - 1).unwrap_or("");
    let mut marker = String::new();
    for unit in text.encode_utf16().take(col.saturating_sub(1) as usize) {
        if js_space(unit) {
            marker.push(char::from_u32(unit as u32).unwrap());
        } else {
            marker.push(' ');
        }
    }
    format!("{text}\n{marker}^")
}

// source.split(/\r?\n/)
pub fn split_lines(source: &str) -> Vec<&str> {
    source.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect()
}
