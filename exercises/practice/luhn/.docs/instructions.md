# Luhn

The Luhn algorithm checks numbers such as credit card numbers for mistakes in typing them. Spaces don't count.
A number of one digit or less is never valid, and anything but digits and spaces makes it not valid.

From the right, double every second digit; a double over 9 has 9 taken from it. Add every digit up: the number
is valid if the total can be divided by 10. So `4539 3195 0343 6467` is valid, and `8273 1232 7352 0569`
isn't.

Write `is_valid`, which takes the number as text.
