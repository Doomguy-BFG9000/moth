// moth-native: Moth with no JavaScript anywhere. Its own lexer, parser, compiler and virtual machine, which
// run every program exactly as the JavaScript engines do (the tests check that on thousands of programs).
mod bytecode;
mod compiler;
mod error;
mod json;
mod lexer;
mod num;
mod parser;
mod value;
mod vm;

use compiler::{compile, disassemble, parse_program};
use error::{describe_trail, excerpt, MothError};
use parser::Stmt;
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::io::{BufRead, IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use vm::{Drawn, FileData, Host, Machine};

const USAGE: &str = "usage:
  moth-native run <file.moth> [arguments...]
                              run a program; if it draws, the drawing goes to <file>.svg; what follows
                              the file is the program's arguments
  moth-native test [files...] run the tests: each function named test_..., on its own; with no file,
                              every file ending in .test.moth here and in the folders inside
  moth-native build <file.moth>
                              compile it to <file>.mothc, bytecode moth-native runs without compiling again
  moth-native bytecode <file.moth>
                              show the bytecode the compiler makes, the same as `moth bytecode`
  moth-native bootstrap <compiler.moth>
                              build Moth's compiler written in Moth with itself, three times over, with no
                              JavaScript anywhere";

// ---------- randomness ----------

// The random numbers a run gets when it isn't given real ones: the same every time (vm.js's seeded, mulberry32)
pub struct Seeded(u32);
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
struct Real(u64);
impl Real {
    fn new() -> Real {
        use std::hash::{BuildHasher, Hasher};
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        Real(h.finish() | 1)
    }
    fn number(&mut self) -> f64 {
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

struct Terminal {
    out: std::io::BufWriter<std::io::Stdout>,
    drawn: Vec<Drawn>,
    args: Vec<String>,
    random: Box<dyn FnMut() -> f64>,
    pending: Vec<u8>,          // what's been read of the input but not yet asked for
    said: Option<Vec<String>>, // for `test`: what it said, kept instead of printed
}

impl Terminal {
    fn new(args: Vec<String>, random: Box<dyn FnMut() -> f64>) -> Terminal {
        Terminal { out: std::io::BufWriter::new(std::io::stdout()), drawn: vec![], args, random, pending: vec![], said: None }
    }

    // A line of standard input: from a terminal it waits for Enter, from a pipe it takes the next line. None at the end.
    fn read_line(&mut self) -> Option<String> {
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
fn file_error(e: &std::io::Error, name: &str, reading: bool) -> String {
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
        Some(match std::fs::read(name) {
            Ok(data) => Ok(Some(if bytes { FileData::Bytes(data) } else { FileData::Text(String::from_utf8_lossy(&data).into_owned()) })),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(file_error(&e, name, true)),
        })
    }
    fn write(&mut self, name: &str, data: FileData) -> Option<Result<(), String>> {
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
struct Sources {
    dir: PathBuf,
    read: RefCell<HashMap<String, Option<String>>>,
}
impl Sources {
    fn beside(program: &str) -> Sources {
        Sources { dir: Path::new(program).parent().map(Path::to_path_buf).unwrap_or_default(), read: RefCell::new(HashMap::new()) }
    }
    fn get(&self, name: &str) -> Option<String> {
        self.read
            .borrow_mut()
            .entry(name.to_string())
            .or_insert_with(|| std::fs::read(self.dir.join(name)).ok().map(|d| without_bom(String::from_utf8_lossy(&d).into_owned())))
            .clone()
    }
}

fn without_bom(s: String) -> String {
    s.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(s)
}

fn basename(file: &str) -> String {
    Path::new(file).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| file.to_string())
}

// file:line:col: reason, then the line with the spot marked, then the calls that led there
fn report(err: &MothError, source: &str, file: &str, sources: &Sources) -> String {
    let where_ = err.file.as_deref().map(str::to_string).unwrap_or_else(|| file.to_string());
    let text = match &err.file {
        Some(f) => sources.get(f).unwrap_or_default(),
        None => source.to_string(),
    };
    let mut out = format!("{where_}:{}:{}: {}\n{}", err.line, err.col, err.reason, excerpt(&text, err.line, err.col));
    if !err.trail.is_empty() {
        out += &format!("\n{}", describe_trail(&err.trail, 10));
    }
    out
}

// ---------- drawings as SVG, as cli.js's svg() writes them ----------

fn js_min(values: &[f64]) -> f64 {
    values.iter().fold(f64::INFINITY, |m, &v| if v.is_nan() || m.is_nan() { f64::NAN } else { m.min(v) })
}
fn js_max(values: &[f64]) -> f64 {
    values.iter().fold(f64::NEG_INFINITY, |m, &v| if v.is_nan() || m.is_nan() { f64::NAN } else { m.max(v) })
}

fn svg(drawn: &[Drawn]) -> String {
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
fn run_source(source: &str, sources: &Sources, file: &str, host: &mut dyn Host, max_steps: f64) -> Result<bool, MothError> {
    let main = compile(source, &|name| sources.get(name), Some(&basename(file)))?;
    let env = vm::new_env(&main, None);
    let mut machine = Machine::new(host, max_steps);
    machine.run(main, env)?;
    Ok(!machine.listeners.is_empty())
}

fn read_program(file: &str) -> Result<String, String> {
    match std::fs::read(file) {
        Ok(data) => Ok(without_bom(String::from_utf8_lossy(&data).into_owned())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(format!("moth-native: can't read {file} (no such file)")),
        Err(e) => Err(format!("moth-native: can't read {file} ({e})")),
    }
}

fn run_command(file: &str, args: Vec<String>) -> i32 {
    let mut source = match read_program(file) {
        Ok(s) => s,
        Err(message) => {
            eprintln!("{message}");
            return 1;
        }
    };
    let sources = Sources::beside(file);
    let mut real = Real::new();
    let mut terminal = Terminal::new(args, Box::new(move || real.number()));
    let result = if bytecode::is_bytecode(&source) {
        // compiled already: the program's own source, if it's beside it, is only for showing mistakes
        let program = match bytecode::read(&source) {
            Ok(p) => Rc::new(p),
            Err(why) => {
                eprintln!("moth-native: {file}: {why}");
                return 1;
            }
        };
        source =
            std::fs::read(format!("{}.moth", strip_moth_c(file))).map(|d| String::from_utf8_lossy(&d).into_owned()).unwrap_or_default();
        let env = vm::new_env(&program, None);
        let mut machine = Machine::new(&mut terminal, f64::INFINITY);
        machine.run(program, env).map(|()| !machine.listeners.is_empty())
    } else {
        run_source(&source, &sources, file, &mut terminal, f64::INFINITY)
    };
    let _ = terminal.out.flush();
    match result {
        Err(err) => {
            eprintln!("{}", report(&err, &source, file, &sources));
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

fn strip_moth_c(file: &str) -> &str {
    if file.len() >= 6 && file[file.len() - 6..].eq_ignore_ascii_case(".mothc") {
        &file[..file.len() - 6]
    } else {
        strip_moth(file)
    }
}

// `moth-native build`: the program's bytecode, as a file to run later without compiling it again
fn build_command(file: &str) -> i32 {
    let source = match read_program(file) {
        Ok(s) => s,
        Err(message) => {
            eprintln!("{message}");
            return 1;
        }
    };
    let sources = Sources::beside(file);
    match compile(&source, &|name| sources.get(name), Some(&basename(file))) {
        Ok(main) => {
            let out = format!("{}.mothc", strip_moth(file));
            if let Err(e) = std::fs::write(&out, bytecode::write(&main)) {
                eprintln!("moth-native: can't write {out} ({e})");
                return 1;
            }
            println!("compiled {file} -> {out}");
            0
        }
        Err(err) => {
            eprintln!("{}", report(&err, &source, file, &sources));
            1
        }
    }
}

// `moth-native bootstrap`: compiler.moth, with a line that compiles the program it's part of, compiled by this
// engine's compiler; then that bytecode, run, compiles it again with compiler.moth's own bytecode back end;
// then what that made does the same, and again. Each must make exactly the bytecode this engine's compiler
// made: the compiler written in Moth builds itself, with Rust running it and no JavaScript anywhere.
fn bootstrap_command(file: &str) -> i32 {
    let compiler = match read_program(file) {
        Ok(s) => s,
        Err(message) => {
            eprintln!("{message}");
            return 1;
        }
    };
    let whole = format!("{}\nwrite compile_bytecode(read \"self.moth\", empty list) to \"self.mothc\"\n", compiler.trim_end());
    let first = match compile(&whole, &|_| None, None) {
        Ok(main) => bytecode::write(&main),
        Err(err) => {
            eprintln!("{}", report(&err, &whole, file, &Sources::beside(file)));
            return 1;
        }
    };
    println!(
        "{}: {} lines of Moth, which moth-native's compiler (in Rust) makes into {} bytes of bytecode",
        basename(file),
        compiler.lines().count(),
        first.len()
    );
    let mut current = first.clone();
    for stage in 1..=3 {
        let program = match bytecode::read(&current) {
            Ok(p) => Rc::new(p),
            Err(why) => {
                eprintln!("moth-native: stage {stage}'s bytecode: {why}");
                return 1;
            }
        };
        let mut host = Conform {
            said: vec![],
            drawn: vec![],
            answers: None,
            disk: Some(BTreeMap::from([("self.moth".to_string(), FileData::Text(whole.clone()))])),
            args: vec![],
            random: Seeded(1),
        };
        let start = std::time::Instant::now();
        let ran = Machine::new(&mut host, f64::INFINITY).run(program.clone(), vm::new_env(&program, None));
        let ms = start.elapsed().as_millis();
        if let Err(err) = ran {
            eprintln!("stage {stage} failed: {}", err.message());
            return 1;
        }
        let made = match host.disk.as_ref().and_then(|d| d.get("self.mothc")) {
            Some(FileData::Text(t)) => t.clone(),
            _ => {
                eprintln!("stage {stage} made no bytecode");
                return 1;
            }
        };
        let by = if stage == 1 { "moth-native's compiler".to_string() } else { format!("stage {}", stage - 1) };
        let same = made == first;
        println!(
            "stage {stage}, made by {by}, compiles compiler.moth: {} ({ms} ms)",
            if same { "the same bytecode" } else { "DIFFERENT bytecode" }
        );
        if !same {
            return 1;
        }
        current = made;
    }
    println!("fixed point: the compiler written in Moth builds itself to exactly what moth-native's compiler makes, with no JavaScript");
    0
}

fn strip_moth(file: &str) -> &str {
    if file.len() >= 5 && file[file.len() - 5..].eq_ignore_ascii_case(".moth") {
        &file[..file.len() - 5]
    } else {
        file
    }
}

fn bytecode_command(file: &str) -> i32 {
    let source = match read_program(file) {
        Ok(s) => s,
        Err(message) => {
            eprintln!("{message}");
            return 1;
        }
    };
    let sources = Sources::beside(file);
    match compile(&source, &|name| sources.get(name), Some(&basename(file))) {
        Ok(main) => {
            println!("{}", disassemble(&main));
            0
        }
        Err(err) => {
            eprintln!("{}", report(&err, &source, file, &sources));
            1
        }
    }
}

// Every file ending in .test.moth in a folder and the folders inside it, but not node_modules or hidden ones,
// named as Node's path.join names them: "a.test.moth" and "tools/b.test.moth", not "./a.test.moth"
fn find_tests(dir: &str, found: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| (e.file_name().to_string_lossy().to_lowercase(), e.file_name()));
    for e in entries {
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        let path = if dir == "." { name.clone() } else { format!("{dir}{}{name}", std::path::MAIN_SEPARATOR) };
        if e.path().is_dir() {
            find_tests(&path, found);
        } else if name.ends_with(".test.moth") {
            found.push(path);
        }
    }
}

// One file's tests, each function at its top level named test_something, in a fresh run of the file
fn test_file(file: &str, source: &str) -> Result<(usize, usize), MothError> {
    let sources = Sources::beside(file);
    let program = parse_program(source, &|name| sources.get(name), Some(&basename(file)))?;
    let names: Vec<String> = program
        .iter()
        .filter_map(|s| if let Stmt::Define(f) = s { Some(f.name.clone()) } else { None })
        .filter(|n| n.starts_with("test_"))
        .collect();
    let last = source.split('\n').count() as u32;
    let mut out = std::io::stdout();
    let (mut passed, mut failed) = (0, 0);
    let tests: Vec<Option<String>> = if names.is_empty() { vec![None] } else { names.into_iter().map(Some).collect() };
    for name in tests {
        let code = match &name {
            Some(n) => format!("{source}\n{n}()"),
            None => source.to_string(),
        };
        let mut seeded = Seeded(1);
        let mut terminal = Terminal::new(vec![], Box::new(move || seeded.number()));
        terminal.said = Some(vec![]);
        let result = run_source(&code, &sources, file, &mut terminal, f64::INFINITY);
        let label = name.clone().unwrap_or_else(|| basename(file));
        match result {
            Ok(_) => {
                passed += 1;
                let _ = writeln!(out, "✓ {label}");
            }
            Err(mut err) => {
                failed += 1;
                err.trail.retain(|t| t.file.is_some() || t.line <= last);
                let _ = writeln!(out, "✗ {label}");
                let mut lines: Vec<String> = report(&err, &code, file, &sources).split('\n').map(str::to_string).collect();
                let said = terminal.said.take().unwrap_or_default();
                if !said.is_empty() {
                    lines.push("it said:".into());
                    lines.extend(said.iter().map(|l| format!("  {l}")));
                }
                let _ = writeln!(out, "{}", lines.iter().map(|l| format!("    {l}")).collect::<Vec<_>>().join("\n"));
            }
        }
    }
    Ok((passed, failed))
}

fn test_command(files: Vec<String>) -> i32 {
    let mut files = files;
    if files.is_empty() {
        find_tests(".", &mut files);
    }
    if files.is_empty() {
        eprintln!("moth-native: no tests found: name a file, or put tests in files ending in .test.moth");
        return 1;
    }
    let (mut passed, mut failed) = (0, 0);
    for file in &files {
        if files.len() > 1 {
            println!("{file}");
        }
        match read_program(file) {
            Err(message) => {
                eprintln!("{message}");
                failed += 1;
            }
            Ok(source) => match test_file(file, &source) {
                Ok((p, f)) => {
                    passed += p;
                    failed += f;
                }
                Err(err) => {
                    eprintln!("{}", report(&err, &source, file, &Sources::beside(file)));
                    failed += 1;
                }
            },
        }
    }
    println!("{passed} passed{}", if failed > 0 { format!(", {failed} failed") } else { String::new() });
    i32::from(failed > 0)
}

// ---------- conform: what the tests drive ----------

// One program per line of JSON in; one line of JSON out with what it said and drew, its mistake, the files it
// left, and its bytecode, for the tests to hold up against what the JavaScript engines did.
struct Conform {
    said: Vec<String>,
    drawn: Vec<Drawn>,
    answers: Option<VecDeque<String>>,
    disk: Option<BTreeMap<String, FileData>>,
    args: Vec<String>,
    random: Seeded,
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

fn drawn_json(d: &Drawn) -> String {
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

fn conform_one(line: &str) -> String {
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
    let mut bytecode = "null".to_string();
    let mut mothc = "null".to_string();
    let mut app = Vec::new();
    let result = (|| -> Result<(), MothError> {
        let main = compile(&source, &read, None)?;
        if matches!(request.get("bytecode"), Some(json::Json::Bool(true))) {
            bytecode = t(&disassemble(&main));
        }
        if matches!(request.get("mothc"), Some(json::Json::Bool(true))) {
            mothc = t(&bytecode::write(&main));
        }
        let env = vm::new_env(&main, None);
        let mut machine = Machine::new(&mut host, max_steps);
        let ran = machine.run(main, env);
        // an app only when it set up without a mistake, as run() in moth.js gives one
        for l in machine.listeners.iter().filter(|_| ran.is_ok()) {
            let mut fields = vec![("event", t(l.event))];
            if let Some(i) = l.interval {
                fields.push(("interval", n(i)));
            }
            app.push(obj(&fields));
        }
        ran
    })();
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

fn conform_command() -> i32 {
    let stdin = std::io::stdin();
    let mut out = std::io::BufWriter::new(std::io::stdout());
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let _ = writeln!(out, "{}", conform_one(&line));
    }
    let _ = out.flush();
    0
}

// For bench.js: the program on standard input, run 5 times; the best time in milliseconds, then its last line
fn bench_command() -> i32 {
    let mut source = String::new();
    let _ = std::io::stdin().read_to_string(&mut source);
    let mut best = f64::INFINITY;
    let mut last = String::new();
    for _ in 0..5 {
        let mut host = Conform { said: vec![], drawn: vec![], answers: None, disk: None, args: vec![], random: Seeded(1) };
        let start = std::time::Instant::now();
        let result = compile(&source, &|_| None, None)
            .and_then(|main| Machine::new(&mut host, f64::INFINITY).run(main.clone(), vm::new_env(&main, None)));
        best = best.min(start.elapsed().as_secs_f64() * 1000.0);
        last = match result {
            Ok(()) => host.said.last().cloned().unwrap_or_default(),
            Err(e) => format!("error: {}", e.message()),
        };
    }
    println!("{best}\n{last}");
    0
}

fn real_main() -> i32 {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("run") if args.len() >= 2 => run_command(&args[1], args[2..].to_vec()),
        Some("bytecode") if args.len() == 2 => bytecode_command(&args[1]),
        Some("build") if args.len() == 2 => build_command(&args[1]),
        Some("bootstrap") if args.len() == 2 => bootstrap_command(&args[1]),
        Some("test") => test_command(args[1..].to_vec()),
        Some("conform") => conform_command(),
        Some("bench") => bench_command(),
        Some("help" | "--help" | "-h") => {
            println!("{USAGE}");
            0
        }
        _ => {
            eprintln!("{USAGE}");
            2
        }
    }
}

fn main() {
    // the parser and compiler go as deep as the code is nested, and showing a value as deep as it holds
    // values, so they get a big stack of their own (in WebAssembly, the linker sets it: see .cargo/config.toml)
    #[cfg(not(target_family = "wasm"))]
    let code = std::thread::Builder::new().stack_size(1 << 30).spawn(real_main).unwrap().join().unwrap_or(101);
    #[cfg(target_family = "wasm")]
    let code = real_main();
    std::process::exit(code);
}
