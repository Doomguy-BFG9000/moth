# Test a program

Tests are functions whose names start with `test_`, in a file whose name ends in `.test.moth`. Each runs on
its own, and `expect` says what should be so; when it isn't, the mistake says what each side was.

```moth
to with_tax with price
    return price * 1.2
end

to test_tax_on_ten
    expect with_tax(10) is 12
end

to test_tax_on_nothing
    expect with_tax(0) is 0
end

to test_tax_on_pennies
    expect with_tax(0.1) is 0.12
end
```

Save it as `prices.test.moth`, and `moth test` runs every test file in the folder and the folders inside:
`✓ test_tax_on_ten`, and so on, then how many passed. `moth coverage` runs them too, and says which lines no
test ran.

A test can check a mistake as well, with `try`:

```moth
to price_of with item_name
    if item_name is "tea"
        return 3.5
    end
    fail with "there's no " + item_name + " on the menu"
end

to test_an_unknown_item
    try
        price_of("soup")
        expect no
    if it fails with why
        expect why is "there's no soup on the menu"
    end
end
```
