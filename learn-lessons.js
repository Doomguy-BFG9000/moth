// The lessons on learn.html, the page that teaches Moth a step at a time. Each has a title, what it teaches (as
// HTML), a program to run and change, and something to try. moth.test.js runs every program on every engine, so a
// lesson never shows code that doesn't work: `answers` are what a test types when the program asks, `fails` is
// the mistake a lesson means to show, and `draws` says the program draws, which the playground shows.

export const LESSONS = [
  {
    title: "Say something",
    intro: `<p><code>say</code> shows whatever comes after it. Put words in quotes; numbers and sums need none. Put
      pieces side by side and they're joined exactly as written.</p>
      <p>Moth works to 15 digits, like a spreadsheet, so <code>0.1 + 0.2</code> is exactly <code>0.3</code>.</p>`,
    code: `say "Hello, world!"
say "2 + 3 is " 2 + 3
say "a week has " 7 * 24 " hours"
say 0.1 + 0.2`,
    try: `Change the first line to say hello to you, and add a line that works out how many minutes are in a day.`,
  },
  {
    title: "Remember things",
    intro: `<p><code>set</code> gives a value a name, so you can use it again. Set it again to change it, or
      <code>add</code> to it.</p>
      <p>Inside text, a name in braces is replaced by its value: <code>"Hi, {name}!"</code>.</p>`,
    code: `set name to "Ada"
set age to 36
say "Hi, {name}!"
add 1 to age
say name " is now " age
set age to age * 2
say "Twice that is {age}"`,
    try: `Use your own name and age, and say how old you'll be in 10 years.`,
  },
  {
    title: "Make decisions",
    intro: `<p><code>if</code> runs its lines only when something is true. <code>else if</code> tries something
      else, and <code>else</code> catches the rest. A block ends with <code>end</code>.</p>
      <p>Compare with words: <code>is</code>, <code>is not</code>, <code>is greater than</code>,
      <code>is less than</code>, <code>is at least</code>, <code>is at most</code>.</p>`,
    code: `set temperature to 31

if temperature is greater than 30
    say "It's hot. Drink some water."
else if temperature is less than 10
    say "It's cold. Take a coat."
else
    say "It's a nice day."
end`,
    try: `Change the temperature to 5, then to 20, and run it each time.`,
  },
  {
    title: "Repeat",
    intro: `<p><code>repeat 3 times</code> runs its lines three times. <code>for each n from 1 to 5</code> counts,
      with <code>n</code> taking each number in turn. <code>repeat while</code> keeps going as long as something is
      true.</p>`,
    code: `repeat 3 times
    say "hip hip hooray"
end

for each n from 1 to 5
    say n " times 7 is " n * 7
end

set total to 1
repeat while total is less than 100
    set total to total * 2
end
say "The first power of 2 past 100 is " total`,
    try: `Print the 12 times table, from 1 times 12 to 12 times 12.`,
  },
  {
    title: "Lists",
    intro: `<p>A list keeps values in order. <code>add</code> puts one at the end, <code>item 1 of</code> takes the
      first (Moth counts from 1), and <code>for each ... in</code> goes through them all.</p>
      <p>The last line asks for an item that isn't there. Run it and read what Moth says: its mistakes are in
      plain words, and point at the line.</p>`,
    code: `set fruits to list of "apple", "pear"
add "mango" to fruits

say "I have " length of fruits " fruits"
say "The first is " item 1 of fruits

for each fruit in fruits
    say "I like " fruit
end

say join fruits with ", "
say item 5 of fruits`,
    fails: "there is no item 5",
    try: `Fix the last line so it says the last fruit, whatever the list holds. (Hint: <code>length of fruits</code>.)`,
  },
  {
    title: "Your own functions",
    intro: `<p><code>to</code> makes a function: a name for some lines, with inputs after <code>with</code>.
      <code>return</code> gives a value back. Use it in a sum with brackets, or call it on a line of its own.</p>`,
    code: `to area with width and height
    return width * height
end
say "A 3 by 4 room is " area(3, 4) " square metres"

to greet with person
    say "Hello, " person "!"
end
greet "Sam"
greet "Ana"`,
    try: `Write a function <code>double with n</code> that returns <code>n * 2</code>, and say <code>double(21)</code>.`,
  },
  {
    title: "Records and dictionaries",
    intro: `<p>A record keeps named values together: <code>sam's name</code> is the same as
      <code>name of sam</code>. A dictionary looks values up by a key, like a word in a dictionary.</p>`,
    code: `set sam to record with name "Sam", age 20
set age of sam to 21
say sam's name " is " sam's age

set ages to dictionary where "Sam" is 20, "Ana" is 31
set item "Bo" of ages to 7
for each person in ages
    say person " is " item person of ages
end`,
    try: `Add someone else to <code>ages</code>, and say whether <code>"Bo" is in ages</code>.`,
  },
  {
    title: "When things go wrong",
    intro: `<p>A program can stop itself with <code>fail with</code> and a message. <code>try</code> catches a
      mistake so the program can carry on: the lines after <code>if it fails with why</code> run instead, with
      the message in <code>why</code>.</p>`,
    code: `to check_age with age
    if age is less than 0
        fail with "an age can't be below 0"
    end
    return "that age is fine"
end

try
    say check_age(-5)
if it fails with why
    say "That didn't work: " why
end
say "The program carries on."`,
    try: `Change <code>-5</code> to <code>30</code>. Which lines run now?`,
  },
  {
    title: "Ask a question",
    intro: `<p><code>ask</code> shows a question and waits for an answer. The answer is text, so
      <code>number of</code> turns it into a number you can do sums with.</p>`,
    code: `set name to ask "What's your name?"
set age to number of ask "How old are you, {name}?"
say name ", in ten years you'll be " age + 10`,
    answers: ["Ada", "36"],
    try: `Ask for two numbers and say what they add up to.`,
  },
  {
    title: "Counting words",
    intro: `<p>Put it together: <code>split</code> breaks text into words, and a dictionary counts each one.</p>`,
    code: `set text to "the cat sat on the mat with the hat"
set counts to empty dictionary

for each word in split text by " "
    if word is in counts
        set item word of counts to item word of counts + 1
    else
        set item word of counts to 1
    end
end

for each word in counts
    say word ": " item word of counts
end`,
    try: `Change the text to a sentence of your own. Can you say only the words that come more than once?`,
  },
  {
    title: "Draw",
    intro: `<p>Moth has a turtle that draws as it moves. It starts in the middle, facing up, with its pen down.
      <code>move forward</code>, <code>turn right</code> and <code>pen color</code> are all it needs.</p>
      <p>The playground shows drawings, so this one opens there.</p>`,
    code: `pen color "tomato"
pen width 2
repeat 36 times
    move forward 200
    turn right 170
end`,
    draws: true,
    try: `Change <code>170</code> to <code>144</code>, and <code>36</code> to <code>5</code>. What shape is it?`,
  },
];
