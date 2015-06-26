function Parent ()
{
    this.id = 0;
}

Parent.prototype.base = function() {
    print("in base");
    print(this.id);
    print(this.value);
}

function Maker (id)
{
    this.value = "hello";
    this.id = id;
}

Maker.prototype = new Parent();
Maker.prototype.method = function() {
    print("in method");
    print(this.value);
    print(this.id);
    this.base();
}

var p = new Parent();
p.base();

print("\n");

var m = new Maker("id");
m.method();
