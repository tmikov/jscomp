
function trytest1 (p)
{
    try {
        if (p)
            return 10;
        console.log("in try");
    } catch (e) {
        console.log("caught", e);
    }
}

function trytest2 (p)
{
    try {
        if (p)
            return 10;
        console.log("in try");
    } finally {
        console.log("in finally");
    }
}

function trytest3 (p)
{
    try {
        if (p)
            return 10;
        console.log("in try");
    } catch (e) {
        console.log("caught", e);
    } finally {
        console.log("in finally");
    }
}

function thrower (e)
{
    console.log("throwing", e);
    throw e;
}

function trytest4 (p)
{
    console.log("p is", p);
    try {
        console.log("in try");
        switch (p) {
            case 0: thrower("a string"); break;
            case 1: return 10;
        }
        console.log("after throw");
    } catch (e) {
        console.log("caught", e);
    } finally {
        console.log("in finally");
    }
    return 0;
}

console.log(trytest4(0));
console.log(trytest4(1));
console.log(trytest4(2));
