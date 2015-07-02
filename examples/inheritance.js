function Parent (id)
{
    this.id = id;
}

Parent.prototype.base = function() {
    print("in base");
    print(this.id);
    print(this.value);
}

function Maker (id)
{
    Parent.call(this, id);
    this.value = "hello";
}

Maker.prototype = new Parent();
Maker.prototype.method = function() {
    print("in method");
    print(this.value);
    print(this.id);
    this.base();
}

var p = new Parent(1);
p.base();

print("\n");

var m = new Maker("id");
m.method();
