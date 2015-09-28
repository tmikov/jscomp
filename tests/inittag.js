var assert=require("assert");

function assertThrow (f)
{
    try {
        f();
    } catch (e) {
        return;
    }
    assert(false, "did not throw");
}

assert(!$jsc.checkInitTag(0,0));
assert(!$jsc.checkInitTag({},0));
assert(!$jsc.checkInitTag(0,{}));
assert(!$jsc.checkInitTag({},{}));

var no = $jsc.createNative(0);
var initTag = $jsc.newInitTag();
var initTag1 = $jsc.newInitTag();

assertThrow(function () { $jsc.setInitTag(no, 1); });
assertThrow(function () { $jsc.setInitTag(1, initTag); });
assertThrow(function () { $jsc.setInitTag({}, initTag); });

assert(!$jsc.checkInitTag(no, 0));
assert(!$jsc.checkInitTag(no, initTag));

$jsc.setInitTag(no, initTag);
assert($jsc.checkInitTag(no, initTag));
assert(!$jsc.checkInitTag(no, initTag1));
