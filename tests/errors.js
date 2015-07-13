

function errtest1 (p)
{
    switch (p) {
        case 0: throw Error("hello"+p);
        case 1: throw new Error("hello"+p);
        case 2: throw TypeError("hello"+p);
        case 3: throw new TypeError("hello"+p);
        case 4: throw SyntaxError("hello"+p);
        case 5: throw new SyntaxError("hello"+p);
    }
}

for ( var i = 0; i < 10; ++i ) {
    try {
        errtest1(i);
    } catch (e) {
        console.log(i, "caught", e.toString());
        if (i === 5)
            throw 1;
    } finally {
        console.log(i, "finally");
    }
}
