# Sieve

Eratosthenes' sieve finds every prime up to a limit: write out the numbers from 2, then take the first, 2, and
cross out its multiples; then the next not crossed out, 3, and cross out its multiples; and so on. What's left
is the primes.

Write `primes_up_to`, which gives back a list of them, the limit included if it's prime. Try it without
dividing at all: the sieve only adds.
