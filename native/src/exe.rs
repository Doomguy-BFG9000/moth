// `moth-native build --exe`: a Moth program as a program of its own, in machine code. Each Moth function's
// bytecode becomes a Rust function: the stack becomes local variables, a jump a branch, and a variable no
// inner function can see a local of its own; every check and message is vm.rs's own (its shared part, where
// the machine gets them too), so the program does exactly what `moth-native run` does, only faster. Then
// rustc, which turns Rust into machine code, builds it together with this engine's own source, which
// moth-native carries inside it.
use crate::compiler::{op::*, Const, Function, BUILTINS, OPCODES, TURTLE_ACTIONS};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fmt::Write as _;
use std::rc::Rc;

// The engine's own source, which every compiled program is built with (all of it but the command line)
const RUNTIME: [(&str, &str); 10] = [
    ("bytecode.rs", include_str!("bytecode.rs")),
    ("compiler.rs", include_str!("compiler.rs")),
    ("error.rs", include_str!("error.rs")),
    ("host.rs", include_str!("host.rs")),
    ("json.rs", include_str!("json.rs")),
    ("lexer.rs", include_str!("lexer.rs")),
    ("num.rs", include_str!("num.rs")),
    ("parser.rs", include_str!("parser.rs")),
    ("value.rs", include_str!("value.rs")),
    ("vm.rs", include_str!("vm.rs")),
];

// ---------- reading a function's bytecode ----------

// an instruction: where it is, its opcode, its operands, and where the next one starts
struct Ins {
    pc: usize,
    op: i32,
    a: i32,
    b: i32,
    c: i32,
    next: usize,
}

fn instructions(f: &Function) -> Vec<Ins> {
    let mut out = vec![];
    let mut pc = 0;
    while pc < f.code.len() {
        let op = f.code[pc];
        let n = OPCODES[op as usize].1;
        let arg = |k: usize| if k < n { f.code[pc + 1 + k] } else { 0 };
        out.push(Ins { pc, op, a: arg(0), b: arg(1), c: arg(2), next: pc + 1 + n });
        pc += 1 + n;
    }
    out
}

// Where an instruction can go on to, and how deep the stack is there, from how deep it is before it
fn flow(f: &Function, i: &Ins, d: usize) -> Vec<(usize, usize)> {
    let (next, a) = (i.next, i.a as usize);
    let at = |n: isize| (d as isize + n) as usize;
    match i.op {
        GET | CONST | GET_FN | MAKE_FN | CAUGHT | ARGUMENTS => vec![(next, at(1))],
        SET | POP | ADD_TO | HANDLE | COMPARE | ADD | SUB | MUL | DIV | ITEM | RANDOM => vec![(next, at(-1))],
        JUMP => vec![(a, d)],
        JUMP_IF_FALSE => vec![(next, at(-1)), (a, at(-1))],
        CALL => vec![(next, at(-(i.a as isize)))],
        RETURN | HALT | UNDEFINED | FAIL => vec![],
        AND | OR => vec![(next, at(-1)), (a, d)],
        LIST | DICT => vec![(next, at(1 - i.a as isize))],
        SET_ITEM => vec![(next, at(-3))],
        SAY => vec![(next, at(-(i.a as isize)))],
        REPEAT_NEXT => vec![(next, d), (a, at(-1))],
        RANGE_NEXT => vec![(next, at(1)), (a, at(-2))],
        ITER_NEXT => vec![(next, at(1)), (a, at(-1))],
        TURTLE => vec![(next, if bare(i.a) { d } else { at(-1) })],
        RECORD => vec![(next, at(1 - fields(f, i.a).len() as isize))],
        SET_FIELD | REMOVE | WRITE | EVERY => vec![(next, at(-2))],
        BUILTIN => vec![(next, at(1 - BUILTINS[a].1 as isize))],
        TRY => vec![(next, d), (a, d)], // and its `if it fails`, with the stack as it was
        EXPECT => vec![(next, if i.a < 0 { at(-1) } else { at(-2) })],
        _ => vec![(next, d)], // NEG NOT LENGTH ITEM_REF CHECK_REPEAT CHECK_RANGE ITER FIELD RECORD_REF ASK READ LINE END_TRY
    }
}

fn bare(action: i32) -> bool {
    matches!(TURTLE_ACTIONS[action as usize], "up" | "down" | "clear")
}

fn fields(f: &Function, k: i32) -> Rc<Vec<Rc<str>>> {
    let Const::Fields(fields) = &f.consts[k as usize] else { unreachable!() };
    fields.clone()
}

// Where each block of straight-line code starts (the first instruction, wherever something jumps, and after
// anything that doesn't simply go on), and how deep the stack gets
struct Shape {
    blocks: BTreeSet<usize>,
    deepest: usize,
}

fn shape(f: &Function, code: &[Ins]) -> Shape {
    let by_pc: BTreeMap<usize, usize> = code.iter().enumerate().map(|(k, i)| (i.pc, k)).collect();
    let mut depth = BTreeMap::new(); // how deep the stack is before each instruction that can run
    let mut blocks = BTreeSet::from([0]);
    let mut work = vec![(0usize, 0usize)];
    let mut deepest = 0;
    while let Some((pc, d)) = work.pop() {
        if depth.contains_key(&pc) {
            continue;
        }
        depth.insert(pc, d);
        let i = &code[by_pc[&pc]];
        let goes = flow(f, i, d);
        for &(to, dt) in &goes {
            deepest = deepest.max(dt).max(d + 1);
            if to != i.next || goes.len() != 1 {
                blocks.insert(to);
            }
            work.push((to, dt));
        }
        if goes.is_empty() || goes.iter().any(|&(to, _)| to != i.next) {
            blocks.insert(i.next);
        }
    }
    Shape { blocks, deepest }
}

// ---------- which variables an inner function can see ----------

// For each function, by its number: the slots of its own that a function made inside it uses, which must
// live in an environment of their own; the rest can be plain local variables
fn captured(funcs: &[Rc<Function>]) -> Vec<HashSet<usize>> {
    let index: BTreeMap<*const Function, usize> = funcs.iter().enumerate().map(|(k, f)| (Rc::as_ptr(f), k)).collect();
    let mut out = vec![HashSet::new(); funcs.len()];
    fn walk(f: &Rc<Function>, chain: &mut Vec<usize>, index: &BTreeMap<*const Function, usize>, out: &mut Vec<HashSet<usize>>) {
        let me = index[&Rc::as_ptr(f)];
        chain.push(me);
        for i in instructions(f) {
            if matches!(i.op, GET | SET | GET_FN | ADD_TO) && i.a > 0 {
                let owner = chain[chain.len() - 1 - i.a as usize];
                out[owner].insert(i.b as usize);
            }
        }
        for c in &f.consts {
            if let Const::Func(g) = c {
                walk(g, chain, index, out);
            }
        }
        chain.pop();
    }
    walk(&funcs[0], &mut vec![], &index, &mut out);
    out
}

// every function, in the order Rt::new numbers them (vm.rs)
fn all_functions(main: &Rc<Function>) -> Vec<Rc<Function>> {
    fn walk(f: &Rc<Function>, out: &mut Vec<Rc<Function>>) {
        out.push(f.clone());
        for c in &f.consts {
            if let Const::Func(g) = c {
                walk(g, out);
            }
        }
    }
    let mut out = vec![];
    walk(main, &mut out);
    out
}

// ---------- what is known to be a number ----------

// What a value on the stack is known to be, before an instruction: a number, yes or no, or anything. A
// number lives in an f64 of its own and yes or no in a bool, so working them out needs no checks at all.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Ty {
    N,
    B,
    U,
    I, // what `for each x in` goes through: its own copy of the items, and where it's got to, in i<place>
}

fn meet(a: &[Ty], b: &[Ty]) -> Vec<Ty> {
    a.iter().zip(b).map(|(x, y)| if x == y { *x } else { Ty::U }).collect()
}

// the builtins that give a number whenever they give anything: number of, position of, the bits and shifts
fn gives_number(index: i32) -> bool {
    matches!(index, 4 | 5 | 7..=11)
}

// Where an instruction can go on to, and what the stack holds there, from what it holds before it (as flow()
// does for its depth). `numeric` is the function's variables that only ever hold numbers.
fn step(f: &Function, i: &Ins, t: &[Ty], numeric: &HashSet<usize>) -> Vec<(usize, Vec<Ty>)> {
    let d = t.len();
    let keep = |n: usize, push: &[Ty]| -> Vec<Ty> { t[..d - n].iter().chain(push).copied().collect() };
    let num_slot = |depth: i32, slot: i32| depth == 0 && numeric.contains(&(slot as usize));
    let (next, a) = (i.next, i.a as usize);
    use Ty::*;
    match i.op {
        GET => vec![(next, keep(0, &[if num_slot(i.a, i.b) { N } else { U }]))],
        CONST => {
            let ty = match &f.consts[a] {
                Const::Val(crate::value::Value::Num(_)) => N,
                Const::Val(crate::value::Value::Bool(_)) => B,
                _ => U,
            };
            vec![(next, keep(0, &[ty]))]
        }
        GET_FN | MAKE_FN | CAUGHT | ARGUMENTS => vec![(next, keep(0, &[U]))],
        SET | POP | ADD_TO | HANDLE => vec![(next, keep(1, &[]))],
        COMPARE => vec![(next, keep(2, &[B]))],
        ADD | SUB | MUL | DIV => vec![(next, keep(2, &[if t[d - 1] == N && t[d - 2] == N { N } else { U }]))],
        ITEM => vec![(next, keep(2, &[U]))],
        RANDOM => vec![(next, keep(2, &[N]))],
        JUMP => vec![(a, t.to_vec())],
        JUMP_IF_FALSE => vec![(next, keep(1, &[])), (a, keep(1, &[]))],
        CALL => vec![(next, keep(i.a as usize + 1, &[U]))],
        RETURN | HALT | UNDEFINED | FAIL => vec![],
        AND | OR => vec![(next, keep(1, &[])), (a, t.to_vec())],
        NEG => vec![(next, keep(1, &[if t[d - 1] == N { N } else { U }]))],
        NOT => vec![(next, keep(1, &[B]))],
        LENGTH => vec![(next, keep(1, &[N]))],
        LIST | DICT => vec![(next, keep(a, &[U]))],
        ITEM_REF => vec![(next, keep(2, &[U, U]))],
        SET_ITEM => vec![(next, keep(3, &[]))],
        SAY => vec![(next, keep(a, &[]))],
        CHECK_REPEAT => vec![(next, keep(1, &[N]))],
        REPEAT_NEXT => vec![(next, t.to_vec()), (a, keep(1, &[]))],
        CHECK_RANGE => vec![(next, keep(2, &[N, N]))],
        RANGE_NEXT => vec![(next, keep(0, &[N])), (a, keep(2, &[]))],
        ITER => vec![(next, keep(1, &[I]))],
        ITER_NEXT => vec![(next, keep(0, &[U])), (a, keep(1, &[]))],
        TURTLE => vec![(next, keep(if bare(i.a) { 0 } else { 1 }, &[]))],
        RECORD => vec![(next, keep(fields(f, i.a).len(), &[U]))],
        SET_FIELD | REMOVE | WRITE | EVERY => vec![(next, keep(2, &[]))],
        BUILTIN => vec![(next, keep(BUILTINS[a].1, &[if gives_number(i.a) { N } else { U }]))],
        TRY => vec![(next, t.to_vec()), (a, t.to_vec())],
        EXPECT => vec![(next, keep(if i.a < 0 { 1 } else { 2 }, &[]))],
        FIELD | ASK | READ => vec![(next, keep(1, &[U]))],
        RECORD_REF | LINE | END_TRY => vec![(next, t.to_vec())],
        other => unreachable!("opcode {other}"),
    }
}

// What the stack holds before each instruction that can run, worked out to a fixed point
fn stack_types(f: &Function, code: &[Ins], numeric: &HashSet<usize>) -> BTreeMap<usize, Vec<Ty>> {
    let by_pc: BTreeMap<usize, usize> = code.iter().enumerate().map(|(k, i)| (i.pc, k)).collect();
    let mut types: BTreeMap<usize, Vec<Ty>> = BTreeMap::new();
    let mut work = vec![(0usize, vec![])];
    while let Some((pc, t)) = work.pop() {
        let merged = match types.get(&pc) {
            Some(old) => {
                let m = meet(old, &t);
                if &m == old {
                    continue;
                }
                m
            }
            None => t,
        };
        types.insert(pc, merged.clone());
        for (to, tt) in step(f, &code[by_pc[&pc]], &merged, numeric) {
            work.push((to, tt));
        }
    }
    types
}

// The variables of a function that only ever hold numbers, so they can be f64s: ones no inner function sees,
// that every `set` gives a number (an `add` to a number gives a number, or fails), and that aren't inputs,
// unless an input says it is a number (`with n as a number`), which every call checks
fn numeric_slots(f: &Function, code: &[Ins], captured: &HashSet<usize>) -> HashSet<usize> {
    let mut numeric: HashSet<usize> =
        (1..=f.nslots).filter(|s| !captured.contains(s)).filter(|&s| s > f.params.len() || f.kinds.get(s - 1) == Some(&0)).collect();
    loop {
        let types = stack_types(f, code, &numeric);
        let wrong: Vec<usize> = code
            .iter()
            .filter(|i| i.op == SET && i.a == 0 && numeric.contains(&(i.b as usize)))
            .filter(|i| types.get(&i.pc).is_some_and(|t| t.last() != Some(&Ty::N)))
            .map(|i| i.b as usize)
            .collect();
        if wrong.is_empty() {
            return numeric;
        }
        for s in wrong {
            numeric.remove(&s);
        }
    }
}

// ---------- writing a function as Rust ----------

struct Writer<'a> {
    funcs: &'a [Rc<Function>],
    index: BTreeMap<*const Function, usize>,
    captured: Vec<HashSet<usize>>,
}

// A value at a place on the stack, as Rust, by what it's known to be: owned (taken off the stack), or borrowed
fn val(j: usize, t: Ty) -> String {
    match t {
        Ty::N => format!("Value::Num(n{j})"),
        Ty::B => format!("Value::Bool(b{j})"),
        Ty::U => format!("take(&mut s{j})"),
        Ty::I => iter_value(j),
    }
}
fn vref(j: usize, t: Ty) -> String {
    match t {
        Ty::N => format!("&Value::Num(n{j})"),
        Ty::B => format!("&Value::Bool(b{j})"),
        Ty::U => format!("&s{j}"),
        Ty::I => format!("&{}", iter_value(j)),
    }
}
fn cond(j: usize, t: Ty) -> String {
    match t {
        Ty::B => format!("b{j}"),
        Ty::N => "true".into(), // a number is yes
        Ty::U => format!("truthy(&s{j})"),
        Ty::I => "true".into(),
    }
}

// an iterator kept as a copy and a place, as the machine's own kind, for anywhere that wants one as a value
fn iter_value(j: usize) -> String {
    format!("Value::Iter(Rc::new(std::cell::RefCell::new(Iter {{ items: std::mem::take(&mut i{j}.0), i: i{j}.1 }})))")
}

// what has to change for the stack as it is (`from`) to be as the instruction it goes to expects (`to`): a
// number or yes or no it expects as a value is made one
fn convert(from: &[Ty], to: &[Ty]) -> String {
    let mut out = String::new();
    for (j, (a, b)) in from.iter().zip(to).enumerate() {
        match (a, b) {
            (Ty::N, Ty::U) => out += &format!("s{j} = Value::Num(n{j}); "),
            (Ty::B, Ty::U) => out += &format!("s{j} = Value::Bool(b{j}); "),
            (Ty::I, Ty::U) => out += &format!("s{j} = {}; ", iter_value(j)),
            _ => {}
        }
    }
    out
}

impl Writer<'_> {
    fn function(&self, k: usize, out: &mut String) {
        let f = &self.funcs[k];
        let code = instructions(f);
        let shape = shape(f, &code);
        let main = k == 0;
        let flat = !main && f.is_flat(); // no function made in it can see its variables, so it has no environment
        let caught = &self.captured[k];
        let numeric = numeric_slots(f, &code, caught);
        let types = stack_types(f, &code, &numeric);
        let tries = code.iter().any(|i| i.op == TRY);
        // where variable `slot` at `depth` is, as a place that holds a Value (not for a numeric one)
        let place = |d: i32, slot: i32| -> String {
            if d == 0 && !caught.contains(&(slot as usize)) {
                format!("v{slot}")
            } else if d == 0 {
                format!("env.slots.borrow_mut()[{slot}]")
            } else if flat {
                format!("env_at(outer, {}).slots.borrow_mut()[{slot}]", d - 1)
            } else {
                format!("env_at(&env, {d}).slots.borrow_mut()[{slot}]")
            }
        };
        let read = |d: i32, slot: i32| -> String {
            let p = place(d, slot);
            if p.starts_with('v') {
                format!("{p}.clone()")
            } else {
                format!("{}.clone()", p.replace("borrow_mut()", "borrow()"))
            }
        };
        let is_num = |d: i32, slot: i32| d == 0 && numeric.contains(&(slot as usize));

        let _ = writeln!(out, "// {}", if main { "the program".to_string() } else { format!("to {}", f.name) });
        let _ = writeln!(out, "pub fn f{k}(rt: &mut Rt, func: &Rc<Function>, outer: &Rc<Env>, args: &mut [Value]) -> Out {{");
        if main {
            out.push_str("    let env = outer.clone();\n");
        } else if !flat {
            out.push_str("    let env = new_env(&func, Some(outer.clone()));\n");
        }
        // its variables: inputs first, from slot 1
        for slot in 1..=f.nslots {
            let input = slot <= f.params.len();
            if numeric.contains(&slot) {
                if input {
                    let _ = writeln!(out, "    let Value::Num(mut v{slot}) = take(&mut args[{}]) else {{ unreachable!() }};", slot - 1);
                    let _ = writeln!(out, "    let mut v{slot}_set = true;");
                } else {
                    let _ = writeln!(out, "    let mut v{slot} = 0.0f64;\n    let mut v{slot}_set = false;");
                }
                continue;
            }
            let value = if input { format!("take(&mut args[{}])", slot - 1) } else { "Value::Unset".into() };
            if place(0, slot as i32).starts_with('v') {
                let _ = writeln!(out, "    let mut v{slot}: Value = {value};");
            } else if input {
                let _ = writeln!(out, "    env.slots.borrow_mut()[{slot}] = {value};");
            }
        }
        // what the stack holds before each instruction, and after it, on the way to each place it goes on to
        let mut seen: Vec<Vec<Ty>> = types.values().cloned().collect();
        for i in &code {
            if let Some(t) = types.get(&i.pc) {
                seen.extend(step(f, i, t, &numeric).into_iter().map(|(_, t)| t));
            }
        }
        let used = |want: Ty| -> BTreeSet<usize> {
            seen.iter().flat_map(|t| t.iter().enumerate().filter(move |(_, &x)| x == want).map(|(j, _)| j)).collect()
        };
        let (values, numbers, bools) = (used(Ty::U), used(Ty::N), used(Ty::B));
        for n in used(Ty::I) {
            let _ = writeln!(out, "    let mut i{n}: (Vec<Value>, usize) = (Vec::new(), 0);");
        }
        for n in 0..shape.deepest.max(1) {
            // a place every instruction writing it would also read is one some type uses; any other is never read
            if values.contains(&n) || !numbers.contains(&n) && !bools.contains(&n) {
                let _ = writeln!(out, "    let mut s{n} = Value::Nothing;");
            }
            if numbers.contains(&n) || !values.contains(&n) && !bools.contains(&n) {
                let _ = writeln!(out, "    let mut n{n} = 0.0f64;");
            }
            if bools.contains(&n) || !values.contains(&n) && !numbers.contains(&n) {
                let _ = writeln!(out, "    let mut b{n} = false;");
            }
        }
        out.push_str("    let mut caught = Value::Nothing;\n    let mut handlers: Vec<u32> = Vec::new();\n    let mut state: u32 = 0;\n");
        out.push_str("    'm: loop {\n");
        // a mistake: to the innermost `try`'s `if it fails`, if there's one in this call, or back to the caller.
        // These are inside the loop, so they can go on with it.
        if tries {
            out.push_str(
                "        macro_rules! raise {\n            ($f:expr) => {{\n                let f: Box<Fail> = $f;\n                if f.catchable() {\n                    if let Some(h) = handlers.pop() {\n                        caught = (*f).caught();\n                        state = h;\n                        continue 'm;\n                    }\n                }\n                return Err(f);\n            }};\n        }\n",
            );
        } else {
            out.push_str(
                "        macro_rules! raise {\n            ($f:expr) => {\n                return Err($f)\n            };\n        }\n",
            );
        }
        out.push_str(
            "        macro_rules! check {\n            ($pc:expr, $e:expr) => {\n                match $e {\n                    Ok(v) => v,\n                    Err(f) => raise!(Fail::at(f, &func, $pc)),\n                }\n            };\n        }\n",
        );
        out.push_str("        match state {\n");
        let mut open = false;
        let mut falls: Option<Vec<Ty>> = None; // what the instruction before leaves, if it goes on to the next
        for i in &code {
            let Some(t) = types.get(&i.pc) else {
                continue; // never runs
            };
            let d = t.len();
            if shape.blocks.contains(&i.pc) {
                if open {
                    if let Some(from) = &falls {
                        let _ = writeln!(out, "                {}state = {};\n                continue 'm;", convert(from, t), i.pc);
                    }
                    out.push_str("            }\n");
                }
                let _ = writeln!(out, "            {} => {{", i.pc);
                open = true;
            }
            let pc = i.pc;
            let goes = step(f, i, t, &numeric);
            // going to instruction `to` instead of on: the stack as it expects, then there
            let jump = |to: usize| -> String {
                let after = &goes.iter().find(|(p, _)| *p == to).unwrap().1;
                let entry = types.get(&to).cloned().unwrap_or_else(|| after.clone());
                format!("{}state = {to};\n                    continue 'm;", convert(after, &entry))
            };
            let ty = |j: usize| t[j];
            let (top, under) = (d.wrapping_sub(1), d.wrapping_sub(2));
            let vals = |n: usize| (d - n..d).map(|j| val(j, ty(j))).collect::<Vec<_>>().join(", ");
            let both_n = d >= 2 && ty(top) == Ty::N && ty(under) == Ty::N;
            let line = match i.op {
                GET if is_num(i.a, i.b) => format!(
                    "if !v{s}_set {{\n                    check!({pc}, got(Value::Unset, &func, {}));\n                }}\n                n{d} = v{s};",
                    i.c,
                    s = i.b
                ),
                GET => format!("s{d} = check!({pc}, got({}, &func, {}));", read(i.a, i.b), i.c),
                GET_FN if is_num(i.a, i.b) => format!(
                    "s{d} = check!({pc}, got_fn(if v{s}_set {{ Value::Num(v{s}) }} else {{ Value::Unset }}, &func, {}));",
                    i.c,
                    s = i.b
                ),
                GET_FN => format!("s{d} = check!({pc}, got_fn({}, &func, {}));", read(i.a, i.b), i.c),
                SET if is_num(i.a, i.b) => format!("v{s} = n{top};\n                v{s}_set = true;", s = i.b),
                SET => format!("{} = {};", place(i.a, i.b), val(top, ty(top))),
                CONST => match &f.consts[i.a as usize] {
                    Const::Val(crate::value::Value::Num(x)) => format!("n{d} = f64::from_bits({:#x});", x.to_bits()),
                    Const::Val(crate::value::Value::Bool(b)) => format!("b{d} = {b};"),
                    _ => format!("s{d} = {};", constant(f, i.a, k)),
                },
                ADD_TO if is_num(i.a, i.b) => {
                    let s = i.b;
                    let add = if ty(top) == Ty::N {
                        format!("v{s} += n{top};")
                    } else {
                        // anything but a number added to one is a mistake, which add_to_value words
                        format!("let mut current = Value::Num(v{s});\n                check!({pc}, add_to_value(&mut current, {}, &func, {}));\n                let Value::Num(x) = current else {{ unreachable!() }};\n                v{s} = x;", val(top, ty(top)), i.c)
                    };
                    format!("if !v{s}_set {{\n                    check!({pc}, got(Value::Unset, &func, {}));\n                }}\n                {add}", i.c)
                }
                ADD_TO => format!("check!({pc}, add_to_value(&mut {}, {}, &func, {}));", place(i.a, i.b), val(top, ty(top)), i.c),
                JUMP => jump(i.a as usize),
                JUMP_IF_FALSE | AND => format!("if !{} {{\n                    {}\n                }}", cond(top, ty(top)), jump(i.a as usize)),
                OR => format!("if {} {{\n                    {}\n                }}", cond(top, ty(top)), jump(i.a as usize)),
                COMPARE => format!("b{under} = check!({pc}, compare_values({}, {}, {}));", i.a, vref(under, ty(under)), vref(top, ty(top))),
                ADD | SUB | MUL if both_n => {
                    let sign = match i.op {
                        ADD => "+",
                        SUB => "-",
                        _ => "*",
                    };
                    format!("n{under} = n{under} {sign} n{top};")
                }
                DIV if both_n => format!(
                    "if n{top} == 0.0 {{\n                    check!({pc}, math_values(DIV, &Value::Num(n{under}), &Value::Num(0.0)));\n                }}\n                n{under} = n{under} / n{top};"
                ),
                ADD | SUB | MUL | DIV => {
                    format!("s{under} = check!({pc}, math_values({}, {}, {}));", i.op, vref(under, ty(under)), vref(top, ty(top)))
                }
                CALL => {
                    let argc = i.a as usize;
                    let callee = d - argc - 1;
                    format!(
                        "{{\n                    let mut a = [{}];\n                    match call(rt, &s{callee}, &mut a, &func, {}, {pc}) {{\n                        Ok(v) => s{callee} = v,\n                        Err(f) => raise!(f),\n                    }}\n                }}",
                        vals(argc),
                        i.b
                    )
                }
                RETURN => format!("return Ok({});", val(top, ty(top))),
                HALT => "return Ok(Value::Nothing);".into(),
                POP => {
                    if ty(top) == Ty::U {
                        format!("s{top} = Value::Nothing;")
                    } else {
                        String::new()
                    }
                }
                NEG if ty(top) == Ty::N => format!("n{top} = -n{top};"),
                NEG => format!("s{top} = check!({pc}, negate_value({}));", val(top, ty(top))),
                NOT => format!("b{top} = !{};", cond(top, ty(top))),
                LIST => {
                    let n = i.a as usize;
                    format!("s{} = list(vec![{}]);", d - n, vals(n))
                }
                LENGTH => format!("n{top} = check!({pc}, length_of({}));", vref(top, ty(top))),
                ITEM => format!("s{under} = check!({pc}, item_value({}, {}));", vref(under, ty(under)), vref(top, ty(top))),
                ITEM_REF => format!(
                    "{{\n                    let (seq, i) = check!({pc}, item({}, {}, true));\n                    s{under} = seq;\n                    s{top} = i;\n                }}",
                    vref(under, ty(under)),
                    vref(top, ty(top))
                ),
                SET_ITEM => format!(
                    "check!({pc}, put_item({}, {}, {}));",
                    vref(d - 3, ty(d - 3)),
                    vref(under, ty(under)),
                    val(top, ty(top))
                ),
                SAY => format!("{{\n                    let line = check!({pc}, said(&[{}]));\n                    rt.host.print(&line);\n                }}", vals(i.a as usize)),
                CHECK_REPEAT => format!("n{top} = number(check!({pc}, repeat_count({})));", vref(top, ty(top))),
                REPEAT_NEXT => format!("if n{top} > 0.0 {{\n                    n{top} -= 1.0;\n                }} else {{\n                    {}\n                }}", jump(i.a as usize)),
                CHECK_RANGE => {
                    let mut l = format!("check!({pc}, check_range({}, {}));", vref(under, ty(under)), vref(top, ty(top)));
                    for j in [under, top] {
                        if ty(j) != Ty::N {
                            l += &format!("\n                n{j} = number(take(&mut s{j}));");
                        }
                    }
                    l
                }
                RANGE_NEXT => format!(
                    "if num::at_most(n{under}, n{top}) {{\n                    n{d} = n{under};\n                    n{under} += 1.0;\n                }} else {{\n                    {}\n                }}",
                    jump(i.a as usize)
                ),
                // a copy of the items, as the machine makes, gone through by place; each item is moved out of it
                ITER => format!("i{top} = (check!({pc}, items_of({})), 0);", vref(top, ty(top))),
                ITER_NEXT if ty(top) == Ty::I => format!(
                    "if i{top}.1 < i{top}.0.len() {{\n                    s{d} = take(&mut i{top}.0[i{top}.1]);\n                    i{top}.1 += 1;\n                }} else {{\n                    {}\n                }}",
                    jump(i.a as usize)
                ),
                ITER_NEXT => format!(
                    "match iter_next(&s{top}) {{\n                    Some(v) => s{d} = v,\n                    None => {{\n                        {}\n                    }}\n                }}",
                    jump(i.a as usize)
                ),
                MAKE_FN => {
                    let Const::Func(g) = &f.consts[i.a as usize] else { unreachable!() };
                    format!("s{d} = make_fn(&func, {}, &env, f{});", i.a, self.index[&Rc::as_ptr(g)])
                }
                UNDEFINED => format!("raise!(Fail::at(Failure {{ message: func.text({}).to_string(), value: None, last: false }}, &func, {pc}));", i.a),
                LINE => String::new(),
                TURTLE => {
                    if bare(i.a) {
                        format!("check!({pc}, rt.turtle.act({}, None, rt.host));", i.a)
                    } else {
                        format!("check!({pc}, rt.turtle.act({}, Some({}), rt.host));", i.a, val(top, ty(top)))
                    }
                }
                RECORD => {
                    let n = fields(f, i.a).len();
                    format!(
                        "{{\n                    let Const::Fields(fields) = &func.consts[{}] else {{ unreachable!() }};\n                    s{} = make_record(fields, [{}].into_iter());\n                }}",
                        i.a,
                        d - n,
                        vals(n)
                    )
                }
                FIELD => format!("s{top} = check!({pc}, field_value({}, func.text({})));", vref(top, ty(top)), i.a),
                RECORD_REF => format!("check!({pc}, record_ref({}, &func.text({})));", vref(top, ty(top)), i.a),
                SET_FIELD => format!("set_field({}, func.text({}), {});", val(under, ty(under)), i.a, val(top, ty(top))),
                FAIL => format!("raise!(Fail::at(fail_with({}), &func, {pc}));", val(top, ty(top))),
                BUILTIN => {
                    let n = BUILTINS[i.a as usize].1;
                    let call = format!("check!({pc}, builtin_value({}, &[{}]))", i.a, vals(n));
                    if gives_number(i.a) {
                        format!("n{} = number({call});", d - n)
                    } else {
                        format!("s{} = {call};", d - n)
                    }
                }
                ASK => format!("s{top} = check!({pc}, ask_answer(rt.host, {}));", vref(top, ty(top))),
                TRY => format!("handlers.push({});", i.a),
                END_TRY => "handlers.pop();".into(),
                CAUGHT => format!("s{d} = caught.clone();"),
                DICT => {
                    let n = i.a as usize;
                    format!("s{} = check!({pc}, make_dict(&[{}]));", d - n, vals(n))
                }
                REMOVE => format!("check!({pc}, remove_key({}, {}));", vref(under, ty(under)), vref(top, ty(top))),
                READ => format!("s{top} = check!({pc}, read_value(rt.host, {}, {}));", vref(top, ty(top)), i.a == 1),
                WRITE => format!("check!({pc}, write_value(rt.host, {}, {}));", vref(under, ty(under)), vref(top, ty(top))),
                ARGUMENTS => format!("s{d} = list(rt.host.args().iter().map(|a| text(a)).collect());"),
                EXPECT => {
                    if i.a < 0 {
                        format!("check!({pc}, expect_yes({}));", vref(top, ty(top)))
                    } else {
                        format!("check!({pc}, expect_that({}, {}, {}, {}));", i.a, i.b == 1, vref(under, ty(under)), vref(top, ty(top)))
                    }
                }
                RANDOM => format!("n{under} = number(check!({pc}, random_value(rt.host, {}, {})));", vref(under, ty(under)), vref(top, ty(top))),
                HANDLE => format!("handle(rt, {});", i.a),
                EVERY => format!("check!({pc}, every(rt, {}, {}.0));", val(under, ty(under)), i.a),
                other => unreachable!("opcode {other}"),
            };
            if !line.is_empty() {
                for l in line.split('\n') {
                    if l.starts_with("                ") {
                        let _ = writeln!(out, "{l}");
                    } else {
                        let _ = writeln!(out, "                {l}");
                    }
                }
            }
            falls = if i.op == JUMP { None } else { goes.iter().find(|(to, _)| *to == i.next).map(|(_, t)| t.clone()) };
        }
        if open {
            out.push_str("            }\n");
        }
        out.push_str("            _ => unreachable!(),\n        }\n    }\n}\n\n");
    }
}

// a constant as Rust: a number exactly as it is, anything else from the function's constants
fn constant(f: &Function, k: i32, _index: usize) -> String {
    match &f.consts[k as usize] {
        Const::Val(crate::value::Value::Num(n)) => format!("Value::Num(f64::from_bits({:#x}))", n.to_bits()),
        Const::Val(crate::value::Value::Bool(b)) => format!("Value::Bool({b})"),
        Const::Val(crate::value::Value::Nothing) => "Value::Nothing".into(),
        _ => format!("constant(&func, {k})"),
    }
}

// A program's compiled code, as the Rust module vm::compiled: its bytecode (for its constants and places),
// a function for each of its functions, and `run`, which runs it with a host
pub fn generate(main: &Rc<Function>, bytecode_text: &str) -> String {
    let funcs = all_functions(main);
    let index = funcs.iter().enumerate().map(|(k, f)| (Rc::as_ptr(f), k)).collect();
    let writer = Writer { funcs: &funcs, index, captured: captured(&funcs) };
    let mut out = String::new();
    out.push_str("// Made by moth-native build --exe: the program's own code. See exe.rs.\n");
    out.push_str("#![allow(unused_mut, unused_variables, unused_assignments, unreachable_code, unused_labels, unused_macros, unused_imports, clippy::all)]\n");
    out.push_str("use super::*;\nuse crate::compiler::{Const, Function};\nuse crate::num;\nuse crate::value::*;\nuse std::rc::Rc;\n\n");
    let _ = writeln!(out, "pub const BYTECODE: &str = {:?};\n", bytecode_text);
    out.push_str(
        "// runs the program with `host`: whether it set up an app (keys, clicks or timers), or its mistake\npub fn run(host: &mut dyn Host) -> Result<Vec<Listener>, crate::error::MothError> {\n    let main = Rc::new(crate::bytecode::read(BYTECODE).expect(\"its own bytecode\"));\n    let env = new_env(&main, None);\n    let mut rt = Rt::new(host, &main);\n    match f0(&mut rt, &main, &env, &mut []) {\n        Ok(_) => Ok(rt.listeners),\n        Err(f) => Err((*f).into_error()),\n    }\n}\n\n",
    );
    for k in 0..funcs.len() {
        writer.function(k, &mut out);
    }
    out
}

// ---------- building it ----------

// The folder a compiled program is built in: the engine's source, the program's code, and its own main.rs
fn write_crate(dir: &std::path::Path, programs: &[(String, String)], main_rs: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    for (name, text) in RUNTIME {
        let mut text = text.to_string();
        if name == "vm.rs" {
            // the compiled programs are vm's own modules, so they can use what it keeps to itself
            for (module, _) in programs {
                let _ = write!(text, "\n#[path = \"{module}.rs\"]\npub mod {module};\n");
            }
        }
        std::fs::write(dir.join(name), text)?;
    }
    for (module, code) in programs {
        std::fs::write(dir.join(format!("{module}.rs")), code)?;
    }
    std::fs::write(dir.join("main.rs"), main_rs)
}

// rustc, building `dir`'s main.rs into the program `out`; what it said if it couldn't
fn rustc(dir: &std::path::Path, out: &std::path::Path) -> Result<(), String> {
    let ran = std::process::Command::new("rustc")
        // the DFA jump threading pass turns each function's loop over its blocks back into jumps straight from
        // block to block, as the bytecode had them
        .args(["--edition", "2021", "-C", "opt-level=3", "-C", "codegen-units=1", "-C", "llvm-args=-enable-dfa-jump-thread"])
        .args(["--crate-name", "moth_program", "-o"])
        .arg(out)
        .arg("main.rs")
        .current_dir(dir)
        .output()
        .map_err(|e| format!("rustc, which turns the program into machine code, didn't run ({e}): install Rust from https://rustup.rs"))?;
    if !ran.status.success() {
        return Err(format!("rustc couldn't build it:\n{}", String::from_utf8_lossy(&ran.stderr)));
    }
    Ok(())
}

const MAIN_HEAD: &str = "// Made by moth-native build --exe. See exe.rs.
#![allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod bytecode;
mod compiler;
mod error;
mod host;
mod json;
mod lexer;
mod num;
mod parser;
mod value;
mod vm;
use host::*;
use std::cell::RefCell;
use std::rc::Rc;
";

const MAIN_TAIL: &str = "
fn main() {
    // calls go as deep as the machine lets them, and each is a call of the machine's own
    let code = std::thread::Builder::new().stack_size(1 << 31).spawn(real_main).unwrap().join().unwrap_or(101);
    std::process::exit(code);
}
";

// `moth-native build --exe file.moth [--allow-...]`: the program as a program of its own
pub fn build_exe(file: &str, source: &str, main: &Rc<Function>, used: &[(String, String)], flags: &[String]) -> i32 {
    let code = generate(main, &crate::bytecode::write(main));
    let mut main_rs = MAIN_HEAD.to_string();
    let name = crate::host::basename(file);
    let _ = writeln!(main_rs, "const FILE: &str = {:?};\nconst SOURCE: &str = {:?};", name, source);
    let _ =
        writeln!(main_rs, "const USED: &[(&str, &str)] = &{:?};", used.iter().map(|(n, t)| (n.as_str(), t.as_str())).collect::<Vec<_>>());
    let _ = writeln!(main_rs, "const FLAGS: &[&str] = &{:?}; // what it may do without asking, as it was built", flags);
    main_rs.push_str(
        "
fn real_main() -> i32 {
    let mut permits = Permits::default();
    for flag in FLAGS {
        add_allow(&mut permits, flag);
    }
    let mut real = Real::new();
    let mut terminal = Terminal::new(std::env::args().skip(1).collect(), Box::new(move || real.number()));
    terminal.permits = Some(Rc::new(RefCell::new(permits)));
    let result = vm::program::run(&mut terminal).map(|listeners| !listeners.is_empty());
    finish(result, &mut terminal, FILE, SOURCE, &|f| USED.iter().find(|(n, _)| *n == f).map(|(_, t)| t.to_string()))
}
",
    );
    main_rs.push_str(MAIN_TAIL);
    let out = std::path::PathBuf::from(format!("{}{}", crate::host::strip_moth(file), std::env::consts::EXE_SUFFIX));
    let dir = std::env::temp_dir().join(format!("moth-exe-{}", std::process::id()));
    let built = write_crate(&dir, &[("program".into(), code)], &main_rs)
        .map_err(|e| format!("can't write the program's code in {} ({e})", dir.display()))
        .and_then(|()| rustc(&dir, &std::env::current_dir().unwrap_or_default().join(&out)));
    if std::env::var_os("MOTH_KEEP_BUILD").is_none() {
        let _ = std::fs::remove_dir_all(&dir); // MOTH_KEEP_BUILD keeps the code it built, to look at
    }
    match built {
        Ok(()) => {
            println!("compiled {file} -> {}", out.display());
            0
        }
        Err(why) => {
            eprintln!("moth-native: {why}");
            1
        }
    }
}

// For the tests: `moth-native build --exe-conform programs.json out` builds one program holding every program
// in programs.json (a list of {"source", "files"}), compiled, which then answers `conform`'s jobs for those
// programs (by their source) exactly as `moth-native conform` does, but with their compiled code.
pub fn build_conform(list: &str, out: &str) -> i32 {
    let Ok(text) = std::fs::read_to_string(list) else {
        eprintln!("moth-native: can't read {list}");
        return 1;
    };
    let Ok(crate::json::Json::Arr(jobs)) = crate::json::parse(&text) else {
        eprintln!("moth-native: {list} isn't a list of programs");
        return 1;
    };
    let mut programs = vec![];
    let mut table = String::new();
    for job in &jobs {
        let source = job.get("source").and_then(|s| s.str()).unwrap_or("").to_string();
        let files: std::collections::HashMap<String, String> = match job.get("files") {
            Some(crate::json::Json::Obj(m)) => m.iter().filter_map(|(k, v)| v.str().map(|s| (k.clone(), s.to_string()))).collect(),
            _ => Default::default(),
        };
        let Ok(main) = crate::compiler::compile(&source, &|n| files.get(n).cloned(), None) else { continue };
        let module = format!("p{}", programs.len());
        let _ = writeln!(table, "        {:?} => Some(vm::{module}::run),", source);
        programs.push((module, generate(&main, &crate::bytecode::write(&main))));
    }
    let mut main_rs = MAIN_HEAD.to_string();
    main_rs.push_str("use std::io::{BufRead, Write};\n");
    let _ = write!(
        main_rs,
        "
type Run = fn(&mut dyn vm::Host) -> Result<Vec<vm::Listener>, error::MothError>;
fn compiled(source: &str) -> Option<Run> {{
    match source {{
{table}        _ => None,
    }}
}}

// For bench.js, with MOTH_BENCH set: each line a program's source as JSON text, run 5 times; the best time in
// milliseconds, then the last line it said
fn bench() -> i32 {{
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {{
        let Ok(line) = line else {{ break }};
        let Ok(json::Json::Str(source)) = json::parse(&line) else {{ continue }};
        let Some(run) = compiled(&source) else {{
            println!(\"NaN\\nnot compiled\");
            continue;
        }};
        let mut best = f64::INFINITY;
        let mut last = String::new();
        for _ in 0..5 {{
            let mut host = Conform {{ said: vec![], drawn: vec![], answers: None, disk: None, args: vec![], random: Seeded(1) }};
            let start = std::time::Instant::now();
            let result = run(&mut host);
            best = best.min(start.elapsed().as_secs_f64() * 1000.0);
            last = match result {{
                Ok(_) => host.said.last().cloned().unwrap_or_default(),
                Err(e) => format!(\"error: {{}}\", e.message()),
            }};
        }}
        println!(\"{{best}}\\n{{last}}\");
    }}
    0
}}

fn real_main() -> i32 {{
    if std::env::var_os(\"MOTH_BENCH\").is_some() {{
        return bench();
    }}
    let stdin = std::io::stdin();
    let mut out = std::io::BufWriter::new(std::io::stdout());
    for line in stdin.lock().lines() {{
        let Ok(line) = line else {{ break }};
        if line.trim().is_empty() {{
            continue;
        }}
        let answer = conform_one(&line, &mut |job: Job, host: &mut Conform| {{
            let (result, listeners) = match compiled(job.source) {{
                Some(run) => match run(host) {{
                    Ok(l) => (Ok(()), l),
                    Err(e) => (Err(e), vec![]),
                }},
                // a program that couldn't be compiled stops with the compiler's mistake, as on the machine
                None => match compiler::compile(job.source, job.files, None) {{
                    Err(e) => (Err(e), vec![]),
                    Ok(_) => (Err(error::MothError::at(&error::Pos {{ line: 0, col: 0, file: None }}, \"this program wasn't compiled\".into())), vec![]),
                }},
            }};
            Ran {{ result, listeners, bytecode: \"null\".into(), mothc: \"null\".into() }}
        }});
        let _ = writeln!(out, \"{{answer}}\");
    }}
    let _ = out.flush();
    0
}}
"
    );
    main_rs.push_str(MAIN_TAIL);
    let dir = std::env::temp_dir().join(format!("moth-exe-conform-{}", std::process::id()));
    let built = write_crate(&dir, &programs, &main_rs)
        .map_err(|e| e.to_string())
        .and_then(|()| rustc(&dir, &std::env::current_dir().unwrap_or_default().join(format!("{out}{}", std::env::consts::EXE_SUFFIX))));
    if std::env::var_os("MOTH_KEEP_BUILD").is_none() {
        let _ = std::fs::remove_dir_all(&dir); // MOTH_KEEP_BUILD keeps the code it built, to look at
    }
    match built {
        Ok(()) => {
            println!("compiled {} programs -> {out}", programs.len());
            0
        }
        Err(why) => {
            eprintln!("moth-native: {why}");
            1
        }
    }
}
