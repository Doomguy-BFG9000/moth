count = 0
for n in range(2, 300001):
    prime = True
    d = 2
    while d * d <= n:
        if n % d == 0:
            prime = False
            break
        d += 1
    if prime:
        count += 1
print(count)
