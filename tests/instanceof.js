function Other () {}

function Base (a) {
    this.a = a;
}

function Child (a,b) {
    Base.call(this, a);
    this.b = b;
}

Child.prototype = Object.create(Base.prototype);

var ch = new Child(10,20);

console.log(ch instanceof Other)
console.log(ch instanceof Child)
console.log(ch instanceof Base);

if (ch instanceof Base)
    console.log("YES");
