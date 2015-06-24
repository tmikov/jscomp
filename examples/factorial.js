
function print(x) {
    __asmh__({},"#include <stdio.h>");
    __asm__({},[],[["x", x]],
            '%[x] = js::toString(&frame, %[x]);\n'+
            'printf("%s\\n", %[x].raw.sval->getStr());'
   );
}


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

print("fact");
print(fact(100));
print("fact2");
print(fact2(100));
print("fact3");
print(fact3(100));

