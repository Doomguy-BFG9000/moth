// Shown in the playground's example menu, and run by the tests.
export default {
  "Hello": `say "Hello, world!"
set name to "Moth"
say "My name is " name " and it has " length of name " letters."`,

  "Repeat": `set stars to ""
repeat 5 times
    add "*" to stars
    say stars
end`,

  "FizzBuzz": `for each n from 1 to 15
    if n is divisible by 15
        say "FizzBuzz"
    else if n is divisible by 3
        say "Fizz"
    else if n is divisible by 5
        say "Buzz"
    else
        say n
    end
end`,

  "Lists": `set fruits to list of "apple", "banana", "cherry"
add "mango" to fruits

for each fruit in fruits
    say "I like " fruit
end

say "That's " length of fruits " fruits, and the first is " item 1 of fruits`,

  "Functions": `to fib with n
    if n is less than 2
        return n
    end
    return fib(n - 1) + fib(n - 2)
end

to greet with name
    say "Hello, " name "!"
end

greet "Sam"
say "fib(20) is " fib(20)`,

  "Counter": `# a function can remember the variables around it
to counter
    set count to 0
    to next
        add 1 to count
        return count
    end
    return next
end

set tick to counter()
tick
tick
say "Ticked " tick() " times"`,

  "Primes": `set primes to empty list
for each n from 2 to 50
    set prime to yes
    for each p in primes
        if n is divisible by p
            set prime to no
        end
    end
    if prime
        add n to primes
    end
end
say "Primes up to 50: " primes`,

  "Errors": `# mistakes get a clear message with the line number
set fruits to list of "apple", "banana"
say item 5 of fruits`,
};
