function Parent (id)
{
    this.id = id;
}

Parent.prototype.base = function() {
    console.log("in base");
    console.log(this.id);
    console.log(this.value);
}

function Maker (id)
{
    Parent.call(this, id);
    this.value = "hello";
}

Maker.prototype = new Parent();
Maker.prototype.method = function() {
    console.log("in method");
    console.log(this.value);
    console.log(this.id);
    this.base();
}

var p = new Parent(1);
p.base();

console.log("\n");

var m = new Maker("id");
m.method();
