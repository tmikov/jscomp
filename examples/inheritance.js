function Parent ()
{
}

Parent.prototype.base = function() {}

function Maker (id)
{
    this.value = "hello";
    this.id = id;
}

Maker.prototype = new Parent();
Maker.prototype.method = function() {}


var m = new Maker("id");
m.base();
