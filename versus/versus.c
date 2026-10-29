// The four programs of versus/, the plain C way: whole numbers where they will do, as a C programmer would
// write them. The sizes come from a volatile, so the compiler cannot work the answers out before it runs.
#include <stdio.h>
#include <string.h>
static volatile int N_FIB = 32, N_SUM = 100000000, N_PRIMES = 300000, N_FLOAT = 30000000;
static int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
int main(int argc, char **argv) {
    const char *which = argc > 1 ? argv[1] : "";
    if (!strcmp(which, "fib")) printf("%d\n", fib(N_FIB));
    else if (!strcmp(which, "loop")) {
        long long total = 0;
        for (int i = 1; i <= N_SUM; i++) total += i;
        printf("%lld\n", total);
    } else if (!strcmp(which, "primes")) {
        int count = 0;
        for (int n = 2; n <= N_PRIMES; n++) {
            int prime = 1;
            for (int d = 2; d * d <= n; d++)
                if (n % d == 0) { prime = 0; break; }
            count += prime;
        }
        printf("%d\n", count);
    } else if (!strcmp(which, "float")) {
        double total = 0;
        for (int i = 1; i <= N_FLOAT; i++) total += 1.0 / ((double)i * i);
        printf("%.15g\n", total);
    } else printf("1\n");
    return 0;
}
