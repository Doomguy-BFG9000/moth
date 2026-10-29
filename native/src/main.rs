// moth-native: Moth with no JavaScript anywhere. Its own lexer, parser, compiler and virtual machine, which
// run every program exactly as the JavaScript engines do (the tests check that on thousands of programs).
mod bytecode;
mod compiler;
mod error;
mod exe;
mod host;
mod json;
mod lexer;
mod num;
mod parser;
mod value;
mod vm;

use compiler::{compile, disassemble, parse_program};
use error::MothError;
use host::*;
use parser::Stmt;
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::io::{BufRead, Read, Write};
use std::rc::Rc;
use vm::{FileData, Host, Machine};

const USAGE: &str = "usage:
  moth-native run <file.moth> [arguments...]
                              run a program; if it draws, the drawing goes to <file>.svg; what follows
                              the file is the program's arguments. It asks before the program reads or
                              writes a file or goes online; --allow-read, --allow-write, --allow-net or
                              --allow-all, first, let it without asking, and --allow-read=data,notes.txt,
                              --allow-write=out or --allow-net=example.com only those files, folders or sites
  moth-native test [files...] run the tests: each function named test_..., on its own; with no file,
                              every file ending in .test.moth here and in the folders inside; it asks as
                              run does, and takes the same --allow flags
  moth-native build <file.moth>
                              compile it to <file>.mothc, bytecode moth-native runs without compiling again
  moth-native build --exe <file.moth> [--allow-...]
                              compile it to machine code: <file>.exe (or <file>), a program of its own that
                              runs with nothing else, and asks before files or going online as run does,
                              allowing what the --allow flags say; needs rustc (https://rustup.rs)
  moth-native bytecode <file.moth>
                              show the bytecode the compiler makes, the same as `moth bytecode`
  moth-native bootstrap <compiler.moth>
                              build Moth's compiler written in Moth with itself, three times over, with no
                              JavaScript anywhere";

fn run_source(source: &str, sources: &Sources, file: &str, host: &mut dyn Host, max_steps: f64) -> Result<bool, MothError> {
    let main = compile(source, &|name| sources.get(name), Some(&basename(file)))?;
    let env = vm::new_env(&main, None);
    let mut machine = Machine::new(host, max_steps);
    machine.run(main, env)?;
    Ok(!machine.listeners.is_empty())
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
    let mut args = args;
    let mut permits = Permits::default();
    while args.first().is_some_and(|a| add_allow(&mut permits, a)) {
        args.remove(0);
    }
    let mut terminal = Terminal::new(args, Box::new(move || real.number()));
    terminal.permits = Some(Rc::new(RefCell::new(permits)));
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
    finish(result, &mut terminal, file, &source, &|f| sources.get(f))
}

// `moth-native build --exe`: the program in machine code (see exe.rs), allowed what the flags after it allow
fn build_exe_command(file: &str, flags: &[String]) -> i32 {
    let mut check = Permits::default();
    if let Some(bad) = flags.iter().find(|f| !add_allow(&mut check, f)) {
        eprintln!("moth-native: {bad} isn't an --allow flag\n{USAGE}");
        return 2;
    }
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
            let used: Vec<(String, String)> =
                sources.read.borrow().iter().filter_map(|(n, t)| t.as_ref().map(|t| (n.clone(), t.clone()))).collect();
            exe::build_exe(file, &source, &main, &used, flags)
        }
        Err(err) => {
            eprintln!("{}", report(&err, &source, file, &|f| sources.get(f)));
            1
        }
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
            eprintln!("{}", report(&err, &source, file, &|f| sources.get(f)));
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
            eprintln!("{}", report(&err, &whole, file, &|f| Sources::beside(file).get(f)));
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
            eprintln!("{}", report(&err, &source, file, &|f| sources.get(f)));
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
fn test_file(file: &str, source: &str, permits: &Rc<RefCell<Permits>>) -> Result<(usize, usize), MothError> {
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
        terminal.permits = Some(permits.clone()); // one for every test, so each file or site is asked about once
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
                let mut lines: Vec<String> = report(&err, &code, file, &|f| sources.get(f)).split('\n').map(str::to_string).collect();
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
    let mut permits = Permits::default();
    let mut files: Vec<String> = files.into_iter().filter(|a| !add_allow(&mut permits, a)).collect();
    let permits = Rc::new(RefCell::new(permits));
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
            Ok(source) => match test_file(file, &source, &permits) {
                Ok((p, f)) => {
                    passed += p;
                    failed += f;
                }
                Err(err) => {
                    eprintln!("{}", report(&err, &source, file, &|f| Sources::beside(file).get(f)));
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
// conform's way of running a job: compiled here, run by the virtual machine
fn run_on_machine(job: Job, host: &mut Conform) -> Ran {
    let mut bytecode = "null".to_string();
    let mut mothc = "null".to_string();
    let mut listeners = vec![];
    let result = (|| -> Result<(), MothError> {
        let main = compile(job.source, job.files, None)?;
        if job.bytecode {
            bytecode = json::text(&disassemble(&main));
        }
        if job.mothc {
            mothc = json::text(&bytecode::write(&main));
        }
        let env = vm::new_env(&main, None);
        let mut machine = Machine::new(host, job.max_steps);
        let ran = machine.run(main, env);
        if ran.is_ok() {
            listeners = std::mem::take(&mut machine.listeners);
        }
        ran
    })();
    Ran { result, listeners, bytecode, mothc }
}

fn conform_command() -> i32 {
    let stdin = std::io::stdin();
    let mut out = std::io::BufWriter::new(std::io::stdout());
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let _ = writeln!(out, "{}", conform_one(&line, &mut run_on_machine));
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
        Some("build") if args.len() >= 3 && args[1] == "--exe" => build_exe_command(&args[2], &args[3..]),
        Some("build") if args.len() == 4 && args[1] == "--exe-conform" => exe::build_conform(&args[2], &args[3]),
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
