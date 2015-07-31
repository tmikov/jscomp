var x = {}
console.log(Object.getPrototypeOf(x), x.__proto__);
x = Object.create(null);
console.log(Object.getPrototypeOf(x), x.__proto__);
