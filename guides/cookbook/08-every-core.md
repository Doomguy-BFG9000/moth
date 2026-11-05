# Work on every core

`start f(x) on another core` runs a call on a worker, a thread with memory of its own, and `wait for` gives
back what it gave. Workers share nothing (each gets copies), so they can't trip over each other. In a
program `moth build` makes, they run at the same moment on every core; in the playground they run one after
another and give the same answers.

```moth
to primes_below with top
    set found to 0
    for each n from 2 to top - 1
        set prime to yes
        set d to 2
        repeat while d * d is at most n and prime
            if remainder of n divided by d is 0
                set prime to no
            end
            add 1 to d
        end
        if prime
            add 1 to found
        end
    end
    return found
end

set jobs to empty list
for each top in list of 1000, 2000, 3000, 4000
    add (start primes_below(top) on another core) to jobs
end
for each job in jobs
    say wait for job
end
```

```output
168
303
430
550
```

`tools/cores.moth` does the same for a whole list at once, across separate copies of the program.
