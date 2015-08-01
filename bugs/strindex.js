console.log("aaa".charCodeAt(0));
console.log("aaa".charAt(0));

var x = new String("aaa");
console.log(x.length);

console.log(x.charCodeAt(0), x.charAt(0));

for ( var i = 0; i < x.length; ++i )
  console.log(i, x[i], x.charAt(i), x.charCodeAt(i));

for ( var i in x )
  console.log(i, x[i]);

var s = "1234";
for ( var i in s )
  console.log(i, s[i]);
