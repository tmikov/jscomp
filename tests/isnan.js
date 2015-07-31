var x = NaN;
console.log(x, "nan", isNaN(x), "finite", isFinite(x));
x = 1;
console.log(x, "nan", isNaN(x), "finite", isFinite(x));
x = Infinity;
console.log(x, "nan", isNaN(x), "finite", isFinite(x));
x = -x;
console.log(x, "nan", isNaN(x), "finite", isFinite(x));
