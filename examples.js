// Shown in the playground's example menu, and run by the tests.
export default {
  "Spiral": `# the turtle starts in the middle, facing up, and draws wherever it moves
set colors to list of "tomato", "gold", "mediumseagreen", "dodgerblue", "orchid"
set size to 1
repeat 30 times
    for each color in colors
        pen color color
        move forward size
        turn right 73
        add 2.6 to size
    end
end`,

  "Tree": `# a function that calls itself draws every branch
to branch with size
    if size is less than 6
        return
    end
    if size is less than 20
        pen color "mediumseagreen"
    else
        pen color "sienna"
    end
    pen width size / 8
    move forward size
    turn left 25
    branch size * 0.72
    turn right 50
    branch size * 0.72
    turn left 25
    pen up
    move back size
    pen down
end

pen up
move back 220
pen down
branch 105`,

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

  "Records": `# a record keeps named values together
set sam to record with name "Sam", age 20
set ana to record with name "Ana", age 31
for each person in list of sam, ana
    say name of person " is " age of person
end
set age of sam to 21
say sam`,

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
