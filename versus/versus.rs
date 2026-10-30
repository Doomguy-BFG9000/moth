// The four programs of versus/, the plain Rust way, as versus.c has them in C: whole numbers where they will do.
// The sizes go through black_box, as C's go through a volatile, so the compiler cannot work the answers out
// before it runs. The loops are written 1..n + 1, not 1..=n, which Rust makes slower code of today.
use std::hint::black_box;

fn fib(n: i32) -> i32 {
    if n < 2 { n } else { fib(n - 1) + fib(n - 2) }
}

fn main() {
    let which = std::env::args().nth(1).unwrap_or_default();
    match which.as_str() {
        "fib" => println!("{}", fib(black_box(32))),
        "loop" => {
            let mut total: i64 = 0;
            for i in 1..black_box(100_000_000i32) + 1 {
                total += i as i64;
            }
            println!("{}", total);
        }
        "primes" => {
            let mut count = 0;
            for n in 2..black_box(300_000i32) + 1 {
                let mut prime = true;
                let mut d = 2;
                while d * d <= n {
                    if n % d == 0 {
                        prime = false;
                        break;
                    }
                    d += 1;
                }
                if prime {
                    count += 1;
                }
            }
            println!("{}", count);
        }
        "float" => {
            let mut total = 0.0f64;
            for i in 1..black_box(30_000_000i32) + 1 {
                total += 1.0 / (i as f64 * i as f64);
            }
            println!("{}", total);
        }
        _ => println!("1"),
    }
}
