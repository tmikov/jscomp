var x = { a: 10 };
var y = "a";
var z;

z = "a" in x;
z = y in x;

z = 0;

if ("a" in x)
  ++z;
if (y in x)
  ++z;
