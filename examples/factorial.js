function fact(n)
{
    if (n <= 2)
        return n;
    else
        return n*fact(n-1);
}

function fact2(n)
{
    var res = n;
    while (--n > 1)
        res *= n;
    return res;
}

function fact3(n)
{
    function inner(res,n)
    {
        if (n < 2)
            return res;
        else
            return inner(res*n, n-1);
    }
    return inner(1,n);
}

var cnt = 0;
++cnt;

console.log("fact", fact(100));
console.log("fact2", fact2(100));
console.log("fact3", fact3(100));

