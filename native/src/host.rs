// What a program run from the command line has around it: a terminal, the files where it runs (each read or
// written only once it's allowed to), sites, randomness, how its mistakes and drawings are shown, and
// `conform`'s host for the tests. `moth-native run` uses it, and so does a program `moth-native build --exe` makes.
use crate::error::{describe_trail, excerpt, MothError};
use crate::json;
use crate::num;
use crate::vm::{self, Drawn, FileData, Host};
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::io::{IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use std::rc::Rc;

// ---------- randomness ----------

// The random numbers a run gets when it isn't given real ones: the same every time (vm.js's seeded, mulberry32)
pub struct Seeded(pub u32);
impl Seeded {
    pub fn number(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let a = self.0;
        let mut t = (a ^ (a >> 15)).wrapping_mul(a | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
}

// Real randomness, for `moth-native run`: a seed only this run has, from the hasher's per-process keys and the clock
pub struct Real(u64);
impl Real {
    pub fn new() -> Real {
        use std::hash::{BuildHasher, Hasher};
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        Real(h.finish() | 1)
    }
    pub fn number(&mut self) -> f64 {
        // splitmix64
        self.0 = self.0.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^= z >> 31;
        (z >> 11) as f64 / 9007199254740992.0
    }
}

// ---------- a terminal, and the files where moth-native runs ----------

pub struct Terminal {
    pub out: std::io::BufWriter<std::io::Stdout>,
    pub drawn: Vec<Drawn>,
    pub args: Vec<String>,
    pub random: Box<dyn FnMut() -> f64>,
    pub pending: Vec<u8>,                      // what's been read of the input but not yet asked for
    pub said: Option<Vec<String>>,             // for `test`: what it said, kept instead of printed
    pub permits: Option<Rc<RefCell<Permits>>>, // what the program may do; None lets it do anything
}

// ---------- permissions: what a program may do, as Deno has them (disk.js) ----------
// `moth-native run` and `moth-native test` ask before a program reads a file, writes one, or goes online
// (`read "https://..."`). At a terminal the person running it is asked, once for each file or site, or for
// all of them with 'a'; anywhere else the answer is no, unless it was started with --allow-read,
// --allow-write, --allow-net or --allow-all. The first three can say what they allow: --allow-read=data,notes.txt
// (those files, and everything in those folders), --allow-net=example.com (that site).
pub const PERMISSIONS: [(&str, &str, &str); 3] =
    [("read", "read files", "--allow-read"), ("write", "write files", "--allow-write"), ("go online to", "go online", "--allow-net")];
pub const READ: usize = 0;
pub const WRITE: usize = 1;
pub const NET: usize = 2;

#[derive(Default)]
pub struct Permits {
    pub all: [bool; 3],                        // read, write and go online: allowed for everything
    pub named: [Vec<String>; 3],               // or only for these files, folders and sites
    pub asked: HashMap<(usize, String), bool>, // what the person was asked, and said
}

impl Permits {
    // whether this is allowed (READ, WRITE or NET, for this file or site) without asking
    pub fn allows(&self, kind: usize, what: &str) -> bool {
        if self.all[kind] {
            return true;
        }
        let named = &self.named[kind];
        if kind == NET {
            return match host_of(what) {
                Some((host, name)) => named.iter().any(|n| {
                    let n = n.to_ascii_lowercase();
                    n == host || n == name
                }),
                None => false,
            };
        }
        named.iter().any(|n| within(Path::new(n), Path::new(what)))
    }
}

// `--allow-read`, `--allow-write=out`, `--allow-all`...: added to what's allowed; whether it was one of them
pub fn add_allow(permits: &mut Permits, flag: &str) -> bool {
    let Some(rest) = flag.strip_prefix("--allow-") else { return false };
    let (kind, list) = match rest.split_once('=') {
        Some((k, l)) => (k, Some(l)),
        None => (rest, None),
    };
    let kinds: &[usize] = match kind {
        "read" => &[READ],
        "write" => &[WRITE],
        "net" => &[NET],
        "all" if list.is_none() => &[READ, WRITE, NET],
        _ => return false,
    };
    for &k in kinds {
        match list {
            None => permits.all[k] = true,
            Some(l) => permits.named[k].extend(l.split(',').filter(|n| !n.is_empty()).map(str::to_string)),
        }
    }
    true
}

// Where a file really is, its links followed, so a link can't lead outside what's allowed; for a file that
// isn't there yet, where its folder really is. None for a link that leads nowhere, or a missing folder.
pub fn real_of(path: &Path) -> Option<PathBuf> {
    if std::fs::symlink_metadata(path).is_ok() {
        return std::fs::canonicalize(path).ok();
    }
    let folder = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    };
    Some(std::fs::canonicalize(folder).ok()?.join(path.file_name()?))
}

// whether `name` is the file `folder`, or anywhere inside the folder `folder`
pub fn within(folder: &Path, name: &Path) -> bool {
    match (real_of(folder), real_of(name)) {
        (Some(base), Some(real)) => real.starts_with(base),
        _ => false,
    }
}

pub fn is_site(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

// A site's host (example.com:8080) and its name without the port, from its address; None if the address is
// written in any odd way, so a name given to --allow-net can't match it by mistake
pub fn host_of(url: &str) -> Option<(String, String)> {
    let lower = url.to_ascii_lowercase();
    let rest = lower.strip_prefix("http://").or_else(|| lower.strip_prefix("https://"))?;
    let host = &rest[..rest.find(['/', '?', '#', '\\']).unwrap_or(rest.len())];
    let (name, port) = if host.starts_with('[') {
        let end = host.find(']')?;
        (&host[..=end], &host[end + 1..])
    } else {
        match host.find(':') {
            Some(i) => (&host[..i], &host[i..]),
            None => (host, ""),
        }
    };
    let good_name = if let Some(inner) = name.strip_prefix('[').and_then(|n| n.strip_suffix(']')) {
        !inner.is_empty() && inner.chars().all(|c| c.is_ascii_hexdigit() || c == ':' || c == '.')
    } else {
        !name.is_empty() && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-')
    };
    let good_port = port.is_empty() || (port.len() > 1 && port[1..].chars().all(|c| c.is_ascii_digit()));
    if !good_name || !good_port || port.starts_with(|c: char| c != ':') {
        return None;
    }
    Some((host.to_string(), name.to_string()))
}

// a file or site's name as a question shows it: nothing in it can move the cursor or turn the text around
// (control characters, zero-width ones, and those that change the text's direction)
pub fn shown_name(name: &str) -> String {
    const HIDDEN: [(u32, u32); 5] = [(0x00, 0x1f), (0x7f, 0x9f), (0x200b, 0x200f), (0x2028, 0x202e), (0x2066, 0x2069)];
    name.chars().map(|c| if HIDDEN.iter().any(|&(low, high)| (low..=high).contains(&(c as u32))) { '?' } else { c }).collect()
}

// what a site answered: its page, or another address it sends the program on to
#[cfg_attr(target_family = "wasm", allow(dead_code))] // WebAssembly can't go online
pub enum Fetched {
    Page(Vec<u8>),
    Moved(String),
}

// a site's page, as `read` gets a file, by curl, which doesn't follow the site to another address by itself
#[cfg(not(target_family = "wasm"))]
pub fn fetch_once(url: &str) -> Result<Fetched, String> {
    let ran = std::process::Command::new("curl")
        .args(["-sS", "--max-time", "60", "--proto", "=http,https", "-w", "\n%{http_code} %{redirect_url}", url])
        .output()
        .map_err(|e| format!("couldn't reach it (curl, which goes online for moth-native, didn't run: {e})"))?;
    let mut body = ran.stdout;
    let end = body.iter().rposition(|&b| b == b'\n').unwrap_or(0);
    let tail = String::from_utf8_lossy(&body[end..]).trim().to_string();
    let (status, moved) = tail.split_once(' ').unwrap_or((tail.as_str(), ""));
    let status: u32 = status.parse().unwrap_or(0);
    let moved = moved.to_string();
    body.truncate(end);
    if !ran.status.success() || status == 0 {
        let why = String::from_utf8_lossy(&ran.stderr).trim().trim_start_matches("curl: ").to_string();
        let why = match why.split_once(") ") {
            Some((code, rest)) if code.starts_with('(') => rest.to_string(), // "(6) Could not resolve host": the words
            _ => why,
        };
        return Err(format!("couldn't reach it ({})", if why.is_empty() { "no answer".into() } else { why }));
    }
    if (300..400).contains(&status) && !moved.is_empty() {
        return Ok(Fetched::Moved(moved));
    }
    if status >= 300 {
        return Err(format!("the site answered {status}"));
    }
    Ok(Fetched::Page(body))
}
#[cfg(target_family = "wasm")]
pub fn fetch_once(_: &str) -> Result<Fetched, String> {
    Err("couldn't reach it (WebAssembly can't go online)".into())
}

impl Terminal {
    pub fn new(args: Vec<String>, random: Box<dyn FnMut() -> f64>) -> Terminal {
        Terminal {
            out: std::io::BufWriter::new(std::io::stdout()),
            drawn: vec![],
            args,
            random,
            pending: vec![],
            said: None,
            permits: None,
        }
    }

    // whether the program may do this (READ, WRITE or NET) to this file or site, asking if there's a person to ask
    pub fn permit(&mut self, kind: usize, what: &str) -> Result<(), String> {
        let Some(permits) = self.permits.clone() else { return Ok(()) };
        if permits.borrow().allows(kind, what) {
            return Ok(());
        }
        let key = (kind, what.to_string());
        let asked = permits.borrow().asked.contains_key(&key);
        if !asked && std::io::stdin().is_terminal() && std::io::stderr().is_terminal() {
            let _ = self.out.flush();
            eprint!("moth-native: let this program {} '{}'? (y = yes, a = yes to all, n = no) ", PERMISSIONS[kind].0, shown_name(what));
            let answer = self.read_line().unwrap_or_default().trim().to_lowercase();
            let mut p = permits.borrow_mut();
            if answer == "a" || answer == "all" {
                p.all[kind] = true;
            }
            p.asked.insert(key.clone(), ["y", "yes", "a", "all"].contains(&answer.as_str()));
        }
        let p = permits.borrow();
        if p.allows(kind, what) || p.asked.get(&key) == Some(&true) {
            return Ok(());
        }
        let (_, doing, flag) = PERMISSIONS[kind];
        Err(format!("this program isn't allowed to {doing} (start it with {flag})"))
    }

    // A site's page: a site that sends the program on to another address is asked about again, there
    pub fn fetch(&mut self, url: &str) -> Result<Vec<u8>, String> {
        let mut url = url.to_string();
        let mut moves = 0;
        loop {
            match fetch_once(&url)? {
                Fetched::Page(body) => return Ok(body),
                Fetched::Moved(next) => {
                    if moves == 10 {
                        return Err("it moved too many times".into());
                    }
                    if !is_site(&next) {
                        return Err(format!("it moved to '{}', which isn't a site", shown_name(&next)));
                    }
                    if let Err(why) = self.permit(NET, &next) {
                        return Err(format!("it moved to '{}', and {why}", shown_name(&next)));
                    }
                    url = next;
                    moves += 1;
                }
            }
        }
    }

    // A line of standard input: from a terminal it waits for Enter, from a pipe it takes the next line. None at the end.
    pub fn read_line(&mut self) -> Option<String> {
        loop {
            if let Some(end) = self.pending.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = self.pending.drain(..=end).collect();
                let text = String::from_utf8_lossy(&line[..line.len() - 1]).into_owned();
                return Some(text.strip_suffix('\r').map(str::to_string).unwrap_or(text));
            }
            let mut chunk = [0u8; 4096];
            let n = std::io::stdin().read(&mut chunk).unwrap_or(0);
            if n == 0 {
                if self.pending.is_empty() {
                    return None;
                }
                let text = String::from_utf8_lossy(&self.pending).into_owned();
                self.pending.clear();
                return Some(text);
            }
            self.pending.extend_from_slice(&chunk[..n]);
        }
    }
}

// what Node says about a file it can't read or write, so both engines give the same message
pub fn file_error(e: &std::io::Error, name: &str, reading: bool) -> String {
    if Path::new(name).is_dir() {
        return format!(
            "EISDIR: illegal operation on a directory, {}",
            if reading { "read".to_string() } else { format!("open '{name}'") }
        );
    }
    match e.kind() {
        std::io::ErrorKind::NotFound => format!("ENOENT: no such file or directory, open '{name}'"),
        std::io::ErrorKind::PermissionDenied => format!("EACCES: permission denied, open '{name}'"),
        _ => e.to_string(),
    }
}

impl Host for Terminal {
    fn print(&mut self, line: &str) {
        match &mut self.said {
            Some(said) => said.push(line.to_string()),
            None => {
                let _ = writeln!(self.out, "{line}");
            }
        }
    }
    fn draw(&mut self, item: Drawn) {
        self.drawn.push(item);
    }
    fn ask(&mut self, question: &str) -> Option<Option<String>> {
        let _ = write!(self.out, "{question} ");
        let _ = self.out.flush();
        let answer = self.read_line();
        match &answer {
            None => {
                let _ = writeln!(self.out);
            }
            Some(a) if !std::io::stdin().is_terminal() => {
                let _ = writeln!(self.out, "{a}"); // piped answers are shown, as if typed
            }
            _ => {}
        }
        Some(answer)
    }
    fn read(&mut self, name: &str, bytes: bool) -> Option<Result<Option<FileData>, String>> {
        let as_data =
            |data: Vec<u8>| if bytes { FileData::Bytes(data) } else { FileData::Text(String::from_utf8_lossy(&data).into_owned()) };
        if let Err(why) = self.permit(if is_site(name) { NET } else { READ }, name) {
            return Some(Err(why));
        }
        if is_site(name) {
            return Some(self.fetch(name).map(|data| Some(as_data(data))));
        }
        Some(match std::fs::read(name) {
            Ok(data) => Ok(Some(if bytes { FileData::Bytes(data) } else { FileData::Text(String::from_utf8_lossy(&data).into_owned()) })),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(file_error(&e, name, true)),
        })
    }
    fn write(&mut self, name: &str, data: FileData) -> Option<Result<(), String>> {
        if let Err(why) = self.permit(WRITE, name) {
            return Some(Err(why));
        }
        let bytes = match data {
            FileData::Text(t) => t.into_bytes(),
            FileData::Bytes(b) => b,
        };
        Some(std::fs::write(name, bytes).map_err(|e| file_error(&e, name, false)))
    }
    fn args(&self) -> Vec<String> {
        self.args.clone()
    }
    fn random(&mut self) -> f64 {
        (self.random)()
    }
}

// What `use "x.moth"` reads: a file next to the program, kept so a mistake in it can show its line
pub struct Sources {
    pub dir: PathBuf,
    pub read: RefCell<HashMap<String, Option<String>>>,
}
impl Sources {
    pub fn beside(program: &str) -> Sources {
        let dir = Path::new(program).parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
        Sources { dir: dir.to_path_buf(), read: RefCell::new(HashMap::new()) }
    }
    pub fn get(&self, name: &str) -> Option<String> {
        self.read
            .borrow_mut()
            .entry(name.to_string())
            .or_insert_with(|| {
                let path = self.dir.join(name);
                if !within(&self.dir, &path) {
                    return None; // a link out of the program's folder
                }
                std::fs::read(path).ok().map(|d| without_bom(String::from_utf8_lossy(&d).into_owned()))
            })
            .clone()
    }
}

pub fn without_bom(s: String) -> String {
    s.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(s)
}

pub fn basename(file: &str) -> String {
    Path::new(file).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| file.to_string())
}

// file:line:col: reason, then the line with the spot marked, then the calls that led there
pub fn report(err: &MothError, source: &str, file: &str, used: &dyn Fn(&str) -> Option<String>) -> String {
    let where_ = err.file.as_deref().map(str::to_string).unwrap_or_else(|| file.to_string());
    let text = match &err.file {
        Some(f) => used(f).unwrap_or_default(),
        None => source.to_string(),
    };
    let mut out = format!("{where_}:{}:{}: {}\n{}", err.line, err.col, err.reason, excerpt(&text, err.line, err.col));
    if !err.trail.is_empty() {
        out += &format!("\n{}", describe_trail(&err.trail, 10));
    }
    out
}

// ---------- drawings as SVG, as cli.js's svg() writes them ----------

pub fn js_min(values: &[f64]) -> f64 {
    values.iter().fold(f64::INFINITY, |m, &v| if v.is_nan() || m.is_nan() { f64::NAN } else { m.min(v) })
}
pub fn js_max(values: &[f64]) -> f64 {
    values.iter().fold(f64::NEG_INFINITY, |m, &v| if v.is_nan() || m.is_nan() { f64::NAN } else { m.max(v) })
}

pub fn svg(drawn: &[Drawn]) -> String {
    let start = drawn.iter().rposition(|d| matches!(d, Drawn::Clear)).map(|i| i + 1).unwrap_or(0);
    let items = &drawn[start..];
    let (mut left, mut right, mut bottom, mut top) = (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY);
    let mut reach = |x1: f64, y1: f64, x2: f64, y2: f64, pad: f64| {
        left = js_min(&[left, x1 - pad, x2 - pad]);
        right = js_max(&[right, x1 + pad, x2 + pad]);
        bottom = js_min(&[bottom, y1 - pad, y2 - pad]);
        top = js_max(&[top, y1 + pad, y2 + pad]);
    };
    for d in items {
        match d {
            Drawn::Box { x, y, width, height, .. } => reach(*x, *y, x + width, y + height, 10.0),
            Drawn::Circle { x, y, radius, .. } => reach(*x, *y, *x, *y, radius + 10.0),
            Drawn::Text { text, x, y, size, .. } => reach(*x, *y, x + text.encode_utf16().count() as f64 * size * 0.6, y + size, 10.0),
            Drawn::Line { x1, y1, x2, y2, width, .. } => reach(*x1, *y1, *x2, *y2, width / 2.0 + 10.0),
            Drawn::Clear => {}
        }
    }
    if items.is_empty() {
        (left, right, bottom, top) = (-10.0, 10.0, -10.0, 10.0);
    }
    let n = |v: f64| num::show(v);
    let attr = |s: &str| {
        let mut out = String::new();
        for c in s.chars() {
            match c {
                '&' | '"' | '<' | '>' => out += &format!("&#{};", c as u32),
                c => out.push(c),
            }
        }
        out
    };
    let body: Vec<String> = items
        .iter()
        .map(|d| match d {
            Drawn::Box { x, y, width, height, color } => format!(
                "  <rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{}\"/>",
                n(js_min(&[*x, x + width])),
                n(-js_max(&[*y, y + height])),
                n(width.abs()),
                n(height.abs()),
                attr(color)
            ),
            Drawn::Circle { x, y, radius, color } => {
                format!("  <circle cx=\"{}\" cy=\"{}\" r=\"{}\" fill=\"{}\"/>", n(*x), n(-y), n(*radius), attr(color))
            }
            Drawn::Text { text, x, y, size, color } => format!(
                "  <text x=\"{}\" y=\"{}\" font-size=\"{}\" font-family=\"sans-serif\" fill=\"{}\">{}</text>",
                n(*x),
                n(-y),
                n(*size),
                attr(color),
                attr(text)
            ),
            Drawn::Line { x1, y1, x2, y2, color, width } => format!(
                "  <line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"{}\" stroke-width=\"{}\"/>",
                n(*x1),
                n(-y1),
                n(*x2),
                n(-y2),
                attr(color),
                n(*width)
            ),
            Drawn::Clear => String::new(),
        })
        .collect();
    let view: Vec<String> = [left, -top, right - left, top - bottom].iter().map(|v| n(num::round(v * 100.0) / 100.0)).collect();
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"{}\" stroke-linecap=\"round\">\n{}\n</svg>\n",
        view.join(" "),
        body.join("\n")
    )
}

// ---------- commands ----------

// Runs a program's source with `host`: Ok(whether it set up an app) or its mistake
// After a run: its mistake, or that it's an app, and its drawing saved as an SVG; the exit code. `used` gives the
// text of the files the program used, to show a mistake in one.
pub fn finish(
    result: Result<bool, MothError>,
    terminal: &mut Terminal,
    file: &str,
    source: &str,
    used: &dyn Fn(&str) -> Option<String>,
) -> i32 {
    let _ = terminal.out.flush();
    match result {
        Err(err) => {
            eprintln!("{}", report(&err, source, file, used));
            1
        }
        Ok(app) => {
            if app {
                eprintln!(
                    "{} is an app: it waits for keys, clicks or time, which a terminal can't give it. Open it in the playground: https://samyyy2423.github.io/moth/",
                    basename(file)
                );
            }
            if !terminal.drawn.is_empty() {
                let out = format!("{}.svg", strip_moth(file));
                let shapes = terminal.drawn.iter().any(|d| !matches!(d, Drawn::Line { .. }));
                if let Err(e) = std::fs::write(&out, svg(&terminal.drawn)) {
                    eprintln!("moth-native: can't write {out} ({e})");
                    return 1;
                }
                eprintln!("drew {} {} -> {out}", terminal.drawn.len(), if shapes { "lines and shapes" } else { "lines" });
            }
            0
        }
    }
}

pub fn read_program(file: &str) -> Result<String, String> {
    match std::fs::read(file) {
        Ok(data) => Ok(without_bom(String::from_utf8_lossy(&data).into_owned())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(format!("moth-native: can't read {file} (no such file)")),
        Err(e) => Err(format!("moth-native: can't read {file} ({e})")),
    }
}

pub fn strip_moth_c(file: &str) -> &str {
    if file.len() >= 6 && file[file.len() - 6..].eq_ignore_ascii_case(".mothc") {
        &file[..file.len() - 6]
    } else {
        strip_moth(file)
    }
}

pub fn strip_moth(file: &str) -> &str {
    if file.len() >= 5 && file[file.len() - 5..].eq_ignore_ascii_case(".moth") {
        &file[..file.len() - 5]
    } else {
        file
    }
}

pub struct Conform {
    pub said: Vec<String>,
    pub drawn: Vec<Drawn>,
    pub answers: Option<VecDeque<String>>,
    pub disk: Option<BTreeMap<String, FileData>>,
    pub args: Vec<String>,
    pub random: Seeded,
}

impl Host for Conform {
    fn print(&mut self, line: &str) {
        self.said.push(line.to_string());
    }
    fn draw(&mut self, item: Drawn) {
        self.drawn.push(item);
    }
    fn ask(&mut self, _question: &str) -> Option<Option<String>> {
        self.answers.as_mut().map(|a| a.pop_front())
    }
    fn read(&mut self, name: &str, bytes: bool) -> Option<Result<Option<FileData>, String>> {
        let disk = self.disk.as_ref()?;
        Some(Ok(disk.get(name).map(|data| match (data, bytes) {
            (FileData::Text(t), false) => FileData::Text(t.clone()),
            (FileData::Text(t), true) => FileData::Bytes(t.as_bytes().to_vec()),
            (FileData::Bytes(b), true) => FileData::Bytes(b.clone()),
            (FileData::Bytes(b), false) => {
                FileData::Text(String::from_utf8_lossy(b.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(b)).into_owned())
            }
        })))
    }
    fn write(&mut self, name: &str, data: FileData) -> Option<Result<(), String>> {
        self.disk.as_mut()?.insert(name.to_string(), data);
        Some(Ok(()))
    }
    fn args(&self) -> Vec<String> {
        self.args.clone()
    }
    fn random(&mut self) -> f64 {
        self.random.number()
    }
}

pub fn drawn_json(d: &Drawn) -> String {
    use json::{num as n, obj, text as t};
    match d {
        Drawn::Line { x1, y1, x2, y2, color, width } => {
            obj(&[("x1", n(*x1)), ("y1", n(*y1)), ("x2", n(*x2)), ("y2", n(*y2)), ("color", t(color)), ("width", n(*width))])
        }
        Drawn::Clear => obj(&[("clear", "true".into())]),
        Drawn::Box { x, y, width, height, color } => {
            obj(&[("shape", t("box")), ("x", n(*x)), ("y", n(*y)), ("width", n(*width)), ("height", n(*height)), ("color", t(color))])
        }
        Drawn::Circle { x, y, radius, color } => {
            obj(&[("shape", t("circle")), ("x", n(*x)), ("y", n(*y)), ("radius", n(*radius)), ("color", t(color))])
        }
        Drawn::Text { text, x, y, size, color } => {
            obj(&[("shape", t("text")), ("text", t(text)), ("x", n(*x)), ("y", n(*y)), ("size", n(*size)), ("color", t(color))])
        }
    }
}

// What conform_one hands whatever runs the program, and what it hands back
pub struct Job<'a> {
    pub source: &'a str,
    pub files: &'a dyn Fn(&str) -> Option<String>,
    pub max_steps: f64,
    pub bytecode: bool,
    pub mothc: bool,
}
pub struct Ran {
    pub result: Result<(), MothError>,
    pub listeners: Vec<vm::Listener>, // only when it set up without a mistake, as run() in moth.js gives an app
    pub bytecode: String,
    pub mothc: String,
}

// one job of `conform`: a program, run by `run`, and what it said, drew, wrote and failed with, as JSON
pub fn conform_one(line: &str, run: &mut dyn FnMut(Job, &mut Conform) -> Ran) -> String {
    use json::{arr, num as n, obj, text as t};
    let request = match json::parse(line) {
        Ok(r) => r,
        Err(e) => return obj(&[("crash", t(&format!("bad request: {e}")))]),
    };
    let source = request.get("source").and_then(|s| s.str()).unwrap_or("").to_string();
    let files: HashMap<String, String> = match request.get("files") {
        Some(json::Json::Obj(m)) => m.iter().filter_map(|(k, v)| v.str().map(|s| (k.clone(), s.to_string()))).collect(),
        _ => HashMap::new(),
    };
    let disk = match request.get("disk") {
        Some(json::Json::Obj(m)) => Some(
            m.iter()
                .map(|(k, v)| {
                    let data = match (v.get("text"), v.get("bytes")) {
                        (Some(text), _) => FileData::Text(text.str().unwrap_or("").to_string()),
                        (_, Some(json::Json::Arr(bytes))) => FileData::Bytes(bytes.iter().map(|b| b.num().unwrap_or(0.0) as u8).collect()),
                        _ => FileData::Text(String::new()),
                    };
                    (k.clone(), data)
                })
                .collect(),
        ),
        _ => None,
    };
    let strings = |key: &str| -> Option<Vec<String>> {
        match request.get(key) {
            Some(json::Json::Arr(a)) => Some(a.iter().map(|s| s.str().unwrap_or("").to_string()).collect()),
            _ => None,
        }
    };
    let mut host = Conform {
        said: vec![],
        drawn: vec![],
        answers: strings("answers").map(VecDeque::from),
        disk,
        args: strings("args").unwrap_or_default(),
        random: Seeded(request.get("seed").and_then(|s| s.num()).unwrap_or(1.0) as u32),
    };
    let max_steps = request.get("maxSteps").and_then(|s| s.num()).unwrap_or(f64::INFINITY);
    let read = |name: &str| files.get(name).cloned();
    let job = Job {
        source: &source,
        files: &read,
        max_steps,
        bytecode: matches!(request.get("bytecode"), Some(json::Json::Bool(true))),
        mothc: matches!(request.get("mothc"), Some(json::Json::Bool(true))),
    };
    let Ran { result, listeners, bytecode, mothc } = run(job, &mut host);
    let mut app = Vec::new();
    for l in &listeners {
        let mut fields = vec![("event", t(l.event))];
        if let Some(i) = l.interval {
            fields.push(("interval", n(i)));
        }
        app.push(obj(&fields));
    }
    let error = match &result {
        Ok(()) => "null".to_string(),
        Err(e) => {
            let trail: Vec<String> = e
                .trail
                .iter()
                .map(|c| {
                    obj(&[
                        ("name", t(&c.name)),
                        ("line", n(c.line as f64)),
                        ("col", n(c.col as f64)),
                        ("file", c.file.as_deref().map(t).unwrap_or("null".into())),
                        ("times", n(c.times as f64)),
                    ])
                })
                .collect();
            obj(&[("message", t(&e.message())), ("col", n(e.col as f64)), ("trail", arr(&trail))])
        }
    };
    let disk = match &host.disk {
        None => "null".to_string(),
        Some(d) => {
            let entries: Vec<(&str, String)> = d
                .iter()
                .map(|(k, v)| {
                    let data = match v {
                        FileData::Text(s) => obj(&[("text", t(s))]),
                        FileData::Bytes(b) => obj(&[("bytes", arr(&b.iter().map(|x| x.to_string()).collect::<Vec<_>>()))]),
                    };
                    (k.as_str(), data)
                })
                .collect();
            obj(&entries)
        }
    };
    obj(&[
        ("said", arr(&host.said.iter().map(|s| t(s)).collect::<Vec<_>>())),
        ("drawn", arr(&host.drawn.iter().map(drawn_json).collect::<Vec<_>>())),
        ("error", error),
        ("disk", disk),
        ("app", arr(&app)),
        ("bytecode", bytecode),
        ("mothc", mothc),
    ])
}
